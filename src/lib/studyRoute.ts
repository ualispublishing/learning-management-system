/**
 * @fileoverview src/lib/studyRoute.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import { parseSessionLimit, parseStartPosition } from './sessionTarget';

export type StudyMode = 'learn' | 'study' | 'quiz';
export type ReviewGroup = 'all' | 'low_retrievability' | 'overdue' | 'due_today';

type RouteValue = string | string[] | undefined;

export interface StudyRouteInput {
  deckId: RouteValue;
  target: RouteValue;
  mode: RouteValue;
  startPos: RouteValue;
  group: RouteValue;
}

export type NormalizedStudyRoute =
  | { success: true; deckId: string; target: string; mode: StudyMode; startPos: string; group: ReviewGroup }
  | { success: false; error: string };

/**
 * Expo query parameters are untrusted deep-link input and may be repeated.
 * Reject ambiguous arrays and invalid modes instead of letting arbitrary text
 * silently fall into the state-mutating spaced-review path.
 */
const singleRouteValue = (value: RouteValue): string | undefined => {
  if (Array.isArray(value)) return value.length === 1 ? value[0]?.trim() || undefined : undefined;
  return value?.trim() || undefined;
};

const isBoundedRouteValue = (value: RouteValue, maximum = 256): boolean => {
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return values.every(entry => entry.length <= maximum && !/[\u0000-\u001f\u007f]/.test(entry));
};

export const normalizeStudyRoute = (input: StudyRouteInput): NormalizedStudyRoute => {
  if ([input.deckId, input.target, input.mode, input.startPos, input.group].some(value => Array.isArray(value) && value.length !== 1)) {
    return { success: false, error: 'The study link contains ambiguous repeated parameters.' };
  }
  if (!isBoundedRouteValue(input.deckId)
    || !isBoundedRouteValue(input.target, 32)
    || !isBoundedRouteValue(input.mode, 32)
    || !isBoundedRouteValue(input.startPos, 32)
    || !isBoundedRouteValue(input.group, 64)) {
    return { success: false, error: 'The study link contains an invalid or oversized parameter.' };
  }

  const deckId = singleRouteValue(input.deckId);
  if (!deckId) return { success: false, error: 'The study link does not identify a deck.' };

  const rawMode = singleRouteValue(input.mode) || 'study';
  if (!(['learn', 'study', 'quiz'] as const).includes(rawMode as StudyMode)) {
    return { success: false, error: 'The requested study mode is invalid.' };
  }
  const mode = rawMode as StudyMode;

  const rawTarget = singleRouteValue(input.target) || 'all';
  const parsedTarget = rawTarget === 'all' ? 'all' : parseSessionLimit(rawTarget);
  if (parsedTarget === null || parsedTarget === 'all' && rawTarget !== 'all') {
    return { success: false, error: 'The requested session size is invalid.' };
  }
  const target = parsedTarget === 'all' ? 'all' : String(parsedTarget);

  const rawStartPos = singleRouteValue(input.startPos) || '1';
  let startPos = '1';
  if (mode !== 'study') {
    if (rawStartPos === 'unseen') startPos = rawStartPos;
    else {
      const parsedStartPosition = parseStartPosition(rawStartPos);
      if (parsedStartPosition === null) return { success: false, error: 'The requested start position is invalid.' };
      startPos = String(parsedStartPosition);
    }
  }

  const rawGroup = singleRouteValue(input.group) || 'all';
  const reviewGroups: readonly ReviewGroup[] = ['all', 'low_retrievability', 'overdue', 'due_today'];
  if (!reviewGroups.includes(rawGroup as ReviewGroup)) {
    return { success: false, error: 'The requested review group is invalid.' };
  }

  return {
    success: true,
    deckId,
    target,
    mode,
    startPos,
    group: deckId === 'all' ? rawGroup as ReviewGroup : 'all',
  };
};
