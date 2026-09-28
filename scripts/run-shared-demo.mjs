import { spawn } from 'node:child_process';
import process from 'node:process';

const parsePort = (name, fallback) => {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`${name} must be a whole number from 1 to 65535.`);
  }
  return parsed;
};

const serverPort = parsePort('LMS_DEMO_SERVER_PORT', 4180);
const appPort = parsePort('LMS_DEMO_APP_PORT', 4178);
const serverUrl = `http://127.0.0.1:${serverPort}`;
const sharedEnvironment = {
  ...process.env,
  LMS_DEMO_SERVER_PORT: String(serverPort),
  EXPO_PUBLIC_LMS_SHARED_DEMO_URL: serverUrl,
};

const backend = spawn(process.execPath, ['--import', 'tsx', 'scripts/shared-demo-server.ts'], {
  cwd: process.cwd(),
  env: sharedEnvironment,
  stdio: 'inherit',
});

const waitForServer = async () => {
  let lastError;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${serverUrl}/health`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw lastError instanceof Error ? lastError : new Error('The shared demo server did not start.');
};

let app;
let stopping = false;
const stop = signal => {
  if (stopping) return;
  stopping = true;
  app?.kill(signal);
  backend.kill(signal);
};

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));

try {
  await waitForServer();
  const expoBinary = process.platform === 'win32' ? 'node_modules\\.bin\\expo.cmd' : 'node_modules/.bin/expo';
  app = spawn(expoBinary, ['start', '--web', '--host', 'lan', '--port', String(appPort)], {
    cwd: process.cwd(),
    env: sharedEnvironment,
    stdio: 'inherit',
  });
  console.log(`Multi-user LMS app: http://127.0.0.1:${appPort}`);
  console.log(`Shared demo API: ${serverUrl}`);
  const [winner, code] = await Promise.race([
    new Promise(resolve => backend.once('exit', exitCode => resolve(['server', exitCode]))),
    new Promise(resolve => app.once('exit', exitCode => resolve(['app', exitCode]))),
  ]);
  if (!stopping) console.error(`${winner} process exited unexpectedly.`);
  stop('SIGTERM');
  process.exitCode = typeof code === 'number' ? code : 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : 'The multi-user demo could not start.');
  stop('SIGTERM');
  process.exitCode = 1;
}
