/**
 * @fileoverview src/lib/studySession.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import { fsrs, Rating, type State } from 'ts-fsrs';
import { CardStore, DeckStore, DepthLayerStore, ReviewLogStore } from './db/store';
import { createEntityId } from './id';
import { ReviewSource, type Card, type DeckSettings, type DepthLayer, type Note, type ReviewLog } from '../types';

export type StudyMode = 'learn' | 'study' | 'quiz';
export type StudyGroup = 'all' | 'low_retrievability' | 'overdue' | 'due_today';

export const QUIZ_ANSWER_REQUIRED_MESSAGE = 'An answer is required before flipping in Quiz Mode.';

export type StudyRevealResult =
  | { revealed: false; submittedAnswer: ''; error: typeof QUIZ_ANSWER_REQUIRED_MESSAGE }
  | { revealed: true; submittedAnswer: string };

/** Applies the same reveal rule to card taps, keyboard shortcuts, and the bottom bar. */
export function requestStudyReveal(mode: StudyMode, answer?: string): StudyRevealResult {
  const submittedAnswer = answer ?? '';
  if (mode === 'quiz' && submittedAnswer.trim() === '') {
    return { revealed: false, submittedAnswer: '', error: QUIZ_ANSWER_REQUIRED_MESSAGE };
  }
  return { revealed: true, submittedAnswer };
}

export interface StudyCardItem {
  card: Card & { tags?: string[] };
  note: Note;
  layers: DepthLayer[];
}

interface StudyDataAccess {
  getDeck: typeof DeckStore.getById;
  getAllDueCards: typeof CardStore.getAllDueCardsWithNotes;
  getAllCards: typeof CardStore.getAllCardsForDeckWithNotes;
  getStudyQueue: typeof CardStore.getStudyQueueWithNotes;
  getLayers: typeof DepthLayerStore.getByCard;
  recordReview: typeof ReviewLogStore.recordReview;
  updateNote: typeof CardStore.updateNote;
}

const defaultAccess: StudyDataAccess = {
  getDeck: DeckStore.getById.bind(DeckStore),
  getAllDueCards: CardStore.getAllDueCardsWithNotes.bind(CardStore),
  getAllCards: CardStore.getAllCardsForDeckWithNotes.bind(CardStore),
  getStudyQueue: CardStore.getStudyQueueWithNotes.bind(CardStore),
  getLayers: DepthLayerStore.getByCard.bind(DepthLayerStore),
  recordReview: ReviewLogStore.recordReview.bind(ReviewLogStore),
  updateNote: CardStore.updateNote.bind(CardStore),
};

export interface LoadStudySessionInput {
  deckId: string;
  target: string;
  mode: StudyMode;
  startPosition: string;
  group: StudyGroup;
  now?: number;
}

function parseStudyLimit(target: string): number {
  if (target === 'all') return 1_000;
  if (!/^\d+$/.test(target)) throw new Error('The requested session size is invalid.');
  const value = Number(target);
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_000) {
    throw new Error('The requested session size is invalid.');
  }
  return value;
}

export function parseStudyLayerNotes(value: string | undefined): Record<string, { text?: string; voiceUri?: string }> {
  if (!value) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('A card contains corrupt study-note data. Restore a backup or edit the card before studying it.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('A card contains corrupt study-note data. Restore a backup or edit the card before studying it.');
  }
  for (const [key, note] of Object.entries(parsed)) {
    if (!/^-1$|^(?:0|[1-9]\d{0,2})$/.test(key)
      || !note || typeof note !== 'object' || Array.isArray(note)) {
      throw new Error('A card contains corrupt study-note data. Restore a backup or edit the card before studying it.');
    }
    const fields = note as Record<string, unknown>;
    if (Object.keys(fields).some(field => field !== 'text' && field !== 'voiceUri')
      || (fields.text !== undefined && typeof fields.text !== 'string')
      || (fields.voiceUri !== undefined && typeof fields.voiceUri !== 'string')) {
      throw new Error('A card contains corrupt study-note data. Restore a backup or edit the card before studying it.');
    }
  }
  return parsed as Record<string, { text?: string; voiceUri?: string }>;
}

export async function loadStudySession(
  input: LoadStudySessionInput,
  access: StudyDataAccess = defaultAccess,
): Promise<{ deckSettings: DeckSettings; cards: StudyCardItem[] }> {
  const limit = parseStudyLimit(input.target);
  const now = input.now ?? Date.now();
  if (!Number.isFinite(now) || now <= 0) throw new Error('The study-session clock is invalid.');

  const deck = input.deckId === 'all' ? null : await access.getDeck(input.deckId);
  if (input.deckId !== 'all' && !deck) throw new Error('This deck no longer exists.');

  let selected: { card: Card & { tags?: string[] }; note: Note }[];
  if (input.deckId === 'all') {
    const cutoff = now - 24 * 60 * 60 * 1_000;
    const due = await access.getAllDueCards(1_000);
    selected = due.filter(item => {
      const needsWork = item.card.retrievability < 0.5 && item.card.state > 0;
      if (input.group === 'low_retrievability') return needsWork;
      if (input.group === 'overdue') return !needsWork && item.card.due < cutoff;
      if (input.group === 'due_today') return !needsWork && item.card.due >= cutoff;
      return true;
    }).slice(0, limit);
  } else if (input.mode === 'learn' || input.mode === 'quiz') {
    if (input.startPosition === 'unseen') {
      const scan = await access.getAllCards(input.deckId, 10_000);
      const firstUnseen = scan.findIndex(item => item.card.state === 0 || item.card.reps === 0);
      const startIndex = firstUnseen < 0 ? 0 : firstUnseen;
      selected = scan.slice(startIndex, startIndex + limit);
    } else {
      if (!/^\d+$/.test(input.startPosition)) throw new Error('The requested start position is invalid.');
      const startPosition = Number(input.startPosition);
      if (!Number.isSafeInteger(startPosition) || startPosition < 1 || startPosition > 10_000) {
        throw new Error('The requested start position is invalid.');
      }
      selected = await access.getAllCards(input.deckId, limit, startPosition - 1);
    }
  } else {
    selected = await access.getStudyQueue(input.deckId, limit);
  }

  const cards = await Promise.all(selected.map(async ({ card, note }) => ({
    card,
    note,
    layers: await access.getLayers(card.id),
  })));
  cards.forEach(item => parseStudyLayerNotes(item.note.field_values.layerNotes));
  return { deckSettings: deck?.settings ?? {}, cards };
}

export interface CommitStudyRatingInput {
  item: StudyCardItem;
  rating: number;
  durationMs: number;
  now?: number;
  reviewId?: string;
}

export interface StudyRatingResult {
  reviewedItem: StudyCardItem;
  retry: boolean;
  unlockedLayerId?: string;
}

export function applyStudyRatingResult(
  queue: StudyCardItem[],
  currentIndex: number,
  result: StudyRatingResult,
): StudyCardItem[] {
  if (!Number.isInteger(currentIndex) || currentIndex < 0 || currentIndex >= queue.length) {
    throw new Error('The reviewed card is no longer in this study session.');
  }
  if (queue[currentIndex].card.id !== result.reviewedItem.card.id) {
    throw new Error('The study session changed before the review completed.');
  }
  const updated = queue.map((item, index) => index === currentIndex ? result.reviewedItem : item);
  return result.retry ? [...updated, result.reviewedItem] : updated;
}

const utcSecond = (date: Date): number => Date.UTC(
  date.getUTCFullYear(),
  date.getUTCMonth(),
  date.getUTCDate(),
  date.getUTCHours(),
  date.getUTCMinutes(),
  date.getUTCSeconds(),
);

export async function commitStudyRating(
  input: CommitStudyRatingInput,
  access: Pick<StudyDataAccess, 'recordReview'> = defaultAccess,
): Promise<StudyRatingResult> {
  if (!Number.isFinite(input.rating) || input.rating < 0 || input.rating > 100) {
    throw new Error('The review score must be between 0 and 100.');
  }
  const nowMs = input.now ?? Date.now();
  if (!Number.isSafeInteger(nowMs) || nowMs <= input.item.card.last_review) {
    throw new Error('The review time must advance the card revision.');
  }
  const durationMs = Math.max(0, Math.min(60_000, Number.isFinite(input.durationMs) ? input.durationMs : 0));
  const { card, layers } = input.item;
  const scheduler = fsrs({});
  const fsrsCard = {
    due: new Date(card.due),
    stability: card.stability || 0,
    difficulty: card.difficulty || 0,
    elapsed_days: card.last_review ? Math.max(0, (nowMs - card.last_review) / 86_400_000) : 0,
    scheduled_days: card.last_review ? Math.max(0, (card.due - card.last_review) / 86_400_000) : 0,
    learning_steps: card.learning_steps || 0,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state as unknown as State,
    last_review: card.last_review ? new Date(card.last_review) : undefined,
  };
  const now = new Date(nowMs);
  const schedulingCards = scheduler.repeat(fsrsCard, now);

  let lowerRating: Rating;
  let upperRating: Rating;
  let weightUpper: number;
  if (input.rating <= 33.33) {
    lowerRating = Rating.Again;
    upperRating = Rating.Hard;
    weightUpper = input.rating / 33.33;
  } else if (input.rating <= 66.66) {
    lowerRating = Rating.Hard;
    upperRating = Rating.Good;
    weightUpper = (input.rating - 33.33) / 33.33;
  } else {
    lowerRating = Rating.Good;
    upperRating = Rating.Easy;
    weightUpper = (input.rating - 66.66) / 33.34;
  }

  const lower = schedulingCards[lowerRating];
  const upper = schedulingCards[upperRating];
  const weightLower = 1 - weightUpper;
  const lowerInterval = (utcSecond(lower.card.due) - utcSecond(now)) / 86_400_000;
  const upperInterval = (utcSecond(upper.card.due) - utcSecond(now)) / 86_400_000;
  const scheduledDays = lowerInterval * weightLower + upperInterval * weightUpper;
  const stability = lower.card.stability * weightLower + upper.card.stability * weightUpper;
  const difficulty = lower.card.difficulty * weightLower + upper.card.difficulty * weightUpper;
  const nearest = weightUpper > 0.5 ? upper : lower;
  const finalState = nearest.card.state;

  const updatedCard: Card = {
    ...card,
    due: nowMs + scheduledDays * 86_400_000,
    stability,
    difficulty,
    state: finalState as unknown as Card['state'],
    reps: nearest.card.reps,
    lapses: nearest.card.lapses,
    learning_steps: nearest.card.learning_steps,
    last_review: nowMs,
    last_knob_value: input.rating,
    retrievability: 1,
  };
  const nextLayer = input.rating === 100 && updatedCard.current_max_layer < updatedCard.total_layers
    ? layers.find(layer => layer.layer_number === updatedCard.current_max_layer + 1)
    : undefined;
  if (input.rating === 100 && updatedCard.current_max_layer < updatedCard.total_layers && !nextLayer) {
    throw new Error('The next card page no longer exists.');
  }
  const finalCard: Card = nextLayer
    ? { ...updatedCard, current_max_layer: updatedCard.current_max_layer + 1 }
    : updatedCard;

  let nearestRating = Rating.Good;
  if (input.rating < 16.66) nearestRating = Rating.Again;
  else if (input.rating < 50) nearestRating = Rating.Hard;
  else if (input.rating >= 83.33) nearestRating = Rating.Easy;
  const reviewLog: ReviewLog = {
    id: input.reviewId ?? createEntityId('log'),
    card_id: finalCard.id,
    knob_value: input.rating,
    fsrs_rating: nearestRating,
    elapsed_days: nearest.log.elapsed_days,
    scheduled_days: scheduledDays,
    state_before: card.state,
    state_after: finalCard.state,
    difficulty_before: fsrsCard.difficulty,
    stability_before: fsrsCard.stability,
    difficulty_after: difficulty,
    stability_after: stability,
    duration_ms: durationMs,
    depth_layer_shown: card.current_max_layer,
    review_source: ReviewSource.Session,
    reviewed_at: nowMs,
  };
  await access.recordReview(card.last_review, finalCard, reviewLog, nextLayer?.id);
  return {
    reviewedItem: {
      ...input.item,
      card: finalCard,
      layers: input.item.layers.map(layer => layer.id === nextLayer?.id
        ? { ...layer, is_unlocked: true, unlocked_at: nowMs }
        : layer),
    },
    retry: input.rating < 50,
    unlockedLayerId: nextLayer?.id,
  };
}

export async function updateStudyLayerNote(
  note: Note,
  text: string,
  voiceUri: string | undefined,
  targetLayer: number | undefined,
  access: Pick<StudyDataAccess, 'updateNote'> = defaultAccess,
): Promise<Note> {
  if (typeof text !== 'string') throw new Error('Study-note text must be a string.');
  const layer = targetLayer ?? -1;
  if (!Number.isInteger(layer) || layer < -1 || layer > 999) throw new Error('The study-note page is invalid.');
  if (voiceUri !== undefined && typeof voiceUri !== 'string') throw new Error('The voice-note reference is invalid.');
  const layerNotes = parseStudyLayerNotes(note.field_values.layerNotes);
  const updatedLayerNotes = {
    ...layerNotes,
    [String(layer)]: { text, ...(voiceUri ? { voiceUri } : {}) },
  };
  const fieldValues = { ...note.field_values, layerNotes: JSON.stringify(updatedLayerNotes) };
  await access.updateNote(note.id, fieldValues);
  return { ...note, field_values: fieldValues, updated_at: Date.now() };
}

export function gradeQuizAnswer(rating: number): boolean {
  if (!Number.isFinite(rating) || rating < 0 || rating > 100) throw new Error('The quiz score is invalid.');
  return rating > 50;
}
