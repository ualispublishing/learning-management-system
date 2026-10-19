import assert from 'node:assert/strict';
import test from 'node:test';
import { generationAttribution, readPreparedGeneration } from '../src/lib/ai/generationAttribution';
import { readServerProvenance, validateInstitutionFlashcardResult } from '../src/lib/ai/responseValidation';
import { FLASHCARD_PROMPT_VERSION } from '../src/lib/ai/prompts';

const generation = { authoringTool: 'Synthetic test tool', preparedOn: '2026-10-06', model: 'synthetic-author', reasoningEffort: 'test', recordSha256: 'a'.repeat(64) };
const provenance = { promptVersion: FLASHCARD_PROMPT_VERSION, evidenceVerified: true, model: 'prepared-demo/v1', sourceSha256: 'b'.repeat(64), documentSha256: 'c'.repeat(64), preparedGeneration: generation };

test('authoring metadata is bounded, source-bound, and consistent across a card set', () => {
  assert.deepEqual(readServerProvenance({ provenance }, 'flashcards', true)?.preparedGeneration, generation);
  for (const invalid of [null, [], {}, { ...generation, model: undefined }, { ...generation, model: 'x'.repeat(161) }, { ...generation, reasoningEffort: 'x'.repeat(81) }, { ...generation, preparedOn: '2026-02-30' }, { ...generation, recordSha256: 'bad' }, { ...generation, extra: 'field' }, { ...generation, authoringTool: 'forged\nlabel' }]) {
    assert.throws(() => readServerProvenance({ provenance: { ...provenance, preparedGeneration: invalid } }, 'flashcards', true), /preparedGeneration/);
  }
  for (const changes of [{ model: 'live-adapter' }, { documentSha256: undefined }]) assert.throws(() => readServerProvenance({ provenance: { ...provenance, ...changes } }, 'flashcards', true), /preparedGeneration/);
  const card = { id: 'one', front: 'What is an algorithm?', back: 'A finite procedure.', sourceExcerpt: 'Algorithms are finite procedures.', confidence: 0.9, provenance };
  for (const preparedGeneration of [undefined, { ...generation, model: 'another-author' }]) {
    assert.throws(() => validateInstitutionFlashcardResult([card, { ...card, id: 'two', provenance: { ...provenance, preparedGeneration } }], { sourceText: card.sourceExcerpt }), /contradictory source provenance/);
  }
});

test('saved attribution distinguishes authoring from replay without guessing a missing model', () => {
  assert.match(generationAttribution(provenance)!, /Generating model: synthetic-author/);
  assert.match(generationAttribution(provenance)!, /no live AI call is made.*Live model outputs may differ.*Replay engine: prepared-demo\/v1/);
  assert.match(generationAttribution({ ...provenance, preparedGeneration: undefined })!, /Generating model: not recorded/);
  assert.match(generationAttribution({ model: 'institution-adapter' })!, /model \/ adapter reported by the service: institution-adapter/);
  assert.equal(generationAttribution({}), 'Generating model: not recorded.');
  assert.equal(generationAttribution(undefined), null);
  for (const invalid of [[], 42, { model: 'x'.repeat(161) }, { ...provenance, documentSha256: undefined }, { ...provenance, preparedGeneration: {} }, { ...provenance, model: 'live' }]) assert.match(generationAttribution(invalid)!, /unavailable/);
  assert.equal(readPreparedGeneration({ ...generation, model: null })?.model, null);
});
