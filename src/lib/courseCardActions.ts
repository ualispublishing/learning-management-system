/**
 * @fileoverview src/lib/courseCardActions.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import type { CourseRole } from '../types/lms';
import { hasCoursePermission } from './authorization/coursePermissions';

export type CourseCardActionId =
  | 'info'
  | 'syllabus'
  | 'student_grades'
  | 'grading'
  | 'settings'
  | 'analytics'
  | 'roster'
  | 'contact';

export interface CourseCardActionDescriptor {
  id: CourseCardActionId;
  icon: string;
  label: string;
  destination: 'modal' | 'roster';
}

const sharedActions: CourseCardActionDescriptor[] = [
  { id: 'info', icon: 'information-circle-outline', label: 'Course Info', destination: 'modal' },
  { id: 'syllabus', icon: 'document-text-outline', label: 'Syllabus', destination: 'modal' },
];

/**
 * The executable contract behind every CourseCard action button. Keeping role
 * filtering independent of React lets interaction tests verify the exact
 * modal/route outputs without granting a browser access to localhost.
 */
export const getCourseCardActionDescriptors = (
  role: CourseRole | null | undefined,
): CourseCardActionDescriptor[] => {
  if (!role || role === 'student') {
    return [
      ...sharedActions,
      { id: 'student_grades', icon: 'star-outline', label: 'View Grades', destination: 'modal' },
      { id: 'contact', icon: 'people-outline', label: 'Contact', destination: 'modal' },
    ];
  }

  return [
    ...sharedActions,
    ...(hasCoursePermission(role, 'grade')
      ? [{ id: 'grading', icon: 'checkmark-done-outline', label: 'Grading & Poll Results', destination: 'modal' } as const]
      : []),
    ...(hasCoursePermission(role, 'manageCourse')
      ? [{ id: 'settings', icon: 'settings-outline', label: 'Settings', destination: 'modal' } as const]
      : []),
    ...(hasCoursePermission(role, 'viewGradeAnalytics')
      ? [{ id: 'analytics', icon: 'bar-chart-outline', label: 'View Analytics', destination: 'modal' } as const]
      : []),
    ...(hasCoursePermission(role, 'viewRoster')
      ? [{ id: 'roster', icon: 'list-outline', label: 'Participant Roster', destination: 'roster' } as const]
      : []),
    { id: 'contact', icon: 'people-outline', label: 'Contact', destination: 'modal' },
  ];
};
