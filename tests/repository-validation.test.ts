import assert from 'node:assert/strict';
import test from 'node:test';

import { CardState, ReviewSource } from '../src/types';
import { assertCardRecord, assertDeckRecord, assertDepthLayerRecord, assertNoteFieldValues, assertReviewedCardRecord, assertReviewLogRecord } from '../src/lib/db/validation';

const validLog = {
  id: 'log_1',
  card_id: 'card_1',
  knob_value: 75,
  fsrs_rating: 3,
  elapsed_days: 1,
  scheduled_days: 4.5,
  state_before: CardState.Learning,
  state_after: CardState.Review,
  difficulty_before: 5,
  stability_before: 2,
  difficulty_after: 4.8,
  stability_after: 6,
  duration_ms: 5_000,
  depth_layer_shown: 1,
  review_source: ReviewSource.Session,
  reviewed_at: 1_700_000_000_000,
};

test('repository validation accepts finite review and card records', () => {
  assert.doesNotThrow(() => assertReviewLogRecord(validLog));
  assert.doesNotThrow(() => assertReviewedCardRecord({
    id: 'card_1',
    note_id: 'note_1',
    deck_id: 'deck_1',
    template_id: 'template_1',
    difficulty: 4.8,
    stability: 6,
    retrievability: 1,
    state: CardState.Review,
    last_knob_value: 75,
    current_max_layer: 1,
    total_layers: 2,
    due: 1_700_086_400_000,
    reps: 2,
    lapses: 0,
    learning_steps: 0,
    last_review: 1_700_000_000_000,
    created_at: 1_699_000_000_000,
  }));
});

test('repository validation rejects corrupt review values before persistence', () => {
  assert.throws(() => assertReviewLogRecord({ ...validLog, knob_value: Number.NaN }), /Review score/);
  assert.throws(() => assertReviewLogRecord({ ...validLog, fsrs_rating: 5 }), /FSRS rating/);
  assert.throws(() => assertReviewLogRecord({ ...validLog, state_after: 99 as CardState }), /valid card states/);
  assert.throws(() => assertReviewLogRecord({ ...validLog, duration_ms: -1 }), /Review duration/);
  assert.throws(() => assertReviewLogRecord({ ...validLog, review_source: 'unknown' as ReviewSource }), /source is invalid/);
});

test('repository validation rejects malformed card pages', () => {
  const validLayer = {
    id: 'layer_1',
    card_id: 'card_1',
    layer_number: 1,
    content: 'Answer',
    source: 'user',
    is_unlocked: true,
  };
  assert.doesNotThrow(() => assertDepthLayerRecord(validLayer));
  assert.throws(() => assertDepthLayerRecord({ ...validLayer, layer_number: 0 }), /page number/);
  assert.throws(() => assertDepthLayerRecord({ ...validLayer, source: '' }), /page source/);
  assert.throws(() => assertDepthLayerRecord({ ...validLayer, content: 'x'.repeat(250_001) }), /page content/);
});

test('repository validation rejects invalid deck boundaries', () => {
  const validDeck = {
    id: 'deck_1',
    user_id: 'user_1',
    name: 'Biology',
    description: 'Course review',
    settings: {},
    position: 0,
    completed_once: false,
    created_at: 1_700_000_000_000,
  };
  assert.doesNotThrow(() => assertDeckRecord(validDeck));
  assert.throws(() => assertDeckRecord({ ...validDeck, parent_id: 'deck_1' }), /own parent/);
  assert.throws(() => assertDeckRecord({ ...validDeck, name: ' ' }), /Deck name/);
  assert.throws(() => assertDeckRecord({ ...validDeck, position: -1 }), /Deck position/);
});

test('repository validation permits new cards but requires review timestamps after learning starts', () => {
  const newCard = {
    id: 'card_1',
    note_id: 'note_1',
    deck_id: 'deck_1',
    template_id: 'template_1',
    difficulty: 0,
    stability: 0,
    retrievability: 1,
    state: CardState.New,
    last_knob_value: 0,
    current_max_layer: 1,
    total_layers: 1,
    due: 1_700_000_000_000,
    reps: 0,
    lapses: 0,
    learning_steps: 0,
    last_review: 0,
    created_at: 1_700_000_000_000,
  };
  assert.doesNotThrow(() => assertCardRecord(newCard));
  assert.throws(() => assertCardRecord({ ...newCard, position: -1 }), /Card position/);
  assert.throws(() => assertCardRecord({ ...newCard, state: CardState.Learning }), /review timestamp/);
  assert.throws(() => assertCardRecord({ ...newCard, current_max_layer: 2 }), /Current card page/);
});

test('repository validation bounds card note fields', () => {
  assert.doesNotThrow(() => assertNoteFieldValues({ front: 'Question', back: 'Answer' }));
  assert.throws(() => assertNoteFieldValues({ '': 'value' }), /field names/);
  assert.throws(() => assertNoteFieldValues({ front: 'x'.repeat(250_001) }), /field "front"/);
});
