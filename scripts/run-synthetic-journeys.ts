import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  assertFullAppSyntheticJourneyResult,
  runFullAppSyntheticJourneys,
} from '../src/lib/testing/fullAppSyntheticJourneys';
import { createSyntheticNdjsonSink } from '../src/lib/testing/syntheticJourneyTelemetry';

const argumentValue = (name: string): string | undefined => {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find(argument => argument.startsWith(prefix))?.slice(prefix.length);
};

const hasFlag = (name: string): boolean => process.argv.slice(2).includes(`--${name}`);

const main = async (): Promise<void> => {
  const iterationsValue = argumentValue('iterations');
  const iterations = iterationsValue === undefined ? 30 : Number(iterationsValue);
  const outputPath = argumentValue('output');
  const emitEvents = hasFlag('events');
  const runId = argumentValue('run-id') ?? 'full-app-synthetic';

  const result = await runFullAppSyntheticJourneys({
    iterations,
    runId,
    sink: emitEvents
      ? createSyntheticNdjsonSink(line => process.stdout.write(`${line}\n`))
      : undefined,
  });

  const report = {
    type: 'synthetic_journey_report',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    summary: result.summary,
    coverage: result.coverage,
    limitations: result.limitations,
  };

  if (outputPath) {
    const absoluteOutputPath = resolve(outputPath);
    await writeFile(absoluteOutputPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  }

  assertFullAppSyntheticJourneyResult(result);

  const compactResult = {
    type: 'synthetic_journey_result',
    status: 'passed',
    runId: result.summary.runId,
    iterations,
    journeys: result.summary.journeys,
    steps: result.summary.steps,
    functionalPassRate: result.summary.functionalPassRate,
    taskCompletionRate: result.summary.taskCompletionRate,
    expectedDenialAccuracy: result.summary.expectedDenialAccuracy,
    performanceBudgetPassRate: result.summary.performanceBudgetPassRate,
    p50StepMs: result.summary.p50Ms,
    p95StepMs: result.summary.p95Ms,
    p95TaskMs: result.summary.taskLatency.p95Ms,
    systemErrors: result.summary.systemErrors,
    coveragePassed: result.coverage.passed,
    output: outputPath ? resolve(outputPath) : undefined,
  };

  process.stdout.write(`${JSON.stringify(compactResult, null, 2)}\n`);
};

void main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Synthetic journey execution failed.'}\n`);
  process.exitCode = 1;
});
