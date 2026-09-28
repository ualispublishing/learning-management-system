import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { getAssignableCourseRoles } from '../src/lib/authorization/courseRoleManagement';
import {
  buildCourseAnnouncementChatRoute,
  restoreWithdrawnAnnouncementAsContent,
} from '../src/lib/chat/announcements';
import { getCourseCardActionDescriptors } from '../src/lib/courseCardActions';
import { buildSequentialModuleScheduleChanges } from '../src/lib/coursePresentationBuckets';
import { createInstitutionRepositoryFactory } from '../src/lib/integration/InstitutionRepositoryFactory';
import { configureRepositoryFactory, repoFactory } from '../src/lib/repositories/factory';
import type { RepositoryFactory } from '../src/lib/repositories/interfaces';
import { advancePrincipalGeneration } from '../src/lib/store/principalGeneration';
import { useLMSStore } from '../src/lib/store/useLMSStore';
import type { ChatMessage, ContentItem, CourseRole } from '../src/types/lms';

const roles: CourseRole[] = ['student', 'ta', 'teacher', 'it', 'admin'];
const courseId = 'course-chem-101';
const actorByRole: Record<CourseRole, { id: string; name: string; email?: string; role: CourseRole }> = {
  student: { id: 'student-200', name: 'Sam Student', role: 'student' },
  ta: { id: 'ta-300', name: 'Taylor Assistant', email: 'taylor.ta@example.edu', role: 'ta' },
  teacher: { id: 'teacher-100', name: 'Ada Teacher', email: 'ada.teacher@example.edu', role: 'teacher' },
  it: { id: 'it-400', name: 'Riley IT', email: 'riley.it@example.edu', role: 'it' },
  admin: { id: 'admin-500', name: 'Avery Administrator', email: 'avery.admin@example.edu', role: 'admin' },
};

interface MutationRecord {
  entity: string;
  operation: string;
  entityId: string;
  payload?: Record<string, unknown>;
}

interface InteractionHarness {
  factory: RepositoryFactory;
  pushes: MutationRecord[];
  setActor: (role: CourseRole) => Promise<void>;
  getActor: () => (typeof actorByRole)[CourseRole];
  getAuthoritativeMessage: (id: string) => ChatMessage | undefined;
}

const fixtureSource = async (principalRole: CourseRole) => {
  const source = JSON.parse(await readFile(new URL('../docs/institution-sync.example.json', import.meta.url), 'utf8')) as any;
  const now = Date.now();
  const courseEntry = source.courses[0];
  Object.assign(courseEntry.course, {
    status: 'active',
    termStart: now - 24 * 60 * 60 * 1_000,
    termEnd: now + 180 * 24 * 60 * 60 * 1_000,
  });
  courseEntry.course.announcements.forEach((announcement: any, index: number) => {
    announcement.createdAt = now - (index + 3) * 60_000;
  });
  courseEntry.items.forEach((item: any, index: number) => {
    item.createdAt = now - (index + 10) * 60_000;
    item.questions?.forEach((question: any) => {
      delete question.correctAnswer;
      if (question.customConfig) delete question.customConfig.testCases;
    });
  });
  source.submissions = [];
  source.generatedAt = now;

  for (const actor of Object.values(actorByRole)) {
    if (!source.users.some((user: any) => user.id === actor.id)) source.users.push({ ...actor });
    if (!courseEntry.enrollments.some((enrollment: any) => enrollment.userId === actor.id)) {
      courseEntry.enrollments.push({ userId: actor.id, courseRole: actor.role });
    }
  }

  source.threads.forEach((thread: any, index: number) => {
    thread.createdAt = now - (index + 20) * 60_000;
    if (thread.courseId) {
      thread.opensAt = now - 60_000;
      thread.closesAt = now + 120 * 24 * 60 * 60 * 1_000;
    }
  });
  source.threads.push({
    id: 'thread-general-handler',
    courseId,
    title: 'General handler forum',
    description: 'Interaction test forum.',
    guidelines: 'Be constructive.',
    kind: 'discussion',
    isAnnouncement: false,
    isPinned: false,
    allowStudentPosts: true,
    allowReplies: true,
    allowAttachments: true,
    allowMentions: true,
    scope: 'course',
    createdBy: actorByRole.teacher.id,
    createdAt: now - 50_000,
  });
  source.messages.forEach((message: any, index: number) => {
    message.timestamp = now - (index + 5) * 60_000;
  });
  source.messages.push({
    id: 'message-general-teacher',
    revision: 1,
    threadId: 'thread-general-handler',
    senderId: actorByRole.teacher.id,
    senderName: actorByRole.teacher.name,
    role: 'teacher',
    text: 'Welcome to the handler forum.',
    timestamp: now - 20_000,
    readBy: 1,
    readByUserIds: [actorByRole.teacher.id],
  });
  const principal = actorByRole[principalRole];
  source.threads = source.threads.filter((thread: any) => {
    if (thread.scope === 'direct') return thread.participantIds?.includes(principal.id) === true;
    if (thread.scope !== 'group') return true;
    return ['ta', 'teacher', 'admin'].includes(principal.role)
      || thread.participantIds?.includes(principal.id) === true;
  });
  const authorizedThreadIds = new Set(source.threads.map((thread: any) => thread.id));
  source.messages = source.messages.filter((message: any) => authorizedThreadIds.has(message.threadId));
  return source;
};

const createHarness = async (initialRole: CourseRole): Promise<InteractionHarness> => {
  const source = await fixtureSource(initialRole);
  const pushes: MutationRecord[] = [];
  let actor = actorByRole[initialRole];
  const factory = createInstitutionRepositoryFactory({
    initialSnapshot: structuredClone(source),
    adapter: {
      async pullSnapshot() { return structuredClone(source); },
      async pushMutations(mutations) {
        // The production adapter crosses a JSON transport boundary. Clone test
        // mutations as well so optimistic store updates cannot mutate the
        // authoritative fixture by reference before the next account load.
        pushes.push(...structuredClone(mutations as MutationRecord[]));
        for (const mutation of mutations as MutationRecord[]) {
          if (mutation.entity === 'thread' && mutation.operation === 'create' && mutation.payload) {
            source.threads = [
              ...source.threads.filter((thread: any) => thread.id !== mutation.entityId),
              structuredClone(mutation.payload),
            ];
          }
          if (mutation.entity === 'message' && mutation.operation === 'create' && mutation.payload) {
            source.messages = [
              ...source.messages.filter((message: any) => message.id !== mutation.entityId),
              structuredClone(mutation.payload),
            ];
          }
          if (mutation.entity === 'message' && mutation.operation === 'update' && mutation.payload) {
            const index = source.messages.findIndex((message: any) => message.id === mutation.entityId);
            if (index >= 0 && mutation.payload.action === 'edit') {
              source.messages[index] = structuredClone(mutation.payload.message);
            }
            if (index >= 0 && mutation.payload.action === 'delete') {
              source.messages[index] = {
                ...source.messages[index],
                text: '',
                mediaUrl: undefined,
                mediaType: undefined,
                mediaName: undefined,
                mentionedUserIds: undefined,
                announcementTitle: undefined,
                deletedAt: mutation.payload.deletedAt,
                revision: mutation.payload.revision,
              };
            }
          }
        }
        return { acceptedIds: mutations.map(mutation => mutation.id), rejected: [] };
      },
    },
    getSessionUser: async () => ({
      id: actor.id,
      name: actor.name,
      email: actor.email,
      globalRole: actor.role === 'admin' ? 'admin' : 'user',
    }),
  });

  const hydrate = async () => {
    configureRepositoryFactory(factory);
    advancePrincipalGeneration();
    const courses = await factory.courses.getCoursesForUser(actor.id);
    const contentItems = (await Promise.all(courses.map(course => factory.content.getContentItems(course.id)))).flat();
    const threads = (await Promise.all(courses.map(course => factory.chat.getThreads(course.id, actor.id)))).flat();
    const directThreads = await factory.chat.getDirectThreads(actor.id);
    const directoryUsers = await factory.chat.getDirectoryUsers(actor.id);
    const messages: Record<string, ChatMessage[]> = {};
    for (const thread of [...threads, ...directThreads]) {
      messages[thread.id] = (await factory.chat.getMessages(thread.id, actor.id, { limit: 100 })).messages;
    }
    useLMSStore.setState({
      currentUserId: actor.id,
      currentUserName: actor.name,
      currentUserEmail: actor.email ?? null,
      currentUserRole: actor.role,
      currentUserGlobalRole: actor.role === 'admin' ? 'admin' : 'user',
      initializedPrincipalId: actor.id,
      courses,
      contentItems,
      submissions: [],
      threads,
      directThreads,
      directoryUsers,
      messages,
      messagePagination: {},
      dismissedAnnouncements: [],
      courseMutationError: null,
      contentMutationError: null,
      chatError: null,
      chatErrorSource: null,
      announcementReconciliationIssues: {},
    });
  };

  await hydrate();
  return {
    factory,
    pushes,
    getActor: () => actor,
    getAuthoritativeMessage: id => structuredClone(source.messages.find((message: ChatMessage) => message.id === id)),
    setActor: async role => {
      actor = actorByRole[role];
      await hydrate();
    },
  };
};

const newContent = (id: string, title = id): ContentItem => ({
  id,
  courseId,
  category: 'material',
  title,
  description: '',
  presentationSlot: 'current',
  createdAt: Date.now(),
});

test('course-card clicks expose the exact role-specific modal and roster actions', () => {
  const ids = (role: CourseRole) => getCourseCardActionDescriptors(role).map(action => action.id);
  assert.deepEqual(ids('student'), ['info', 'syllabus', 'student_grades', 'contact']);
  assert.deepEqual(ids('ta'), ['info', 'syllabus', 'grading', 'analytics', 'roster', 'contact']);
  assert.deepEqual(ids('teacher'), ['info', 'syllabus', 'grading', 'settings', 'analytics', 'roster', 'contact']);
  assert.deepEqual(ids('it'), ['info', 'syllabus', 'settings', 'roster', 'contact']);
  assert.deepEqual(ids('admin'), ['info', 'syllabus', 'grading', 'settings', 'analytics', 'roster', 'contact']);
  for (const role of roles) {
    const roster = getCourseCardActionDescriptors(role).find(action => action.id === 'roster');
    assert.equal(roster?.destination, role === 'student' ? undefined : 'roster', role);
  }
});

test('roleplay clicks reach the repository with the same content, course, topic, and roster authorization as the UI', async () => {
  const originalFactory = repoFactory;
  try {
    for (const role of roles) {
      const harness = await createHarness(role);
      const actor = harness.getActor();
      const contentId = `handler-content-${role}`;
      const beforeContent = harness.pushes.length;
      const contentAction = () => useLMSStore.getState().addContentItem(newContent(contentId));
      if (['ta', 'teacher', 'admin'].includes(role)) {
        await contentAction();
        assert.ok(useLMSStore.getState().contentItems.some(item => item.id === contentId), role);
        assert.equal(harness.pushes.length, beforeContent + 1, role);
      } else {
        await assert.rejects(contentAction, /permission/i, role);
        assert.equal(harness.pushes.length, beforeContent, `${role} content denial reached transport`);
        assert.match(useLMSStore.getState().contentMutationError || '', /permission/i);
      }

      const beforeCourse = harness.pushes.length;
      const courseAction = () => useLMSStore.getState().updateCourse(courseId, { description: `${role} course edit` });
      if (['teacher', 'it', 'admin'].includes(role)) {
        await courseAction();
        assert.equal(useLMSStore.getState().courses[0].description, `${role} course edit`);
        assert.equal(harness.pushes.length, beforeCourse + 1, role);
      } else {
        await assert.rejects(courseAction, /permission/i, role);
        assert.equal(harness.pushes.length, beforeCourse, `${role} course denial reached transport`);
      }

      const beforeTopic = harness.pushes.length;
      const topicAction = () => useLMSStore.getState().createThread({
        courseId,
        title: `${role} interaction topic`,
        kind: 'discussion',
        isAnnouncement: false,
        isPinned: true,
        allowStudentPosts: true,
        allowReplies: true,
        allowAttachments: false,
        allowMentions: true,
        scope: 'course',
        createdBy: actor.id,
      });
      if (['ta', 'teacher', 'admin'].includes(role)) {
        await topicAction();
        const created = useLMSStore.getState().threads.find(thread => thread.title === `${role} interaction topic`);
        assert.equal(created?.isPinned, true, role);
        assert.equal(created?.allowAttachments, false, role);
        assert.equal(harness.pushes.length, beforeTopic + 1, role);
      } else {
        await assert.rejects(topicAction, /permission|authorized course staff/i, role);
        assert.equal(harness.pushes.length, beforeTopic, `${role} topic denial reached transport`);
      }

      const targetRole: CourseRole = role === 'it' ? 'it' : role === 'admin' ? 'admin' : 'ta';
      const assignable = ['teacher', 'it', 'admin'].includes(role)
        ? getAssignableCourseRoles(role, 'student')
        : [];
      const beforeRoster = harness.pushes.length;
      const rosterAction = () => useLMSStore.getState().updateCourseUser(courseId, 'student-200', { role: targetRole });
      if (assignable.includes(targetRole)) {
        await rosterAction();
        assert.equal(useLMSStore.getState().courses[0].staff.find(member => member.id === 'student-200')?.role, targetRole);
        assert.equal(harness.pushes.length, beforeRoster + 1, role);
      } else {
        await assert.rejects(rosterAction, /permission|cannot grant/i, role);
        assert.equal(harness.pushes.length, beforeRoster, `${role} roster denial reached transport`);
      }
    }
  } finally {
    configureRepositoryFactory(originalFactory);
  }
});

test('teacher content handlers create, edit, reorder, schedule, delete, restore, and switch presentation modes atomically', async () => {
  const originalFactory = repoFactory;
  try {
    await createHarness('teacher');
    const module: ContentItem = {
      ...newContent('handler-module', 'Module 1'),
      category: 'admin',
      presentationSlot: 'block-header',
      groupIcon: 'group:handler-module',
    };
    const childA = { ...newContent('handler-child-a', 'Reading A'), groupIcon: module.groupIcon };
    const childB = { ...newContent('handler-child-b', 'Reading B'), groupIcon: module.groupIcon };
    await useLMSStore.getState().addContentItems([module, childA, childB]);

    await useLMSStore.getState().updateContentItem(childA.id, { title: 'Reading A revised' });
    assert.equal(useLMSStore.getState().contentItems.find(item => item.id === childA.id)?.title, 'Reading A revised');

    const release = new Date(Date.now() + 86_400_000).toISOString();
    const scheduleChanges = buildSequentialModuleScheduleChanges(
      useLMSStore.getState().contentItems.filter(item => item.courseId === courseId),
      module.id,
      release,
    );
    assert.deepEqual(scheduleChanges.map(change => change.itemId), [module.id, childA.id, childB.id]);
    await useLMSStore.getState().updateContentItems(scheduleChanges);
    assert.equal(useLMSStore.getState().contentItems.find(item => item.id === module.id)?.presentationSlot, 'block-header');
    for (const childId of [childA.id, childB.id]) {
      const child = useLMSStore.getState().contentItems.find(item => item.id === childId);
      assert.equal(child?.presentationSlot, 'scheduled');
      assert.equal(child?.availableDate, release);
    }

    await useLMSStore.getState().reorderContentItems([
      useLMSStore.getState().contentItems.find(item => item.id === childB.id)!,
      useLMSStore.getState().contentItems.find(item => item.id === childA.id)!,
    ]);
    assert.equal(useLMSStore.getState().contentItems.find(item => item.id === childB.id)?.orderIndex, 0);
    assert.equal(useLMSStore.getState().contentItems.find(item => item.id === childA.id)?.orderIndex, 1);

    const deletedAt = Date.now();
    await useLMSStore.getState().updateContentGroup([module.id, childA.id, childB.id], { deletedAt });
    assert.ok([module.id, childA.id, childB.id].every(id => useLMSStore.getState().contentItems.find(item => item.id === id)?.deletedAt === deletedAt));
    await useLMSStore.getState().updateContentItems([module.id, childA.id, childB.id].map(itemId => ({ itemId, updates: { deletedAt: undefined } })));
    assert.ok([module.id, childA.id, childB.id].every(id => useLMSStore.getState().contentItems.find(item => item.id === id)?.deletedAt === undefined));

    await useLMSStore.getState().deleteContentItem(childA.id);
    assert.ok(useLMSStore.getState().contentItems.find(item => item.id === childA.id)?.deletedAt);
    await useLMSStore.getState().restoreContentItem(childA.id);
    assert.equal(useLMSStore.getState().contentItems.find(item => item.id === childA.id)?.deletedAt, undefined);

    for (const presentationMode of ['sequential', 'custom', 'timeline'] as const) {
      await useLMSStore.getState().updateCourse(courseId, { presentationMode });
      assert.equal(useLMSStore.getState().courses.find(course => course.id === courseId)?.presentationMode, presentationMode);
    }
  } finally {
    configureRepositoryFactory(originalFactory);
  }
});

test('chat handlers execute topic, post, reply, edit, report, direct-message, read, and moderation outputs', async () => {
  const originalFactory = repoFactory;
  try {
    const harness = await createHarness('teacher');
    const teacher = harness.getActor();
    await useLMSStore.getState().createThread({
      courseId,
      title: 'Handler-created forum',
      description: 'Created through the same store action as the New course topic modal.',
      guidelines: 'Use replies for follow-up.',
      kind: 'discussion',
      isAnnouncement: false,
      isPinned: true,
      allowStudentPosts: true,
      allowReplies: true,
      allowAttachments: true,
      allowMentions: true,
      scope: 'course',
      createdBy: teacher.id,
    });
    const topic = useLMSStore.getState().threads.find(thread => thread.title === 'Handler-created forum')!;
    const teacherPost = await useLMSStore.getState().sendMessage({
      threadId: topic.id,
      senderId: teacher.id,
      senderName: 'Spoofed name',
      role: 'student',
      text: 'Teacher prompt',
      readBy: 99,
      clientMessageId: 'handler-teacher-post',
    });
    assert.equal(teacherPost.senderName, teacher.name);
    assert.equal(teacherPost.role, 'teacher');
    assert.equal(teacherPost.readBy, 1);

    await harness.setActor('student');
    const student = harness.getActor();
    const reply = await useLMSStore.getState().sendMessage({
      threadId: topic.id,
      senderId: student.id,
      senderName: 'Spoofed student',
      role: 'admin',
      text: 'Student reply',
      replyToMessageId: teacherPost.id,
      readBy: 50,
      clientMessageId: 'handler-student-reply',
    });
    assert.equal(reply.senderName, student.name);
    assert.equal(reply.role, 'student');
    assert.equal(reply.replyToMessageId, teacherPost.id);

    const edited = await useLMSStore.getState().editChatMessage(reply.id, student.id, 'Student reply revised', reply.revision ?? 1);
    assert.equal(edited.text, 'Student reply revised');
    assert.equal(edited.revision, 2);
    assert.equal(harness.getAuthoritativeMessage(reply.id)?.text, 'Student reply revised');
    await useLMSStore.getState().reportChatMessage(teacherPost.id, student.id, 'This post needs instructor review.');
    assert.ok(harness.pushes.some(mutation => mutation.entityId === teacherPost.id && mutation.payload?.action === 'report'));
    await assert.rejects(
      () => useLMSStore.getState().reportChatMessage(reply.id, student.id, 'Reporting my own revised message.'),
      /own message/i,
    );

    const moderationTarget = await useLMSStore.getState().sendMessage({
      threadId: topic.id,
      senderId: student.id,
      senderName: student.name,
      role: 'student',
      text: 'Moderation target',
      readBy: 0,
      clientMessageId: 'handler-moderation-target',
    });
    const direct = await useLMSStore.getState().createDirectThread(student.id, teacher.id, teacher.name);
    assert.deepEqual(new Set(direct.participantIds), new Set([student.id, teacher.id]));
    const directPost = await useLMSStore.getState().sendMessage({
      threadId: direct.id,
      senderId: student.id,
      senderName: student.name,
      role: 'student',
      text: 'Private handler message',
      readBy: 0,
      clientMessageId: 'handler-direct-post',
    });
    assert.equal(directPost.threadId, direct.id);
    await useLMSStore.getState().markThreadRead(topic.id, student.id);
    assert.equal(useLMSStore.getState().threads.find(thread => thread.id === topic.id)?.unreadCount, 0);
    assert.equal(harness.getAuthoritativeMessage(reply.id)?.text, 'Student reply revised');

    await harness.setActor('teacher');
    const loadedTarget = useLMSStore.getState().messages[topic.id].find(message => message.id === moderationTarget.id)!;
    const tombstone = await useLMSStore.getState().deleteChatMessage(loadedTarget.id, teacher.id, loadedTarget.revision ?? 1);
    assert.ok(tombstone.deletedAt);
    assert.equal(tombstone.text, '');
  } finally {
    configureRepositoryFactory(originalFactory);
  }
});

test('Admin and Chat announcement handlers preserve one canonical identity, exact navigation, reverse edits, withdrawals, and retry state', async () => {
  const originalFactory = repoFactory;
  try {
    const harness = await createHarness('teacher');
    const teacher = harness.getActor();
    const announcement: ContentItem = {
      ...newContent('handler-announcement', 'Initial handler announcement'),
      category: 'admin',
      description: 'Initial details.',
      metadata: { lmsContentType: 'announcement', lmsAnnouncementActive: true },
    };
    await useLMSStore.getState().addContentItem(announcement);
    await useLMSStore.getState().syncContentAnnouncementToChat({
      courseId,
      contentItemId: announcement.id,
      title: announcement.title,
      content: announcement.description,
      active: true,
      actorId: teacher.id,
      actorName: teacher.name,
      actorRole: 'teacher',
    });
    let canonical = Object.values(useLMSStore.getState().messages).flat().find(message => message.contentItemId === announcement.id)!;
    assert.equal(canonical.id, announcement.id);
    assert.equal(canonical.text, '📢 Initial handler announcement\n\nInitial details.');
    const announcementThread = useLMSStore.getState().threads.find(thread => thread.id === canonical.threadId)!;
    assert.deepEqual(buildCourseAnnouncementChatRoute(courseId, {
      threadTitle: announcementThread.title,
      messageId: canonical.id,
    }, announcementThread), {
      pathname: '/chat',
      params: {
        courseId,
        chatId: announcementThread.id,
        chatName: announcementThread.title,
        messageId: canonical.id,
      },
    });
    assert.deepEqual(buildCourseAnnouncementChatRoute(courseId, {}, undefined), {
      pathname: '/chat',
      params: { courseId },
    });

    await useLMSStore.getState().updateContentItem(announcement.id, {
      title: 'Course Content correction',
      description: 'Corrected in Admin.',
    });
    await useLMSStore.getState().syncContentAnnouncementToChat({
      courseId,
      contentItemId: announcement.id,
      title: 'Course Content correction',
      content: 'Corrected in Admin.',
      active: true,
      actorId: teacher.id,
      actorName: teacher.name,
      actorRole: 'teacher',
    });
    canonical = Object.values(useLMSStore.getState().messages).flat().find(message => message.id === announcement.id)!;
    assert.equal(canonical.text, '📢 Course Content correction\n\nCorrected in Admin.');
    assert.equal(canonical.revision, 2);
    assert.equal(Object.values(useLMSStore.getState().messages).flat().filter(message => message.contentItemId === announcement.id).length, 1);

    canonical = await useLMSStore.getState().editChatMessage(
      canonical.id,
      teacher.id,
      '📢 Chat correction\n\nCorrected in Chat.',
      canonical.revision ?? 1,
    );
    const reverseEdited = useLMSStore.getState().contentItems.find(item => item.id === announcement.id)!;
    assert.equal(reverseEdited.title, 'Chat correction');
    assert.equal(reverseEdited.description, 'Corrected in Chat.');
    assert.equal(reverseEdited.metadata?.lmsAnnouncementChatRevision, canonical.revision);

    const deleted = await useLMSStore.getState().deleteChatMessage(canonical.id, teacher.id, canonical.revision ?? 1);
    assert.ok(deleted.deletedAt);
    const reverseDeleted = useLMSStore.getState().contentItems.find(item => item.id === announcement.id)!;
    assert.ok(reverseDeleted.deletedAt);
    assert.equal(reverseDeleted.metadata?.lmsAnnouncementActive, false);
    const restored = { ...reverseDeleted, ...restoreWithdrawnAnnouncementAsContent(reverseDeleted, Date.now()) };
    assert.equal(restored.metadata?.lmsContentType, 'title_link');
    assert.equal(restored.metadata?.lmsAnnouncementRequiresNewIdentity, true);

    const retryItem: ContentItem = {
      ...newContent('handler-announcement-retry', 'Retry announcement'),
      category: 'admin',
      description: 'Retry details.',
      metadata: { lmsContentType: 'announcement', lmsAnnouncementActive: true },
    };
    await useLMSStore.getState().addContentItem(retryItem);
    let failOnce = true;
    configureRepositoryFactory({
      ...harness.factory,
      chat: {
        ...harness.factory.chat,
        async sendMessage(input) {
          if (failOnce && input.contentItemId === retryItem.id) {
            failOnce = false;
            throw new Error('Simulated acknowledgement outage.');
          }
          return harness.factory.chat.sendMessage(input);
        },
      },
    });
    await assert.rejects(() => useLMSStore.getState().syncContentAnnouncementToChat({
      courseId,
      contentItemId: retryItem.id,
      title: retryItem.title,
      content: retryItem.description,
      active: true,
      actorId: teacher.id,
      actorName: teacher.name,
      actorRole: 'teacher',
    }), /acknowledgement outage/i);
    const issue = Object.values(useLMSStore.getState().announcementReconciliationIssues)
      .find(candidate => candidate.contentItemId === retryItem.id)!;
    assert.equal(issue.direction, 'content-to-chat');
    assert.match(issue.error, /acknowledgement outage/i);
    await useLMSStore.getState().retryAnnouncementReconciliation(issue.id);
    assert.equal(useLMSStore.getState().announcementReconciliationIssues[issue.id], undefined);
    assert.ok(Object.values(useLMSStore.getState().messages).flat().some(message => message.contentItemId === retryItem.id && !message.deletedAt));
  } finally {
    configureRepositoryFactory(originalFactory);
  }
});
