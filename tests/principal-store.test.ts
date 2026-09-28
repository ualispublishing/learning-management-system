import assert from 'node:assert/strict';
import test from 'node:test';
import { createCourseSlice, CourseSlice } from '../src/lib/store/slices/courseSlice';
import { createContentSlice, ContentSlice } from '../src/lib/store/slices/contentSlice';
import { advancePrincipalGeneration } from '../src/lib/store/principalGeneration';
import { configureRepositoryFactory, repoFactory } from '../src/lib/repositories/factory';
import { Course } from '../src/types/lms';

const course = (id: string, title: string): Course => ({
  id,
  title,
  status: 'active',
  description: '',
  presentationMode: 'timeline',
  participantsCount: 0,
  materialsCount: 0,
  staff: [],
  announcements: [],
  termStart: 1,
  termEnd: 2,
  gradingWeights: {},
  visibilityTimer: 0,
});

test('an in-flight repository result cannot repopulate state after an account transition', async () => {
  let releaseUpdate: () => void = () => undefined;
  const updateGate = new Promise<void>(resolve => { releaseUpdate = resolve; });
  configureRepositoryFactory({
    ...repoFactory,
    courses: {
      ...repoFactory.courses,
      async updateCourse() { await updateGate; },
    },
  });

  let state = {} as CourseSlice;
  const set = (update: Partial<CourseSlice> | ((current: CourseSlice) => Partial<CourseSlice>)) => {
    state = { ...state, ...(typeof update === 'function' ? update(state) : update) };
  };
  const slice = (createCourseSlice as any)(set, () => state, {});
  state = { ...state, ...slice, courses: [course('course-a', 'Principal A course')] };

  const staleUpdate = state.updateCourse('course-a', { title: 'Late A result' });
  advancePrincipalGeneration();
  state = { ...state, courses: [course('course-b', 'Principal B course')], courseMutationError: null };
  releaseUpdate();
  await staleUpdate;

  assert.deepEqual(state.courses.map(course => course.id), ['course-b']);
  assert.equal(state.courses[0].title, 'Principal B course');
  assert.equal(state.courseMutationError, null);
});

test('duplicate live-answer callers share the authoritative in-flight failure', async () => {
  let rejectAnswer: (error: Error) => void = () => undefined;
  let submitCalls = 0;
  const answerGate = new Promise<void>((_resolve, reject) => { rejectAnswer = reject; });
  configureRepositoryFactory({
    ...repoFactory,
    liveSessions: {
      ...repoFactory.liveSessions,
      async submitAnswer() {
        submitCalls += 1;
        await answerGate;
      },
    },
  });

  let state = {} as ContentSlice;
  const set = (update: Partial<ContentSlice> | ((current: ContentSlice) => Partial<ContentSlice>)) => {
    state = { ...state, ...(typeof update === 'function' ? update(state) : update) };
  };
  const slice = (createContentSlice as any)(set, () => state, {});
  state = {
    ...state,
    ...slice,
    contentItems: [{
      id: 'live-item-dedup', courseId: 'course-live', category: 'coursework', title: 'Live check', description: '',
      isPopQuiz: true, presentationSlot: 'current',
      questions: [{ id: 'live-question-dedup', label: '1', content: 'Choose', answerType: 'multiple_choice', options: ['A', 'B'] }],
    }],
    popQuizState: {
      courseworkId: 'live-item-dedup', sessionId: 'live-session-dedup', startedAt: Date.now(), revision: 1,
      status: 'active', currentQuestionId: 'live-question-dedup', questionOpenedAt: Date.now(), questionClosesAt: null,
      completedQuestionIds: [], answers: {},
    },
  };

  const first = state.submitPopQuizAnswer('student-dedup', 'live-question-dedup', 'A');
  const duplicate = state.submitPopQuizAnswer('student-dedup', 'live-question-dedup', 'A');
  let duplicateSettled = false;
  void duplicate.finally(() => { duplicateSettled = true; }).catch(() => undefined);
  await Promise.resolve();

  assert.equal(submitCalls, 1);
  assert.equal(duplicateSettled, false);
  rejectAnswer(new Error('Authoritative answer write failed'));
  await assert.rejects(first, /Authoritative answer write failed/);
  await assert.rejects(duplicate, /Authoritative answer write failed/);
  assert.match(state.liveSessionError || '', /Authoritative answer write failed/);
});

test('account initialization exposes a fail-closed principal boundary before refetching the new account', async () => {
  Object.assign(globalThis, { __DEV__: true });
  const activeUser = { id: 'principal-b', name: 'Principal B', email: 'principal-b@example.edu', role: 'student' as const, globalRole: 'user' as const };
  const principalCourse = {
    ...course('course-principal-b', 'Principal B course'),
    termStart: Date.now() - 60_000,
    termEnd: Date.now() + 60_000,
    staff: [activeUser],
  };
  configureRepositoryFactory({
    ...repoFactory,
    auth: {
      async login() { return { user: activeUser, defaultRole: 'student' as const }; },
      async logout() {},
      async getCurrentUser() { return activeUser; },
    },
    courses: {
      ...repoFactory.courses,
      async getCoursesForUser(userId) { return userId === activeUser.id ? [principalCourse] : []; },
    },
    content: {
      ...repoFactory.content,
      async getContentItems() { return []; },
    },
    submissions: {
      ...repoFactory.submissions,
      async getSubmissionsForCourses() { return []; },
    },
  });

  const { useLMSStore } = await import('../src/lib/store/useLMSStore');
  useLMSStore.setState({
    currentUserId: 'principal-a',
    currentUserName: 'Principal A',
    currentUserEmail: 'principal-a@example.edu',
    currentUserRole: 'teacher',
    currentUserGlobalRole: 'user',
    initializedPrincipalId: 'principal-a',
    courses: [course('course-principal-a', 'Principal A course')],
    contentItems: [],
    submissions: [],
    threads: [],
    directThreads: [],
    directoryUsers: [],
    messages: {},
  });
  const observedPrincipalIds: (string | null)[] = [useLMSStore.getState().currentUserId];
  const observedIdentities = [{
    id: useLMSStore.getState().currentUserId,
    name: useLMSStore.getState().currentUserName,
    email: useLMSStore.getState().currentUserEmail,
  }];
  const unsubscribe = useLMSStore.subscribe((next, previous) => {
    if (next.currentUserId !== previous.currentUserId) observedPrincipalIds.push(next.currentUserId);
    if (next.currentUserId !== previous.currentUserId
      || next.currentUserName !== previous.currentUserName
      || next.currentUserEmail !== previous.currentUserEmail) {
      observedIdentities.push({ id: next.currentUserId, name: next.currentUserName, email: next.currentUserEmail });
    }
  });

  try {
    await useLMSStore.getState().login(activeUser.email);
    await useLMSStore.getState().initializeMocks();
  } finally {
    unsubscribe();
  }

  assert.deepEqual(observedPrincipalIds.slice(-4), [null, activeUser.id, null, activeUser.id]);
  assert.deepEqual(observedIdentities.slice(-4), [
    { id: null, name: null, email: null },
    { id: activeUser.id, name: activeUser.name, email: activeUser.email },
    { id: null, name: null, email: null },
    { id: activeUser.id, name: activeUser.name, email: activeUser.email },
  ]);
  assert.equal(useLMSStore.getState().initializedPrincipalId, activeUser.id);
  assert.deepEqual(useLMSStore.getState().courses.map(entry => entry.id), [principalCourse.id]);
  assert.equal(useLMSStore.getState().currentUserName, activeUser.name);
  assert.equal(useLMSStore.getState().currentUserEmail, activeUser.email);

  await useLMSStore.getState().logout();
  assert.equal(useLMSStore.getState().currentUserId, null);
  assert.equal(useLMSStore.getState().currentUserName, null);
  assert.equal(useLMSStore.getState().currentUserEmail, null);
});

test('a delayed login response cannot restore identity after logout starts', async () => {
  Object.assign(globalThis, { __DEV__: true });
  const originalFactory = repoFactory;
  const user = {
    id: 'stale-login-user',
    name: 'Stale Login User',
    email: 'stale-login@example.edu',
    globalRole: 'user' as const,
  };
  let session: typeof user | null = user;
  let releaseLogin: () => void = () => undefined;
  const loginGate = new Promise<void>(resolve => { releaseLogin = resolve; });
  configureRepositoryFactory({
    ...repoFactory,
    auth: {
      async login() {
        await loginGate;
        return { user, defaultRole: 'student' as const };
      },
      async logout() { session = null; },
      async getCurrentUser() { return session; },
    },
  });

  const { useLMSStore } = await import('../src/lib/store/useLMSStore');
  useLMSStore.setState({
    currentUserId: null,
    currentUserName: null,
    currentUserEmail: null,
    initializedPrincipalId: null,
  });

  try {
    const pendingLogin = useLMSStore.getState().login(user.email);
    await Promise.resolve();
    await useLMSStore.getState().logout();
    releaseLogin();
    await assert.rejects(pendingLogin, /session changed while sign-in was in progress/i);
    assert.equal(useLMSStore.getState().currentUserId, null);
    assert.equal(useLMSStore.getState().currentUserName, null);
    assert.equal(useLMSStore.getState().initializedPrincipalId, null);
  } finally {
    releaseLogin();
    configureRepositoryFactory(originalFactory);
  }
});
