import assert from 'node:assert/strict';
import test from 'node:test';

import {
  captureFlashcardPrincipal,
  getFlashcardPrincipalId,
  institutionFlashcardPrincipal,
  isFlashcardPrincipalCurrent,
  setFlashcardPrincipal,
} from '../src/lib/db/principal';

test('institution flashcard principals are namespaced and reject blank identities', () => {
  assert.equal(institutionFlashcardPrincipal(' student-42 '), 'institution:student-42');
  assert.throws(() => institutionFlashcardPrincipal('   '), /user ID is required/);
});

test('a principal capture becomes stale after an account switch', () => {
  setFlashcardPrincipal('institution:account-a');
  const accountA = captureFlashcardPrincipal();
  assert.equal(getFlashcardPrincipalId(), 'institution:account-a');
  assert.equal(isFlashcardPrincipalCurrent(accountA), true);

  setFlashcardPrincipal('institution:account-b');
  assert.equal(isFlashcardPrincipalCurrent(accountA), false);
  assert.equal(getFlashcardPrincipalId(), 'institution:account-b');

  const accountB = captureFlashcardPrincipal();
  setFlashcardPrincipal('institution:account-b');
  assert.equal(isFlashcardPrincipalCurrent(accountB), true, 'reselecting the same account must not invalidate its in-flight work');

  setFlashcardPrincipal(null);
  assert.equal(getFlashcardPrincipalId(), 'user_1');
  assert.equal(isFlashcardPrincipalCurrent(accountB), false);
});
