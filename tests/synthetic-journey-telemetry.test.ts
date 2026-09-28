import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertSyntheticJourneyCoverage,
  assertSyntheticJourneySummary,
  createSyntheticNdjsonSink,
  inspectSyntheticJourneyCoverage,
  serializeSyntheticJourneySummary,
  SyntheticJourneyRecorder,
  syntheticObservation,
} from '../src/lib/testing/syntheticJourneyTelemetry';

const definition = (stepId: string, overrides: Partial<Parameters<SyntheticJourneyRecorder['step']>[0]> = {}) => ({
  runId: 'telemetry-contract',
  journeyId: 'student-course-study',
  stepId,
  area: 'courses',
  role: 'student',
  completionBoundary: 'state_converged' as const,
  ...overrides,
});

test('synthetic journey telemetry records functional outcomes, latency percentiles, budgets, and quality checks', async () => {
  const timestamps = [0, 10, 10, 30, 30, 60, 60, 100];
  const lines: string[] = [];
  const recorder = new SyntheticJourneyRecorder({
    now: () => timestamps.shift()!,
    sink: createSyntheticNdjsonSink(line => lines.push(line)),
  });

  await recorder.step(definition('load-course', { budgetMs: 20 }), () => syntheticObservation(
    'success',
    { courseCount: 1 },
    { state_converged: true },
    { visible_items: 6 },
  ));
  await recorder.step(definition('blocked-settings', {
    area: 'admin',
    expectedOutcome: 'denied',
    budgetMs: 15,
  }), () => syntheticObservation('denied', undefined, { transport_blocked: true }));
  await recorder.step(definition('retry-message', {
    area: 'chat',
    expectedOutcome: 'recovered',
    budgetMs: 35,
  }), () => syntheticObservation('recovered', undefined, {
    retry_deduplicated: true,
    state_converged: true,
  }, { transport_attempts: 2 }));
  await recorder.step(definition('duplicate-tap', {
    area: 'flashcards',
    expectedOutcome: 'no_op',
    budgetMs: 35,
  }), () => syntheticObservation('no_op', undefined, { duplicate_suppressed: true }));

  const summary = recorder.summary();
  assert.equal(summary.steps, 4);
  assert.equal(summary.functionallyPassed, 4);
  assert.equal(summary.taskCompletionRate, 1);
  assert.equal(summary.expectedDenialAccuracy, 1);
  assert.equal(summary.performanceBudgets, 4);
  assert.equal(summary.performanceBudgetsPassed, 2);
  assert.equal(summary.averageMs, 25);
  assert.equal(summary.p50Ms, 20);
  assert.equal(summary.p95Ms, 40);
  assert.equal(summary.maxMs, 40);
  assert.deepEqual(summary.outcomes, {
    success: 1,
    denied: 1,
    recovered: 1,
    no_op: 1,
    cancelled: 0,
    error: 0,
  });
  assert.deepEqual(summary.qualityChecks.duplicate_suppressed, { total: 1, passed: 1, passRate: 1 });
  assert.equal(summary.byRole.student.steps, 4);
  assert.equal(summary.byArea.chat.p95Ms, 30);
  assert.equal(summary.taskLatency.p95Ms, 100);
  assert.equal(summary.byStep['student-course-study:load-course'].iterations, 1);
  assertSyntheticJourneySummary(summary);

  assert.equal(lines.length, 4);
  assert.equal(JSON.parse(lines[0]).type, 'synthetic_journey_step');
  assert.equal(JSON.parse(serializeSyntheticJourneySummary(summary)).type, 'synthetic_journey_summary');
  assert.doesNotMatch(lines.join('\n'), /courseCount|example\.edu|message text/i);
});

test('coverage contracts reject missing, duplicated, unexpected, and out-of-order steps', async () => {
  const timestamps = Array.from({ length: 16 }, (_, index) => index);
  const recorder = new SyntheticJourneyRecorder({ now: () => timestamps.shift()! });
  await recorder.step(definition('finish', { iteration: 1 }), () => syntheticObservation('success'));
  await recorder.step(definition('start', { iteration: 1 }), () => syntheticObservation('success'));
  await recorder.step(definition('start', { iteration: 1 }), () => syntheticObservation('success'));
  await recorder.step(definition('extra', { iteration: 1 }), () => syntheticObservation('success'));
  await recorder.step(definition('start', { iteration: 3 }), () => syntheticObservation('success'));
  await recorder.step(definition('foreign', { journeyId: 'unknown-journey' }), () => syntheticObservation('success'));

  const coverage = inspectSyntheticJourneyCoverage(recorder.events, [{
    journeyId: 'student-course-study',
    requiredStepIds: ['start', 'middle', 'finish'],
    iterations: 2,
  }]);
  assert.equal(coverage.passed, false);
  assert.equal(coverage.expectedSteps, 6);
  assert.ok(coverage.issues.some(issue => issue.type === 'missing_step' && issue.stepId === 'middle'));
  assert.ok(coverage.issues.some(issue => issue.type === 'duplicate_step' && issue.stepId === 'start'));
  assert.ok(coverage.issues.some(issue => issue.type === 'out_of_order_step'));
  assert.ok(coverage.issues.some(issue => issue.type === 'unexpected_step' && issue.stepId === 'extra'));
  assert.ok(coverage.issues.some(issue => issue.type === 'unexpected_iteration'));
  assert.ok(coverage.issues.some(issue => issue.type === 'unexpected_journey'));
  assert.throws(() => assertSyntheticJourneyCoverage(coverage), /coverage failed/i);
});

test('repeated complete plans pass coverage and expose lifecycle plus per-step latency', async () => {
  const timestamps = [0, 4, 4, 10, 10, 18, 18, 28];
  const lifecycle: string[] = [];
  const recorder = new SyntheticJourneyRecorder({
    now: () => timestamps.shift()!,
    lifecycleSink: event => lifecycle.push(`${event.phase}:${event.iteration}:${event.stepId}`),
  });
  for (const iteration of [1, 2]) {
    await recorder.step(definition('start', { iteration }), () => syntheticObservation('success'));
    await recorder.step(definition('finish', { iteration }), () => syntheticObservation('success'));
  }
  const coverage = inspectSyntheticJourneyCoverage(recorder.events, [{
    journeyId: 'student-course-study',
    requiredStepIds: ['start', 'finish'],
    iterations: 2,
  }]);
  assert.deepEqual(coverage, {
    passed: true,
    plannedJourneys: 2,
    expectedSteps: 4,
    observedSteps: 4,
    issues: [],
  });
  assertSyntheticJourneyCoverage(coverage);
  assert.equal(recorder.summary().byStep['student-course-study:start'].p95Ms, 8);
  assert.equal(recorder.summary().taskLatency.p95Ms, 18);
  assert.deepEqual(lifecycle, [
    'started:1:start', 'completed:1:start',
    'started:1:finish', 'completed:1:finish',
    'started:2:start', 'completed:2:start',
    'started:2:finish', 'completed:2:finish',
  ]);
});

test('an empty run does not report successful task completion and an aborted step never invokes its action', async () => {
  const empty = new SyntheticJourneyRecorder({ now: () => 0 });
  assert.equal(empty.summary().taskCompletionRate, 0);

  const times = [0, 1];
  const aborted = new SyntheticJourneyRecorder({ now: () => times.shift()! });
  const controller = new AbortController();
  controller.abort();
  let invoked = false;
  const result = await aborted.step(
    definition('cancelled', { expectedOutcome: 'cancelled' }),
    () => {
      invoked = true;
      return syntheticObservation('success');
    },
    { signal: controller.signal },
  );
  assert.equal(invoked, false);
  assert.equal(result.event.outcome, 'cancelled');
});

test('unexpected errors and failed integrity checks remain visible and fail the journey gate', async () => {
  const timestamps = [0, 1, 1, 2];
  const recorder = new SyntheticJourneyRecorder({ now: () => timestamps.shift()! });
  const failedCheck = await recorder.step(definition('bad-convergence'), () => syntheticObservation(
    'success',
    undefined,
    { state_converged: false },
  ));
  const unexpected = await recorder.step(definition('unexpected-error'), () => {
    throw new TypeError('Raw application details must not enter telemetry.');
  });

  assert.equal(failedCheck.event.expectationMatched, true);
  assert.equal(unexpected.event.outcome, 'error');
  assert.equal(unexpected.event.errorClass, 'typeerror');
  assert.equal('errorMessage' in unexpected.event, false);
  const summary = recorder.summary();
  assert.equal(summary.functionallyPassed, 0);
  assert.equal(summary.systemErrors, 1);
  assert.throws(() => assertSyntheticJourneySummary(summary), /failed their expected outcome/i);
});

test('telemetry rejects sensitive labels and invalid clocks without affecting application actions', async () => {
  const unsafe = new SyntheticJourneyRecorder({ now: () => 0 });
  await assert.rejects(
    unsafe.step(definition('student@example.edu'), () => syntheticObservation('success')),
    /non-sensitive telemetry key/i,
  );

  const nonMonotonicTimes = [5, 4];
  const nonMonotonic = new SyntheticJourneyRecorder({ now: () => nonMonotonicTimes.shift()! });
  await assert.rejects(
    nonMonotonic.step(definition('clock-check'), () => syntheticObservation('success')),
    /monotonic/i,
  );

  let actionRan = false;
  const brokenSinkTimes = [0, 1];
  const brokenSink = new SyntheticJourneyRecorder({
    now: () => brokenSinkTimes.shift()!,
    sink: () => { throw new Error('sink unavailable'); },
  });
  await brokenSink.step(definition('sink-check'), () => {
    actionRan = true;
    return syntheticObservation('success');
  });
  assert.equal(actionRan, true);
  assert.equal(brokenSink.summary().telemetrySinkErrors, 1);
});
