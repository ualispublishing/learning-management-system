/**
 * @fileoverview src/lib/store/selectors.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import { CourseRole, CourseUser } from '../../types/lms';
import { useLMSStore } from './useLMSStore';

export const useCourseMembership = (courseId: string): CourseUser | undefined =>
  useLMSStore(state => {
    const course = state.courses.find(candidate => candidate.id === courseId);
    return course?.staff.find(user => user.id === state.currentUserId);
  });

export const useCourseRole = (courseId: string): CourseRole | undefined =>
  useCourseMembership(courseId)?.role;
