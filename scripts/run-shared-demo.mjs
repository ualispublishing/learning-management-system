import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { watchBranding } from './watch-branding.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

const parsePort = (name, value) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`${name} must be a whole number from 1 to 65535.`);
  }
  return parsed;
};

/** @param {Record<string, string | undefined>} env */
export function demoConfig(env = process.env, args = process.argv.slice(2), root = projectRoot) {
  let appPort = env.LMS_DEMO_APP_PORT || '4178';
  let clear = false;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--clear' || args[i] === '-c') clear = true;
    else if (args[i] === '--port') appPort = args[++i];
    else if (args[i].startsWith('--port=')) appPort = args[i].slice(7);
    else throw new Error(`Unknown demo option: ${args[i]}. Use --port <number> or --clear. For other Expo options, use npm run web:standalone.`);
  }
  appPort = parsePort('LMS_DEMO_APP_PORT / --port', appPort);
  const serverPort = parsePort('LMS_DEMO_SERVER_PORT', env.LMS_DEMO_SERVER_PORT || '4180');
  if (appPort === serverPort) throw new Error('The app and demo API need different ports.');
  return {
    root, appPort, serverPort, clear,
    appUrl: `http://127.0.0.1:${appPort}`,
    serverUrl: `http://127.0.0.1:${serverPort}`,
    stateFile: path.join(root, '.expo', `lms-demo-${appPort}-${serverPort}.json`),
    env,
  };
}

const readState = async file => {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; }
};
const isAlive = pid => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
};
const probe = async (url, accept, signal) => {
  try {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(1_500)]) });
    return response.ok && await accept(response);
  } catch { return false; }
};
const healthyBackend = launchId => async response => {
  const body = await response.json();
  return body.ok === true && body.result?.mode === 'shared-demo' && body.result?.launchId === launchId;
};
const healthyApp = async response => (await response.text()).trim() === 'packager-status:running';

export async function existingDemo(config, signal = new AbortController().signal) {
  const state = await readState(config.stateFile);
  // Reuse only a session owned by this launcher with the matching health identity.
  // An unrelated HTTP 200 or an old state file is not readiness.
  if (!state?.launchId || ![state.pid, state.backendPid, state.appPid].every(isAlive)) return false;
  const ready = await Promise.all([
    probe(`${config.serverUrl}/health`, healthyBackend(state.launchId), signal),
    probe(`${config.appUrl}/status`, healthyApp, signal),
  ]);
  return ready.every(Boolean);
}

export async function requireFreePort(port, name, variable) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', error => reject(error.code === 'EADDRINUSE'
      ? new Error(`${name} port ${port} is already in use. Stop the older process in its terminal with Ctrl+C, then run npm run web again. To run a separate demo, set BOTH LMS_DEMO_APP_PORT and LMS_DEMO_SERVER_PORT to unused ports (${variable} controls this port).`)
      : error));
    server.listen({ port, host: '127.0.0.1', exclusive: true }, () => server.close(resolve));
  });
}

export function startChild(name, command, options) {
  const child = spawn(command[0], command.slice(1), options);
  const tracked = { name, child, ended: false, done: null };
  // Subscribe immediately: a child can fail before the first health request.
  tracked.done = new Promise(resolve => {
    child.once('error', error => { tracked.ended = true; resolve(new Error(`${name} could not start: ${error.message}`)); });
    child.once('exit', (code, signal) => { tracked.ended = true; resolve(Object.assign(new Error(`${name} exited (${signal || `code ${code}`}). See its output above.`), { exitCode: code })); });
  });
  return tracked;
}

export async function waitForService(url, accept, children, signal, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (!signal.aborted && Date.now() < deadline) {
    const result = await Promise.race([
      ...children.map(child => child.done),
      probe(url, accept, signal),
    ]);
    if (result instanceof Error) throw result;
    if (result && children.every(child => !child.ended)) return;
    await delay(200, undefined, { signal });
  }
  signal.throwIfAborted();
  throw new Error(`Timed out waiting for ${url}. See the process output above.`);
}

function printUrls(config) {
  console.log(`\nMulti-user LMS: ${config.appUrl}`);
  console.log(`Demo guide: ${config.appUrl}/demo`);
  console.log(`AI before & after: ${config.appUrl}/ai-demo`);
  console.log(`Shared demo API: ${config.serverUrl}`);
}

export async function superviseChildren(backend, app) {
  const outcome = await Promise.race([backend, app].map(async child => ({ child, error: await child.done })));
  // Expo handles Ctrl+C itself when it puts the terminal into raw mode. In that
  // case the parent receives a successful app exit instead of a SIGINT event.
  if (outcome.child === app && outcome.error.exitCode === 0) return;
  throw outcome.error;
}

export async function runDemo(config) {
  if (await existingDemo(config)) {
    console.log('The complete demo is already running. Reusing it without resetting its data.');
    printUrls(config);
    if (config.clear) console.log('To clear Metro, stop the original terminal with Ctrl+C and rerun npm run web -- --clear.');
    console.log('Keep the original demo terminal open.');
    return;
  }
  // Check before spawning instead of accepting another server's health or
  // allowing Expo to switch to a different port interactively.
  await requireFreePort(config.serverPort, 'Demo API', 'LMS_DEMO_SERVER_PORT');
  await requireFreePort(config.appPort, 'Web app', 'LMS_DEMO_APP_PORT');
  const launchId = randomUUID();
  const env = {
    ...config.env, NODE_ENV: 'development',
    LMS_DEMO_SERVER_PORT: String(config.serverPort),
    LMS_DEMO_LAUNCH_ID: launchId,
    EXPO_PUBLIC_LMS_SHARED_DEMO_URL: config.serverUrl,
    EXPO_PUBLIC_LMS_PREPARED_AI_DEMO: '1',
  };
  const options = { cwd: config.root, env, stdio: 'inherit' };
  const controller = new AbortController();
  const children = [];
  const stopWatching = watchBranding(config.root);
  const stop = () => {
    controller.abort();
    children.forEach(({ child, ended }) => { if (!ended) child.kill('SIGTERM'); });
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    const backend = startChild('Demo API', [process.execPath, '--import', 'tsx', 'scripts/shared-demo-server.ts'], options);
    children.push(backend);
    await waitForService(`${config.serverUrl}/health`, healthyBackend(launchId), children, controller.signal, 20_000);
    // Match the IPv4 loopback URLs on systems where localhost resolves to ::1 first.
    const app = startChild('Expo web app', [process.execPath, '--dns-result-order=ipv4first', 'node_modules/expo/bin/cli', 'start', '--web', '--host', 'localhost', '--port', String(config.appPort), ...(config.clear ? ['--clear'] : [])], options);
    children.push(app);
    await waitForService(`${config.appUrl}/status`, healthyApp, children, controller.signal);
    await mkdir(path.dirname(config.stateFile), { recursive: true });
    await writeFile(config.stateFile, JSON.stringify({ launchId, pid: process.pid, backendPid: backend.child.pid, appPid: app.child.pid }));
    printUrls(config);
    console.log('Keep this terminal open. Ctrl+C stops both services and clears the in-memory demo data.');
    await superviseChildren(backend, app);
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally {
    stop();
    stopWatching();
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    const allStopped = Promise.all(children.map(child => child.done));
    const grace = new AbortController();
    await Promise.race([allStopped, delay(3_000, undefined, { signal: grace.signal }).catch(() => {})]);
    grace.abort();
    children.forEach(({ child, ended }) => { if (!ended) child.kill('SIGKILL'); });
    if ((await readState(config.stateFile))?.launchId === launchId) await unlink(config.stateFile).catch(() => {});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await runDemo(demoConfig()); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
