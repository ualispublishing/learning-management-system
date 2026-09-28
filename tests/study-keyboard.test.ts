import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldIgnoreStudyShortcut } from '../src/lib/studyKeyboard';

test('study shortcuts ignore focused native form and link elements', () => {
  for (const tagName of ['INPUT', 'textarea', 'Select', 'BUTTON', 'A']) {
    assert.equal(shouldIgnoreStudyShortcut({ tagName }), true, tagName);
  }
});

test('study shortcuts ignore contenteditable descendants and ARIA widgets', () => {
  assert.equal(shouldIgnoreStudyShortcut({ isContentEditable: true }), true);
  let closestCalled = false;
  assert.equal(shouldIgnoreStudyShortcut({
    tagName: 'DIV',
    closest: () => {
      closestCalled = true;
      return { role: 'slider' };
    },
  }), true);
  assert.equal(closestCalled, true);
});

test('study shortcuts remain available on non-interactive page content', () => {
  assert.equal(shouldIgnoreStudyShortcut({ tagName: 'DIV', closest: () => null }), false);
  assert.equal(shouldIgnoreStudyShortcut(null), false);
});
