/**
 * @fileoverview src/lib/store/principalGeneration.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
let principalGeneration = 0;

/** Invalidates every in-flight principal-scoped store operation. */
export const advancePrincipalGeneration = () => {
  principalGeneration += 1;
  return principalGeneration;
};

export const capturePrincipalGeneration = () => principalGeneration;

export const isPrincipalGenerationCurrent = (generation: number) => generation === principalGeneration;
