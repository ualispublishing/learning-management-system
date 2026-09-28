import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  attachAIProcessingAttestation,
  beginAIRequestSession,
  completeAIRequestSession,
  createAIProcessingAttestation,
  createAIRequestSessionState,
  isCurrentAIRequestSession,
  resetAIRequestSession,
  runAttestedAIRequest,
} from '../src/lib/ai/processingConsent';

test('AI processing requests never invoke the provider before a valid acknowledgement', async () => {
  let providerCalls = 0;
  const provider = async () => {
    providerCalls += 1;
    return ['generated'];
  };

  await assert.rejects(() => runAttestedAIRequest(null, provider), /Confirm source rights/);
  await assert.rejects(() => runAttestedAIRequest({
    sourceRightsAttested: true,
    sourceRightsAttestedAt: 'not-a-date',
  }, provider), /Confirm source rights/);
  await assert.rejects(() => runAttestedAIRequest({
    sourceRightsAttested: true,
    sourceRightsAttestedAt: '2026-08-20',
  }, provider), /Confirm source rights/);
  assert.equal(providerCalls, 0);

  const attestation = createAIProcessingAttestation(new Date('2026-08-20T15:30:00.000Z'));
  assert.deepEqual(await runAttestedAIRequest(attestation, provider), ['generated']);
  assert.equal(providerCalls, 1);
});

test('published AI metadata retains the exact source-rights acknowledgement', () => {
  const attestation = createAIProcessingAttestation(new Date('2026-08-20T15:30:00.000Z'));
  const metadata = attachAIProcessingAttestation({
    task: 'flashcards',
    promptVersion: 'flashcards-v1',
    sourceRightsAttested: false,
  }, attestation);

  assert.deepEqual(metadata, {
    task: 'flashcards',
    promptVersion: 'flashcards-v1',
    sourceRightsAttested: true,
    sourceRightsAttestedAt: '2026-08-20T15:30:00.000Z',
  });
  assert.throws(
    () => attachAIProcessingAttestation({ task: 'flashcards' }, undefined),
    /valid AI processing acknowledgement/,
  );
  assert.throws(
    () => createAIProcessingAttestation(new Date(Number.NaN)),
    /valid timestamp/,
  );
});

test('AI request sessions reject double starts and isolate stale completions from retries', () => {
  const state = createAIRequestSessionState();
  const first = beginAIRequestSession(state);
  assert.equal(first, 1);
  assert.equal(beginAIRequestSession(state), null, 'a rapid second start cannot create another request');

  resetAIRequestSession(state);
  assert.equal(isCurrentAIRequestSession(state, first!), false, 'changing or closing the source invalidates the old response');

  const second = beginAIRequestSession(state);
  assert.equal(second, 3);
  assert.equal(completeAIRequestSession(state, first!), false);
  assert.equal(state.inFlight, second, 'a stale completion cannot unlock the current request');
  assert.equal(beginAIRequestSession(state), null);

  assert.equal(completeAIRequestSession(state, second!), true);
  assert.equal(state.inFlight, null);
  assert.equal(beginAIRequestSession(state), 4, 'a completed attempt can be retried once');
});

test('flashcard review UI gates generation and persists the acknowledgement through content creation', async () => {
  const [modalSource, managerSource] = await Promise.all([
    readFile(new URL('../src/components/lms/FlashcardReviewModal.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/lms/shared/BaseContentManager.tsx', import.meta.url), 'utf8'),
  ]);

  assert.match(modalSource, /runAttestedAIRequest\(attestation, \(\) => generateValidatedFlashcards\(generationInput\)\)/);
  assert.match(modalSource, /if \(!visible \|\| !sourceRightsConfirmed\) return;/);
  assert.match(modalSource, /onApprove\(publishableCards, sourceAttestation\)/);
  assert.match(managerSource, /onApprove=\{async \(cards, sourceAttestation\) =>/);
  assert.match(managerSource, /ai: attachAIProcessingAttestation\(\{/);
  assert.match(managerSource, /\}, sourceAttestation\),/);
});
