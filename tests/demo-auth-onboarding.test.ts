import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { DEMO_ACCOUNTS, DEMO_ACCOUNT_GROUPS, getRoleOnboarding, roleOnboardingStorageKey } from '../src/lib/demoAccounts';
import { getRoleOnboardingFlowState, updateRoleOnboardingStep } from '../src/lib/roleOnboardingFlow';
import type { CourseRole } from '../src/types/lms';

test('shared demo sign-in exposes unique learner, staff, IT, and administrator identities', () => {
  assert.equal(DEMO_ACCOUNTS.length, 7);
  assert.equal(new Set(DEMO_ACCOUNTS.map(account => account.id)).size, DEMO_ACCOUNTS.length);
  assert.equal(new Set(DEMO_ACCOUNTS.map(account => account.email)).size, DEMO_ACCOUNTS.length);
  assert.deepEqual(DEMO_ACCOUNT_GROUPS.map(group => group.id), ['learners', 'instruction', 'administration']);
  assert.deepEqual(
    DEMO_ACCOUNTS.map(account => account.role).sort(),
    ['admin', 'it', 'student', 'student', 'student', 'ta', 'teacher'],
  );
  assert.equal(DEMO_ACCOUNTS.find(account => account.label === 'Admin')?.name, 'Avery Administrator');
  assert.equal(DEMO_ACCOUNTS.find(account => account.label === 'Student A')?.name, 'Alice Student');
});

test('every course role receives distinct bounded onboarding and principal-scoped completion', () => {
  const roles: CourseRole[] = ['student', 'ta', 'teacher', 'it', 'admin'];
  const models = roles.map(getRoleOnboarding);
  assert.equal(new Set(models.map(model => model.title)).size, roles.length);
  models.forEach(model => {
    assert.equal(model.steps.length, 3);
    assert.ok(model.summary.length >= 40);
    assert.ok(model.boundary.length >= 40);
    model.steps.forEach(step => {
      assert.ok(step.title.trim());
      assert.ok(step.body.length >= 30);
    });
  });
  assert.notEqual(roleOnboardingStorageKey('u3', 'student'), roleOnboardingStorageKey('u7', 'admin'));
  assert.match(roleOnboardingStorageKey('person:/unsafe', 'student'), /^@lms_role_onboarding:v1:person%3A%2Funsafe:student$/);
});

test('role onboarding advances one bounded step at a time and restart returns to step one', () => {
  const first = getRoleOnboardingFlowState(0, 3);
  assert.deepEqual(first, {
    currentStepIndex: 0,
    stepNumber: 1,
    stepCount: 3,
    canGoBack: false,
    canGoNext: true,
    canFinish: false,
  });

  const secondIndex = updateRoleOnboardingStep(first.currentStepIndex, 'next', first.stepCount);
  const second = getRoleOnboardingFlowState(secondIndex, first.stepCount);
  assert.equal(second.stepNumber, 2);
  assert.equal(second.canGoBack, true);
  assert.equal(second.canGoNext, true);
  assert.equal(second.canFinish, false);

  const finalIndex = updateRoleOnboardingStep(second.currentStepIndex, 'next', second.stepCount);
  const final = getRoleOnboardingFlowState(finalIndex, second.stepCount);
  assert.equal(final.stepNumber, 3);
  assert.equal(final.canGoNext, false);
  assert.equal(final.canFinish, true);
  assert.equal(updateRoleOnboardingStep(final.currentStepIndex, 'next', final.stepCount), final.currentStepIndex);
  assert.equal(updateRoleOnboardingStep(first.currentStepIndex, 'back', first.stepCount), first.currentStepIndex);
  assert.equal(updateRoleOnboardingStep(final.currentStepIndex, 'restart', final.stepCount), 0);
});

test('root login, global sign-out, and replayable role-tour controls stay wired', async () => {
  const [layout, header, courses, signIn, onboarding, lmsComponents] = await Promise.all([
    readFile(new URL('../src/app/_layout.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/ui/GlobalHeader.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/lms/CourseList.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/lms/DemoSignIn.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/lms/RoleOnboardingModal.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/lms/LMSComponents.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(layout, /isSharedDemoMode && \(!currentUserId \|\| isSigningIn\)/);
  assert.match(layout, /<DemoSignIn/);
  assert.match(header, /accessibilityLabel="Open account menu"/);
  assert.match(header, /accessibilityLabel="Sign out"/);
  assert.match(courses, /accessibilityLabel="Replay role onboarding"/);
  assert.match(signIn, /Sign in as \$\{account\.label\}, \$\{account\.name\}/);
  assert.match(onboarding, /roleOnboardingStorageKey\(principalId, role\)/);
  assert.match(onboarding, /onClose=\{\(\) => void finish\(\)\}/);
  assert.match(onboarding, /updateRoleOnboardingStep\(previous, 'restart'/);
  assert.match(onboarding, /Step \$\{navigation\.stepNumber\} of \$\{navigation\.stepCount\}/);
  assert.match(onboarding, /accessibilityRole="progressbar"/);
  assert.match(onboarding, /navigation\.canGoNext \?/);
  assert.match(onboarding, /navigation\.canFinish \?/);
  assert.doesNotMatch(onboarding, /model\.steps\.map/);
  assert.match(onboarding, /Finish role tour/);
  const announcementStyle = lmsComponents.slice(
    lmsComponents.indexOf('announcementContainer:'),
    lmsComponents.indexOf('announcementContent:'),
  );
  assert.ok(announcementStyle.length > 0);
  assert.doesNotMatch(announcementStyle, /position:\s*'absolute'/);
  assert.match(announcementStyle, /marginTop:/);
  assert.match(lmsComponents, /accessibilityRole="alert"/);
});
