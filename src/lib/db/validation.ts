/**
 * @fileoverview src/lib/db/validation.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import { Card, CardState, Deck, DepthLayer, ReviewLog, ReviewSource } from '../../types';

const MAX_TEXT_LENGTH = 250_000;
const MAX_DEPTH_LAYERS = 1_000;
const MAX_REVIEW_DURATION_MS = 7 * 24 * 60 * 60 * 1_000;

const assertIdentifier = (value: string, label: string, maximumLength = 200) => {
  if (typeof value !== 'string' || !value.trim() || value.length > maximumLength) {
    throw new Error(`${label} must be a non-empty identifier of at most ${maximumLength} characters.`);
  }
};

const assertFiniteRange = (value: number, label: string, minimum: number, maximum = Number.MAX_VALUE) => {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be a finite number from ${minimum} to ${maximum}.`);
  }
};

const assertIntegerRange = (value: number, label: string, minimum: number, maximum: number) => {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
};

const validCardStates = new Set<number>([
  CardState.New,
  CardState.Learning,
  CardState.Review,
  CardState.Relearning,
]);
const validReviewSources = new Set<string>(Object.values(ReviewSource));

export const assertDeckRecord = (deck: Deck) => {
  assertIdentifier(deck.id, 'Deck ID');
  assertIdentifier(deck.user_id, 'Deck owner ID', 512);
  if (deck.parent_id !== undefined) {
    assertIdentifier(deck.parent_id, 'Parent deck ID');
    if (deck.parent_id === deck.id) throw new Error('A deck cannot be its own parent.');
  }
  if (typeof deck.name !== 'string' || !deck.name.trim() || deck.name.length > 200) {
    throw new Error('Deck name must be between 1 and 200 characters.');
  }
  if (typeof deck.description !== 'string' || deck.description.length > 10_000) {
    throw new Error('Deck description must be at most 10,000 characters.');
  }
  if (!deck.settings || typeof deck.settings !== 'object' || Array.isArray(deck.settings)) {
    throw new Error('Deck settings must be a JSON object.');
  }
  let serializedSettings: string;
  try {
    serializedSettings = JSON.stringify(deck.settings);
  } catch {
    throw new Error('Deck settings must be valid JSON.');
  }
  if (!serializedSettings || serializedSettings.length > 100_000) {
    throw new Error('Deck settings must be valid JSON no larger than 100,000 characters.');
  }
  assertIntegerRange(deck.position, 'Deck position', 0, 1_000_000);
  if (typeof deck.completed_once !== 'boolean') throw new Error('Deck completion status must be a boolean.');
  if (deck.first_completed_at !== undefined) assertFiniteRange(deck.first_completed_at, 'First completion time', 1, Number.MAX_SAFE_INTEGER);
  assertFiniteRange(deck.created_at, 'Deck creation time', 1, Number.MAX_SAFE_INTEGER);
  if (deck.deleted_at !== undefined) throw new Error('A deleted deck cannot be inserted or updated as active content.');
};

export const assertDepthLayerRecord = (layer: DepthLayer) => {
  assertIdentifier(layer.id, 'Card page ID');
  assertIdentifier(layer.card_id, 'Card ID');
  assertIntegerRange(layer.layer_number, 'Card page number', 1, MAX_DEPTH_LAYERS);
  if (typeof layer.content !== 'string' || layer.content.length > MAX_TEXT_LENGTH) {
    throw new Error(`Card page content must be a string of at most ${MAX_TEXT_LENGTH.toLocaleString()} characters.`);
  }
  if (typeof layer.source !== 'string' || !layer.source.trim() || layer.source.length > 100) {
    throw new Error('Card page source must be between 1 and 100 characters.');
  }
  if (typeof layer.is_unlocked !== 'boolean') throw new Error('Card page unlock status must be a boolean.');
  if (layer.unlocked_at !== undefined) assertFiniteRange(layer.unlocked_at, 'Card page unlock time', 0);
  if (layer.deleted_at !== undefined) throw new Error('A deleted card page cannot be inserted as active content.');
};

export const assertReviewLogRecord = (log: ReviewLog) => {
  assertIdentifier(log.id, 'Review ID');
  assertIdentifier(log.card_id, 'Card ID');
  assertFiniteRange(log.knob_value, 'Review score', 0, 100);
  assertIntegerRange(log.fsrs_rating, 'FSRS rating', 1, 4);
  assertFiniteRange(log.elapsed_days, 'Elapsed days', 0);
  assertFiniteRange(log.scheduled_days, 'Scheduled days', 0);
  if (!validCardStates.has(log.state_before) || !validCardStates.has(log.state_after)) {
    throw new Error('Review states must be valid card states.');
  }
  assertFiniteRange(log.difficulty_before, 'Previous difficulty', 0);
  assertFiniteRange(log.stability_before, 'Previous stability', 0);
  assertFiniteRange(log.difficulty_after, 'Updated difficulty', 0);
  assertFiniteRange(log.stability_after, 'Updated stability', 0);
  assertFiniteRange(log.duration_ms, 'Review duration', 0, MAX_REVIEW_DURATION_MS);
  assertIntegerRange(log.depth_layer_shown, 'Shown card page', 1, MAX_DEPTH_LAYERS);
  if (!validReviewSources.has(log.review_source)) throw new Error('Review source is invalid.');
  assertFiniteRange(log.reviewed_at, 'Review time', 1, Number.MAX_SAFE_INTEGER);
  if (log.deleted_at !== undefined) throw new Error('A deleted review cannot be inserted as an active review.');
};

export const assertCardRecord = (card: Card) => {
  assertIdentifier(card.id, 'Card ID');
  assertIdentifier(card.note_id, 'Note ID');
  assertIdentifier(card.deck_id, 'Deck ID');
  assertIdentifier(card.template_id, 'Template ID');
  if (card.position !== undefined) assertIntegerRange(card.position, 'Card position', 0, Number.MAX_SAFE_INTEGER);
  assertFiniteRange(card.difficulty, 'Card difficulty', 0);
  assertFiniteRange(card.stability, 'Card stability', 0);
  assertFiniteRange(card.retrievability, 'Card retrievability', 0, 1);
  if (!validCardStates.has(card.state)) throw new Error('Card state is invalid.');
  assertFiniteRange(card.last_knob_value, 'Card review score', 0, 100);
  assertIntegerRange(card.total_layers, 'Total card pages', 1, MAX_DEPTH_LAYERS);
  assertIntegerRange(card.current_max_layer, 'Current card page', 1, card.total_layers);
  assertFiniteRange(card.due, 'Card due time', 1, Number.MAX_SAFE_INTEGER);
  assertIntegerRange(card.reps, 'Card repetitions', 0, Number.MAX_SAFE_INTEGER);
  assertIntegerRange(card.lapses, 'Card lapses', 0, Number.MAX_SAFE_INTEGER);
  assertIntegerRange(card.learning_steps, 'Card learning steps', 0, Number.MAX_SAFE_INTEGER);
  assertFiniteRange(card.last_review, 'Card review time', 0, Number.MAX_SAFE_INTEGER);
  if (card.state !== CardState.New && card.last_review === 0) {
    throw new Error('A learning or review card must have a review timestamp.');
  }
  assertFiniteRange(card.created_at, 'Card creation time', 1, Number.MAX_SAFE_INTEGER);
  if (card.deleted_at !== undefined) throw new Error('A deleted card cannot be committed as a review result.');
};

export const assertReviewedCardRecord = (card: Card) => {
  assertCardRecord(card);
  if (card.last_review === 0) throw new Error('A reviewed card must have a review timestamp.');
};

export const assertNoteFieldValues = (fieldValues: Record<string, string>) => {
  if (!fieldValues || typeof fieldValues !== 'object' || Array.isArray(fieldValues)) {
    throw new Error('Card note fields must be an object.');
  }
  const entries = Object.entries(fieldValues);
  if (entries.length > 100) throw new Error('A card note cannot contain more than 100 fields.');
  for (const [key, value] of entries) {
    if (!key.trim() || key.length > 200) throw new Error('Card note field names must be between 1 and 200 characters.');
    if (typeof value !== 'string' || value.length > MAX_TEXT_LENGTH) {
      throw new Error(`Card note field "${key}" must be a string of at most ${MAX_TEXT_LENGTH.toLocaleString()} characters.`);
    }
  }
};
