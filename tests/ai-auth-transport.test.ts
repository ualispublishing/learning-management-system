import assert from 'node:assert/strict';
import test from 'node:test';
import { AIConfigurationError, InstitutionAIService } from '../src/lib/ai/service';
import type { AIGenerationInput } from '../src/lib/ai/types';

const origin = 'https://lms.example.test';
const sourceText = 'Algorithms are finite procedures.';
const input = { courseId: 'course-1', courseTitle: 'Computing', sourceText };

function browser(t: test.TestContext, publicOrigin = origin) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: publicOrigin } } });
  t.after(() => { if (original) Object.defineProperty(globalThis, 'window', original); else Reflect.deleteProperty(globalThis, 'window'); });
}

// Synthetic gateway response: exercises the client contract, not real SSO or model quality.
function reply(init: RequestInit | undefined) {
  const form = init?.body as FormData;
  const provenance = {
    promptVersion: form.get('promptVersion'), evidenceVerified: true,
    sourceSha256: 'a'.repeat(64), requestId: new Headers(init?.headers).get('X-Request-Id'),
    ...(form.has('document') ? { documentSha256: 'b'.repeat(64) } : {}),
  };
  const result = form.get('task') === 'syllabus'
    ? { title: 'Computing', evidence: [{ field: 'title', sourceExcerpt: String(form.get('sourceText')) }], warnings: [] }
    : { cards: [{ front: 'What is an algorithm?', back: 'A finite procedure.', sourceExcerpt: sourceText, confidence: 0.9 }] };
  return new Response(JSON.stringify({ ...result, provenance }), { headers: { 'Content-Type': 'application/json' } });
}

test('AI cookie authentication requires an exact HTTPS browser origin and rejects mixed credentials', t => {
  browser(t);
  for (const baseUrl of ['https://other.example.test', `${origin}:8443`, `${origin}/api`, 'http://localhost:4178']) {
    assert.throws(() => new InstitutionAIService({ baseUrl, authentication: 'same-origin-cookie' }), /exact HTTPS browser origin/);
  }
  const mixed = { baseUrl: origin, authentication: 'same-origin-cookie', getAccessToken: async () => 'must-not-be-read' };
  assert.throws(() => new InstitutionAIService(mixed as ConstructorParameters<typeof InstitutionAIService>[0]), /no token callback/);
});

test('AI cookie mode is unavailable without a browser origin', () => {
  assert.throws(() => new InstitutionAIService({ baseUrl: origin, authentication: 'same-origin-cookie' }), /exact HTTPS browser origin/);
});

test('both AI tasks send explicit course scope and rely only on browser-managed cookies in cookie mode', async t => {
  browser(t);
  const requests: RequestInit[] = [];
  const service = new InstitutionAIService({ baseUrl: origin, authentication: 'same-origin-cookie', fetchImpl: async (url, init) => {
    assert.equal(String(url), `${origin}/lms/v1/ai/generate`);
    assert.ok(init); requests.push(init);
    assert.equal(init.credentials, 'same-origin');
    assert.equal(init.redirect, 'error');
    const headers = new Headers(init.headers);
    for (const name of ['Authorization', 'Cookie', 'Origin', 'Content-Type']) assert.equal(headers.get(name), null, `${name} must not be manually supplied`);
    assert.equal(headers.get('Accept'), 'application/json');
    assert.equal(headers.get('Idempotency-Key'), headers.get('X-Request-Id'));
    assert.equal((init.body as FormData).get('courseId'), input.courseId);
    assert.equal((init.body as FormData).get('courseTitle'), input.courseTitle);
    return reply(init);
  } });
  const cards = await service.generateFlashcards(input);
  assert.equal(cards[0].reviewerVerified, false);
  assert.equal((await service.extractSyllabus(input)).title, 'Computing');
  assert.equal(requests.length, 2);
  assert.notEqual(new Headers(requests[0].headers).get('X-Request-Id'), new Headers(requests[1].headers).get('X-Request-Id'));
});

test('AI cookie origin is rechecked on each request', async t => {
  browser(t);
  let calls = 0;
  const service = new InstitutionAIService({ baseUrl: origin, authentication: 'same-origin-cookie', fetchImpl: async (_url, init) => { calls++; return reply(init); } });
  await service.generateFlashcards(input);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: 'https://other.example.test' } } });
  await assert.rejects(service.generateFlashcards(input), /exact HTTPS browser origin/);
  assert.equal(calls, 1);
});

test('a gateway declaring processing notes cannot silently omit them from either task result', async t => {
  browser(t);
  const service = new InstitutionAIService({ baseUrl: origin, authentication: 'same-origin-cookie', fetchImpl: async (_url, init) => {
    const result = reply(init); result.headers.set('X-LMS-AI-Review-Notices', 'present'); return result;
  } });
  await assert.rejects(service.generateFlashcards(input), /Source processing notes are missing/);
  await assert.rejects(service.extractSyllabus(input), /Source processing notes are missing/);
});

test('remote AI scope is required and malformed scope is rejected before token lookup or transport', async t => {
  browser(t);
  let tokenReads = 0; let calls = 0;
  const bearer = new InstitutionAIService({ baseUrl: origin, getAccessToken: async () => { tokenReads++; return 'token'; }, fetchImpl: async () => { calls++; throw new Error('Unexpected request'); } });
  const cookie = new InstitutionAIService({ baseUrl: origin, authentication: 'same-origin-cookie', fetchImpl: async () => { calls++; throw new Error('Unexpected request'); } });
  for (const service of [bearer, cookie]) {
    await assert.rejects(service.generateFlashcards({ sourceText }), /Select a course/);
    await assert.rejects(service.extractSyllabus({ sourceText }), /Select a course/);
    for (const courseId of ['', ' spaces ', '../course', 'id\nheader', 'x'.repeat(129), 42]) {
      await assert.rejects(service.generateFlashcards({ ...input, courseId } as AIGenerationInput), /stable course identifier/);
    }
  }
  assert.equal(tokenReads, 0); assert.equal(calls, 0);
});

test('bearer AI transport explicitly omits browser cookies', async t => {
  browser(t);
  let calls = 0;
  const service = new InstitutionAIService({ baseUrl: origin, getAccessToken: async () => 'bearer-test', fetchImpl: async (_url, init) => {
    calls++;
    assert.equal(init?.credentials, 'omit');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer bearer-test');
    assert.equal((init?.body as FormData).get('courseId'), input.courseId);
    return reply(init);
  } });
  await service.generateFlashcards(input); assert.equal(calls, 1);
});

test('pending token lookup cannot change the validated course, source bytes or response-validation input', async () => {
  let release!: (token: string) => void;
  const token = new Promise<string>(resolve => { release = resolve; });
  const original = new Blob([sourceText], { type: 'text/plain' });
  const draft = { ...input, document: { uri: 'file:///notes.txt', name: 'notes.txt', file: original, size: original.size, mimeType: 'text/plain' } };
  const service = new InstitutionAIService({ baseUrl: origin, getAccessToken: () => token, fetchImpl: async (_url, init) => {
    const form = init?.body as FormData;
    assert.equal(form.get('courseId'), 'course-1');
    assert.equal(form.get('courseTitle'), 'Computing');
    assert.equal(form.get('sourceText'), sourceText);
    const file = form.get('document') as File;
    assert.equal(file.name, 'notes.txt');
    assert.equal(await file.text(), sourceText);
    return reply(init);
  } });
  const pending = service.generateFlashcards(draft);
  draft.courseId = '../changed'; draft.courseTitle = 'Changed'; draft.sourceText = 'Changed source.';
  draft.document.name = 'changed.pdf'; draft.document.file = new Blob(['changed']);
  release('token');
  assert.equal((await pending).length, 1);
});

test('AI authentication configuration is captured instead of switching modes after construction', async t => {
  browser(t);
  const config = { baseUrl: origin, authentication: 'same-origin-cookie' as const, fetchImpl: (async (_url, init) => {
    assert.equal(init?.credentials, 'same-origin');
    assert.equal(new Headers(init?.headers).get('Authorization'), null);
    return reply(init);
  }) as typeof fetch };
  const service = new InstitutionAIService(config);
  Object.assign(config, { authentication: 'bearer', getAccessToken: async () => 'unexpected-token' });
  await service.generateFlashcards(input);
});

test('cookie mode keeps full provenance checks even on an HTTPS localhost origin', async t => {
  browser(t, 'https://localhost');
  const service = new InstitutionAIService({ baseUrl: 'https://localhost', authentication: 'same-origin-cookie', fetchImpl: async () => new Response(JSON.stringify({ cards: [] }), { headers: { 'Content-Type': 'application/json' } }) });
  await assert.rejects(service.generateFlashcards(input), /attestation/);
});

test('cookie authentication rejection stays visible and never retries with a demo or bearer fallback', async t => {
  browser(t);
  for (const status of [401, 403]) {
    let calls = 0;
    const service = new InstitutionAIService({ baseUrl: origin, authentication: 'same-origin-cookie', fetchImpl: async () => {
      calls++;
      return new Response(JSON.stringify({ error: 'internal private diagnostic', code: 'authentication_required' }), { status, headers: { 'Content-Type': 'application/json' } });
    } });
    await assert.rejects(service.generateFlashcards(input), error => error instanceof Error && error.message.includes(String(status)) && !error.message.includes('private diagnostic'));
    assert.equal(calls, 1);
  }
});

test('AI transport rejects unsupported authentication modes and localhost URL protocols', () => {
  assert.throws(() => new InstitutionAIService({ baseUrl: origin, authentication: 'unknown' } as unknown as ConstructorParameters<typeof InstitutionAIService>[0]), AIConfigurationError);
  assert.throws(() => new InstitutionAIService({ baseUrl: 'ftp://localhost' }), /HTTPS/);
});
