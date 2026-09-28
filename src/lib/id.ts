/**
 * @fileoverview src/lib/id.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
let fallbackCounter = 0;

/** Generates collision-resistant client IDs without relying on Math.random(). */
export function createEntityId(prefix: string): string {
  const randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  if (randomUUID) return `${prefix}_${randomUUID()}`;
  fallbackCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${fallbackCounter.toString(36)}`;
}
