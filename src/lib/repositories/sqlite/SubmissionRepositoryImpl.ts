/**
 * @fileoverview src/lib/repositories/sqlite/SubmissionRepositoryImpl.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import mockSubmissions from '../../../assets/mock-courses/submissions.json';
import { StudentSubmission } from '../../../types/lms';
import { SubmissionRepository } from '../interfaces';

export const cloneSubmission = (submission: StudentSubmission): StudentSubmission => ({
  ...submission,
  responses: submission.responses.map(response => ({
    ...response,
    answer: Array.isArray(response.answer) ? [...response.answer] : response.answer,
    rubricScores: response.rubricScores ? { ...response.rubricScores } : undefined,
    attachment: response.attachment ? { ...response.attachment } : undefined,
  })),
});

export const demoSubmissions = (mockSubmissions as unknown as StudentSubmission[]).map(cloneSubmission);

/** In-memory demo repository. Production deployments replace the factory adapter. */
export class DemoSubmissionRepository implements SubmissionRepository {
  async getSubmissionsForCourses(courseIds: string[]): Promise<StudentSubmission[]> {
    const allowed = new Set(courseIds);
    return demoSubmissions.filter(submission => allowed.has(submission.courseId)).map(cloneSubmission);
  }

  async upsertSubmission(submission: StudentSubmission): Promise<StudentSubmission> {
    const index = demoSubmissions.findIndex(existing => existing.id === submission.id);
    if (index < 0) demoSubmissions.push(cloneSubmission(submission));
    else demoSubmissions[index] = cloneSubmission(submission);
    return cloneSubmission(submission);
  }
}
