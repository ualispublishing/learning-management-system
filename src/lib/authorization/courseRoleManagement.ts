/**
 * @fileoverview src/lib/authorization/courseRoleManagement.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import { CourseRole, CourseUser } from '../../types/lms';
import { hasCoursePermission } from './coursePermissions';

export const COURSE_ROLE_LABELS: Record<CourseRole, string> = {
  student: 'Student',
  ta: 'Teaching assistant',
  teacher: 'Teacher',
  it: 'IT',
  admin: 'Administrator',
};

const COURSE_ROLE_ORDER: CourseRole[] = ['student', 'ta', 'teacher', 'it', 'admin'];

/**
 * Teachers can manage instructional roles. IT and administrators can also
 * grant their own privileged role, while an existing privileged assignment is
 * always retained as a no-change choice so the UI never silently erases it.
 */
export const getAssignableCourseRoles = (
  managerRole: CourseRole,
  currentRole: CourseRole,
): CourseRole[] => {
  // A manager who cannot grant a privileged role must not be able to remove
  // that role either. Otherwise a teacher could demote an institution admin,
  // or IT could demote an admin, simply by deep-linking to the roster action.
  if (managerRole === 'teacher' && (currentRole === 'it' || currentRole === 'admin')) {
    return [currentRole];
  }
  if (managerRole === 'it' && currentRole === 'admin') return ['admin'];

  return COURSE_ROLE_ORDER.filter(role => (
    role === 'student'
    || role === 'ta'
    || role === 'teacher'
    || (role === 'it' && (managerRole === 'it' || managerRole === 'admin'))
    || (role === 'admin' && managerRole === 'admin')
  ));
};

/**
 * Prevents a course from becoming unmanageable when the authenticated user
 * changes their own enrollment. Server authorization remains authoritative;
 * this helper also gives the UI an immediate, accessible explanation.
 */
export const wouldRemoveLastCourseManager = (
  roster: CourseUser[],
  currentUserId: string | null,
  targetUserId: string,
  nextRole: CourseRole,
): boolean => {
  if (!currentUserId || targetUserId !== currentUserId) return false;
  const currentMembership = roster.find(member => member.id === currentUserId);
  if (!hasCoursePermission(currentMembership?.role, 'manageCourse')) return false;
  if (hasCoursePermission(nextRole, 'manageCourse')) return false;
  return !roster.some(member => (
    member.id !== currentUserId && hasCoursePermission(member.role, 'manageCourse')
  ));
};

export const LAST_COURSE_MANAGER_ERROR =
  'You are the only course manager. Assign another teacher, IT participant, or administrator before changing your own role.';
