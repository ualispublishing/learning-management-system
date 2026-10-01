import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { AuthStore } from '../../store.ts';
import { createAuthHandler } from '../../auth.ts';
import { GatewayStore } from '../../gateway-store.ts';
import { createGatewayHandler } from '../../gateway.ts';
import type { Mutation } from '../../gateway-validation.ts';

export const origin = 'https://lms.example.test';
export const descriptor = { id: 'school-1', name: 'Synthetic school', timeZone: 'America/Toronto' };
export const opaque = () => randomBytes(32).toString('base64url');
export const assignmentPayload = (itemId = 'assignment-1', courseId = 'course-1') => ({
  id: itemId, courseId, category: 'coursework', title: 'Explain your reasoning', presentationSlot: 'current', isGraded: true,
  gradingCategory: 'Assessments', workType: 'individual', questions: [{ id: 'q-1', label: '1', content: 'Explain the method.', answerType: 'text', points: 10 }],
  quizConfig: { questionsPerPage: 'all', maxAttempts: 1, allowRevisit: true },
});
export function mutation(entity: Mutation['entity'], operation: Mutation['operation'], payload: Record<string, unknown>, mutationId = randomUUID()) {
  return { id: mutationId, entity, operation, entityId: String(payload.id), occurredAt: 1, payload };
}
export function draft(studentId = 'student-1', submissionId = 'submission-1') {
  return { id: submissionId, studentId, courseId: 'course-1', contentItemId: 'assignment-1', status: 'draft', responses: [{ questionId: 'q-1', answer: 'My written answer' }], expectedRevision: 0, revision: 1, attemptNumber: 1 };
}
export async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'lms-gateway-'));
  const file = join(directory, 'lms.sqlite');
  let now = 1_800_000_000_000;
  const auth = new AuthStore(file);
  for (const userId of ['teacher-1', 'ta-1', 'student-1', 'student-2', 'outsider', 'global-admin']) {
    auth.provision('https://id.example.test', userId, { id: userId, name: `Name ${userId}`, email: `${userId}@example.test`, globalRole: userId === 'global-admin' ? 'admin' : 'user' });
  }
  let gateway = new GatewayStore(file, descriptor);
  gateway.provisionCourse('course-1', 'A course', Date.parse('2025-01-01T00:00:00Z'), Date.parse('2035-01-01T00:00:00Z'), now);
  gateway.provisionCourse('private-course', 'Private course', Date.parse('2025-01-01T00:00:00Z'), Date.parse('2035-01-01T00:00:00Z'), now);
  gateway.enroll('course-1', 'teacher-1', 'teacher', now);
  gateway.enroll('course-1', 'ta-1', 'ta', now);
  gateway.enroll('course-1', 'student-1', 'student', now);
  gateway.enroll('course-1', 'student-2', 'student', now);
  const provider = {
    authorizationOrigin: 'https://id.example.test',
    async start() { const state = opaque(); return { state, verifier: opaque(), nonce: opaque(), url: `https://id.example.test/authorize?state=${state}` }; },
    async complete(callback: URL) { return { issuer: 'https://id.example.test', subject: callback.searchParams.get('code')! }; },
  };
  // The actual OIDC protocol/signatures are exercised separately in auth.test.ts.
  const login = createAuthHandler({ origin, store: auth, provider, now: () => now });
  let handler = createGatewayHandler({ origin, auth, gateway, now: () => now });
  async function signIn(userId: string) {
    const start = await login(new Request(`${origin}/lms/v1/auth/login`, { method: 'POST', headers: { Origin: origin } }));
    assert.equal(start.status, 303);
    const binding = start.headers.getSetCookie().find(cookie => cookie.startsWith('__Host-lms_login='))!.split(';')[0];
    const state = new URL(start.headers.get('location')!).searchParams.get('state');
    const finish = await login(new Request(`${origin}/lms/v1/auth/callback?state=${state}&code=${userId}`, { headers: { Cookie: binding } }));
    assert.equal(finish.status, 303);
    return finish.headers.getSetCookie().find(cookie => cookie.startsWith('__Host-lms_session='))!.split(';')[0];
  }
  const cookies = Object.fromEntries(await Promise.all(['teacher-1', 'ta-1', 'student-1', 'student-2', 'outsider', 'global-admin'].map(async name => [name, await signIn(name)])));
  async function snapshot(userId = 'teacher-1') {
    const result = await handler(new Request(`${origin}/lms/v1/snapshot`, { headers: { Cookie: cookies[userId] } }));
    assert.equal(result.status, 200);
    return await result.json() as ReturnType<GatewayStore['snapshot']>;
  }
  async function push(userId: string, mutations: ReturnType<typeof mutation>[], options: { key?: string; etag?: string; headers?: Record<string, string>; body?: string } = {}) {
    const etag = options.etag ?? (await snapshot(userId)).etag;
    return handler(new Request(`${origin}/lms/v1/mutations`, { method: 'POST', headers: {
      Cookie: cookies[userId], Origin: origin, 'Content-Type': 'application/json', 'Idempotency-Key': options.key ?? randomUUID(), 'If-Match': etag, ...options.headers,
    }, body: options.body ?? JSON.stringify({ schemaVersion: '1.0', atomic: true, mutations }) }));
  }
  return { auth, get gateway() { return gateway; }, file, directory, cookies, login, signIn, snapshot, push,
    handle: (request: Request) => handler(request),
    advance: (ms: number) => { now += ms; },
    reopen: () => { gateway.close(); gateway = new GatewayStore(file, descriptor); handler = createGatewayHandler({ origin, auth, gateway, now: () => now }); },
    close: () => { gateway.close(); auth.close(); rmSync(directory, { recursive: true, force: true }); },
  };
}
