import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { AssetServiceError, HttpAssetService, type AssetUploadContext, type HttpAssetServiceConfig } from '../src/lib/integration/assetService';

const origin = 'https://lms.example.test';
const sourceText = 'A synthetic course document.';
const file = new Blob([sourceText], { type: 'text/plain' });
const document = { uri: 'blob:synthetic', name: 'notes.txt', file, size: file.size, mimeType: 'text/plain' };
const context: AssetUploadContext = { courseId: 'course-1', purpose: 'course-content', idempotencyKey: 'upload-1' };
const stored = { id: 'asset-1', url: `${origin}/files/asset-1`, name: 'notes.txt', mimeType: 'text/plain', size: file.size, sha256: 'a'.repeat(64) };

function browser(t: test.TestContext, publicOrigin = origin) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: publicOrigin } } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window'); });
}

test('asset cookie configuration requires an exact HTTPS browser origin and disallows mixed authentication', t => {
  browser(t);
  for (const baseUrl of ['https://other.example.test', `${origin}:8443`, `${origin}/api`, 'http://localhost:4178']) {
    assert.throws(() => new HttpAssetService({ baseUrl, authentication: 'same-origin-cookie' }), /HTTPS/);
  }
  let reads = 0;
  assert.throws(() => new HttpAssetService({ baseUrl: origin, authentication: 'same-origin-cookie', getAccessToken: async () => { reads++; return 'token'; } } as unknown as HttpAssetServiceConfig), /no token callback/);
  assert.equal(reads, 0);
  assert.throws(() => new HttpAssetService({ baseUrl: origin, authentication: 'unknown' } as unknown as HttpAssetServiceConfig), /Unsupported asset authentication/);
  assert.throws(() => new HttpAssetService({ baseUrl: origin } as HttpAssetServiceConfig), /access-token provider/);
  for (const baseUrl of ['ftp://localhost', 'file://localhost/tmp', `${origin}?key=secret`, 'https://user:password@lms.example.test']) {
    assert.throws(() => new HttpAssetService({ baseUrl, getAccessToken: async () => 'token' }), AssetServiceError);
  }
});

test('asset cookie authentication is unavailable without a browser', () => {
  assert.throws(() => new HttpAssetService({ baseUrl: origin, authentication: 'same-origin-cookie' }), /exact HTTPS browser origin/);
});

test('cookie uploads preserve the file and explicit purpose/scope without exposing session credentials', async t => {
  browser(t);
  const requests: RequestInit[] = [];
  const service = new HttpAssetService({ baseUrl: origin, authentication: 'same-origin-cookie', fetchImpl: async (url, init) => {
    assert.equal(String(url), `${origin}/lms/v1/assets`);
    assert.ok(init); requests.push(init);
    assert.equal(init.credentials, 'same-origin'); assert.equal(init.mode, 'same-origin');
    assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store');
    const headers = new Headers(init.headers);
    for (const name of ['Authorization', 'Cookie', 'Origin', 'Content-Type']) assert.equal(headers.get(name), null, name);
    assert.equal(headers.get('Accept'), 'application/json');
    assert.equal(headers.get('Idempotency-Key'), 'upload-1');
    const asset = (init.body as FormData).get('asset') as File;
    assert.equal(asset.name, document.name); assert.equal(asset.type, document.mimeType); assert.equal(await asset.text(), sourceText);
    return Response.json(stored);
  } });
  const scopes: AssetUploadContext[] = [context, { ...context, purpose: 'assessment-submission' }, { threadId: 'thread-1', purpose: 'chat-attachment', idempotencyKey: 'upload-1' }];
  for (const scope of scopes) assert.deepEqual(await service.upload(document, scope), stored);
  assert.equal(requests.length, 3);
  for (const [index, request] of requests.entries()) {
    const form = request.body as FormData;
    assert.equal(form.get('courseId'), scopes[index].courseId ?? null);
    assert.equal(form.get('threadId'), scopes[index].threadId ?? null);
    assert.equal(form.get('purpose'), scopes[index].purpose);
  }
});

test('cookie origin is checked again for each upload', async t => {
  browser(t);
  let calls = 0;
  const service = new HttpAssetService({ baseUrl: origin, authentication: 'same-origin-cookie', fetchImpl: async () => { calls++; return Response.json(stored); } });
  await service.upload(document, context);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: 'https://other.example.test' } } });
  await assert.rejects(service.upload(document, context), /exact HTTPS browser origin/);
  assert.equal(calls, 1);
});

test('asset authentication configuration and transport are captured at construction', async t => {
  browser(t);
  let calls = 0;
  const config: HttpAssetServiceConfig = { baseUrl: origin, authentication: 'same-origin-cookie', fetchImpl: async (_url, init) => {
    calls++; assert.equal(init?.credentials, 'same-origin'); assert.equal(new Headers(init?.headers).get('Authorization'), null);
    return Response.json(stored);
  } };
  const service = new HttpAssetService(config);
  Object.assign(config, { baseUrl: 'https://other.example.test', authentication: 'bearer', getAccessToken: async () => 'unexpected-token', fetchImpl: async () => { throw new Error('Replaced transport'); } });
  await service.upload(document, context); assert.equal(calls, 1);
});

test('bearer asset uploads explicitly omit browser cookies and bind the fetch receiver', async t => {
  browser(t);
  const service = new HttpAssetService({ baseUrl: origin, getAccessToken: async () => 'bearer-token', fetchImpl: async function (this: typeof globalThis, _url, init) {
    assert.equal(this, globalThis);
    assert.equal(init?.credentials, 'omit');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer bearer-token');
    return Response.json(stored);
  } });
  assert.deepEqual(await service.upload(document, context), stored);
});

test('invalid file bytes or destinations are rejected before credentials and transport', async t => {
  browser(t);
  let tokenReads = 0; let calls = 0;
  const service = new HttpAssetService({ baseUrl: origin, maxBytes: 100, getAccessToken: async () => { tokenReads++; return 'token'; }, fetchImpl: async () => { calls++; return Response.json(stored); } });
  await assert.rejects(service.upload(document, { purpose: 'course-content' }), /course identifier/);
  await assert.rejects(service.upload(document, { purpose: 'chat-attachment' }), /conversation identifier/);
  await assert.rejects(service.upload(document, { ...context, idempotencyKey: 'bad\nkey' }), /idempotency key/);
  await assert.rejects(service.upload({ ...document, file: undefined }, context), /missing the selected file bytes/);
  await assert.rejects(service.upload({ ...document, file: new Blob(['x'.repeat(101)], { type: 'text/plain' }) }, context), /smaller/);
  await assert.rejects(service.upload({ ...document, size: file.size - 1 }, context), /size changed/);
  assert.equal(tokenReads, 0); assert.equal(calls, 0);
});

test('pending credentials cannot change validated upload bytes, destination, request key or response defaults', async t => {
  browser(t);
  let release!: (token: string) => void;
  const credentials = new Promise<string>(resolve => { release = resolve; });
  const draft = { ...document }; const destination = { ...context };
  const service = new HttpAssetService({ baseUrl: origin, getAccessToken: () => credentials, fetchImpl: async (_url, init) => {
    const form = init?.body as FormData;
    assert.equal(form.get('courseId'), 'course-1'); assert.equal(form.get('threadId'), null); assert.equal(form.get('purpose'), 'course-content');
    assert.equal(new Headers(init?.headers).get('Idempotency-Key'), 'upload-1');
    const uploaded = form.get('asset') as File;
    assert.equal(uploaded.name, 'notes.txt'); assert.equal(await uploaded.text(), sourceText);
    return Response.json({ id: stored.id, url: stored.url, sha256: stored.sha256 });
  } });
  const result = service.upload(draft, destination);
  Object.assign(draft, { name: 'changed.txt', file: new Blob(['changed']), size: 7, mimeType: 'application/octet-stream' });
  Object.assign(destination, { courseId: 'course-2', threadId: 'thread-2', purpose: 'chat-attachment', idempotencyKey: 'changed' });
  release('token'); assert.deepEqual(await result, stored);
});

test('cookie authentication failures are redacted and never retry or fall back', async t => {
  browser(t, 'https://localhost');
  for (const status of [401, 403]) {
    let calls = 0;
    const service = new HttpAssetService({ baseUrl: 'https://localhost', authentication: 'same-origin-cookie', fetchImpl: async () => {
      calls++; return Response.json({ message: 'private learner data', code: 'authentication_required' }, { status });
    } });
    await assert.rejects(service.upload(document, context), error => error instanceof AssetServiceError && error.message.includes(String(status)) && error.message.includes('authentication_required') && !error.message.includes('private learner data'));
    assert.equal(calls, 1);
  }
  const invalidType = new HttpAssetService({ baseUrl: 'https://localhost', authentication: 'same-origin-cookie', fetchImpl: async () => new Response(JSON.stringify(stored), { headers: { 'Content-Type': 'text/plain' } }) });
  await assert.rejects(invalidType.upload(document, context), /unexpected content type/);
});

test('asset deadlines bound stalled credentials, transports and response streams', async t => {
  for (const mode of ['credentials', 'transport', 'stream', 'non-stream'] as const) {
    let started!: () => void; const entered = new Promise<void>(resolve => { started = resolve; });
    let tokenReady!: (value: string) => void; let calls = 0; let cancelled = false;
    let body: ReadableStream<Uint8Array> | undefined; let signal: AbortSignal | undefined;
    const service = new HttpAssetService({ baseUrl: origin, getAccessToken: async () => {
      if (mode === 'credentials') { started(); return new Promise<string>(resolve => { tokenReady = resolve; }); }
      return 'token';
    }, fetchImpl: async (_url, init) => {
      calls++; signal = init?.signal as AbortSignal;
      if (mode === 'transport') { started(); return new Promise<Response>(() => {}); }
      if (mode === 'non-stream') return { headers: new Headers(), body: null, text: () => { started(); return new Promise<string>(() => {}); } } as Response;
      body = new ReadableStream({ pull() { if (body?.locked) started(); }, cancel() { cancelled = true; return new Promise<void>(() => {}); } });
      return new Response(body, { headers: { 'Content-Type': 'application/json' } });
    } });
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const pending = assert.rejects(service.upload(document, context), /Asset upload timed out/);
    await entered; t.mock.timers.tick(120_000); await pending;
    if (mode === 'credentials') { tokenReady('late-token'); await nextTurn(); assert.equal(calls, 0); }
    else { assert.equal(calls, 1); assert.equal(signal?.aborted, true); }
    if (mode === 'stream') { assert.equal(cancelled, true); assert.equal(body?.locked, false); }
    t.mock.timers.reset();
  }
});

test('an upload response arriving after timeout is cancelled and cannot become a successful publication', async t => {
  let release!: (response: Response) => void; let started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const service = new HttpAssetService({ baseUrl: origin, getAccessToken: async () => 'token', fetchImpl: async () => {
    started(); return new Promise<Response>(resolve => { release = resolve; });
  } });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = assert.rejects(service.upload(document, context), /timed out/);
  await entered; t.mock.timers.tick(120_000); await pending;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  release(new Response(body)); await nextTurn();
  assert.equal(cancelled, true); assert.equal(body.locked, false);
});

test('oversized asset response streams are cancelled before materializing a result', async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(1_000_001)); }, cancel() { cancelled = true; } });
  const service = new HttpAssetService({ baseUrl: origin, getAccessToken: async () => 'token', fetchImpl: async () => new Response(body) });
  await assert.rejects(service.upload(document, context), /1 MB limit/);
  assert.equal(cancelled, true); assert.equal(body.locked, false);
});

test('real HTTP multipart upload succeeds and a redirect never forwards its file or token', async t => {
  let forwarded = 0; let uploads = 0; let redirect = false;
  const server = createServer(async (request, response) => {
    if (request.url === '/forwarded') { forwarded++; response.end('{}'); return; }
    uploads++;
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const multipart: unknown = await new Response(Buffer.concat(chunks), { headers: { 'Content-Type': request.headers['content-type']! } }).formData();
    assert.ok(multipart instanceof FormData);
    assert.equal(multipart.get('courseId'), context.courseId); assert.equal(await (multipart.get('asset') as File).text(), sourceText);
    assert.equal(request.headers.authorization, 'Bearer synthetic-token');
    assert.equal(request.headers['idempotency-key'], context.idempotencyKey);
    if (redirect) { response.writeHead(307, { Location: '/forwarded' }); response.end(); }
    else { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(stored)); }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const service = new HttpAssetService({ baseUrl: `http://127.0.0.1:${address.port}`, getAccessToken: async () => 'synthetic-token' });
  assert.deepEqual(await service.upload(document, context), stored);
  redirect = true;
  await assert.rejects(service.upload(document, context), AssetServiceError);
  assert.equal(uploads, 2); assert.equal(forwarded, 0);
});
