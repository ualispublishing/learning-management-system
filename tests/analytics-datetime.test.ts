import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateCourseAnalytics } from '../src/lib/analytics/courseAnalytics';
import { formatContentDateTimeForEditor, normalizeContentDateTime, parseContentDateTime } from '../src/lib/contentDateTime';
import { isContentLockedAt } from '../src/lib/contentAvailability';
import { validateRealtimeChatMessages } from '../src/lib/store/slices/chatSlice';
import { ContentItem, Course, StudentSubmission } from '../src/types/lms';

const course: Course = {
  id: 'course-1', title: 'Analytics', status: 'active', description: '', presentationMode: 'timeline',
  participantsCount: 2, materialsCount: 2, announcements: [], termStart: 1, termEnd: 2,
  gradingWeights: { Exams: 60, Assignments: 40 }, visibilityTimer: 0,
  groupSets: [{ id: 'projects', name: 'Project Groups', groups: [{ id: 'group-a', name: 'Group A', memberIds: ['student-a', 'student-b'] }] }],
  staff: [
    { id: 'student-a', name: 'A', email: 'a@example.edu', role: 'student', secondaryRoles: ['Section 01'] },
    { id: 'student-b', name: 'B', email: 'b@example.edu', role: 'student', secondaryRoles: ['Section 01'] },
  ],
};
const question = { id: 'q', label: '1', content: 'Answer', answerType: 'text' as const, points: 100 };
const items: ContentItem[] = [
  { id: 'exam', courseId: course.id, category: 'coursework', title: 'Exam', presentationSlot: 'past', createdAt: 1, isGraded: true, gradingCategory: 'Exams', questions: [question] },
  { id: 'group', courseId: course.id, category: 'coursework', title: 'Group work', presentationSlot: 'past', createdAt: 1, isGraded: true, gradingCategory: 'Assignments', workType: 'group', groupSetId: 'projects', questions: [question] },
];
const submission = (overrides: Partial<StudentSubmission>): StudentSubmission => ({
  id: String(overrides.id), studentId: 'student-a', contentItemId: 'exam', courseId: course.id,
  submittedAt: 2_000, startedAt: 1_000, status: 'graded', gradeStatus: 'released', gradedBy: 'teacher', gradedAt: 2_000,
  responses: [{ questionId: 'q', answer: 'x', score: 0 }], totalScore: 0, ...overrides,
});

test('content scheduling uses canonical, strict, cross-platform date-times', () => {
  assert.equal(parseContentDateTime('2026-09-15T23:59:00-04:00'), Date.parse('2026-09-16T03:59:00Z'));
  assert.equal(normalizeContentDateTime('2026-09-15T23:59:00-04:00'), '2026-09-16T03:59:00.000Z');
  assert.equal(parseContentDateTime('2026-02-31 11:59 PM'), undefined);
  assert.equal(parseContentDateTime('2026-09-15 13:99 PM'), undefined);
  assert.equal(parseContentDateTime('2026-09-15'), undefined);
});

test('course-zone scheduling is stable across devices and rejects DST gaps or ambiguity', () => {
  const zone = 'America/Toronto';
  assert.equal(parseContentDateTime('2026-09-15 11:59 PM', zone), Date.parse('2026-09-16T03:59:00Z'));
  assert.equal(normalizeContentDateTime('2026-09-15 11:59 PM', zone), '2026-09-16T03:59:00.000Z');
  assert.equal(formatContentDateTimeForEditor('2026-09-16T03:59:00Z', zone), '2026-09-15 11:59 PM');
  assert.equal(parseContentDateTime('2026-03-08 02:30 AM', zone), undefined);
  assert.equal(parseContentDateTime('2026-11-01 01:30 AM', zone), undefined);
});

test('course analytics uses released latest attempts, weighted categories, and group membership', () => {
  const submissions = [
    submission({ id: 'a-exam-1', attemptNumber: 1, totalScore: 50 }),
    submission({ id: 'a-exam-2', attemptNumber: 2, totalScore: 80, submittedAt: 3_000, gradedAt: 3_000 }),
    submission({ id: 'b-exam', studentId: 'student-b', totalScore: 100 }),
    submission({ id: 'group-a', contentItemId: 'group', groupId: 'group-a', totalScore: 50 }),
    submission({ id: 'unreleased', totalScore: 100, gradeStatus: 'draft' }),
  ];
  const result = calculateCourseAnalytics(course, items, submissions);
  assert.equal(Math.round(result.studentRows.find(row => row.student.id === 'student-a')?.gradePercent || 0), 68);
  assert.equal(Math.round(result.studentRows.find(row => row.student.id === 'student-b')?.gradePercent || 0), 80);
  assert.equal(Math.round(result.averageGradePercent || 0), 74);
  assert.equal(result.studentRows.every(row => row.submissionCount === 2), true);
});

test('realtime chat rejects cross-thread and unsafe attachment events', () => {
  const base = { id: 'm1', threadId: 'thread-1', senderId: 'u1', senderName: 'User', role: 'student', text: 'hello', timestamp: 100, readBy: 1 };
  assert.equal(validateRealtimeChatMessages('thread-1', [{ ...base, threadId: 'thread-2' }]).success, false);
  assert.equal(validateRealtimeChatMessages('thread-1', [{ ...base, mediaUrl: 'javascript:alert(1)', mediaType: 'image' }]).success, false);
  assert.equal(validateRealtimeChatMessages('thread-1', [{ ...base, hidden: true }]).success, false);
  assert.equal(validateRealtimeChatMessages('thread-1', [base, base]).success, false);
  assert.equal(validateRealtimeChatMessages('thread-1', [{ ...base, readBy: 2, readByUserIds: ['u1'] }]).success, false);
  assert.equal(validateRealtimeChatMessages('thread-1', [base]).success, true);
});

test('all release and lock fields fail closed before learner content rendering', () => {
  const now = Date.UTC(2026, 6, 19, 12);
  const base: ContentItem = {
    id: 'material-1', courseId: 'course-1', category: 'material', title: 'Private material',
    presentationSlot: 'current', createdAt: now - 1,
  };
  assert.equal(isContentLockedAt({ ...base, releaseDate: now + 1 }, now), true);
  assert.equal(isContentLockedAt({ ...base, lockDate: now }, now), true);
  assert.equal(isContentLockedAt({ ...base, availableDate: '2026-07-20T00:00:00Z' }, now), true);
  assert.equal(isContentLockedAt({ ...base, availableDate: 'invalid' }, now), true);
  assert.equal(isContentLockedAt({ ...base, presentationSlot: 'future' }, now), true);
  assert.equal(isContentLockedAt({ ...base, availableDate: '2026-07-19T00:00:00Z' }, now), false);
  assert.equal(isContentLockedAt({ ...base, releaseDate: Number.NaN }, now), true);
  assert.equal(isContentLockedAt({ ...base, lockDate: Number.POSITIVE_INFINITY }, now), true);
  assert.equal(isContentLockedAt({ ...base, presentationSlot: 'corrupt' as ContentItem['presentationSlot'] }, now), true);
  assert.equal(isContentLockedAt(base, Number.NaN), true);
});
