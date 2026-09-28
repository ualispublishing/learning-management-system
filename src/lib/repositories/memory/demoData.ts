/**
 * @fileoverview src/lib/repositories/memory/demoData.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import customCodeJson from '../../../assets/mock-courses/custom_code.json';
import customLinkJson from '../../../assets/mock-courses/custom_link.json';
import sequentialJson from '../../../assets/mock-courses/sequential.json';
import timelineJson from '../../../assets/mock-courses/timeline.json';
import usersJson from '../../../assets/mock-institution/users.json';
import { ChatMessage, ChatThread, ContentItem, Course, CourseUser } from '../../../types/lms';
import { formatValidationIssues, NormalizedCourseImport, validateCourseImport } from '../../schema/CourseSchema';

const users = usersJson as CourseUser[];
const rawCourses: unknown[] = [timelineJson, sequentialJson, customLinkJson, customCodeJson];

const normalizeDemoCourse = (payload: unknown, index: number): NormalizedCourseImport => {
  const result = validateCourseImport(payload, users, `demoCourses[${index}]`);
  if (!result.success) {
    throw new Error(`Bundled LMS demo data is invalid:\n${formatValidationIssues(result.issues)}`);
  }
  return result.data;
};

const normalizedCourses = rawCourses.map(normalizeDemoCourse);
const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;
const now = Date.now();

export const demoUsers: CourseUser[] = users.map(user => ({ ...user }));
export const demoCourses: Course[] = normalizedCourses.map(entry => ({
  ...entry.course,
  // Keep the bundled active-course fixtures genuinely inside their term so
  // lifecycle behavior remains testable years after the static JSON was authored.
  ...(entry.course.status === 'active' ? { termStart: now - 30 * day, termEnd: now + 90 * day } : {}),
}));
export const demoContentItems: ContentItem[] = normalizedCourses.flatMap(entry => entry.items.map(item => ({ ...item })));

export const demoThreads: ChatThread[] = [
  { id: 'c1_announcements', courseId: 'c1', title: 'Announcements', description: 'Official course updates, deadline changes, and urgent notices.', guidelines: 'Use replies only when staff explicitly request acknowledgement or questions.', kind: 'announcements', isAnnouncement: true, isPinned: true, allowStudentPosts: false, allowReplies: true, allowAttachments: true, allowMentions: true, scope: 'course', createdBy: 'u1', createdAt: now - 30 * day, updatedAt: now - 2 * hour },
  { id: 'c1_general', courseId: 'c1', title: 'General Discussion', description: 'Ask course-wide questions and continue lecture discussions.', guidelines: 'Be specific, search before posting, cite shared material, and never post assessment answers.', kind: 'discussion', isAnnouncement: false, isPinned: true, allowStudentPosts: true, allowReplies: true, allowAttachments: true, allowMentions: true, scope: 'course', createdBy: 'u1', createdAt: now - 30 * day, updatedAt: now - 25 * minute },
  { id: 'c1_homework', courseId: 'c1', title: 'Homework Help', description: 'A question-and-answer space for conceptual assignment help.', guidelines: 'Explain approaches without posting complete solutions or answer keys.', kind: 'q-and-a', isAnnouncement: false, allowStudentPosts: true, allowReplies: true, allowAttachments: false, allowMentions: true, scope: 'course', createdBy: 'u2', createdAt: now - 12 * day, updatedAt: now - 50 * minute },
  { id: 'c1_office_hours', courseId: 'c1', title: 'Live Office Hours', description: 'Chat with the teaching team during the scheduled help window.', guidelines: 'Keep personal accommodations and grade disputes in direct messages.', kind: 'office-hours', isAnnouncement: false, allowStudentPosts: true, allowReplies: true, allowAttachments: true, allowMentions: true, opensAt: now - hour, closesAt: now + 2 * hour, scope: 'course', createdBy: 'u1', createdAt: now - 2 * day, updatedAt: now - 20 * minute },
  { id: 'c1_group_a', courseId: 'c1', title: 'Group A Project', description: 'Private coordination space for the Group A term project.', guidelines: 'Record decisions and assign owners so absent teammates can catch up.', kind: 'study-group', isAnnouncement: false, allowStudentPosts: true, allowReplies: true, allowAttachments: true, allowMentions: true, scope: 'group', groupSetId: 'project-groups', groupId: 'Group A', participantIds: ['u3', 'u4'], createdBy: 'u1', createdAt: now - 8 * day, updatedAt: now - 10 * minute },
  { id: 'c2_announcements', courseId: 'c2', title: 'Announcements', description: 'Official sequential-course updates.', kind: 'announcements', isAnnouncement: true, isPinned: true, allowStudentPosts: false, allowReplies: true, allowAttachments: true, allowMentions: true, scope: 'course', createdBy: 'u1', createdAt: now - 21 * day },
  { id: 'c2_general', courseId: 'c2', title: 'General Discussion', description: 'Course questions and peer discussion.', kind: 'discussion', isAnnouncement: false, allowStudentPosts: true, allowReplies: true, allowAttachments: true, allowMentions: true, scope: 'course', createdBy: 'u1', createdAt: now - 21 * day, updatedAt: now - 4 * hour },
  { id: 'c3_announcements', courseId: 'c3', title: 'Announcements', description: 'Official linked-course updates.', kind: 'announcements', isAnnouncement: true, isPinned: true, allowStudentPosts: false, allowReplies: true, allowAttachments: true, allowMentions: true, scope: 'course', createdBy: 'u1', createdAt: now - 18 * day },
  { id: 'c3_general', courseId: 'c3', title: 'Resource Sharing', description: 'Share accessible supplemental resources with the class.', kind: 'discussion', isAnnouncement: false, allowStudentPosts: true, allowReplies: true, allowAttachments: true, allowMentions: true, scope: 'course', createdBy: 'u2', createdAt: now - 18 * day, updatedAt: now - 1 * day },
  { id: 'c4_announcements', courseId: 'c4', title: 'Announcements', description: 'Official custom-course updates.', kind: 'announcements', isAnnouncement: true, isPinned: true, allowStudentPosts: false, allowReplies: true, allowAttachments: true, allowMentions: true, scope: 'course', createdBy: 'u1', createdAt: now - 15 * day },
  { id: 'c4_general', courseId: 'c4', title: 'Code Lab', description: 'Troubleshoot the static widget lab and compare implementation approaches.', kind: 'q-and-a', isAnnouncement: false, allowStudentPosts: true, allowReplies: true, allowAttachments: true, allowMentions: true, scope: 'course', createdBy: 'u2', createdAt: now - 15 * day, updatedAt: now - 3 * hour },
  { id: 'dm_u1_u2', title: 'John Doe', isAnnouncement: false, scope: 'direct', participantIds: ['u1', 'u2'], createdBy: 'u1', createdAt: now - 20 * day, updatedAt: now - 35 * minute },
  { id: 'dm_u1_u3', title: 'Alice Student', isAnnouncement: false, scope: 'direct', participantIds: ['u1', 'u3'], createdBy: 'u3', createdAt: now - 6 * day, updatedAt: now - 12 * minute },
  { id: 'dm_u3_u4', title: 'Bob Student', isAnnouncement: false, scope: 'direct', participantIds: ['u3', 'u4'], createdBy: 'u3', createdAt: now - 4 * day, updatedAt: now - 5 * minute },
];

export const demoMessages: ChatMessage[] = [
  { id: 'msg_001', threadId: 'c1_announcements', senderId: 'u1', senderName: 'Dr. Smith', role: 'teacher', text: 'Welcome to the course. The syllabus and first module are now available.', timestamp: now - 2 * day, readBy: 4 },
  { id: 'msg_002', threadId: 'c1_announcements', senderId: 'u2', senderName: 'John Doe', role: 'ta', text: 'Office hours move to Room 204 this Thursday.', timestamp: now - 2 * hour, readBy: 2 },
  { id: 'msg_003', threadId: 'c1_general', senderId: 'u3', senderName: 'Alice Student', role: 'student', text: '@Bob Student, does anyone want to compare notes from the recursion lecture?', mentionedUserIds: ['u4'], timestamp: now - 70 * minute, readBy: 3 },
  { id: 'msg_004', threadId: 'c1_general', senderId: 'u4', senderName: 'Bob Student', role: 'student', text: 'Yes—I can share my diagram after class.', timestamp: now - 48 * minute, readBy: 2, replyToMessageId: 'msg_003' },
  { id: 'msg_005', threadId: 'c1_general', senderId: 'u2', senderName: 'John Doe', role: 'ta', text: 'Please keep answer keys out of the public channel, but collaborative explanations are encouraged.', timestamp: now - 25 * minute, readBy: 1 },
  { id: 'msg_006', threadId: 'c1_homework', senderId: 'u4', senderName: 'Bob Student', role: 'student', text: 'I am stuck on the stopping condition in problem 2. Is there a hint?', timestamp: now - 95 * minute, readBy: 2 },
  { id: 'msg_007', threadId: 'c1_homework', senderId: 'u3', senderName: 'Alice Student', role: 'student', text: 'Try writing out the smallest valid input first; that made the base case clearer for me.', timestamp: now - 50 * minute, readBy: 1, replyToMessageId: 'msg_006' },
  { id: 'msg_008', threadId: 'c1_group_a', senderId: 'u3', senderName: 'Alice Student', role: 'student', text: 'I drafted the introduction. Bob, can you review it before tonight?', timestamp: now - 30 * minute, readBy: 1 },
  { id: 'msg_009', threadId: 'c1_group_a', senderId: 'u4', senderName: 'Bob Student', role: 'student', text: 'On it. I will also add the runtime comparison table.', timestamp: now - 10 * minute, readBy: 1 },
  { id: 'msg_010', threadId: 'c2_general', senderId: 'u5', senderName: 'Charlie Student', role: 'student', text: 'The Week 2 reading link is working for me now.', timestamp: now - 4 * hour, readBy: 3 },
  { id: 'msg_011', threadId: 'c3_general', senderId: 'u2', senderName: 'John Doe', role: 'ta', text: 'Post accessible alternatives here when an external resource is unavailable.', timestamp: now - 1 * day, readBy: 4 },
  { id: 'msg_012', threadId: 'c4_general', senderId: 'u4', senderName: 'Bob Student', role: 'student', text: 'The code lab reset fixed my preview. Thanks!', timestamp: now - 3 * hour, readBy: 2 },
  { id: 'msg_013', threadId: 'dm_u1_u2', senderId: 'u2', senderName: 'John Doe', role: 'ta', text: 'I finished reviewing the first assessment submissions.', timestamp: now - 55 * minute, readBy: 1 },
  { id: 'msg_014', threadId: 'dm_u1_u2', senderId: 'u1', senderName: 'Dr. Smith', role: 'teacher', text: 'Great. Please flag any rubric edge cases before grades are released.', timestamp: now - 35 * minute, readBy: 1 },
  { id: 'msg_015', threadId: 'dm_u1_u3', senderId: 'u3', senderName: 'Alice Student', role: 'student', text: 'Could I discuss an accommodation for the timed assessment?', timestamp: now - 22 * minute, readBy: 1 },
  { id: 'msg_016', threadId: 'dm_u1_u3', senderId: 'u1', senderName: 'Dr. Smith', role: 'teacher', text: 'Yes. I will send you a private appointment slot; no need to share details here.', timestamp: now - 12 * minute, readBy: 1 },
  { id: 'msg_017', threadId: 'dm_u3_u4', senderId: 'u3', senderName: 'Alice Student', role: 'student', text: 'Are you joining the study room at 6?', timestamp: now - 8 * minute, readBy: 1 },
  { id: 'msg_018', threadId: 'dm_u3_u4', senderId: 'u4', senderName: 'Bob Student', role: 'student', text: 'Yes, I will bring the practice questions.', timestamp: now - 5 * minute, readBy: 0 },
  { id: 'msg_019', threadId: 'c1_office_hours', senderId: 'u1', senderName: 'Dr. Smith', role: 'teacher', text: 'Office hours are live for the next two hours. Post conceptual questions here or start a direct message for private matters.', timestamp: now - 45 * minute, readBy: 2 },
  { id: 'msg_020', threadId: 'c1_office_hours', senderId: 'u3', senderName: 'Alice Student', role: 'student', text: '@John Doe could you clarify whether the recursive helper may return a tuple?', mentionedUserIds: ['u2'], timestamp: now - 20 * minute, readBy: 1 },
];
