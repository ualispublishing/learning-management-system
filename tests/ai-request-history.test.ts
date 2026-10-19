import assert from 'node:assert/strict';
import test from 'node:test';
import { InstitutionAIService, recoverValidatedFlashcards, recoverValidatedSyllabus } from '../src/lib/ai/service';
import { readAIHistoryPage, savedAIRequest } from '../src/lib/ai/requestRecovery';
import { createAIGateway } from '../server/ai';
import { fixture, origin } from '../server/tests/helpers/gateway-fixture';

const sourceText = 'Algorithms are finite procedures.';
const summary = { id: 'job-1', requestId: 'request-1', courseId: 'course-1', task: 'flashcards', status: 'succeeded', createdAt: 1_800_000_000_000, expiresAt: 1_800_086_400_000, fileName: null, hasPastedText: true, locale: 'en', requestedCardCount: 30 };

test('fresh clients recover both tasks from reselected files without replaying generation', async t => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin } } });
  t.after(() => { if (prior) Object.defineProperty(globalThis, 'window', prior); else Reflect.deleteProperty(globalThis, 'window'); });
  const f = await fixture(); t.after(() => f.close());
  let calls = 0;
  const requests: string[] = [];
  const gateway = createAIGateway({ origin, auth: f.auth, gateway: f.gateway, policy: { retentionHours: 24, dailyRequestLimit: 10 }, now: () => 1_800_000_000_000,
    provider: { id: 'synthetic-history-test', generate: async request => {
      calls++;
      const evidence = { sourceExcerpt: request.source.segments[0].text, sourceLocation: request.source.segments[0].location };
      return request.task === 'flashcards' ? { cards: [{ front: 'What are algorithms?', back: 'Finite procedures.', confidence: 0.9, ...evidence }] } : { title: 'Algorithms', evidence: [{ field: 'title', ...evidence }], warnings: [] };
    } } });
  const client = () => new InstitutionAIService({ baseUrl: origin, authentication: 'same-origin-cookie', requestRecovery: 'history-v1', fetchImpl: async (url, options) => {
    const parsed = new URL(String(url)); requests.push(`${options?.method} ${parsed.pathname}`);
    assert.equal(options?.credentials, 'same-origin'); assert.equal(options.redirect, 'error');
    const headers = new Headers(options.headers); assert.equal(headers.has('Cookie'), false); assert.equal(headers.has('Authorization'), false);
    headers.set('Cookie', f.cookies['teacher-1']); headers.set('Origin', origin);
    if (parsed.pathname.endsWith('/recover')) assert.equal(headers.has('Idempotency-Key'), false);
    return gateway.handle(new Request(url, { ...options, headers }));
  } });
  const input = (uri: string, text = sourceText) => {
    const file = new File([text], 'source.txt', { type: 'text/plain' });
    return { courseId: 'course-1', document: { uri, name: file.name, size: file.size, mimeType: file.type, file } };
  };
  for (const task of ['flashcards', 'syllabus'] as const) {
    const previous = client();
    if (task === 'flashcards') await previous.generateFlashcards(input('blob:old')); else await previous.extractSyllabus(input('blob:old'));
    const fresh = client().requestHistory!;
    const page = await fresh.list(task, 'course-1'); assert.equal(page.items.length, 1);
    const selected = input('blob:new');
    const saved = savedAIRequest(fresh, task, selected, page.items[0].requestId);
    if (task === 'flashcards') {
      const cards = await recoverValidatedFlashcards(saved, selected); assert.equal(cards[0].reviewerVerified, false); assert.equal(cards[0].front, 'What are algorithms?');
    } else assert.equal((await recoverValidatedSyllabus(saved, selected)).title, 'Algorithms');
    await assert.rejects(fresh.recover(task, input('blob:wrong', 'Different content.'), page.items[0].requestId), /do not match/);
    await assert.rejects(fresh.recover(task, selected, 'missing'), /No saved request/);
  }
  assert.equal(calls, 2); assert.equal(requests.filter(value => value.endsWith('/generate')).length, 2);
  assert.equal(requests.filter(value => value.endsWith('/recover')).length, 6);
});

test('history parsing rejects private fields, mixed scopes, unbounded or duplicate rows and invalid cursors', () => {
  const page = { items: [summary], nextCursor: null };
  assert.equal(readAIHistoryPage(page, 'flashcards', 'course-1').items[0].requestId, 'request-1');
  for (const fields of [{ result: {} }, { sourceText: 'secret' }, { courseId: 'other' }, { task: 'syllabus' }, { id: '../bad' }, { createdAt: 0 }, { expiresAt: summary.createdAt }, { locale: 'invalid locale' }, { fileName: '../file.txt' }, { hasPastedText: false }, { requestedCardCount: 101 }]) {
    assert.throws(() => readAIHistoryPage({ ...page, items: [{ ...summary, ...fields }] }, 'flashcards', 'course-1'), /invalid or mismatched/);
  }
  for (const value of [{ ...page, nextCursor: 'unbound' }, { ...page, items: Array(21).fill(summary) }, { ...page, items: [summary, summary] }, { ...page, extra: 'private' }]) assert.throws(() => readAIHistoryPage(value, 'flashcards', 'course-1'));
});

test('history is opt-in, checks identifiers before networking, refreshes bearer tokens and bounds/redacts responses', async () => {
  const make = (requestRecovery?: 'status-v1' | 'history-v1') => new InstitutionAIService({ baseUrl: origin, requestRecovery, getAccessToken: async () => 'token' });
  assert.equal(make().requestHistory, undefined); assert.equal(make('status-v1').requestHistory, undefined);
  let calls = 0, authCalls = 0;
  let reply = () => Response.json({ items: [summary], nextCursor: null });
  const history = new InstitutionAIService({ baseUrl: origin, requestRecovery: 'history-v1', getAccessToken: async () => `session-${++authCalls}`, fetchImpl: async (_url, options) => {
    calls++; assert.equal(new Headers(options?.headers).get('Authorization'), `Bearer session-${calls}`);
    assert.equal(options?.credentials, 'omit'); assert.equal(options.cache, 'no-store'); assert.equal(options.redirect, 'error'); return reply();
  } }).requestHistory!;
  await assert.rejects(history.list('flashcards', '../course')); await assert.rejects(history.list('flashcards', 'course-1', ''));
  await assert.rejects(history.recover('flashcards', { courseId: 'course-1', sourceText }, '../request'));
  assert.equal(calls, 0);
  assert.equal((await history.list('flashcards', 'course-1')).items.length, 1);
  for (const response of [new Response('private-error', { status: 500 }), new Response('private-error', { headers: { 'Content-Type': 'text/html' } }), new Response('x'.repeat(64_001), { headers: { 'Content-Type': 'application/json' } }), Response.json({ items: [{ ...summary, courseId: 'other' }], nextCursor: null })]) {
    reply = () => response;
    await assert.rejects(history.list('flashcards', 'course-1'), error => error instanceof Error && !error.message.includes('private-error'));
  }
  assert.equal(calls, 5); assert.equal(authCalls, calls);
});
