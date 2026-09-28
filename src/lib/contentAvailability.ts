/**
 * @fileoverview src/lib/contentAvailability.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import { ContentItem } from '../types/lms';
import { parseContentDateTime } from './contentDateTime';

const PRESENTATION_SLOTS = new Set<ContentItem['presentationSlot']>([
  'past',
  'current',
  'future',
  'scheduled',
  'block-header',
]);

/** Fail-closed learner availability check shared by every content presentation mode. */
export const isContentLockedAt = (item: ContentItem, now: number): boolean => {
  if (!Number.isFinite(now) || !PRESENTATION_SLOTS.has(item.presentationSlot)) return true;
  if (item.presentationSlot === 'future') return true;
  if (item.releaseDate !== undefined && (!Number.isFinite(item.releaseDate) || now < item.releaseDate)) return true;
  if (item.lockDate !== undefined && (!Number.isFinite(item.lockDate) || now >= item.lockDate)) return true;
  if (item.availableDate) {
    const availableAt = parseContentDateTime(item.availableDate);
    if (availableAt === undefined || now < availableAt) return true;
  }
  return item.presentationSlot === 'scheduled' && !item.availableDate;
};
