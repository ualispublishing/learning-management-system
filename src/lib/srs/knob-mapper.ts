/**
 * @fileoverview src/lib/srs/knob-mapper.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import { Rating } from 'ts-fsrs';

export function knobToRating(value: number): { rating: Rating; triggersDepthUnlock: boolean } {
  const clamped = Math.max(0, Math.min(100, value));
  if (clamped <= 15) {
    return { rating: Rating.Again, triggersDepthUnlock: false };
  } else if (clamped <= 40) {
    return { rating: Rating.Hard, triggersDepthUnlock: false };
  } else if (clamped <= 99) {
    return { rating: Rating.Good, triggersDepthUnlock: false };
  } else {
    return { rating: Rating.Easy, triggersDepthUnlock: true };
  }
}

function interpolate(start: number, end: number, factor: number): number {
  return start + (end - start) * factor;
}

export function knobToColor(value: number): string {
  const clamped = Math.max(0, Math.min(100, value));
  
  const waypoints = [
    { v: 0, h: 0, s: 85, l: 55 },
    { v: 25, h: 30, s: 90, l: 55 },
    { v: 50, h: 50, s: 90, l: 55 },
    { v: 75, h: 120, s: 70, l: 45 },
    { v: 100, h: 210, s: 80, l: 55 },
  ];

  let lower = waypoints[0];
  let upper = waypoints[waypoints.length - 1];

  for (let i = 0; i < waypoints.length - 1; i++) {
    if (clamped >= waypoints[i].v && clamped <= waypoints[i + 1].v) {
      lower = waypoints[i];
      upper = waypoints[i + 1];
      break;
    }
  }

  if (lower.v === upper.v) {
    return `hsl(${lower.h}, ${lower.s}%, ${lower.l}%)`;
  }

  const factor = (clamped - lower.v) / (upper.v - lower.v);
  const h = interpolate(lower.h, upper.h, factor);
  const s = interpolate(lower.s, upper.s, factor);
  const l = interpolate(lower.l, upper.l, factor);

  return `hsl(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%)`;
}

// FSRS request_retention is usually 0.9.
// We can modulate it slightly based on the knob value within the bracket.
// Higher knob value means higher retention expectation -> we can set request_retention slightly lower to space it out more?
// Actually, higher knob value within the bracket means it was easier, so we can afford a longer interval.
// FSRS calculates interval such that probability of recall drops to request_retention.
// So lower request_retention -> longer interval.
// Let's modulate request_retention between 0.85 and 0.95.
// If default is 0.9, a "better" score (closer to top of bracket) gives lower retention target (longer interval).
export function getModulatedRetention(knobValue: number, defaultRetention: number = 0.9): number {
  const clamped = Math.max(0, Math.min(100, knobValue));
  let bracketMin = 0;
  let bracketMax = 100;
  
  if (clamped <= 15) {
    bracketMin = 0; bracketMax = 15;
  } else if (clamped <= 40) {
    bracketMin = 15; bracketMax = 40;
  } else {
    bracketMin = 40; bracketMax = 100;
  }

  if (bracketMin === bracketMax) return defaultRetention;

  const factor = (clamped - bracketMin) / (bracketMax - bracketMin);
  // factor 0 -> bottom of bracket (harder) -> needs shorter interval -> higher retention target
  // factor 1 -> top of bracket (easier) -> needs longer interval -> lower retention target
  const maxRetention = Math.min(0.99, defaultRetention + 0.05);
  const minRetention = Math.max(0.70, defaultRetention - 0.05);

  return interpolate(maxRetention, minRetention, factor);
}
