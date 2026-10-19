import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { once } from 'node:events';
import { createAIGateway } from '../ai.ts';
import { createAuthServer } from '../http.ts';
import { readAIConfig } from '../config.ts';
import { MAX_AI_REQUEST_BYTES } from '../ai-policy.ts';
import { fixture, origin } from './helpers/gateway-fixture.ts';
import { FLASHCARD_PROMPT_VERSION, SYLLABUS_PROMPT_VERSION } from '../../src/lib/ai/prompts.ts';
import type { AIProvider, AIProviderRequest } from '../../src/lib/ai/providerAdapter.server.ts';

const now = 1_800_000_000_000;
const policy = { retentionHours: 24, dailyRequestLimit: 10 };
const sourceText = 'Course: Algorithms\n\nAn algorithm is a finite procedure.';
function draft(request: AIProviderRequest) {
  const first = request.source.segments[0];
  return request.task === 'syllabus'
    ? { title: 'Algorithms', evidence: [{ field: 'title', sourceExcerpt: first.text, sourceLocation: first.location }], warnings: [] }
    : { cards: [{ front: 'What is an algorithm?', back: 'A finite procedure.', sourceExcerpt: first.text, sourceLocation: first.location, confidence: 0.9 }] };
}
async function setup(t: test.TestContext, provider?: AIProvider, dailyRequestLimit = 10) {
  const f = await fixture(); t.after(() => f.close());
  let calls = 0;
  const selected: AIProvider = provider ?? { id: 'synthetic-test-provider', generate: async request => { calls++; return draft(request); } };
  const ai = createAIGateway({ origin, auth: f.auth, gateway: f.gateway, provider: selected, policy: { ...policy, dailyRequestLimit }, now: () => now });
  return { f, ai, selected, calls: () => calls };
}
function form(task = 'flashcards', courseId = 'course-1') {
  const body = new FormData();
  body.set('task', task); body.set('courseId', courseId); body.set('sourceText', sourceText);
  body.set('promptVersion', task === 'syllabus' ? SYLLABUS_PROMPT_VERSION : FLASHCARD_PROMPT_VERSION);
  body.set('locale', 'en'); body.set('courseTitle', 'Untrusted client title');
  if (task === 'flashcards') body.set('requestedCardCount', '3');
  return body;
}
function request(cookie: string | undefined, key: string, body = form(), extraHeaders: Record<string, string> = {}, signal?: AbortSignal) {
  return new Request(`${origin}/lms/v1/ai/generate`, { method: 'POST', headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), 'Idempotency-Key': key, 'X-Request-Id': key, ...extraHeaders }, body, signal });
}
async function status(ai: ReturnType<typeof createAIGateway>, cookie: string, key: string) {
  return ai.handle(new Request(`${origin}/lms/v1/ai/requests/${key}`, { headers: { Cookie: cookie } }));
}
function row(file: string, key: string) {
  const db = new DatabaseSync(file);
  try { return db.prepare('SELECT * FROM gateway_ai_jobs WHERE key=?').get(key); } finally { db.close(); }
}

function recover(cookie: string, key: string, body = form()) {
  return new Request(`${origin}/lms/v1/ai/requests/${key}/recover`, { method: 'POST', headers: { Cookie: cookie, Origin: origin }, body });
}
function history(cookie: string, task = 'flashcards', cursor?: string, courseId = 'course-1') {
  return new Request(`${origin}/lms/v1/ai/requests?${new URLSearchParams({ courseId, task, ...(cursor ? { cursor } : {}) })}`, { headers: { Cookie: cookie } });
}

test('history recovery verifies the original file and settings across reopen without reserving or generating', async t => {
  const { f, ai, calls, selected } = await setup(t);
  const body = form(); body.set('sourceKind', 'document'); body.set('document', new File(['Original file.'], 'lecture.txt', { type: 'text/plain' }));
  const original = await (await ai.handle(request(f.cookies['teacher-1'], 'saved-file', body))).json();
  f.reopen();
  const reopened = createAIGateway({ origin, auth: f.auth, gateway: f.gateway, provider: selected, policy, now: () => now });
  const listed = await reopened.handle(history(f.cookies['teacher-1']));
  assert.equal(listed.status, 200); assert.equal(listed.headers.get('Cache-Control'), 'private, no-store');
  const page = await listed.json();
  assert.equal(page.items.length, 1); assert.equal(page.items[0].fileName, 'lecture.txt'); assert.equal(page.items[0].hasPastedText, true);
  for (const field of ['result', 'source', 'sourceText', 'artifact', 'receipt', 'documentSha256']) assert.equal(field in page.items[0], false);
  assert.deepEqual((await (await reopened.handle(recover(f.cookies['teacher-1'], 'saved-file', body))).json()).result, original);
  for (const [field, value] of [['sourceText', 'Changed text.'], ['requestedCardCount', '4'], ['locale', 'fr'], ['courseId', 'private-course']]) {
    const changed = form(); for (const [name, value] of body) changed.set(name, value); changed.set(field, value);
    const response = await reopened.handle(recover(f.cookies['teacher-1'], 'saved-file', changed));
    assert.equal(response.status, field === 'courseId' ? 403 : 409);
  }
  for (const [name, bytes, mime] of [['lecture.txt', 'Changed file.', 'text/plain'], ['other.txt', 'Original file.', 'text/plain'], ['lecture.txt', 'Original file.', '']]) {
    const changed = form(); for (const [name, value] of body) changed.set(name, value);
    changed.set('document', new File([bytes], name, { type: mime }));
    assert.equal((await reopened.handle(recover(f.cookies['teacher-1'], 'saved-file', changed))).status, 409);
  }
  assert.equal((await reopened.handle(recover(f.cookies['ta-1'], 'saved-file', body))).status, 404);
  f.gateway.pruneAI(now + 86_400_000);
  assert.equal((await reopened.handle(recover(f.cookies['teacher-1'], 'saved-file', body))).status, 404);
  assert.equal((await reopened.handle(recover(f.cookies['teacher-1'], 'never-created', body))).status, 404);
  assert.equal(row(f.file, 'saved-file'), undefined); assert.equal(row(f.file, 'never-created'), undefined); assert.equal(calls(), 1);
});

test('history is principal/course/task scoped and checks current authorization and strict queries', async t => {
  const { f, ai, calls } = await setup(t);
  await ai.handle(request(f.cookies['teacher-1'], 'teacher-cards'));
  await ai.handle(request(f.cookies['teacher-1'], 'teacher-syllabus', form('syllabus')));
  await ai.handle(request(f.cookies['ta-1'], 'ta-cards'));
  assert.deepEqual((await (await ai.handle(history(f.cookies['ta-1']))).json()).items.map((item: { requestId: string }) => item.requestId), ['ta-cards']);
  assert.deepEqual((await (await ai.handle(history(f.cookies['teacher-1'], 'syllabus'))).json()).items.map((item: { requestId: string }) => item.requestId), ['teacher-syllabus']);
  for (const user of ['student-1', 'outsider', 'global-admin']) assert.equal((await ai.handle(history(f.cookies[user]))).status, 403);
  assert.equal((await ai.handle(history(f.cookies['ta-1'], 'syllabus'))).status, 403);
  assert.equal((await ai.handle(history(f.cookies['teacher-1'], 'flashcards', undefined, 'private-course'))).status, 403);
  for (const suffix of ['&task=syllabus', '&extra=x', '&cursor=', '&cursor=../x']) assert.equal((await ai.handle(new Request(history(f.cookies['teacher-1']).url + suffix, { headers: { Cookie: f.cookies['teacher-1'] } }))).status, 400);
  assert.equal((await ai.handle(new Request(history(f.cookies['teacher-1']).url))).status, 401);
  const foreign = history(f.cookies['teacher-1']); foreign.headers.set('Origin', 'https://foreign.test'); assert.equal((await ai.handle(foreign)).status, 403);
  f.gateway.enroll('course-1', 'teacher-1', 'remove');
  assert.equal((await ai.handle(history(f.cookies['teacher-1']))).status, 403);
  assert.equal((await ai.handle(recover(f.cookies['teacher-1'], 'teacher-cards'))).status, 403);
  assert.equal(calls(), 3);
});

test('history has stable bounded pagination and rejects another principal or expired cursor', async t => {
  const { f, ai, calls } = await setup(t);
  await ai.handle(request(f.cookies['teacher-1'], 'original'));
  const original = row(f.file, 'original')!;
  // Populate retained summaries directly to exercise >20 rows without bypassing daily limits in the API.
  const db = new DatabaseSync(f.file);
  try {
    const insert = db.prepare("INSERT INTO gateway_ai_jobs SELECT ?,principal,?,digest,course_id,task,state,artifact,source_file,result,receipt,notices,created_at,expires_at FROM gateway_ai_jobs WHERE key='original'");
    for (let index = 0; index < 24; index++) insert.run(`page-${String(index).padStart(2, '0')}`, `page-${index}`);
  } finally { db.close(); }
  const first = await (await ai.handle(history(f.cookies['teacher-1']))).json();
  assert.equal(first.items.length, 20); assert.equal(first.nextCursor, first.items[19].id);
  const second = await (await ai.handle(history(f.cookies['teacher-1'], 'flashcards', first.nextCursor))).json();
  assert.equal(second.items.length, 5); assert.equal(second.nextCursor, null);
  assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 25);
  assert.equal((await ai.handle(history(f.cookies['ta-1'], 'flashcards', String(original.id)))).status, 404);
  f.gateway.pruneAI(now + 86_400_000);
  assert.equal((await ai.handle(history(f.cookies['teacher-1'], 'flashcards', first.nextCursor))).status, 404);
  assert.equal((await (await ai.handle(history(f.cookies['teacher-1']))).json()).items.length, 0); assert.equal(calls(), 1);
});

test('AI configuration stays disabled unless explicitly complete and operator-bounded', () => {
  assert.equal(readAIConfig({}), undefined);
  const config = { LMS_AI_PROVIDER: 'openai', LMS_AI_MODEL: 'test-model', LMS_AI_OPENAI_API_KEY: 'synthetic-key', LMS_AI_MAX_OUTPUT_TOKENS: '1000', LMS_AI_RETENTION_HOURS: '24', LMS_AI_DAILY_REQUEST_LIMIT: '10' };
  assert.equal(readAIConfig(config)?.policy.retentionHours, 24);
  for (const changes of [{ LMS_AI_PROVIDER: 'other' }, { LMS_AI_MODEL: '' }, { LMS_AI_RETENTION_HOURS: '23' }, { LMS_AI_DAILY_REQUEST_LIMIT: '0' }, { LMS_AI_REASONING_EFFORT: 'unknown' }, { LMS_AI_MAX_OUTPUT_TOKENS: '200001' }]) assert.throws(() => readAIConfig({ ...config, ...changes }));
  assert.throws(() => readAIConfig({ LMS_AI_PROVIDER: 'openai' }));
});

test('AI authorization rejects missing sessions, foreign origins, bearer mixing and wrong installations before generation', async t => {
  const { f, ai, calls } = await setup(t);
  for (const [cookie, headers, code] of [
    [undefined, {}, 401], [f.cookies['teacher-1'], { Origin: 'https://other.test' }, 403],
    [f.cookies['teacher-1'], { Authorization: 'Bearer test' }, 400],
    [f.cookies['teacher-1'], { 'X-Institution-Id': 'other' }, 403],
    [f.cookies['teacher-1'], { 'Sec-Fetch-Site': 'cross-site' }, 403],
  ] as [string | undefined, Record<string, string>, number][]) {
    const result = await ai.handle(request(cookie, 'denied', form(), headers)); assert.equal(result.status, code);
  }
  assert.equal(calls(), 0);
});

test('AI tasks enforce course staff permissions instead of trusting the client title or global admin claim', async t => {
  let title: string | undefined;
  const { f, ai } = await setup(t, { id: 'synthetic', generate: async input => { title = input.courseTitle; return draft(input); } });
  for (const user of ['student-1', 'outsider', 'global-admin']) assert.equal((await ai.handle(request(f.cookies[user], `denied-${user}`))).status, 403);
  assert.equal((await ai.handle(request(f.cookies['teacher-1'], 'private', form('flashcards', 'private-course')))).status, 403);
  assert.equal((await ai.handle(request(f.cookies['ta-1'], 'ta-syllabus', form('syllabus')))).status, 403);
  assert.equal((await ai.handle(request(f.cookies['ta-1'], 'ta-cards'))).status, 200);
  assert.equal(title, 'A course');
  assert.equal((await ai.handle(request(f.cookies['teacher-1'], 'teacher-syllabus', form('syllabus')))).status, 200);
});

test('AI generation persists exact input and validated output before return, then replays across a gateway reopen', async t => {
  const { f, ai, selected, calls } = await setup(t);
  const first = await ai.handle(request(f.cookies['teacher-1'], 'repeat'));
  assert.equal(first.status, 200);
  const value = await first.json();
  const saved = row(f.file, 'repeat')!;
  assert.equal(saved.state, 'succeeded');
  const artifact = JSON.parse(String(saved.artifact));
  assert.equal(artifact.task, 'flashcards'); assert.equal(artifact.promptVersion, FLASHCARD_PROMPT_VERSION);
  assert.equal(artifact.input.sourceText, sourceText.replace(/\n/g, '\r\n'), 'multipart text uses wire CRLF line endings');
  assert.equal(artifact.source.text, sourceText);
  assert.deepEqual(JSON.parse(String(saved.result)), value);
  f.reopen();
  const reopened = createAIGateway({ origin, auth: f.auth, gateway: f.gateway, provider: selected, policy, now: () => now });
  const replay = await reopened.handle(request(f.cookies['teacher-1'], 'repeat'));
  assert.deepEqual(await replay.json(), value); assert.equal(calls(), 1);
  const changed = form(); changed.set('sourceText', 'Different material.');
  assert.equal((await reopened.handle(request(f.cookies['teacher-1'], 'repeat', changed))).status, 409);
  assert.equal((await status(reopened, f.cookies['student-1'], 'repeat')).status, 404);
  assert.equal((await status(reopened, f.cookies['teacher-1'], 'repeat')).status, 200);
  f.gateway.enroll('course-1', 'teacher-1', 'remove');
  assert.equal((await reopened.handle(request(f.cookies['teacher-1'], 'repeat'))).status, 403);
  assert.equal((await status(reopened, f.cookies['teacher-1'], 'repeat')).status, 403);
});

test('text files and caption cues use the shared extractor, retain original bytes, and expose extraction review notices', async t => {
  const { f, ai } = await setup(t);
  for (const [name, text, kind, mime] of [
    ['lesson.txt', 'A procedure ends after finite steps.', 'document', 'text/plain'],
    ['lesson.vtt', 'WEBVTT\n\nNOTE\nSource note.\n\n00:00.000 --> 00:02.000\nAn algorithm is a finite procedure.', 'captions', 'text/vtt'],
  ]) {
    const body = form(); body.delete('sourceText'); body.set('sourceKind', kind); body.set('document', new File([text], name, { type: mime }));
    const result = await ai.handle(request(f.cookies['teacher-1'], name, body)); assert.equal(result.status, 200);
    const saved = row(f.file, name)!;
    assert.equal(Buffer.from(saved.source_file as Uint8Array).toString(), text);
    const artifact = JSON.parse(String(saved.artifact)); assert.ok(artifact.source.documentSha256);
    if (kind === 'captions') {
      assert.match(artifact.source.segments[0].location, /00:00:00\.000/);
      assert.equal(result.headers.get('x-lms-ai-review-notices'), 'present');
      const inspected = await (await status(ai, f.cookies['teacher-1'], name)).json(); assert.equal(inspected.reviewNotices.length, 1);
      assert.deepEqual(inspected.result.provenance.sourceReviewNotices, inspected.reviewNotices);
      assert.deepEqual((await (await ai.handle(request(f.cookies['teacher-1'], name, body))).json()).provenance.sourceReviewNotices, inspected.reviewNotices);
    }
  }
});

test('AI rejects malformed, duplicated and unsupported inputs without reserving or charging', async t => {
  const { f, ai, calls } = await setup(t);
  const changes: ((body: FormData) => void)[] = [
    body => body.append('courseId', 'private-course'), body => body.set('systemPrompt', 'override'),
    body => body.set('promptVersion', 'obsolete'), body => body.set('requestedCardCount', '1.5'),
    body => body.set('locale', 'not a locale'), body => { body.delete('sourceText'); },
    body => { body.delete('sourceText'); body.set('sourceKind', 'document'); body.set('document', new File(['%PDF-'], 'lecture.pdf', { type: 'application/pdf' })); },
    body => { body.set('sourceKind', 'audio'); },
  ];
  for (const [i, change] of changes.entries()) { const body = form(); change(body); assert.ok((await ai.handle(request(f.cookies['teacher-1'], `bad-${i}`, body))).status >= 400); assert.equal(row(f.file, `bad-${i}`), undefined); }
  assert.equal((await ai.handle(request(f.cookies['teacher-1'], 'mismatch', form(), { 'X-Request-Id': 'different' }))).status, 400);
  assert.equal(calls(), 0);
});

test('AI rechecks the session after reading the upload and before a provider call', async t => {
  const { f, ai, calls } = await setup(t);
  const original = request(f.cookies['teacher-1'], 'revoked-upload');
  const bytes = new Uint8Array(await original.arrayBuffer());
  const body = new ReadableStream({ pull(controller) { f.auth.disable('teacher-1'); controller.enqueue(bytes); controller.close(); } });
  const upload = new Request(original.url, { method: 'POST', headers: original.headers, body, duplex: 'half' } as RequestInit);
  assert.equal((await ai.handle(upload)).status, 401); assert.equal(calls(), 0);
});

test('revocation during generation prevents result retention and publication', async t => {
  let resolve!: (value: unknown) => void; let started!: () => void; let active!: AIProviderRequest;
  const begun = new Promise<void>(r => { started = r; });
  const { f, ai } = await setup(t, { id: 'delayed', generate: request => { active = request; started(); return new Promise(r => { resolve = r; }); } });
  const pending = ai.handle(request(f.cookies['teacher-1'], 'revoked-output'));
  await begun; f.gateway.enroll('course-1', 'teacher-1', 'remove'); resolve(draft(active));
  assert.equal((await pending).status, 403);
  const saved = row(f.file, 'revoked-output')!; assert.equal(saved.state, 'uncertain'); assert.equal(saved.result, null);
});

test('concurrent retries and daily quotas cannot start duplicate or excess generations', async t => {
  let resolve!: (value: unknown) => void; let started!: () => void; let active!: AIProviderRequest; let calls = 0;
  const begun = new Promise<void>(r => { started = r; });
  const { f, ai } = await setup(t, { id: 'delayed', generate: request => { calls++; active = request; started(); return new Promise(r => { resolve = r; }); } }, 1);
  const pending = ai.handle(request(f.cookies['teacher-1'], 'once'));
  await begun;
  assert.equal((await ai.handle(request(f.cookies['teacher-1'], 'once'))).status, 409);
  assert.equal((await ai.handle(request(f.cookies['teacher-1'], 'new'))).status, 429);
  resolve(draft(active)); assert.equal((await pending).status, 200);
  assert.equal((await ai.handle(request(f.cookies['teacher-1'], 'once'))).status, 200); assert.equal(calls, 1);
});

test('unknown provider failures are redacted and never retried with the same key', async t => {
  let calls = 0;
  const { f, ai } = await setup(t, { id: 'invalid', generate: async () => { calls++; throw new Error('secret source bytes api-key'); } });
  const failure = await ai.handle(request(f.cookies['teacher-1'], 'failed'));
  assert.equal(failure.status, 502); assert.equal((await failure.text()).includes('api-key'), false);
  assert.equal((await ai.handle(request(f.cookies['teacher-1'], 'failed'))).status, 409); assert.equal(calls, 1);
  assert.equal(row(f.file, 'failed')?.state, 'uncertain');
  assert.equal(JSON.parse(String(row(f.file, 'failed')?.artifact)).promptVersion, FLASHCARD_PROMPT_VERSION);
});

test('two distinct generations occupy the capacity limit and a third never reaches the provider', async t => {
  const waiting: { input: AIProviderRequest; resolve: (value: unknown) => void }[] = [];
  let bothStarted!: () => void;
  const started = new Promise<void>(resolve => { bothStarted = resolve; });
  const { f, ai } = await setup(t, { id: 'delayed', generate: input => new Promise(resolve => {
    waiting.push({ input, resolve }); if (waiting.length === 2) bothStarted();
  }) });
  const pending = ['first', 'second'].map(key => ai.handle(request(f.cookies['teacher-1'], key)));
  await started;
  const denied = await ai.handle(request(f.cookies['teacher-1'], 'third'));
  assert.equal(denied.status, 429); assert.equal((await denied.json()).code, 'ai_capacity_reached');
  assert.equal(row(f.file, 'third'), undefined); assert.equal(waiting.length, 2);
  waiting.forEach(({ input, resolve }) => resolve(draft(input)));
  for (const output of await Promise.all(pending)) assert.equal(output.status, 200);
});

test('invented evidence and provider-supplied review approval cannot become a saved result', async t => {
  let invalidApproval = false; let calls = 0;
  const { f, ai } = await setup(t, { id: 'invalid-output', generate: async input => {
    calls++;
    const output = draft(input) as { cards: Record<string, unknown>[] };
    if (invalidApproval) output.cards[0].reviewerVerified = true;
    else output.cards[0].sourceExcerpt = 'Invented evidence absent from the upload.';
    return output;
  } });
  for (const key of ['invented-evidence', 'fabricated-review']) {
    assert.equal((await ai.handle(request(f.cookies['teacher-1'], key))).status, 502);
    assert.equal(row(f.file, key)?.state, 'uncertain'); assert.equal(row(f.file, key)?.result, null);
    assert.equal((await ai.handle(request(f.cookies['teacher-1'], key))).status, 409);
    invalidApproval = true;
  }
  assert.equal(calls, 2);
});

test('client cancellation aborts generation and retains no publishable output', async t => {
  const controller = new AbortController(); let started!: () => void; let providerSignal: AbortSignal | undefined;
  const begun = new Promise<void>(resolve => { started = resolve; });
  const { f, ai } = await setup(t, { id: 'cancelled', generate: input => {
    providerSignal = input.signal; started(); return new Promise(() => {});
  } });
  const pending = ai.handle(request(f.cookies['teacher-1'], 'cancelled', form(), {}, controller.signal));
  await begun; controller.abort();
  assert.equal((await pending).status, 502); assert.equal(providerSignal?.aborted, true);
  assert.equal(row(f.file, 'cancelled')?.state, 'uncertain'); assert.equal(row(f.file, 'cancelled')?.result, null);
});

test('deadline cancellation leaves an uncertain record instead of automatically issuing another request', async t => {
  const { f } = await setup(t); let signal: AbortSignal | undefined;
  const ai = createAIGateway({ origin, auth: f.auth, gateway: f.gateway, policy, now: () => now, timeoutMs: 10, provider: { id: 'stalled', generate: request => { signal = request.signal; return new Promise(() => {}); } } });
  assert.equal((await ai.handle(request(f.cookies['teacher-1'], 'timeout'))).status, 502);
  assert.equal(signal?.aborted, true); assert.equal(row(f.file, 'timeout')?.state, 'uncertain');
});

test('startup recovery and retention preserve the documented retry window and purge expired artifacts', async t => {
  const { f, ai } = await setup(t);
  assert.equal((await ai.handle(request(f.cookies['teacher-1'], 'recover'))).status, 200);
  const db = new DatabaseSync(f.file); db.prepare("UPDATE gateway_ai_jobs SET state='processing',result=NULL WHERE key='recover'").run(); db.close();
  f.reopen(); f.gateway.recoverAIRequests();
  assert.equal(row(f.file, 'recover')?.state, 'uncertain');
  f.gateway.pruneAI(now + 86_400_000); assert.equal(row(f.file, 'recover'), undefined);
});

test('real HTTP bridge checks cookies before buffering AI uploads and enforces streaming size limits', async t => {
  const { f, ai, calls } = await setup(t);
  const server = createAuthServer(origin, request => ai.handle(request), { aiPreflight: ai.preflight });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/lms/v1/ai/generate`;
  const unauthorized = await fetch(url, { method: 'POST', body: form(), headers: { Origin: origin } }); assert.equal(unauthorized.status, 401);
  const valid = request(f.cookies['teacher-1'], 'http');
  const output = await fetch(url, { method: 'POST', body: await valid.arrayBuffer(), headers: valid.headers });
  assert.equal(output.status, 200); assert.equal(output.headers.get('cache-control'), 'private, no-store');
  const oversized = await fetch(url, { method: 'POST', headers: { Origin: origin, Cookie: f.cookies['teacher-1'], 'Content-Type': 'multipart/form-data; boundary=test' }, body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MAX_AI_REQUEST_BYTES + 1)); controller.close(); } }), duplex: 'half' } as RequestInit);
  assert.equal(oversized.status, 413);
  const recoveryUrl = url.replace('/generate', '/requests/http/recover');
  const unauthorizedRecovery = await fetch(recoveryUrl, { method: 'POST', body: form(), headers: { Origin: origin } }); assert.equal(unauthorizedRecovery.status, 401);
  const recovered = await fetch(recoveryUrl, { method: 'POST', body: form(), headers: { Cookie: f.cookies['teacher-1'], Origin: origin } });
  assert.equal(recovered.status, 200); assert.equal((await recovered.json()).result.provenance.requestId, 'http');
  const oversizedRecovery = await fetch(recoveryUrl, { method: 'POST', headers: { Origin: origin, Cookie: f.cookies['teacher-1'], 'Content-Type': 'multipart/form-data; boundary=test' }, body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MAX_AI_REQUEST_BYTES + 1)); controller.close(); } }), duplex: 'half' } as RequestInit);
  assert.equal(oversizedRecovery.status, 413); assert.equal(calls(), 1);
});

test('history recovery exposes processing and uncertain states without retrying the provider', async t => {
  let started!: () => void, resolve!: (value: unknown) => void;
  const begun = new Promise<void>(value => { started = value; }); let calls = 0;
  const { f, ai } = await setup(t, { id: 'pending', generate: () => { calls++; started(); return new Promise(value => { resolve = value; }); } });
  const pending = ai.handle(request(f.cookies['teacher-1'], 'pending'));
  await begun;
  const processing = await (await ai.handle(recover(f.cookies['teacher-1'], 'pending'))).json();
  assert.equal(processing.status, 'processing'); assert.equal(processing.result, undefined);
  resolve({ invalid: true }); assert.equal((await pending).status, 502);
  const uncertain = await (await ai.handle(recover(f.cookies['teacher-1'], 'pending'))).json();
  assert.equal(uncertain.status, 'uncertain'); assert.equal(uncertain.result, undefined); assert.equal(calls, 1);
});
