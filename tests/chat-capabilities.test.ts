import assert from 'node:assert/strict';
import test from 'node:test';
import { DemoChatRepository, demoMessageReports } from '../src/lib/repositories/sqlite/ChatRepositoryImpl';
import { demoContentItems, demoCourses, demoMessages, demoThreads } from '../src/lib/repositories/memory/demoData';
import type { ChatMessage, CourseRole } from '../src/types/lms';

const repository = new DemoChatRepository();

const removeMessages = (ids: Set<string>) => {
  for (let index = demoMessages.length - 1; index >= 0; index -= 1) {
    if (ids.has(demoMessages[index].id)) demoMessages.splice(index, 1);
  }
};

const removeThreads = (ids: Set<string>) => {
  for (let index = demoThreads.length - 1; index >= 0; index -= 1) {
    if (ids.has(demoThreads[index].id)) demoThreads.splice(index, 1);
  }
};

test('group and direct conversations remain private across every repository operation', async () => {
  assert.deepEqual(await repository.getThreads('c1'), [], 'Demo thread discovery fails closed without a principal.');
  assert.ok((await repository.getThreads('c1', 'u3')).some(thread => thread.id === 'c1_group_a'));
  assert.ok((await repository.getThreads('c1', 'u1')).some(thread => thread.id === 'c1_group_a'));
  assert.equal((await repository.getThreads('c1', 'u5')).some(thread => thread.id === 'c1_group_a'), false);
  await assert.rejects(() => repository.getMessages('c1_group_a', 'u5'), /not accessible/i);
  await assert.rejects(() => repository.sendMessage({
    threadId: 'c1_group_a', senderId: 'u5', senderName: 'ignored', role: 'student', text: 'Outsider post', readBy: 99,
  }), /do not have access/i);
  await assert.rejects(() => repository.editMessage('msg_008', 'u5', 'Outsider edit', 1), /not accessible/i);
  await assert.rejects(() => repository.deleteMessage('msg_008', 'u5', 1), /not accessible/i);
  await assert.rejects(() => repository.reportMessage('msg_008', 'u5', 'This private post should not be visible.'), /not accessible/i);
  await assert.rejects(() => repository.markThreadRead('c1_group_a', 'u5'), /not accessible/i);
  assert.throws(() => repository.subscribeToMessages('c1_group_a', 'u5', () => undefined), /not accessible/i);

  assert.ok((await repository.getDirectThreads('u3')).some(thread => thread.id === 'dm_u3_u4'));
  assert.equal((await repository.getDirectThreads('u5')).some(thread => thread.id === 'dm_u3_u4'), false);
  await assert.rejects(() => repository.getMessages('dm_u3_u4', 'u5'), /not accessible/i);
  await assert.rejects(() => repository.sendMessage({
    threadId: 'dm_u3_u4', senderId: 'u5', senderName: 'ignored', role: 'student', text: 'Outsider DM', readBy: 0,
  }), /do not have access/i);
  await assert.rejects(() => repository.markThreadRead('dm_u3_u4', 'u5'), /not accessible/i);
  assert.throws(() => repository.subscribeToMessages('dm_u3_u4', 'u5', () => undefined), /not accessible/i);
});

test('course-topic summaries maintain principal-scoped unread and latest-message state', async () => {
  const createdThreadIds = new Set<string>();
  const createdMessageIds = new Set<string>();
  try {
    const thread = await repository.createThread({
      courseId: 'c1', title: 'Unread summary fixture', isAnnouncement: false, scope: 'course', createdBy: 'u1',
    });
    createdThreadIds.add(thread.id);
    const sent = await repository.sendMessage({
      threadId: thread.id, senderId: 'u3', senderName: 'ignored', role: 'student', text: 'Unread summary message', readBy: 50,
    });
    createdMessageIds.add(sent.id);
    let summary = (await repository.getThreads('c1', 'u4')).find(candidate => candidate.id === thread.id)!;
    assert.equal(summary.unreadCount, 1);
    assert.equal(summary.lastMessageAt, sent.timestamp);
    assert.equal(summary.lastMessagePreview, sent.text);
    await repository.markThreadRead(thread.id, 'u4');
    summary = (await repository.getThreads('c1', 'u4')).find(candidate => candidate.id === thread.id)!;
    assert.equal(summary.unreadCount, 0);
  } finally {
    removeMessages(createdMessageIds);
    removeThreads(createdThreadIds);
  }
});

test('topic creation enforces staff roles, group boundaries, direct-message shape, and course windows', async () => {
  const createdThreadIds = new Set<string>();
  const course = demoCourses.find(candidate => candidate.id === 'c1')!;
  const userTwo = course.staff.find(user => user.id === 'u2')!;
  const originalRole = userTwo.role;
  const originalStatus = course.status;
  const originalTermEnd = course.termEnd;
  const createCourseTopic = (createdBy: string, label: string) => repository.createThread({
    courseId: course.id,
    title: `${label} capability topic`,
    isAnnouncement: false,
    scope: 'course',
    createdBy,
  });
  try {
    await assert.rejects(() => createCourseTopic('u3', 'Student'), /authorized course staff/i);

    userTwo.role = 'it';
    await assert.rejects(() => createCourseTopic('u2', 'IT'), /authorized course staff/i);

    for (const [userId, role] of [['u1', 'teacher'], ['u2', 'ta'], ['u2', 'admin']] as [string, CourseRole][]) {
      userTwo.role = userId === 'u2' ? role : userTwo.role;
      const created = await createCourseTopic(userId, role);
      createdThreadIds.add(created.id);
    }

    await assert.rejects(() => repository.createThread({
      courseId: course.id,
      title: 'Leaky Group A topic',
      isAnnouncement: false,
      scope: 'group',
      groupSetId: 'project-groups',
      groupId: 'Group A',
      participantIds: ['u3', 'u5'],
      createdBy: 'u1',
    }), /not staff or a member/i);

    const privateGroup = await repository.createThread({
      courseId: course.id,
      title: 'Valid Group A topic',
      isAnnouncement: false,
      scope: 'group',
      groupSetId: 'project-groups',
      groupId: 'Group A',
      participantIds: ['u3', 'u4'],
      createdBy: 'u1',
    });
    createdThreadIds.add(privateGroup.id);
    assert.equal((await repository.getThreads(course.id, 'u5')).some(thread => thread.id === privateGroup.id), false);

    const existingDirect = await repository.createThread({
      title: 'Existing pair', isAnnouncement: false, scope: 'direct', participantIds: ['u4'], createdBy: 'u3',
    });
    assert.equal(existingDirect.id, 'dm_u3_u4');
    await assert.rejects(() => repository.createThread({
      title: 'Locked DM', isAnnouncement: false, isLocked: true, scope: 'direct', participantIds: ['u4'], createdBy: 'u3',
    }), /cannot be announcements or locked/i);
    await assert.rejects(() => repository.createThread({
      title: 'Three-person DM', isAnnouncement: false, scope: 'direct', participantIds: ['u4', 'u5'], createdBy: 'u3',
    }), /exactly two participants/i);

    course.status = 'past';
    await assert.rejects(() => createCourseTopic('u1', 'Archived'), /archived courses/i);
    course.status = originalStatus;
    course.termEnd = Date.now();
    await assert.rejects(() => createCourseTopic('u1', 'Ended'), /archived courses/i);
  } finally {
    userTwo.role = originalRole;
    course.status = originalStatus;
    course.termEnd = originalTermEnd;
    removeThreads(createdThreadIds);
  }
});

test('announcement delivery is staff-only, authoritative, and idempotent across retries', async () => {
  const createdMessageIds = new Set<string>();
  const course = demoCourses.find(candidate => candidate.id === 'c1')!;
  const userTwo = course.staff.find(user => user.id === 'u2')!;
  const originalRole = userTwo.role;
  const contentItem = demoContentItems.find(item => item.courseId === course.id)!;
  const input = {
    threadId: 'c1_announcements', senderId: 'u1', senderName: 'Forged name', role: 'student' as const,
    text: '📢 Stable delivery\n\nFirst body.', readBy: 999, readByUserIds: ['u2', 'u3', 'u4'],
    announcementId: contentItem.id, announcementTitle: ' Stable delivery ', announcementSeverity: 'info' as const,
    contentItemId: contentItem.id,
  };
  try {
    await assert.rejects(() => repository.sendMessage({ ...input, senderId: 'u3' }), /read-only/i);
    userTwo.role = 'it';
    await assert.rejects(() => repository.sendMessage({ ...input, senderId: 'u2' }), /read-only/i);

    const delivered = await repository.sendMessage(input);
    createdMessageIds.add(delivered.id);
    assert.equal(delivered.id, contentItem.id);
    assert.equal(delivered.senderName, 'Dr. Smith');
    assert.equal(delivered.role, 'teacher');
    assert.equal(delivered.readBy, 1);
    assert.deepEqual(delivered.readByUserIds, ['u1']);
    assert.equal(delivered.announcementTitle, 'Stable delivery');

    const retried = await repository.sendMessage({ ...input, text: 'A retry must not duplicate or overwrite.' });
    assert.equal(retried.id, delivered.id);
    assert.equal(retried.text, delivered.text);
    assert.equal(demoMessages.filter(message => message.threadId === input.threadId && message.announcementId === contentItem.id).length, 1);

    await assert.rejects(() => repository.editMessage(delivered.id, 'u3', 'Learner edit', 1), /original sender/i);
    userTwo.role = 'it';
    await assert.rejects(() => repository.editMessage(delivered.id, 'u2', 'IT edit', 1), /original sender/i);
    userTwo.role = 'ta';
    const staffEdited = await repository.editMessage(delivered.id, 'u2', '📢 Staff-corrected title\n\nCorrected body.', 1);
    assert.equal(staffEdited.revision, 2);
    assert.equal(staffEdited.senderId, 'u1', 'Official edits retain original authorship.');

    await assert.rejects(() => repository.sendMessage({
      ...input, threadId: 'c1_general', announcementId: `${contentItem.id}-misplaced`, contentItemId: undefined,
    }), /only valid in a course announcement/i);
  } finally {
    userTwo.role = originalRole;
    removeMessages(createdMessageIds);
  }
});

test('announcement posting applies the exact Student, TA, Teacher, IT, and Admin role boundary', async () => {
  const actors: { id: string; role: CourseRole; allowed: boolean }[] = [
    { id: 'u3', role: 'student', allowed: false },
    { id: 'u2', role: 'ta', allowed: true },
    { id: 'u1', role: 'teacher', allowed: true },
    { id: 'u6', role: 'it', allowed: false },
    { id: 'u7', role: 'admin', allowed: true },
  ];
  const createdMessageIds = new Set<string>();
  const contentItem = demoContentItems.find(item => item.courseId === 'c1')!;
  try {
    for (const actor of actors) {
      const send = () => repository.sendMessage({
        threadId: 'c1_announcements',
        senderId: actor.id,
        senderName: 'Untrusted caller name',
        role: 'student',
        text: `📢 ${actor.role} matrix announcement\n\nRole boundary test.`,
        readBy: 999,
        announcementId: `role-announcement-${actor.role}`,
        announcementTitle: `${actor.role} matrix announcement`,
        announcementSeverity: 'info',
        contentItemId: contentItem.id,
      });
      if (!actor.allowed) {
        await assert.rejects(send, /read-only/i, actor.role);
        continue;
      }
      const delivered = await send();
      createdMessageIds.add(delivered.id);
      assert.equal(delivered.senderId, actor.id);
      assert.equal(delivered.role, actor.role);
      assert.notEqual(delivered.senderName, 'Untrusted caller name');
      assert.deepEqual(delivered.readByUserIds, [actor.id]);
    }
  } finally {
    removeMessages(createdMessageIds);
  }
});

test('attachments, replies, edit windows, reports, realtime delivery, and retry failures fail closed', async () => {
  const createdMessageIds = new Set<string>();
  const initialReportCount = demoMessageReports.length;
  const course = demoCourses.find(candidate => candidate.id === 'c1')!;
  const originalStatus = course.status;
  const observed: ChatMessage[] = [];
  const stop = repository.subscribeToMessages('c1_general', 'u4', messages => observed.push(...messages));
  try {
    const beforeInvalid = demoMessages.length;
    await assert.rejects(() => repository.sendMessage({
      threadId: 'c1_general', senderId: 'u3', senderName: 'ignored', role: 'student', text: '', readBy: 0,
      mediaUrl: 'https://user:secret@institution.example/file.pdf', mediaType: 'document', mediaName: 'file.pdf',
    }), /institutional storage/i);
    await assert.rejects(() => repository.sendMessage({
      threadId: 'c1_general', senderId: 'u3', senderName: 'ignored', role: 'student', text: 'Incomplete attachment', readBy: 0,
      mediaType: 'document', mediaName: 'file.pdf',
    }), /metadata requires/i);
    await assert.rejects(() => repository.sendMessage({
      threadId: 'c1_general', senderId: 'u3', senderName: 'ignored', role: 'student', text: 'Cross-topic reply', readBy: 0,
      replyToMessageId: 'msg_006',
    }), /reply target is not available/i);
    await assert.rejects(() => repository.sendMessage({
      threadId: 'c1_general', senderId: 'u3', senderName: 'ignored', role: 'student', text: 'Invalid client id', readBy: 0,
      clientMessageId: 'x'.repeat(257),
    }), /client message identifier/i);
    assert.equal(demoMessages.length, beforeInvalid, 'Rejected sends must not mutate message state.');

    const root = await repository.sendMessage({
      threadId: 'c1_general', senderId: 'u3', senderName: 'ignored', role: 'student', text: 'Retry succeeds once', readBy: 42,
      readByUserIds: ['u1', 'u2', 'u3'],
      clientMessageId: 'capability-retry-message',
    });
    createdMessageIds.add(root.id);
    assert.equal(root.id, 'capability-retry-message');
    assert.deepEqual(root.readByUserIds, ['u3']);
    assert.equal(demoMessages.filter(message => message.id === root.id).length, 1);
    const acknowledgedRetry = await repository.sendMessage({
      threadId: 'c1_general', senderId: 'u3', senderName: 'ignored', role: 'student', text: 'A retry cannot duplicate or overwrite', readBy: 0,
      clientMessageId: 'capability-retry-message',
    });
    assert.equal(acknowledgedRetry.text, root.text);
    assert.equal(demoMessages.filter(message => message.id === root.id).length, 1);

    const edited = await repository.editMessage(root.id, 'u3', 'Edited once', 1);
    assert.equal(edited.revision, 2);
    course.status = 'past';
    await assert.rejects(() => repository.editMessage(root.id, 'u3', 'Archived edit', 2), /cannot be edited/i);
    course.status = originalStatus;

    await assert.rejects(() => repository.reportMessage(root.id, 'u3', 'I cannot report my own post.'), /own message/i);
    await assert.rejects(() => repository.reportMessage(root.id, 'u4', 'short'), /10–1,000/i);
    await repository.reportMessage(root.id, 'u4', 'This edited post requires staff review.');
    await repository.reportMessage(root.id, 'u4', 'A duplicate report remains idempotent.');
    assert.equal(demoMessageReports.length, initialReportCount + 1);

    await repository.markThreadRead('c1_general', 'u4');
    assert.ok(demoMessages.find(message => message.id === root.id)?.readByUserIds?.includes('u4'));

    const deleted = await repository.deleteMessage(root.id, 'u3', 2);
    assert.equal(deleted.text, '');
    assert.equal(deleted.mediaUrl, undefined);
    assert.equal(deleted.mediaName, undefined);
    assert.equal(deleted.mentionedUserIds, undefined);
    await assert.rejects(() => repository.sendMessage({
      threadId: 'c1_general', senderId: 'u4', senderName: 'ignored', role: 'student', text: 'Reply to deleted', readBy: 0,
      replyToMessageId: deleted.id,
    }), /reply target is not available/i);

    assert.deepEqual(observed.filter(message => message.id === root.id).map(message => message.revision), [1, 2, 3]);
    const observedBeforeStop = observed.length;
    stop();
    const afterStop = await repository.sendMessage({
      threadId: 'c1_general', senderId: 'u4', senderName: 'ignored', role: 'student', text: 'No delivery after unsubscribe', readBy: 0,
    });
    createdMessageIds.add(afterStop.id);
    assert.equal(observed.length, observedBeforeStop);
  } finally {
    stop();
    course.status = originalStatus;
    removeMessages(createdMessageIds);
    demoMessageReports.splice(initialReportCount);
  }
});
