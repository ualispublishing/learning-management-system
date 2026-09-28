import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deriveCoursePopupAnnouncements,
  selectCourseAnnouncementThread,
  selectNewestVisibleCoursePopupAnnouncement,
} from '../src/lib/chat/announcements';
import { validateInstitutionSync } from '../src/lib/schema/CourseSchema';
import { validateRealtimeChatMessages } from '../src/lib/store/slices/chatSlice';
import type { ChatMessage, ChatThread, CourseAnnouncement } from '../src/types/lms';

const announcementThread: ChatThread = {
  id: 'thread-announcements',
  courseId: 'course-1',
  title: 'Announcements',
  isAnnouncement: true,
  kind: 'announcements',
  allowStudentPosts: false,
  scope: 'course',
  createdBy: 'teacher-1',
  createdAt: 10,
};

const message = (overrides: Partial<ChatMessage>): ChatMessage => ({
  id: 'message-1',
  threadId: announcementThread.id,
  senderId: 'teacher-1',
  senderName: 'Ada Teacher',
  role: 'teacher',
  text: 'Course update',
  timestamp: 100,
  readBy: 1,
  ...overrides,
});

test('course popup announcements merge newest legacy and chat items with stable cross-source dedupe', () => {
  const legacy: CourseAnnouncement[] = [
    // A migrated legacy timestamp may be slightly later than its linked chat
    // delivery. The merged item should still retain the exact message target.
    { id: 'announcement-week-1', title: 'Week 1', content: 'Read chapter one.', type: 'info', createdAt: 220 },
    { id: 'announcement-alert', title: 'Room change', content: 'Meet in room 204.', type: 'alert', createdAt: 250 },
  ];
  const discussionThread: ChatThread = { ...announcementThread, id: 'thread-discussion', title: 'Discussion', isAnnouncement: false, kind: 'discussion' };
  const result = deriveCoursePopupAnnouncements(
    'course-1',
    legacy,
    [announcementThread, discussionThread],
    {
      [announcementThread.id]: [
        message({
          id: 'message-admin-original',
          text: '📢 Week 1\n\nRead chapter one.',
          timestamp: 200,
          announcementId: 'announcement-week-1',
          announcementTitle: 'Week 1',
          announcementSeverity: 'info',
          contentItemId: 'content-week-1',
        }),
        message({
          id: 'message-admin-retry',
          text: '📢 Week 1\n\nRead chapter one.',
          timestamp: 210,
          announcementId: 'announcement-week-1',
          announcementTitle: 'Week 1',
          announcementSeverity: 'info',
          contentItemId: 'content-week-1',
        }),
        message({ id: 'message-manual', text: 'The lab opens early today.', timestamp: 300, senderName: 'Taylor TA', role: 'ta' }),
        message({ id: 'message-deleted', text: 'Withdrawn update', timestamp: 500, deletedAt: 501, revision: 2 }),
      ],
      [discussionThread.id]: [message({ id: 'message-discussion', threadId: discussionThread.id, timestamp: 600 })],
    },
  );

  assert.deepEqual(result.map(entry => entry.messageId ?? entry.title), [
    'message-manual',
    'Room change',
    'message-admin-retry',
  ]);
  assert.equal(result[0].title, 'Announcement from Taylor TA');
  assert.equal(result[0].threadId, announcementThread.id);
  assert.equal(result[0].messageId, 'message-manual');
  assert.equal(result[2].title, 'Week 1');
  assert.equal(result[2].content, 'Read chapter one.');
  assert.equal(result[2].contentItemId, 'content-week-1');
  assert.ok(result[2].dismissalAliases.includes('announcement-week-1'));
});

test('identical intentional chat posts are retained while only cross-source legacy duplicates collapse', () => {
  const duplicate = message({ id: 'message-duplicate-a', text: 'Same reminder', timestamp: 200 });
  const result = deriveCoursePopupAnnouncements(
    'course-1',
    [{ id: 'legacy-same', title: 'Announcement from Ada Teacher', content: 'Same reminder', type: 'info', createdAt: 100 }],
    [announcementThread],
    { [announcementThread.id]: [duplicate, { ...duplicate, id: 'message-duplicate-b', timestamp: 201 }] },
  );
  assert.deepEqual(result.map(entry => entry.messageId), ['message-duplicate-b', 'message-duplicate-a']);
});

test('an edited visible announcement marker supersedes its original metadata title', () => {
  const [result] = deriveCoursePopupAnnouncements(
    'course-1',
    [],
    [announcementThread],
    { [announcementThread.id]: [message({
      text: '📢 Corrected title\n\nCorrected details.',
      announcementTitle: 'Original title',
      editedAt: 101,
      revision: 2,
    })] },
  );
  assert.equal(result.title, 'Corrected title');
  assert.equal(result.content, 'Corrected details.');
});

test('editedAt drives popup recency and a revisioned Chat correction supersedes stale linked legacy presentation', () => {
  const results = deriveCoursePopupAnnouncements(
    'course-1',
    [
      { id: 'linked-correction', title: 'Stale title', content: 'Stale details.', type: 'alert', createdAt: 900 },
      { id: 'ordinary-reminder', title: 'Ordinary reminder', content: 'Still current.', type: 'info', createdAt: 400 },
    ],
    [announcementThread],
    { [announcementThread.id]: [message({
      id: 'linked-correction',
      text: '📢 Corrected title\n\nCorrected details.',
      timestamp: 100,
      editedAt: 500,
      revision: 2,
      announcementId: 'linked-correction',
      announcementTitle: 'Stale title',
      announcementSeverity: 'info',
      contentItemId: 'linked-correction',
    })] },
  );

  assert.deepEqual(results.map(result => result.title), ['Corrected title', 'Ordinary reminder']);
  assert.equal(results[0].createdAt, 100, 'The original publication timestamp remains auditable.');
  assert.equal(results[0].activityAt, 500, 'The latest authoritative edit controls recency.');
  assert.equal(results[0].content, 'Corrected details.');
  assert.equal(results[0].type, 'info');
  assert.equal(results[0].source, 'chat');
});

test('a linked chat tombstone withdraws its migrated legacy popup without exposing deleted content', () => {
  const result = deriveCoursePopupAnnouncements(
    'course-1',
    [{ id: 'withdrawn-1', title: 'Withdrawn', content: 'Old details', type: 'info', createdAt: 100 }],
    [announcementThread],
    { [announcementThread.id]: [message({
      id: 'withdrawn-message', announcementId: 'withdrawn-1', text: 'Retained deleted text',
      deletedAt: 201, revision: 2, timestamp: 200,
    })] },
  );
  assert.deepEqual(result, []);
});

test('admin delivery selects a deterministic canonical announcement thread', () => {
  const legacy = { ...announcementThread, id: 'legacy', kind: 'discussion' as const, createdAt: 1 };
  const canonical = { ...announcementThread, id: 'canonical', kind: 'announcements' as const, isPinned: true, createdAt: 2 };
  assert.equal(selectCourseAnnouncementThread('course-1', [legacy, canonical])?.id, 'canonical');
  assert.equal(selectCourseAnnouncementThread('another-course', [legacy, canonical]), undefined);
});

test('one global popup is elected across courses and every migration alias dismisses it', () => {
  const courseTwoThread = { ...announcementThread, id: 'course-2-announcements', courseId: 'course-2' };
  const courseTwoMessage = message({
    id: 'course-2-message',
    threadId: courseTwoThread.id,
    timestamp: 500,
    text: '📢 Newest update\n\nDetails',
    announcementId: 'course-2-content',
    contentItemId: 'course-2-content',
  });
  const courses = [
    { id: 'course-1', status: 'active' as const, announcements: [{ id: 'legacy-1', title: 'Earlier', content: 'Earlier details', type: 'info' as const, createdAt: 100 }] },
    { id: 'course-2', status: 'active' as const, announcements: [] },
    { id: 'course-past', status: 'past' as const, announcements: [{ id: 'past-newest', title: 'Past', content: 'Hidden', type: 'alert' as const, createdAt: 1_000 }] },
  ];
  const threads = [announcementThread, courseTwoThread];
  const messages = { [courseTwoThread.id]: [courseTwoMessage] };

  const newest = selectNewestVisibleCoursePopupAnnouncement(courses, threads, messages, []);
  assert.equal(newest?.courseId, 'course-2');
  assert.equal(newest?.announcement.messageId, courseTwoMessage.id);
  assert.ok(newest?.announcement.dismissalAliases.includes('course-2:announcement:course-2-content'));
  assert.ok(newest?.announcement.dismissalAliases.includes('course-2:content:course-2-content'));
  assert.ok(newest?.announcement.dismissalAliases.includes('course-2:message:course-2-message'));

  const afterDismissal = selectNewestVisibleCoursePopupAnnouncement(
    courses,
    threads,
    messages,
    ['course-2:message:course-2-message'],
  );
  assert.equal(afterDismissal?.courseId, 'course-1');
  assert.equal(afterDismissal?.announcement.title, 'Earlier');

  const afterContentDeletion = selectNewestVisibleCoursePopupAnnouncement(
    courses,
    threads,
    messages,
    [],
    ['course-2-content'],
  );
  assert.equal(afterContentDeletion?.courseId, 'course-1');
});

test('an active-status course whose term ended cannot suppress current-course popups', () => {
  const now = 2_000;
  const courses = [
    { id: 'current', status: 'active' as const, termEnd: now + 1, announcements: [{ id: 'current-notice', title: 'Current', content: 'Visible', type: 'info' as const, createdAt: 100 }] },
    { id: 'ended', status: 'active' as const, termEnd: now, announcements: [{ id: 'ended-notice', title: 'Ended', content: 'Must not win', type: 'alert' as const, createdAt: 1_000 }] },
  ];

  const newest = selectNewestVisibleCoursePopupAnnouncement(courses, [], {}, [], [], now);
  assert.equal(newest?.courseId, 'current');
  assert.equal(newest?.announcement.title, 'Current');
});

const institutionPayload = () => ({
  schemaVersion: '1.0',
  syncId: 'announcement-sync',
  generatedAt: 1_000,
  mode: 'snapshot',
  institution: { id: 'institution-1', name: 'Example University', timeZone: 'America/Toronto' },
  users: [
    { id: 'teacher-1', name: 'Ada Teacher', role: 'teacher' },
    { id: 'student-1', name: 'Sam Student', role: 'student' },
  ],
  courses: [{
    course: {
      id: 'course-1',
      title: 'Learning Systems',
      status: 'active',
      description: '',
      presentationMode: 'timeline',
      termStart: 1,
      termEnd: 10_000,
      gradingWeights: { Assignments: 100 },
      visibilityTimer: 0,
      announcements: [],
    },
    enrollments: [
      { userId: 'teacher-1', courseRole: 'teacher' },
      { userId: 'student-1', courseRole: 'student' },
    ],
    items: [{
      id: 'content-week-1',
      category: 'admin',
      title: 'Week 1',
      description: 'Read chapter one.',
      presentationSlot: 'current',
      createdAt: 20,
    }],
  }],
  threads: [{
    ...announcementThread,
    createdAt: 10,
  }],
  messages: [{
    ...message({
      id: 'message-admin',
      text: '📢 Week 1\n\nRead chapter one.',
      timestamp: 30,
      announcementId: ' announcement-week-1 ',
      announcementTitle: ' Week 1 ',
      announcementSeverity: 'alert',
      contentItemId: ' content-week-1 ',
    }),
  }],
  submissions: [],
});

test('institution schema normalizes bounded announcement provenance and verifies its content relationship', () => {
  const result = validateInstitutionSync(institutionPayload());
  assert.equal(result.success, true, result.success ? 'Payload is valid.' : result.issues.map(issue => issue.message).join('\n'));
  if (!result.success) return;
  assert.equal(result.data.messages?.[0].announcementId, 'announcement-week-1');
  assert.equal(result.data.messages?.[0].announcementTitle, 'Week 1');
  assert.equal(result.data.messages?.[0].announcementSeverity, 'alert');
  assert.equal(result.data.messages?.[0].contentItemId, 'content-week-1');
});

test('institution schema rejects invalid, misplaced, or cross-course announcement provenance', () => {
  const invalidSeverity: any = institutionPayload();
  invalidSeverity.messages[0].announcementSeverity = 'urgent';
  let result = validateInstitutionSync(invalidSeverity);
  assert.equal(result.success, false);
  if (!result.success) assert.ok(result.issues.some(issue => issue.code === 'invalid_announcement_severity'));

  const misplaced: any = institutionPayload();
  Object.assign(misplaced.threads[0], { isAnnouncement: false, kind: 'discussion', allowStudentPosts: true });
  result = validateInstitutionSync(misplaced);
  assert.equal(result.success, false);
  if (!result.success) assert.ok(result.issues.some(issue => issue.code === 'announcement_metadata_outside_announcement_thread'));

  const unknownContent: any = institutionPayload();
  unknownContent.messages[0].contentItemId = 'missing-item';
  result = validateInstitutionSync(unknownContent);
  assert.equal(result.success, false);
  if (!result.success) assert.ok(result.issues.some(issue => issue.code === 'unknown_announcement_content_item'));
});

test('real-time announcement metadata is bounded, normalized, and rejects unsupported severity', () => {
  const base = message({
    announcementId: ' announcement-1 ',
    announcementTitle: ' Course update ',
    announcementSeverity: 'info',
    contentItemId: ' content-1 ',
  });
  const valid = validateRealtimeChatMessages(announcementThread.id, [base]);
  assert.equal(valid.success, true);
  if (valid.success) {
    assert.equal(valid.messages[0].announcementId, 'announcement-1');
    assert.equal(valid.messages[0].announcementTitle, 'Course update');
    assert.equal(valid.messages[0].contentItemId, 'content-1');
  }
  assert.equal(validateRealtimeChatMessages(announcementThread.id, [{ ...base, announcementSeverity: 'urgent' }]).success, false);
  assert.equal(validateRealtimeChatMessages(announcementThread.id, [{ ...base, announcementId: 'a'.repeat(257) }]).success, false);
  assert.equal(validateRealtimeChatMessages(announcementThread.id, [{ ...base, announcementTitle: 't'.repeat(501) }]).success, false);
});
