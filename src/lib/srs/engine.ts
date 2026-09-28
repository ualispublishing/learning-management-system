/**
 * @fileoverview src/lib/srs/engine.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import { fsrs, createEmptyCard, Card as FSRSCard, State } from 'ts-fsrs';
import { Card, CardState } from '../../types';
import { knobToRating, getModulatedRetention } from './knob-mapper';

// Default FSRS parameters
const defaultParams = {
  request_retention: 0.9,
  maximum_interval: 36500,
  enable_fuzz: true,
  enable_short_term: true,
  learning_steps: ['1m' as const, '10m' as const] as any,
  relearning_steps: ['10m' as const] as any,
};

export const defaultScheduler = fsrs(defaultParams);

export function toFSRSCard(card: Card): FSRSCard {
  return {
    due: new Date(card.due),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.last_review ? (Date.now() - card.last_review) / 86400000 : 0, 
    scheduled_days: card.last_review ? (card.due - card.last_review) / 86400000 : 0,
    reps: card.reps,
    lapses: card.lapses,
    learning_steps: card.learning_steps,
    state: card.state as number as State,
    last_review: card.last_review ? new Date(card.last_review) : undefined,
  } as any;
}

export function fromFSRSCard(fsrsCard: FSRSCard, originalCard: Card): Card {
  return {
    ...originalCard,
    due: fsrsCard.due.getTime(),
    stability: fsrsCard.stability,
    difficulty: fsrsCard.difficulty,
    state: fsrsCard.state as number as CardState,
    reps: fsrsCard.reps,
    lapses: fsrsCard.lapses,
    learning_steps: fsrsCard.learning_steps,
    last_review: fsrsCard.last_review ? fsrsCard.last_review.getTime() : Date.now(),
  };
}

export function initNewCard(cardData: Partial<Card>): Card {
  const fsrsEmpty = createEmptyCard();
  return {
    id: cardData.id || '',
    note_id: cardData.note_id || '',
    deck_id: cardData.deck_id || '',
    template_id: cardData.template_id || '',
    difficulty: fsrsEmpty.difficulty,
    stability: fsrsEmpty.stability,
    retrievability: 0, 
    state: fsrsEmpty.state as number as CardState,
    last_knob_value: 0,
    current_max_layer: 1,
    total_layers: cardData.total_layers || 1,
    due: fsrsEmpty.due.getTime(),
    reps: fsrsEmpty.reps,
    lapses: fsrsEmpty.lapses,
    learning_steps: fsrsEmpty.learning_steps,
    last_review: 0,
    created_at: Date.now(),
    ...cardData,
  };
}

export function reviewCard(card: Card, knobValue: number, now: number = Date.now()) {
  const { rating, triggersDepthUnlock } = knobToRating(knobValue);
  
  const modulatedRetention = getModulatedRetention(knobValue, 0.9);
  const scheduler = fsrs({ ...defaultParams, request_retention: modulatedRetention });

  const fsrsCard = toFSRSCard(card);
  const result = scheduler.next(fsrsCard, new Date(now), rating as any);

  const updatedCard = fromFSRSCard(result.card, card);
  updatedCard.last_knob_value = knobValue;
  
  const retrievability = scheduler.get_retrievability(result.card, new Date(now));
  const parsedRetrievability = typeof retrievability === 'string'
    ? Number.parseFloat(retrievability.replace('%', '')) / 100
    : Number(retrievability);
  updatedCard.retrievability = Number.isFinite(parsedRetrievability)
    ? Math.max(0, Math.min(1, parsedRetrievability))
    : 1;

  if (triggersDepthUnlock && updatedCard.current_max_layer < updatedCard.total_layers) {
    updatedCard.current_max_layer += 1;
  }

  const reviewLog = {
    ...result.log,
    knob_value: knobValue,
    fsrs_rating: rating,
    state_before: card.state,
    state_after: updatedCard.state,
  };

  return { updatedCard, reviewLog };
}

export function previewCard(card: Card, now: number = Date.now()) {
  const fsrsCard = toFSRSCard(card);
  return defaultScheduler.repeat(fsrsCard, new Date(now));
}
