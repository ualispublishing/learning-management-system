/**
 * @fileoverview src/lib/privacy/principalDirectory.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import { ChatMessage, ChatThread, Course, CourseUser, StudentSubmission } from '../../types/lms';
import { hasCoursePermission } from '../authorization/coursePermissions';

/**
 * Chat discovery never needs contact data or institution extensions. Keeping
 * this projection in the repository layer prevents a future UI from exposing
 * fields that were merely hidden by today's components.
 */
export const toDiscoverableUser = (user: CourseUser): CourseUser => ({
  id: user.id,
  name: user.name,
  role: user.role,
});

/** Private roster views add only the disclosed contact field they consume. */
export const toPrivateRosterUser = (user: CourseUser): CourseUser => ({
  ...toDiscoverableUser(user),
  ...(user.email ? { email: user.email } : {}),
});

/** A learner needs roster identities for forums, mentions, and group access. */
export const projectCourseForPrincipal = (course: Course, principalId: string): Course => {
  const membership = course.staff.find(member => member.id === principalId);
  const canViewPrivateRoster = hasCoursePermission(membership?.role, 'viewRoster');
  return {
    ...course,
    staff: course.staff.map(member => canViewPrivateRoster
      ? {
          ...toPrivateRosterUser(member),
          ...(member.secondaryRoles?.length ? { secondaryRoles: [...member.secondaryRoles] } : {}),
        }
      : toDiscoverableUser(member)),
  };
};

/**
 * Users are discoverable only when they are part of the principal's course
 * roster or an existing direct conversation. Message/submission references are
 * included defensively so a valid historical record never loses its identity.
 */
export const principalDirectoryUserIds = (
  principalId: string,
  courses: Course[],
  threads: ChatThread[] = [],
  messages: ChatMessage[] = [],
  submissions: StudentSubmission[] = [],
): Set<string> => {
  const ids = new Set<string>([principalId]);
  courses.forEach(course => course.staff.forEach(member => ids.add(member.id)));
  threads.forEach(thread => {
    thread.participantIds?.forEach(id => ids.add(id));
    if (thread.createdBy) ids.add(thread.createdBy);
  });
  messages.forEach(message => {
    ids.add(message.senderId);
    message.mentionedUserIds?.forEach(id => ids.add(id));
    message.readByUserIds?.forEach(id => ids.add(id));
  });
  submissions.forEach(submission => {
    ids.add(submission.studentId);
    if (submission.gradedBy) ids.add(submission.gradedBy);
  });
  return ids;
};

export const projectDirectoryForPrincipal = (
  users: CourseUser[],
  principalId: string,
  courses: Course[],
  threads: ChatThread[] = [],
  messages: ChatMessage[] = [],
  submissions: StudentSubmission[] = [],
): CourseUser[] => {
  const discoverableIds = principalDirectoryUserIds(principalId, courses, threads, messages, submissions);
  return users.filter(user => discoverableIds.has(user.id)).map(toDiscoverableUser);
};
