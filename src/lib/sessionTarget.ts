/**
 * @fileoverview src/lib/sessionTarget.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
export const MAX_FLASHCARD_SESSION_SIZE = 1000;

export type ParsedSessionLimit = number | 'all' | null;

/** Parses the persisted/custom selector value without silently accepting junk. */
export function parseSessionLimit(value: unknown): ParsedSessionLimit {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (normalized === '∞') return 'all';
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_FLASHCARD_SESSION_SIZE) return null;
  return parsed;
}

export function parseStartPosition(value: unknown, totalCards?: number): number | null {
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value.trim());
  if (!Number.isSafeInteger(parsed) || parsed < 1) return null;
  if (typeof totalCards === 'number' && totalCards > 0 && parsed > totalCards) return null;
  return parsed;
}
