/**
 * @fileoverview src/lib/courseLifecycle.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import { Course } from '../types/lms';

type CourseLifecycleFields = Pick<Course, 'status' | 'termStart' | 'termEnd'>;

export type CourseLifecyclePhase = 'future' | 'active' | 'ended' | 'archived' | 'invalid';

/**
 * Resolves exact course lifecycle boundaries from institution-authored term
 * timestamps. Invalid runtime records fail closed even if they bypassed import
 * validation (for example, a corrupted offline cache or provider response).
 */
export const getCourseLifecyclePhase = (
  course: CourseLifecycleFields,
  now: number,
): CourseLifecyclePhase => {
  if (course.status === 'past') return 'archived';
  if (course.status !== 'active') return 'invalid';
  if (
    !Number.isFinite(now)
    || !Number.isFinite(course.termStart)
    || !Number.isFinite(course.termEnd)
    || course.termStart >= course.termEnd
  ) return 'invalid';
  if (now < course.termStart) return 'future';
  if (now >= course.termEnd) return 'ended';
  return 'active';
};

/** A course becomes read-only when explicitly archived or when its term ends. */
export const isCoursePastAt = (course: CourseLifecycleFields, now: number): boolean =>
  ['ended', 'archived', 'invalid'].includes(getCourseLifecyclePhase(course, now));

/** Staff may prepare a future course, but ended, archived, and invalid courses are read-only. */
export const isCourseOpenAt = (course: CourseLifecycleFields, now: number): boolean =>
  !isCoursePastAt(course, now);

/** Learner attempts and live delivery are accepted only during the active term. */
export const isCourseInSessionAt = (course: CourseLifecycleFields, now: number): boolean =>
  getCourseLifecyclePhase(course, now) === 'active';
