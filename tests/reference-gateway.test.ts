import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpInstitutionAdapter, InstitutionAdapterError } from '../src/lib/integration/InstitutionAdapter';
import { createInstitutionRepositoryFactory } from '../src/lib/integration/InstitutionRepositoryFactory';
import { validateInstitutionSync } from '../src/lib/schema/CourseSchema';
import type { ContentItem, StudentSubmission } from '../src/types/lms';
import { fixture, origin, assignmentPayload } from '../server/tests/helpers/gateway-fixture';

function browser(t: test.TestContext, publicOrigin = origin) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { value: { location: { origin: publicOrigin } }, configurable: true });
  t.after(() => { if (original) Object.defineProperty(globalThis, 'window', original); else Reflect.deleteProperty(globalThis, 'window'); });
}

test('cookie transport requires the exact HTTPS browser origin and never reads or forwards a bearer token', async t => {
  browser(t);
  for (const baseUrl of ['https://other.example.test', `${origin}/api`, 'http://localhost:3000']) {
    assert.throws(() => new HttpInstitutionAdapter({ baseUrl, authentication: 'same-origin-cookie' }), { code: 'invalid_cookie_origin' });
  }
  let calls = 0;
  const adapter = new HttpInstitutionAdapter({ baseUrl: origin, authentication: 'same-origin-cookie', fetchImpl: async (_input, init) => {
    calls++;
    assert.equal(init?.credentials, 'same-origin'); assert.equal(init?.redirect, 'error');
    assert.equal(new Headers(init?.headers).get('authorization'), null);
    assert.equal(new Headers(init?.headers).get('cookie'), null);
    return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
  } });
  await adapter.pullSnapshot(); assert.equal(calls, 1);
  Object.defineProperty(globalThis, 'window', { value: { location: { origin: 'https://other.example.test' } }, configurable: true });
  await assert.rejects(adapter.pullSnapshot(), { code: 'invalid_cookie_origin' }); assert.equal(calls, 1);
});

test('cookie transport is unavailable to native/server callers without a browser origin', () => {
  assert.throws(() => new HttpInstitutionAdapter({ baseUrl: origin, authentication: 'same-origin-cookie' }), { code: 'invalid_cookie_origin' });
});

test('actual repositories consume canonical gateway snapshots and complete the written-assessment journey', async t => {
  browser(t);
  const f = await fixture(); t.after(() => f.close());
  const make = (userId: string) => {
    const adapter = new HttpInstitutionAdapter({ baseUrl: origin, authentication: 'same-origin-cookie', tenantId: 'school-1', fetchImpl: async (input, init) => {
      assert.equal(init?.credentials, 'same-origin');
      const headers = new Headers(init?.headers);
      // Test transport emulates browser-managed cookies and Origin; production
      // JavaScript never sees the HttpOnly cookie or manually sets either header.
      headers.set('Cookie', f.cookies[userId]); if (init?.method === 'POST') headers.set('Origin', origin);
      const result = await f.handle(new Request(input, { ...init, headers }));
      if (result.ok && String(input).includes('/snapshot')) {
        const validation = validateInstitutionSync(await result.clone().json());
        if (!validation.success) throw new InstitutionAdapterError(JSON.stringify(validation.issues), 'invalid_gateway_snapshot');
      }
      return result;
    } });
    return createInstitutionRepositoryFactory({ adapter, getSessionUser: async () => ({ id: userId, name: `Name ${userId}`, globalRole: 'user' }), snapshotTtlMs: 0, requireCanonicalMutationReadback: true });
  };
  const teacher = make('teacher-1'), student = make('student-1');
  const content = await teacher.content.createContentItem({ ...assignmentPayload(), createdAt: 1 } as ContentItem);
  assert.notEqual(content.createdAt, 1);
  assert.equal((await student.content.getContentItems('course-1')).length, 1);
  let submission: StudentSubmission = { id: 'repository-submission', studentId: 'student-1', contentItemId: content.id, courseId: 'course-1', submittedAt: Date.now(), startedAt: Date.now(), updatedAt: Date.now(), revision: 1, attemptNumber: 1, status: 'draft', responses: [{ questionId: 'q-1', answer: 'Written through the real repository' }] };
  submission = await student.submissions.upsertSubmission(submission);
  assert.equal(submission.studentName, 'Name student-1');
  f.advance(1000);
  submission = await student.submissions.upsertSubmission({ ...submission, status: 'submitted', revision: 2, updatedAt: submission.updatedAt! + 1000, submittedAt: submission.submittedAt + 1000 });
  let grading = (await teacher.submissions.getSubmissionsForCourses(['course-1']))[0];
  grading = await teacher.submissions.upsertSubmission({ ...grading, status: 'graded', gradeStatus: 'draft', gradeRevision: 1, revision: 3, updatedAt: grading.updatedAt! + 1, gradedBy: 'teacher-1', gradedAt: grading.submittedAt + 1, totalScore: 8, responses: grading.responses.map(a => ({ ...a, score: 8, isManuallyGraded: true, needsManualGrading: false })), overallFeedback: 'Staff-only feedback' });
  assert.equal((await student.submissions.getSubmissionsForCourses(['course-1']))[0].totalScore, undefined);
  grading = await teacher.submissions.upsertSubmission({ ...grading, revision: 4, gradeRevision: 2, gradeStatus: 'released', updatedAt: grading.updatedAt! + 1 });
  assert.equal(grading.gradeStatus, 'released');
  f.reopen();
  const reloaded = (await make('student-1').submissions.getSubmissionsForCourses(['course-1']))[0];
  assert.equal(reloaded.totalScore, 8); assert.equal(reloaded.gradeStatus, 'released');
  assert.equal(reloaded.responses[0].answer, 'Written through the real repository');
  f.gateway.enroll('course-1', 'teacher-1', 'remove');
  assert.equal((await make('student-1').submissions.getSubmissionsForCourses(['course-1']))[0].gradedBy, 'teacher-1');
  await f.login(new Request(`${origin}/lms/v1/auth/logout`, { method: 'POST', headers: { Origin: origin, Cookie: f.cookies['student-1'] } }));
  await assert.rejects(make('student-1').content.getContentItems('course-1'), (error: unknown) => error instanceof InstitutionAdapterError && error.status === 401);
});
