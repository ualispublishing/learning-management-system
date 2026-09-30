import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateInstitutionSync } from '../src/lib/schema/CourseSchema';
import { createInstitutionRepositoryFactory } from '../src/lib/integration/InstitutionRepositoryFactory';
import { PushMutation } from '../src/lib/integration/InstitutionAdapter';
import { ChatMessagePageRequest, LiveSessionRepository, User } from '../src/lib/repositories/interfaces';
import { ChatMessage, ContentItem, PopQuizState, StudentSubmission } from '../src/types/lms';
import {
  configureInstitutionSnapshotCache,
  consumeInstitutionSnapshotWarning,
  restoreInstitutionJSON,
} from '../src/lib/integration/institutionSync';

const redactAssessmentSecrets = (source: any) => {
  source.courses.forEach((entry: any) => entry.items.forEach((item: any) => item.questions?.forEach((question: any) => {
    delete question.correctAnswer;
    if (question.customConfig) delete question.customConfig.testCases;
  }))); 
  source.submissions?.forEach((submission: any) => {
    delete submission.totalScore;
    delete submission.overallFeedback;
    delete submission.gradedBy;
    delete submission.gradedAt;
    delete submission.gradeStatus;
    submission.responses?.forEach((response: any) => {
      delete response.isCorrect;
      delete response.score;
      delete response.teacherFeedback;
      delete response.rubricScores;
    });
  });
  return source;
};

const placeFirstCourseInActiveTerm = (source: any) => {
  source.courses[0].course.termStart = Date.now() - 60_000;
  source.courses[0].course.termEnd = Date.now() + 60_000;
  return source;
};

test('documented institution example remains valid against the runtime schema', async () => {
  const source = await readFile(new URL('../docs/institution-sync.example.json', import.meta.url), 'utf8');
  const result = validateInstitutionSync(JSON.parse(source));
  assert.equal(result.success, true, result.success ? 'Example payload is valid.' : result.issues.map(issue => `${issue.path}: ${issue.message}`).join('\n'));
});

test('cursor upserts merge content instead of replacing an existing institution snapshot', async () => {
  const source = JSON.parse(await readFile(new URL('../docs/institution-sync.example.json', import.meta.url), 'utf8'));
  const upsert = {
    ...source,
    syncId: 'example-upsert-2',
    cursor: 'example-cursor-0002',
    mode: 'upsert',
    threads: undefined,
    messages: undefined,
    submissions: undefined,
    courses: source.courses.map((entry: any) => ({
      ...entry,
      items: [{
        id: 'material-upserted',
        category: 'material',
        title: 'Incremental material',
        contentUrl: 'https://assets.example.edu/chemistry/incremental.pdf',
        presentationSlot: 'future',
        createdAt: '2026-09-07T13:00:00Z',
      }],
    })),
  };
  let pullCount = 0;
  const factory = createInstitutionRepositoryFactory({
    initialSnapshot: source,
    snapshotTtlMs: 0,
    adapter: {
      async pullSnapshot() { pullCount += 1; return upsert; },
      async pushMutations() { return { acceptedIds: [], rejected: [] }; },
    },
    getSessionUser: async () => ({ id: 'teacher-100', name: 'Ada Teacher', email: 'ada.teacher@example.edu', globalRole: 'admin' }),
  });
  const initial = await factory.content.getContentItems('course-chem-101');
  const merged = await factory.content.getContentItems('course-chem-101');
  assert.equal(initial.length, 3);
  assert.equal(merged.length, 4);
  assert.equal(pullCount, 1);
});

test('cursor tombstones remove provider-deleted content instead of retaining stale records', async () => {
  const source = JSON.parse(await readFile(new URL('../docs/institution-sync.example.json', import.meta.url), 'utf8'));
  const upsert = {
    schemaVersion: '1.0',
    syncId: 'example-upsert-delete',
    generatedAt: Date.now(),
    mode: 'upsert',
    institution: source.institution,
    users: [],
    courses: [],
    deletions: { contentItems: ['material-safety'] },
    cursor: 'example-cursor-delete',
  };
  let pullCount = 0;
  const factory = createInstitutionRepositoryFactory({
    initialSnapshot: source,
    snapshotTtlMs: 0,
    adapter: {
      async pullSnapshot() { pullCount += 1; return upsert; },
      async pushMutations() { return { acceptedIds: [], rejected: [] }; },
    },
    getSessionUser: async () => ({ id: 'teacher-100', name: 'Ada Teacher', email: 'ada.teacher@example.edu', globalRole: 'admin' }),
  });
  assert.equal((await factory.content.getContentItems('course-chem-101')).length, 3);
  const refreshed = await factory.content.getContentItems('course-chem-101');
  assert.equal(refreshed.some(item => item.id === 'material-safety'), false);
  assert.equal(refreshed.length, 2);
  assert.equal(pullCount, 1);
});

test('declared provider capabilities fail closed before unsupported writes reach transport', async () => {
  const source = JSON.parse(await readFile(new URL('../docs/institution-sync.example.json', import.meta.url), 'utf8'));
  source.integrations = [{
    id: 'read-only-roster',
    kind: 'oneroster',
    displayName: 'Read-only OneRoster',
    version: '1.2',
    capabilities: ['courses.read', 'roster.read', 'content.read', 'submissions.read', 'grades.read', 'chat.read'],
  }];
  let pushCount = 0;
  const factory = createInstitutionRepositoryFactory({
    initialSnapshot: source,
    adapter: {
      async pullSnapshot() { return source; },
      async pushMutations(mutations) {
        pushCount += 1;
        return { acceptedIds: mutations.map(mutation => mutation.id), rejected: [] };
      },
    },
    getSessionUser: async () => ({ id: 'teacher-100', name: 'Ada Teacher', email: 'ada.teacher@example.edu', globalRole: 'admin' }),
  });
  await assert.rejects(
    () => factory.courses.updateCourse('course-chem-101', { description: 'This write must not leave the client.' }),
    /does not support: courses\.write/,
  );
  assert.equal(pushCount, 0);
});

test('group edits are atomic and recently-deleted content remains restorable', async () => {
  const source = JSON.parse(await readFile(new URL('../docs/institution-sync.example.json', import.meta.url), 'utf8'));
  const batches: PushMutation[][] = [];
  const factory = createInstitutionRepositoryFactory({
    initialSnapshot: source,
    adapter: {
      async pullSnapshot() { return source; },
      async pushMutations(mutations) {
        batches.push(mutations);
        return { acceptedIds: mutations.map(mutation => mutation.id), rejected: [] };
      },
    },
    getSessionUser: async () => ({ id: 'teacher-100', name: 'Ada Teacher', email: 'ada.teacher@example.edu', globalRole: 'admin' }),
  });

  await factory.content.updateContentItems([
    { itemId: 'quiz-stoichiometry', updates: { presentationSlot: 'past', availableDate: undefined } },
    { itemId: 'material-safety', updates: { presentationSlot: 'past', availableDate: undefined } },
  ]);
  assert.equal(batches[0].length, 2);
  assert.ok(batches[0].every(mutation => mutation.operation === 'update' && mutation.payload.availableDate === null));

  await factory.content.deleteContentItem('material-safety', 1234);
  assert.equal(batches[1][0].operation, 'update');
  assert.equal(batches[1][0].payload.deletedAt, 1234);

  await factory.content.restoreContentItem('material-safety');
  assert.equal(batches[2][0].operation, 'update');
  assert.equal(batches[2][0].payload.deletedAt, null);
});

test('assignment-group changes reconcile private group-conversation access atomically', async () => {
  const source = JSON.parse(await readFile(new URL('../docs/institution-sync.example.json', import.meta.url), 'utf8'));
  source.users.push({ id: 'student-201', name: 'Lee Learner', role: 'student' });
  source.courses[0].enrollments.push({ userId: 'student-201', courseRole: 'student' });
  const pushed: PushMutation[] = [];
  const factory = createInstitutionRepositoryFactory({
    initialSnapshot: source,
    adapter: {
      async pullSnapshot() { return source; },
      async pushMutations(mutations) {
        pushed.push(...mutations);
        return { acceptedIds: mutations.map(mutation => mutation.id), rejected: [] };
      },
    },
    getSessionUser: async () => ({ id: 'teacher-100', name: 'Ada Teacher', email: 'ada.teacher@example.edu', globalRole: 'admin' }),
  });

  await factory.courses.updateCourse('course-chem-101', {
    groupSets: [{
      id: 'lab-groups',
      name: 'Laboratory Groups',
      groups: [{ id: 'group-a', name: 'Group A', memberIds: ['student-201'] }],
    }],
  });

  const groupThread = (await factory.chat.getThreads('course-chem-101', 'teacher-100'))
    .find(thread => thread.id === 'thread-group-a');
  assert.deepEqual(groupThread?.participantIds?.sort(), ['student-201', 'teacher-100']);
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].payload.reconcileGroupConversationAccess, true);
});

test('institution chat history forwards bounded search cursors and rejects cross-thread results', async () => {
  const source = JSON.parse(await readFile(new URL('../docs/institution-sync.example.json', import.meta.url), 'utf8'));
  let capturedThreadId = '';
  let capturedRequest: ChatMessagePageRequest | undefined;
  let response: unknown = { messages: [{
    ...source.messages[1],
    id: 'message-page-only',
    replyToMessageId: 'message-parent-not-loaded',
  }], hasMore: true, nextCursor: 'provider-page-2' };
  const factory = createInstitutionRepositoryFactory({
    initialSnapshot: source,
    adapter: {
      async pullSnapshot() { return source; },
      async pushMutations(mutations) { return { acceptedIds: mutations.map(mutation => mutation.id), rejected: [] }; },
      async loadMessagePage(threadId, request) {
        capturedThreadId = threadId;
        capturedRequest = request;
        return response;
      },
    },
    getSessionUser: async () => ({ id: 'teacher-100', name: 'Ada Teacher', email: 'ada.teacher@example.edu', globalRole: 'admin' }),
  });

  const page = await factory.chat.getMessages('thread-direct', 'teacher-100', {
    cursor: 'opaque-provider-cursor', limit: 1, query: 'lab schedule',
  });
  assert.equal(capturedThreadId, 'thread-direct');
  assert.deepEqual(capturedRequest, { cursor: 'opaque-provider-cursor', limit: 1, query: 'lab schedule' });
  assert.equal(page.messages[0].id, 'message-page-only');
  assert.equal(page.messages[0].replyToMessageId, 'message-parent-not-loaded');
  assert.equal(page.messages[0].revision, 1);
  assert.equal(page.nextCursor, 'provider-page-2');

  response = { messages: [source.messages[0]], hasMore: false };
  await assert.rejects(
    () => factory.chat.getMessages('thread-direct', 'teacher-100', { limit: 1 }),
    /different conversation/,
  );
});

test('institution message edits, deletes, and reports use authenticated revision-safe mutations', async () => {
  const source = redactAssessmentSecrets(JSON.parse(await readFile(new URL('../docs/institution-sync.example.json', import.meta.url), 'utf8')));
  const pushed: PushMutation[] = [];
  const factory = createInstitutionRepositoryFactory({
    initialSnapshot: source,
    adapter: {
      async pullSnapshot() { return source; },
      async pushMutations(mutations) {
        pushed.push(...mutations);
        return { acceptedIds: mutations.map(mutation => mutation.id), rejected: [] };
      },
    },
    getSessionUser: async () => ({ id: 'student-200', name: 'Sam Student', globalRole: 'user' }),
  });

  const edited = await factory.chat.editMessage('message-2', 'student-200', 'Could you clarify the updated lab schedule?', 1);
  assert.equal(edited.revision, 2);
  assert.equal(pushed[0].entity, 'message');
  assert.equal(pushed[0].operation, 'update');
  assert.equal(pushed[0].payload.action, 'edit');
  assert.equal(pushed[0].payload.expectedRevision, 1);
  assert.equal((pushed[0].payload.message as ChatMessage).revision, 2);

  await assert.rejects(
    () => factory.chat.editMessage('message-2', 'student-200', 'A stale overwrite', 1),
    /revision conflict: expected revision 2/i,
  );
  assert.equal(pushed.length, 1, 'A stale edit must fail before transport.');

  await factory.chat.reportMessage('message-1', 'student-200', 'This announcement needs a moderation review.');
  assert.equal(pushed[1].payload.action, 'report');
  assert.equal(pushed[1].payload.reporterId, 'student-200');

  const deleted = await factory.chat.deleteMessage('message-2', 'student-200', 2);
  assert.equal(deleted.revision, 3);
  assert.ok(deleted.deletedAt);
  assert.equal(deleted.text, '');
  assert.equal(deleted.mediaUrl, undefined);
  assert.equal(deleted.mediaName, undefined);
  assert.equal(deleted.mentionedUserIds, undefined);
  assert.deepEqual({
    action: pushed[2].payload.action,
    expectedRevision: pushed[2].payload.expectedRevision,
    revision: pushed[2].payload.revision,
  }, { action: 'delete', expectedRevision: 2, revision: 3 });
});

test('failed institution chat edits and deletes leave local revisions retryable', async () => {
  const source = redactAssessmentSecrets(JSON.parse(await readFile(new URL('../docs/institution-sync.example.json', import.meta.url), 'utf8')));
  let failNext = true;
  const factory = createInstitutionRepositoryFactory({
    initialSnapshot: source,
    adapter: {
      async pullSnapshot() { return source; },
      async pushMutations(mutations) {
        if (failNext) {
          failNext = false;
          throw new Error('Temporary mutation outage.');
        }
        return { acceptedIds: mutations.map(mutation => mutation.id), rejected: [] };
      },
    },
    getSessionUser: async () => ({ id: 'student-200', name: 'Sam Student', globalRole: 'user' }),
  });

  await assert.rejects(() => factory.chat.editMessage('message-2', 'student-200', '@Ada Teacher, retry this edit.', 1, ['teacher-100']), /mutation outage/i);
  let current = (await factory.chat.getMessages('thread-direct', 'student-200')).messages.find(message => message.id === 'message-2')!;
  assert.equal(current.revision, 1);
  assert.notEqual(current.text, '@Ada Teacher, retry this edit.');
  const edited = await factory.chat.editMessage('message-2', 'student-200', '@Ada Teacher, retry this edit.', 1, ['teacher-100']);
  assert.equal(edited.revision, 2);

  failNext = true;
  await assert.rejects(() => factory.chat.deleteMessage('message-2', 'student-200', 2), /mutation outage/i);
  current = (await factory.chat.getMessages('thread-direct', 'student-200')).messages.find(message => message.id === 'message-2')!;
  assert.equal(current.revision, 2);
  assert.equal(current.deletedAt, undefined);
  const deleted = await factory.chat.deleteMessage('message-2', 'student-200', 2);
  assert.equal(deleted.revision, 3);
  assert.ok(deleted.deletedAt);
});

test('institution course staff can moderate a learner group message without impersonating its sender', async () => {
  const source = JSON.parse(await readFile(new URL('../docs/institution-sync.example.json', import.meta.url), 'utf8'));
  source.messages.push({
    id: 'message-group-learner', revision: 1, threadId: 'thread-group-a', senderId: 'student-200',
    senderName: 'Sam Student', role: 'student', text: 'Group message requiring removal.',
    timestamp: '2026-09-02T14:00:00Z', readBy: 1, readByUserIds: ['student-200'],
  });
  let pushed: PushMutation | undefined;
  const factory = createInstitutionRepositoryFactory({
    initialSnapshot: source,
    adapter: {
      async pullSnapshot() { return source; },
      async pushMutations(mutations) {
        pushed = mutations[0];
        return { acceptedIds: mutations.map(mutation => mutation.id), rejected: [] };
      },
    },
    getSessionUser: async () => ({ id: 'teacher-100', name: 'Ada Teacher', globalRole: 'admin' }),
  });

  const deleted = await factory.chat.deleteMessage('message-group-learner', 'teacher-100', 1);
  assert.equal(deleted.senderId, 'student-200');
  assert.equal(deleted.revision, 2);
  assert.equal(pushed?.payload.action, 'delete');
  assert.equal(pushed?.payload.expectedRevision, 1);
});

test('mutation acknowledgements reject unknown and contradictory ids', async () => {
  const source = JSON.parse(await readFile(new URL('../docs/institution-sync.example.json', import.meta.url), 'utf8'));
  const factory = createInstitutionRepositoryFactory({
    initialSnapshot: source,
    adapter: {
      async pullSnapshot() { return source; },
      async pushMutations(mutations) {
        return { acceptedIds: [mutations[0].id, 'unknown-mutation'], rejected: [] };
      },
    },
    getSessionUser: async () => ({ id: 'teacher-100', name: 'Ada Teacher', email: 'ada.teacher@example.edu', globalRole: 'admin' }),
  });
  const titleBeforeMutation = (await factory.courses.getCourseDetails('course-chem-101'))?.title;
  await assert.rejects(
    () => factory.courses.updateCourse('course-chem-101', { title: 'Should not commit' }),
    /malformed or contradictory acknowledgement/,
  );
  assert.equal((await factory.courses.getCourseDetails('course-chem-101'))?.title, titleBeforeMutation);
});

test('institution repository advances snapshot ETags across serialized mutations', async () => {
  const source = JSON.parse(await readFile(new URL('../docs/institution-sync.example.json', import.meta.url), 'utf8'));
  source.etag = '"snapshot-1"';
  const receivedEtags: (string | undefined)[] = [];
  let revision = 1;
  const factory = createInstitutionRepositoryFactory({
    initialSnapshot: source,
    adapter: {
      async pullSnapshot() { return source; },
      async pushMutations(mutations, cursor) {
        receivedEtags.push(cursor?.etag);
        revision += 1;
        Object.assign(source.courses[0].course, mutations[0].payload);
        source.etag = `"snapshot-${revision}"`;
        return {
          acceptedIds: mutations.map(mutation => mutation.id),
          rejected: [],
          nextEtag: `"snapshot-${revision}"`,
        };
      },
    },
    getSessionUser: async () => ({ id: 'teacher-100', name: 'Ada Teacher', globalRole: 'admin' }),
  });

  await factory.courses.updateCourse('course-chem-101', { description: 'First ETag mutation.' });
  await factory.courses.updateCourse('course-chem-101', { description: 'Second ETag mutation.' });
  assert.deepEqual(receivedEtags, ['"snapshot-1"', '"snapshot-2"']);
});

test('institution content mutations keep derived course counts synchronized', async () => {
  const source = JSON.parse(await readFile(new URL('../docs/institution-sync.example.json', import.meta.url), 'utf8'));
  const factory = createInstitutionRepositoryFactory({
    initialSnapshot: source,
    adapter: {
      async pullSnapshot() { return source; },
      async pushMutations(mutations) { return { acceptedIds: mutations.map(mutation => mutation.id), rejected: [] }; },
    },
    getSessionUser: async () => ({ id: 'teacher-100', name: 'Ada Teacher', email: 'ada.teacher@example.edu', globalRole: 'admin' }),
  });
  const before = await factory.courses.getCourseDetails('course-chem-101');
  await factory.content.createContentItem({
    id: 'material-count-test',
    courseId: 'course-chem-101',
    category: 'material',
    title: 'Counted material',
    presentationSlot: 'future',
    createdAt: Date.UTC(2026, 8, 9),
  });
  const after = await factory.courses.getCourseDetails('course-chem-101');
  assert.equal(after?.materialsCount, (before?.materialsCount || 0) + 1);
});

test('course and assessment edits cannot orphan existing institution records', async () => {
  const source = JSON.parse(await readFile(new URL('../docs/institution-sync.example.json', import.meta.url), 'utf8'));
  let pushCount = 0;
  const factory = createInstitutionRepositoryFactory({
    initialSnapshot: source,
    adapter: {
      async pullSnapshot() { return source; },
      async pushMutations(mutations) {
        pushCount += 1;
        return { acceptedIds: mutations.map(mutation => mutation.id), rejected: [] };
      },
    },
    getSessionUser: async () => ({ id: 'teacher-100', name: 'Ada Teacher', email: 'ada.teacher@example.edu', globalRole: 'admin' }),
  });
  await assert.rejects(
    () => factory.courses.updateCourse('course-chem-101', { groupSets: [] }),
    /group thread|group set|orphan/i,
  );
  const item = source.courses[0].items.find((candidate: any) => candidate.id === 'quiz-stoichiometry');
  await assert.rejects(
    () => factory.content.updateContentItem(item.id, {
      questions: item.questions.map((question: any) => ({ ...question, id: `${question.id}-replacement` })),
    }),
    /Question .* does not belong|missing.*response/i,
  );
  assert.equal(pushCount, 0, 'Cross-record validation must run before transport.');
});

test('student snapshots fail closed when the gateway includes another learner submission', async () => {
  const source = JSON.parse(await readFile(new URL('../docs/institution-sync.example.json', import.meta.url), 'utf8'));
  redactAssessmentSecrets(source);
  source.users.push({ id: 'student-300', name: 'Other Student', email: 'other.student@example.edu', role: 'student' });
  source.courses[0].enrollments.push({ userId: 'student-300', courseRole: 'student' });
  source.submissions.push({
    ...source.submissions[0],
    id: 'submission-private-to-teacher',
    studentId: 'student-300',
    studentName: 'Other Student',
  });
  const factory = createInstitutionRepositoryFactory({
    initialSnapshot: source,
    adapter: {
      async pullSnapshot() { return source; },
      async pushMutations() { return { acceptedIds: [], rejected: [] }; },
    },
    getSessionUser: async () => ({ id: 'student-200', name: 'Sam Student', email: 'sam.student@example.edu', globalRole: 'user' }),
  });
  await assert.rejects(() => factory.courses.getCoursesForUser('student-200'), /submission-private-to-teacher.*outside the authenticated user's scope/);
});

test('student snapshots fail closed when assessment answer keys are exposed', async () => {
  const source = JSON.parse(await readFile(new URL('../docs/institution-sync.example.json', import.meta.url), 'utf8'));
  const factory = createInstitutionRepositoryFactory({
    initialSnapshot: source,
    adapter: {
      async pullSnapshot() { return source; },
      async pushMutations() { return { acceptedIds: [], rejected: [] }; },
    },
    getSessionUser: async () => ({ id: 'student-200', name: 'Sam Student', email: 'sam.student@example.edu', globalRole: 'user' }),
  });
  await assert.rejects(() => factory.courses.getCoursesForUser('student-200'), /exposed an assessment answer key/);
});

test('student snapshots retain learner-visible study card backs without treating them as assessment keys', async () => {
  const source = redactAssessmentSecrets(JSON.parse(await readFile(new URL('../docs/institution-sync.example.json', import.meta.url), 'utf8')));
  source.courses[0].items.push({
    id: 'study-cards-visible',
    category: 'material',
    title: 'Visible review cards',
    presentationSlot: 'current',
    createdAt: '2026-09-06T13:00:00Z',
    studyCards: [{ id: 'study-card-1', front: 'Question', back: 'Learner-visible answer', reviewerVerified: true }],
  });
  const factory = createInstitutionRepositoryFactory({
    initialSnapshot: source,
    adapter: {
      async pullSnapshot() { return source; },
      async pushMutations() { return { acceptedIds: [], rejected: [] }; },
    },
    getSessionUser: async () => ({ id: 'student-200', name: 'Sam Student', email: 'sam.student@example.edu', globalRole: 'user' }),
  });
  const items = await factory.content.getContentItems('course-chem-101');
  assert.equal(items.find(item => item.id === 'study-cards-visible')?.studyCards?.[0].back, 'Learner-visible answer');
});

test('student repository access rejects staff mutations before transport', async () => {
  const source = redactAssessmentSecrets(JSON.parse(await readFile(new URL('../docs/institution-sync.example.json', import.meta.url), 'utf8')));
  let mutationCalls = 0;
  const factory = createInstitutionRepositoryFactory({
    initialSnapshot: source,
    adapter: {
      async pullSnapshot() { return source; },
      async pushMutations() { mutationCalls += 1; return { acceptedIds: [], rejected: [] }; },
    },
    getSessionUser: async () => ({ id: 'student-200', name: 'Sam Student', email: 'sam.student@example.edu', globalRole: 'user' }),
  });
  await assert.rejects(() => factory.courses.updateCourse('course-chem-101', { title: 'Unauthorized' }), /does not have permission/);
  await assert.rejects(() => factory.content.deleteContentItem('material-safety', Date.now()), /does not have permission/);
  assert.equal(mutationCalls, 0);
});

test('IT course staff can configure the course but cannot mutate instructional content', async () => {
  const source = redactAssessmentSecrets(JSON.parse(await readFile(new URL('../docs/institution-sync.example.json', import.meta.url), 'utf8')));
  source.users[0].role = 'it';
  source.courses[0].enrollments[0].courseRole = 'it';
  source.submissions = [];
  source.threads = [];
  source.messages = [];
  let mutationCalls = 0;
  const factory = createInstitutionRepositoryFactory({
    initialSnapshot: source,
    adapter: {
      async pullSnapshot() { return source; },
      async pushMutations(mutations) {
        mutationCalls += 1;
        return { acceptedIds: mutations.map(mutation => mutation.id), rejected: [] };
      },
    },
    getSessionUser: async () => ({ id: 'teacher-100', name: 'Ada Teacher', email: 'ada.teacher@example.edu', globalRole: 'user' }),
  });

  await factory.courses.updateCourse('course-chem-101', { title: 'Chemistry 101 – configured' });
  await assert.rejects(() => factory.content.deleteContentItem('material-safety', Date.now()), /does not have permission/);
  await assert.rejects(() => factory.submissions.upsertSubmission({
    id: 'it-forged-attempt',
    studentId: 'teacher-100',
    studentName: 'Ada Teacher',
    contentItemId: 'quiz-stoichiometry',
    courseId: 'course-chem-101',
    submittedAt: Date.parse('2026-09-06T14:00:00Z'),
    updatedAt: Date.parse('2026-09-06T14:00:00Z'),
    revision: 1,
    attemptNumber: 1,
    status: 'draft',
    responses: [{ questionId: 'question-1', answer: null }],
  }), /only a student course enrollment/i);
  assert.equal(mutationCalls, 1);
});

test('a global session claim does not bypass explicit course membership', async () => {
  const source = JSON.parse(await readFile(new URL('../docs/institution-sync.example.json', import.meta.url), 'utf8'));
  const factory = createInstitutionRepositoryFactory({
    initialSnapshot: source,
    adapter: {
      async pullSnapshot() { return source; },
      async pushMutations() { return { acceptedIds: [], rejected: [] }; },
    },
    getSessionUser: async () => ({ id: 'global-admin-not-enrolled', name: 'Global Admin', email: 'admin@example.edu', globalRole: 'admin' }),
  });
  await assert.rejects(
    () => factory.courses.getCoursesForUser('global-admin-not-enrolled'),
    /outside the authenticated user's scope/,
  );
});

test('student submission transport strips client-computed grading fields', async () => {
  const source = placeFirstCourseInActiveTerm(redactAssessmentSecrets(JSON.parse(await readFile(new URL('../docs/institution-sync.example.json', import.meta.url), 'utf8'))));
  source.submissions[0].status = 'draft';
  let pushed: PushMutation | undefined;
  const factory = createInstitutionRepositoryFactory({
    initialSnapshot: source,
    adapter: {
      async pullSnapshot() { return source; },
      async pushMutations(mutations) {
        pushed = mutations[0];
        return { acceptedIds: mutations.map(mutation => mutation.id), rejected: [] };
      },
    },
    getSessionUser: async () => ({ id: 'student-200', name: 'Sam Student', email: 'sam.student@example.edu', globalRole: 'user' }),
  });
  await factory.submissions.upsertSubmission({
    ...source.submissions[0],
    updatedAt: Date.parse('2026-09-06T14:00:00Z'),
    revision: 2,
    totalScore: 999,
    gradeStatus: 'draft',
    responses: source.submissions[0].responses.map((response: any) => ({ ...response, score: 999, isCorrect: true, teacherFeedback: 'forged' })),
  });
  assert.ok(pushed);
  assert.equal(pushed?.payload.totalScore, undefined);
  assert.equal(pushed?.payload.gradeStatus, undefined);
  assert.equal((pushed?.payload.responses as Record<string, unknown>[])[0].score, undefined);
  assert.equal((pushed?.payload.responses as Record<string, unknown>[])[0].teacherFeedback, undefined);
  const cached = await factory.submissions.getSubmissionsForCourses(['course-chem-101']);
  const updated = cached.find(submission => submission.id === source.submissions[0].id);
  assert.equal(updated?.totalScore, undefined);
  assert.equal(updated?.responses[0].score, undefined);
  assert.equal(updated?.responses[0].teacherFeedback, undefined);
});

test('learner submission updates enforce exact revisions and immutable submitted attempts', async () => {
  const source = placeFirstCourseInActiveTerm(redactAssessmentSecrets(JSON.parse(await readFile(new URL('../docs/institution-sync.example.json', import.meta.url), 'utf8'))));
  let pushCount = 0;
  const factory = createInstitutionRepositoryFactory({
    initialSnapshot: source,
    adapter: {
      async pullSnapshot() { return source; },
      async pushMutations(mutations) {
        pushCount += 1;
        return { acceptedIds: mutations.map(mutation => mutation.id), rejected: [] };
      },
    },
    getSessionUser: async () => ({ id: 'student-200', name: 'Sam Student', email: 'sam.student@example.edu', globalRole: 'user' }),
  });
  await assert.rejects(() => factory.submissions.upsertSubmission({
    ...source.submissions[0],
    updatedAt: Date.parse('2026-09-06T14:00:00Z'),
    revision: 3,
  }), /expected revision 2/);
  await assert.rejects(() => factory.submissions.upsertSubmission({
    ...source.submissions[0],
    updatedAt: Date.parse('2026-09-06T14:00:00Z'),
    revision: 2,
  }), /Submitted attempts are immutable/);
  assert.equal(pushCount, 0);
});

test('archived courses reject learner attempt writes while preserving staff grading access', async () => {
  const learnerSource = redactAssessmentSecrets(JSON.parse(await readFile(new URL('../docs/institution-sync.example.json', import.meta.url), 'utf8')));
  learnerSource.courses[0].course.status = 'past';
  learnerSource.submissions[0].status = 'draft';
  let learnerPushCount = 0;
  const learnerFactory = createInstitutionRepositoryFactory({
    initialSnapshot: learnerSource,
    adapter: {
      async pullSnapshot() { return learnerSource; },
      async pushMutations(mutations) {
        learnerPushCount += mutations.length;
        return { acceptedIds: mutations.map(mutation => mutation.id), rejected: [] };
      },
    },
    getSessionUser: async () => ({ id: 'student-200', name: 'Sam Student', globalRole: 'user' }),
  });
  await assert.rejects(() => learnerFactory.submissions.upsertSubmission({
    ...learnerSource.submissions[0],
    status: 'submitted',
    updatedAt: Date.parse('2026-09-06T14:00:00Z'),
    revision: 2,
  }), /archived courses are read-only/i);
  assert.equal(learnerPushCount, 0);

  const staffSource = JSON.parse(await readFile(new URL('../docs/institution-sync.example.json', import.meta.url), 'utf8'));
  staffSource.courses[0].course.status = 'past';
  let staffPushCount = 0;
  const staffFactory = createInstitutionRepositoryFactory({
    initialSnapshot: staffSource,
    adapter: {
      async pullSnapshot() { return staffSource; },
      async pushMutations(mutations) {
        staffPushCount += mutations.length;
        return { acceptedIds: mutations.map(mutation => mutation.id), rejected: [] };
      },
    },
    getSessionUser: async () => ({ id: 'teacher-100', name: 'Ada Teacher', globalRole: 'user' }),
  });
  await staffFactory.submissions.upsertSubmission({
    ...staffSource.submissions[0],
    status: 'graded',
    gradedBy: 'teacher-100',
    gradedAt: Date.parse('2026-09-07T14:00:00Z'),
    updatedAt: Date.parse('2026-09-07T14:00:00Z'),
    revision: 2,
    gradeRevision: 1,
  });
  assert.equal(staffPushCount, 1);
});

test('unavailable coursework rejects learner draft and submission writes before transport', async () => {
  const source = placeFirstCourseInActiveTerm(redactAssessmentSecrets(JSON.parse(await readFile(new URL('../docs/institution-sync.example.json', import.meta.url), 'utf8'))));
  source.courses[0].items[0].presentationSlot = 'future';
  source.submissions[0].status = 'draft';
  let pushCount = 0;
  const factory = createInstitutionRepositoryFactory({
    initialSnapshot: source,
    adapter: {
      async pullSnapshot() { return source; },
      async pushMutations(mutations) {
        pushCount += mutations.length;
        return { acceptedIds: mutations.map(mutation => mutation.id), rejected: [] };
      },
    },
    getSessionUser: async () => ({ id: 'student-200', name: 'Sam Student', globalRole: 'user' }),
  });
  await assert.rejects(() => factory.submissions.upsertSubmission({
    ...source.submissions[0],
    updatedAt: Date.parse('2026-09-06T14:00:00Z'),
    revision: 2,
  }), /not currently available/i);
  assert.equal(pushCount, 0);
});

test('grading revisions prevent stale regrades and submission restore sends an explicit field clear', async () => {
  const source = JSON.parse(await readFile(new URL('../docs/institution-sync.example.json', import.meta.url), 'utf8'));
  const pushed: PushMutation[] = [];
  const factory = createInstitutionRepositoryFactory({
    initialSnapshot: source,
    adapter: {
      async pullSnapshot() { return source; },
      async pushMutations(mutations) {
        pushed.push(...mutations);
        return { acceptedIds: mutations.map(mutation => mutation.id), rejected: [] };
      },
    },
    getSessionUser: async () => ({ id: 'teacher-100', name: 'Ada Teacher', email: 'ada.teacher@example.edu', globalRole: 'admin' }),
  });
  await assert.rejects(() => factory.submissions.upsertSubmission({
    ...source.submissions[0],
    responses: source.submissions[0].responses.map((response: any, index: number) => index === 0 ? { ...response, answer: 'tampered by grader' } : response),
    status: 'graded',
    gradedBy: 'teacher-100',
    gradedAt: Date.parse('2026-09-07T14:00:00Z'),
    updatedAt: Date.parse('2026-09-07T14:00:00Z'),
    revision: 2,
    gradeRevision: 1,
  }), /cannot alter learner answers/);
  const graded = await factory.submissions.upsertSubmission({
    ...source.submissions[0],
    status: 'graded',
    overallFeedback: 'Authoritative feedback',
    gradedBy: 'teacher-100',
    gradedAt: Date.parse('2026-09-07T14:00:00Z'),
    updatedAt: Date.parse('2026-09-07T14:00:00Z'),
    revision: 2,
    gradeRevision: 1,
  });
  await assert.rejects(() => factory.submissions.upsertSubmission({
    ...graded,
    overallFeedback: 'Stale overwrite',
    updatedAt: Date.parse('2026-09-08T14:00:00Z'),
    revision: 3,
    gradeRevision: 1,
  }), /expected grade revision 2/);
  assert.equal(pushed.length, 1);

  const discardedSource = structuredClone(source);
  const restoredAt = Date.now();
  discardedSource.submissions[0].status = 'discarded';
  discardedSource.submissions[0].deletedAt = new Date(restoredAt - 60_000).toISOString();
  const restorePushes: PushMutation[] = [];
  const restoreFactory = createInstitutionRepositoryFactory({
    initialSnapshot: discardedSource,
    adapter: {
      async pullSnapshot() { return discardedSource; },
      async pushMutations(mutations) {
        restorePushes.push(...mutations);
        return { acceptedIds: mutations.map(mutation => mutation.id), rejected: [] };
      },
    },
    getSessionUser: async () => ({ id: 'teacher-100', name: 'Ada Teacher', email: 'ada.teacher@example.edu', globalRole: 'admin' }),
  });
  const restored = await restoreFactory.submissions.upsertSubmission({
    ...discardedSource.submissions[0],
    status: 'submitted',
    deletedAt: undefined,
    updatedAt: restoredAt,
    revision: 2,
  });
  assert.equal(restorePushes[0].payload.deletedAt, null);
  assert.equal(restored.deletedAt, undefined);
});

test('institution snapshots are cached only after validation and refreshed after mutations', async () => {
  const source = JSON.parse(await readFile(new URL('../docs/institution-sync.example.json', import.meta.url), 'utf8'));
  source.etag = '"cache-snapshot-1"';
  const saved: unknown[] = [];
  configureInstitutionSnapshotCache({
    async load() { return saved.at(-1) ?? null; },
    async save(_principalId, payload) { saved.push(structuredClone(payload)); },
    async clear() { saved.splice(0); },
  });
  try {
    const factory = createInstitutionRepositoryFactory({
      initialSnapshot: source,
      adapter: {
        async pullSnapshot() { return source; },
        async pushMutations(mutations) {
          Object.assign(source.courses[0].course, mutations[0].payload);
          source.cursor = 'cache-cursor-2';
          source.etag = '"cache-snapshot-2"';
          return { acceptedIds: mutations.map(mutation => mutation.id), rejected: [], nextCursor: source.cursor, nextEtag: source.etag };
        },
      },
      getSessionUser: async () => ({ id: 'teacher-100', name: 'Ada Teacher', email: 'ada.teacher@example.edu', globalRole: 'admin' }),
    });
    await factory.courses.getCoursesForUser('teacher-100');
    assert.equal((saved.at(-1) as any)?.mode, 'snapshot');
    await factory.courses.updateCourse('course-chem-101', { title: 'Cached authoritative title' });
    const restored = await restoreInstitutionJSON('teacher-100');
    assert.equal(restored?.courses[0].course.title, 'Cached authoritative title');
    assert.equal(restored?.cursor, 'cache-cursor-2');
    assert.equal(restored?.etag, '"cache-snapshot-2"');
    assert.equal(saved.length, 2);
  } finally {
    configureInstitutionSnapshotCache(null);
  }
});

test('offline cache I/O failures are visible warnings and never break a successful institution load', async () => {
  const source = JSON.parse(await readFile(new URL('../docs/institution-sync.example.json', import.meta.url), 'utf8'));
  configureInstitutionSnapshotCache({
    async load() { throw new Error('device key unavailable'); },
    async save() { throw new Error('disk full'); },
    async clear() { throw new Error('keychain locked'); },
  });
  try {
    assert.equal(await restoreInstitutionJSON('teacher-100'), null);
    assert.match(consumeInstitutionSnapshotWarning('teacher-100') ?? '', /could not be read/);
    const factory = createInstitutionRepositoryFactory({
      initialSnapshot: source,
      adapter: {
        async pullSnapshot() { return source; },
        async pushMutations() { return { acceptedIds: [], rejected: [] }; },
      },
      getSessionUser: async () => ({ id: 'teacher-100', name: 'Ada Teacher', email: 'ada.teacher@example.edu', globalRole: 'admin' }),
    });
    assert.equal((await factory.courses.getCoursesForUser('teacher-100')).length, 1);
    assert.match(consumeInstitutionSnapshotWarning('teacher-100') ?? '', /could not be updated/);
  } finally {
    configureInstitutionSnapshotCache(null);
  }
});

test('overlapping account loads cannot commit the previous principal snapshot', async () => {
  const teacherSource = JSON.parse(await readFile(new URL('../docs/institution-sync.example.json', import.meta.url), 'utf8'));
  const studentSource = redactAssessmentSecrets(structuredClone(teacherSource));
  let currentUser: User = { id: 'teacher-100', name: 'Ada Teacher', email: 'ada.teacher@example.edu', globalRole: 'admin' };
  let releaseTeacher: () => void = () => undefined;
  const teacherGate = new Promise<void>(resolve => { releaseTeacher = resolve; });
  const factory = createInstitutionRepositoryFactory({
    snapshotTtlMs: 60_000,
    adapter: {
      async pullSnapshot() {
        const requestedPrincipal = currentUser.id;
        if (requestedPrincipal === 'teacher-100') {
          await teacherGate;
          return teacherSource;
        }
        return studentSource;
      },
      async pushMutations() { return { acceptedIds: [], rejected: [] }; },
    },
    getSessionUser: async () => currentUser,
  });
  const staleTeacherLoad = factory.courses.getCoursesForUser('teacher-100');
  await Promise.resolve();
  currentUser = { id: 'student-200', name: 'Sam Student', email: 'sam.student@example.edu', globalRole: 'user' };
  const studentCourses = await factory.courses.getCoursesForUser('student-200');
  assert.equal(studentCourses.length, 1);
  releaseTeacher();
  await assert.rejects(() => staleTeacherLoad, /session changed/);
  const studentItems = await factory.content.getContentItems('course-chem-101');
  assert.equal(studentItems[0].questions?.[0].correctAnswer, undefined);
});

test('an in-flight mutation cannot commit after the authenticated principal changes', async () => {
  const source = JSON.parse(await readFile(new URL('../docs/institution-sync.example.json', import.meta.url), 'utf8'));
  let currentUser: User = { id: 'teacher-100', name: 'Ada Teacher', email: 'ada.teacher@example.edu', globalRole: 'user' };
  let releasePush!: () => void;
  let markPushStarted!: () => void;
  const pushGate = new Promise<void>(resolve => { releasePush = resolve; });
  const pushStarted = new Promise<void>(resolve => { markPushStarted = resolve; });
  const factory = createInstitutionRepositoryFactory({
    initialSnapshot: source,
    adapter: {
      async pullSnapshot() { return source; },
      async pushMutations(mutations) {
        markPushStarted();
        await pushGate;
        return { acceptedIds: mutations.map(mutation => mutation.id), rejected: [] };
      },
    },
    getSessionUser: async () => currentUser,
  });

  const before = await factory.courses.getCourseDetails('course-chem-101');
  const pending = factory.courses.updateCourse('course-chem-101', { description: 'Must not cross accounts' });
  await pushStarted;
  currentUser = { id: 'student-200', name: 'Sam Student', email: 'sam.student@example.edu', globalRole: 'user' };
  releasePush();
  await assert.rejects(() => pending, /session changed while the institution mutation was in progress/i);

  currentUser = { id: 'teacher-100', name: 'Ada Teacher', email: 'ada.teacher@example.edu', globalRole: 'user' };
  const after = await factory.courses.getCourseDetails('course-chem-101');
  assert.equal(after?.description, before?.description);
});

test('cursor upserts may reference entities from the previously validated snapshot', async () => {
  const source = JSON.parse(await readFile(new URL('../docs/institution-sync.example.json', import.meta.url), 'utf8'));
  const upsert = {
    schemaVersion: source.schemaVersion,
    syncId: 'message-only-upsert',
    generatedAt: '2026-09-08T12:00:00Z',
    mode: 'upsert',
    institution: source.institution,
    cursor: 'message-cursor-2',
    messages: [{
      id: 'message-incremental',
      threadId: 'thread-direct',
      senderId: 'student-200',
      senderName: 'Sam Student',
      role: 'student',
      text: 'Incremental message',
      timestamp: '2026-09-08T12:00:00Z',
      readByUserIds: ['student-200'],
    }],
  };
  const factory = createInstitutionRepositoryFactory({
    initialSnapshot: source,
    snapshotTtlMs: 0,
    adapter: {
      async pullSnapshot() { return upsert; },
      async pushMutations() { return { acceptedIds: [], rejected: [] }; },
    },
    getSessionUser: async () => ({ id: 'teacher-100', name: 'Ada Teacher', email: 'ada.teacher@example.edu', globalRole: 'user' }),
  });
  await factory.chat.getMessages('thread-direct', 'teacher-100');
  const merged = await factory.chat.getMessages('thread-direct', 'teacher-100');
  assert.ok(merged.messages.some(message => message.id === 'message-incremental'));
});

test('student directory projection exposes only valid contacts and never their private roster fields', async () => {
  const source = redactAssessmentSecrets(JSON.parse(await readFile(new URL('../docs/institution-sync.example.json', import.meta.url), 'utf8')));
  source.users.push(
    { id: 'course-peer-1', name: 'Course Peer', email: 'course.peer@example.edu', role: 'student', metadata: { campus: 'private' } },
    { id: 'direct-peer-1', name: 'Direct Peer', email: 'direct.peer@example.edu', role: 'student', secondaryRoles: ['Private cohort'] },
    { id: 'directory-only-1', name: 'Unreferenced Tenant User', email: 'directory.only@example.edu', role: 'student' },
  );
  source.courses[0].enrollments.push({ userId: 'course-peer-1', courseRole: 'student', secondaryRoles: ['Section 99'] });
  source.threads.push({
    id: 'thread-direct-peer',
    title: 'Sam and Direct Peer',
    scope: 'direct',
    participantIds: ['student-200', 'direct-peer-1'],
    createdBy: 'student-200',
    createdAt: '2026-09-03T12:00:00Z',
  });
  let cachedSnapshot: any = null;
  configureInstitutionSnapshotCache({
    async load() { return null; },
    async save(_principalId, payload) { cachedSnapshot = structuredClone(payload); },
    async clear() {},
  });
  const factory = createInstitutionRepositoryFactory({
    initialSnapshot: source,
    adapter: {
      async pullSnapshot() { return source; },
      async pushMutations() { return { acceptedIds: [], rejected: [] }; },
    },
    getSessionUser: async () => ({ id: 'student-200', name: 'Sam Student', email: 'sam.student@example.edu', globalRole: 'user' }),
  });
  try {
    const courses = await factory.courses.getCoursesForUser('student-200');
    const courseDetails = await factory.courses.getCourseDetails('course-chem-101');
    const users = await factory.chat.getDirectoryUsers('student-200');
    assert.deepEqual(new Set(users.map(user => user.id)), new Set(['teacher-100', 'student-200', 'course-peer-1', 'direct-peer-1']));
    assert.ok(users.every(user => user.email === undefined && user.metadata === undefined && user.secondaryRoles === undefined));
    assert.ok(courses[0].staff.every(user => user.email === undefined && user.metadata === undefined && user.secondaryRoles === undefined));
    assert.ok(courseDetails?.staff.every(user => user.email === undefined && user.metadata === undefined && user.secondaryRoles === undefined));
    assert.ok(!cachedSnapshot.users.some((user: any) => user.id === 'directory-only-1'));
    assert.ok(cachedSnapshot.users.every((user: any) => user.email === undefined && user.metadata === undefined && !user.secondaryRoles?.length));
    assert.ok(cachedSnapshot.courses[0].course.staff.every((user: any) => user.email === undefined && user.metadata === undefined && !user.secondaryRoles?.length));
    await assert.rejects(() => factory.chat.getDirectoryUsers('teacher-100'), /authenticated session/);
  } finally {
    configureInstitutionSnapshotCache(null);
  }
});

test('authorized staff retain private course-roster details while chat discovery stays minimal', async () => {
  const source = JSON.parse(await readFile(new URL('../docs/institution-sync.example.json', import.meta.url), 'utf8'));
  source.users.push(
    { id: 'staff-visible-peer', name: 'Staff Visible Peer', email: 'staff.visible@example.edu', role: 'student', metadata: { accommodation: 'restricted' } },
    { id: 'staff-unreferenced-user', name: 'Unreferenced Directory User', email: 'unreferenced@example.edu', role: 'student' },
  );
  source.courses[0].enrollments.push({ userId: 'staff-visible-peer', courseRole: 'student', secondaryRoles: ['Section 10'] });
  const factory = createInstitutionRepositoryFactory({
    initialSnapshot: source,
    adapter: {
      async pullSnapshot() { return source; },
      async pushMutations() { return { acceptedIds: [], rejected: [] }; },
    },
    getSessionUser: async () => ({ id: 'teacher-100', name: 'Ada Teacher', email: 'ada.teacher@example.edu', globalRole: 'user' }),
  });

  const courses = await factory.courses.getCoursesForUser('teacher-100');
  const rosterPeer = courses[0].staff.find(user => user.id === 'staff-visible-peer');
  assert.equal(rosterPeer?.email, 'staff.visible@example.edu');
  assert.deepEqual(rosterPeer?.secondaryRoles, ['Section 10']);
  assert.equal(rosterPeer?.metadata, undefined);

  const directory = await factory.chat.getDirectoryUsers('teacher-100');
  assert.ok(directory.some(user => user.id === 'staff-visible-peer'));
  assert.ok(!directory.some(user => user.id === 'staff-unreferenced-user'));
  assert.ok(directory.every(user => user.email === undefined && user.metadata === undefined && user.secondaryRoles === undefined));
});

test('course enrollment uses a stable directory ID when email is not disclosed', async () => {
  const source = JSON.parse(await readFile(new URL('../docs/institution-sync.example.json', import.meta.url), 'utf8'));
  let sentMutations: PushMutation[] = [];
  let lookupIdentifier = '';
  const factory = createInstitutionRepositoryFactory({
    initialSnapshot: source,
    async lookupDirectoryUser(identifier) {
      lookupIdentifier = identifier;
      return { id: 'student-private-email', name: 'Private Directory Student', role: 'student' };
    },
    adapter: {
      async pullSnapshot() { return source; },
      async pushMutations(mutations) {
        sentMutations = mutations;
        return { acceptedIds: mutations.map(mutation => mutation.id), rejected: [] };
      },
    },
    getSessionUser: async () => ({ id: 'teacher-100', name: 'Ada Teacher', email: 'ada.teacher@example.edu', globalRole: 'user' }),
  });

  const enrolled = await factory.courses.addStudentByIdentifier('course-chem-101', 'student-private-email');
  assert.equal(lookupIdentifier, 'student-private-email');
  assert.equal(enrolled.id, 'student-private-email');
  assert.equal(enrolled.email, undefined);
  assert.equal(sentMutations.length, 1);
  assert.equal(sentMutations[0].payload.userId, 'student-private-email');
  assert.equal(Object.prototype.hasOwnProperty.call(sentMutations[0].payload, 'email'), false);
  await assert.rejects(
    () => factory.courses.addStudentByIdentifier('course-chem-101', 'different-user'),
    /invalid or mismatched user record/,
  );
  assert.equal(sentMutations.length, 1, 'A mismatched directory lookup must fail before transport.');
});

test('course role updates preserve a final authenticated course manager', async () => {
  const source = JSON.parse(await readFile(new URL('../docs/institution-sync.example.json', import.meta.url), 'utf8'));
  source.users.push({ id: 'role-target-300', name: 'Role Target', role: 'student' });
  source.courses[0].enrollments.push({ userId: 'role-target-300', courseRole: 'student' });
  let pushCount = 0;
  const factory = createInstitutionRepositoryFactory({
    initialSnapshot: source,
    adapter: {
      async pullSnapshot() { return source; },
      async pushMutations(mutations) {
        pushCount += 1;
        return { acceptedIds: mutations.map(mutation => mutation.id), rejected: [] };
      },
    },
    getSessionUser: async () => ({ id: 'teacher-100', name: 'Ada Teacher', email: 'ada.teacher@example.edu', globalRole: 'user' }),
  });

  await assert.rejects(
    () => factory.courses.updateCourseUser('course-chem-101', 'teacher-100', { role: 'student' }),
    /only course manager/i,
  );
  assert.equal(pushCount, 0);

  await assert.rejects(
    () => factory.courses.updateCourseUser('course-chem-101', 'role-target-300', { role: 'it' }),
    /cannot grant that participant role/i,
  );
  await assert.rejects(
    () => factory.courses.updateCourseUser('course-chem-101', 'role-target-300', { role: 'admin' }),
    /cannot grant that participant role/i,
  );
  assert.equal(pushCount, 0);

  await factory.courses.updateCourseUser('course-chem-101', 'role-target-300', { role: 'ta' });
  assert.equal(pushCount, 1);
  const course = await factory.courses.getCourseDetails('course-chem-101');
  assert.equal(course?.staff.find(member => member.id === 'role-target-300')?.role, 'ta');
});

test('course managers cannot alter participant roles above their grant authority', async () => {
  const source = JSON.parse(await readFile(new URL('../docs/institution-sync.example.json', import.meta.url), 'utf8'));
  source.users.push({ id: 'it-target-301', name: 'IT Target', role: 'it' });
  source.users.push({ id: 'admin-target-302', name: 'Admin Target', role: 'admin' });
  source.courses[0].enrollments.push({ userId: 'it-target-301', courseRole: 'it' });
  source.courses[0].enrollments.push({ userId: 'admin-target-302', courseRole: 'admin' });
  let pushCount = 0;
  const factory = createInstitutionRepositoryFactory({
    initialSnapshot: source,
    adapter: {
      async pullSnapshot() { return source; },
      async pushMutations(mutations) {
        pushCount += 1;
        return { acceptedIds: mutations.map(mutation => mutation.id), rejected: [] };
      },
    },
    getSessionUser: async () => ({ id: 'teacher-100', name: 'Ada Teacher', email: 'ada.teacher@example.edu', globalRole: 'user' }),
  });

  await assert.rejects(
    () => factory.courses.updateCourseUser('course-chem-101', 'it-target-301', { role: 'student' }),
    /cannot grant that participant role/i,
  );
  await assert.rejects(
    () => factory.courses.updateCourseUser('course-chem-101', 'admin-target-302', { role: 'student' }),
    /cannot grant that participant role/i,
  );
  assert.equal(pushCount, 0);
});

test('participant promotion preserves historical work and removes active student group assignments', async () => {
  const source = JSON.parse(await readFile(new URL('../docs/institution-sync.example.json', import.meta.url), 'utf8'));
  let pushed: PushMutation | undefined;
  const factory = createInstitutionRepositoryFactory({
    initialSnapshot: source,
    adapter: {
      async pullSnapshot() { return source; },
      async pushMutations(mutations) {
        pushed = mutations[0];
        return { acceptedIds: mutations.map(mutation => mutation.id), rejected: [] };
      },
    },
    getSessionUser: async () => ({ id: 'teacher-100', name: 'Ada Teacher', globalRole: 'user' }),
  });

  await factory.courses.updateCourseUser('course-chem-101', 'student-200', { role: 'ta' });
  const course = await factory.courses.getCourseDetails('course-chem-101');
  const submissions = await factory.submissions.getSubmissionsForCourses(['course-chem-101']);
  assert.equal(course?.staff.find(member => member.id === 'student-200')?.role, 'ta');
  assert.equal(course?.groupSets?.flatMap(groupSet => groupSet.groups).some(group => group.memberIds.includes('student-200')), false);
  assert.equal(submissions.some(submission => submission.studentId === 'student-200'), true);
  assert.equal(pushed?.payload.removeFromAssignmentGroups, true);
  assert.equal(pushed?.payload.reconcileGroupConversationAccess, true);
});

test('institution live sessions enforce host role, participant identity, state integrity, and deadlines', async () => {
  const source = placeFirstCourseInActiveTerm(redactAssessmentSecrets(JSON.parse(await readFile(new URL('../docs/institution-sync.example.json', import.meta.url), 'utf8'))));
  source.courses[0].items.find((item: ContentItem) => item.id === 'quiz-stoichiometry').isPopQuiz = true;
  const openedAt = Date.now();
  let state: PopQuizState | null = {
    courseworkId: 'quiz-stoichiometry',
    sessionId: 'live-contract-1',
    startedAt: openedAt,
    revision: 1,
    status: 'active',
    currentQuestionId: 'question-1',
    questionOpenedAt: openedAt,
    questionClosesAt: openedAt + 60_000,
    completedQuestionIds: [],
    answers: {},
  };
  let submittedStudent = '';
  const liveSessions: LiveSessionRepository = {
    async getSession() { return state; },
    async publishSession(_courseworkId, nextState) { state = nextState; },
    async submitAnswer(_courseworkId, studentId) { submittedStudent = studentId; },
    async finalizeSession() { state = null; return []; },
    subscribeToSession(_courseworkId, onState) { onState(state); return () => undefined; },
  };
  const adapter = {
    async pullSnapshot() { return source; },
    async pushMutations(mutations: PushMutation[]) { return { acceptedIds: mutations.map(mutation => mutation.id), rejected: [] }; },
  };
  const studentFactory = createInstitutionRepositoryFactory({
    initialSnapshot: source,
    adapter,
    liveSessions,
    getSessionUser: async () => ({ id: 'student-200', name: 'Sam Student', email: 'sam.student@example.edu', globalRole: 'user' }),
  });
  await assert.rejects(() => studentFactory.liveSessions.publishSession('quiz-stoichiometry', state!), /does not have permission/);
  await assert.rejects(() => studentFactory.liveSessions.submitAnswer('quiz-stoichiometry', 'teacher-100', 'question-1', '2'), /identity does not match/);
  await studentFactory.liveSessions.submitAnswer('quiz-stoichiometry', 'student-200', 'question-1', '2');
  assert.equal(submittedStudent, 'student-200');

  state = { ...state, startedAt: Date.now() - 60_000, questionOpenedAt: Date.now() - 60_000, questionClosesAt: Date.now() - 1 };
  await assert.rejects(() => studentFactory.liveSessions.submitAnswer('quiz-stoichiometry', 'student-200', 'question-1', '2'), /timer has expired/);

  const teacherFactory = createInstitutionRepositoryFactory({
    initialSnapshot: source,
    adapter,
    liveSessions,
    getSessionUser: async () => ({ id: 'teacher-100', name: 'Ada Teacher', email: 'ada.teacher@example.edu', globalRole: 'user' }),
  });
  state = null;
  const waiting: PopQuizState = {
    courseworkId: 'quiz-stoichiometry', sessionId: 'live-contract-2', startedAt: Date.now(), revision: 1, status: 'waiting', currentQuestionId: 'question-1',
    questionOpenedAt: null, questionClosesAt: null, completedQuestionIds: ['question-1'], answers: {},
  };
  await teacherFactory.liveSessions.publishSession('quiz-stoichiometry', waiting);
  assert.equal((await liveSessions.getSession('quiz-stoichiometry'))?.status, 'waiting');
  assert.deepEqual(await teacherFactory.liveSessions.finalizeSession?.('quiz-stoichiometry', waiting.sessionId), []);
  assert.equal(state, null);
  await teacherFactory.courses.updateCourse('course-chem-101', { status: 'past' });
  await assert.rejects(
    () => teacherFactory.liveSessions.publishSession('quiz-stoichiometry', { ...waiting, sessionId: 'live-archived', startedAt: Date.now() }),
    /archived courses cannot start/i,
  );
});

test('learner live-session reads never expose peer answers and subscriptions stop on account change', async () => {
  const source = placeFirstCourseInActiveTerm(redactAssessmentSecrets(JSON.parse(await readFile(new URL('../docs/institution-sync.example.json', import.meta.url), 'utf8'))));
  source.courses[0].items.find((item: ContentItem) => item.id === 'quiz-stoichiometry').isPopQuiz = true;
  source.users.push({ id: 'student-201', name: 'Peer Student', role: 'student' });
  source.courses[0].enrollments.push({ userId: 'student-201', courseRole: 'student' });
  const openedAt = Date.now();
  const state: PopQuizState = {
    courseworkId: 'quiz-stoichiometry',
    sessionId: 'live-private-answers',
    startedAt: openedAt,
    revision: 2,
    status: 'active',
    currentQuestionId: 'question-1',
    questionOpenedAt: openedAt,
    questionClosesAt: openedAt + 60_000,
    completedQuestionIds: [],
    answers: {
      'student-200': { 'question-1': '2' },
      'student-201': { 'question-1': '4' },
    },
  };
  let sessionUser = { id: 'student-200', name: 'Sam Student', globalRole: 'user' as const };
  let emit: ((next: PopQuizState | null) => void) | undefined;
  let upstreamUnsubscribeCalls = 0;
  const liveSessions: LiveSessionRepository = {
    async getSession() { return state; },
    async publishSession() { throw new Error('Not used.'); },
    async submitAnswer() { return undefined; },
    async finalizeSession() { return []; },
    subscribeToSession(_courseworkId, onState) {
      emit = onState;
      onState(state);
      return () => { upstreamUnsubscribeCalls += 1; };
    },
  };
  const factory = createInstitutionRepositoryFactory({
    initialSnapshot: source,
    adapter: {
      async pullSnapshot() { return source; },
      async pushMutations(mutations: PushMutation[]) { return { acceptedIds: mutations.map(mutation => mutation.id), rejected: [] }; },
    },
    liveSessions,
    getSessionUser: async () => sessionUser,
  });

  const learnerView = await factory.liveSessions.getSession('quiz-stoichiometry');
  assert.deepEqual(learnerView?.answers, { 'student-200': { 'question-1': '2' } });

  let resolveFirstState: (value: PopQuizState | null) => void = () => undefined;
  let resolveSubscriptionError: (value: Error) => void = () => undefined;
  const firstState = new Promise<PopQuizState | null>(resolve => { resolveFirstState = resolve; });
  const subscriptionError = new Promise<Error>(resolve => { resolveSubscriptionError = resolve; });
  const stop = factory.liveSessions.subscribeToSession(
    'quiz-stoichiometry',
    resolveFirstState,
    resolveSubscriptionError,
  );
  assert.deepEqual((await firstState)?.answers, { 'student-200': { 'question-1': '2' } });

  sessionUser = { id: 'teacher-100', name: 'Ada Teacher', globalRole: 'user' };
  emit?.(state);
  assert.match((await subscriptionError).message, /session changed/i);
  assert.equal(upstreamUnsubscribeCalls, 1);
  stop();
  assert.equal(upstreamUnsubscribeCalls, 1, 'a failed subscription is torn down exactly once');

  const teacherView = await factory.liveSessions.getSession('quiz-stoichiometry');
  assert.deepEqual(teacherView?.answers, state.answers, 'authorized live hosts retain aggregate answer access');
});

test('institution live hosting refuses adapters without atomic durable finalization', async () => {
  const source = redactAssessmentSecrets(JSON.parse(await readFile(new URL('../docs/institution-sync.example.json', import.meta.url), 'utf8')));
  source.courses[0].items.find((item: ContentItem) => item.id === 'quiz-stoichiometry').isPopQuiz = true;
  const startedAt = Date.now();
  const state: PopQuizState = {
    courseworkId: 'quiz-stoichiometry', sessionId: 'live-missing-finalizer', startedAt, revision: 1, status: 'waiting',
    currentQuestionId: 'question-1', questionOpenedAt: null, questionClosesAt: null, completedQuestionIds: [], answers: {},
  };
  const liveSessions: LiveSessionRepository = {
    async getSession() { return null; },
    async publishSession() { throw new Error('Unsafe transport must never be called.'); },
    async submitAnswer() { throw new Error('Not used.'); },
    subscribeToSession(_courseworkId, onState) { onState(null); return () => undefined; },
  };
  const factory = createInstitutionRepositoryFactory({
    initialSnapshot: source,
    adapter: {
      async pullSnapshot() { return source; },
      async pushMutations() { return { acceptedIds: [], rejected: [] }; },
    },
    liveSessions,
    getSessionUser: async () => ({ id: 'teacher-100', name: 'Ada Teacher', email: 'ada.teacher@example.edu', globalRole: 'user' }),
  });
  await assert.rejects(() => factory.liveSessions.publishSession('quiz-stoichiometry', state), /must implement durable, idempotent finalizeSession/);
});

test('institution live finalization rejects incomplete archives and preserves later grades on retry', async () => {
  const source = redactAssessmentSecrets(JSON.parse(await readFile(new URL('../docs/institution-sync.example.json', import.meta.url), 'utf8')));
  source.courses[0].items.find((item: ContentItem) => item.id === 'quiz-stoichiometry').isPopQuiz = true;
  const startedAt = Date.now();
  const makeState = (sessionId: string): PopQuizState => ({
    courseworkId: 'quiz-stoichiometry', sessionId, startedAt, revision: 1, status: 'active', currentQuestionId: 'question-1',
    questionOpenedAt: startedAt, questionClosesAt: null, completedQuestionIds: [],
    answers: { 'student-200': { 'question-1': '2' } },
  });
  let state: PopQuizState | null = makeState('live-incomplete-archive');
  let archive: StudentSubmission[] = [];
  const liveSessions: LiveSessionRepository = {
    async getSession() { return state; },
    async publishSession(_courseworkId, nextState) { state = nextState; },
    async submitAnswer() { return undefined; },
    async finalizeSession() { const result = structuredClone(archive); state = null; return result; },
    subscribeToSession(_courseworkId, onState) { onState(state); return () => undefined; },
  };
  const adapter = {
    async pullSnapshot() { return source; },
    async pushMutations(mutations: PushMutation[]) {
      return { acceptedIds: mutations.map(mutation => mutation.id), rejected: [] };
    },
  };
  const factory = createInstitutionRepositoryFactory({
    initialSnapshot: source,
    adapter,
    liveSessions,
    getSessionUser: async () => ({ id: 'teacher-100', name: 'Ada Teacher', email: 'ada.teacher@example.edu', globalRole: 'user' }),
  });
  await assert.rejects(
    () => factory.liveSessions.finalizeSession!('quiz-stoichiometry', 'live-incomplete-archive'),
    /exactly one submission for every participant who answered/,
  );

  const sessionId = 'live-idempotent-archive';
  state = makeState(sessionId);
  const submittedAt = Date.now();
  archive = [{
    id: 'live-submission-student-200', liveSessionId: sessionId, studentId: 'student-200', studentName: 'Sam Student',
    contentItemId: 'quiz-stoichiometry', courseId: 'course-chem-101', startedAt, submittedAt, updatedAt: submittedAt,
    revision: 1, attemptNumber: 2, status: 'submitted', responses: [{ questionId: 'question-1', answer: '2' }],
  }];
  const [firstArchive] = await factory.liveSessions.finalizeSession!('quiz-stoichiometry', sessionId);
  assert.equal(firstArchive.status, 'submitted');
  state = null;

  const gradedAt = submittedAt + 1;
  await factory.submissions.upsertSubmission({
    ...firstArchive,
    updatedAt: gradedAt,
    revision: 2,
    status: 'graded',
    responses: [{ questionId: 'question-1', answer: '2', score: 10, isCorrect: true }],
    totalScore: 10,
    gradedBy: 'teacher-100',
    gradedAt,
    gradeRevision: 1,
    gradeStatus: 'draft',
  });
  const [retriedArchive] = await factory.liveSessions.finalizeSession!('quiz-stoichiometry', sessionId);
  assert.equal(retriedArchive.status, 'graded');
  assert.equal(retriedArchive.revision, 2);
  assert.equal(retriedArchive.totalScore, 10);
});

test('institution realtime chat rejects sender impersonation before store delivery', async () => {
  const source = redactAssessmentSecrets(JSON.parse(await readFile(new URL('../docs/institution-sync.example.json', import.meta.url), 'utf8')));
  let emit: ((messages: ChatMessage[]) => void) | undefined;
  const factory = createInstitutionRepositoryFactory({
    initialSnapshot: source,
    adapter: {
      async pullSnapshot() { return source; },
      async pushMutations() { return { acceptedIds: [], rejected: [] }; },
    },
    subscribeToMessages(_threadId, onMessages) { emit = onMessages; return () => undefined; },
    getSessionUser: async () => ({ id: 'student-200', name: 'Sam Student', email: 'sam.student@example.edu', globalRole: 'user' }),
  });
  let delivered = 0;
  const error = new Promise<Error>(resolve => {
    factory.chat.subscribeToMessages('thread-direct', 'student-200', messages => { delivered += messages.length; }, resolve);
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(emit);
  emit?.([{
    id: 'message-impostor', threadId: 'thread-direct', senderId: 'student-200', senderName: 'Not Sam',
    role: 'teacher', text: 'Forged identity', timestamp: Date.parse('2026-09-08T12:00:00Z'), readBy: 1,
    readByUserIds: ['student-200'],
  }]);
  assert.match((await error).message, /senderName|sender role/i);
  assert.equal(delivered, 0);
});

test('institution announcement delivery retries are acknowledgement-safe and idempotent', async () => {
  const source = redactAssessmentSecrets(JSON.parse(await readFile(new URL('../docs/institution-sync.example.json', import.meta.url), 'utf8')));
  source.courses[0].course.termStart = Date.now() - 10_000;
  source.courses[0].course.termEnd = Date.now() + 60_000;
  const announcementThread = source.threads.find((thread: { id: string }) => thread.id === 'thread-announcements');
  assert.ok(announcementThread);
  const firstAnnouncementTimestamp = Math.min(
    ...source.messages
      .filter((message: { threadId: string }) => message.threadId === announcementThread.id)
      .map((message: { timestamp: unknown }) => Date.parse(String(message.timestamp))),
  );
  announcementThread.createdAt = Math.min(Date.now() - 10_000, firstAnnouncementTimestamp - 1);
  delete announcementThread.opensAt;
  delete announcementThread.closesAt;
  let pushCount = 0;
  const factory = createInstitutionRepositoryFactory({
    initialSnapshot: source,
    adapter: {
      async pullSnapshot() { return source; },
      async pushMutations(mutations) {
        pushCount += 1;
        if (pushCount === 1) throw new Error('Temporary chat gateway outage.');
        return { acceptedIds: mutations.map(mutation => mutation.id), rejected: [] };
      },
    },
    getSessionUser: async () => ({ id: 'teacher-100', name: 'Ada Teacher', globalRole: 'user' }),
  });
  const input = {
    threadId: 'thread-announcements', senderId: 'teacher-100', senderName: 'Forged Teacher', role: 'student' as const,
    text: '📢 Safety update\n\nReview the revised checklist.', readBy: 99, readByUserIds: ['student-200'],
    announcementId: 'material-safety', announcementTitle: ' Safety update ', announcementSeverity: 'alert' as const,
    contentItemId: 'material-safety',
  };

  await assert.rejects(() => factory.chat.sendMessage(input), /gateway outage/i);
  assert.equal((await factory.chat.getMessages('thread-announcements', 'teacher-100')).messages.some(message => message.id === 'material-safety'), false);

  const delivered = await factory.chat.sendMessage(input);
  assert.equal(delivered.id, 'material-safety');
  assert.equal(delivered.senderName, 'Ada Teacher');
  assert.equal(delivered.role, 'teacher');
  assert.equal(delivered.readBy, 1);
  assert.deepEqual(delivered.readByUserIds, ['teacher-100']);
  assert.equal(delivered.announcementTitle, 'Safety update');
  const retry = await factory.chat.sendMessage({ ...input, text: 'A retry must not overwrite the acknowledged post.' });
  assert.equal(retry.id, delivered.id);
  assert.equal(retry.text, delivered.text);
  assert.equal(pushCount, 2);

  await assert.rejects(() => factory.chat.sendMessage({
    ...input, announcementId: undefined, contentItemId: undefined,
    text: 'Unsafe file', mediaUrl: 'https://user:secret@files.example.edu/a.pdf', mediaType: 'document', mediaName: 'a.pdf',
  }), /institutional storage/i);
  assert.equal(pushCount, 2);
});

test('manual institution messages keep a stable create id across transport retries', async () => {
  const source = redactAssessmentSecrets(JSON.parse(await readFile(new URL('../docs/institution-sync.example.json', import.meta.url), 'utf8')));
  const fixtureNow = Date.now();
  source.threads.find((thread: any) => thread.id === 'thread-direct').createdAt = fixtureNow - 20_000;
  source.messages.find((message: any) => message.threadId === 'thread-direct').timestamp = fixtureNow - 10_000;
  let pushCount = 0;
  const entityIds: string[] = [];
  const factory = createInstitutionRepositoryFactory({
    initialSnapshot: source,
    adapter: {
      async pullSnapshot() { return source; },
      async pushMutations(mutations) {
        pushCount += 1;
        entityIds.push(...mutations.map(mutation => mutation.entityId));
        if (pushCount === 1) throw new Error('Temporary message outage.');
        return { acceptedIds: mutations.map(mutation => mutation.id), rejected: [] };
      },
    },
    getSessionUser: async () => ({ id: 'student-200', name: 'Sam Student', globalRole: 'user' }),
  });
  const input = {
    threadId: 'thread-direct', senderId: 'student-200', senderName: 'ignored', role: 'student' as const,
    text: 'Stable manual retry', readBy: 99, clientMessageId: 'client-message-stable-retry',
  };
  await assert.rejects(() => factory.chat.sendMessage(input), /message outage/i);
  assert.equal((await factory.chat.getMessages('thread-direct', 'student-200')).messages.some(message => message.id === input.clientMessageId), false);
  const delivered = await factory.chat.sendMessage(input);
  assert.equal(delivered.id, input.clientMessageId);
  assert.equal('clientMessageId' in delivered, false);
  assert.deepEqual(entityIds, [input.clientMessageId, input.clientMessageId]);
  const acknowledgedRetry = await factory.chat.sendMessage({ ...input, text: 'Do not overwrite' });
  assert.equal(acknowledgedRetry.text, delivered.text);
  assert.equal(pushCount, 2);
});

test('institution realtime chat enforces CAS, monotonic receipts, redacted tombstones, and no resurrection', async () => {
  const source = redactAssessmentSecrets(JSON.parse(await readFile(new URL('../docs/institution-sync.example.json', import.meta.url), 'utf8')));
  let emit: ((messages: ChatMessage[]) => void) | undefined;
  const delivered: ChatMessage[] = [];
  const errors: Error[] = [];
  const factory = createInstitutionRepositoryFactory({
    initialSnapshot: source,
    adapter: {
      async pullSnapshot() { return source; },
      async pushMutations(mutations) { return { acceptedIds: mutations.map(mutation => mutation.id), rejected: [] }; },
    },
    subscribeToMessages(_threadId, onMessages) { emit = onMessages; return () => undefined; },
    getSessionUser: async () => ({ id: 'student-200', name: 'Sam Student', globalRole: 'user' }),
  });
  const baseline = (await factory.chat.getMessages('thread-direct', 'student-200')).messages.find(message => message.id === 'message-2')!;
  const stop = factory.chat.subscribeToMessages('thread-direct', 'student-200', messages => delivered.push(...messages), error => errors.push(error));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(emit);
  const emitAndFlush = async (message: ChatMessage) => {
    const deliveredBefore = delivered.length;
    const errorsBefore = errors.length;
    emit?.([message]);
    for (let attempt = 0; attempt < 10 && delivered.length === deliveredBefore && errors.length === errorsBefore; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  };
  try {
    await emitAndFlush({ ...baseline, text: 'Tampered without CAS' });
    assert.match(errors.at(-1)?.message || '', /without advancing its revision/i);
    assert.equal(delivered.length, 0);

    await emitAndFlush({ ...baseline, readBy: 0, readByUserIds: [] });
    assert.match(errors.at(-1)?.message || '', /roll back message read receipts/i);
    assert.equal(delivered.length, 0);

    const edited: ChatMessage = { ...baseline, revision: 2, text: '@Ada Teacher, valid realtime edit', editedAt: baseline.timestamp + 1 };
    await emitAndFlush(edited);
    assert.equal(delivered.at(-1)?.text, '@Ada Teacher, valid realtime edit');

    await emitAndFlush({ ...edited, text: 'Same-revision tamper' });
    assert.match(errors.at(-1)?.message || '', /without advancing its revision/i);

    await emitAndFlush({ ...edited, revision: 3, text: '@Ada Teacher, audit rollback.', editedAt: baseline.timestamp });
    assert.match(errors.at(-1)?.message || '', /roll back a message edit timestamp/i);

    const deleted: ChatMessage = {
      ...edited, revision: 3, text: 'Transport retained deleted content', mediaUrl: 'https://files.example.edu/private.pdf',
      mediaType: 'document', mediaName: 'private.pdf', mentionedUserIds: ['teacher-100'], deletedAt: baseline.timestamp + 2,
    };
    await emitAndFlush(deleted);
    assert.equal(delivered.at(-1)?.deletedAt, deleted.deletedAt);
    assert.equal(delivered.at(-1)?.text, '');
    assert.equal(delivered.at(-1)?.mediaUrl, undefined);
    assert.equal(delivered.at(-1)?.mediaName, undefined);
    assert.equal(delivered.at(-1)?.mentionedUserIds, undefined);

    await emitAndFlush({ ...edited, revision: 4, text: 'Resurrection attempt', editedAt: baseline.timestamp + 3 });
    assert.match(errors.at(-1)?.message || '', /restore a deleted message tombstone/i);

    const incomingTeacherMessage: ChatMessage = {
      id: 'realtime-unread-message', revision: 1, threadId: 'thread-direct', senderId: 'teacher-100',
      senderName: 'Ada Teacher', role: 'teacher', text: 'A new unread message', timestamp: baseline.timestamp + 10_000,
      readBy: 1, readByUserIds: ['teacher-100'],
    };
    await emitAndFlush(incomingTeacherMessage);
    assert.equal(delivered.at(-1)?.id, incomingTeacherMessage.id, errors.at(-1)?.message || 'Realtime message was not delivered.');
    let directSummary = (await factory.chat.getDirectThreads('student-200')).find(thread => thread.id === 'thread-direct')!;
    assert.equal(directSummary.unreadCount, 1);
    assert.equal(directSummary.lastMessagePreview, incomingTeacherMessage.text);
    await factory.chat.markThreadRead('thread-direct', 'student-200');
    directSummary = (await factory.chat.getDirectThreads('student-200')).find(thread => thread.id === 'thread-direct')!;
    assert.equal(directSummary.unreadCount, 0);
  } finally {
    stop();
  }
});

test('content labels and assigned items are renamed in one atomic mutation batch', async () => {
  const source = JSON.parse(await readFile(new URL('../docs/institution-sync.example.json', import.meta.url), 'utf8'));
  const mutationBatches: { entity: string; entityId: string }[][] = [];
  const factory = createInstitutionRepositoryFactory({
    initialSnapshot: source,
    adapter: {
      async pullSnapshot() { return source; },
      async pushMutations(mutations) {
        mutationBatches.push(mutations.map(mutation => ({ entity: mutation.entity, entityId: mutation.entityId })));
        return { acceptedIds: mutations.map(mutation => mutation.id), rejected: [] };
      },
    },
    getSessionUser: async () => ({ id: 'teacher-100', name: 'Ada Teacher', email: 'ada.teacher@example.edu', globalRole: 'user' }),
  });
  await factory.content.updateContentGrouping('course-chem-101', ['Week 1'], [{
    itemId: 'material-safety', updates: { groupIcon: 'Week 1' },
  }]);
  assert.deepEqual(mutationBatches, [[
    { entity: 'course', entityId: 'course-chem-101' },
    { entity: 'content', entityId: 'material-safety' },
  ]]);
  assert.deepEqual((await factory.courses.getCourseDetails('course-chem-101'))?.metadata?.lmsGroupLabels, ['Week 1']);
  assert.equal((await factory.content.getContentItems('course-chem-101')).find(item => item.id === 'material-safety')?.groupIcon, 'Week 1');
  await assert.rejects(
    () => factory.content.updateContentGrouping('course-chem-101', ['group:reserved'], []),
    /reserved/,
  );
  assert.equal(mutationBatches.length, 1);
});

test('external grade batches are cross-record validated before any mutation is sent', async () => {
  const source = JSON.parse(await readFile(new URL('../docs/institution-sync.example.json', import.meta.url), 'utf8'));
  let mutationCalls = 0;
  const factory = createInstitutionRepositoryFactory({
    initialSnapshot: source,
    adapter: {
      async pullSnapshot() { return source; },
      async pushMutations() { mutationCalls += 1; return { acceptedIds: [], rejected: [] }; },
    },
    getSessionUser: async () => ({ id: 'teacher-100', name: 'Ada Teacher', email: 'ada.teacher@example.edu', globalRole: 'user' }),
  });
  const item: ContentItem = {
    id: 'external-invalid', courseId: 'course-chem-101', category: 'coursework', title: 'External invalid',
    presentationSlot: 'past', createdAt: Date.parse('2026-09-08T12:00:00Z'), isGraded: true,
    gradingCategory: 'Assessments', workType: 'individual',
    questions: [{ id: 'criterion-1', label: '1', content: 'Overall grade', answerType: 'text', points: 10 }],
  };
  const submission: StudentSubmission = {
    id: 'external-invalid-submission', studentId: 'teacher-100', studentName: 'Ada Teacher', contentItemId: item.id,
    courseId: item.courseId, submittedAt: Date.parse('2026-09-08T12:00:00Z'), status: 'submitted',
    responses: [{ questionId: 'criterion-1', answer: null, score: 0 }], totalScore: 0,
  };
  await assert.rejects(() => factory.gradebook.createExternalGrade(item, [submission]), /owner must be enrolled as a student/);
  assert.equal(mutationCalls, 0);
});
