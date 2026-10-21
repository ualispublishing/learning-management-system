import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createSharedDemoServer } from '../src/lib/testing/sharedDemoServer';

type Launcher = typeof import('../scripts/run-shared-demo.mjs');
let demoConfig: Launcher['demoConfig'], existingDemo: Launcher['existingDemo'], requireFreePort: Launcher['requireFreePort'];
let runDemo: Launcher['runDemo'], startChild: Launcher['startChild'], waitForService: Launcher['waitForService'];
let superviseChildren: Launcher['superviseChildren'];
test.before(async () => {
  ({ demoConfig, existingDemo, requireFreePort, runDemo, startChild, waitForService, superviseChildren } = await import(new URL('../scripts/run-shared-demo.mjs', import.meta.url).href));
});

async function listen(t: test.TestContext, server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return address.port;
}

test('both web entrypoints enable the same complete demo; standalone remains explicit', async () => {
  const { scripts } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(scripts.web, scripts['demo:multiuser']);
  assert.equal(scripts['web:standalone'], 'expo start --web');
  const config = demoConfig({}, []);
  assert.equal(config.appUrl, 'http://127.0.0.1:4178');
  assert.equal(config.serverUrl, 'http://127.0.0.1:4180');
  assert.equal(path.resolve(config.root), path.resolve(fileURLToPath(new URL('../', import.meta.url))));
  assert.equal(demoConfig({}, ['--port', '4190', '--clear']).appPort, 4190);
  assert.equal(demoConfig({ LMS_DEMO_SERVER_PORT: '4191' }, ['--port=4190']).serverPort, 4191);
  assert.throws(() => demoConfig({}, ['--port']), /whole number/);
  assert.throws(() => demoConfig({}, ['--port', '4180']), /different ports/);
  assert.throws(() => demoConfig({}, ['--port', '-1']), /whole number/);
  assert.throws(() => demoConfig({}, ['--unknown']), /Unknown demo option/);
});

test('an occupied port fails clearly before spawning or disturbing its owner', async t => {
  const port = await listen(t, createServer((_req, res) => res.end('existing service')));
  await assert.rejects(requireFreePort(port, 'Demo API', 'LMS_DEMO_SERVER_PORT'), /already in use.*Ctrl\+C/);
  const config = demoConfig({ LMS_DEMO_SERVER_PORT: String(port) }, [], path.join(tmpdir(), 'no-such-lms-project'));
  await assert.rejects(runDemo(config), /already in use/);
  assert.equal(await fetch(`http://127.0.0.1:${port}`).then(res => res.text()), 'existing service');
});

test('only a live matching session is reused, including the backend identity and app readiness', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'lms-launcher-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const serverPort = await listen(t, createSharedDemoServer({ port: 0, launchId: 'current-test-session' }));
  let appHealthy = true;
  const appPort = await listen(t, createServer((_req, res) => res.end(appHealthy ? 'packager-status:running' : 'another app')));
  const config = demoConfig({ LMS_DEMO_APP_PORT: String(appPort), LMS_DEMO_SERVER_PORT: String(serverPort) }, [], root);
  await mkdir(path.dirname(config.stateFile));
  const state = { pid: process.pid, backendPid: process.pid, appPid: process.pid, launchId: 'current-test-session' };
  assert.equal(await existingDemo(config), false);
  await writeFile(config.stateFile, JSON.stringify(state));
  assert.equal(await existingDemo(config), true);
  await runDemo(config); // Must return without starting another pair or resetting the server.
  assert.equal(await existingDemo(config), true);
  appHealthy = false;
  assert.equal(await existingDemo(config), false);
  appHealthy = true;
  await writeFile(config.stateFile, JSON.stringify({ ...state, launchId: 'older-session' }));
  assert.equal(await existingDemo(config), false);
  await writeFile(config.stateFile, JSON.stringify({ ...state, appPid: -1 }));
  assert.equal(await existingDemo(config), false);
  await writeFile(config.stateFile, '{partial state');
  assert.equal(await existingDemo(config), false);
});

test('startup notices a child that exited before the health check, even when another server answers 200', async t => {
  const port = await listen(t, createServer((_req, res) => res.end('healthy')));
  const child = startChild('Test backend', [process.execPath, '-e', 'process.exit(9)'], { stdio: 'ignore' });
  await child.done;
  await assert.rejects(waitForService(`http://127.0.0.1:${port}`, async () => true, [child], new AbortController().signal), /Test backend exited \(code 9\)/);
});

test('missing executable is a handled startup failure instead of an unhandled error or hang', async () => {
  const child = startChild('Missing backend', [path.join(tmpdir(), 'no-such-lms-executable')], { stdio: 'ignore' });
  await assert.rejects(waitForService('http://127.0.0.1:1', async () => true, [child], new AbortController().signal), /Missing backend could not start/);
});

test('a normal Expo quit ends the session successfully, while an app crash remains an error', async t => {
  const backend = startChild('Test backend', [process.execPath, '-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  t.after(async () => { backend.child.kill(); await backend.done; });
  const app = startChild('Expo', [process.execPath, '-e', 'process.exit(0)'], { stdio: 'ignore' });
  await superviseChildren(backend, app);
  const crashed = startChild('Expo', [process.execPath, '-e', 'process.exit(1)'], { stdio: 'ignore' });
  await assert.rejects(superviseChildren(backend, crashed), /Expo exited \(code 1\)/);
});

test('readiness is bounded and cancellation interrupts an unresponsive endpoint', async t => {
  const port = await listen(t, createServer());
  const url = `http://127.0.0.1:${port}`;
  const controller = new AbortController();
  const pending = waitForService(url, async () => true, [], controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  const wrongServicePort = await listen(t, createServer((_req, res) => res.end('not ready')));
  await assert.rejects(waitForService(`http://127.0.0.1:${wrongServicePort}`, async () => false, [], new AbortController().signal, 100), /Timed out/);
});
