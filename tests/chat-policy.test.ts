import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canUserAccessThread,
  canRolePostToThread,
  getChatThreadPhase,
  getMentionableUsers,
  hasVisibleMentionToken,
  mentionedUserIdsInText,
} from '../src/lib/chat/threadPolicy';
import { DemoChatRepository } from '../src/lib/repositories/sqlite/ChatRepositoryImpl';
import { demoCourses, demoMessages, demoThreads, demoUsers } from '../src/lib/repositories/memory/demoData';
import type { ChatThread, CourseRole } from '../src/types/lms';

const course = demoCourses.find(candidate => candidate.id === 'c1')!;
const baseThread: ChatThread = {
  id: 'policy-fixture',
  courseId: course.id,
  title: 'Policy fixture',
  isAnnouncement: false,
  scope: 'course',
  createdBy: 'u1',
  createdAt: 1_000,
};

test('course chat lifecycle combines term state with explicit open and close times', () => {
  const duringTerm = course.termStart + 10_000;
  assert.equal(getChatThreadPhase(baseThread, course, course.termStart - 1), 'scheduled');
  assert.equal(getChatThreadPhase(baseThread, course, course.termStart), 'active');
  assert.equal(getChatThreadPhase(baseThread, course, course.termEnd), 'closed');
  assert.equal(getChatThreadPhase(baseThread, course, course.termEnd + 1), 'closed');
  assert.equal(getChatThreadPhase({ ...baseThread, opensAt: duringTerm + 1_000 }, course, duringTerm), 'scheduled');
  assert.equal(getChatThreadPhase({ ...baseThread, opensAt: duringTerm - 1_000, closesAt: duringTerm + 1_000 }, course, duringTerm), 'active');
  assert.equal(getChatThreadPhase({ ...baseThread, closesAt: duringTerm }, course, duringTerm), 'closed');
  assert.equal(getChatThreadPhase({ ...baseThread, closesAt: duringTerm - 1 }, course, duringTerm), 'closed');
  assert.equal(getChatThreadPhase(baseThread, { ...course, status: 'past' }, duringTerm), 'closed');
  assert.equal(getChatThreadPhase(baseThread, { ...course, termStart: Number.NaN }, duringTerm), 'closed');
  assert.equal(getChatThreadPhase({ ...baseThread, opensAt: Number.NaN }, course, duringTerm), 'closed');
  assert.equal(getChatThreadPhase({ ...baseThread, opensAt: duringTerm + 1, closesAt: duringTerm }, course, duringTerm), 'closed');
  assert.equal(canRolePostToThread({ ...baseThread, allowStudentPosts: false }, course, 'student', duringTerm), false);
  assert.equal(canRolePostToThread({ ...baseThread, allowStudentPosts: false }, course, 'teacher', duringTerm), true);
});

test('student, TA, teacher, IT, and admin posting capabilities follow topic policy', () => {
  const roles: CourseRole[] = ['student', 'ta', 'teacher', 'it', 'admin'];
  const duringTerm = course.termStart + 10_000;
  const normal = roles.map(role => canRolePostToThread(baseThread, course, role, duringTerm));
  assert.deepEqual(normal, [true, true, true, true, true]);

  for (const restricted of [
    { ...baseThread, allowStudentPosts: false },
    { ...baseThread, isLocked: true },
    { ...baseThread, isAnnouncement: true },
  ]) {
    assert.deepEqual(
      roles.map(role => canRolePostToThread(restricted, course, role, duringTerm)),
      [false, true, true, false, true],
    );
  }

  const direct: ChatThread = { ...baseThread, courseId: undefined, scope: 'direct', participantIds: ['u1', 'u3'] };
  assert.deepEqual(roles.map(role => canRolePostToThread(direct, undefined, role, duringTerm)), [true, true, true, true, true]);
});

test('mentions use exact visible tokens and group membership boundaries', () => {
  assert.equal(hasVisibleMentionToken('Thanks @Bob Student!', 'Bob Student'), true);
  assert.equal(hasVisibleMentionToken('@Anna should not notify Ann', 'Ann'), false);
  assert.deepEqual(mentionedUserIdsInText('@Alice Student and @Bob Student.', demoUsers), ['u3', 'u4']);
  assert.deepEqual(mentionedUserIdsInText('@Alex Kim', [
    { id: 'alex-1', name: 'Alex Kim', role: 'student' },
    { id: 'alex-2', name: 'Alex Kim', role: 'student' },
  ]), [], 'Ambiguous manually typed names must not notify multiple people.');

  const groupThread = demoThreads.find(thread => thread.id === 'c1_group_a')!;
  assert.deepEqual(
    getMentionableUsers(groupThread, course, demoUsers).map(user => user.id).sort(),
    ['u1', 'u2', 'u3', 'u4', 'u7'],
  );
  assert.equal(
    getMentionableUsers(groupThread, course, demoUsers).some(user => user.id === 'u6'),
    false,
    'IT course managers do not gain instructional access to private assignment-group chat.',
  );
  assert.equal(canUserAccessThread(groupThread, course, 'u3', 'student'), true);
  assert.equal(canUserAccessThread(groupThread, course, 'u6', 'it'), false);
  assert.equal(canUserAccessThread(groupThread, course, 'u1', 'teacher'), true);
  assert.equal(
    canUserAccessThread({ ...groupThread, groupId: 'missing', participantIds: ['u3'] }, course, 'u3', 'student'),
    false,
    'A stale participant list cannot grant access after its authoritative group disappears.',
  );
  assert.equal(canUserAccessThread({ ...baseThread, scope: 'direct', courseId: undefined, participantIds: ['u1', 'u3'] }, undefined, 'u3'), true);
  assert.equal(canUserAccessThread({ ...baseThread, scope: 'direct', courseId: undefined, participantIds: ['u1', 'u3'] }, undefined, 'u4'), false);
});

test('demo chat enforces staff topic creation and topic interaction policies', async () => {
  const repository = new DemoChatRepository();
  let threadId: string | undefined;
  const createdMessageIds: string[] = [];
  try {
    await assert.rejects(() => repository.createThread({
      courseId: 'c1',
      title: 'Student-created course topic',
      isAnnouncement: false,
      scope: 'course',
      createdBy: 'u3',
    }), /authorized course staff/i);

    const thread = await repository.createThread({
      courseId: 'c1',
      title: 'Restricted policy fixture',
      description: 'Used to verify repository enforcement.',
      kind: 'q-and-a',
      isAnnouncement: false,
      allowStudentPosts: true,
      allowReplies: false,
      allowAttachments: false,
      allowMentions: true,
      scope: 'course',
      createdBy: 'u1',
    });
    threadId = thread.id;
    const createdThreadId = thread.id;

    await assert.rejects(() => repository.sendMessage({
      threadId: createdThreadId, senderId: 'u3', senderName: 'ignored', role: 'student', text: 'Hidden notification',
      mentionedUserIds: ['u4'], readBy: 1,
    }), /mentioned users/i);

    const root = await repository.sendMessage({
      threadId: createdThreadId, senderId: 'u3', senderName: 'ignored', role: 'student', text: '@Bob Student visible mention',
      mentionedUserIds: ['u4', 'u4'], readBy: 1,
    });
    createdMessageIds.push(root.id);
    assert.deepEqual(root.mentionedUserIds, ['u4']);

    await assert.rejects(() => repository.sendMessage({
      threadId: createdThreadId, senderId: 'u4', senderName: 'ignored', role: 'student', text: 'Reply',
      replyToMessageId: root.id, readBy: 1,
    }), /replies are disabled/i);
    await assert.rejects(() => repository.sendMessage({
      threadId: createdThreadId, senderId: 'u4', senderName: 'ignored', role: 'student', text: 'Attachment',
      mediaUrl: 'https://institution.example/file.pdf', mediaType: 'document', mediaName: 'file.pdf', readBy: 1,
    }), /attachments are disabled/i);
  } finally {
    for (let index = demoMessages.length - 1; index >= 0; index -= 1) {
      if (demoMessages[index].threadId === threadId || createdMessageIds.includes(demoMessages[index].id)) demoMessages.splice(index, 1);
    }
    if (threadId) {
      const threadIndex = demoThreads.findIndex(thread => thread.id === threadId);
      if (threadIndex >= 0) demoThreads.splice(threadIndex, 1);
    }
  }
});
