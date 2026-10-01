import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { createAuthServer } from '../http.ts';
import { MAX_MUTATION_BYTES } from '../gateway.ts';
import { GatewayStore } from '../gateway-store.ts';
import { readGatewayConfig } from '../config.ts';
import { fixture, origin, descriptor, assignmentPayload, mutation, draft } from './helpers/gateway-fixture.ts';

async function assigned(t: test.TestContext) {
  const f = await fixture(); t.after(() => f.close());
  assert.equal((await f.push('teacher-1', [mutation('content', 'create', assignmentPayload())])).status, 200);
  return f;
}
async function submitted(t: test.TestContext) {
  const f = await assigned(t);
  assert.equal((await f.push('student-1', [mutation('submission', 'create', { ...draft(), status: 'submitted' })])).status, 200);
  return f;
}
const grade = (revision = 1, gradeRevision = 0, gradeStatus = 'draft') => ({
  ...draft(), status: 'graded', expectedRevision: revision, revision: revision + 1, expectedGradeRevision: gradeRevision,
  gradeStatus, overallFeedback: 'Private staff feedback', responses: [{ questionId: 'q-1', answer: 'My written answer', score: 7, teacherFeedback: 'Needs more detail' }],
});

test('authenticated assignment → draft → submit → private grade → release survives reopening', async t => {
  const f = await assigned(t);
  const start = await f.snapshot('student-1');
  assert.equal(start.courses.length, 1); assert.equal(start.courses[0].items[0].title, 'Explain your reasoning');
  assert.equal((await f.push('student-1', [mutation('submission', 'create', { ...draft(), studentName: 'Forged name', startedAt: 1 })])).status, 200);
  let saved = (await f.snapshot('student-1')).submissions[0];
  assert.equal(saved.studentName, 'Name student-1'); assert.notEqual(saved.startedAt, 1);
  f.advance(1000);
  assert.equal((await f.push('student-1', [mutation('submission', 'update', { ...draft(), status: 'submitted', expectedRevision: 1, revision: 2 })])).status, 200);
  assert.equal((await f.push('teacher-1', [mutation('submission', 'update', grade(2))])).status, 200);
  const privateView = await f.snapshot('student-1');
  assert.equal(privateView.submissions[0].status, 'submitted');
  assert.equal(privateView.submissions[0].totalScore, undefined);
  assert.equal(privateView.submissions[0].responses[0].score, undefined);
  assert.ok(!JSON.stringify(privateView).includes('Private staff feedback'));
  assert.equal((await f.snapshot('teacher-1')).submissions[0].totalScore, 7);
  f.advance(1000);
  assert.equal((await f.push('ta-1', [mutation('submission', 'update', grade(3, 1, 'released'))])).status, 200);
  f.reopen();
  saved = (await f.snapshot('student-1')).submissions[0];
  assert.equal(saved.totalScore, 7); assert.equal(saved.gradedBy, 'ta-1'); assert.equal(saved.gradeRevision, 2); assert.equal(saved.gradeStatus, 'released');
});

test('anonymous, forged identity headers, another tenant and global admin do not grant course access', async t => {
  const f = await assigned(t);
  const anonymous = await f.handle(new Request(`${origin}/lms/v1/snapshot`, { headers: { 'X-User-Id': 'teacher-1', 'X-Role': 'admin' } }));
  assert.equal(anonymous.status, 401);
  for (const user of ['outsider', 'global-admin']) {
    assert.equal((await f.snapshot(user)).courses.length, 0);
    assert.equal((await f.push(user, [mutation('content', 'create', assignmentPayload('forged'))])).status, 403);
  }
  assert.equal((await f.handle(new Request(`${origin}/lms/v1/snapshot`, { headers: { Cookie: f.cookies['teacher-1'], 'X-Institution-Id': 'other-school' } }))).status, 403);
  assert.equal((await f.push('student-1', [mutation('content', 'create', assignmentPayload('forged'))])).status, 403);
});

test('learner projections exclude other learners answers and directory contact fields', async t => {
  const f = await submitted(t);
  const view = await f.snapshot('student-2');
  assert.equal(view.submissions.length, 0);
  assert.ok(!JSON.stringify(view).includes('My written answer'));
  assert.ok(view.users.every(user => Object.keys(user).sort().join() === 'id,name,role'));
  assert.equal((await f.push('student-2', [mutation('submission', 'update', { ...draft(), expectedRevision: 1, revision: 2 })])).status, 403);
});

test('learners cannot forge scores, grade fields, targets or grader transitions', async t => {
  const f = await assigned(t);
  for (const payload of [
    { ...draft(), totalScore: 10 }, { ...draft(), gradeStatus: 'released' },
    { ...draft(), status: 'graded' }, { ...draft(), responses: [{ questionId: 'q-1', answer: 'A', score: 10 }] },
    { ...draft(), studentId: 'student-2' }, { ...draft(), courseId: 'private-course' },
  ]) assert.ok([400, 403].includes((await f.push('student-1', [mutation('submission', 'create', payload)])).status));
  assert.equal((await f.snapshot('teacher-1')).submissions.length, 0);
});

test('submissions become immutable to learners and one attempt is enforced', async t => {
  const f = await submitted(t);
  assert.equal((await f.push('student-1', [mutation('submission', 'update', { ...draft(), expectedRevision: 1, revision: 2 })])).status, 409);
  assert.equal((await f.push('student-1', [mutation('submission', 'create', draft('student-1', 'second-attempt'))])).status, 409);
  assert.equal((await f.snapshot('student-1')).submissions.length, 1);
});

test('staff cannot rewrite answers, exceed question points, grade drafts or use stale grade revisions', async t => {
  const f = await submitted(t);
  for (const payload of [
    { ...grade(), responses: [{ questionId: 'q-1', answer: 'Changed answer', score: 7 }] },
    { ...grade(), responses: [{ questionId: 'q-1', answer: 'My written answer', score: 11 }] },
    { ...grade(), totalScore: 10 }, { ...grade(), expectedGradeRevision: 1 },
  ]) assert.ok([400, 409].includes((await f.push('teacher-1', [mutation('submission', 'update', payload)])).status));
  assert.equal((await f.push('student-2', [mutation('submission', 'create', draft('student-2', 'draft-2'))])).status, 200);
  assert.equal((await f.push('teacher-1', [mutation('submission', 'update', { ...grade(), id: 'draft-2', studentId: 'student-2' })])).status, 409);
});

test('invalid second mutation rolls back records, revision, idempotency acknowledgement and audit', async t => {
  const f = await fixture(); t.after(() => f.close());
  const before = await f.snapshot();
  const first = mutation('content', 'create', assignmentPayload());
  const invalid = mutation('content', 'create', { ...assignmentPayload('bad'), questions: [] });
  assert.equal((await f.push('teacher-1', [first, invalid], { key: 'atomic-batch' })).status, 400);
  const after = await f.snapshot();
  assert.equal(after.etag, before.etag); assert.equal(after.courses[0].items.length, 0);
  assert.equal((await f.push('teacher-1', [first], { key: 'atomic-batch' })).status, 200);
  const db = new DatabaseSync(f.file, { readOnly: true }); t.after(() => db.close());
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM gateway_audit WHERE principal=?').get('teacher-1')?.n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM gateway_requests').get()?.n, 1);
});

test('post-commit retry with original key returns original result after restart; different body or mutation-ID reuse is rejected', async t => {
  const f = await fixture(); t.after(() => f.close());
  const etag = (await f.snapshot()).etag;
  const command = mutation('content', 'create', assignmentPayload());
  const original = await f.push('teacher-1', [command], { key: 'lost-response', etag });
  const result = await original.json();
  f.reopen();
  const retry = await f.push('teacher-1', [command], { key: 'lost-response', etag });
  assert.equal(retry.status, 200); assert.deepEqual(await retry.json(), result);
  assert.equal((await f.snapshot()).courses[0].items.length, 1);
  assert.equal((await f.push('teacher-1', [mutation('content', 'create', assignmentPayload('different'))], { key: 'lost-response', etag })).status, 409);
  assert.equal((await f.push('teacher-1', [command], { key: 'new-key' })).status, 409);
});

test('two writers using one ETag cannot overwrite each other; entity revision also rejects stale edits', async t => {
  const f = await assigned(t);
  const etag = (await f.snapshot('student-1')).etag;
  const responses = await Promise.all(['a', 'b'].map(suffix => f.push('student-1', [mutation('submission', 'create', draft('student-1', `draft-${suffix}`))], { etag })));
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 412]);
  const current = (await f.snapshot('student-1')).submissions[0];
  assert.equal((await f.push('student-1', [mutation('submission', 'update', { ...draft(), id: current.id })])).status, 409);
});

test('revoked enrollment denies retries and mutations immediately; disabled and logged-out sessions fail', async t => {
  const f = await fixture(); t.after(() => f.close());
  const command = mutation('content', 'create', assignmentPayload());
  const etag = (await f.snapshot()).etag;
  assert.equal((await f.push('teacher-1', [command], { etag, key: 'retry' })).status, 200);
  f.gateway.enroll('course-1', 'teacher-1', 'remove');
  assert.equal((await f.push('teacher-1', [command], { etag, key: 'retry' })).status, 403);
  assert.equal((await f.snapshot()).courses.length, 0);
  f.auth.disable('student-1');
  assert.equal((await f.handle(new Request(`${origin}/lms/v1/snapshot`, { headers: { Cookie: f.cookies['student-1'] } }))).status, 401);
  await f.login(new Request(`${origin}/lms/v1/auth/logout`, { method: 'POST', headers: { Origin: origin, Cookie: f.cookies['student-2'] } }));
  assert.equal((await f.handle(new Request(`${origin}/lms/v1/snapshot`, { headers: { Cookie: f.cookies['student-2'] } }))).status, 401);
});

test('revocation while a request body is streaming is rechecked before committing', async t => {
  const f = await assigned(t);
  const etag = (await f.snapshot('student-1')).etag;
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
  const request = new Request(`${origin}/lms/v1/mutations`, { method: 'POST', headers: { Cookie: f.cookies['student-1'], Origin: origin, 'Content-Type': 'application/json', 'Idempotency-Key': 'pending', 'If-Match': etag }, body: stream, duplex: 'half' } as RequestInit);
  const response = f.handle(request);
  f.auth.disable('student-1');
  controller!.enqueue(new TextEncoder().encode(JSON.stringify({ schemaVersion: '1.0', atomic: true, mutations: [mutation('submission', 'create', draft())] }))); controller!.close();
  assert.equal((await response).status, 401);
  assert.equal((await f.snapshot()).submissions.length, 0);
});

test('CSRF, missing preconditions, unsupported payloads and size limits fail closed', async t => {
  const f = await assigned(t);
  const command = mutation('submission', 'create', draft());
  for (const [headers, status] of [
    [{ Origin: 'https://evil.test' }, 403], [{ Origin: '' }, 403], [{ 'Sec-Fetch-Site': 'cross-site' }, 403],
    [{ 'Content-Type': 'text/plain' }, 415], [{ 'Content-Encoding': 'gzip' }, 415],
    [{ 'If-Match': '' }, 428], [{ 'Idempotency-Key': '' }, 400], [{ Authorization: 'Bearer forged' }, 400],
  ] as [Record<string, string>, number][]) assert.equal((await f.push('student-1', [command], { headers })).status, status);
  assert.equal((await f.push('student-1', [command], { body: '{' })).status, 400);
  assert.equal((await f.push('student-1', [command], { body: 'x'.repeat(MAX_MUTATION_BYTES + 1) })).status, 413);
  for (const payload of [
    { ...assignmentPayload('timed'), quizConfig: { questionsPerPage: 'all', maxAttempts: 1, allowRevisit: true, enforceTimer: true } },
    { ...assignmentPayload('answer-key'), questions: [{ ...assignmentPayload().questions[0], correctAnswer: 'secret' }] },
    { ...assignmentPayload('group'), workType: 'group' },
  ]) assert.equal((await f.push('teacher-1', [mutation('content', 'create', payload)])).status, 400);
});

test('ETags are principal scoped, conditional snapshots stay private and expired cookies fail', async t => {
  const f = await assigned(t);
  const a = await f.snapshot('student-1'), b = await f.snapshot('student-2');
  assert.notEqual(a.etag, b.etag);
  const response = await f.handle(new Request(`${origin}/lms/v1/snapshot?cursor=${a.cursor}`, { headers: { Cookie: f.cookies['student-1'], 'If-None-Match': a.etag } }));
  assert.equal(response.status, 304); assert.equal(await response.text(), '');
  assert.match(response.headers.get('cache-control')!, /no-store/);
  f.advance(8 * 60 * 60 * 1000);
  assert.equal((await f.handle(new Request(`${origin}/lms/v1/snapshot`, { headers: { Cookie: f.cookies['student-1'] } }))).status, 401);
});

test('server term dates prevent early and late submissions even when clients send forged times', async t => {
  const f = await assigned(t);
  for (const [courseId, start, end] of [
    ['future-course', Date.parse('2030-01-01T00:00:00Z'), Date.parse('2031-01-01T00:00:00Z')],
    ['past-course', Date.parse('2020-01-01T00:00:00Z'), Date.parse('2021-01-01T00:00:00Z')],
  ] as const) {
    f.gateway.provisionCourse(courseId, 'Term boundary', start, end);
    f.gateway.enroll(courseId, 'student-1', 'student'); f.gateway.enroll(courseId, 'teacher-1', 'teacher');
    assert.equal((await f.push('teacher-1', [mutation('content', 'create', assignmentPayload(courseId, courseId))])).status, 200);
    assert.equal((await f.push('student-1', [mutation('submission', 'create', { ...draft(), id: courseId, courseId, contentItemId: courseId, submittedAt: start + 1, startedAt: start + 1 })])).status, 403);
  }
  assert.equal((await f.snapshot('student-1')).submissions.length, 0);
});

test('persisted audit identifies actor/action without storing answer text and identity mappings fit the shared schema', async t => {
  const f = await submitted(t);
  const db = new DatabaseSync(f.file, { readOnly: true }); t.after(() => db.close());
  const audit = db.prepare('SELECT * FROM gateway_audit WHERE principal=?').all('student-1');
  assert.equal(audit.length, 1); assert.equal(audit[0].entity_id, 'submission-1'); assert.equal(audit[0].action, 'submission.create');
  assert.ok(!JSON.stringify(audit).includes('My written answer'));
  assert.throws(() => f.auth.provision('https://id.example.test', 'long', { id: 'a'.repeat(129), name: 'A', globalRole: 'user' }));
  assert.throws(() => f.auth.provision('https://id.example.test', 'long', { id: 'valid', name: 'a'.repeat(501), globalRole: 'user' }));
});

test('gateway binds a persistent installation to one validated institution and schema', async t => {
  const f = await fixture(); t.after(() => f.close());
  assert.throws(() => new GatewayStore(f.file, { ...descriptor, id: 'another-school' }), /gateway_configuration_mismatch/);
  assert.equal(readGatewayConfig({}), undefined);
  assert.throws(() => readGatewayConfig({ LMS_INSTITUTION_ID: 'school' }));
  assert.throws(() => readGatewayConfig({ LMS_INSTITUTION_ID: 'school', LMS_INSTITUTION_NAME: 'School', LMS_INSTITUTION_TIME_ZONE: 'invalid' }));
  const db = new DatabaseSync(f.file); db.prepare('UPDATE gateway_meta SET version=2').run(); db.close();
  assert.throws(() => new GatewayStore(f.file, descriptor), /gateway_configuration_mismatch/);
});

test('HTTP bridge preserves mutation bodies and rejects chunked oversize bodies', async t => {
  const f = await fixture(); t.after(() => f.close());
  const server = createAuthServer(origin, f.handle); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const etag = (await f.snapshot()).etag;
  const body = JSON.stringify({ schemaVersion: '1.0', atomic: true, mutations: [mutation('content', 'create', assignmentPayload())] });
  const headers = { Cookie: f.cookies['teacher-1'], Origin: origin, 'Content-Type': 'application/json', 'Idempotency-Key': 'http-body', 'If-Match': etag };
  const result = await fetch(`http://127.0.0.1:${address.port}/lms/v1/mutations`, { method: 'POST', headers, body });
  assert.equal(result.status, 200); assert.equal((await f.snapshot()).courses[0].items.length, 1);
  const status = await new Promise<number>((resolve, reject) => {
    const request = httpRequest({ hostname: '127.0.0.1', port: address.port, path: '/lms/v1/mutations', method: 'POST', headers: { ...headers, 'Transfer-Encoding': 'chunked' } }, response => { response.resume(); resolve(response.statusCode!); });
    request.on('error', reject); request.end(Buffer.alloc(MAX_MUTATION_BYTES + 1));
  });
  assert.equal(status, 413);
});
