/**
 * @fileoverview src/lib/authorization/coursePermissions.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import { CourseRole } from '../../types/lms';

export const COURSE_PERMISSION_ROLES = {
  manageContent: ['teacher', 'ta', 'admin'],
  grade: ['teacher', 'ta', 'admin'],
  hostLiveAssessment: ['teacher', 'ta', 'admin'],
  postStaffChat: ['teacher', 'ta', 'admin'],
  moderateChat: ['teacher', 'ta', 'admin'],
  manageChat: ['teacher', 'ta', 'admin'],
  manageCourse: ['teacher', 'it', 'admin'],
  viewRoster: ['teacher', 'ta', 'it', 'admin'],
  viewGradeAnalytics: ['teacher', 'ta', 'admin'],
} as const satisfies Record<string, readonly CourseRole[]>;

export type CoursePermission = keyof typeof COURSE_PERMISSION_ROLES;

export const hasCoursePermission = (
  role: CourseRole | null | undefined,
  permission: CoursePermission,
): boolean => {
  if (!role) return false;
  const allowedRoles: readonly CourseRole[] = COURSE_PERMISSION_ROLES[permission];
  return allowedRoles.includes(role);
};
