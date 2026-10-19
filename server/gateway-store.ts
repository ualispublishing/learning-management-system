import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { AuthStore, hash, type AuthUser } from './store.ts';
import { answers, assignment, id, institution, integer, requireCondition as check, submissionPayload, text } from './gateway-validation.ts';
import type { Assignment, Batch, Institution, Mutation, Submission } from './gateway-validation.ts';
import { AI_HISTORY_PAGE_SIZE, MAX_AI_ARTIFACT_BYTES, MAX_AI_RESPONSE_BYTES, MAX_AI_STORAGE_BYTES, type AIJob, type AIJobPolicy } from './ai-policy.ts';
import type { AIRequestHistoryPage } from '../src/lib/ai/types.ts';

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
          CREATE TABLE IF NOT EXISTS gateway_ai_jobs (
            id TEXT PRIMARY KEY, principal TEXT NOT NULL REFERENCES identities(id), key TEXT NOT NULL,
            digest TEXT NOT NULL, course_id TEXT NOT NULL REFERENCES gateway_courses(id), task TEXT NOT NULL,
            state TEXT NOT NULL CHECK(state IN ('processing','succeeded','uncertain')),
            artifact TEXT NOT NULL, source_file BLOB, result TEXT, receipt TEXT, notices TEXT NOT NULL,
            created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, UNIQUE(principal,key)
          );
          CREATE INDEX IF NOT EXISTS gateway_ai_created ON gateway_ai_jobs(created_at);
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
  /** Called inside authorized(), before extraction and again before completion/replay. */
  authorizeAI(user: AuthUser, courseId: string, task: 'syllabus' | 'flashcards'): { title: string } {
    id(courseId);
    const role = this.role(user.id, courseId);
    check(role === 'teacher' || task === 'flashcards' && role === 'ta', 'ai_permission_denied', 403);
    const row = this.db.prepare('SELECT data FROM gateway_courses WHERE id=?').get(courseId);
    check(row, 'course_access_denied', 403);
    return { title: (JSON.parse(String(row.data)) as Course).title };
  }
  /** Startup recovery never retries work whose provider outcome may be unknown. */
  recoverAIRequests() { this.db.prepare("UPDATE gateway_ai_jobs SET state='uncertain' WHERE state='processing'").run(); }
  pruneAI(now: number) { this.db.prepare("DELETE FROM gateway_ai_jobs WHERE expires_at<=? AND state!='processing'").run(now); }
  private aiStorageBytes(): number {
    return Number(this.db.prepare("SELECT COALESCE(SUM(length(CAST(artifact AS BLOB))+COALESCE(length(source_file),0)+COALESCE(length(CAST(result AS BLOB)),0)+COALESCE(length(CAST(receipt AS BLOB)),0)+length(CAST(notices AS BLOB))),0) AS n FROM gateway_ai_jobs").get()?.n);
  }
  reserveAI(user: AuthUser, request: { key: string; digest: string; courseId: string; task: 'syllabus' | 'flashcards'; artifact: string; sourceFile?: Uint8Array; reviewNotices: string[] }, policy: AIJobPolicy, now: number): { jobId: string; replay?: Record<string, unknown> } {
    this.authorizeAI(user, request.courseId, request.task);
    this.pruneAI(now);
    const saved = this.db.prepare('SELECT id,digest,state,result FROM gateway_ai_jobs WHERE principal=? AND key=?').get(user.id, request.key);
    if (saved) {
      check(saved.digest === request.digest, 'idempotency_key_reused', 409);
      check(saved.state !== 'processing', 'ai_request_in_progress', 409);
      check(saved.state === 'succeeded', 'ai_outcome_uncertain', 409);
      return { jobId: String(saved.id), replay: JSON.parse(String(saved.result)) as Record<string, unknown> };
    }
    const bytes = Buffer.byteLength(request.artifact) + (request.sourceFile?.byteLength ?? 0) + Buffer.byteLength(JSON.stringify(request.reviewNotices));
    check(bytes <= MAX_AI_ARTIFACT_BYTES, 'ai_artifact_too_large', 413);
    const processing = Number(this.db.prepare("SELECT COUNT(*) AS n FROM gateway_ai_jobs WHERE state='processing'").get()?.n);
    check(this.aiStorageBytes() + bytes + (processing + 1) * (MAX_AI_RESPONSE_BYTES + 16_384) <= MAX_AI_STORAGE_BYTES, 'ai_storage_capacity_reached', 503);
    check(Number(this.db.prepare('SELECT COUNT(*) AS n FROM gateway_ai_jobs').get()?.n) < 1000, 'ai_storage_capacity_reached', 503);
    check(processing < 2, 'ai_capacity_reached', 429);
    const since = now - 86_400_000;
    check(Number(this.db.prepare('SELECT COUNT(*) AS n FROM gateway_ai_jobs WHERE created_at>?').get(since)?.n) < policy.dailyRequestLimit, 'ai_daily_limit_reached', 429);
    check(Number(this.db.prepare('SELECT COUNT(*) AS n FROM gateway_ai_jobs WHERE principal=? AND created_at>?').get(user.id, since)?.n) < Math.min(20, policy.dailyRequestLimit), 'ai_daily_limit_reached', 429);
    const jobId = randomUUID();
    this.db.prepare("INSERT INTO gateway_ai_jobs VALUES(?,?,?,?,?,?,'processing',?,?,NULL,NULL,?,?,?)").run(jobId, user.id, request.key, request.digest, request.courseId, request.task, request.artifact, request.sourceFile ?? null, JSON.stringify(request.reviewNotices), now, now + policy.retentionHours * 3_600_000);
    return { jobId };
  }
  completeAI(user: AuthUser, jobId: string, result: Record<string, unknown>, receipt: unknown, now: number) {
    const row = this.db.prepare('SELECT course_id,task,state,expires_at FROM gateway_ai_jobs WHERE id=? AND principal=?').get(jobId, user.id);
    check(row && row.state === 'processing' && Number(row.expires_at) > now, 'ai_outcome_uncertain', 409);
    this.authorizeAI(user, String(row.course_id), row.task as 'syllabus' | 'flashcards');
    const serialized = JSON.stringify(result); const receiptText = JSON.stringify(receipt ?? null);
    check(Buffer.byteLength(serialized) <= MAX_AI_RESPONSE_BYTES && Buffer.byteLength(receiptText) <= 16_384, 'ai_result_too_large', 502);
    check(this.aiStorageBytes() + Buffer.byteLength(serialized) + Buffer.byteLength(receiptText) <= MAX_AI_STORAGE_BYTES, 'ai_storage_capacity_reached', 503);
    this.db.prepare("UPDATE gateway_ai_jobs SET state='succeeded',result=?,receipt=? WHERE id=?").run(serialized, receiptText, jobId);
  }
  failAI(jobId: string) { this.db.prepare("UPDATE gateway_ai_jobs SET state='uncertain' WHERE id=? AND state='processing'").run(jobId); }
  listAI(user: AuthUser, courseId: string, task: AIJob['task'], cursor: string | undefined, now: number): AIRequestHistoryPage {
    this.authorizeAI(user, courseId, task);
    const before = cursor ? this.db.prepare('SELECT created_at,id FROM gateway_ai_jobs WHERE id=? AND principal=? AND course_id=? AND task=? AND expires_at>?').get(cursor, user.id, courseId, task, now) : undefined;
    check(!cursor || before, 'ai_history_cursor_expired', 404);
    // Select only summary fields; never load source blobs or results into the history response.
    const rows = this.db.prepare(`SELECT id,key,course_id,task,state,created_at,expires_at,
      json_extract(artifact,'$.input.document.name') AS file_name,
      json_extract(artifact,'$.input.sourceText') IS NOT NULL AS has_text,
      json_extract(artifact,'$.input.locale') AS locale,
      json_extract(artifact,'$.input.requestedCardCount') AS card_count
      FROM gateway_ai_jobs WHERE principal=? AND course_id=? AND task=? AND expires_at>?
      ${before ? 'AND (created_at<? OR (created_at=? AND id<?))' : ''}
      ORDER BY created_at DESC,id DESC LIMIT ?`).all(user.id, courseId, task, now,
        ...(before ? [before.created_at, before.created_at, before.id] : []), AI_HISTORY_PAGE_SIZE + 1);
    const items = rows.slice(0, AI_HISTORY_PAGE_SIZE).map(row => ({ id: String(row.id), requestId: String(row.key), courseId: String(row.course_id),
      task: row.task as AIJob['task'], status: row.state as AIJob['status'], createdAt: Number(row.created_at), expiresAt: Number(row.expires_at),
      fileName: row.file_name === null ? null : String(row.file_name), hasPastedText: Boolean(row.has_text), locale: String(row.locale), requestedCardCount: Number(row.card_count) }));
    return { items, nextCursor: rows.length > AI_HISTORY_PAGE_SIZE ? items.at(-1)!.id : null };
  }
  /** A missing/expired key must never reserve a job or call a provider. */
  recoverAI(user: AuthUser, key: string, digest: string, now: number): AIJob {
    const saved = this.readAI(user, key, now);
    const row = this.db.prepare('SELECT digest FROM gateway_ai_jobs WHERE principal=? AND key=?').get(user.id, key);
    check(row?.digest === digest, 'ai_source_or_settings_mismatch', 409);
    return saved;
  }
  readAI(user: AuthUser, key: string, now: number): AIJob {
    const row = this.db.prepare('SELECT * FROM gateway_ai_jobs WHERE principal=? AND key=? AND expires_at>?').get(user.id, key, now);
    check(row, 'ai_request_not_found', 404);
    this.authorizeAI(user, String(row.course_id), row.task as 'syllabus' | 'flashcards');
    return { id: String(row.id), requestId: String(row.key), courseId: String(row.course_id), task: row.task as AIJob['task'], status: row.state as AIJob['status'],
      ...(row.result ? { result: JSON.parse(String(row.result)) as Record<string, unknown> } : {}),
      reviewNotices: JSON.parse(String(row.notices)) as string[], createdAt: Number(row.created_at), expiresAt: Number(row.expires_at) };
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
