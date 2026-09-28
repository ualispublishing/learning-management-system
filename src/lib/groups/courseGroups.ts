/**
 * @fileoverview src/lib/groups/courseGroups.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import { ContentItem, Course, CourseGroup, CourseGroupSet } from '../../types/lms';

export const normalizeContentGroupLabels = (labels: string[]): string[] => {
  if (!Array.isArray(labels)) throw new Error('Content group labels must be an array.');
  if (labels.length > 200) throw new Error('A course cannot define more than 200 content group labels.');
  const normalized: string[] = [];
  const seen = new Set<string>();
  labels.forEach((value, index) => {
    if (typeof value !== 'string') throw new Error(`Content group label ${index + 1} must be text.`);
    const label = value.trim();
    if (!label || label.length > 120) throw new Error('Content group labels must contain 1 to 120 characters.');
    if (label.toLocaleLowerCase().startsWith('group:')) throw new Error('Content group labels cannot use the reserved "group:" prefix.');
    const key = label.normalize('NFKC').toLocaleLowerCase();
    if (seen.has(key)) throw new Error(`Content group label "${label}" is duplicated.`);
    seen.add(key);
    normalized.push(label);
  });
  return normalized;
};

export const getGroupSetForItem = (course: Course | undefined, item: ContentItem): CourseGroupSet | undefined => {
  if (!course || item.workType !== 'group') return undefined;
  if (item.groupSetId) return course.groupSets?.find(groupSet => groupSet.id === item.groupSetId);
  return course.groupSets?.length === 1 ? course.groupSets[0] : undefined;
};

export const getGroupsForItem = (course: Course | undefined, item: ContentItem): CourseGroup[] =>
  getGroupSetForItem(course, item)?.groups ?? [];

export const getGroupForUser = (course: Course | undefined, item: ContentItem, userId: string | null | undefined): CourseGroup | undefined =>
  userId ? getGroupsForItem(course, item).find(group => group.memberIds.includes(userId)) : undefined;

export const userBelongsToSubmissionGroup = (
  course: Course | undefined,
  item: ContentItem | undefined,
  userId: string | null | undefined,
  groupId: string | undefined,
): boolean => Boolean(item && groupId && getGroupForUser(course, item, userId)?.id === groupId);

export const getGroupFromSet = (course: Course | undefined, groupSetId: string | undefined, groupId: string | undefined): CourseGroup | undefined => {
  if (!course || !groupId) return undefined;
  const groupSet = groupSetId
    ? course.groupSets?.find(candidate => candidate.id === groupSetId)
    : course.groupSets?.length === 1 ? course.groupSets[0] : undefined;
  return groupSet?.groups.find(group => group.id === groupId);
};
