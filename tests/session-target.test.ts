import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSessionLimit, parseStartPosition } from '../src/lib/sessionTarget';
import { cardPlainText } from '../src/lib/cardText';

test('session limits accept bounded positive integers and the explicit all marker', () => {
  assert.equal(parseSessionLimit('1'), 1);
  assert.equal(parseSessionLimit('1000'), 1000);
  assert.equal(parseSessionLimit('∞'), 'all');
  for (const value of ['', '0', '-1', '1.5', '1001', 'abc']) {
    assert.equal(parseSessionLimit(value), null, value);
  }
});

test('start positions remain inside known deck boundaries', () => {
  assert.equal(parseStartPosition('12', 20), 12);
  assert.equal(parseStartPosition('21', 20), null);
  assert.equal(parseStartPosition('0', 20), null);
});

test('card previews remove media addresses without fetching or exposing them', () => {
  const preview = cardPlainText('**Term** ![diagram](https://tracker.example/x.png) [VIDEO:https://example/video]');
  assert.equal(preview, 'Term [Image: diagram] [video]');
  assert.equal(preview.includes('https://'), false);
});
