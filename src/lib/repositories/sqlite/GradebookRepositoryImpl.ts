/**
 * @fileoverview src/lib/repositories/sqlite/GradebookRepositoryImpl.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import { ContentItem, StudentSubmission } from '../../../types/lms';
import { GradebookRepository } from '../interfaces';
import { demoContentItems } from '../memory/demoData';
import { cloneSubmission, demoSubmissions } from './SubmissionRepositoryImpl';

/** Atomic in-memory implementation of external-grade creation for demo mode. */
export class DemoGradebookRepository implements GradebookRepository {
  async createExternalGrade(item: ContentItem, submissions: StudentSubmission[]): Promise<void> {
    if (demoContentItems.some(existing => existing.id === item.id)) throw new Error(`Content item "${item.id}" already exists.`);
    if (new Set(submissions.map(submission => submission.id)).size !== submissions.length) throw new Error('External grade submissions contain duplicate ids.');
    if (submissions.some(submission => submission.contentItemId !== item.id || submission.courseId !== item.courseId)) {
      throw new Error('Every gradebook entry must reference the external grade item and course.');
    }
    if (submissions.some(submission => demoSubmissions.some(existing => existing.id === submission.id))) {
      throw new Error('An external grade submission id already exists.');
    }

    demoContentItems.push(JSON.parse(JSON.stringify(item)) as ContentItem);
    demoSubmissions.push(...submissions.map(cloneSubmission));
  }
}
