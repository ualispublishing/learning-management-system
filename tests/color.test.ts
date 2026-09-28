import test from 'node:test';
import assert from 'node:assert/strict';
import { accessibleForegroundColor, accessibleTextColor, colorContrastRatio, hasAccessibleTextContrast, isSixDigitHexColor } from '../src/lib/color';
import { colors } from '../src/lib/theme';

test('card colors accept only complete six-digit hex values', () => {
  assert.equal(isSixDigitHexColor('#E8F5E9'), true);
  assert.equal(isSixDigitHexColor('#abcdef'), true);
  assert.equal(isSixDigitHexColor('#fff'), false);
  assert.equal(isSixDigitHexColor('red'), false);
  assert.equal(isSixDigitHexColor('#12345g'), false);
  assert.equal(isSixDigitHexColor(''), false);
});

test('card text colors use WCAG contrast instead of a brightness heuristic', () => {
  assert.equal(accessibleTextColor('#777777'), '#000000');
  assert.ok((colorContrastRatio('#000000', '#777777') ?? 0) > 4.5);
  assert.equal(hasAccessibleTextContrast('#FFFFFF', '#777777'), false);
  assert.equal(hasAccessibleTextContrast('#000000', '#777777'), true);
});

test('custom theme colors always receive readable black or white button text', () => {
  for (const background of ['#000000', '#FFFFFF', '#38BDF8', '#7A2EFF', '#FCD34D']) {
    const foreground = accessibleTextColor(background);
    assert.ok(foreground);
    assert.equal(hasAccessibleTextContrast(foreground!, background), true, background);
  }
});

test('custom accents are adjusted to remain readable on active theme surfaces', () => {
  const lightAccent = accessibleForegroundColor('#FFFF00', ['#F8FAFC', '#FFFFFF']);
  assert.ok(lightAccent);
  assert.equal(hasAccessibleTextContrast(lightAccent!, '#F8FAFC'), true);
  assert.equal(hasAccessibleTextContrast(lightAccent!, '#FFFFFF'), true);

  const darkAccent = accessibleForegroundColor('#111111', ['#0F172A', '#1E293B']);
  assert.ok(darkAccent);
  assert.equal(hasAccessibleTextContrast(darkAccent!, '#0F172A'), true);
  assert.equal(hasAccessibleTextContrast(darkAccent!, '#1E293B'), true);
  assert.equal(accessibleForegroundColor('invalid', ['#FFFFFF']), null);
});

test('every semantic theme surface has a WCAG-readable foreground', () => {
  const pairs = [
    ['primary', 'onPrimary'],
    ['secondary', 'onSecondary'],
    ['accent', 'onAccent'],
    ['error', 'onError'],
    ['success', 'onSuccess'],
    ['warning', 'onWarning'],
    ['danger', 'onDanger'],
    ['info', 'onInfo'],
  ] as const;

  for (const mode of ['light', 'dark'] as const) {
    for (const [background, foreground] of pairs) {
      assert.equal(
        hasAccessibleTextContrast(colors[mode][foreground], colors[mode][background]),
        true,
        `${mode} ${foreground} on ${background}`,
      );
    }
  }
});
