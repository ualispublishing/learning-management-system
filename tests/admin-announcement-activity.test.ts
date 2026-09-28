import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canViewCourseAnnouncementActivity,
  selectCourseAnnouncementActivity,
  selectCourseAnnouncementThreads,
} from '../src/lib/chat/announcements';
import type { ChatMessage, ChatThread, CourseAnnouncement, CourseRole } from '../src/types/lms';

const thread = (overrides: Partial<ChatThread> = {}): ChatThread => ({
  id: 'announcements',
  courseId: 'course-1',
  title: 'Announcements',
  kind: 'announcements',
  isAnnouncement: true,
  isPinned: true,
  allowStudentPosts: false,
  scope: 'course',
  createdBy: 'teacher-1',
  createdAt: 10,
  ...overrides,
});

const message = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'message-1',
  threadId: 'announcements',
  senderId: 'teacher-1',
  senderName: 'Ada Teacher',
  role: 'teacher',
  text: 'Course update',
  timestamp: 100,
  readBy: 1,
  ...overrides,
});

test('announcement administration activity is visible to every staff role and never to learners', () => {
  const expected: Record<CourseRole, boolean> = {
    teacher: true,
    ta: true,
    it: true,
    admin: true,
    student: false,
  };
  Object.entries(expected).forEach(([role, allowed]) => {
    assert.equal(canViewCourseAnnouncementActivity(role as CourseRole), allowed, role);
  });
  assert.equal(canViewCourseAnnouncementActivity(null), false);
  assert.equal(canViewCourseAnnouncementActivity(undefined), false);
});

test('announcement thread selection is course-scoped, announcement-only, and deterministic', () => {
  const canonical = thread({ id: 'canonical', createdAt: 20 });
  const legacy = thread({ id: 'legacy', kind: 'discussion', isPinned: false, createdAt: 1 });
  const discussion = thread({ id: 'discussion', kind: 'discussion', isAnnouncement: false });
  const otherCourse = thread({ id: 'other', courseId: 'course-2' });
  assert.deepEqual(
    selectCourseAnnouncementThreads('course-1', [discussion, legacy, otherCourse, canonical]).map(candidate => candidate.id),
    ['canonical', 'legacy'],
  );
});

test('staff activity deduplicates bridge records, labels origins, and preserves withdrawal rules', () => {
  const legacy: CourseAnnouncement[] = [
    { id: 'content-linked', title: 'Week 2', content: 'Read chapter two.', type: 'info', createdAt: 300 },
    { id: 'withdrawn', title: 'Cancelled lab', content: 'This text must remain hidden.', type: 'alert', createdAt: 350 },
  ];
  const messages = {
    announcements: [
      message({
        id: 'linked-message',
        text: '📢 Week 2\n\nRead chapter two.',
        timestamp: 200,
        announcementId: 'content-linked',
        announcementTitle: 'Week 2',
        contentItemId: 'content-linked',
      }),
      message({ id: 'manual-message', text: 'The review session moved online.', timestamp: 400, editedAt: 410, revision: 2 }),
      message({
        id: 'hidden-content-message',
        text: 'Hidden linked notice',
        timestamp: 500,
        announcementId: 'hidden-content',
        contentItemId: 'hidden-content',
      }),
      message({
        id: 'withdrawn-message',
        text: '',
        timestamp: 340,
        announcementId: 'withdrawn',
        deletedAt: 360,
        revision: 2,
      }),
    ],
  };

  const activity = selectCourseAnnouncementActivity('course-1', legacy, [thread()], messages);
  assert.deepEqual(activity.map(entry => entry.messageId), [
    'hidden-content-message',
    'manual-message',
    'linked-message',
  ]);
  assert.equal(activity[0].activitySource, 'linked-content');
  assert.equal(activity[0].activityStatus, 'synced');
  assert.equal(activity[1].activitySource, 'chat');
  assert.equal(activity[1].activityStatus, 'edited');
  assert.equal(activity[2].activitySource, 'linked-content');
  assert.equal(activity[2].activityStatus, 'synced');
  assert.equal(activity[2].title, 'Week 2');
  assert.equal(activity.some(entry => entry.title === 'Cancelled lab'), false);

  const afterLinkedContentWithdrawal = selectCourseAnnouncementActivity(
    'course-1',
    legacy,
    [thread()],
    messages,
    ['hidden-content', 'content-linked'],
  );
  assert.deepEqual(afterLinkedContentWithdrawal.map(entry => entry.messageId), ['manual-message']);
});
