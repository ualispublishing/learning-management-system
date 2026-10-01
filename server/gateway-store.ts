import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { AuthStore, hash, type AuthUser } from './store.ts';
import { answers, assignment, id, institution, integer, requireCondition as check, submissionPayload, text } from './gateway-validation.ts';
import type { Assignment, Batch, Institution, Mutation, Submission } from './gateway-validation.ts';

type Role = 'teacher' | 'ta' | 'student';
interface Course { id: string; title: string; timeZone: string; status: 'active'; presentationMode: 'timeline'; gradingWeights: { Assessments: 100 }; termStart: number; termEnd: number; announcements: never[]; visibilityTimer: 0 }
interface PushResult { acceptedIds: string[]; rejected: never[]; nextCursor: string; nextEtag: string }
const capabilities = ['courses.read', 'roster.read', 'content.read', 'content.write', 'submissions.read', 'submissions.write', 'grades.read', 'grades.write'];

/** Same file as AuthStore: BEGIN IMMEDIATE serializes revocation and learning writes. */
export class GatewayStore {
  private db: DatabaseSync;
  readonly institution: Institution;
  constructor(file: string, descriptor: Institution) {
    this.institution = institution(descriptor);
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    try {
      check(this.db.prepare("SELECT name FROM sqlite_master WHERE name='identities'").get(), 'authentication_store_required');
      this.transaction(() => {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS gateway_meta (
            singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL,
            institution TEXT NOT NULL, instance TEXT NOT NULL, sequence INTEGER NOT NULL, changed_at INTEGER NOT NULL
          );
          CREATE TABLE IF NOT EXISTS gateway_courses (id TEXT PRIMARY KEY, data TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS gateway_enrollments (
            course_id TEXT NOT NULL REFERENCES gateway_courses(id), user_id TEXT NOT NULL REFERENCES identities(id),
            role TEXT NOT NULL CHECK(role IN ('teacher','ta','student')),
            active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), PRIMARY KEY(course_id,user_id)
          );
          CREATE TABLE IF NOT EXISTS gateway_items (
            id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES gateway_courses(id), data TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS gateway_submissions (
            id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES gateway_courses(id),
            item_id TEXT NOT NULL REFERENCES gateway_items(id), user_id TEXT NOT NULL REFERENCES identities(id),
            data TEXT NOT NULL, UNIQUE(item_id,user_id)
          );
          CREATE TABLE IF NOT EXISTS gateway_requests (
            principal TEXT NOT NULL REFERENCES identities(id), key TEXT NOT NULL, digest TEXT NOT NULL,
            result TEXT NOT NULL, PRIMARY KEY(principal,key)
          );
          CREATE TABLE IF NOT EXISTS gateway_audit (
            sequence INTEGER PRIMARY KEY AUTOINCREMENT, principal TEXT NOT NULL, mutation_id TEXT NOT NULL,
            course_id TEXT NOT NULL, entity_id TEXT NOT NULL, action TEXT NOT NULL, at INTEGER NOT NULL,
            UNIQUE(principal,mutation_id)
          );
          CREATE INDEX IF NOT EXISTS gateway_member ON gateway_enrollments(user_id);
          CREATE INDEX IF NOT EXISTS gateway_course_items ON gateway_items(course_id);
          CREATE INDEX IF NOT EXISTS gateway_course_submissions ON gateway_submissions(course_id);
        `);
        const meta = this.db.prepare('SELECT version,institution FROM gateway_meta').get();
        if (meta) check(meta.version === 1 && meta.institution === JSON.stringify(this.institution), 'gateway_configuration_mismatch');
        else this.db.prepare('INSERT INTO gateway_meta VALUES(1,1,?,?,0,?)').run(JSON.stringify(this.institution), randomUUID(), Date.now());
      });
    } catch (error) { this.db.close(); throw error; }
  }
  close() { this.db.close(); }
  private transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = operation(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  /** All HTTP access enters here; identity is rechecked after reading the body. */
  authorized<T>(auth: AuthStore, token: string, now: number, operation: (user: AuthUser) => T): T {
    return this.transaction(() => {
      const session = auth.session(token, now);
      check(session, 'authentication_required', 401);
      return operation(session.user);
    });
  }
  private changed(now: number) { this.db.prepare('UPDATE gateway_meta SET sequence=sequence+1,changed_at=?').run(now); }
  private audit(principal: string, mutationId: string, courseId: string, entityId: string, action: string, now: number) {
    check(Number(this.db.prepare('SELECT COUNT(*) AS n FROM gateway_audit').get()?.n) < 1_000_000, 'audit_capacity_reached', 503);
    this.db.prepare('INSERT INTO gateway_audit(principal,mutation_id,course_id,entity_id,action,at) VALUES(?,?,?,?,?,?)').run(principal, mutationId, courseId, entityId, action, now);
  }
  provisionCourse(courseId: string, title: string, termStart: number, termEnd: number, now = Date.now()) {
    integer(termStart, 1, 8_640_000_000_000_000); integer(termEnd, 1, 8_640_000_000_000_000);
    check(termEnd > termStart, 'invalid_term');
    const course: Course = { id: id(courseId), title: text(title), timeZone: this.institution.timeZone, status: 'active', presentationMode: 'timeline', gradingWeights: { Assessments: 100 }, termStart, termEnd, announcements: [], visibilityTimer: 0 };
    this.transaction(() => {
      check(!this.db.prepare('SELECT id FROM gateway_courses WHERE id=?').get(course.id), 'course_exists', 409);
      check(Number(this.db.prepare('SELECT COUNT(*) AS n FROM gateway_courses').get()?.n) < 100, 'course_capacity_reached', 503);
      this.db.prepare('INSERT INTO gateway_courses VALUES(?,?)').run(course.id, JSON.stringify(course));
      this.audit('operator', randomUUID(), course.id, course.id, 'course.create', now); this.changed(now);
    });
  }
  enroll(courseId: string, userId: string, role: Role | 'remove', now = Date.now()) {
    id(courseId); id(userId); check(['teacher', 'ta', 'student', 'remove'].includes(role), 'unsupported_role');
    this.transaction(() => {
      check(this.db.prepare('SELECT id FROM gateway_courses WHERE id=?').get(courseId), 'unknown_course', 404);
      const identity = this.db.prepare('SELECT id,name FROM identities WHERE id=?').get(userId);
      check(identity, 'unknown_identity', 404);
      text(identity.name, 500);
      // Schema 1.0 requires historical owners/graders to remain in the roster.
      // Revoke access independently, preserving the evidence needed to read grades.
      if (role === 'remove') this.db.prepare('UPDATE gateway_enrollments SET active=0 WHERE course_id=? AND user_id=?').run(courseId, userId);
      else {
        const existing = this.db.prepare('SELECT role FROM gateway_enrollments WHERE course_id=? AND user_id=?').get(courseId, userId);
        check(existing || Number(this.db.prepare('SELECT COUNT(*) AS n FROM gateway_enrollments').get()?.n) < 1000, 'enrollment_capacity_reached', 503);
        if (role === 'student') check(!this.db.prepare("SELECT id FROM gateway_submissions WHERE course_id=? AND json_extract(data,'$.gradedBy')=? LIMIT 1").get(courseId, userId), 'historical_grader_role_required', 409);
        this.db.prepare('INSERT INTO gateway_enrollments(course_id,user_id,role,active) VALUES(?,?,?,1) ON CONFLICT(course_id,user_id) DO UPDATE SET role=excluded.role,active=1').run(courseId, userId, role);
      }
      this.audit('operator', randomUUID(), courseId, userId, `enrollment.${role}`, now); this.changed(now);
    });
  }
  private role(userId: string, courseId: string): Role {
    const row = this.db.prepare('SELECT role FROM gateway_enrollments WHERE course_id=? AND user_id=? AND active=1').get(courseId, userId);
    check(row, 'course_access_denied', 403);
    return row.role as Role;
  }
  private checkpoint(userId: string) {
    const meta = this.db.prepare('SELECT instance,sequence,changed_at FROM gateway_meta').get()!;
    const cursor = hash(JSON.stringify([meta.instance, meta.sequence, userId]));
    return { cursor, etag: `"${cursor}"`, generatedAt: Number(meta.changed_at) };
  }
  snapshot(user: AuthUser) {
    const checkpoint = this.checkpoint(user.id);
    const directory = new Map<string, { id: string; name: string; role: Role }>();
    directory.set(user.id, { id: user.id, name: user.name, role: 'student' });
    const submissions: Submission[] = [];
    const memberships = this.db.prepare('SELECT course_id,role FROM gateway_enrollments WHERE user_id=? AND active=1 ORDER BY course_id').all(user.id);
    const courses = memberships.map(membership => {
      const courseId = String(membership.course_id);
      const staff = membership.role !== 'student';
      const course = JSON.parse(String(this.db.prepare('SELECT data FROM gateway_courses WHERE id=?').get(courseId)!.data)) as Course;
      const enrollments = this.db.prepare('SELECT e.user_id,e.role,e.active,i.name FROM gateway_enrollments e JOIN identities i ON i.id=e.user_id WHERE e.course_id=? ORDER BY e.user_id').all(courseId).map(row => {
        directory.set(String(row.user_id), { id: String(row.user_id), name: String(row.name), role: row.role as Role });
        return { userId: String(row.user_id), courseRole: row.role as Role, ...(row.active === 0 ? { secondaryRoles: ['Access suspended'] } : {}) };
      });
      const items = this.db.prepare('SELECT data FROM gateway_items WHERE course_id=? ORDER BY id').all(courseId).map(row => JSON.parse(String(row.data)) as Assignment);
      const records = staff
        ? this.db.prepare('SELECT data FROM gateway_submissions WHERE course_id=? ORDER BY id').all(courseId)
        : this.db.prepare('SELECT data FROM gateway_submissions WHERE course_id=? AND user_id=? ORDER BY id').all(courseId, user.id);
      for (const record of records) {
        const submission = JSON.parse(String(record.data)) as Submission;
        if (!staff && submission.gradeStatus !== 'released') {
          // Build a learner view explicitly; new grading fields cannot leak by default.
          submissions.push({ id: submission.id, courseId, contentItemId: submission.contentItemId, studentId: submission.studentId, studentName: submission.studentName, status: submission.status === 'graded' ? 'submitted' : submission.status, responses: submission.responses.map(a => ({ questionId: a.questionId, answer: a.answer })), revision: submission.revision, gradeRevision: 0, submittedAt: submission.submittedAt, startedAt: submission.startedAt, updatedAt: submission.updatedAt, attemptNumber: 1 });
        } else submissions.push(submission);
      }
      return { course, enrollments, items };
    });
    // Preserve referential integrity for historical authors whose enrollment ended.
    for (const submission of submissions) for (const userId of [submission.studentId, submission.gradedBy]) {
      if (!userId || directory.has(userId)) continue;
      const row = this.db.prepare('SELECT name FROM identities WHERE id=?').get(userId)!;
      directory.set(userId, { id: userId, name: String(row.name), role: userId === submission.gradedBy ? 'teacher' : 'student' });
    }
    return { schemaVersion: '1.0', mode: 'snapshot', syncId: checkpoint.cursor, ...checkpoint, institution: this.institution,
      integrations: [{ id: 'reference-written-assessments', kind: 'custom-gateway', displayName: 'Reference written-assessment gateway', version: '0.1', capabilities }],
      users: [...directory.values()], courses, submissions, threads: [], messages: [], contentProgress: [] };
  }
  private authorizeMutation(user: AuthUser, mutation: Mutation) {
    const payload = mutation.payload;
    const courseId = id(payload.courseId);
    check(id(payload.id) === mutation.entityId, 'entity_mismatch');
    const role = this.role(user.id, courseId);
    if (mutation.entity === 'content') check(role === 'teacher' || role === 'ta', 'permission_denied', 403);
    else if (role === 'student') check(payload.studentId === user.id, 'permission_denied', 403);
    return role;
  }
  mutate(user: AuthUser, request: Batch, key: string, digest: string, ifMatch: string, now: number): PushResult {
    request.mutations.forEach(mutation => this.authorizeMutation(user, mutation));
    const saved = this.db.prepare('SELECT digest,result FROM gateway_requests WHERE principal=? AND key=?').get(user.id, key);
    if (saved) { check(saved.digest === digest, 'idempotency_key_reused', 409); return JSON.parse(String(saved.result)) as PushResult; }
    const before = this.checkpoint(user.id);
    check(ifMatch === before.etag && (request.cursor === undefined || request.cursor === before.cursor), 'stale_snapshot', 412);
    check(Number(this.db.prepare('SELECT COUNT(*) AS n FROM gateway_requests').get()?.n) < 100_000, 'request_capacity_reached', 503);
    for (const mutation of request.mutations) {
      check(!this.db.prepare('SELECT sequence FROM gateway_audit WHERE principal=? AND mutation_id=?').get(user.id, mutation.id), 'mutation_already_applied', 409);
      const role = this.authorizeMutation(user, mutation);
      if (mutation.entity === 'content') this.createAssignment(mutation, now);
      else this.writeSubmission(user, role, mutation, now);
      this.audit(user.id, mutation.id, String(mutation.payload.courseId), mutation.entityId, `${mutation.entity}.${mutation.operation}`, now);
    }
    this.changed(now);
    const after = this.checkpoint(user.id);
    const result: PushResult = { acceptedIds: request.mutations.map(m => m.id), rejected: [], nextCursor: after.cursor, nextEtag: after.etag };
    this.db.prepare('INSERT INTO gateway_requests VALUES(?,?,?,?)').run(user.id, key, digest, JSON.stringify(result));
    return result;
  }
  private createAssignment(mutation: Mutation, now: number) {
    const item = assignment(mutation.payload, now);
    check(!this.db.prepare('SELECT id FROM gateway_items WHERE id=?').get(item.id), 'content_exists', 409);
    check(Number(this.db.prepare('SELECT COUNT(*) AS n FROM gateway_items WHERE course_id=?').get(item.courseId)?.n) < 100, 'content_capacity_reached', 503);
    this.db.prepare('INSERT INTO gateway_items VALUES(?,?,?)').run(item.id, item.courseId, JSON.stringify(item));
  }
  private writeSubmission(user: AuthUser, role: Role, mutation: Mutation, now: number) {
    const payload = submissionPayload(mutation.payload);
    const courseId = id(payload.courseId), contentItemId = id(payload.contentItemId), studentId = id(payload.studentId);
    const row = this.db.prepare('SELECT data FROM gateway_items WHERE id=? AND course_id=?').get(contentItemId, courseId);
    check(row, 'unknown_assessment', 404);
    const item = JSON.parse(String(row.data)) as Assignment;
    const previous = this.db.prepare('SELECT data FROM gateway_submissions WHERE id=?').get(mutation.entityId);
    const existing = previous ? JSON.parse(String(previous.data)) as Submission : undefined;
    check((mutation.operation === 'create') === !existing, 'submission_conflict', 409);
    check(!existing || (existing.courseId === courseId && existing.contentItemId === contentItemId && existing.studentId === studentId), 'submission_conflict', 409);
    const revision = existing?.revision ?? 0;
    check(integer(payload.expectedRevision, 0, Number.MAX_SAFE_INTEGER) === revision, 'stale_submission', 409);
    if (payload.revision !== undefined) check(payload.revision === revision + 1, 'stale_submission', 409);
    check(payload.attemptNumber === undefined || payload.attemptNumber === 1, 'attempt_limit', 409);
    let result: Submission;
    if (role === 'student') {
      const course = JSON.parse(String(this.db.prepare('SELECT data FROM gateway_courses WHERE id=?').get(courseId)!.data)) as Course;
      check(now >= course.termStart && now <= course.termEnd, 'course_not_in_session', 403);
      check(!existing || existing.status === 'draft', 'submission_locked', 409);
      check(payload.status === 'draft' || payload.status === 'submitted', 'permission_denied', 403);
      for (const field of ['totalScore', 'overallFeedback', 'gradedBy', 'gradedAt', 'gradeRevision', 'gradeStatus']) check(payload[field] === undefined, 'grading_not_allowed', 403);
      if (!existing) check(!this.db.prepare('SELECT id FROM gateway_submissions WHERE item_id=? AND user_id=?').get(contentItemId, user.id), 'attempt_limit', 409);
      const responses = answers(payload.responses, item, false);
      check(payload.status === 'draft' || responses.length === item.questions.length, 'missing_answer');
      result = { id: mutation.entityId, courseId, contentItemId, studentId: user.id, studentName: user.name, status: payload.status, responses, revision: revision + 1, gradeRevision: 0, attemptNumber: 1, startedAt: existing?.startedAt ?? now, submittedAt: now, updatedAt: now };
    } else {
      check(existing && (existing.status === 'submitted' || existing.status === 'graded'), 'submission_not_submitted', 409);
      check(payload.status === 'graded' && (payload.gradeStatus === 'draft' || payload.gradeStatus === 'released'), 'invalid_grade');
      check(integer(payload.expectedGradeRevision, 0, Number.MAX_SAFE_INTEGER) === existing.gradeRevision, 'stale_grade', 409);
      const responses = answers(payload.responses, item, true);
      check(responses.length === item.questions.length && responses.every((answer, index) => answer.questionId === existing.responses[index]?.questionId && answer.answer === existing.responses[index]?.answer), 'answers_are_immutable', 409);
      const totalScore = responses.reduce((total, answer) => total + answer.score!, 0);
      if (payload.totalScore !== undefined) check(payload.totalScore === totalScore, 'invalid_score');
      result = { ...existing, status: 'graded', responses, totalScore, overallFeedback: payload.overallFeedback === undefined ? '' : text(payload.overallFeedback, 10_000, true), gradedBy: user.id, gradedAt: now, updatedAt: now, revision: revision + 1, gradeRevision: existing.gradeRevision + 1, gradeStatus: payload.gradeStatus };
    }
    this.db.prepare('INSERT INTO gateway_submissions VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(result.id, courseId, contentItemId, studentId, JSON.stringify(result));
  }
}
