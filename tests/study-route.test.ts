import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeStudyRoute } from '../src/lib/studyRoute';

test('study routes normalize internal links and safe defaults', () => {
  assert.deepEqual(normalizeStudyRoute({
    deckId: 'deck-1', target: '0005', mode: 'learn', startPos: '0002', group: undefined,
  }), {
    success: true,
    deckId: 'deck-1',
    target: '5',
    mode: 'learn',
    startPos: '2',
    group: 'all',
  });
  assert.deepEqual(normalizeStudyRoute({
    deckId: ['all'], target: undefined, mode: undefined, startPos: undefined, group: ['overdue'],
  }), {
    success: true,
    deckId: 'all',
    target: 'all',
    mode: 'study',
    startPos: '1',
    group: 'overdue',
  });
});

test('study routes reject ambiguous and state-changing fallback inputs', () => {
  const rejected = [
    normalizeStudyRoute({ deckId: undefined, target: '5', mode: 'study', startPos: '1', group: 'all' }),
    normalizeStudyRoute({ deckId: 'deck-1', target: ['5', '10'], mode: 'study', startPos: '1', group: 'all' }),
    normalizeStudyRoute({ deckId: 'deck-1', target: 'custom', mode: 'study', startPos: '1', group: 'all' }),
    normalizeStudyRoute({ deckId: 'deck-1', target: '5', mode: 'delete', startPos: '1', group: 'all' }),
    normalizeStudyRoute({ deckId: 'all', target: 'all', mode: 'study', startPos: '1', group: 'private' }),
    normalizeStudyRoute({ deckId: 'deck-1', target: '5', mode: 'quiz', startPos: '0', group: 'all' }),
    normalizeStudyRoute({ deckId: `deck-${'x'.repeat(260)}`, target: '5', mode: 'study', startPos: '1', group: 'all' }),
    normalizeStudyRoute({ deckId: 'deck\u0000hidden', target: '5', mode: 'study', startPos: '1', group: 'all' }),
    normalizeStudyRoute({ deckId: 'deck-1', target: '9'.repeat(100), mode: 'study', startPos: '1', group: 'all' }),
  ];
  rejected.forEach(result => assert.equal(result.success, false));
});

test('irrelevant deck group is normalized away and unseen starts stay explicit', () => {
  const result = normalizeStudyRoute({ deckId: 'deck-1', target: '10', mode: 'quiz', startPos: 'unseen', group: 'overdue' });
  assert.deepEqual(result, {
    success: true,
    deckId: 'deck-1',
    target: '10',
    mode: 'quiz',
    startPos: 'unseen',
    group: 'all',
  });
});
