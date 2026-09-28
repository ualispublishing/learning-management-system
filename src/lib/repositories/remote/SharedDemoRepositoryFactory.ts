/**
 * @fileoverview src/lib/repositories/remote/SharedDemoRepositoryFactory.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import type {
  AuthRepository,
  ChatMessagePage,
  ChatMessagePageRequest,
  LiveSessionRepository,
  NewChatMessage,
  RepositoryFactory,
  User,
} from '../interfaces';
import type {
  ChatMessage,
  ChatThread,
  ContentProgress,
  ContentItem,
  Course,
  CourseRole,
  CourseUser,
  PopQuizState,
  StudentSubmission,
} from '../../../types/lms';

const rawSharedDemoUrl = process.env.EXPO_PUBLIC_LMS_SHARED_DEMO_URL?.trim() || '';

const normalizeLoopbackUrl = (value: string): string | null => {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' || (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost')) return null;
    url.pathname = url.pathname.replace(/\/$/, '');
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
};

export const sharedDemoServerUrl = normalizeLoopbackUrl(rawSharedDemoUrl);
export const isSharedDemoMode = Boolean(sharedDemoServerUrl);

type SharedDemoService = 'courses' | 'content' | 'progress' | 'submissions' | 'gradebook' | 'chat' | 'liveSessions';

export interface SharedDemoChangeEvent {
  version: number;
  kind: 'mutation' | 'reset';
  service?: SharedDemoService;
  method?: string;
  actorId?: string;
  at: number;
}

interface RPCEnvelope<T> {
  ok: boolean;
  result?: T;
  error?: string;
}

const responseError = async (response: Response): Promise<Error> => {
  try {
    const payload = await response.json() as RPCEnvelope<unknown>;
    if (typeof payload.error === 'string' && payload.error.trim()) return new Error(payload.error);
  } catch {
    // Fall through to the bounded status message.
  }
  return new Error(`The shared demo server rejected the request (${response.status}).`);
};

const postJSON = async <T,>(baseUrl: string, path: string, body: unknown, userId?: string): Promise<T> => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(userId ? { 'x-demo-user-id': userId } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await responseError(response);
  const payload = await response.json() as RPCEnvelope<T>;
  if (!payload.ok) throw new Error(payload.error || 'The shared demo server returned an invalid response.');
  return payload.result as T;
};

const subscribeWithEventSource = <T,>(
  url: string,
  onValue: (value: T) => void,
  onError?: (error: Error) => void,
): (() => void) | null => {
  if (typeof EventSource === 'undefined') return null;
  const source = new EventSource(url);
  source.onmessage = event => {
    try {
      onValue(JSON.parse(event.data) as T);
    } catch {
      onError?.(new Error('The shared demo server sent an invalid realtime event.'));
    }
  };
  source.onerror = () => {
    if (source.readyState === EventSource.CLOSED) {
      onError?.(new Error('The shared demo realtime connection closed.'));
    }
  };
  return () => source.close();
};

export const subscribeToSharedDemoChanges = (
  userId: string,
  onEvent: (event: SharedDemoChangeEvent) => void,
  onError?: (error: Error) => void,
): (() => void) => {
  if (!sharedDemoServerUrl || !userId) return () => undefined;
  const query = new URLSearchParams({ userId });
  return subscribeWithEventSource<SharedDemoChangeEvent>(
    `${sharedDemoServerUrl}/events/changes?${query}`,
    onEvent,
    onError,
  ) ?? (() => undefined);
};

export const createSharedDemoRepositoryFactory = (baseUrl: string): RepositoryFactory => {
  let currentUser: User | null = null;

  const loginOnServer = async (email: string) => {
    const result = await postJSON<{ user: User; defaultRole: CourseRole }>(baseUrl, '/session', { email });
    currentUser = result.user;
    return result;
  };

  const auth: AuthRepository = {
    login: email => loginOnServer(email?.trim() || ''),
    logout: async () => { currentUser = null; },
    getCurrentUser: async () => currentUser ? { ...currentUser } : null,
  };

  const requireUserId = () => {
    if (!currentUser) throw new Error('Choose a shared demo identity before using the collaboration server.');
    return currentUser.id;
  };

  const rpc = <T,>(service: SharedDemoService, method: string, args: unknown[]): Promise<T> =>
    postJSON<T>(baseUrl, '/rpc', { service, method, args }, requireUserId());

  const chatPollingSubscription = (
    threadId: string,
    userId: string,
    onMessages: (messages: ChatMessage[]) => void,
    onError?: (error: Error) => void,
  ) => {
    const revisions = new Map<string, number>();
    let stopped = false;
    const poll = async () => {
      try {
        const page = await rpc<ChatMessagePage>('chat', 'getMessages', [threadId, userId, { limit: 100 }]);
        if (stopped) return;
        const changed = page.messages.filter(message => {
          const revision = message.revision ?? 1;
          if ((revisions.get(message.id) ?? 0) >= revision) return false;
          revisions.set(message.id, revision);
          return true;
        });
        if (changed.length) onMessages(changed);
      } catch (error) {
        if (!stopped) onError?.(error instanceof Error ? error : new Error('Shared chat polling failed.'));
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 1_000);
    return () => { stopped = true; clearInterval(timer); };
  };

  const livePollingSubscription = (
    courseworkId: string,
    onState: (state: PopQuizState | null) => void,
    onError?: (error: Error) => void,
  ) => {
    let stopped = false;
    let signature = '';
    const poll = async () => {
      try {
        const state = await rpc<PopQuizState | null>('liveSessions', 'getSession', [courseworkId]);
        if (stopped) return;
        const nextSignature = JSON.stringify(state);
        if (nextSignature !== signature) {
          signature = nextSignature;
          onState(state);
        }
      } catch (error) {
        if (!stopped) onError?.(error instanceof Error ? error : new Error('Shared live-session polling failed.'));
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 1_000);
    return () => { stopped = true; clearInterval(timer); };
  };

  const liveSessions: LiveSessionRepository = {
    getSession: courseworkId => rpc('liveSessions', 'getSession', [courseworkId]),
    publishSession: (courseworkId, state) => rpc('liveSessions', 'publishSession', [courseworkId, state]),
    submitAnswer: (courseworkId, studentId, questionId, answer) => rpc('liveSessions', 'submitAnswer', [courseworkId, studentId, questionId, answer]),
    finalizeSession: (courseworkId, sessionId) => rpc('liveSessions', 'finalizeSession', [courseworkId, sessionId]),
    subscribeToSession: (courseworkId, onState, onError) => {
      const query = new URLSearchParams({ courseworkId, userId: requireUserId() });
      return subscribeWithEventSource<PopQuizState | null>(
        `${baseUrl}/events/live?${query}`,
        onState,
        onError,
      ) ?? livePollingSubscription(courseworkId, onState, onError);
    },
  };

  return {
    auth,
    courses: {
      getCoursesForUser: userId => rpc<Course[]>('courses', 'getCoursesForUser', [userId]),
      getCourseDetails: courseId => rpc<Course | null>('courses', 'getCourseDetails', [courseId]),
      getUserRoleForCourse: (userId, courseId) => rpc<CourseRole>('courses', 'getUserRoleForCourse', [userId, courseId]),
      updateCourse: (courseId, updates) => rpc<void>('courses', 'updateCourse', [courseId, updates]),
      addStudentByIdentifier: (courseId, identifier) => rpc<CourseUser>('courses', 'addStudentByIdentifier', [courseId, identifier]),
      updateCourseUser: (courseId, userId, updates) => rpc<void>('courses', 'updateCourseUser', [courseId, userId, updates]),
    },
    content: {
      getContentItems: courseId => rpc<ContentItem[]>('content', 'getContentItems', [courseId]),
      createContentItem: item => rpc<ContentItem>('content', 'createContentItem', [item]),
      createContentItems: items => rpc<ContentItem[]>('content', 'createContentItems', [items]),
      updateContentItem: (itemId, updates) => rpc<void>('content', 'updateContentItem', [itemId, updates]),
      updateContentItems: changes => rpc<void>('content', 'updateContentItems', [changes]),
      updateContentGrouping: (courseId, labels, changes) => rpc<void>('content', 'updateContentGrouping', [courseId, labels, changes]),
      deleteContentItem: (itemId, deletedAt) => rpc<void>('content', 'deleteContentItem', [itemId, deletedAt]),
      restoreContentItem: itemId => rpc<void>('content', 'restoreContentItem', [itemId]),
    },
    progress: {
      getProgressForCourses: (courseIds, userId) => rpc<ContentProgress[]>('progress', 'getProgressForCourses', [courseIds, userId]),
      markViewed: (contentItemId, userId) => rpc<ContentProgress>('progress', 'markViewed', [contentItemId, userId]),
      setCompleted: (contentItemId, userId, completed) => rpc<ContentProgress>('progress', 'setCompleted', [contentItemId, userId, completed]),
    },
    submissions: {
      getSubmissionsForCourses: courseIds => rpc<StudentSubmission[]>('submissions', 'getSubmissionsForCourses', [courseIds]),
      upsertSubmission: submission => rpc<StudentSubmission>('submissions', 'upsertSubmission', [submission]),
    },
    gradebook: {
      createExternalGrade: (item, submissions) => rpc<void>('gradebook', 'createExternalGrade', [item, submissions]),
    },
    chat: {
      getDirectoryUsers: userId => rpc<CourseUser[]>('chat', 'getDirectoryUsers', [userId]),
      getThreads: (courseId, userId) => rpc<ChatThread[]>('chat', 'getThreads', [courseId, userId]),
      getDirectThreads: userId => rpc<ChatThread[]>('chat', 'getDirectThreads', [userId]),
      getMessages: (threadId, userId, request?: ChatMessagePageRequest) => rpc<ChatMessagePage>('chat', 'getMessages', [threadId, userId, request]),
      sendMessage: (message: NewChatMessage) => rpc<ChatMessage>('chat', 'sendMessage', [message]),
      editMessage: (messageId, userId, text, expectedRevision, mentionedUserIds) => rpc<ChatMessage>('chat', 'editMessage', [messageId, userId, text, expectedRevision, mentionedUserIds]),
      deleteMessage: (messageId, userId, expectedRevision) => rpc<ChatMessage>('chat', 'deleteMessage', [messageId, userId, expectedRevision]),
      reportMessage: (messageId, userId, reason) => rpc<void>('chat', 'reportMessage', [messageId, userId, reason]),
      createThread: thread => rpc<ChatThread>('chat', 'createThread', [thread]),
      markThreadRead: (threadId, userId) => rpc<void>('chat', 'markThreadRead', [threadId, userId]),
      // A page can subscribe to several announcement threads plus its active
      // conversation. Opening one EventSource per thread can consume every
      // browser HTTP/1 connection for the loopback origin and starve ordinary
      // RPC requests. Short polling keeps those subscriptions bounded while
      // still making separate demo tabs converge within one second.
      subscribeToMessages: (threadId, userId, onMessages, onError) =>
        chatPollingSubscription(threadId, userId, onMessages, onError),
    },
    liveSessions,
  };
};
