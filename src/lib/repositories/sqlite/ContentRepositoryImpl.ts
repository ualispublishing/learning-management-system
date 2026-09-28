/**
 * @fileoverview src/lib/repositories/sqlite/ContentRepositoryImpl.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import { ContentRepository } from '../interfaces';
import { ContentItem } from '../../../types/lms';
import { demoContentItems, demoCourses } from '../memory/demoData';
import { normalizeContentGroupLabels } from '../../groups/courseGroups';

const cloneJSON = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const cloneItem = (item: ContentItem): ContentItem => ({
  ...item,
  questions: item.questions?.map(question => ({
    ...question,
    options: question.options ? [...question.options] : undefined,
    correctAnswer: Array.isArray(question.correctAnswer) ? [...question.correctAnswer] : question.correctAnswer,
    customConfig: question.customConfig ? cloneJSON(question.customConfig) : undefined,
    rubric: question.rubric?.map(criterion => ({ ...criterion })),
  })),
  quizConfig: item.quizConfig ? { ...item.quizConfig } : undefined,
  studyCards: item.studyCards?.map(card => ({
    ...card,
    tags: card.tags ? [...card.tags] : undefined,
  })),
  videoAlternatives: item.videoAlternatives ? {
    captionTracks: item.videoAlternatives.captionTracks?.map(track => ({ ...track })),
    transcript: item.videoAlternatives.transcript ? { ...item.videoAlternatives.transcript } : undefined,
  } : undefined,
  metadata: item.metadata ? cloneJSON(item.metadata) : undefined,
});


/** In-memory demo repository. Production deployments replace the factory adapter. */
export class DemoContentRepository implements ContentRepository {
  async getContentItems(courseId: string): Promise<ContentItem[]> {
    return demoContentItems.filter(item => item.courseId === courseId).map(cloneItem);
  }

  async createContentItem(item: ContentItem): Promise<ContentItem> {
    if (!demoCourses.some(course => course.id === item.courseId)) {
      throw new Error(`Course "${item.courseId}" was not found.`);
    }
    if (demoContentItems.some(existing => existing.id === item.id)) {
      throw new Error(`Content item "${item.id}" already exists.`);
    }
    const newItem = cloneItem(item);
    demoContentItems.push(newItem);
    return cloneItem(newItem);
  }

  async createContentItems(items: ContentItem[]): Promise<ContentItem[]> {
    const ids = new Set<string>();
    for (const item of items) {
      if (!demoCourses.some(course => course.id === item.courseId)) {
        throw new Error(`Course "${item.courseId}" was not found.`);
      }
      if (ids.has(item.id) || demoContentItems.some(existing => existing.id === item.id)) {
        throw new Error(`Content item "${item.id}" already exists.`);
      }
      ids.add(item.id);
    }
    const created = items.map(cloneItem);
    demoContentItems.push(...created);
    return created.map(cloneItem);
  }

  async updateContentItem(itemId: string, updates: Partial<ContentItem>): Promise<void> {
    const index = demoContentItems.findIndex(item => item.id === itemId);
    if (index < 0) throw new Error(`Content item "${itemId}" was not found.`);
    if (updates.id && updates.id !== itemId) throw new Error('Content identifiers cannot be changed.');
    if (updates.courseId && updates.courseId !== demoContentItems[index].courseId) {
      throw new Error('Content cannot be moved between courses by an update.');
    }
    demoContentItems[index] = cloneItem({ ...demoContentItems[index], ...updates, id: itemId });
  }

  async updateContentItems(changes: { itemId: string; updates: Partial<ContentItem> }[]): Promise<void> {
    if (!changes.length) return;
    const requestedIds = new Set<string>();
    for (const change of changes) {
      if (requestedIds.has(change.itemId)) {
        throw new Error(`Content item "${change.itemId}" is repeated in the batch.`);
      }
      requestedIds.add(change.itemId);
    }
    const indices = changes.map(change => demoContentItems.findIndex(item => item.id === change.itemId));
    const missingIndex = indices.findIndex(index => index < 0);
    if (missingIndex >= 0) throw new Error(`Content item "${changes[missingIndex].itemId}" was not found.`);
    changes.forEach((change, changeIndex) => {
      const existing = demoContentItems[indices[changeIndex]];
      if (change.updates.id && change.updates.id !== change.itemId) throw new Error('Content identifiers cannot be changed.');
      if (change.updates.courseId && change.updates.courseId !== existing.courseId) {
        throw new Error('Content cannot be moved between courses by an update.');
      }
    });
    changes.forEach((change, changeIndex) => {
      const itemIndex = indices[changeIndex];
      demoContentItems[itemIndex] = cloneItem({ ...demoContentItems[itemIndex], ...change.updates, id: change.itemId });
    });
  }

  async updateContentGrouping(courseId: string, labels: string[], changes: { itemId: string; updates: Partial<ContentItem> }[]): Promise<void> {
    const normalizedLabels = normalizeContentGroupLabels(labels);
    const courseIndex = demoCourses.findIndex(course => course.id === courseId);
    if (courseIndex < 0) throw new Error(`Course "${courseId}" was not found.`);
    const ids = new Set<string>();
    const indices = changes.map(change => {
      if (ids.has(change.itemId)) throw new Error(`Content item "${change.itemId}" is repeated in the grouping update.`);
      ids.add(change.itemId);
      const index = demoContentItems.findIndex(item => item.id === change.itemId && item.courseId === courseId);
      if (index < 0) throw new Error(`Content item "${change.itemId}" was not found in course "${courseId}".`);
      if (change.updates.id && change.updates.id !== change.itemId) throw new Error('Content identifiers cannot be changed.');
      if (change.updates.courseId && change.updates.courseId !== courseId) throw new Error('Content cannot be moved between courses by a grouping update.');
      return index;
    });
    const nextItems = changes.map((change, index) => cloneItem({ ...demoContentItems[indices[index]], ...change.updates, id: change.itemId }));
    const nextCourse = {
      ...demoCourses[courseIndex],
      metadata: { ...(demoCourses[courseIndex].metadata || {}), lmsGroupLabels: normalizedLabels },
    };
    changes.forEach((_change, index) => { demoContentItems[indices[index]] = nextItems[index]; });
    demoCourses[courseIndex] = nextCourse;
  }

  async deleteContentItem(itemId: string, deletedAt: number): Promise<void> {
    const index = demoContentItems.findIndex(item => item.id === itemId);
    if (index < 0) throw new Error(`Content item "${itemId}" was not found.`);
    demoContentItems[index] = { ...demoContentItems[index], deletedAt };
  }

  async restoreContentItem(itemId: string): Promise<void> {
    const index = demoContentItems.findIndex(item => item.id === itemId);
    if (index < 0) throw new Error(`Content item "${itemId}" was not found.`);
    demoContentItems[index] = { ...demoContentItems[index], deletedAt: undefined };
  }
}
