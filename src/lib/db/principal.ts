/**
 * @fileoverview src/lib/db/principal.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
const LOCAL_DEVICE_PRINCIPAL = 'user_1';

let activePrincipalId = LOCAL_DEVICE_PRINCIPAL;
let principalGeneration = 0;

export const getFlashcardPrincipalId = () => activePrincipalId;
export const captureFlashcardPrincipal = () => ({ id: activePrincipalId, generation: principalGeneration });
export const isFlashcardPrincipalCurrent = (capture: { id: string; generation: number }) => (
  capture.id === activePrincipalId && capture.generation === principalGeneration
);

export const setFlashcardPrincipal = (principalId?: string | null) => {
  const normalized = principalId?.trim() || LOCAL_DEVICE_PRINCIPAL;
  if (normalized !== activePrincipalId) {
    activePrincipalId = normalized;
    principalGeneration += 1;
  }
  return activePrincipalId;
};

export const institutionFlashcardPrincipal = (institutionUserId: string) => {
  const normalized = institutionUserId.trim();
  if (!normalized) throw new Error('An institution user ID is required for flashcard isolation.');
  return `institution:${normalized}`;
};
