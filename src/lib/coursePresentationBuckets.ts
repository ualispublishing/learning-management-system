/**
 * @fileoverview src/lib/coursePresentationBuckets.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import { ContentItem, PresentationMode } from '../types/lms';
import { isContentLockedAt } from './contentAvailability';
import { parseContentDateTime } from './contentDateTime';
import { isRenderableCustomCoursePresentationItem } from './coursePresentation';

export interface CourseContentBucket {
  id: string;
  label: string;
  items: ContentItem[];
}

export interface CourseContentChange {
  itemId: string;
  updates: Partial<ContentItem>;
}

const orderedContent = (left: ContentItem, right: ContentItem) =>
  (left.orderIndex ?? left.createdAt) - (right.orderIndex ?? right.createdAt)
  || left.id.localeCompare(right.id);

export const buildTimelineCourseBuckets = (
  courseContent: ContentItem[],
  now: number,
): CourseContentBucket[] => {
  const buckets: Record<'past' | 'current' | 'future', ContentItem[]> = {
    past: [],
    current: [],
    future: [],
  };

  courseContent.forEach(item => {
    if (item.presentationSlot === 'past') buckets.past.push(item);
    else if (item.presentationSlot === 'current') buckets.current.push(item);
    else if (item.presentationSlot === 'future') buckets.future.push(item);
    else if (item.presentationSlot === 'scheduled') {
      const availableAt = parseContentDateTime(item.availableDate);
      if (availableAt === undefined || now < availableAt) {
        buckets.future.push(item);
        return;
      }
      const displayAt = parseContentDateTime(item.displayDate);
      if (displayAt !== undefined && now > displayAt) buckets.past.push(item);
      else buckets.current.push(item);
    }
  });

  Object.values(buckets).forEach(items => items.sort(orderedContent));
  return [
    { id: 'past', label: 'Past Content', items: buckets.past },
    { id: 'current', label: 'Current Content', items: buckets.current },
    { id: 'future', label: 'Future Content', items: buckets.future },
  ];
};

export const buildCustomCourseBuckets = (courseContent: ContentItem[]): CourseContentBucket[] =>
  courseContent
    .filter(isRenderableCustomCoursePresentationItem)
    .sort(orderedContent)
    .map(item => ({ id: `custom:${item.id}`, label: item.title, items: [item] }));

/**
 * Builds learner-visible sequential modules without leaking children whose
 * parent module has not opened yet. Membership is calculated from every
 * module first; only genuinely unassigned content may fall back to the
 * ungrouped bucket.
 */
export const buildSequentialCourseBuckets = (
  courseContent: ContentItem[],
  now: number,
): CourseContentBucket[] => {
  const blocks = courseContent
    .filter(item => item.category === 'admin' && item.presentationSlot === 'block-header')
    .sort(orderedContent);
  const moduleChildIds = new Set<string>();
  const buckets: CourseContentBucket[] = [];

  blocks.forEach(block => {
    // A malformed block without a group key must not claim all ungrouped
    // course items. It remains empty until staff repair its configuration.
    const children = block.groupIcon
      ? courseContent
        .filter(item => item.groupIcon === block.groupIcon && item.id !== block.id)
        .sort(orderedContent)
      : [];
    children.forEach(item => moduleChildIds.add(item.id));

    if (!isContentLockedAt(block, now)) {
      buckets.push({ id: block.id, label: block.title, items: children });
    }
  });

  const orphanedItems = courseContent
    .filter(item => item.presentationSlot !== 'block-header' && !moduleChildIds.has(item.id))
    .sort(orderedContent);
  if (orphanedItems.length) {
    buckets.push({ id: 'ungrouped', label: 'Ungrouped content', items: orphanedItems });
  }

  return buckets.length
    ? buckets
    : [{ id: 'course-content', label: 'Course content', items: [] }];
};

/**
 * One presentation-page model feeds both vertical sections and the horizontal
 * pager. Keeping mode selection here prevents a mode from silently losing its
 * horizontal learner experience when the component renderer changes.
 */
export const buildCoursePresentationBuckets = (
  courseContent: ContentItem[],
  presentationMode: PresentationMode,
  now: number,
): CourseContentBucket[] => {
  const visibleContent = courseContent.filter(item => item.deletedAt === undefined);
  if (presentationMode === 'timeline') return buildTimelineCourseBuckets(visibleContent, now);
  if (presentationMode === 'sequential') return buildSequentialCourseBuckets(visibleContent, now);
  return buildCustomCourseBuckets(visibleContent);
};

/**
 * Keeps module headers and their children consistent when a teacher schedules
 * or clears a sequential module release. The caller persists this batch
 * atomically so switching presentation modes cannot leave children in a
 * `scheduled` slot with no release date.
 */
export const buildSequentialModuleScheduleChanges = (
  courseContent: ContentItem[],
  blockId: string,
  availableDate: string,
): CourseContentChange[] => {
  const block = courseContent.find(item => (
    item.id === blockId
    && item.category === 'admin'
    && item.presentationSlot === 'block-header'
  ));
  if (!block) return [];

  const normalizedAvailableDate = availableDate.trim() || undefined;
  const children = block.groupIcon
    ? courseContent.filter(item => item.id !== block.id && item.groupIcon === block.groupIcon)
    : [];

  return [
    {
      itemId: block.id,
      updates: {
        availableDate: normalizedAvailableDate,
        presentationSlot: 'block-header',
      },
    },
    ...children.map(item => ({
      itemId: item.id,
      updates: {
        availableDate: normalizedAvailableDate,
        presentationSlot: normalizedAvailableDate ? 'scheduled' as const : 'current' as const,
      },
    })),
  ];
};
