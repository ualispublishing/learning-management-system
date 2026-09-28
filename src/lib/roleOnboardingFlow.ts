/**
 * @fileoverview src/lib/roleOnboardingFlow.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
export type RoleOnboardingFlowAction = 'back' | 'next' | 'restart';

export interface RoleOnboardingFlowState {
  currentStepIndex: number;
  stepNumber: number;
  stepCount: number;
  canGoBack: boolean;
  canGoNext: boolean;
  canFinish: boolean;
}

const assertStepCount = (stepCount: number) => {
  if (!Number.isInteger(stepCount) || stepCount < 1) {
    throw new Error('Role onboarding requires at least one step.');
  }
};

export const getRoleOnboardingFlowState = (
  requestedStepIndex: number,
  stepCount: number,
): RoleOnboardingFlowState => {
  assertStepCount(stepCount);
  const normalizedIndex = Number.isFinite(requestedStepIndex) ? Math.trunc(requestedStepIndex) : 0;
  const currentStepIndex = Math.max(0, Math.min(normalizedIndex, stepCount - 1));

  return {
    currentStepIndex,
    stepNumber: currentStepIndex + 1,
    stepCount,
    canGoBack: currentStepIndex > 0,
    canGoNext: currentStepIndex < stepCount - 1,
    canFinish: currentStepIndex === stepCount - 1,
  };
};

export const updateRoleOnboardingStep = (
  currentStepIndex: number,
  action: RoleOnboardingFlowAction,
  stepCount: number,
) => {
  const current = getRoleOnboardingFlowState(currentStepIndex, stepCount);
  if (action === 'restart') return 0;
  return getRoleOnboardingFlowState(
    current.currentStepIndex + (action === 'next' ? 1 : -1),
    stepCount,
  ).currentStepIndex;
};
