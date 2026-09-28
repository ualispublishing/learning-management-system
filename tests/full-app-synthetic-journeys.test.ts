import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertFullAppSyntheticJourneyResult,
  FULL_APP_SYNTHETIC_LIMITATIONS,
  runFullAppSyntheticJourneys,
} from '../src/lib/testing/fullAppSyntheticJourneys';

test('full synthetic runner executes complete repeated journeys across all five roles and three app surfaces', { concurrency: false }, async () => {
  const result = await runFullAppSyntheticJourneys({ iterations: 2, runId: 'full-app-contract' });
  assertFullAppSyntheticJourneyResult(result);

  assert.equal(result.coverage.passed, true);
  assert.equal(result.coverage.plannedJourneys, 18);
  assert.equal(result.coverage.expectedSteps, 108);
  assert.equal(result.coverage.observedSteps, 108);
  assert.equal(result.summary.steps, 108);
  assert.equal(result.summary.journeys, 18);
  assert.equal(result.summary.journeysCompleted, 18);
  assert.equal(result.summary.taskCompletionRate, 1);
  assert.equal(result.summary.expectedDenialAccuracy, 1);
  assert.equal(result.summary.systemErrors, 0);
  assert.equal(result.summary.byRole.student.functionalPassRate, 1);
  assert.equal(result.summary.byRole.ta.functionalPassRate, 1);
  assert.equal(result.summary.byRole.teacher.functionalPassRate, 1);
  assert.equal(result.summary.byRole.it.functionalPassRate, 1);
  assert.equal(result.summary.byRole.admin.functionalPassRate, 1);
  assert.equal(result.summary.byArea.courses.functionalPassRate, 1);
  assert.equal(result.summary.byArea.chat.functionalPassRate, 1);
  assert.equal(result.summary.byArea.flashcards.functionalPassRate, 1);
  assert.equal(result.summary.byArea.ai.functionalPassRate, 1);
  assert.equal(result.summary.byArea['cross-app'].functionalPassRate, 1);
  assert.equal(result.summary.byStep['cross-app.announcement-roundtrip:retry-reconciliation'].iterations, 2);
  assert.equal(result.summary.qualityChecks.transport_blocked.passRate, 1);
  assert.equal(result.summary.qualityChecks.duplicate_suppressed.passRate, 1);
  assert.equal(result.summary.qualityChecks.protected_state_unchanged.passRate, 1);
  assert.equal(result.summary.qualityChecks.retry_converged.passRate, 1);
  assert.ok(result.summary.p95Ms >= 0);
  assert.ok(result.summary.taskLatency.p95Ms >= result.summary.p95Ms);

  const serializedEvents = JSON.stringify(result.events);
  assert.doesNotMatch(serializedEvents, /@example\.edu|Ada Teacher|Sam Student|Synthetic announcement details/i);
  assert.deepEqual(result.limitations, FULL_APP_SYNTHETIC_LIMITATIONS);
});

test('full synthetic runner rejects unbounded repetition counts', async () => {
  await assert.rejects(
    runFullAppSyntheticJourneys({ iterations: 101 }),
    /integer from 1 to 100/i,
  );
});
