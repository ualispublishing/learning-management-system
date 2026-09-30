/**
 * @fileoverview src/lib/db/store.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Deck, Card, CardState, Note, ReviewLog, DepthLayer } from '../../types';
import { fsrs } from 'ts-fsrs';

import { initDB } from './schema';
import { createEntityId } from '../id';
import { assertCardRecord, assertDeckRecord, assertDepthLayerRecord, assertNoteFieldValues, assertReviewedCardRecord, assertReviewLogRecord } from './validation';
import { captureFlashcardPrincipal, isFlashcardPrincipalCurrent } from './principal';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export async function getDB() {
  if (Platform.OS === 'web') return null;
  if (!dbPromise) {
    dbPromise = initDB();
  }
  return dbPromise;
}

// In-memory mock for Web Demo
const webData = {
  decks: [] as Deck[],
  cards: [] as Card[],
  notes: [] as Note[],
  depth_layers: [] as DepthLayer[],
  review_logs: [] as ReviewLog[]
};

const WEB_DATA_KEY = 'flashcards:web-data:v1';
const MAX_WEB_DATA_BYTES = 4 * 1024 * 1024;
let webDataWriteQueue: Promise<void> = Promise.resolve();
let webDataMutationQueue: Promise<void> = Promise.resolve();
let lastDurableWebSnapshot = JSON.stringify({ version: 1, data: webData });

const isRecord = (value: unknown): value is Record<string, unknown> => (
  !!value && typeof value === 'object' && !Array.isArray(value)
);

const cloneDeck = (deck: Deck): Deck => ({
  ...deck,
  settings: JSON.parse(JSON.stringify(deck.settings)) as Deck['settings'],
});
const cloneCard = (card: Card & { tags?: string[] }): Card & { tags?: string[] } => ({
  ...card,
  tags: card.tags ? [...card.tags] : undefined,
});
const cloneNote = (note: Note): Note => ({ ...note, field_values: { ...note.field_values } });
const cloneLayer = (layer: DepthLayer): DepthLayer => ({ ...layer });

const assertPageArguments = (limit: number, offset = 0) => {
  if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) {
    throw new Error('Query limits must be integers from 1 to 10,000.');
  }
  if (!Number.isInteger(offset) || offset < 0) throw new Error('Query offsets must be non-negative integers.');
};

const ensureUniqueIds = (records: unknown[], label: string) => {
  const ids = new Set<string>();
  records.forEach((record, index) => {
    if (!isRecord(record) || typeof record.id !== 'string' || !record.id) {
      throw new Error(`Stored web ${label} record ${index + 1} is invalid.`);
    }
    if (ids.has(record.id)) throw new Error(`Stored web ${label} contains duplicate id "${record.id}".`);
    ids.add(record.id);
  });
  return ids;
};

const hydrateWebData = (serialized: string) => {
  if (serialized.length > MAX_WEB_DATA_BYTES) throw new Error('Stored web flashcard data exceeds the local safety limit.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error('Stored web flashcard data is corrupt and could not be read.');
  }
  if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.data)) {
    throw new Error('Stored web flashcard data has an unsupported format.');
  }
  const data = parsed.data;
  const arrays = ['decks', 'cards', 'notes', 'depth_layers', 'review_logs'] as const;
  arrays.forEach(name => {
    if (!Array.isArray(data[name])) throw new Error(`Stored web flashcard data is missing ${name}.`);
  });
  const deckIds = ensureUniqueIds(data.decks as unknown[], 'decks');
  const cardIds = ensureUniqueIds(data.cards as unknown[], 'cards');
  const noteIds = ensureUniqueIds(data.notes as unknown[], 'notes');
  ensureUniqueIds(data.depth_layers as unknown[], 'card pages');
  ensureUniqueIds(data.review_logs as unknown[], 'review logs');
  (data.notes as unknown[]).forEach(note => {
    if (!isRecord(note) || !isRecord(note.field_values)
      || typeof note.note_type_id !== 'string' || !note.note_type_id.trim()
      || !Number.isFinite(note.created_at) || Number(note.created_at) < 1
      || !Number.isFinite(note.updated_at) || Number(note.updated_at) < Number(note.created_at)) {
      throw new Error('Stored web note data is invalid.');
    }
    assertNoteFieldValues(note.field_values as Record<string, string>);
  });
  (data.cards as unknown[]).forEach(card => {
    if (!isRecord(card) || typeof card.deck_id !== 'string' || typeof card.note_id !== 'string'
      || !deckIds.has(card.deck_id) || !noteIds.has(card.note_id)) {
      throw new Error('Stored web card references are corrupt.');
    }
    assertCardRecord(card as unknown as Card);
  });
  const deckOwners = new Map((data.decks as Deck[]).map(deck => [deck.id, deck.user_id]));
  const noteOwners = new Map<string, string>();
  (data.cards as Card[]).forEach(card => {
    const owner = deckOwners.get(card.deck_id)!;
    const priorOwner = noteOwners.get(card.note_id);
    if (priorOwner && priorOwner !== owner) {
      throw new Error(`Stored web note "${card.note_id}" is shared across different flashcard accounts.`);
    }
    noteOwners.set(card.note_id, owner);
  });
  const layersByCard = new Map<string, DepthLayer[]>();
  (data.depth_layers as unknown[]).forEach(layer => {
    if (!isRecord(layer) || typeof layer.card_id !== 'string' || !cardIds.has(layer.card_id)) {
      throw new Error('Stored web card-page references are corrupt.');
    }
    assertDepthLayerRecord(layer as unknown as DepthLayer);
    const typedLayer = layer as unknown as DepthLayer;
    const cardLayers = layersByCard.get(typedLayer.card_id) ?? [];
    cardLayers.push(typedLayer);
    layersByCard.set(typedLayer.card_id, cardLayers);
  });
  (data.review_logs as unknown[]).forEach(log => {
    if (!isRecord(log) || typeof log.card_id !== 'string' || !cardIds.has(log.card_id)) {
      throw new Error('Stored web review-log references are corrupt.');
    }
    assertReviewLogRecord(log as unknown as ReviewLog);
  });
  (data.decks as unknown[]).forEach(deck => assertDeckRecord(deck as unknown as Deck));
  const deckById = new Map((data.decks as Deck[]).map(deck => [deck.id, deck]));
  for (const deck of data.decks as Deck[]) {
    if (!deck.parent_id) continue;
    const parent = deckById.get(deck.parent_id);
    if (!parent) throw new Error(`Stored web deck "${deck.id}" has a missing parent.`);
    if (parent.user_id !== deck.user_id) throw new Error(`Stored web deck "${deck.id}" has a parent owned by another account.`);
  }
  const deckVisitState = new Map<string, 'visiting' | 'visited'>();
  const visitDeck = (deck: Deck) => {
    const state = deckVisitState.get(deck.id);
    if (state === 'visiting') throw new Error('Stored web deck hierarchy contains a cycle.');
    if (state === 'visited') return;
    deckVisitState.set(deck.id, 'visiting');
    if (deck.parent_id) visitDeck(deckById.get(deck.parent_id)!);
    deckVisitState.set(deck.id, 'visited');
  };
  (data.decks as Deck[]).forEach(visitDeck);

  const cardById = new Map((data.cards as Card[]).map(card => [card.id, card]));
  for (const [cardId, card] of cardById) {
    const layers = (layersByCard.get(cardId) ?? []).sort((left, right) => left.layer_number - right.layer_number);
    if (layers.length !== card.total_layers || layers.some((layer, index) => layer.layer_number !== index + 1)) {
      throw new Error(`Stored web card "${cardId}" has an inconsistent page sequence.`);
    }
  }
  webData.decks = data.decks as Deck[];
  webData.cards = data.cards as Card[];
  webData.notes = data.notes as Note[];
  webData.depth_layers = data.depth_layers as DepthLayer[];
  webData.review_logs = data.review_logs as ReviewLog[];
};

// All runtimes for this origin use the same lock. A module-local queue alone
// cannot protect the shared blob from another browser tab.
const withWebStorageLock = async <T>(operation: () => Promise<T>, writing = false): Promise<T> => {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (locks) return locks.request(`${WEB_DATA_KEY}:transaction`, operation);
  if (writing) throw new Error('Safe browser storage requires Web Locks. Open this app over HTTPS in a supported browser. You can still export existing decks.');
  return operation();
};

const reloadWebData = async () => {
  const serialized = await AsyncStorage.getItem(WEB_DATA_KEY);
  const snapshot = serialized ?? JSON.stringify({ version: 1, data: {
    decks: [], cards: [], notes: [], depth_layers: [], review_logs: [],
  } });
  hydrateWebData(snapshot);
  lastDurableWebSnapshot = snapshot;
};

const ensureWebDataLoaded = async () => {
  const operation = webDataMutationQueue.then(() => withWebStorageLock(reloadWebData));
  webDataMutationQueue = operation.then(() => undefined, () => undefined);
  await operation;
};

const persistWebData = async () => {
  const serialized = JSON.stringify({ version: 1, data: webData });
  if (serialized.length > MAX_WEB_DATA_BYTES) {
    hydrateWebData(lastDurableWebSnapshot);
    throw new Error('Web flashcard data exceeds the 4 MB browser-storage safety limit. Export or remove decks before adding more cards.');
  }
  webDataWriteQueue = webDataWriteQueue.catch(() => {}).then(() => AsyncStorage.setItem(WEB_DATA_KEY, serialized));
  try {
    await webDataWriteQueue;
    lastDurableWebSnapshot = serialized;
  } catch (error) {
    hydrateWebData(lastDurableWebSnapshot);
    throw new Error(`Web flashcard changes could not be saved: ${error instanceof Error ? error.message : 'browser storage is unavailable.'}`);
  }
};

const parseStoredObject = (value: unknown, label: string): Record<string, any> => {
  try {
    const parsed = JSON.parse(typeof value === 'string' && value.trim() ? value : '{}') as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, any>;
  } catch {
    throw new Error(`Stored ${label} data is corrupt and could not be read. Restore a backup or contact support before editing this record.`);
  }
};

const decodeDeckRow = (row: Record<string, any>): Deck => {
  const deck: Deck = {
    id: row.id,
    user_id: row.user_id,
    parent_id: row.parent_id ?? undefined,
    name: row.name,
    description: row.description,
    settings: parseStoredObject(row.settings, `deck settings for "${row.id}"`),
    position: row.position,
    completed_once: row.completed_once === 1 || row.completed_once === true,
    first_completed_at: row.first_completed_at ?? undefined,
    created_at: row.created_at,
  };
  assertDeckRecord(deck);
  return deck;
};

const decodeCardRow = (row: Record<string, any>): Card & { tags?: string[] } => {
  const position = row.position == null ? undefined : Number(row.position);
  if (position !== undefined && (!Number.isInteger(position) || position < 0)) {
    throw new Error(`Stored card "${String(row.id)}" has an invalid position.`);
  }
  const card: Card & { tags?: string[] } = {
    id: row.id,
    note_id: row.note_id,
    deck_id: row.deck_id,
    template_id: row.template_id,
    position,
    difficulty: row.difficulty,
    stability: row.stability,
    retrievability: row.retrievability,
    state: row.state,
    last_knob_value: row.last_knob_value,
    current_max_layer: row.current_max_layer,
    total_layers: row.total_layers,
    due: row.due,
    reps: row.reps,
    lapses: row.lapses,
    learning_steps: row.learning_steps,
    last_review: row.last_review,
    created_at: row.created_at,
  };
  assertCardRecord(card);
  if (typeof row.tag_names_json === 'string') {
    let tags: unknown;
    try {
      tags = JSON.parse(row.tag_names_json);
    } catch {
      throw new Error(`Stored tags for card "${card.id}" are corrupt.`);
    }
    if (!Array.isArray(tags) || tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 100)
      || tags.length > 100 || new Set(tags).size !== tags.length) {
      throw new Error(`Stored tags for card "${card.id}" are invalid.`);
    }
    card.tags = tags;
  }
  return card;
};

const decodeJoinedNoteRow = (row: Record<string, any>): Note => {
  const fieldValues = parseStoredObject(row.field_values, `note fields for "${row.note_id}"`);
  assertNoteFieldValues(fieldValues);
  const createdAt = row.note_created_at;
  const updatedAt = row.note_updated_at;
  if (!Number.isFinite(createdAt) || createdAt < 1 || !Number.isFinite(updatedAt) || updatedAt < createdAt) {
    throw new Error(`Stored note "${String(row.note_id)}" has invalid timestamps.`);
  }
  if (typeof row.note_type_id !== 'string' || !row.note_type_id.trim()) {
    throw new Error(`Stored note "${String(row.note_id)}" has an invalid note type.`);
  }
  return {
    id: row.note_id,
    note_type_id: row.note_type_id,
    field_values: fieldValues,
    created_at: createdAt,
    updated_at: updatedAt,
  };
};

const decodeLayerRow = (row: Record<string, any>): DepthLayer => {
  const layer: DepthLayer = {
    id: row.id,
    card_id: row.card_id,
    layer_number: row.layer_number,
    content: row.content,
    source: row.source,
    is_unlocked: row.is_unlocked === 1 || row.is_unlocked === true,
    unlocked_at: row.unlocked_at ?? undefined,
  };
  assertDepthLayerRecord(layer);
  return layer;
};

const decodeReviewLogRow = (row: Record<string, any>): ReviewLog => {
  const log: ReviewLog = {
    id: row.id,
    card_id: row.card_id,
    knob_value: row.knob_value,
    fsrs_rating: row.fsrs_rating,
    elapsed_days: row.elapsed_days,
    scheduled_days: row.scheduled_days,
    state_before: row.state_before,
    state_after: row.state_after,
    difficulty_before: row.difficulty_before,
    stability_before: row.stability_before,
    difficulty_after: row.difficulty_after,
    stability_after: row.stability_after,
    duration_ms: row.duration_ms,
    depth_layer_shown: row.depth_layer_shown,
    review_source: row.review_source,
    reviewed_at: row.reviewed_at,
  };
  assertReviewLogRecord(log);
  return log;
};

const withCurrentRetrievability = (card: Card, now = new Date()): Card => {
  if (card.state === CardState.New || !card.last_review || card.stability <= 0) return { ...card, retrievability: card.state === CardState.New ? 1 : 0 };
  try {
    const scheduler = fsrs({});
    const percentage = scheduler.get_retrievability({
      ...card,
      due: new Date(card.due),
      last_review: new Date(card.last_review),
      learning_steps: card.learning_steps,
    } as any, now);
    const parsed = typeof percentage === 'string' ? Number.parseFloat(percentage.replace('%', '')) / 100 : Number(percentage);
    return { ...card, retrievability: Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : card.retrievability };
  } catch (error) {
    throw new Error(`Card "${card.id}" retrievability could not be calculated: ${error instanceof Error ? error.message : 'invalid scheduling data'}.`);
  }
};

const webDeckBelongsTo = (deckId: string, principalId: string) => (
  webData.decks.some(deck => deck.id === deckId && deck.user_id === principalId && !deck.deleted_at)
);

const webCardBelongsTo = (cardId: string, principalId: string) => {
  const card = webData.cards.find(candidate => candidate.id === cardId && !candidate.deleted_at);
  return Boolean(card && webDeckBelongsTo(card.deck_id, principalId));
};

const webNoteBelongsTo = (noteId: string, principalId: string) => (
  webData.cards.some(card => card.note_id === noteId && !card.deleted_at && webDeckBelongsTo(card.deck_id, principalId))
);

const webLayerBelongsTo = (layerId: string, principalId: string) => {
  const layer = webData.depth_layers.find(candidate => candidate.id === layerId && !candidate.deleted_at);
  return Boolean(layer && webCardBelongsTo(layer.card_id, principalId));
};

const requireCurrentFlashcardPrincipal = (principal: ReturnType<typeof captureFlashcardPrincipal>) => {
  if (!isFlashcardPrincipalCurrent(principal)) {
    throw new Error('The active flashcard account changed while this operation was running. Please retry.');
  }
};

const assertReviewTransition = (
  existingCard: Card,
  updatedCard: Card,
  log: ReviewLog,
  unlockLayer?: DepthLayer,
) => {
  if (updatedCard.last_review <= existingCard.last_review) {
    throw new Error('A review must advance the card review timestamp. Reload before grading it again.');
  }
  if (updatedCard.note_id !== existingCard.note_id
    || updatedCard.deck_id !== existingCard.deck_id
    || updatedCard.template_id !== existingCard.template_id
    || updatedCard.total_layers !== existingCard.total_layers
    || updatedCard.created_at !== existingCard.created_at) {
    throw new Error('The reviewed card identity changed unexpectedly. Reload before grading it again.');
  }
  if (updatedCard.reps !== existingCard.reps + 1
    || updatedCard.lapses < existingCard.lapses
    || updatedCard.lapses > existingCard.lapses + 1) {
    throw new Error('The reviewed card counters do not describe one review. Reload before grading it again.');
  }
  if (log.state_before !== existingCard.state
    || log.state_after !== updatedCard.state
    || log.difficulty_before !== existingCard.difficulty
    || log.stability_before !== existingCard.stability
    || log.difficulty_after !== updatedCard.difficulty
    || log.stability_after !== updatedCard.stability
    || log.knob_value !== updatedCard.last_knob_value
    || log.depth_layer_shown !== existingCard.current_max_layer) {
    throw new Error('The review log does not match the card transition. Reload before grading it again.');
  }
  if (unlockLayer) {
    if (unlockLayer.card_id !== existingCard.id
      || unlockLayer.layer_number !== existingCard.current_max_layer + 1
      || unlockLayer.is_unlocked
      || updatedCard.current_max_layer !== unlockLayer.layer_number) {
      throw new Error('The review does not unlock the next available card page. Reload before grading it again.');
    }
  } else if (updatedCard.current_max_layer !== existingCard.current_max_layer) {
    throw new Error('The reviewed card page changed without a matching unlock. Reload before grading it again.');
  }
};

const assertReviewLogMatchesCurrentCard = (card: Card, log: ReviewLog) => {
  if (log.card_id !== card.id
    || log.reviewed_at !== card.last_review
    || log.state_after !== card.state
    || log.difficulty_after !== card.difficulty
    || log.stability_after !== card.stability
    || log.knob_value !== card.last_knob_value
    || log.depth_layer_shown > card.current_max_layer) {
    throw new Error('The review log does not match the current card revision. Record card and log changes atomically.');
  }
};

const withWebDataMutation = async <T>(
  principal: ReturnType<typeof captureFlashcardPrincipal>,
  mutation: () => Promise<T> | T,
): Promise<T> => {
  const operation = webDataMutationQueue.then(() => withWebStorageLock(async () => {
    await reloadWebData();
    requireCurrentFlashcardPrincipal(principal);
    const before = JSON.stringify({ version: 1, data: webData });
    try {
      return await mutation();
    } catch (error) {
      // Validation errors can occur after an operation has made several
      // in-memory changes. Restore the exact pre-operation state atomically.
      hydrateWebData(before);
      throw error;
    }
  }, true));
  webDataMutationQueue = operation.then(() => undefined, () => undefined);
  return operation;
};

// ------------------------------------------------------------------
// DeckStore
// ------------------------------------------------------------------
export const DeckStore = {
  async getAll(): Promise<Deck[]> {
    const principal = captureFlashcardPrincipal();
    if (Platform.OS === 'web') {
      await ensureWebDataLoaded();
      if (!isFlashcardPrincipalCurrent(principal)) return [];
      return webData.decks.filter(deck => deck.user_id === principal.id).map(cloneDeck);
    }
    const database = await getDB();
    const rows = await database!.getAllAsync<any>('SELECT * FROM decks WHERE user_id = ? AND deleted_at IS NULL', [principal.id]);
    if (!isFlashcardPrincipalCurrent(principal)) return [];
    return rows.map(decodeDeckRow);
  },

  /** Loads dashboard counters without materializing every card for every deck. */
  async getAllWithStats(): Promise<Deck[]> {
    const principal = captureFlashcardPrincipal();
    const now = Date.now();
    if (Platform.OS === 'web') {
      await ensureWebDataLoaded();
      if (!isFlashcardPrincipalCurrent(principal)) return [];
      const ownedDecks = webData.decks.filter(deck => deck.user_id === principal.id && !deck.deleted_at);
      const counters = new Map<string, { dueCount: number; totalCount: number; newCount: number }>(
        ownedDecks.map(deck => [deck.id, { dueCount: 0, totalCount: 0, newCount: 0 }]),
      );
      webData.cards.forEach(card => {
        const counter = counters.get(card.deck_id);
        if (!counter || card.deleted_at) return;
        counter.totalCount += 1;
        if (card.due <= now) counter.dueCount += 1;
        if (!card.last_review) counter.newCount += 1;
      });
      return ownedDecks.map(deck => ({ ...cloneDeck(deck), ...counters.get(deck.id)! }));
    }
    const database = await getDB();
    const rows = await database!.getAllAsync<Record<string, any>>(
      `SELECT d.*,
              COUNT(c.id) AS total_count,
              COALESCE(SUM(CASE WHEN c.due <= ? THEN 1 ELSE 0 END), 0) AS due_count,
              COALESCE(SUM(CASE WHEN c.id IS NOT NULL AND (c.last_review IS NULL OR c.last_review = 0) THEN 1 ELSE 0 END), 0) AS new_count
       FROM decks d
       LEFT JOIN cards c ON c.deck_id = d.id AND c.deleted_at IS NULL
       WHERE d.user_id = ? AND d.deleted_at IS NULL
       GROUP BY d.id
       ORDER BY d.position ASC, d.created_at ASC, d.id ASC`,
      [now, principal.id],
    );
    if (!isFlashcardPrincipalCurrent(principal)) return [];
    return rows.map(row => ({
      ...decodeDeckRow(row),
      totalCount: Number(row.total_count) || 0,
      dueCount: Number(row.due_count) || 0,
      newCount: Number(row.new_count) || 0,
    }));
  },
  
  async getById(id: string): Promise<Deck | null> {
    const principal = captureFlashcardPrincipal();
    if (Platform.OS === 'web') {
      await ensureWebDataLoaded();
      if (!isFlashcardPrincipalCurrent(principal)) return null;
      const deck = webData.decks.find(d => d.id === id && d.user_id === principal.id);
      return deck ? cloneDeck(deck) : null;
    }
    const database = await getDB();
    const r = await database!.getFirstAsync<any>('SELECT * FROM decks WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [id, principal.id]);
    if (!isFlashcardPrincipalCurrent(principal)) return null;
    if (!r) return null;
    return decodeDeckRow(r);
  },

  async getDeckDetailedStats(deckId: string): Promise<{
    totalCards: number;
    newCards: number;
    dueCards: number;
    learningCards: number;
    totalReviews: number;
    completionPercentage: number;
  }> {
    const principal = captureFlashcardPrincipal();
    if (Platform.OS === 'web') {
      await ensureWebDataLoaded();
      if (!isFlashcardPrincipalCurrent(principal)) throw new Error('The active flashcard account changed while statistics were loading.');
      if (!webData.decks.some(deck => deck.id === deckId && deck.user_id === principal.id)) throw new Error('The deck no longer exists.');
      const cards = webData.cards.filter(c => c.deck_id === deckId && !c.deleted_at);
      const totalCards = cards.length;
      const newCards = cards.filter(c => c.state === 0).length;
      const dueCards = cards.filter(c => c.state > 0 && c.due <= Date.now()).length;
      const learningCards = cards.filter(c => c.state === 1 || c.state === 3).length;
      const totalReviews = cards.reduce((sum, c) => sum + c.reps, 0);
      const completionPercentage = totalCards > 0 ? ((totalCards - newCards) / totalCards) * 100 : 0;
      return { totalCards, newCards, dueCards, learningCards, totalReviews, completionPercentage };
    }

    const database = await getDB();
    const now = Date.now();
    const ownedDeck = await database!.getFirstAsync<{ id: string }>('SELECT id FROM decks WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [deckId, principal.id]);
    if (!ownedDeck || !isFlashcardPrincipalCurrent(principal)) throw new Error('The deck no longer exists for the active account.');
    const [totalRow, newRow, dueRow, learnRow, repsRow] = await Promise.all([
      database!.getFirstAsync<any>('SELECT count(*) as c FROM cards WHERE deck_id = ? AND deleted_at IS NULL', [deckId]),
      database!.getFirstAsync<any>('SELECT count(*) as c FROM cards WHERE deck_id = ? AND state = 0 AND deleted_at IS NULL', [deckId]),
      database!.getFirstAsync<any>('SELECT count(*) as c FROM cards WHERE deck_id = ? AND state > 0 AND due <= ? AND deleted_at IS NULL', [deckId, now]),
      database!.getFirstAsync<any>('SELECT count(*) as c FROM cards WHERE deck_id = ? AND state IN (1, 3) AND deleted_at IS NULL', [deckId]),
      database!.getFirstAsync<any>('SELECT sum(reps) as s FROM cards WHERE deck_id = ? AND deleted_at IS NULL', [deckId])
    ]);

    const totalCards = totalRow?.c || 0;
    const newCards = newRow?.c || 0;
    const dueCards = dueRow?.c || 0;
    const learningCards = learnRow?.c || 0;
    const totalReviews = repsRow?.s || 0;
    const completionPercentage = totalCards > 0 ? ((totalCards - newCards) / totalCards) * 100 : 0;

    return { totalCards, newCards, dueCards, learningCards, totalReviews, completionPercentage };
  },

  async insert(deck: Deck): Promise<void> {
    assertDeckRecord(deck);
    const principal = captureFlashcardPrincipal();
    if (deck.user_id !== principal.id) throw new Error('A deck can be created only for the active flashcard account.');
    if (Platform.OS === 'web') {
      await withWebDataMutation(principal, async () => {
        if (webData.decks.some(candidate => candidate.id === deck.id)) throw new Error('A deck with this ID already exists.');
        if (deck.parent_id && !webData.decks.some(candidate => candidate.id === deck.parent_id && candidate.user_id === principal.id)) {
          throw new Error('The parent deck no longer exists.');
        }
        webData.decks.push(cloneDeck(deck));
        await persistWebData();
      });
      return;
    }
    const database = await getDB();
    requireCurrentFlashcardPrincipal(principal);
    await database!.withExclusiveTransactionAsync(async tx => {
      requireCurrentFlashcardPrincipal(principal);
      if (deck.parent_id) {
        const parent = await tx.getFirstAsync<{ id: string }>('SELECT id FROM decks WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [deck.parent_id, principal.id]);
        if (!parent) throw new Error('The parent deck no longer exists.');
      }
      await tx.runAsync(
        `INSERT INTO decks (id, user_id, parent_id, name, description, settings, position, completed_once, first_completed_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [deck.id, deck.user_id, deck.parent_id || null, deck.name, deck.description, JSON.stringify(deck.settings), deck.position, deck.completed_once ? 1 : 0, deck.first_completed_at || null, deck.created_at],
      );
    });
  },

  async update(deck: Deck): Promise<void> {
    assertDeckRecord(deck);
    const principal = captureFlashcardPrincipal();
    if (deck.user_id !== principal.id) throw new Error('A deck can be updated only by its active flashcard account.');
    if (Platform.OS === 'web') {
      await withWebDataMutation(principal, async () => {
        const idx = webData.decks.findIndex(d => d.id === deck.id && d.user_id === principal.id);
        if (idx < 0) throw new Error('The deck no longer exists.');
        if (deck.parent_id) {
          let ancestorId: string | undefined = deck.parent_id;
          const visited = new Set<string>();
          while (ancestorId) {
            if (ancestorId === deck.id) throw new Error('A deck cannot be moved inside one of its descendants.');
            if (visited.has(ancestorId)) throw new Error('The deck hierarchy contains a cycle.');
            visited.add(ancestorId);
            const ancestor: Deck | undefined = webData.decks.find(candidate => candidate.id === ancestorId && candidate.user_id === principal.id);
            if (!ancestor) throw new Error('The parent deck no longer exists.');
            ancestorId = ancestor.parent_id;
          }
        }
        webData.decks[idx] = cloneDeck(deck);
        await persistWebData();
      });
      return;
    }
    const database = await getDB();
    requireCurrentFlashcardPrincipal(principal);
    await database!.withExclusiveTransactionAsync(async tx => {
      requireCurrentFlashcardPrincipal(principal);
      const current = await tx.getFirstAsync<{ id: string }>('SELECT id FROM decks WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [deck.id, principal.id]);
      if (!current) throw new Error('The deck no longer exists.');
      if (deck.parent_id) {
        let ancestorId: string | null = deck.parent_id;
        const visited = new Set<string>();
        while (ancestorId) {
          if (ancestorId === deck.id) throw new Error('A deck cannot be moved inside one of its descendants.');
          if (visited.has(ancestorId)) throw new Error('The deck hierarchy contains a cycle.');
          visited.add(ancestorId);
          const ancestor: { parent_id: string | null } | null = await tx.getFirstAsync<{ parent_id: string | null }>(
            'SELECT parent_id FROM decks WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
            [ancestorId, principal.id],
          );
          if (!ancestor) throw new Error('The parent deck no longer exists.');
          ancestorId = ancestor.parent_id;
        }
      }
      const result = await tx.runAsync(
        `UPDATE decks SET parent_id = ?, name = ?, description = ?, settings = ?, position = ?, completed_once = ?, first_completed_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
        [deck.parent_id || null, deck.name, deck.description, JSON.stringify(deck.settings), deck.position, deck.completed_once ? 1 : 0, deck.first_completed_at || null, deck.id, principal.id],
      );
      if (result.changes !== 1) throw new Error('The deck changed while it was being updated.');
    });
  },

  async softDelete(id: string): Promise<string[]> {
    const principal = captureFlashcardPrincipal();
    if (Platform.OS === 'web') {
      return withWebDataMutation(principal, async () => {
        if (!webData.decks.some(deck => deck.id === id && deck.user_id === principal.id)) throw new Error('The deck no longer exists.');
        const deckIds = new Set<string>([id]);
        const pending = [id];
        while (pending.length > 0) {
          const parentId = pending.shift()!;
          webData.decks.filter(deck => deck.user_id === principal.id).forEach(deck => {
            if (deck.parent_id !== parentId) return;
            if (deckIds.has(deck.id)) throw new Error('The deck hierarchy contains a cycle and cannot be deleted safely.');
            deckIds.add(deck.id);
            pending.push(deck.id);
          });
        }
        const cardsInDeck = webData.cards.filter(c => deckIds.has(c.deck_id));
        const cardIds = cardsInDeck.map(c => c.id);
        const noteIds = new Set(cardsInDeck.map(c => c.note_id));

        webData.decks = webData.decks.filter(d => !deckIds.has(d.id));
        webData.cards = webData.cards.filter(c => !deckIds.has(c.deck_id));
        webData.notes = webData.notes.filter(note => (
          !noteIds.has(note.id)
          || webData.cards.some(card => card.note_id === note.id && !card.deleted_at)
        ));
        webData.depth_layers = webData.depth_layers.filter(l => !cardIds.includes(l.card_id));
        webData.review_logs = webData.review_logs.filter(l => !cardIds.includes(l.card_id));
        await persistWebData();
        return Array.from(deckIds);
      });
    }
    const database = await getDB();
    requireCurrentFlashcardPrincipal(principal);
    const now = Date.now();
    let idsToDelete: string[] = [];
    await database!.withExclusiveTransactionAsync(async (tx) => {
      requireCurrentFlashcardPrincipal(principal);
      const root = await tx.getFirstAsync<{ id: string }>('SELECT id FROM decks WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [id, principal.id]);
      if (!root) throw new Error('The deck no longer exists.');

      // Discover and delete the hierarchy under the same exclusive lock so a
      // concurrently-created child cannot escape the recursive deletion.
      const visited = new Set<string>([id]);
      const getDescendants = async (parentId: string): Promise<string[]> => {
        const rows = await tx.getAllAsync<{ id: string }>(
          'SELECT id FROM decks WHERE parent_id = ? AND user_id = ? AND deleted_at IS NULL',
          [parentId, principal.id],
        );
        const descendants: string[] = [];
        for (const row of rows) {
          if (visited.has(row.id)) throw new Error('The deck hierarchy contains a cycle and cannot be deleted safely.');
          visited.add(row.id);
          descendants.push(row.id, ...(await getDescendants(row.id)));
        }
        return descendants;
      };

      idsToDelete = [id, ...(await getDescendants(id))];
      for (const dId of idsToDelete) {
         const result = await tx.runAsync('UPDATE decks SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL', [now, dId]);
         if (result.changes !== 1) throw new Error(`Deck "${dId}" changed while it was being deleted.`);
         await tx.runAsync(`UPDATE depth_layers SET deleted_at = ? WHERE card_id IN (SELECT id FROM cards WHERE deck_id = ?)`, [now, dId]);
         await tx.runAsync(`UPDATE review_logs SET deleted_at = ? WHERE card_id IN (SELECT id FROM cards WHERE deck_id = ?)`, [now, dId]);
         await tx.runAsync(`UPDATE notif_schedules SET deleted_at = ? WHERE deck_id = ?`, [now, dId]);
         await tx.runAsync(`DELETE FROM card_tags WHERE card_id IN (SELECT id FROM cards WHERE deck_id = ?)`, [dId]);
         await tx.runAsync(`UPDATE cards SET deleted_at = ? WHERE deck_id = ?`, [now, dId]);
      }
      for (const dId of idsToDelete) {
        await tx.runAsync(
          `UPDATE notes SET deleted_at = ?
           WHERE deleted_at IS NULL
           AND id IN (SELECT note_id FROM cards WHERE deck_id = ?)
           AND NOT EXISTS (SELECT 1 FROM cards c WHERE c.note_id = notes.id AND c.deleted_at IS NULL)`,
          [now, dId],
        );
      }
    });
    return idsToDelete;
  },

  async resetDeckStats(deckId: string): Promise<void> {
    const principal = captureFlashcardPrincipal();
    if (Platform.OS === 'web') {
      await withWebDataMutation(principal, async () => {
        if (!webData.decks.some(deck => deck.id === deckId && deck.user_id === principal.id)) throw new Error('The deck no longer exists.');
        const now = Date.now();
        webData.cards.forEach(c => {
          if (c.deck_id === deckId) {
            c.difficulty = 0;
            c.stability = 0;
            c.retrievability = 0;
            c.state = 0;
            c.last_knob_value = 0;
            c.due = now;
            c.reps = 0;
            c.lapses = 0;
            c.learning_steps = 0;
            c.last_review = 0;
          }
        });
        webData.review_logs = webData.review_logs.filter(l => {
          const card = webData.cards.find(c => c.id === l.card_id);
          return card?.deck_id !== deckId;
        });
        await persistWebData();
      });
      return;
    }
    const database = await getDB();
    requireCurrentFlashcardPrincipal(principal);
    const now = Date.now();
    await database!.withExclusiveTransactionAsync(async (tx) => {
      requireCurrentFlashcardPrincipal(principal);
      const deck = await tx.getFirstAsync<{ id: string }>('SELECT id FROM decks WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [deckId, principal.id]);
      if (!deck) throw new Error('The deck no longer exists.');
      await tx.runAsync(
        `UPDATE cards SET difficulty = 0, stability = 0, retrievability = 0, state = 0, last_knob_value = 0, due = ?, reps = 0, lapses = 0, learning_steps = 0, last_review = 0 WHERE deck_id = ?`,
        [now, deckId]
      );
      await tx.runAsync(
        `UPDATE review_logs SET deleted_at = ? WHERE card_id IN (SELECT id FROM cards WHERE deck_id = ?)`,
        [now, deckId]
      );
    });
  }
};

// ------------------------------------------------------------------
// CardStore
// ------------------------------------------------------------------
export const CardStore = {
  async getDueCardCount(): Promise<number> {
    const principal = captureFlashcardPrincipal();
    if (Platform.OS === 'web') {
      await ensureWebDataLoaded();
      if (!isFlashcardPrincipalCurrent(principal)) return 0;
      const deckIds = new Set(webData.decks.filter(deck => deck.user_id === principal.id && !deck.deleted_at).map(deck => deck.id));
      const noteIds = new Set(webData.notes.map(note => note.id));
      return webData.cards.filter(card => deckIds.has(card.deck_id) && card.due <= Date.now() && noteIds.has(card.note_id) && !card.deleted_at).length;
    }
    const database = await getDB();
    const row = await database!.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM cards c
       JOIN notes n ON c.note_id = n.id
       JOIN decks d ON c.deck_id = d.id
       WHERE d.user_id = ? AND d.deleted_at IS NULL AND c.due <= ? AND c.deleted_at IS NULL AND n.deleted_at IS NULL`,
      [principal.id, Date.now()],
    );
    if (!isFlashcardPrincipalCurrent(principal)) return 0;
    return row?.count ?? 0;
  },

  async getCardsByDeck(deckId: string): Promise<Card[]> {
    const principal = captureFlashcardPrincipal();
    if (Platform.OS === 'web') {
      await ensureWebDataLoaded();
      if (!isFlashcardPrincipalCurrent(principal) || !webDeckBelongsTo(deckId, principal.id)) return [];
      return webData.cards
        .filter(c => c.deck_id === deckId && !c.deleted_at)
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.created_at - b.created_at || a.id.localeCompare(b.id))
        .map(cloneCard);
    }
    const database = await getDB();
    const rows = await database!.getAllAsync<Record<string, any>>(
      `SELECT c.* FROM cards c JOIN decks d ON c.deck_id = d.id
       WHERE c.deck_id = ? AND d.user_id = ? AND d.deleted_at IS NULL AND c.deleted_at IS NULL
       ORDER BY c.position ASC, c.created_at ASC, c.id ASC`,
      [deckId, principal.id],
    );
    return isFlashcardPrincipalCurrent(principal) ? rows.map(decodeCardRow) : [];
  },

  async getDueCards(deckId: string, limit: number = 50): Promise<Card[]> {
    assertPageArguments(limit);
    const principal = captureFlashcardPrincipal();
    if (Platform.OS === 'web') {
      await ensureWebDataLoaded();
      if (!isFlashcardPrincipalCurrent(principal) || !webDeckBelongsTo(deckId, principal.id)) return [];
      const now = Date.now();
      return webData.cards.filter(c => c.deck_id === deckId && c.due <= now && !c.deleted_at).sort((a, b) => a.due - b.due || a.id.localeCompare(b.id)).slice(0, limit).map(cloneCard);
    }
    const database = await getDB();
    const now = Date.now();
    const rows = await database!.getAllAsync<Record<string, any>>(
      `SELECT c.* FROM cards c JOIN decks d ON c.deck_id = d.id
       WHERE c.deck_id = ? AND d.user_id = ? AND d.deleted_at IS NULL AND c.due <= ? AND c.deleted_at IS NULL
       ORDER BY c.due ASC, c.id ASC LIMIT ?`,
      [deckId, principal.id, now, limit]
    );
    return isFlashcardPrincipalCurrent(principal) ? rows.map(decodeCardRow) : [];
  },

  async getAllDueCardsWithNotes(limit: number = 64): Promise<{ card: Card, note: Note }[]> {
    assertPageArguments(limit);
    const principal = captureFlashcardPrincipal();
    if (Platform.OS === 'web') {
      await ensureWebDataLoaded();
      if (!isFlashcardPrincipalCurrent(principal)) return [];
      const deckIds = new Set(webData.decks.filter(deck => deck.user_id === principal.id && !deck.deleted_at).map(deck => deck.id));
      const now = Date.now();
      const dueCards = webData.cards.filter(c => deckIds.has(c.deck_id) && c.due <= now && !c.deleted_at).sort((a, b) => a.due - b.due).slice(0, limit);
      return dueCards.map(c => {
        const note = webData.notes.find(n => n.id === c.note_id);
        if (!note) throw new Error(`Card data is corrupt: note "${c.note_id}" is missing.`);
        return { card: withCurrentRetrievability(cloneCard(c)), note: cloneNote(note) };
      });
    }
    const database = await getDB();
    const now = Date.now();
    const rows = await database!.getAllAsync<any>(
      `SELECT c.*, n.field_values, n.note_type_id, n.created_at AS note_created_at, n.updated_at AS note_updated_at
       FROM cards c
       JOIN notes n ON c.note_id = n.id
       JOIN decks d ON c.deck_id = d.id
       WHERE d.user_id = ? AND d.deleted_at IS NULL AND c.due <= ? AND c.deleted_at IS NULL AND n.deleted_at IS NULL
       ORDER BY c.due ASC
       LIMIT ?`,
      [principal.id, now, limit]
    );
    if (!isFlashcardPrincipalCurrent(principal)) return [];
    
    return rows.map(r => ({
      card: withCurrentRetrievability(decodeCardRow(r)),
      note: decodeJoinedNoteRow(r),
    }));
  },

  async getDueCardsForDeckWithNotes(deckId: string, limit: number = 50): Promise<{ card: Card, note: Note }[]> {
    assertPageArguments(limit);
    const principal = captureFlashcardPrincipal();
    if (Platform.OS === 'web') {
      await ensureWebDataLoaded();
      if (!isFlashcardPrincipalCurrent(principal) || !webDeckBelongsTo(deckId, principal.id)) return [];
      const now = Date.now();
      const dueCards = webData.cards.filter(c => c.deck_id === deckId && c.due <= now && !c.deleted_at).sort((a, b) => a.due - b.due).slice(0, limit);
      return dueCards.map(c => {
        const note = webData.notes.find(n => n.id === c.note_id);
        if (!note) throw new Error(`Card data is corrupt: note "${c.note_id}" is missing.`);
        return { card: withCurrentRetrievability(cloneCard(c)), note: cloneNote(note) };
      });
    }
    const database = await getDB();
    const now = Date.now();
    const rows = await database!.getAllAsync<any>(
      `SELECT c.*, n.field_values, n.note_type_id, n.created_at AS note_created_at, n.updated_at AS note_updated_at
       FROM cards c
       JOIN notes n ON c.note_id = n.id
       JOIN decks d ON c.deck_id = d.id
       WHERE c.deck_id = ? AND d.user_id = ? AND d.deleted_at IS NULL AND c.due <= ? AND c.deleted_at IS NULL AND n.deleted_at IS NULL
       ORDER BY c.due ASC
       LIMIT ?`,
      [deckId, principal.id, now, limit]
    );
    if (!isFlashcardPrincipalCurrent(principal)) return [];
    
    return rows.map(r => ({
      card: withCurrentRetrievability(decodeCardRow(r)),
      note: decodeJoinedNoteRow(r),
    }));
  },

  async getStudyQueueWithNotes(deckId: string, limit: number = 50): Promise<{ card: Card, note: Note }[]> {
    assertPageArguments(limit);
    const principal = captureFlashcardPrincipal();
    if (Platform.OS === 'web') {
      await ensureWebDataLoaded();
      if (!isFlashcardPrincipalCurrent(principal) || !webDeckBelongsTo(deckId, principal.id)) return [];
      const candidateLimit = Math.min(10_000, Math.max(20, limit) * 5);
      const candidateCards = webData.cards
        .filter(c => c.deck_id === deckId && !c.deleted_at)
        .filter(card => card.state > 0)
        .sort((a, b) => a.due - b.due || a.id.localeCompare(b.id))
        .slice(0, candidateLimit)
        .map(card => withCurrentRetrievability(cloneCard(card)));
      const allDeckCards = webData.cards.filter(c => c.deck_id === deckId && !c.deleted_at);
      const activeCards = candidateCards;
      const activePool = activeCards.filter(card => card.retrievability < 0.9);
      const numNewCardsNeeded = Math.max(0, 20 - activePool.length);
      const newCards = allDeckCards
        .filter(card => card.state === 0)
        .sort((a, b) => a.created_at - b.created_at)
        .slice(0, numNewCardsNeeded);
      let queue = [...newCards, ...activePool]
        .sort((a, b) => (a.state === 0 ? -1 : a.retrievability) - (b.state === 0 ? -1 : b.retrievability) || a.due - b.due);
      if (queue.length < limit) {
        const masteredCards = activeCards
          .filter(card => card.retrievability >= 0.9)
          .sort((a, b) => a.due - b.due);
        queue = [...queue, ...masteredCards];
      }

      return queue.slice(0, limit).map(c => {
        const note = webData.notes.find(n => n.id === c.note_id);
        if (!note) throw new Error(`Card data is corrupt: note "${c.note_id}" is missing.`);
        return { card: cloneCard(c), note: cloneNote(note) };
      });
    }

    const database = await getDB();
    const candidateLimit = Math.min(10_000, Math.max(20, limit) * 5);
    // Bound scheduler work on very large decks while prioritizing the cards
    // whose due dates make them the strongest review candidates.
    const reviewRows = await database!.getAllAsync<any>(
      `SELECT c.*, n.field_values, n.note_type_id, n.created_at AS note_created_at, n.updated_at AS note_updated_at
       FROM cards c
       JOIN notes n ON c.note_id = n.id
       JOIN decks d ON c.deck_id = d.id
       WHERE c.deck_id = ? AND d.user_id = ? AND d.deleted_at IS NULL AND c.state > 0 AND c.deleted_at IS NULL AND n.deleted_at IS NULL
       ORDER BY c.due ASC, c.id ASC
       LIMIT ?`,
      [deckId, principal.id, candidateLimit]
    );

    const activeCards = reviewRows.map(r => {
      const card = withCurrentRetrievability(decodeCardRow(r));
      const note = decodeJoinedNoteRow(r);
      const rScore = card.retrievability * 100;
      return { card, note, rScore };
    });

    // Identify the struggling "Active Pool" (R < 90%)
    const activePool = activeCards.filter(c => c.rScore < 90);
    
    // Determine how many New cards to inject (Max pool size = 20)
    const MAX_POOL_SIZE = 20;
    const numNewCardsNeeded = Math.max(0, MAX_POOL_SIZE - activePool.length);

    let newCards: any[] = [];
    if (numNewCardsNeeded > 0) {
      const newRows = await database!.getAllAsync<any>(
        `SELECT c.*, n.field_values, n.note_type_id, n.created_at AS note_created_at, n.updated_at AS note_updated_at
         FROM cards c
         JOIN notes n ON c.note_id = n.id
         JOIN decks d ON c.deck_id = d.id
         WHERE c.deck_id = ? AND d.user_id = ? AND d.deleted_at IS NULL AND c.state = 0 AND c.deleted_at IS NULL AND n.deleted_at IS NULL
         ORDER BY c.created_at ASC
         LIMIT ?`,
        [deckId, principal.id, numNewCardsNeeded]
      );
      
      newCards = newRows.map(r => ({
        card: decodeCardRow(r),
        note: decodeJoinedNoteRow(r),
        rScore: -1 // Force New cards to the absolute front of priority if injected
      }));
    }

    // Combine Active Pool, Injected New Cards, and Mastered Cards (just in case they requested 50 but pool+new is only 30)
    let combined = [...activePool, ...newCards];
    
    // Sort strictly by R Score (lowest first)
    combined.sort((a, b) => a.rScore - b.rScore);
    
    // If we haven't hit the user's limit, start pulling in mastered cards (sorted by due date)
    if (combined.length < limit) {
      const masteredCards = activeCards.filter(c => c.rScore >= 90).sort((a, b) => a.card.due - b.card.due);
      combined = [...combined, ...masteredCards];
    }
    
    // Finally, truncate to exactly what the user requested
    return isFlashcardPrincipalCurrent(principal)
      ? combined.slice(0, limit).map(item => ({ card: item.card, note: item.note }))
      : [];
  },

  async getAllCardsForDeckWithNotes(deckId: string, limit: number = 50, offset: number = 0): Promise<{ card: Card & { tags?: string[] }, note: Note, layers: DepthLayer[] }[]> {
    assertPageArguments(limit, offset);
    const principal = captureFlashcardPrincipal();
    if (Platform.OS === 'web') {
      await ensureWebDataLoaded();
      if (!isFlashcardPrincipalCurrent(principal) || !webDeckBelongsTo(deckId, principal.id)) return [];
      const activeCards = webData.cards.filter(c => c.deck_id === deckId && !c.deleted_at);
      const sorted = [...activeCards].sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.created_at - b.created_at || a.id.localeCompare(b.id)).slice(offset, offset + limit);
      
      return sorted.map(c => {
        const n = webData.notes.find(note => note.id === c.note_id);
        if (!n) throw new Error(`Card data is corrupt: note "${c.note_id}" is missing.`);
        const dl = webData.depth_layers.filter(l => l.card_id === c.id).sort((a, b) => a.layer_number - b.layer_number);
        return { card: cloneCard(c), note: cloneNote(n), layers: dl.map(cloneLayer) };
      });
    }

    const database = await getDB();
    const rows = await database!.getAllAsync<any>(
      `SELECT c.*, n.field_values, n.note_type_id, n.created_at AS note_created_at, n.updated_at AS note_updated_at,
              COALESCE((
                SELECT json_group_array(tag.name)
                FROM card_tags card_tag JOIN tags tag ON tag.id = card_tag.tag_id
                WHERE card_tag.card_id = c.id AND tag.deleted_at IS NULL
              ), '[]') AS tag_names_json
       FROM cards c
       JOIN notes n ON c.note_id = n.id
       JOIN decks d ON c.deck_id = d.id
       WHERE c.deck_id = ? AND d.user_id = ? AND d.deleted_at IS NULL AND c.deleted_at IS NULL AND n.deleted_at IS NULL
       ORDER BY c.position ASC, c.created_at ASC, c.id ASC
       LIMIT ? OFFSET ?`,
      [deckId, principal.id, limit, offset]
    );
    
    // Fetch all depth layers for these cards
    const cardIds = rows.map(r => r.id);
    let allLayers: DepthLayer[] = [];
    if (cardIds.length > 0) {
      const placeholders = cardIds.map(() => '?').join(',');
      const layerRows = await database!.getAllAsync<any>(
        `SELECT * FROM depth_layers WHERE card_id IN (${placeholders}) AND deleted_at IS NULL ORDER BY layer_number ASC`,
        cardIds
      );
      allLayers = layerRows.map(decodeLayerRow);
    }
    
    if (!isFlashcardPrincipalCurrent(principal)) return [];
    return rows.map(r => ({
      card: decodeCardRow(r),
      note: decodeJoinedNoteRow(r),
      layers: allLayers.filter(l => l.card_id === r.id)
    }));
  },

  async updateCard(card: Card): Promise<void> {
    assertCardRecord(card);
    const principal = captureFlashcardPrincipal();
    if (Platform.OS === 'web') {
      await withWebDataMutation(principal, async () => {
        const idx = webData.cards.findIndex(c => c.id === card.id && webDeckBelongsTo(c.deck_id, principal.id));
        if (idx < 0) throw new Error('The card no longer exists.');
        const existing = webData.cards[idx];
        webData.cards[idx] = {
          ...existing,
          difficulty: card.difficulty,
          stability: card.stability,
          retrievability: card.retrievability,
          state: card.state,
          last_knob_value: card.last_knob_value,
          current_max_layer: card.current_max_layer,
          due: card.due,
          reps: card.reps,
          lapses: card.lapses,
          learning_steps: card.learning_steps,
          last_review: card.last_review,
        };
        await persistWebData();
      });
      return;
    }
    const database = await getDB();
    requireCurrentFlashcardPrincipal(principal);
    const result = await database!.runAsync(
      `UPDATE cards SET difficulty = ?, stability = ?, retrievability = ?, state = ?, last_knob_value = ?, current_max_layer = ?, due = ?, reps = ?, lapses = ?, learning_steps = ?, last_review = ?
       WHERE id = ? AND deleted_at IS NULL
       AND EXISTS (SELECT 1 FROM decks d WHERE d.id = cards.deck_id AND d.user_id = ? AND d.deleted_at IS NULL)`,
      [card.difficulty, card.stability, card.retrievability, card.state, card.last_knob_value, card.current_max_layer, card.due, card.reps, card.lapses, card.learning_steps, card.last_review, card.id, principal.id]
    );
    if (result.changes !== 1) throw new Error('The card no longer exists.');
  },

  async updateNote(noteId: string, fieldValues: Record<string, string>): Promise<void> {
    assertNoteFieldValues(fieldValues);
    const principal = captureFlashcardPrincipal();
    if (Platform.OS === 'web') {
      await withWebDataMutation(principal, async () => {
        const idx = webData.notes.findIndex(n => n.id === noteId && webNoteBelongsTo(noteId, principal.id));
        if (idx < 0) throw new Error('The note no longer exists.');
        webData.notes[idx].field_values = { ...fieldValues };
        webData.notes[idx].updated_at = Date.now();
        await persistWebData();
      });
      return;
    }
    const database = await getDB();
    requireCurrentFlashcardPrincipal(principal);
    const result = await database!.runAsync(
      `UPDATE notes SET field_values = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL
       AND EXISTS (
         SELECT 1 FROM cards c JOIN decks d ON c.deck_id = d.id
         WHERE c.note_id = notes.id AND c.deleted_at IS NULL AND d.user_id = ? AND d.deleted_at IS NULL
       )`,
      [JSON.stringify(fieldValues), Date.now(), noteId, principal.id]
    );
    if (result.changes !== 1) throw new Error('The note no longer exists.');
  },

  async insertCard(card: Card): Promise<void> {
    assertCardRecord(card);
    const principal = captureFlashcardPrincipal();
    if (Platform.OS === 'web') {
      await withWebDataMutation(principal, async () => {
        if (webData.cards.some(candidate => candidate.id === card.id)) throw new Error('A card with this ID already exists.');
        const linkedCards = webData.cards.filter(candidate => candidate.note_id === card.note_id && !candidate.deleted_at);
        const noteIsOwnedOrUnlinked = linkedCards.length === 0 || linkedCards.every(candidate => webDeckBelongsTo(candidate.deck_id, principal.id));
        if (!webDeckBelongsTo(card.deck_id, principal.id)
          || !webData.notes.some(note => note.id === card.note_id && !note.deleted_at)
          || !noteIsOwnedOrUnlinked) {
          throw new Error('The card references a missing deck or note.');
        }
        webData.cards.push(cloneCard(card));
        await persistWebData();
      });
      return;
    }
    const database = await getDB();
    requireCurrentFlashcardPrincipal(principal);
    await database!.withExclusiveTransactionAsync(async tx => {
      requireCurrentFlashcardPrincipal(principal);
      const deck = await tx.getFirstAsync<{ id: string }>('SELECT id FROM decks WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [card.deck_id, principal.id]);
      const note = await tx.getFirstAsync<{ id: string }>(
        `SELECT n.id FROM notes n WHERE n.id = ? AND n.deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM cards existing JOIN decks d ON existing.deck_id = d.id
           WHERE existing.note_id = n.id AND existing.deleted_at IS NULL
           AND (d.user_id <> ? OR d.deleted_at IS NOT NULL)
         )`,
        [card.note_id, principal.id],
      );
      if (!deck || !note) throw new Error('The card references a missing deck or note.');
      await tx.runAsync(
        `INSERT INTO cards (id, note_id, deck_id, template_id, position, difficulty, stability, retrievability, state, last_knob_value, current_max_layer, total_layers, due, reps, lapses, learning_steps, last_review, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [card.id, card.note_id, card.deck_id, card.template_id, card.position || 0, card.difficulty, card.stability, card.retrievability, card.state, card.last_knob_value, card.current_max_layer, card.total_layers, card.due, card.reps, card.lapses, card.learning_steps, card.last_review, card.created_at],
      );
    });
  },

  async deleteCard(cardId: string): Promise<void> {
    const principal = captureFlashcardPrincipal();
    if (Platform.OS === 'web') {
      await withWebDataMutation(principal, async () => {
        const card = webData.cards.find(c => c.id === cardId && webDeckBelongsTo(c.deck_id, principal.id));
        if (!card) throw new Error('The card no longer exists.');
        webData.cards = webData.cards.filter(c => c.id !== cardId);
        if (!webData.cards.some(candidate => candidate.note_id === card.note_id && !candidate.deleted_at)) {
          webData.notes = webData.notes.filter(n => n.id !== card.note_id);
        }
        webData.depth_layers = webData.depth_layers.filter(l => l.card_id !== cardId);
        webData.review_logs = webData.review_logs.filter(l => l.card_id !== cardId);
        await persistWebData();
      });
      return;
    }
    const database = await getDB();
    requireCurrentFlashcardPrincipal(principal);
    const now = Date.now();
    
    await database!.withExclusiveTransactionAsync(async (tx) => {
      requireCurrentFlashcardPrincipal(principal);
      const ownedCard = await tx.getFirstAsync<{ id: string }>(
        `SELECT c.id FROM cards c JOIN decks d ON c.deck_id = d.id
         WHERE c.id = ? AND c.deleted_at IS NULL AND d.user_id = ? AND d.deleted_at IS NULL`,
        [cardId, principal.id],
      );
      if (!ownedCard) throw new Error('The card no longer exists.');
      const note = await tx.getFirstAsync<{ note_id: string }>('SELECT note_id FROM cards WHERE id = ?', [cardId]);
      if (!note) throw new Error('The card no longer exists.');
      // Cascade soft-delete using subqueries
      await tx.runAsync('UPDATE depth_layers SET deleted_at = ? WHERE card_id = ?', [now, cardId]);
      await tx.runAsync('UPDATE review_logs SET deleted_at = ? WHERE card_id = ?', [now, cardId]);
      await tx.runAsync('DELETE FROM card_tags WHERE card_id = ?', [cardId]);
      
      // Delete the card last
      const result = await tx.runAsync('UPDATE cards SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL', [now, cardId]);
      if (result.changes !== 1) throw new Error('The card no longer exists.');
      await tx.runAsync(
        `UPDATE notes SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM cards c WHERE c.note_id = notes.id AND c.deleted_at IS NULL)`,
        [now, note.note_id],
      );
    });
  },

  async updatePositions(updates: { id: string, position: number }[]): Promise<void> {
    if (new Set(updates.map(update => update.id)).size !== updates.length
      || new Set(updates.map(update => update.position)).size !== updates.length
      || updates.some(update => !update.id || !Number.isInteger(update.position) || update.position < 0)) {
      throw new Error('Card order updates require unique card IDs and non-negative positions.');
    }
    const principal = captureFlashcardPrincipal();
    if (Platform.OS === 'web') {
      await withWebDataMutation(principal, async () => {
        const missing = updates.find(update => !webCardBelongsTo(update.id, principal.id));
        if (missing) throw new Error(`Card "${missing.id}" no longer exists.`);
        updates.forEach(u => {
          const card = webData.cards.find(c => c.id === u.id);
          card!.position = u.position;
        });
        await persistWebData();
      });
      return;
    }
    const database = await getDB();
    requireCurrentFlashcardPrincipal(principal);
    await database!.withExclusiveTransactionAsync(async tx => {
      requireCurrentFlashcardPrincipal(principal);
      for (const update of updates) {
        const result = await tx.runAsync(
          `UPDATE cards SET position = ? WHERE id = ? AND deleted_at IS NULL
           AND EXISTS (SELECT 1 FROM decks d WHERE d.id = cards.deck_id AND d.user_id = ? AND d.deleted_at IS NULL)`,
          [update.position, update.id, principal.id],
        );
        if (result.changes !== 1) throw new Error(`Card "${update.id}" no longer exists.`);
      }
    });
  },

  async updateCardTags(cardId: string, tags: string[]): Promise<void> {
    const normalizedTags = Array.from(new Set(tags.map(tag => tag.trim().toLocaleLowerCase()).filter(Boolean)));
    if (normalizedTags.length > 100 || normalizedTags.some(tag => tag.length > 100)) {
      throw new Error('A card can have at most 100 unique tags of 100 characters or fewer.');
    }
    const principal = captureFlashcardPrincipal();
    if (Platform.OS === 'web') {
      await withWebDataMutation(principal, async () => {
        const card = webData.cards.find(candidate => candidate.id === cardId && webDeckBelongsTo(candidate.deck_id, principal.id)) as (Card & { tags?: string[] }) | undefined;
        if (!card) throw new Error('The card was not found.');
        card.tags = normalizedTags;
        await persistWebData();
      });
      return;
    }
    const database = await getDB();
    requireCurrentFlashcardPrincipal(principal);
    await database!.withExclusiveTransactionAsync(async tx => {
      requireCurrentFlashcardPrincipal(principal);
      const card = await tx.getFirstAsync<{ id: string }>(
        `SELECT c.id FROM cards c JOIN decks d ON c.deck_id = d.id
         WHERE c.id = ? AND c.deleted_at IS NULL AND d.user_id = ? AND d.deleted_at IS NULL`,
        [cardId, principal.id],
      );
      if (!card) throw new Error('The card was not found.');
      await tx.runAsync('DELETE FROM card_tags WHERE card_id = ?', [cardId]);
      for (const tagName of normalizedTags) {
        const existing = await tx.getFirstAsync<{ id: string }>('SELECT id FROM tags WHERE name = ?', [tagName]);
        let tagId = existing?.id;
        if (!tagId) {
          tagId = createEntityId('tag');
          await tx.runAsync('INSERT INTO tags (id, name, color) VALUES (?, ?, ?)', [tagId, tagName, '#4A90E2']);
        }
        await tx.runAsync('INSERT INTO card_tags (card_id, tag_id) VALUES (?, ?)', [cardId, tagId]);
      }
    });
  }
};

// ------------------------------------------------------------------
// ReviewLogStore
// ------------------------------------------------------------------
export const ReviewLogStore = {
  async recordReview(
    previousLastReview: number,
    updatedCard: Card,
    log: ReviewLog,
    unlockLayerId?: string,
  ): Promise<void> {
    assertReviewedCardRecord(updatedCard);
    assertReviewLogRecord(log);
    if (log.card_id !== updatedCard.id || log.reviewed_at !== updatedCard.last_review) {
      throw new Error('Review log identity and timestamp must match the reviewed card.');
    }
    if (!Number.isFinite(previousLastReview) || previousLastReview < 0) {
      throw new Error('The previous review revision is invalid.');
    }
    const principal = captureFlashcardPrincipal();

    if (Platform.OS === 'web') {
      await withWebDataMutation(principal, async () => {
        const cardIndex = webData.cards.findIndex(card => card.id === updatedCard.id && webDeckBelongsTo(card.deck_id, principal.id));
        if (cardIndex < 0) throw new Error('The reviewed card no longer exists.');
        if (webData.cards[cardIndex].last_review !== previousLastReview) {
          throw new Error('This card was reviewed elsewhere. Reload before grading it again.');
        }
        if (webData.review_logs.some(candidate => candidate.id === log.id)) {
          throw new Error('This review has already been recorded.');
        }
        const layerIndex = unlockLayerId
          ? webData.depth_layers.findIndex(layer => layer.id === unlockLayerId && layer.card_id === updatedCard.id)
          : -1;
        if (unlockLayerId && layerIndex < 0) throw new Error('The page being unlocked no longer exists.');

        const existingCard = webData.cards[cardIndex];
        assertReviewTransition(existingCard, updatedCard, log, layerIndex >= 0 ? webData.depth_layers[layerIndex] : undefined);
        webData.cards[cardIndex] = {
          ...existingCard,
          difficulty: updatedCard.difficulty,
          stability: updatedCard.stability,
          retrievability: updatedCard.retrievability,
          state: updatedCard.state,
          last_knob_value: updatedCard.last_knob_value,
          current_max_layer: updatedCard.current_max_layer,
          due: updatedCard.due,
          reps: updatedCard.reps,
          lapses: updatedCard.lapses,
          learning_steps: updatedCard.learning_steps,
          last_review: updatedCard.last_review,
        };
        if (layerIndex >= 0) {
          webData.depth_layers[layerIndex] = {
            ...webData.depth_layers[layerIndex],
            is_unlocked: true,
            unlocked_at: log.reviewed_at,
          };
        }
        webData.review_logs.push({ ...log });
        await persistWebData();
      });
      return;
    }

    const database = await getDB();
    requireCurrentFlashcardPrincipal(principal);
    await database!.withExclusiveTransactionAsync(async tx => {
      requireCurrentFlashcardPrincipal(principal);
      const existingRow = await tx.getFirstAsync<Record<string, any>>(
        `SELECT c.* FROM cards c JOIN decks d ON c.deck_id = d.id
         WHERE c.id = ? AND c.deleted_at IS NULL AND d.user_id = ? AND d.deleted_at IS NULL`,
        [updatedCard.id, principal.id],
      );
      if (!existingRow) throw new Error('The reviewed card no longer exists.');
      const unlockLayerRow = unlockLayerId
        ? await tx.getFirstAsync<Record<string, any>>(
            'SELECT * FROM depth_layers WHERE id = ? AND card_id = ? AND deleted_at IS NULL',
            [unlockLayerId, updatedCard.id],
          )
        : null;
      if (unlockLayerId && !unlockLayerRow) throw new Error('The page being unlocked no longer exists.');
      assertReviewTransition(
        decodeCardRow(existingRow),
        updatedCard,
        log,
        unlockLayerRow ? decodeLayerRow(unlockLayerRow) : undefined,
      );
      const result = await tx.runAsync(
        `UPDATE cards
         SET difficulty = ?, stability = ?, retrievability = ?, state = ?, last_knob_value = ?, current_max_layer = ?, due = ?, reps = ?, lapses = ?, learning_steps = ?, last_review = ?
         WHERE id = ? AND deleted_at IS NULL AND last_review = ?
         AND EXISTS (SELECT 1 FROM decks d WHERE d.id = cards.deck_id AND d.user_id = ? AND d.deleted_at IS NULL)`,
        [updatedCard.difficulty, updatedCard.stability, updatedCard.retrievability, updatedCard.state, updatedCard.last_knob_value, updatedCard.current_max_layer, updatedCard.due, updatedCard.reps, updatedCard.lapses, updatedCard.learning_steps, updatedCard.last_review, updatedCard.id, previousLastReview, principal.id],
      );
      if (result.changes !== 1) {
        throw new Error('This card was changed or reviewed elsewhere. Reload before grading it again.');
      }
      if (unlockLayerId) {
        const layerResult = await tx.runAsync(
          'UPDATE depth_layers SET is_unlocked = 1, unlocked_at = ? WHERE id = ? AND card_id = ? AND deleted_at IS NULL',
          [log.reviewed_at, unlockLayerId, updatedCard.id],
        );
        if (layerResult.changes !== 1) throw new Error('The page being unlocked no longer exists.');
      }
      await tx.runAsync(
        `INSERT INTO review_logs (id, card_id, knob_value, fsrs_rating, elapsed_days, scheduled_days, state_before, state_after, difficulty_before, stability_before, difficulty_after, stability_after, duration_ms, depth_layer_shown, review_source, reviewed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [log.id, log.card_id, log.knob_value, log.fsrs_rating, log.elapsed_days, log.scheduled_days, log.state_before, log.state_after, log.difficulty_before, log.stability_before, log.difficulty_after, log.stability_after, log.duration_ms, log.depth_layer_shown, log.review_source, log.reviewed_at],
      );
    });
  },

  async insert(log: ReviewLog): Promise<void> {
    assertReviewLogRecord(log);
    const principal = captureFlashcardPrincipal();
    if (Platform.OS === 'web') {
      await withWebDataMutation(principal, async () => {
        if (webData.review_logs.some(candidate => candidate.id === log.id)) throw new Error('This review has already been recorded.');
        const card = webData.cards.find(candidate => candidate.id === log.card_id && webDeckBelongsTo(candidate.deck_id, principal.id));
        if (!card) throw new Error('The reviewed card no longer exists.');
        assertReviewLogMatchesCurrentCard(card, log);
        if (webData.review_logs.some(candidate => candidate.card_id === log.card_id && candidate.reviewed_at === log.reviewed_at)) {
          throw new Error('This card revision already has a review log.');
        }
        webData.review_logs.push({ ...log });
        await persistWebData();
      });
      return;
    }
    const database = await getDB();
    requireCurrentFlashcardPrincipal(principal);
    await database!.withExclusiveTransactionAsync(async tx => {
      requireCurrentFlashcardPrincipal(principal);
      const cardRow = await tx.getFirstAsync<Record<string, any>>(
        `SELECT c.* FROM cards c JOIN decks d ON c.deck_id = d.id
         WHERE c.id = ? AND c.deleted_at IS NULL AND d.user_id = ? AND d.deleted_at IS NULL`,
        [log.card_id, principal.id],
      );
      if (!cardRow) throw new Error('The reviewed card no longer exists.');
      assertReviewLogMatchesCurrentCard(decodeCardRow(cardRow), log);
      const existingRevision = await tx.getFirstAsync<{ id: string }>(
        'SELECT id FROM review_logs WHERE card_id = ? AND reviewed_at = ? AND deleted_at IS NULL',
        [log.card_id, log.reviewed_at],
      );
      if (existingRevision) throw new Error('This card revision already has a review log.');
      await tx.runAsync(
        `INSERT INTO review_logs (id, card_id, knob_value, fsrs_rating, elapsed_days, scheduled_days, state_before, state_after, difficulty_before, stability_before, difficulty_after, stability_after, duration_ms, depth_layer_shown, review_source, reviewed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [log.id, log.card_id, log.knob_value, log.fsrs_rating, log.elapsed_days, log.scheduled_days, log.state_before, log.state_after, log.difficulty_before, log.stability_before, log.difficulty_after, log.stability_after, log.duration_ms, log.depth_layer_shown, log.review_source, log.reviewed_at],
      );
    });
  },

  async getStats(): Promise<{
    totalReviews: number;
    retentionRate: number;
    last7Days: { date: string; count: number }[];
    knobDistribution: { range: string; count: number }[];
  }> {
    const principal = captureFlashcardPrincipal();
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    const sevenDaysAgo = now - 7 * oneDay;
    let logs: ReviewLog[];

    if (Platform.OS === 'web') {
      await ensureWebDataLoaded();
      requireCurrentFlashcardPrincipal(principal);
      const ownedCardIds = new Set(webData.cards.filter(card => webDeckBelongsTo(card.deck_id, principal.id)).map(card => card.id));
      logs = webData.review_logs
        .filter(log => !log.deleted_at && ownedCardIds.has(log.card_id))
        .map(log => {
          assertReviewLogRecord(log);
          return { ...log };
        });
    } else {
      const database = await getDB();
      if (!database) throw new Error('The review database is unavailable.');
      const rows = await database.getAllAsync<Record<string, any>>(
        `SELECT r.*
         FROM review_logs r
         JOIN cards c ON r.card_id = c.id
         JOIN decks d ON c.deck_id = d.id
         WHERE r.deleted_at IS NULL AND c.deleted_at IS NULL AND d.deleted_at IS NULL AND d.user_id = ?`,
        [principal.id],
      );
      logs = rows.map(decodeReviewLogRow);
    }
    requireCurrentFlashcardPrincipal(principal);

    const totalReviews = logs.length;
    const retainedReviews = logs.filter(log => log.fsrs_rating >= 3).length;
    const retentionRate = totalReviews > 0 ? (retainedReviews / totalReviews) * 100 : 0;
    const last7DaysMap = new Map<string, number>();
    for (let index = 6; index >= 0; index -= 1) {
      const date = new Date(now - index * oneDay).toISOString().slice(0, 10);
      last7DaysMap.set(date, 0);
    }
    logs
      .filter(log => log.reviewed_at >= sevenDaysAgo)
      .forEach(log => {
        const date = new Date(log.reviewed_at).toISOString().slice(0, 10);
        if (last7DaysMap.has(date)) {
          last7DaysMap.set(date, (last7DaysMap.get(date) ?? 0) + 1);
        }
      });

    const buckets = [0, 0, 0, 0];
    logs.forEach(log => {
      const value = log.knob_value;
      const bucket = value <= 25 ? 0 : value <= 50 ? 1 : value <= 75 ? 2 : 3;
      buckets[bucket] += 1;
    });

    return {
      totalReviews,
      retentionRate,
      last7Days: Array.from(last7DaysMap, ([date, count]) => ({ date, count })),
      knobDistribution: [
        { range: '0-25 (Hard)', count: buckets[0] },
        { range: '26-50 (Med)', count: buckets[1] },
        { range: '51-75 (Good)', count: buckets[2] },
        { range: '76-100 (Easy)', count: buckets[3] },
      ],
    };
  }
};

// ------------------------------------------------------------------
// DepthLayerStore
// ------------------------------------------------------------------
export const DepthLayerStore = {
  async getByCard(cardId: string): Promise<DepthLayer[]> {
    const principal = captureFlashcardPrincipal();
    if (Platform.OS === 'web') {
      await ensureWebDataLoaded();
      if (!isFlashcardPrincipalCurrent(principal) || !webCardBelongsTo(cardId, principal.id)) return [];
      return webData.depth_layers.filter(l => l.card_id === cardId).sort((a, b) => a.layer_number - b.layer_number).map(cloneLayer);
    }
    const database = await getDB();
    const rows = await database!.getAllAsync<any>(
      `SELECT l.* FROM depth_layers l
       JOIN cards c ON l.card_id = c.id JOIN decks d ON c.deck_id = d.id
       WHERE l.card_id = ? AND l.deleted_at IS NULL AND c.deleted_at IS NULL AND d.deleted_at IS NULL AND d.user_id = ?
       ORDER BY l.layer_number ASC`,
      [cardId, principal.id],
    );
    return isFlashcardPrincipalCurrent(principal) ? rows.map(decodeLayerRow) : [];
  },

  async insert(layer: DepthLayer): Promise<void> {
    assertDepthLayerRecord(layer);
    const principal = captureFlashcardPrincipal();
    if (Platform.OS === 'web') {
      await withWebDataMutation(principal, async () => {
        if (webData.depth_layers.some(candidate => candidate.id === layer.id)) throw new Error('A card page with this ID already exists.');
        const card = webData.cards.find(candidate => candidate.id === layer.card_id && webDeckBelongsTo(candidate.deck_id, principal.id));
        if (!card) throw new Error('The card no longer exists.');
        const existingCount = webData.depth_layers.filter(candidate => candidate.card_id === layer.card_id).length;
        if (layer.layer_number !== existingCount + 1) throw new Error('New card pages must be appended in sequence.');
        webData.depth_layers.push({ ...layer });
        card.total_layers = Math.max(card.total_layers, layer.layer_number);
        if (layer.is_unlocked) card.current_max_layer = Math.max(card.current_max_layer, layer.layer_number);
        await persistWebData();
      });
      return;
    }
    const database = await getDB();
    requireCurrentFlashcardPrincipal(principal);
    await database!.withExclusiveTransactionAsync(async tx => {
      requireCurrentFlashcardPrincipal(principal);
      const card = await tx.getFirstAsync<{ id: string; current_max_layer: number; total_layers: number }>(
        `SELECT c.id, c.current_max_layer, c.total_layers FROM cards c JOIN decks d ON c.deck_id = d.id
         WHERE c.id = ? AND c.deleted_at IS NULL AND d.user_id = ? AND d.deleted_at IS NULL`,
        [layer.card_id, principal.id],
      );
      if (!card) throw new Error('The card no longer exists.');
      const count = await tx.getFirstAsync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM depth_layers WHERE card_id = ? AND deleted_at IS NULL',
        [layer.card_id],
      );
      if (layer.layer_number !== (count?.count ?? 0) + 1) throw new Error('New card pages must be appended in sequence.');
      const duplicate = await tx.getFirstAsync<{ id: string }>(
        'SELECT id FROM depth_layers WHERE card_id = ? AND layer_number = ? AND deleted_at IS NULL',
        [layer.card_id, layer.layer_number],
      );
      if (duplicate) throw new Error(`Card page ${layer.layer_number} already exists.`);
      await tx.runAsync(
        'INSERT INTO depth_layers (id, card_id, layer_number, content, source, is_unlocked, unlocked_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [layer.id, layer.card_id, layer.layer_number, layer.content, layer.source, layer.is_unlocked ? 1 : 0, layer.unlocked_at || null],
      );
      await tx.runAsync(
        `UPDATE cards SET total_layers = MAX(total_layers, ?),
         current_max_layer = CASE WHEN ? = 1 THEN MAX(current_max_layer, ?) ELSE current_max_layer END
         WHERE id = ?`,
        [layer.layer_number, layer.is_unlocked ? 1 : 0, layer.layer_number, layer.card_id],
      );
    });
  },

  async updateUnlockedStatus(id: string, isUnlocked: boolean, unlockedAt: number): Promise<void> {
    if (typeof isUnlocked !== 'boolean') throw new Error('Card page unlock status must be a boolean.');
    if (!Number.isFinite(unlockedAt) || unlockedAt < 0) throw new Error('Card page unlock time is invalid.');
    const principal = captureFlashcardPrincipal();
    if (Platform.OS === 'web') {
      await withWebDataMutation(principal, async () => {
        const idx = webData.depth_layers.findIndex(l => l.id === id && webLayerBelongsTo(id, principal.id));
        if (idx < 0) throw new Error('The card page no longer exists.');
        const layer = webData.depth_layers[idx];
        const card = webData.cards.find(candidate => candidate.id === layer.card_id)!;
        if (isUnlocked && layer.layer_number > card.current_max_layer + 1) {
          throw new Error('Card pages must be unlocked in sequence.');
        }
        if (!isUnlocked && (layer.layer_number !== card.current_max_layer || card.current_max_layer <= 1)) {
          throw new Error('Only the last unlocked card page can be locked, and the first page must remain available.');
        }
        webData.depth_layers[idx].is_unlocked = isUnlocked;
        webData.depth_layers[idx].unlocked_at = isUnlocked ? unlockedAt : undefined;
        card.current_max_layer = isUnlocked
          ? Math.max(card.current_max_layer, layer.layer_number)
          : card.current_max_layer - 1;
        await persistWebData();
      });
      return;
    }
    const database = await getDB();
    requireCurrentFlashcardPrincipal(principal);
    await database!.withExclusiveTransactionAsync(async tx => {
      requireCurrentFlashcardPrincipal(principal);
      const layer = await tx.getFirstAsync<{ card_id: string; layer_number: number; current_max_layer: number }>(
        `SELECT l.card_id, l.layer_number, c.current_max_layer
         FROM depth_layers l JOIN cards c ON l.card_id = c.id JOIN decks d ON c.deck_id = d.id
         WHERE l.id = ? AND l.deleted_at IS NULL AND c.deleted_at IS NULL AND d.user_id = ? AND d.deleted_at IS NULL`,
        [id, principal.id],
      );
      if (!layer) throw new Error('The card page no longer exists.');
      if (isUnlocked && layer.layer_number > layer.current_max_layer + 1) {
        throw new Error('Card pages must be unlocked in sequence.');
      }
      if (!isUnlocked && (layer.layer_number !== layer.current_max_layer || layer.current_max_layer <= 1)) {
        throw new Error('Only the last unlocked card page can be locked, and the first page must remain available.');
      }
      await tx.runAsync(
        'UPDATE depth_layers SET is_unlocked = ?, unlocked_at = ? WHERE id = ?',
        [isUnlocked ? 1 : 0, isUnlocked ? unlockedAt : null, id],
      );
      await tx.runAsync(
        'UPDATE cards SET current_max_layer = ? WHERE id = ?',
        [isUnlocked ? Math.max(layer.current_max_layer, layer.layer_number) : layer.current_max_layer - 1, layer.card_id],
      );
    });
  },

  async updateLayerContent(id: string, content: string): Promise<void> {
    if (typeof content !== 'string' || content.length > 250_000) {
      throw new Error('Card pages must be 250,000 characters or fewer.');
    }
    const principal = captureFlashcardPrincipal();
    if (Platform.OS === 'web') {
      await withWebDataMutation(principal, async () => {
        const idx = webData.depth_layers.findIndex(l => l.id === id && webLayerBelongsTo(id, principal.id));
        if (idx < 0) throw new Error('The card page no longer exists.');
        webData.depth_layers[idx].content = content;
        await persistWebData();
      });
      return;
    }
    const database = await getDB();
    requireCurrentFlashcardPrincipal(principal);
    const result = await database!.runAsync(
      `UPDATE depth_layers SET content = ? WHERE id = ? AND deleted_at IS NULL
       AND EXISTS (
         SELECT 1 FROM cards c JOIN decks d ON c.deck_id = d.id
         WHERE c.id = depth_layers.card_id AND c.deleted_at IS NULL AND d.user_id = ? AND d.deleted_at IS NULL
       )`,
      [content, id, principal.id]
    );
    if (result.changes !== 1) throw new Error('The card page no longer exists.');
  },

  async addLayer(cardId: string, layerNumber: number, content: string): Promise<void> {
    if (!Number.isInteger(layerNumber) || layerNumber < 1 || layerNumber > 1_000) {
      throw new Error('Card page numbers must be integers from 1 to 1,000.');
    }
    if (typeof content !== 'string' || content.length > 250_000) throw new Error('Card pages must be strings of 250,000 characters or fewer.');
    const layerId = createEntityId('layer');
    const principal = captureFlashcardPrincipal();
    if (Platform.OS === 'web') {
      await withWebDataMutation(principal, async () => {
        const card = webData.cards.find(c => c.id === cardId && webDeckBelongsTo(c.deck_id, principal.id));
        if (!card) throw new Error('The card no longer exists.');
        const existingCount = webData.depth_layers.filter(layer => layer.card_id === cardId).length;
        if (layerNumber !== existingCount + 1) throw new Error('New card pages must be appended in sequence.');
        if (webData.depth_layers.some(layer => layer.card_id === cardId && layer.layer_number === layerNumber)) {
          throw new Error(`Card page ${layerNumber} already exists.`);
        }
        webData.depth_layers.push({
          id: layerId, card_id: cardId, layer_number: layerNumber, content, source: 'user', is_unlocked: true, unlocked_at: Date.now()
        });
        card.total_layers = Math.max(card.total_layers, layerNumber);
        card.current_max_layer = Math.max(card.current_max_layer, layerNumber);
        await persistWebData();
      });
      return;
    }
    const database = await getDB();
    requireCurrentFlashcardPrincipal(principal);
    await database!.withExclusiveTransactionAsync(async tx => {
      requireCurrentFlashcardPrincipal(principal);
      const card = await tx.getFirstAsync<{ id: string }>(
        `SELECT c.id FROM cards c JOIN decks d ON c.deck_id = d.id
         WHERE c.id = ? AND c.deleted_at IS NULL AND d.user_id = ? AND d.deleted_at IS NULL`,
        [cardId, principal.id],
      );
      if (!card) throw new Error('The card no longer exists.');
      const duplicate = await tx.getFirstAsync<{ id: string }>(
        'SELECT id FROM depth_layers WHERE card_id = ? AND layer_number = ? AND deleted_at IS NULL',
        [cardId, layerNumber],
      );
      if (duplicate) throw new Error(`Card page ${layerNumber} already exists.`);
      const count = await tx.getFirstAsync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM depth_layers WHERE card_id = ? AND deleted_at IS NULL',
        [cardId],
      );
      if (layerNumber !== (count?.count ?? 0) + 1) throw new Error('New card pages must be appended in sequence.');
      await tx.runAsync(
        'INSERT INTO depth_layers (id, card_id, layer_number, content, source, is_unlocked, unlocked_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [layerId, cardId, layerNumber, content, 'user', 1, Date.now()],
      );
      await tx.runAsync(
        'UPDATE cards SET total_layers = MAX(total_layers, ?), current_max_layer = MAX(current_max_layer, ?) WHERE id = ?',
        [layerNumber, layerNumber, cardId],
      );
    });
  },

  async deleteLastLayer(cardId: string): Promise<void> {
    const principal = captureFlashcardPrincipal();
    if (Platform.OS === 'web') {
      await withWebDataMutation(principal, async () => {
        const cardLayers = webData.depth_layers.filter(l => l.card_id === cardId);
        const card = webData.cards.find(c => c.id === cardId && webDeckBelongsTo(c.deck_id, principal.id));
        if (!card) throw new Error('The card no longer exists.');
        if (cardLayers.length <= 1) throw new Error('A card must keep at least one page.');
        const maxLayer = Math.max(...cardLayers.map(l => l.layer_number));
        webData.depth_layers = webData.depth_layers.filter(l => !(l.card_id === cardId && l.layer_number === maxLayer));
        card.total_layers = cardLayers.length - 1;
        card.current_max_layer = Math.min(card.current_max_layer, card.total_layers);
        await persistWebData();
      });
      return;
    }
    const database = await getDB();
    requireCurrentFlashcardPrincipal(principal);
    await database!.withExclusiveTransactionAsync(async tx => {
      requireCurrentFlashcardPrincipal(principal);
      const card = await tx.getFirstAsync<{ id: string }>(
        `SELECT c.id FROM cards c JOIN decks d ON c.deck_id = d.id
         WHERE c.id = ? AND c.deleted_at IS NULL AND d.user_id = ? AND d.deleted_at IS NULL`,
        [cardId, principal.id],
      );
      if (!card) throw new Error('The card no longer exists.');
      const layers = await tx.getAllAsync<{ id: string; layer_number: number }>(
        'SELECT id, layer_number FROM depth_layers WHERE card_id = ? AND deleted_at IS NULL ORDER BY layer_number DESC',
        [cardId],
      );
      if (layers.length <= 1) throw new Error('A card must keep at least one page.');
      const newTotal = layers.length - 1;
      await tx.runAsync('UPDATE depth_layers SET deleted_at = ? WHERE id = ?', [Date.now(), layers[0].id]);
      await tx.runAsync(
        'UPDATE cards SET total_layers = ?, current_max_layer = MIN(current_max_layer, ?) WHERE id = ?',
        [newTotal, newTotal, cardId],
      );
    });
  }
};

// ------------------------------------------------------------------
// Extended Note/Card Creation
// ------------------------------------------------------------------
export const EditorStore = {
  async updateCardContent(
    cardId: string,
    noteId: string,
    fieldValues: Record<string, string>,
    layers: string[],
  ): Promise<void> {
    const front = fieldValues.front ?? fieldValues.Front ?? '';
    if (typeof front !== 'string' || !front.trim()) throw new Error('A card front is required.');
    assertNoteFieldValues(fieldValues);
    if (!Array.isArray(layers) || layers.length < 1) throw new Error('A card must contain at least one page.');
    if (layers.length > 1_000) throw new Error('A card may contain at most 1,000 pages.');
    if ([front, ...layers].some(value => typeof value !== 'string' || value.length > 250_000)) {
      throw new Error('Card fronts and pages must be 250,000 characters or fewer.');
    }

    const now = Date.now();
    const principal = captureFlashcardPrincipal();
    if (Platform.OS === 'web') {
      await withWebDataMutation(principal, async () => {
        const card = webData.cards.find(candidate => candidate.id === cardId && !candidate.deleted_at && webDeckBelongsTo(candidate.deck_id, principal.id));
        const note = webData.notes.find(candidate => candidate.id === noteId && !candidate.deleted_at);
        if (!card || !note || card.note_id !== noteId) throw new Error('The card no longer exists.');

        const existingLayers = webData.depth_layers
          .filter(layer => layer.card_id === cardId && !layer.deleted_at)
          .sort((a, b) => a.layer_number - b.layer_number);
        const replacementLayers = layers.map((content, index): DepthLayer => {
          const existing = existingLayers[index];
          return existing
            ? { ...existing, layer_number: index + 1, content }
            : {
                id: createEntityId('layer'),
                card_id: cardId,
                layer_number: index + 1,
                content,
                source: 'user',
                is_unlocked: true,
                unlocked_at: now,
              };
        });

        note.field_values = { ...fieldValues };
        note.updated_at = now;
        webData.depth_layers = [
          ...webData.depth_layers.filter(layer => layer.card_id !== cardId),
          ...replacementLayers,
        ];
        card.total_layers = layers.length;
        card.current_max_layer = layers.length > existingLayers.length
          ? layers.length
          : Math.min(card.current_max_layer, layers.length);
        await persistWebData();
      });
      return;
    }

    const database = await getDB();
    requireCurrentFlashcardPrincipal(principal);
    await database!.withExclusiveTransactionAsync(async tx => {
      requireCurrentFlashcardPrincipal(principal);
      const card = await tx.getFirstAsync<{ note_id: string; current_max_layer: number }>(
        `SELECT c.note_id, c.current_max_layer
         FROM cards c
         JOIN notes n ON n.id = c.note_id
         JOIN decks d ON c.deck_id = d.id
         WHERE c.id = ? AND c.deleted_at IS NULL AND n.deleted_at IS NULL AND d.deleted_at IS NULL AND d.user_id = ?`,
        [cardId, principal.id],
      );
      if (!card || card.note_id !== noteId) throw new Error('The card no longer exists.');

      const existingLayers = await tx.getAllAsync<{ id: string; layer_number: number }>(
        'SELECT id, layer_number FROM depth_layers WHERE card_id = ? AND deleted_at IS NULL ORDER BY layer_number ASC',
        [cardId],
      );
      await tx.runAsync(
        'UPDATE notes SET field_values = ?, updated_at = ? WHERE id = ?',
        [JSON.stringify(fieldValues), now, noteId],
      );

      for (let index = 0; index < layers.length; index++) {
        const existing = existingLayers[index];
        if (existing) {
          await tx.runAsync(
            'UPDATE depth_layers SET layer_number = ?, content = ? WHERE id = ?',
            [index + 1, layers[index], existing.id],
          );
        } else {
          await tx.runAsync(
            `INSERT INTO depth_layers (id, card_id, layer_number, content, source, is_unlocked, unlocked_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [createEntityId('layer'), cardId, index + 1, layers[index], 'user', 1, now],
          );
        }
      }
      for (const obsolete of existingLayers.slice(layers.length)) {
        await tx.runAsync('UPDATE depth_layers SET deleted_at = ? WHERE id = ?', [now, obsolete.id]);
      }

      const currentMaxLayer = layers.length > existingLayers.length
        ? layers.length
        : Math.min(card.current_max_layer, layers.length);
      await tx.runAsync(
        'UPDATE cards SET total_layers = ?, current_max_layer = ? WHERE id = ?',
        [layers.length, currentMaxLayer, cardId],
      );
    });
  },

  async createCardsWithLayers(
    deckId: string,
    definitions: {
      frontContent: string;
      layers: string[];
      initialUnlockedLayers?: number;
      tags?: string[];
      additionalFields?: Record<string, string>;
    }[],
  ): Promise<{ cardId: string; noteId: string }[]> {
    if (typeof deckId !== 'string' || !deckId.trim()) throw new Error('A destination deck is required.');
    if (!Array.isArray(definitions) || definitions.length < 1 || definitions.length > 100_000) {
      throw new Error('Create between 1 and 100,000 cards at a time.');
    }

    const prepared = definitions.map(definition => {
      if (!definition || typeof definition !== 'object' || !Array.isArray(definition.layers)) {
        throw new Error('Every card definition must contain a page list.');
      }
      const initialUnlockedLayers = definition.initialUnlockedLayers ?? 1;
      if (typeof definition.frontContent !== 'string' || !definition.frontContent.trim()) throw new Error('A card front is required.');
      if (definition.layers.length < 1) throw new Error('A card must contain at least one page.');
      if (definition.layers.length > 1_000) throw new Error('A card may contain at most 1,000 pages.');
      if (!Number.isInteger(initialUnlockedLayers) || initialUnlockedLayers < 1) {
        throw new Error('The initial unlocked page count must be a positive integer.');
      }
      if ([definition.frontContent, ...definition.layers].some(value => typeof value !== 'string' || value.length > 250_000)) {
        throw new Error('Card fronts and pages must be 250,000 characters or fewer.');
      }
      if (definition.tags !== undefined && !Array.isArray(definition.tags)) throw new Error('Card tags must be a list.');
      if (definition.additionalFields !== undefined
        && (!definition.additionalFields || typeof definition.additionalFields !== 'object' || Array.isArray(definition.additionalFields))) {
        throw new Error('Additional card fields must be an object.');
      }
      const normalizedTags = Array.from(new Set(
        (definition.tags ?? []).map(tag => typeof tag === 'string' ? tag.trim().toLocaleLowerCase() : '').filter(Boolean),
      ));
      if (normalizedTags.length > 100 || normalizedTags.some(tag => tag.length > 100)) {
        throw new Error('A card can have at most 100 unique tags of 100 characters or fewer.');
      }
      const fieldValues = { ...(definition.additionalFields ?? {}), front: definition.frontContent };
      assertNoteFieldValues(fieldValues);
      return {
        cardId: createEntityId('card'),
        noteId: createEntityId('note'),
        layers: [...definition.layers],
        actualUnlocked: Math.min(initialUnlockedLayers, definition.layers.length),
        normalizedTags,
        fieldValues,
      };
    });
    const createdIds = prepared.map(({ cardId, noteId }) => ({ cardId, noteId }));
    const now = Date.now();
    const principal = captureFlashcardPrincipal();

    if (Platform.OS === 'web') {
      return withWebDataMutation(principal, async () => {
        if (!webDeckBelongsTo(deckId, principal.id)) {
          throw new Error('The destination deck no longer exists.');
        }
        const notes: Note[] = [];
        const cards: (Card & { tags?: string[] })[] = [];
        const depthLayers: DepthLayer[] = [];
        prepared.forEach((definition, cardIndex) => {
          const createdAt = now + cardIndex;
          notes.push({
            id: definition.noteId,
            note_type_id: 'default_type',
            field_values: definition.fieldValues,
            created_at: createdAt,
            updated_at: createdAt,
          });
          cards.push({
            id: definition.cardId,
            note_id: definition.noteId,
            deck_id: deckId,
            template_id: 'default_template',
            difficulty: 0,
            stability: 0,
            retrievability: 0,
            state: CardState.New,
            last_knob_value: 0,
            current_max_layer: definition.actualUnlocked,
            total_layers: definition.layers.length,
            due: createdAt,
            reps: 0,
            lapses: 0,
            learning_steps: 0,
            last_review: 0,
            created_at: createdAt,
            tags: definition.normalizedTags,
          });
          definition.layers.forEach((content, layerIndex) => {
            const isUnlocked = layerIndex < definition.actualUnlocked;
            depthLayers.push({
              id: createEntityId('layer'),
              card_id: definition.cardId,
              layer_number: layerIndex + 1,
              content,
              source: 'user',
              is_unlocked: isUnlocked,
              unlocked_at: isUnlocked ? createdAt : undefined,
            });
          });
        });
        webData.notes.push(...notes);
        webData.cards.push(...cards);
        webData.depth_layers.push(...depthLayers);
        await persistWebData();
        return createdIds;
      });
    }

    const database = await getDB();
    requireCurrentFlashcardPrincipal(principal);
    await database!.withExclusiveTransactionAsync(async tx => {
      requireCurrentFlashcardPrincipal(principal);
      const deck = await tx.getFirstAsync<{ id: string }>(
        'SELECT id FROM decks WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
        [deckId, principal.id],
      );
      if (!deck) throw new Error('The destination deck no longer exists.');

      for (let cardIndex = 0; cardIndex < prepared.length; cardIndex++) {
        const definition = prepared[cardIndex];
        const createdAt = now + cardIndex;
        await tx.runAsync(
          'INSERT INTO notes (id, note_type_id, field_values, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
          [definition.noteId, 'default_type', JSON.stringify(definition.fieldValues), createdAt, createdAt],
        );
        await tx.runAsync(
          `INSERT INTO cards (id, note_id, deck_id, template_id, difficulty, stability, retrievability, state, last_knob_value, current_max_layer, total_layers, due, reps, lapses, learning_steps, last_review, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [definition.cardId, definition.noteId, deckId, 'default_template', 0, 0, 0, CardState.New, 0, definition.actualUnlocked, definition.layers.length, createdAt, 0, 0, 0, 0, createdAt],
        );
        for (let layerIndex = 0; layerIndex < definition.layers.length; layerIndex++) {
          const isUnlocked = layerIndex < definition.actualUnlocked;
          await tx.runAsync(
            'INSERT INTO depth_layers (id, card_id, layer_number, content, source, is_unlocked, unlocked_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [createEntityId('layer'), definition.cardId, layerIndex + 1, definition.layers[layerIndex], 'user', isUnlocked ? 1 : 0, isUnlocked ? createdAt : null],
          );
        }
        for (const tagName of definition.normalizedTags) {
          const existing = await tx.getFirstAsync<{ id: string }>('SELECT id FROM tags WHERE name = ?', [tagName]);
          let tagId = existing?.id;
          if (!tagId) {
            tagId = createEntityId('tag');
            await tx.runAsync('INSERT INTO tags (id, name, color) VALUES (?, ?, ?)', [tagId, tagName, '#4A90E2']);
          }
          await tx.runAsync('INSERT INTO card_tags (card_id, tag_id) VALUES (?, ?)', [definition.cardId, tagId]);
        }
      }
    });
    return createdIds;
  },

  async createCardWithLayers(
    deckId: string,
    frontContent: string,
    layers: string[],
    initialUnlockedLayers: number = 1,
    tags: string[] = [],
    additionalFields: Record<string, string> = {},
  ): Promise<{cardId: string, noteId: string}> {
    const [created] = await EditorStore.createCardsWithLayers(deckId, [{
      frontContent,
      layers,
      initialUnlockedLayers,
      tags,
      additionalFields,
    }]);
    return created;
  }
};
