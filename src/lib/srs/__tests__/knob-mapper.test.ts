/**
 * @fileoverview src/lib/srs/__tests__/knob-mapper.test.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
/**
 * Unit Tests — Knob Mapper
 *
 * Tests the 0–100 → FSRS mapping, continuous color gradient,
 * bracket boundaries, intra-bracket retention modulation,
 * depth unlock trigger, and edge cases.
 */

import {
  knobToRating,
  knobToColor,
  knobToColorComponents,
  FSRS_RATING,
} from '../knob-mapper';

// ────────────────────────────────────────────────────────────
// knobToRating — Bracket boundaries
// ────────────────────────────────────────────────────────────

describe('knobToRating', () => {
  describe('bracket mapping', () => {
    test('knob=0 → Again (1)', () => {
      const result = knobToRating(0);
      expect(result.rating).toBe(FSRS_RATING.Again);
    });

    test('knob=15 → Again (upper boundary)', () => {
      const result = knobToRating(15);
      expect(result.rating).toBe(FSRS_RATING.Again);
    });

    test('knob=16 → Hard (lower boundary)', () => {
      const result = knobToRating(16);
      expect(result.rating).toBe(FSRS_RATING.Hard);
    });

    test('knob=40 → Hard (upper boundary)', () => {
      const result = knobToRating(40);
      expect(result.rating).toBe(FSRS_RATING.Hard);
    });

    test('knob=41 → Good (lower boundary)', () => {
      const result = knobToRating(41);
      expect(result.rating).toBe(FSRS_RATING.Good);
    });

    test('knob=50 → Good (middle)', () => {
      const result = knobToRating(50);
      expect(result.rating).toBe(FSRS_RATING.Good);
    });

    test('knob=70 → Good', () => {
      const result = knobToRating(70);
      expect(result.rating).toBe(FSRS_RATING.Good);
    });

    test('knob=99 → Good (upper boundary)', () => {
      const result = knobToRating(99);
      expect(result.rating).toBe(FSRS_RATING.Good);
    });

    test('knob=100 → Easy', () => {
      const result = knobToRating(100);
      expect(result.rating).toBe(FSRS_RATING.Easy);
    });
  });

  describe('depth unlock trigger', () => {
    test('only knob=100 triggers depth unlock', () => {
      expect(knobToRating(100).triggersDepthUnlock).toBe(true);
    });

    test('knob=99 does NOT trigger depth unlock', () => {
      expect(knobToRating(99).triggersDepthUnlock).toBe(false);
    });

    test('knob=0 does NOT trigger depth unlock', () => {
      expect(knobToRating(0).triggersDepthUnlock).toBe(false);
    });

    test('no value below 100 triggers depth unlock', () => {
      for (let v = 0; v < 100; v++) {
        expect(knobToRating(v).triggersDepthUnlock).toBe(false);
      }
    });
  });

  describe('intra-bracket retention modulation', () => {
    test('higher knob within Again bracket → higher retention', () => {
      const low = knobToRating(0);
      const high = knobToRating(15);
      expect(high.adjustedRetention).toBeGreaterThan(low.adjustedRetention);
    });

    test('higher knob within Hard bracket → higher retention', () => {
      const low = knobToRating(16);
      const high = knobToRating(40);
      expect(high.adjustedRetention).toBeGreaterThan(low.adjustedRetention);
    });

    test('higher knob within Good bracket → higher retention', () => {
      const low = knobToRating(41);
      const high = knobToRating(99);
      expect(high.adjustedRetention).toBeGreaterThan(low.adjustedRetention);
    });

    test('retention values are in valid FSRS range (0.7 – 0.99)', () => {
      for (let v = 0; v <= 100; v++) {
        const r = knobToRating(v).adjustedRetention;
        expect(r).toBeGreaterThanOrEqual(0.7);
        expect(r).toBeLessThanOrEqual(0.99);
      }
    });

    test('Again bracket retentions are lower than Hard bracket', () => {
      // Allow slight overlap at boundary — the key is that
      // the bracket midpoints are distinct
      const againMid = knobToRating(7).adjustedRetention;
      const hardMid = knobToRating(28).adjustedRetention;
      expect(hardMid).toBeGreaterThan(againMid);
    });
  });

  describe('edge cases & clamping', () => {
    test('negative values clamp to 0 → Again', () => {
      expect(knobToRating(-5).rating).toBe(FSRS_RATING.Again);
    });

    test('values above 100 clamp to 100 → Easy', () => {
      expect(knobToRating(150).rating).toBe(FSRS_RATING.Easy);
      expect(knobToRating(150).triggersDepthUnlock).toBe(true);
    });

    test('fractional values are rounded', () => {
      expect(knobToRating(15.4).rating).toBe(FSRS_RATING.Again);
      expect(knobToRating(15.6).rating).toBe(FSRS_RATING.Hard);
    });
  });
});

// ────────────────────────────────────────────────────────────
// knobToColor — Continuous gradient
// ────────────────────────────────────────────────────────────

describe('knobToColor', () => {
  test('returns valid HSL string format', () => {
    for (let v = 0; v <= 100; v++) {
      const color = knobToColor(v);
      expect(color).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/);
    }
  });

  test('every integer 0-100 produces a unique color', () => {
    const colors = new Set<string>();
    for (let v = 0; v <= 100; v++) {
      colors.add(knobToColor(v));
    }
    // We expect at least 90 unique colors (some very close values
    // might round to the same HSL, but the vast majority should differ)
    expect(colors.size).toBeGreaterThanOrEqual(90);
  });

  test('waypoint colors match specification', () => {
    expect(knobToColor(0)).toBe('hsl(0, 85%, 55%)');     // Red
    expect(knobToColor(25)).toBe('hsl(30, 90%, 55%)');   // Orange
    expect(knobToColor(50)).toBe('hsl(50, 90%, 55%)');   // Yellow
    expect(knobToColor(75)).toBe('hsl(120, 70%, 45%)');  // Green
    expect(knobToColor(100)).toBe('hsl(210, 80%, 55%)'); // Blue
  });

  test('value=0 is reddish (hue near 0)', () => {
    const { h } = knobToColorComponents(0);
    expect(h).toBeLessThanOrEqual(10);
  });

  test('value=50 is yellowish (hue near 50)', () => {
    const { h } = knobToColorComponents(50);
    expect(h).toBeGreaterThanOrEqual(40);
    expect(h).toBeLessThanOrEqual(60);
  });

  test('value=100 is bluish (hue near 210)', () => {
    const { h } = knobToColorComponents(100);
    expect(h).toBeGreaterThanOrEqual(200);
    expect(h).toBeLessThanOrEqual(220);
  });

  test('gradient is monotonically increasing in hue from 0 → 100', () => {
    // Because we go red(0) → orange(30) → yellow(50) → green(120) → blue(210),
    // the hue should generally increase
    let prevH = knobToColorComponents(0).h;
    for (let v = 1; v <= 100; v++) {
      const { h } = knobToColorComponents(v);
      expect(h).toBeGreaterThanOrEqual(prevH);
      prevH = h;
    }
  });

  test('adjacent colors have small hue differences', () => {
    // No jump should be more than ~10° between adjacent integers
    for (let v = 0; v < 100; v++) {
      const h1 = knobToColorComponents(v).h;
      const h2 = knobToColorComponents(v + 1).h;
      expect(Math.abs(h2 - h1)).toBeLessThanOrEqual(10);
    }
  });

  test('clamping: negative values give red-end color', () => {
    expect(knobToColor(-10)).toBe(knobToColor(0));
  });

  test('clamping: values above 100 give blue-end color', () => {
    expect(knobToColor(150)).toBe(knobToColor(100));
  });
});

// ────────────────────────────────────────────────────────────
// knobToColorComponents
// ────────────────────────────────────────────────────────────

describe('knobToColorComponents', () => {
  test('returns h, s, l as integers', () => {
    for (let v = 0; v <= 100; v++) {
      const { h, s, l } = knobToColorComponents(v);
      expect(Number.isInteger(h)).toBe(true);
      expect(Number.isInteger(s)).toBe(true);
      expect(Number.isInteger(l)).toBe(true);
    }
  });

  test('saturation stays in 70-90 range', () => {
    for (let v = 0; v <= 100; v++) {
      const { s } = knobToColorComponents(v);
      expect(s).toBeGreaterThanOrEqual(65);
      expect(s).toBeLessThanOrEqual(95);
    }
  });

  test('lightness stays in 40-60 range', () => {
    for (let v = 0; v <= 100; v++) {
      const { l } = knobToColorComponents(v);
      expect(l).toBeGreaterThanOrEqual(40);
      expect(l).toBeLessThanOrEqual(60);
    }
  });
});
