import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { COURSE_PERMISSION_ROLES, hasCoursePermission } from '../src/lib/authorization/coursePermissions';
import { isContentLockedAt } from '../src/lib/contentAvailability';
import { createInstitutionRepositoryFactory } from '../src/lib/integration/InstitutionRepositoryFactory';
import { advancePrincipalGeneration } from '../src/lib/store/principalGeneration';
import { createChatSlice, ChatSlice } from '../src/lib/store/slices/chatSlice';
import { createContentSlice, ContentSlice } from '../src/lib/store/slices/contentSlice';
import { createCourseSlice, CourseSlice } from '../src/lib/store/slices/courseSlice';
import { configureRepositoryFactory, repoFactory } from '../src/lib/repositories/factory';
import { DemoContentRepository } from '../src/lib/repositories/sqlite/ContentRepositoryImpl';
import { demoContentItems } from '../src/lib/repositories/memory/demoData';
import { ContentItem, Course, CourseRole, CourseUser } from '../src/types/lms';

const roles: CourseRole[] = ['student', 'ta', 'teacher', 'it', 'admin'];
const presentationModes = ['timeline', 'sequential', 'custom'] as const;
const orientations = ['vertical', 'horizontal'] as const;

const redactLearnerSecrets = (source: any) => {
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

test('role × lifecycle × presentation repository matrix never bypasses content authorization or read-only terms', async () => {
  const serialized = await readFile(new URL('../docs/institution-sync.example.json', import.meta.url), 'utf8');
  const reference = Date.now();
  const lifecycleCases = [
    { name: 'future', status: 'active', termStart: reference + 60_000, termEnd: reference + 120_000, writable: true },
    { name: 'active', status: 'active', termStart: reference - 60_000, termEnd: reference + 60_000, writable: true },
    { name: 'end boundary', status: 'active', termStart: reference - 60_000, termEnd: reference, writable: false },
    { name: 'ended', status: 'active', termStart: reference - 120_000, termEnd: reference - 1, writable: false },
    { name: 'archived', status: 'past', termStart: reference - 60_000, termEnd: reference + 60_000, writable: false },
  ] as const;

  let exercised = 0;
  for (const role of roles) {
    for (const lifecycle of lifecycleCases) {
      for (const presentationMode of presentationModes) {
        const source = redactLearnerSecrets(JSON.parse(serialized));
        const actor = source.users.find((user: any) => user.id === 'teacher-100');
        const enrollment = source.courses[0].enrollments.find((entry: any) => entry.userId === 'teacher-100');
        actor.role = role;
        enrollment.courseRole = role;
        if (!hasCoursePermission(role, 'postStaffChat')) {
          source.threads = source.threads.filter((thread: any) => thread.id !== 'thread-group-a');
          source.messages = source.messages.filter((message: any) => message.threadId !== 'thread-group-a');
        }
        if (!hasCoursePermission(role, 'grade')) source.submissions = [];
        Object.assign(source.courses[0].course, {
          status: lifecycle.status,
          termStart: lifecycle.termStart,
          termEnd: lifecycle.termEnd,
          presentationMode,
        });
        let pushes = 0;
        const factory = createInstitutionRepositoryFactory({
          initialSnapshot: source,
          adapter: {
            async pullSnapshot() { return source; },
            async pushMutations(mutations) {
              pushes += 1;
              return { acceptedIds: mutations.map(mutation => mutation.id), rejected: [] };
            },
          },
          getSessionUser: async () => ({
            id: 'teacher-100',
            name: 'Ada Teacher',
            email: 'ada.teacher@example.edu',
            globalRole: role === 'admin' ? 'admin' : 'user',
          }),
        });
        const expected = lifecycle.writable && hasCoursePermission(role, 'manageContent');
        const update = () => factory.content.updateContentItem('material-safety', {
          title: `${role}-${lifecycle.name}-${presentationMode}`,
        });
        if (expected) await update();
        else await assert.rejects(update, { message: /permission|read-only/i }, `${role}/${lifecycle.name}/${presentationMode}`);
        assert.equal(pushes, expected ? 1 : 0, `${role}/${lifecycle.name}/${presentationMode}`);
        exercised += 1;
      }
    }
  }
  assert.equal(exercised, roles.length * lifecycleCases.length * presentationModes.length);
});

test('availability gates are invariant across every presentation mode and orientation', () => {
  const now = Date.parse('2026-09-01T12:00:00Z');
  const base: ContentItem = {
    id: 'matrix-content', courseId: 'matrix-course', category: 'material', title: 'Matrix content',
    presentationSlot: 'current', createdAt: now - 1,
  };
  const cases: Array<{ name: string; item: ContentItem; locked: boolean }> = [
    { name: 'past remains reviewable', item: { ...base, presentationSlot: 'past' }, locked: false },
    { name: 'current', item: base, locked: false },
    { name: 'manual future', item: { ...base, presentationSlot: 'future' }, locked: true },
    { name: 'scheduled without time', item: { ...base, presentationSlot: 'scheduled' }, locked: true },
    { name: 'scheduled before release', item: { ...base, presentationSlot: 'scheduled', availableDate: '2026-09-01T12:00:00.001Z' }, locked: true },
    { name: 'scheduled at release boundary', item: { ...base, presentationSlot: 'scheduled', availableDate: '2026-09-01T12:00:00.000Z' }, locked: false },
    { name: 'numeric release boundary', item: { ...base, releaseDate: now }, locked: false },
    { name: 'numeric lock boundary', item: { ...base, lockDate: now }, locked: true },
    { name: 'malformed schedule', item: { ...base, presentationSlot: 'scheduled', availableDate: 'not-a-date' }, locked: true },
    { name: 'malformed numeric release', item: { ...base, releaseDate: Number.NaN }, locked: true },
  ];

  let exercised = 0;
  for (const presentationMode of presentationModes) {
    for (const orientation of orientations) {
      for (const entry of cases) {
        assert.equal(
          isContentLockedAt(entry.item, now),
          entry.locked,
          `${presentationMode}/${orientation}/${entry.name}`,
        );
        exercised += 1;
      }
    }
  }
  assert.equal(exercised, presentationModes.length * orientations.length * cases.length);
});

test('future terms allow staff preparation but reject learner attempts and live delivery', async () => {
  const source = redactLearnerSecrets(JSON.parse(await readFile(new URL('../docs/institution-sync.example.json', import.meta.url), 'utf8')));
  source.courses[0].course.termStart = Date.now() + 60_000;
  source.courses[0].course.termEnd = Date.now() + 120_000;
  source.courses[0].items.find((item: ContentItem) => item.id === 'quiz-stoichiometry').isPopQuiz = true;
  source.submissions[0].status = 'draft';
  let pushes = 0;
  const adapter = {
    async pullSnapshot() { return source; },
    async pushMutations(mutations: any[]) {
      pushes += 1;
      return { acceptedIds: mutations.map(mutation => mutation.id), rejected: [] };
    },
  };
  const studentFactory = createInstitutionRepositoryFactory({
    initialSnapshot: source,
    adapter,
    liveSessions: {
      async getSession() { return null; },
      async publishSession() {},
      async submitAnswer() {},
      async finalizeSession() { return []; },
      subscribeToSession() { return () => undefined; },
    },
    getSessionUser: async () => ({ id: 'student-200', name: 'Sam Student', globalRole: 'user' }),
  });
  await assert.rejects(() => studentFactory.submissions.upsertSubmission({
    ...source.submissions[0],
    revision: 2,
    updatedAt: Date.now(),
  }), /active course term/i);

  const teacherFactory = createInstitutionRepositoryFactory({
    initialSnapshot: source,
    adapter,
    liveSessions: {
      async getSession() { return null; },
      async publishSession() {},
      async submitAnswer() {},
      async finalizeSession() { return []; },
      subscribeToSession() { return () => undefined; },
    },
    getSessionUser: async () => ({ id: 'teacher-100', name: 'Ada Teacher', globalRole: 'user' }),
  });
  await teacherFactory.content.updateContentItem('material-safety', { title: 'Prepared before term' });
  await assert.rejects(() => teacherFactory.liveSessions.publishSession('quiz-stoichiometry', {
    courseworkId: 'quiz-stoichiometry', sessionId: 'future-live', startedAt: Date.now(), revision: 1,
    status: 'waiting', currentQuestionId: null, questionOpenedAt: null, questionClosesAt: null,
    completedQuestionIds: [], answers: {},
  }), /active course term/i);
  assert.equal(pushes, 1, 'only the authorized preparation write reaches transport');
});

test('demo content repository rejects ambiguous batches and cross-course identity moves atomically', async () => {
  const repository = new DemoContentRepository();
  const id = `stress-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const item: ContentItem = {
    id, courseId: 'c1', category: 'material', title: 'Original', presentationSlot: 'current', createdAt: Date.now(),
    studyCards: [{ id: `${id}-card`, front: 'Front', back: 'Back', tags: ['original'] }],
  };
  try {
    await repository.createContentItem(item);
    const detached = (await repository.getContentItems('c1')).find(candidate => candidate.id === id)!;
    detached.title = 'Caller mutation';
    detached.studyCards![0].tags![0] = 'mutated';
    const reread = (await repository.getContentItems('c1')).find(candidate => candidate.id === id)!;
    assert.equal(reread.title, 'Original');
    assert.deepEqual(reread.studyCards?.[0].tags, ['original']);

    await assert.rejects(() => repository.updateContentItems([
      { itemId: id, updates: { title: 'First write' } },
      { itemId: id, updates: { title: 'Second write' } },
    ]), /repeated in the batch/i);
    assert.equal((await repository.getContentItems('c1')).find(candidate => candidate.id === id)?.title, 'Original');

    await assert.rejects(() => repository.updateContentItem(id, { courseId: 'c2' }), /moved between courses/i);
    await assert.rejects(() => repository.createContentItems([
      { ...item, id: `${id}-valid` },
      { ...item, id: `${id}-invalid`, courseId: 'missing-course' },
    ]), /course "missing-course" was not found/i);
    assert.equal(demoContentItems.some(candidate => candidate.id === `${id}-valid`), false);
  } finally {
    for (let index = demoContentItems.length - 1; index >= 0; index -= 1) {
      if (demoContentItems[index].id.startsWith(id)) demoContentItems.splice(index, 1);
    }
  }
});

test('stale course, content, and directory fetches cannot cross an account switch', async () => {
  const originalFactory = repoFactory;
  let release: () => void = () => undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const courseA: Course = {
    id: 'account-a-course', title: 'A', status: 'active', description: '', presentationMode: 'timeline',
    participantsCount: 1, materialsCount: 1, staff: [], announcements: [], termStart: 1, termEnd: 2,
    gradingWeights: {}, visibilityTimer: 0,
  };
  const contentA: ContentItem = {
    id: 'account-a-content', courseId: courseA.id, category: 'material', title: 'A content',
    presentationSlot: 'current', createdAt: 1,
  };
  const directoryA: CourseUser = { id: 'account-a-user', name: 'Account A user', role: 'student' };
  configureRepositoryFactory({
    ...originalFactory,
    courses: { ...originalFactory.courses, async getCoursesForUser() { await gate; return [courseA]; } },
    content: { ...originalFactory.content, async getContentItems() { await gate; return [contentA]; } },
    chat: { ...originalFactory.chat, async getDirectoryUsers() { await gate; return [directoryA]; } },
  });

  const buildSlice = <T extends object>(creator: any): { state: T; setState: (update: Partial<T>) => void } => {
    let state = {} as T;
    let holder: { state: T; setState: (update: Partial<T>) => void };
    const set = (update: Partial<T> | ((current: T) => Partial<T>)) => {
      state = { ...state, ...(typeof update === 'function' ? update(state) : update) };
      holder.state = state;
    };
    holder = { state, setState: (update: Partial<T>) => set(update) };
    state = { ...state, ...creator(set, () => state, {}) };
    holder.state = state;
    return holder;
  };

  const courses = buildSlice<CourseSlice>(createCourseSlice as any);
  const content = buildSlice<ContentSlice>(createContentSlice as any);
  const chat = buildSlice<ChatSlice>(createChatSlice as any);
  const staleLoads = [
    courses.state.fetchCourses('account-a'),
    content.state.fetchContent('account-a-course'),
    chat.state.fetchDirectoryUsers('account-a'),
  ];
  await Promise.resolve();
  advancePrincipalGeneration();
  courses.setState({ courses: [{ ...courseA, id: 'account-b-course', title: 'B' }] });
  content.setState({ contentItems: [{ ...contentA, id: 'account-b-content', courseId: 'account-b-course', title: 'B content' }] });
  chat.setState({ directoryUsers: [{ id: 'account-b-user', name: 'Account B user', role: 'student' }] });
  release();
  try {
    await Promise.all(staleLoads);
    assert.deepEqual(courses.state.courses.map(entry => entry.id), ['account-b-course']);
    assert.deepEqual(content.state.contentItems.map(entry => entry.id), ['account-b-content']);
    assert.deepEqual(chat.state.directoryUsers.map(entry => entry.id), ['account-b-user']);
  } finally {
    configureRepositoryFactory(originalFactory);
    advancePrincipalGeneration();
  }
});

test('the stress role list stays synchronized with every centralized permission definition', () => {
  for (const permission of Object.keys(COURSE_PERMISSION_ROLES) as Array<keyof typeof COURSE_PERMISSION_ROLES>) {
    const recognized = roles.filter(role => hasCoursePermission(role, permission)).sort();
    assert.deepEqual(recognized, [...COURSE_PERMISSION_ROLES[permission]].sort());
  }
});
