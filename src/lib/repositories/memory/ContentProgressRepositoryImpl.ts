/**
 * @fileoverview src/lib/repositories/memory/ContentProgressRepositoryImpl.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import { ContentProgress } from '../../../types/lms';
import { demoContentItems, demoCourses } from './demoData';
import { ContentProgressRepository } from '../interfaces';

const cloneProgress = (progress: ContentProgress): ContentProgress => ({ ...progress });

export const demoContentProgress: ContentProgress[] = [];

const resolveLearnerItem = (contentItemId: string, userId: string) => {
  const item = demoContentItems.find(candidate => candidate.id === contentItemId && candidate.deletedAt === undefined);
  if (!item) throw new Error('The requested course content was not found.');
  const membership = demoCourses.find(course => course.id === item.courseId)?.staff.find(user => user.id === userId);
  if (!membership) throw new Error('This learner is not enrolled in the requested course.');
  if (membership.role !== 'student') throw new Error('Course progress is recorded only for learner sessions.');
  return item;
};

const recordKeyMatches = (record: ContentProgress, contentItemId: string, userId: string) =>
  record.contentItemId === contentItemId && record.userId === userId;

/** In-memory demo implementation of the institution-owned learner progress contract. */
export class DemoContentProgressRepository implements ContentProgressRepository {
  async getProgressForCourses(courseIds: string[], userId: string): Promise<ContentProgress[]> {
    const allowedCourses = new Set(courseIds);
    courseIds.forEach(courseId => {
      const membership = demoCourses.find(course => course.id === courseId)?.staff.find(user => user.id === userId);
      if (!membership) throw new Error('This learner is not enrolled in one of the requested courses.');
    });
    return demoContentProgress
      .filter(record => record.userId === userId && allowedCourses.has(record.courseId))
      .map(cloneProgress);
  }

  async markViewed(contentItemId: string, userId: string): Promise<ContentProgress> {
    const item = resolveLearnerItem(contentItemId, userId);
    const index = demoContentProgress.findIndex(record => recordKeyMatches(record, contentItemId, userId));
    const now = Date.now();
    const existing = index >= 0 ? demoContentProgress[index] : undefined;
    const next: ContentProgress = existing ? {
      ...existing,
      lastViewedAt: Math.max(now, existing.lastViewedAt),
      revision: existing.revision + 1,
    } : {
      userId,
      courseId: item.courseId,
      contentItemId,
      firstViewedAt: now,
      lastViewedAt: now,
      revision: 1,
    };
    if (index < 0) demoContentProgress.push(next);
    else demoContentProgress[index] = next;
    return cloneProgress(next);
  }

  async setCompleted(contentItemId: string, userId: string, completed: boolean): Promise<ContentProgress> {
    const item = resolveLearnerItem(contentItemId, userId);
    const index = demoContentProgress.findIndex(record => recordKeyMatches(record, contentItemId, userId));
    const now = Date.now();
    const existing = index >= 0 ? demoContentProgress[index] : undefined;
    const next: ContentProgress = existing ? {
      ...existing,
      lastViewedAt: Math.max(now, existing.lastViewedAt),
      completedAt: completed ? Math.max(now, existing.completedAt ?? 0) : undefined,
      revision: existing.revision + 1,
    } : {
      userId,
      courseId: item.courseId,
      contentItemId,
      firstViewedAt: now,
      lastViewedAt: now,
      completedAt: completed ? now : undefined,
      revision: 1,
    };
    if (index < 0) demoContentProgress.push(next);
    else demoContentProgress[index] = next;
    return cloneProgress(next);
  }
}
