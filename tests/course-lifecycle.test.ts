import assert from 'node:assert/strict';
import test from 'node:test';
import { getCourseLifecyclePhase, isCourseInSessionAt, isCourseOpenAt, isCoursePastAt } from '../src/lib/courseLifecycle';

test('course lifecycle consistently treats status and term end as read-only boundaries', () => {
  const now = Date.parse('2026-09-01T12:00:00Z');
  assert.equal(isCourseOpenAt({ status: 'active', termStart: now - 1, termEnd: now + 1 }, now), true);
  assert.equal(isCoursePastAt({ status: 'active', termStart: now - 1, termEnd: now }, now), true);
  assert.equal(isCoursePastAt({ status: 'past', termStart: now - 1, termEnd: now + 86_400_000 }, now), true);
});

test('course lifecycle distinguishes preparation, active delivery, end boundary, and archive', () => {
  const start = Date.parse('2026-09-01T12:00:00Z');
  const end = Date.parse('2026-12-01T12:00:00Z');
  const course = { status: 'active' as const, termStart: start, termEnd: end };
  const cases = [
    { now: start - 1, phase: 'future', open: true, inSession: false, past: false },
    { now: start, phase: 'active', open: true, inSession: true, past: false },
    { now: end - 1, phase: 'active', open: true, inSession: true, past: false },
    { now: end, phase: 'ended', open: false, inSession: false, past: true },
    { now: end + 1, phase: 'ended', open: false, inSession: false, past: true },
  ] as const;

  cases.forEach(entry => {
    assert.equal(getCourseLifecyclePhase(course, entry.now), entry.phase);
    assert.equal(isCourseOpenAt(course, entry.now), entry.open);
    assert.equal(isCourseInSessionAt(course, entry.now), entry.inSession);
    assert.equal(isCoursePastAt(course, entry.now), entry.past);
  });

  assert.equal(getCourseLifecyclePhase({ ...course, status: 'past' }, start), 'archived');
});

test('malformed lifecycle timestamps fail closed', () => {
  const now = Date.parse('2026-09-01T12:00:00Z');
  for (const course of [
    { status: 'active' as const, termStart: Number.NaN, termEnd: now + 1 },
    { status: 'active' as const, termStart: now, termEnd: Number.POSITIVE_INFINITY },
    { status: 'active' as const, termStart: now, termEnd: now },
    { status: 'active' as const, termStart: now + 1, termEnd: now },
  ]) {
    assert.equal(getCourseLifecyclePhase(course, now), 'invalid');
    assert.equal(isCourseOpenAt(course, now), false);
    assert.equal(isCourseInSessionAt(course, now), false);
    assert.equal(isCoursePastAt(course, now), true);
  }
  assert.equal(getCourseLifecyclePhase({ status: 'active', termStart: now - 1, termEnd: now + 1 }, Number.NaN), 'invalid');
  assert.equal(getCourseLifecyclePhase({ status: 'unknown' as 'active', termStart: now - 1, termEnd: now + 1 }, now), 'invalid');
});
