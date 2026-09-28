/**
 * @fileoverview src/lib/analytics/courseAnalytics.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import { ContentItem, Course, CourseUser, StudentSubmission } from '../../types/lms';
import { getGradingMaxScore } from '../assessment/engine';
import { userBelongsToSubmissionGroup } from '../groups/courseGroups';

export interface StudentAnalyticsRow {
  student: CourseUser;
  submissionCount: number;
  gradePercent: number | null;
  categoryGrades: Record<string, number>;
}

export interface CourseAnalyticsSummary {
  averageGradePercent: number | null;
  averageAttemptMinutes: number | null;
  releasedGradeCount: number;
  studentRows: StudentAnalyticsRow[];
}

const maxScore = (item: ContentItem): number => getGradingMaxScore(item);

const attemptOrder = (submission: StudentSubmission): number =>
  submission.gradedAt || submission.updatedAt || submission.submittedAt;

const chooseLatestAttemptPerItem = (submissions: StudentSubmission[]): StudentSubmission[] => {
  const selected = new Map<string, StudentSubmission>();
  submissions.forEach(submission => {
    const current = selected.get(submission.contentItemId);
    if (!current
      || (submission.attemptNumber || 1) > (current.attemptNumber || 1)
      || ((submission.attemptNumber || 1) === (current.attemptNumber || 1) && attemptOrder(submission) > attemptOrder(current))) {
      selected.set(submission.contentItemId, submission);
    }
  });
  return Array.from(selected.values());
};

const belongsToStudent = (course: Course, item: ContentItem | undefined, submission: StudentSubmission, student: CourseUser): boolean =>
  submission.studentId === student.id
  || userBelongsToSubmissionGroup(course, item, student.id, submission.groupId);

export const calculateCourseAnalytics = (
  course: Course,
  contentItems: ContentItem[],
  submissions: StudentSubmission[],
): CourseAnalyticsSummary => {
  const itemById = new Map(contentItems
    .filter(item => item.courseId === course.id && !item.deletedAt)
    .map(item => [item.id, item]));
  const students = course.staff.filter(member => member.role === 'student');
  const released = submissions.filter(submission =>
    submission.courseId === course.id
    && !submission.deletedAt
    && submission.status === 'graded'
    && submission.gradeStatus === 'released'
    && itemById.has(submission.contentItemId),
  );
  const categoryWeights = course.gradingWeights || {};

  const studentRows = students.map(student => {
    const latest = chooseLatestAttemptPerItem(released.filter(submission => belongsToStudent(course, itemById.get(submission.contentItemId), submission, student)));
    const categoryTotals = new Map<string, { earned: number; possible: number }>();
    latest.forEach(submission => {
      const item = itemById.get(submission.contentItemId);
      const maximum = item ? maxScore(item) : 0;
      if (!item?.gradingCategory || maximum <= 0 || !Number.isFinite(submission.totalScore)) return;
      const category = Object.keys(categoryWeights).find(name => name.toLocaleLowerCase() === item.gradingCategory?.toLocaleLowerCase());
      if (!category) return;
      const current = categoryTotals.get(category) || { earned: 0, possible: 0 };
      current.earned += Math.max(0, Math.min(maximum, submission.totalScore || 0));
      current.possible += maximum;
      categoryTotals.set(category, current);
    });
    const categoryGrades = Object.fromEntries(Array.from(categoryTotals.entries()).flatMap(([category, totals]) =>
      totals.possible > 0 ? [[category, totals.earned / totals.possible * 100]] : [],
    ));
    const presentWeight = Object.keys(categoryGrades).reduce((sum, category) => sum + (categoryWeights[category] || 0), 0);
    const gradePercent = presentWeight > 0
      ? Object.entries(categoryGrades).reduce((sum, [category, grade]) => sum + grade * (categoryWeights[category] || 0), 0) / presentWeight
      : null;
    return { student, submissionCount: latest.length, gradePercent, categoryGrades };
  });

  const studentGrades = studentRows.flatMap(row => row.gradePercent === null ? [] : [row.gradePercent]);
  const completedAttempts = submissions.filter(submission =>
    submission.courseId === course.id
    && !submission.deletedAt
    && (submission.status === 'submitted' || submission.status === 'graded')
    && submission.startedAt !== undefined
    && submission.submittedAt >= submission.startedAt
    && submission.submittedAt - submission.startedAt <= 7 * 24 * 60 * 60 * 1000,
  );
  const durations = completedAttempts.map(submission => submission.submittedAt - (submission.startedAt as number));

  return {
    averageGradePercent: studentGrades.length ? studentGrades.reduce((sum, grade) => sum + grade, 0) / studentGrades.length : null,
    averageAttemptMinutes: durations.length ? durations.reduce((sum, duration) => sum + duration, 0) / durations.length / 60_000 : null,
    releasedGradeCount: released.length,
    studentRows,
  };
};
