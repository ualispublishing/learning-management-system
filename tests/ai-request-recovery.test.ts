import assert from 'node:assert/strict';
import test from 'node:test';
import { AIRequestError, InstitutionAIService, recoverValidatedFlashcards, recoverValidatedSyllabus } from '../src/lib/ai/service';
import { readRecoveredAIResult } from '../src/lib/ai/requestRecovery';
import { FLASHCARD_PROMPT_VERSION } from '../src/lib/ai/prompts';
import { createAIGateway } from '../server/ai';
import { fixture, origin } from '../server/tests/helpers/gateway-fixture';
import { setImmediate as nextTurn } from 'node:timers/promises';

const sourceText = 'Algorithms are finite procedures.';
const input = { courseId: 'course-1', sourceText };
const card = { front: 'What are algorithms?', back: 'Finite procedures.', sourceExcerpt: sourceText, confidence: 0.9 };
const provenance = { promptVersion: FLASHCARD_PROMPT_VERSION, evidenceVerified: true, sourceSha256: 'a'.repeat(64), requestId: 'request-1', model: 'synthetic' };
const saved = { id: 'job-1', requestId: 'request-1', courseId: input.courseId, task: 'flashcards', status: 'succeeded', result: { cards: [card], provenance }, reviewNotices: [], createdAt: 1_800_000_000_000, expiresAt: 1_800_086_400_000 };
function browser(t: test.TestContext) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin } } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window'); });
}
async function failed(work: Promise<unknown>): Promise<AIRequestError> {
  try { await work; assert.fail('Expected a failed request'); }
  catch (error) { assert.ok(error instanceof AIRequestError); return error; }
}
async function setup(t: test.TestContext, providerFails = false) {
  browser(t);
  const f = await fixture(); t.after(() => f.close());
  let calls = 0;
  const requests: string[] = [];
  let cookie = f.cookies['teacher-1'];
  const gateway = createAIGateway({ origin, auth: f.auth, gateway: f.gateway, policy: { retentionHours: 24, dailyRequestLimit: 10 }, now: () => 1_800_000_000_000,
    provider: { id: 'synthetic', generate: async request => {
      calls++;
      if (providerFails) throw new Error('Synthetic provider failure');
      const evidence = { sourceExcerpt: sourceText, sourceLocation: request.source.segments[0].location };
      return request.task === 'flashcards' ? { cards: [{ ...card, ...evidence }] } : { title: 'Algorithms', evidence: [{ field: 'title', ...evidence }], warnings: [] };
    } } });
  const service = new InstitutionAIService({ baseUrl: origin, authentication: 'same-origin-cookie', requestRecovery: 'status-v1', fetchImpl: async (url, options) => {
    requests.push(options?.method ?? 'GET');
    assert.equal(options?.credentials, 'same-origin'); assert.equal(options?.redirect, 'error');
    const headers = new Headers(options?.headers);
    assert.equal(headers.has('cookie'), false); assert.equal(headers.has('authorization'), false);
    headers.set('Cookie', cookie); headers.set('Origin', origin);
    if (options?.method === 'GET') { assert.equal(options.body, undefined); assert.equal(options.cache, 'no-store'); }
    const response = await gateway.handle(new Request(url, { ...options, headers }));
    if (options?.method === 'POST') throw new Error('Connection dropped after the server response');
    return response;
  } });
  return { f, service, requests, calls: () => calls, changeCookie: (value: string) => { cookie = value; } };
}

test('both tasks recover a committed result after a dropped response without repeating generation', async t => {
  const { service, calls, requests } = await setup(t);
  const cardsFailure = await failed(service.generateFlashcards(input));
  assert.equal(cardsFailure.canCheckSavedResult, true);
  const cards = await recoverValidatedFlashcards(cardsFailure, input);
  assert.equal(cards[0].front, card.front); assert.equal(cards[0].reviewerVerified, false);
  assert.equal(cards[0].provenance?.requestId, cardsFailure.requestId);
  const syllabusFailure = await failed(service.extractSyllabus(input));
  const syllabus = await recoverValidatedSyllabus(syllabusFailure, input);
  assert.equal(syllabus.title, 'Algorithms'); assert.equal(syllabus.provenance?.requestId, syllabusFailure.requestId);
  assert.equal(calls(), 2); assert.deepEqual(requests, ['POST', 'GET', 'POST', 'GET']);
});

test('recovery checks current account/course access and never falls back to generation', async t => {
  const { f, service, calls, requests, changeCookie } = await setup(t);
  const error = await failed(service.generateFlashcards(input));
  changeCookie(f.cookies['ta-1']);
  await assert.rejects(recoverValidatedFlashcards(error, input), /No saved request is available/);
  changeCookie(f.cookies['teacher-1']); f.gateway.enroll('course-1', 'teacher-1', 'remove');
  await assert.rejects(recoverValidatedFlashcards(error, input), /no longer permits recovery/);
  assert.equal(calls(), 1); assert.deepEqual(requests, ['POST', 'GET', 'GET']);
});

test('uncertain and expired records remain explicit outcomes rather than triggering another provider call', async t => {
  const { f, service, calls, requests } = await setup(t, true);
  let error = await failed(service.generateFlashcards(input));
  error = await failed(recoverValidatedFlashcards(error, input));
  assert.match(error.message, /provider outcome is uncertain/); assert.equal(error.canCheckSavedResult, true);
  f.gateway.pruneAI(1_800_086_400_000);
  error = await failed(recoverValidatedFlashcards(error, input));
  assert.match(error.message, /expired or never reached/);
  assert.equal(calls(), 1); assert.deepEqual(requests, ['POST', 'GET', 'GET']);
});

test('source or task changes invalidate a recovery handle before any network access', async t => {
  const { service, requests } = await setup(t);
  const error = await failed(service.generateFlashcards(input));
  for (const changed of [{ ...input, courseId: 'private-course' }, { ...input, sourceText: 'New source.' }, { ...input, requestedCardCount: 10 }]) {
    await assert.rejects(recoverValidatedFlashcards(error, changed), /different source or course/);
  }
  await assert.rejects(recoverValidatedSyllabus(error, input), /different source or course/);
  assert.deepEqual(requests, ['POST']);
  const file = new File([sourceText], 'lecture.txt', { type: 'text/plain' });
  const document = { uri: 'blob:first', name: file.name, size: file.size, mimeType: file.type, file };
  const fileError = new AIRequestError('Failed', 'request-1', 'flashcards', { ...input, document });
  assert.equal(fileError.matches('flashcards', { ...input, document: { ...document } }), true);
  assert.equal(fileError.matches('flashcards', { ...input, document: { ...document, file: new File([sourceText], file.name, { type: file.type }) } }), false);
});

test('saved status rejects mixed request identities, invalid states, fields, times and dropped processing notes', () => {
  for (const change of [{ requestId: 'other' }, { courseId: 'other' }, { task: 'syllabus' }, { status: 'other' }, { id: '../bad' }, { createdAt: -1 }, { expiresAt: saved.createdAt }, { extra: true }, { reviewNotices: 'unstructured' }, { reviewNotices: ['Missing inline note.'] }, { result: { ...saved.result, provenance: { ...provenance, requestId: 'other' } } }]) {
    assert.throws(() => readRecoveredAIResult({ ...saved, ...change }, 'flashcards', input, 'request-1'));
  }
  assert.throws(() => readRecoveredAIResult({ ...saved, status: 'processing', result: undefined }, 'flashcards', input, 'request-1'), /still in progress/);
  assert.throws(() => readRecoveredAIResult({ ...saved, status: 'processing' }, 'flashcards', input, 'request-1'), /invalid or mismatched/);
});

test('bearer recovery refreshes credentials and redacts malformed or hostile status responses', async () => {
  let reads = 0; const methods: string[] = [];
  let statusResponse = () => Response.json(saved);
  let key = '';
  const service = new InstitutionAIService({ baseUrl: origin, requestRecovery: 'status-v1', getAccessToken: async () => `session-${++reads}`, fetchImpl: async (_url, options) => {
    methods.push(options?.method ?? 'GET'); assert.equal(options?.credentials, 'omit');
    assert.equal(new Headers(options?.headers).get('Authorization'), `Bearer session-${reads}`);
    if (options?.method === 'POST') { key = new Headers(options.headers).get('X-Request-Id')!; throw new Error('Lost response with secret detail'); }
    return statusResponse();
  } });
  const error = await failed(service.generateFlashcards(input)); assert.equal(error.message.includes('secret'), false);
  statusResponse = () => Response.json({ ...saved, requestId: key, result: { ...saved.result, provenance: { ...provenance, requestId: key } } });
  assert.equal((await recoverValidatedFlashcards(error, input))[0].front, card.front);
  for (const response of [new Response('<script>private-upstream-data</script>', { headers: { 'Content-Type': 'text/html' } }), new Response('private-upstream-data', { status: 500 }), new Response('{', { headers: { 'Content-Type': 'application/json' } }), new Response('x'.repeat(2_064_001), { headers: { 'Content-Type': 'application/json' } }), Response.json({ ...saved, requestId: key, result: { ...saved.result, cards: [{ ...card, back: '' }], provenance: { ...provenance, requestId: key } } })]) {
    statusResponse = () => response;
    const failure = await failed(recoverValidatedFlashcards(error, input));
    assert.equal(failure.requestId, key); assert.equal(failure.canCheckSavedResult, true); assert.equal(failure.message.includes('private-upstream-data'), false);
  }
  assert.equal(methods.filter(method => method === 'POST').length, 1); assert.equal(reads, methods.length);
});

test('gateways without recovery support retain the request identifier without inventing a status endpoint', async () => {
  let calls = 0;
  const service = new InstitutionAIService({ baseUrl: origin, getAccessToken: async () => 'session', fetchImpl: async () => { calls++; throw new Error('Dropped'); } });
  const error = await failed(service.generateFlashcards(input));
  assert.equal(error.canCheckSavedResult, false); assert.ok(error.requestId);
  await assert.rejects(error.checkSavedResult(), /not configured/); assert.equal(calls, 1);
  assert.throws(() => new InstitutionAIService({ baseUrl: origin, requestRecovery: 'unknown' as 'status-v1', getAccessToken: async () => 'session' }), /status-v1/);
});

test('a stalled credential callback times out before it can submit a late generation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let tokenReady!: (value: string) => void; let calls = 0;
  const service = new InstitutionAIService({ baseUrl: origin, getAccessToken: () => new Promise(resolve => { tokenReady = resolve; }), fetchImpl: async () => { calls++; return Response.json({}); } });
  const pending = assert.rejects(service.generateFlashcards(input), /timed out/);
  t.mock.timers.tick(300_000); await pending;
  tokenReady('late-token'); await nextTurn(); assert.equal(calls, 0);
});

test('recovery deadlines stop stalled credentials, transports and streams and release the reader', async t => {
  for (const mode of ['credentials', 'transport', 'late-response', 'stream'] as const) {
    let recovering = false; let entered!: () => void; let cancelled = false; let body: ReadableStream<Uint8Array> | undefined;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const methods: string[] = [];
    const service = new InstitutionAIService({ baseUrl: origin, requestRecovery: 'status-v1', getAccessToken: async () => {
      if (recovering && mode === 'credentials') { entered(); return new Promise(() => {}); }
      return 'session';
    }, fetchImpl: async (_url, options) => {
      methods.push(options?.method ?? 'GET');
      if (options?.method === 'POST') throw new Error('Dropped');
      if (mode === 'transport') { entered(); return new Promise(() => {}); }
      body = new ReadableStream({ pull() { if (mode === 'late-response' || body?.locked) entered(); }, cancel() { cancelled = true; return new Promise(() => {}); } });
      return new Response(body, { headers: { 'Content-Type': 'application/json' } });
    } });
    const error = await failed(service.generateFlashcards(input)); recovering = true;
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const pending = failed(recoverValidatedFlashcards(error, input));
    await started; t.mock.timers.tick(30_000);
    const result = await pending; assert.match(result.message, /timed out/);
    assert.equal(result.requestId, error.requestId); assert.equal(result.canCheckSavedResult, true);
    assert.equal(methods.filter(method => method === 'POST').length, 1);
    if (mode === 'stream' || mode === 'late-response') { assert.equal(cancelled, true); assert.equal(body?.locked, false); }
    t.mock.timers.reset();
  }
});
