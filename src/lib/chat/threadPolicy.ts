/**
 * @fileoverview src/lib/chat/threadPolicy.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import { ChatMessage, ChatThread, Course, CourseRole, CourseUser } from '../../types/lms';
import { getGroupFromSet } from '../groups/courseGroups';
import { hasCoursePermission } from '../authorization/coursePermissions';
import { getCourseLifecyclePhase } from '../courseLifecycle';

export type ChatThreadPhase = 'scheduled' | 'active' | 'closed';

export const getChatThreadPhase = (thread: ChatThread, course: Course | undefined, now = Date.now()): ChatThreadPhase => {
  if (thread.scope === 'direct') return 'active';
  if (!course) return 'closed';
  const coursePhase = getCourseLifecyclePhase(course, now);
  if (coursePhase === 'future') return 'scheduled';
  if (coursePhase !== 'active') return 'closed';
  if (
    (thread.opensAt !== undefined && !Number.isFinite(thread.opensAt))
    || (thread.closesAt !== undefined && !Number.isFinite(thread.closesAt))
    || (thread.opensAt !== undefined && thread.closesAt !== undefined && thread.opensAt >= thread.closesAt)
  ) return 'closed';
  if (thread.opensAt !== undefined && now < thread.opensAt) return 'scheduled';
  if (thread.closesAt !== undefined && now >= thread.closesAt) return 'closed';
  return 'active';
};

export const canRolePostToThread = (
  thread: ChatThread,
  course: Course | undefined,
  role: CourseRole | undefined,
  now = Date.now(),
): boolean => {
  if (getChatThreadPhase(thread, course, now) !== 'active') return false;
  if (thread.scope === 'direct') return true;
  const staffCanPost = hasCoursePermission(role, 'postStaffChat');
  if (thread.isAnnouncement || thread.isLocked || thread.allowStudentPosts === false) return staffCanPost;
  return Boolean(role);
};

/** Re-evaluates thread visibility from the latest course role and group data. */
export const canUserAccessThread = (
  thread: ChatThread,
  course: Course | undefined,
  userId: string | null | undefined,
  role?: CourseRole,
): boolean => {
  if (!userId) return false;
  if (thread.scope === 'direct') return thread.participantIds?.includes(userId) === true;
  if (!course || !course.staff.some(member => member.id === userId)) return false;
  if (thread.scope !== 'group') return true;
  const group = getGroupFromSet(course, thread.groupSetId, thread.groupId);
  return hasCoursePermission(role, 'postStaffChat')
    || group?.memberIds.includes(userId) === true
    || (group !== undefined && thread.participantIds?.includes(userId) === true);
};

export const getMentionableUsers = (
  thread: ChatThread,
  course: Course | undefined,
  directoryUsers: CourseUser[],
): CourseUser[] => {
  if (thread.allowMentions === false) return [];
  const directoryById = new Map(directoryUsers.map(user => [user.id, user]));
  if (thread.scope === 'direct') {
    return (thread.participantIds || []).flatMap(id => directoryById.get(id) ? [directoryById.get(id)!] : []);
  }
  if (!course) return [];
  if (thread.scope !== 'group') return [...course.staff];
  const group = getGroupFromSet(course, thread.groupSetId, thread.groupId);
  return course.staff.filter(user =>
    hasCoursePermission(user.role, 'postStaffChat')
    || group?.memberIds.includes(user.id)
    || thread.participantIds?.includes(user.id),
  );
};

export const mentionedUserIdsInText = (text: string, users: CourseUser[]): string[] => {
  const normalizedNameCounts = users.reduce((counts, user) => {
    const key = user.name.normalize('NFKC').trim().toLocaleLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());
  return users
    // A manually typed display name is safe only when it identifies one user.
    // The composer separately retains the stable ID chosen from suggestions.
    .filter(user => normalizedNameCounts.get(user.name.normalize('NFKC').trim().toLocaleLowerCase()) === 1
      && hasVisibleMentionToken(text, user.name))
    .map(user => user.id);
};

const escapeRegularExpression = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Prevents a short display name such as "Ann" from matching "@Anna". */
export const hasVisibleMentionToken = (text: string, userName: string): boolean => {
  const normalizedText = text.normalize('NFKC');
  const normalizedName = userName.normalize('NFKC');
  if (!normalizedName.trim()) return false;
  return new RegExp(`(^|\\s)@${escapeRegularExpression(normalizedName)}(?=$|[\\s.,!?;:()\\[\\]{}])`, 'iu').test(normalizedText);
};

export const messageMentionsAreAuthorized = (
  message: Pick<ChatMessage, 'text' | 'mentionedUserIds'>,
  thread: ChatThread,
  course: Course | undefined,
  directoryUsers: CourseUser[],
): boolean => {
  if (!message.mentionedUserIds?.length) return true;
  const mentionableUsers = getMentionableUsers(thread, course, directoryUsers);
  const usersById = new Map(mentionableUsers.map(user => [user.id, user]));
  return thread.allowMentions !== false && message.mentionedUserIds.every(userId => {
    const user = usersById.get(userId);
    return Boolean(user && hasVisibleMentionToken(message.text, user.name));
  });
};
