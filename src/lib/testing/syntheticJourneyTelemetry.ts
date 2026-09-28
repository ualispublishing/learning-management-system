/**
 * @fileoverview src/lib/testing/syntheticJourneyTelemetry.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
export type SyntheticJourneyOutcome = 'success' | 'denied' | 'recovered' | 'no_op' | 'cancelled' | 'error';

export type SyntheticCompletionBoundary =
  | 'handler_resolved'
  | 'repository_acknowledged'
  | 'state_converged'
  | 'navigation_target_built';

export interface SyntheticJourneyStepDefinition {
  runId: string;
  journeyId: string;
  stepId: string;
  iteration?: number;
  area: string;
  role: string;
  completionBoundary: SyntheticCompletionBoundary;
  expectedOutcome?: Exclude<SyntheticJourneyOutcome, 'error'>;
  budgetMs?: number;
  tags?: string[];
}

export interface SyntheticJourneyObservation<T = unknown> {
  outcome: Exclude<SyntheticJourneyOutcome, 'error'>;
  value?: T;
  checks?: Readonly<Record<string, boolean>>;
  measurements?: Readonly<Record<string, number>>;
}

export interface SyntheticJourneyEvent {
  schemaVersion: 1;
  sampleType: 'synthetic';
  sequence: number;
  runId: string;
  journeyId: string;
  stepId: string;
  iteration: number;
  area: string;
  role: string;
  completionBoundary: SyntheticCompletionBoundary;
  expectedOutcome: Exclude<SyntheticJourneyOutcome, 'error'>;
  outcome: SyntheticJourneyOutcome;
  expectationMatched: boolean;
  checks: Readonly<Record<string, boolean>>;
  measurements: Readonly<Record<string, number>>;
  durationMs: number;
  budgetMs?: number;
  budgetPassed?: boolean;
  tags: string[];
  errorClass?: string;
}

export interface SyntheticLatencySummary {
  averageMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

export interface SyntheticSliceSummary extends SyntheticLatencySummary {
  steps: number;
  functionallyPassed: number;
  functionalPassRate: number;
  systemErrors: number;
}

export interface SyntheticJourneySummary extends SyntheticSliceSummary {
  schemaVersion: 1;
  sampleType: 'synthetic';
  runId: string;
  journeys: number;
  journeysCompleted: number;
  taskCompletionRate: number;
  expectedDenials: number;
  expectedDenialsEnforced: number;
  expectedDenialAccuracy: number;
  performanceBudgets: number;
  performanceBudgetsPassed: number;
  performanceBudgetPassRate: number;
  telemetrySinkErrors: number;
  taskLatency: SyntheticLatencySummary;
  outcomes: Record<SyntheticJourneyOutcome, number>;
  qualityChecks: Record<string, { total: number; passed: number; passRate: number }>;
  byArea: Record<string, SyntheticSliceSummary>;
  byRole: Record<string, SyntheticSliceSummary>;
  byStep: Record<string, SyntheticSliceSummary & { iterations: number }>;
}

export type SyntheticJourneySink = (event: SyntheticJourneyEvent) => void;

export interface SyntheticJourneyLifecycleEvent {
  phase: 'started' | 'completed';
  runId: string;
  journeyId: string;
  stepId: string;
  iteration: number;
}

export interface SyntheticJourneyPlanContract {
  journeyId: string;
  requiredStepIds: readonly string[];
  iterations?: number;
}

export type SyntheticJourneyCoverageIssueType =
  | 'missing_step'
  | 'duplicate_step'
  | 'out_of_order_step'
  | 'unexpected_step'
  | 'unexpected_journey'
  | 'unexpected_iteration';

export interface SyntheticJourneyCoverageIssue {
  type: SyntheticJourneyCoverageIssueType;
  journeyId: string;
  iteration: number;
  stepId?: string;
}

export interface SyntheticJourneyCoverage {
  passed: boolean;
  plannedJourneys: number;
  expectedSteps: number;
  observedSteps: number;
  issues: SyntheticJourneyCoverageIssue[];
}

export interface SyntheticJourneyRecorderOptions {
  now?: () => number;
  sink?: SyntheticJourneySink;
  lifecycleSink?: (event: SyntheticJourneyLifecycleEvent) => void;
}

export interface SyntheticJourneyStepOptions {
  signal?: AbortSignal;
}

export interface SyntheticJourneyStepResult<T> {
  event: SyntheticJourneyEvent;
  value?: T;
}

const SAFE_KEY = /^[a-z0-9][a-z0-9_.:-]{0,119}$/;

function assertSafeKey(value: string, field: string): void {
  if (!SAFE_KEY.test(value)) throw new Error(`${field} must be a stable, non-sensitive telemetry key.`);
}

function assertDefinition(definition: SyntheticJourneyStepDefinition): void {
  for (const [field, value] of Object.entries({
    runId: definition.runId,
    journeyId: definition.journeyId,
    stepId: definition.stepId,
    area: definition.area,
    role: definition.role,
  })) assertSafeKey(value, field);
  for (const tag of definition.tags ?? []) assertSafeKey(tag, 'tag');
  if (definition.budgetMs !== undefined && (!Number.isFinite(definition.budgetMs) || definition.budgetMs < 0)) {
    throw new Error('budgetMs must be a finite non-negative number.');
  }
  if (definition.iteration !== undefined && (!Number.isInteger(definition.iteration) || definition.iteration < 1)) {
    throw new Error('iteration must be a positive integer.');
  }
}

function sanitizedErrorClass(error: unknown): string {
  if (error instanceof Error && SAFE_KEY.test(error.name.toLocaleLowerCase())) return error.name.toLocaleLowerCase();
  return 'unknown_error';
}

function normalizedNumber(value: number, field: string): number {
  if (!Number.isFinite(value)) throw new Error(`${field} must be finite.`);
  return Math.round(value * 1_000) / 1_000;
}

function normalizedRecord(
  values: Readonly<Record<string, number>> | undefined,
): Readonly<Record<string, number>> {
  if (!values) return {};
  return Object.fromEntries(Object.entries(values).map(([key, value]) => {
    assertSafeKey(key, 'measurement');
    return [key, normalizedNumber(value, `measurement ${key}`)];
  }));
}

function normalizedChecks(
  values: Readonly<Record<string, boolean>> | undefined,
): Readonly<Record<string, boolean>> {
  if (!values) return {};
  return Object.fromEntries(Object.entries(values).map(([key, value]) => {
    assertSafeKey(key, 'check');
    if (typeof value !== 'boolean') throw new Error(`check ${key} must be boolean.`);
    return [key, value];
  }));
}

function eventFunctionallyPassed(event: SyntheticJourneyEvent): boolean {
  return event.expectationMatched && Object.values(event.checks).every(Boolean);
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : Math.round((numerator / denominator) * 10_000) / 10_000;
}

function percentile(sorted: number[], proportion: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.max(0, Math.ceil(sorted.length * proportion) - 1);
  return sorted[Math.min(index, sorted.length - 1)];
}

function latency(events: SyntheticJourneyEvent[]): SyntheticLatencySummary {
  return latencyValues(events.map(event => event.durationMs));
}

function latencyValues(input: number[]): SyntheticLatencySummary {
  const values = [...input].sort((a, b) => a - b);
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    averageMs: normalizedNumber(values.length ? total / values.length : 0, 'average latency'),
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    maxMs: values.at(-1) ?? 0,
  };
}

function slice(events: SyntheticJourneyEvent[]): SyntheticSliceSummary {
  const functionallyPassed = events.filter(eventFunctionallyPassed).length;
  return {
    steps: events.length,
    functionallyPassed,
    functionalPassRate: rate(functionallyPassed, events.length),
    systemErrors: events.filter(event => event.outcome === 'error').length,
    ...latency(events),
  };
}

function groupedSummary(events: SyntheticJourneyEvent[], field: 'area' | 'role'): Record<string, SyntheticSliceSummary> {
  const grouped = new Map<string, SyntheticJourneyEvent[]>();
  for (const event of events) {
    const key = event[field];
    grouped.set(key, [...(grouped.get(key) ?? []), event]);
  }
  return Object.fromEntries([...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, values]) => [key, slice(values)]));
}

function groupedStepSummary(events: SyntheticJourneyEvent[]): SyntheticJourneySummary['byStep'] {
  const grouped = new Map<string, SyntheticJourneyEvent[]>();
  for (const event of events) {
    const key = `${event.journeyId}:${event.stepId}`;
    grouped.set(key, [...(grouped.get(key) ?? []), event]);
  }
  return Object.fromEntries([...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, values]) => [key, {
      ...slice(values),
      iterations: new Set(values.map(event => event.iteration)).size,
    }]));
}

export class SyntheticJourneyRecorder {
  readonly events: SyntheticJourneyEvent[] = [];
  private readonly now: () => number;
  private readonly sink?: SyntheticJourneySink;
  private readonly lifecycleSink?: (event: SyntheticJourneyLifecycleEvent) => void;
  private sequence = 0;
  private sinkErrors = 0;

  constructor(options: SyntheticJourneyRecorderOptions = {}) {
    this.now = options.now ?? (() => performance.now());
    this.sink = options.sink;
    this.lifecycleSink = options.lifecycleSink;
  }

  private emitLifecycle(event: SyntheticJourneyLifecycleEvent): void {
    if (!this.lifecycleSink) return;
    try {
      this.lifecycleSink(event);
    } catch {
      this.sinkErrors += 1;
    }
  }

  async step<T>(
    definition: SyntheticJourneyStepDefinition,
    action: (signal?: AbortSignal) => Promise<SyntheticJourneyObservation<T>> | SyntheticJourneyObservation<T>,
    options: SyntheticJourneyStepOptions = {},
  ): Promise<SyntheticJourneyStepResult<T>> {
    assertDefinition(definition);
    const expectedOutcome = definition.expectedOutcome ?? 'success';
    const iteration = definition.iteration ?? 1;
    this.emitLifecycle({
      phase: 'started',
      runId: definition.runId,
      journeyId: definition.journeyId,
      stepId: definition.stepId,
      iteration,
    });
    const startedAt = this.now();
    if (!Number.isFinite(startedAt)) throw new Error('The synthetic telemetry clock returned an invalid start time.');

    let observation: SyntheticJourneyObservation<T> | undefined;
    let errorClass: string | undefined;
    try {
      observation = options.signal?.aborted
        ? syntheticObservation('cancelled')
        : await action(options.signal);
    } catch (error) {
      errorClass = sanitizedErrorClass(error);
    }

    const finishedAt = this.now();
    if (!Number.isFinite(finishedAt) || finishedAt < startedAt) {
      throw new Error('The synthetic telemetry clock must be finite and monotonic.');
    }
    const durationMs = normalizedNumber(finishedAt - startedAt, 'durationMs');
    const outcome = observation?.outcome ?? 'error';
    const checks = normalizedChecks(observation?.checks);
    const measurements = normalizedRecord(observation?.measurements);
    const budgetPassed = definition.budgetMs === undefined ? undefined : durationMs <= definition.budgetMs;
    const event: SyntheticJourneyEvent = {
      schemaVersion: 1,
      sampleType: 'synthetic',
      sequence: ++this.sequence,
      runId: definition.runId,
      journeyId: definition.journeyId,
      stepId: definition.stepId,
      iteration,
      area: definition.area,
      role: definition.role,
      completionBoundary: definition.completionBoundary,
      expectedOutcome,
      outcome,
      expectationMatched: outcome === expectedOutcome,
      checks,
      measurements,
      durationMs,
      budgetMs: definition.budgetMs,
      budgetPassed,
      tags: [...(definition.tags ?? [])],
      errorClass,
    };
    this.events.push(event);
    this.emitLifecycle({
      phase: 'completed',
      runId: definition.runId,
      journeyId: definition.journeyId,
      stepId: definition.stepId,
      iteration,
    });
    if (this.sink) {
      try {
        this.sink(event);
      } catch {
        this.sinkErrors += 1;
      }
    }
    return { event, value: observation?.value };
  }

  summary(): SyntheticJourneySummary {
    const runIds = new Set(this.events.map(event => event.runId));
    if (runIds.size > 1) throw new Error('A synthetic journey recorder cannot mix run identifiers.');
    const journeyEvents = new Map<string, SyntheticJourneyEvent[]>();
    for (const event of this.events) {
      const key = `${event.journeyId}:${event.iteration}`;
      journeyEvents.set(key, [...(journeyEvents.get(key) ?? []), event]);
    }
    const journeysCompleted = [...journeyEvents.values()]
      .filter(events => events.length > 0 && events.every(eventFunctionallyPassed)).length;
    const expectedDenials = this.events.filter(event => event.expectedOutcome === 'denied');
    const expectedDenialsEnforced = expectedDenials.filter(eventFunctionallyPassed).length;
    const budgeted = this.events.filter(event => event.budgetPassed !== undefined);
    const budgetsPassed = budgeted.filter(event => event.budgetPassed).length;
    const qualityChecks: SyntheticJourneySummary['qualityChecks'] = {};
    for (const event of this.events) {
      for (const [name, passed] of Object.entries(event.checks)) {
        const current = qualityChecks[name] ?? { total: 0, passed: 0, passRate: 1 };
        current.total += 1;
        if (passed) current.passed += 1;
        current.passRate = rate(current.passed, current.total);
        qualityChecks[name] = current;
      }
    }
    const outcomes: SyntheticJourneySummary['outcomes'] = {
      success: 0,
      denied: 0,
      recovered: 0,
      no_op: 0,
      cancelled: 0,
      error: 0,
    };
    for (const event of this.events) outcomes[event.outcome] += 1;
    return {
      schemaVersion: 1,
      sampleType: 'synthetic',
      runId: this.events[0]?.runId ?? 'empty-run',
      journeys: journeyEvents.size,
      journeysCompleted,
      taskCompletionRate: journeyEvents.size === 0 ? 0 : rate(journeysCompleted, journeyEvents.size),
      expectedDenials: expectedDenials.length,
      expectedDenialsEnforced,
      expectedDenialAccuracy: rate(expectedDenialsEnforced, expectedDenials.length),
      performanceBudgets: budgeted.length,
      performanceBudgetsPassed: budgetsPassed,
      performanceBudgetPassRate: rate(budgetsPassed, budgeted.length),
      telemetrySinkErrors: this.sinkErrors,
      taskLatency: latencyValues([...journeyEvents.values()].map(events => (
        normalizedNumber(events.reduce((total, event) => total + event.durationMs, 0), 'task latency')
      ))),
      outcomes,
      qualityChecks,
      byArea: groupedSummary(this.events, 'area'),
      byRole: groupedSummary(this.events, 'role'),
      byStep: groupedStepSummary(this.events),
      ...slice(this.events),
    };
  }
}

export function syntheticObservation<T>(
  outcome: Exclude<SyntheticJourneyOutcome, 'error'>,
  value?: T,
  checks?: Readonly<Record<string, boolean>>,
  measurements?: Readonly<Record<string, number>>,
): SyntheticJourneyObservation<T> {
  return { outcome, value, checks, measurements };
}

export function createSyntheticNdjsonSink(write: (line: string) => void): SyntheticJourneySink {
  return event => write(JSON.stringify({ type: 'synthetic_journey_step', ...event }));
}

export function serializeSyntheticJourneySummary(summary: SyntheticJourneySummary): string {
  return JSON.stringify({ type: 'synthetic_journey_summary', ...summary });
}

export function assertSyntheticJourneySummary(summary: SyntheticJourneySummary): void {
  if (summary.telemetrySinkErrors > 0) throw new Error('Synthetic journey telemetry output failed.');
  if (summary.systemErrors > 0 || summary.functionallyPassed !== summary.steps) {
    throw new Error('One or more synthetic journey steps failed their expected outcome or integrity checks.');
  }
}

export function inspectSyntheticJourneyCoverage(
  events: readonly SyntheticJourneyEvent[],
  contracts: readonly SyntheticJourneyPlanContract[],
): SyntheticJourneyCoverage {
  const issues: SyntheticJourneyCoverageIssue[] = [];
  const contractsByJourney = new Map<string, SyntheticJourneyPlanContract>();
  let expectedSteps = 0;
  let plannedJourneys = 0;

  for (const contract of contracts) {
    assertSafeKey(contract.journeyId, 'journeyId');
    if (contractsByJourney.has(contract.journeyId)) {
      throw new Error(`Duplicate synthetic journey contract: ${contract.journeyId}.`);
    }
    if (contract.requiredStepIds.length === 0) {
      throw new Error(`Synthetic journey contract ${contract.journeyId} must require at least one step.`);
    }
    const required = new Set<string>();
    for (const stepId of contract.requiredStepIds) {
      assertSafeKey(stepId, 'stepId');
      if (required.has(stepId)) throw new Error(`Duplicate required step ${contract.journeyId}:${stepId}.`);
      required.add(stepId);
    }
    const iterations = contract.iterations ?? 1;
    if (!Number.isInteger(iterations) || iterations < 1) throw new Error('Contract iterations must be a positive integer.');
    contractsByJourney.set(contract.journeyId, contract);
    plannedJourneys += iterations;
    expectedSteps += contract.requiredStepIds.length * iterations;
  }

  for (const event of events) {
    const contract = contractsByJourney.get(event.journeyId);
    if (!contract) {
      issues.push({ type: 'unexpected_journey', journeyId: event.journeyId, iteration: event.iteration, stepId: event.stepId });
      continue;
    }
    if (event.iteration > (contract.iterations ?? 1)) {
      issues.push({ type: 'unexpected_iteration', journeyId: event.journeyId, iteration: event.iteration, stepId: event.stepId });
    }
  }

  for (const contract of contracts) {
    const requiredStepIds = [...contract.requiredStepIds];
    const required = new Set(requiredStepIds);
    for (let iteration = 1; iteration <= (contract.iterations ?? 1); iteration += 1) {
      const observed = events
        .filter(event => event.journeyId === contract.journeyId && event.iteration === iteration)
        .sort((left, right) => left.sequence - right.sequence);
      const counts = new Map<string, number>();
      for (const event of observed) counts.set(event.stepId, (counts.get(event.stepId) ?? 0) + 1);
      for (const stepId of requiredStepIds) {
        const count = counts.get(stepId) ?? 0;
        if (count === 0) issues.push({ type: 'missing_step', journeyId: contract.journeyId, iteration, stepId });
        if (count > 1) issues.push({ type: 'duplicate_step', journeyId: contract.journeyId, iteration, stepId });
      }
      for (const stepId of counts.keys()) {
        if (!required.has(stepId)) issues.push({ type: 'unexpected_step', journeyId: contract.journeyId, iteration, stepId });
      }
      const observedRequired = observed.filter(event => required.has(event.stepId)).map(event => event.stepId);
      const uniqueObserved = observedRequired.filter((stepId, index) => observedRequired.indexOf(stepId) === index);
      const expectedObservedOrder = requiredStepIds.filter(stepId => uniqueObserved.includes(stepId));
      if (uniqueObserved.some((stepId, index) => stepId !== expectedObservedOrder[index])) {
        issues.push({ type: 'out_of_order_step', journeyId: contract.journeyId, iteration });
      }
    }
  }

  return {
    passed: issues.length === 0,
    plannedJourneys,
    expectedSteps,
    observedSteps: events.length,
    issues,
  };
}

export function assertSyntheticJourneyCoverage(coverage: SyntheticJourneyCoverage): void {
  if (!coverage.passed) {
    const issueSummary = coverage.issues
      .map(issue => `${issue.type}:${issue.journeyId}:${issue.iteration}${issue.stepId ? `:${issue.stepId}` : ''}`)
      .join(', ');
    throw new Error(`Synthetic journey coverage failed: ${issueSummary}.`);
  }
}
