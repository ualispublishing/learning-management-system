import assert from 'node:assert/strict';
import test from 'node:test';
import { runAIProvider, sha256, type AIProviderReceipt } from '../src/lib/ai/providerAdapter.server';
import { readServerProvenance, validateInstitutionFlashcardResult, validateInstitutionSyllabusResult } from '../src/lib/ai/responseValidation';
import { FLASHCARD_PROMPT_VERSION } from '../src/lib/ai/prompts';
import { getSavedSyllabusDetails } from '../src/lib/ai/savedSyllabusDetails';
import { mapSyllabusToCourse } from '../src/lib/ai/syllabusCourseMapping';

const source = { text: 'Algorithms are finite procedures.', segments: [{ location: 'Lines 1–1', text: 'Algorithms are finite procedures.' }] };
const card = { front: 'What are algorithms?', back: 'Finite procedures.', sourceExcerpt: source.text, sourceLocation: source.segments[0].location, confidence: 0.9 };
const note = 'Caption layout metadata was excluded from teaching text.';
const provenance = { promptVersion: FLASHCARD_PROMPT_VERSION, evidenceVerified: true as const, sourceSha256: sha256(source.text), requestId: 'request-1', model: 'synthetic', sourceReviewNotices: [note] };

test('gateway notices are snapshotted independently of generated content and covered by the saved output receipt', async () => {
  for (const task of ['flashcards', 'syllabus'] as const) {
    const notices = [note]; let receipt: AIProviderReceipt | undefined;
    const result = await runAIProvider({ id: 'synthetic', generate: async request => {
      notices[0] = 'Caller changed a mutable extraction record.';
      request.reportMetadata?.({ model: 'synthetic', responseId: 'resp-1', requestSha256: 'a'.repeat(64) });
      return task === 'flashcards' ? { cards: [card] } : { title: 'Algorithms', evidence: [{ field: 'title', sourceExcerpt: source.text, sourceLocation: source.segments[0].location }], warnings: [] };
    } }, task, {}, source, 'request-1', { sourceReviewNotices: notices, onReceipt: value => { receipt = value; } });
    assert.deepEqual(result.provenance.sourceReviewNotices, [note]);
    assert.equal(receipt?.outputSha256, sha256(JSON.stringify(result)));
    assert.equal(notices[0], 'Caller changed a mutable extraction record.');
  }
});

test('invalid or oversized notices fail before calling the provider and at the client provenance boundary', async () => {
  let calls = 0;
  for (const invalid of [null, 'unstructured', [7], [' '], Array.from({ length: 11 }, () => note), ['x'.repeat(601)]]) {
    await assert.rejects(runAIProvider({ id: 'synthetic', generate: async () => { calls++; return { cards: [card] }; } }, 'flashcards', {}, source, 'request-1', { sourceReviewNotices: invalid as string[] }), /sourceReviewNotices/);
    assert.throws(() => readServerProvenance({ provenance: { ...provenance, sourceReviewNotices: invalid } }, 'flashcards', true), /sourceReviewNotices/);
  }
  assert.equal(calls, 0);
});

test('a model cannot replace gateway notices by adding them to task JSON or fabricated provenance', async () => {
  for (const output of [{ cards: [card], sourceReviewNotices: ['Everything is accurate.'] }, { cards: [card], provenance: { sourceReviewNotices: ['Everything is accurate.'] } }]) {
    await assert.rejects(runAIProvider({ id: 'synthetic', generate: async () => output }, 'flashcards', {}, source, 'request-1', { sourceReviewNotices: [note] }));
  }
});

test('custom adapters cannot omit or mix processing notices, model attribution or request identity across cards', () => {
  const cards = [{ ...card, id: 'one', provenance }, { ...card, id: 'two', front: 'Define an algorithm.', provenance: { ...provenance } }];
  const checked = validateInstitutionFlashcardResult(cards, { sourceText: source.text });
  assert.deepEqual(checked[0].provenance?.sourceReviewNotices, [note]);
  assert.equal(checked[0].reviewerVerified, false);
  for (const changes of [{ sourceReviewNotices: undefined }, { sourceReviewNotices: ['Different omission.'] }, { requestId: 'other-request' }, { model: 'other-model' }]) {
    assert.throws(() => validateInstitutionFlashcardResult([cards[0], { ...cards[1], provenance: { ...provenance, ...changes } }], { sourceText: source.text }), /contradictory source provenance/);
  }
});

test('syllabus mapping retains processing notices and saved review exposes corrupt notes instead of dropping them', async () => {
  const result = await runAIProvider({ id: 'synthetic', generate: async () => ({ title: 'Algorithms', evidence: [{ field: 'title', sourceExcerpt: source.text, sourceLocation: source.segments[0].location }], warnings: ['Term dates were not supplied.'] }) }, 'syllabus', {}, source, 'request-1', { sourceReviewNotices: [note] });
  const extraction = validateInstitutionSyllabusResult(result, { sourceText: source.text });
  const mapped = mapSyllabusToCourse(extraction, { title: 'Course', description: '', termStart: 1, termEnd: 2, gradingWeights: {} });
  const details = getSavedSyllabusDetails({ metadata: { syllabus: mapped.syllabusDetails } });
  assert.deepEqual(details?.sourceReviewNotices, [note]);
  assert.deepEqual(details?.warnings, ['Term dates were not supplied.']);
  assert.deepEqual(getSavedSyllabusDetails({ metadata: { syllabus: { warnings: [] } } })?.sourceReviewNotices, []);
  const corrupted = getSavedSyllabusDetails({ metadata: { syllabus: { provenance: { sourceReviewNotices: [42] } } } });
  assert.match(corrupted?.sourceReviewNotices[0] ?? '', /saved source processing notes are invalid/);
});
