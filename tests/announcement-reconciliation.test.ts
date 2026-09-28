import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { configureRepositoryFactory, repoFactory } from '../src/lib/repositories/factory';
import {
  createChatSlice,
  type ChatSlice,
} from '../src/lib/store/slices/chatSlice';
import type { ChatMessage, ChatThread, ContentItem, Course, CourseRole } from '../src/types/lms';
import { hasCoursePermission } from '../src/lib/authorization/coursePermissions';
import { restoreWithdrawnAnnouncementAsContent } from '../src/lib/chat/announcements';

type BridgeTestState = ChatSlice & {
  contentItems: ContentItem[];
  currentUserId: string | null;
  courses: Course[];
};

const thread: ChatThread = {
  id: 'course-1-announcements',
  courseId: 'course-1',
  title: 'Announcements',
  isAnnouncement: true,
  kind: 'announcements',
  scope: 'course',
  allowStudentPosts: false,
  createdBy: 'teacher-1',
  createdAt: 10,
};

const contentItem = (overrides: Partial<ContentItem> = {}): ContentItem => ({
  id: 'announcement-content-1',
  courseId: 'course-1',
  category: 'admin',
  title: 'Original title',
  description: 'Original details.',
  presentationSlot: 'current',
  createdAt: 20,
  metadata: { lmsContentType: 'announcement', lmsAnnouncementActive: true },
  ...overrides,
});

const course: Course = {
  id: 'course-1',
  title: 'Course 1',
  status: 'active',
  description: '',
  presentationMode: 'timeline',
  participantsCount: 1,
  materialsCount: 1,
  staff: [{ id: 'teacher-1', name: 'Ada Teacher', role: 'teacher' }],
  announcements: [],
  termStart: 1,
  termEnd: Number.MAX_SAFE_INTEGER,
  gradingWeights: {},
  visibilityTimer: 0,
};

const chatMessage = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'announcement-content-1',
  revision: 1,
  threadId: thread.id,
  senderId: 'teacher-1',
  senderName: 'Ada Teacher',
  role: 'teacher',
  text: '📢 Original title\n\nOriginal details.',
  timestamp: 30,
  readBy: 1,
  readByUserIds: ['teacher-1'],
  announcementId: 'announcement-content-1',
  announcementTitle: 'Original title',
  announcementSeverity: 'info',
  contentItemId: 'announcement-content-1',
  ...overrides,
});

const createBridgeState = (
  item: ContentItem,
  message: ChatMessage,
  overrides: Partial<Pick<BridgeTestState, 'courses' | 'currentUserId'>> = {},
): BridgeTestState => {
  let state = {} as BridgeTestState;
  const set = (update: Partial<BridgeTestState> | ((current: BridgeTestState) => Partial<BridgeTestState>)) => {
    state = { ...state, ...(typeof update === 'function' ? update(state) : update) };
  };
  const slice = (createChatSlice as any)(set, () => state, {});
  state = {
    ...state,
    ...slice,
    contentItems: [item],
    currentUserId: overrides.currentUserId ?? 'teacher-1',
    courses: overrides.courses ?? [course],
    threads: [thread],
    messages: { [thread.id]: [message] },
  };
  return new Proxy({} as BridgeTestState, {
    get: (_target, property) => state[property as keyof BridgeTestState],
    set: (_target, property, value) => {
      state = { ...state, [property]: value };
      return true;
    },
  });
};

test('Chat edits and tombstones reconcile linked course content without changing original message authorship', async () => {
  const originalFactory = repoFactory;
  const initialMessage = chatMessage();
  const contentUpdates: Partial<ContentItem>[] = [];
  let currentMessage = initialMessage;
  configureRepositoryFactory({
    ...originalFactory,
    chat: {
      ...originalFactory.chat,
      async editMessage(_messageId, _userId, text, expectedRevision) {
        assert.equal(expectedRevision, currentMessage.revision);
        currentMessage = { ...currentMessage, text, revision: 2, editedAt: 50 };
        return currentMessage;
      },
      async deleteMessage(_messageId, _userId, expectedRevision) {
        assert.equal(expectedRevision, currentMessage.revision);
        currentMessage = { ...currentMessage, text: '', revision: 3, deletedAt: 60 };
        return currentMessage;
      },
    },
    content: {
      ...originalFactory.content,
      async updateContentItem(itemId, updates) {
        assert.equal(itemId, 'announcement-content-1');
        contentUpdates.push(updates);
      },
    },
  });
  const state = createBridgeState(contentItem(), initialMessage);

  try {
    const edited = await state.editChatMessage(
      initialMessage.id,
      'teacher-1',
      '📢 Corrected title\n\nCorrected details.',
      1,
    );
    assert.equal(edited.senderId, 'teacher-1');
    assert.equal(edited.senderName, 'Ada Teacher');
    assert.equal(state.contentItems[0].title, 'Corrected title');
    assert.equal(state.contentItems[0].description, 'Corrected details.');
    assert.equal(state.contentItems[0].metadata?.lmsAnnouncementActive, true);
    assert.equal(state.contentItems[0].metadata?.lmsAnnouncementChatRevision, 2);

    const deleted = await state.deleteChatMessage(initialMessage.id, 'teacher-1', 2);
    assert.equal(deleted.deletedAt, 60);
    assert.equal(state.contentItems[0].title, 'Corrected title', 'A withdrawal does not erase audit presentation fields.');
    assert.equal(state.contentItems[0].metadata?.lmsAnnouncementActive, false);
    assert.equal(state.contentItems[0].metadata?.lmsAnnouncementWithdrawnAt, 60);
    assert.equal(contentUpdates.length, 2);
    assert.deepEqual(state.announcementReconciliationIssues, {});
  } finally {
    configureRepositoryFactory(originalFactory);
  }
});

test('authorized staff reconcile a linked edit received from another Chat session', async () => {
  const originalFactory = repoFactory;
  const initialMessage = chatMessage();
  let emit: ((messages: ChatMessage[]) => void) | undefined;
  let contentWrites = 0;
  configureRepositoryFactory({
    ...originalFactory,
    chat: {
      ...originalFactory.chat,
      subscribeToMessages(_threadId, _userId, onMessages) {
        emit = onMessages;
        return () => { emit = undefined; };
      },
    },
    content: {
      ...originalFactory.content,
      async updateContentItem() { contentWrites += 1; },
    },
  });
  const state = createBridgeState(contentItem(), initialMessage);

  try {
    const stop = state.subscribeToMessages(thread.id, 'teacher-1');
    assert.ok(emit);
    emit?.([chatMessage({
      text: '📢 Remote correction\n\nReceived over realtime.',
      revision: 2,
      editedAt: 90,
    })]);
    await new Promise<void>(resolve => setImmediate(resolve));

    assert.equal(contentWrites, 1);
    assert.equal(state.contentItems[0].title, 'Remote correction');
    assert.equal(state.contentItems[0].description, 'Received over realtime.');
    stop();

    state.courses = [{
      ...course,
      staff: [{ id: 'teacher-1', name: 'Sam Student', role: 'student' }],
    }];
    const stopStudent = state.subscribeToMessages(thread.id, 'teacher-1');
    emit?.([chatMessage({
      text: '📢 Later server edit\n\nLearners must not perform content writes.',
      revision: 3,
      editedAt: 100,
    })]);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(contentWrites, 1, 'Learner subscriptions never attempt privileged reverse synchronization.');
    assert.equal(state.contentItems[0].title, 'Remote correction');
    stopStudent();
  } finally {
    configureRepositoryFactory(originalFactory);
  }
});

test('linked realtime events wait for course content during a role-transition refresh', async () => {
  const originalFactory = repoFactory;
  const initialMessage = chatMessage();
  let emit: ((messages: ChatMessage[]) => void) | undefined;
  let contentWrites = 0;
  configureRepositoryFactory({
    ...originalFactory,
    chat: {
      ...originalFactory.chat,
      subscribeToMessages(_threadId, _userId, onMessages) {
        emit = onMessages;
        return () => { emit = undefined; };
      },
    },
    content: {
      ...originalFactory.content,
      async updateContentItem() { contentWrites += 1; },
    },
  });
  const state = createBridgeState(contentItem(), initialMessage);
  state.contentItems = [];
  const incoming = chatMessage({
    text: '📢 Deferred correction\n\nApply after the course snapshot.',
    revision: 2,
    editedAt: 90,
  });

  try {
    const stop = state.subscribeToMessages(thread.id, 'teacher-1');
    emit?.([incoming]);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(contentWrites, 0);
    assert.equal(state.messages[thread.id][0].revision, 1, 'A linked event stays unmerged until its content record is loaded.');
    assert.equal(state.chatError, null, 'A normal refresh race does not present a false authorization error.');

    state.contentItems = [contentItem()];
    emit?.([incoming]);
    await new Promise<void>(resolve => setImmediate(resolve));
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(contentWrites, 1);
    assert.equal(state.messages[thread.id][0].revision, 2);
    assert.equal(state.contentItems[0].title, 'Deferred correction');
    stop();
  } finally {
    configureRepositoryFactory(originalFactory);
  }
});

test('Chat-to-course announcement reconciliation enforces every viewer role × source role combination', async () => {
  const originalFactory = repoFactory;
  const roles: CourseRole[] = ['student', 'ta', 'teacher', 'it', 'admin'];
  const announcementRoles = new Set<CourseRole>(['ta', 'teacher', 'admin']);
  let emit: ((messages: ChatMessage[]) => void) | undefined;
  let contentWrites: Partial<ContentItem>[] = [];
  configureRepositoryFactory({
    ...originalFactory,
    chat: {
      ...originalFactory.chat,
      subscribeToMessages(_threadId, _userId, onMessages) {
        emit = onMessages;
        return () => { emit = undefined; };
      },
    },
    content: {
      ...originalFactory.content,
      async updateContentItem(_itemId, updates) { contentWrites.push(updates); },
    },
  });

  let exercised = 0;
  try {
    for (const viewerRole of roles) {
      for (const sourceRole of roles) {
        contentWrites = [];
        const viewerId = `announcement-viewer-${viewerRole}`;
        const sourceId = `announcement-source-${sourceRole}`;
        const itemId = `announcement-${viewerRole}-${sourceRole}`;
        const initialMessage = chatMessage({
          id: itemId,
          senderId: sourceId,
          senderName: `Source ${sourceRole}`,
          role: sourceRole,
          announcementId: itemId,
          contentItemId: itemId,
          readByUserIds: [sourceId],
        });
        const matrixItem = contentItem({ id: itemId });
        const matrixCourse: Course = {
          ...course,
          staff: [
            { id: viewerId, name: `Viewer ${viewerRole}`, role: viewerRole },
            { id: sourceId, name: `Source ${sourceRole}`, role: sourceRole },
          ],
        };
        const state = createBridgeState(matrixItem, initialMessage, {
          currentUserId: viewerId,
          courses: [matrixCourse],
        });
        const stop = state.subscribeToMessages(thread.id, viewerId);
        assert.ok(emit, `${viewerRole}/${sourceRole} subscription did not attach`);

        emit?.([{
          ...initialMessage,
          text: `📢 ${sourceRole} correction\n\nRole-matrix details.`,
          revision: 2,
          editedAt: 90,
        }]);
        await new Promise<void>(resolve => setImmediate(resolve));
        await new Promise<void>(resolve => setImmediate(resolve));

        const expected = announcementRoles.has(viewerRole) && announcementRoles.has(sourceRole);
        assert.equal(contentWrites.length, expected ? 1 : 0, `${viewerRole}/${sourceRole}`);
        assert.equal(
          state.contentItems[0].title,
          expected ? `${sourceRole} correction` : 'Original title',
          `${viewerRole}/${sourceRole}`,
        );
        stop();
        exercised += 1;
      }
    }
  } finally {
    configureRepositoryFactory(originalFactory);
  }

  assert.deepEqual(
    roles.filter(role => hasCoursePermission(role, 'manageContent')),
    [...announcementRoles],
  );
  assert.deepEqual(
    roles.filter(role => hasCoursePermission(role, 'postStaffChat')),
    [...announcementRoles],
  );
  assert.equal(exercised, roles.length ** 2);
});

test('delayed and reversed realtime revisions reconcile only the merged monotonic latest content', async () => {
  const originalFactory = repoFactory;
  const initialMessage = chatMessage();
  let emit: ((messages: ChatMessage[]) => void) | undefined;
  let releaseRevisionTwo: () => void = () => undefined;
  const revisionTwoGate = new Promise<void>(resolve => { releaseRevisionTwo = resolve; });
  let markRevisionThreeStarted: () => void = () => undefined;
  const revisionThreeStarted = new Promise<void>(resolve => { markRevisionThreeStarted = resolve; });
  const writtenRevisions: number[] = [];
  configureRepositoryFactory({
    ...originalFactory,
    chat: {
      ...originalFactory.chat,
      subscribeToMessages(_threadId, _userId, onMessages) {
        emit = onMessages;
        return () => { emit = undefined; };
      },
    },
    content: {
      ...originalFactory.content,
      async updateContentItem(_itemId, updates) {
        const revision = Number(updates.metadata?.lmsAnnouncementChatRevision);
        writtenRevisions.push(revision);
        if (revision === 2) await revisionTwoGate;
        if (revision === 3) markRevisionThreeStarted();
      },
    },
  });
  const state = createBridgeState(contentItem(), initialMessage);

  try {
    const stop = state.subscribeToMessages(thread.id, 'teacher-1');
    emit?.([chatMessage({ text: '📢 Revision 2\n\nOlder correction.', revision: 2, editedAt: 90 })]);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(writtenRevisions, [2]);

    emit?.([chatMessage({ text: '📢 Revision 3\n\nNewest correction.', revision: 3, editedAt: 100 })]);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(writtenRevisions, [2], 'Revision 3 waits behind the in-flight revision 2 write.');

    releaseRevisionTwo();
    await revisionThreeStarted;
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(writtenRevisions, [2, 3]);
    assert.equal(state.contentItems[0].title, 'Revision 3');
    assert.equal(state.contentItems[0].description, 'Newest correction.');
    assert.equal(state.contentItems[0].metadata?.lmsAnnouncementChatRevision, 3);

    emit?.([chatMessage({ text: '📢 Revision 2 delayed\n\nMust never win.', revision: 2, editedAt: 90 })]);
    await new Promise<void>(resolve => setImmediate(resolve));
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(writtenRevisions, [2, 3], 'A delayed older event resolves to the merged revision 3 and cannot write backward.');
    assert.equal(state.contentItems[0].title, 'Revision 3');
    stop();
  } finally {
    releaseRevisionTwo();
    configureRepositoryFactory(originalFactory);
  }
});

test('realtime reverse sync rejects student and unknown source identities even for an authorized staff viewer', async () => {
  const originalFactory = repoFactory;
  let emit: ((messages: ChatMessage[]) => void) | undefined;
  let contentWrites = 0;
  configureRepositoryFactory({
    ...originalFactory,
    chat: {
      ...originalFactory.chat,
      subscribeToMessages(_threadId, _userId, onMessages) {
        emit = onMessages;
        return () => { emit = undefined; };
      },
    },
    content: {
      ...originalFactory.content,
      async updateContentItem() { contentWrites += 1; },
    },
  });
  const studentMessage = chatMessage({
    senderId: 'student-1', senderName: 'Sam Student', role: 'student', readByUserIds: ['student-1'],
  });
  const state = createBridgeState(contentItem(), studentMessage);
  state.courses = [{
    ...course,
    staff: [
      ...course.staff,
      { id: 'student-1', name: 'Sam Student', role: 'student' },
    ],
  }];

  try {
    let stop = state.subscribeToMessages(thread.id, 'teacher-1');
    emit?.([{ ...studentMessage, text: '📢 Forged student edit\n\nMust not sync.', revision: 2, editedAt: 90 }]);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(contentWrites, 0);
    assert.equal(state.contentItems[0].title, 'Original title');
    assert.equal(state.messages[thread.id][0].revision, 1, 'The forged realtime revision is not merged into Chat state.');
    assert.match(state.chatError || '', /event was rejected|not currently authorized/i);
    stop();

    const unknownMessage = chatMessage({ senderId: 'unknown-1', senderName: 'Unknown', role: 'teacher' });
    state.messages = { [thread.id]: [unknownMessage] };
    stop = state.subscribeToMessages(thread.id, 'teacher-1');
    emit?.([{ ...unknownMessage, text: '📢 Forged unknown edit\n\nMust not sync.', revision: 2, editedAt: 90 }]);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(contentWrites, 0);
    assert.equal(state.contentItems[0].title, 'Original title');
    assert.equal(state.messages[thread.id][0].revision, 1);
    stop();
  } finally {
    configureRepositoryFactory(originalFactory);
  }
});

test('course-content edits and conversion away update then tombstone the canonical linked Chat message idempotently', async () => {
  const originalFactory = repoFactory;
  let currentMessage = chatMessage();
  let editCalls = 0;
  let deleteCalls = 0;
  const sentAnnouncementIds: (string | undefined)[] = [];
  configureRepositoryFactory({
    ...originalFactory,
    chat: {
      ...originalFactory.chat,
      async sendMessage(input) {
        sentAnnouncementIds.push(input.announcementId);
        return currentMessage;
      },
      async editMessage(_messageId, _userId, text, expectedRevision) {
        assert.equal(expectedRevision, currentMessage.revision);
        editCalls += 1;
        currentMessage = { ...currentMessage, text, revision: (currentMessage.revision ?? 1) + 1, editedAt: 70 };
        return currentMessage;
      },
      async deleteMessage(_messageId, _userId, expectedRevision) {
        assert.equal(expectedRevision, currentMessage.revision);
        deleteCalls += 1;
        currentMessage = { ...currentMessage, text: '', revision: (currentMessage.revision ?? 1) + 1, deletedAt: 80 };
        return currentMessage;
      },
    },
    content: {
      ...originalFactory.content,
      async updateContentItem() {},
    },
  });
  const state = createBridgeState(contentItem({ title: 'Admin correction', description: 'Changed in Course Content.' }), currentMessage);

  try {
    await state.syncContentAnnouncementToChat({
      courseId: 'course-1',
      contentItemId: 'announcement-content-1',
      title: 'Admin correction',
      content: 'Changed in Course Content.',
      active: true,
      actorId: 'teacher-1',
      actorName: 'Ada Teacher',
      actorRole: 'teacher',
    });
    assert.equal(editCalls, 1);
    assert.equal(currentMessage.id, 'announcement-content-1');
    assert.equal(currentMessage.text, '📢 Admin correction\n\nChanged in Course Content.');

    state.contentItems = [contentItem({
      title: 'Admin correction',
      description: 'Changed in Course Content.',
      metadata: { lmsContentType: 'title_link', lmsAnnouncementActive: false },
    })];
    const withdrawal = {
      courseId: 'course-1',
      contentItemId: 'announcement-content-1',
      title: 'Admin correction',
      content: 'Changed in Course Content.',
      active: false,
      actorId: 'teacher-1',
      actorName: 'Ada Teacher',
      actorRole: 'teacher' as const,
    };
    await state.syncContentAnnouncementToChat(withdrawal);
    await state.syncContentAnnouncementToChat(withdrawal);

    assert.equal(deleteCalls, 1, 'Retrying a completed withdrawal observes the tombstone instead of deleting twice.');
    assert.equal(currentMessage.deletedAt, 80);
    assert.deepEqual(sentAnnouncementIds, ['announcement-content-1'], 'A loaded canonical message does not require a create-shaped lookup before withdrawal.');
    assert.deepEqual(state.announcementReconciliationIssues, {});
  } finally {
    configureRepositoryFactory(originalFactory);
  }
});

test('restoring a withdrawn announcement keeps its Chat tombstone and requires a new announcement identity', async () => {
  const managerSource = await readFile(new URL('../src/components/lms/shared/BaseContentManager.tsx', import.meta.url), 'utf8');
  assert.match(managerSource, /Restore as content/);
  assert.match(managerSource, /Create a new announcement/);
  assert.match(managerSource, /await restoreContentItem\(item\.id\)/, 'The dedicated retention-aware restore contract remains in use.');

  const originalFactory = repoFactory;
  let sendCalls = 0;
  configureRepositoryFactory({
    ...originalFactory,
    chat: {
      ...originalFactory.chat,
      async sendMessage() {
        sendCalls += 1;
        return chatMessage();
      },
    },
  });
  const deletedAnnouncement = contentItem({
    deletedAt: 100,
    metadata: {
      lmsContentType: 'announcement',
      lmsAnnouncementActive: false,
      lmsAnnouncementChatMessageId: 'announcement-content-1',
      lmsAnnouncementChatRevision: 3,
      lmsAnnouncementWithdrawnAt: 90,
    },
  });
  const restoreUpdates = restoreWithdrawnAnnouncementAsContent(deletedAnnouncement, 110);
  const restored = { ...deletedAnnouncement, ...restoreUpdates, id: deletedAnnouncement.id };
  const tombstone = chatMessage({ text: '', revision: 3, deletedAt: 90 });
  const state = createBridgeState(restored, tombstone);

  try {
    assert.equal(restored.deletedAt, undefined);
    assert.equal(restored.metadata?.lmsContentType, 'title_link');
    assert.equal(restored.metadata?.lmsAnnouncementActive, false);
    assert.equal(restored.metadata?.lmsAnnouncementRequiresNewIdentity, true);
    assert.equal(restored.metadata?.lmsAnnouncementChatRevision, 3, 'The prior Chat audit link is retained.');
    assert.equal(tombstone.deletedAt, 90);

    await assert.rejects(() => state.syncContentAnnouncementToChat({
      courseId: 'course-1',
      contentItemId: restored.id,
      title: restored.title,
      content: restored.description,
      active: true,
      actorId: 'teacher-1',
      actorName: 'Ada Teacher',
      actorRole: 'teacher',
    }), /new canonical identity|new Announcement item/i);
    assert.equal(sendCalls, 0, 'A restored item cannot attempt to resurrect or replace its tombstoned message.');
    assert.equal(state.messages[thread.id][0].deletedAt, 90);
  } finally {
    configureRepositoryFactory(originalFactory);
  }
});

test('a failed second write is retained as explicit retryable reconciliation state', async () => {
  const originalFactory = repoFactory;
  const initialMessage = chatMessage();
  let contentAttempts = 0;
  configureRepositoryFactory({
    ...originalFactory,
    chat: {
      ...originalFactory.chat,
      async editMessage(_messageId, _userId, text) {
        return { ...initialMessage, text, revision: 2, editedAt: 50 };
      },
    },
    content: {
      ...originalFactory.content,
      async updateContentItem() {
        contentAttempts += 1;
        if (contentAttempts === 1) throw new Error('Simulated content transport failure');
      },
    },
  });
  const state = createBridgeState(contentItem(), initialMessage);

  try {
    const edited = await state.editChatMessage(initialMessage.id, 'teacher-1', '📢 Retry title\n\nRetry details.', 1);
    assert.equal(edited.revision, 2, 'The committed Chat edit is returned instead of inviting a stale CAS retry.');
    const [issue] = Object.values(state.announcementReconciliationIssues);
    assert.equal(issue.direction, 'chat-to-content');
    assert.match(state.chatError || '', /Chat change was saved/i);

    await state.retryAnnouncementReconciliation(issue.id);
    assert.equal(contentAttempts, 2);
    assert.deepEqual(state.announcementReconciliationIssues, {});
    assert.equal(state.contentItems[0].title, 'Retry title');
  } finally {
    configureRepositoryFactory(originalFactory);
  }
});
