import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

import { CardState, ReviewSource, type Card, type Deck, type DepthLayer, type ReviewLog } from '../src/types';
import { setFlashcardPrincipal } from '../src/lib/db/principal';

type StoreModule = typeof import('../src/lib/db/store');

const WEB_DATA_KEY = 'flashcards:web-data:v1';

class MemoryAsyncStorage {
  readonly values = new Map<string, string>();
  failNextWrites = 0;
  writeCount = 0;

  async getItem(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.writeCount += 1;
    if (this.failNextWrites > 0) {
      this.failNextWrites -= 1;
      throw new Error('simulated quota failure');
    }
    this.values.set(key, value);
  }
}

const storage = new MemoryAsyncStorage();
(globalThis as typeof globalThis & { __flashcardStoreTestStorage?: MemoryAsyncStorage })
  .__flashcardStoreTestStorage = storage;

const stubUrls: Record<string, string> = {
  'react-native': 'flashcard-test:react-native',
  '@react-native-async-storage/async-storage': 'flashcard-test:async-storage',
  'expo-sqlite': 'flashcard-test:sqlite',
};
const stubSources: Record<string, string> = {
  'flashcard-test:react-native': 'export const Platform = { OS: "web" };',
  'flashcard-test:async-storage': 'export default globalThis.__flashcardStoreTestStorage;',
  'flashcard-test:sqlite': 'export {};',
};

const moduleHooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const url = stubUrls[specifier];
    return url ? { url, shortCircuit: true } : nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    const source = stubSources[url];
    return source ? { format: 'module', source, shortCircuit: true } : nextLoad(url, context);
  },
});

let importSequence = 0;
const loadFreshStore = async (): Promise<StoreModule> => {
  importSequence += 1;
  const url = new URL('../src/lib/db/store.ts', import.meta.url);
  url.searchParams.set('web-store-test', String(importSequence));
  return import(url.href) as Promise<StoreModule>;
};

const makeDeck = (id: string, userId: string, parentId?: string): Deck => ({
  id,
  user_id: userId,
  parent_id: parentId,
  name: `Deck ${id}`,
  description: `Description for ${id}`,
  settings: { nested: { retained: true } },
  position: 0,
  completed_once: false,
  created_at: Date.now(),
});

const makeReview = (
  card: Card,
  id: string,
  reviewedAt: number,
  overrides: Partial<Card> = {},
): { updated: Card; log: ReviewLog } => {
  const updated: Card = {
    ...card,
    state: CardState.Learning,
    difficulty: card.difficulty + 1,
    stability: card.stability + 1,
    retrievability: 1,
    last_knob_value: 70,
    reps: card.reps + 1,
    due: reviewedAt + 60_000,
    learning_steps: card.learning_steps + 1,
    last_review: reviewedAt,
    ...overrides,
  };
  return {
    updated,
    log: {
      id,
      card_id: card.id,
      knob_value: updated.last_knob_value,
      fsrs_rating: 3,
      elapsed_days: 0,
      scheduled_days: 1 / 1_440,
      state_before: card.state,
      state_after: updated.state,
      difficulty_before: card.difficulty,
      stability_before: card.stability,
      difficulty_after: updated.difficulty,
      stability_after: updated.stability,
      duration_ms: 1_000,
      depth_layer_shown: card.current_max_layer,
      review_source: ReviewSource.Session,
      reviewed_at: reviewedAt,
    },
  };
};

test('web flashcard store executes durable CRUD, isolation, queues, CAS, and rollback contracts', { concurrency: false }, async t => {
  storage.values.clear();
  storage.failNextWrites = 0;
  storage.writeCount = 0;
  setFlashcardPrincipal('qa-account-a');
  const stores = await loadFreshStore();
  const { CardStore, DeckStore, DepthLayerStore, EditorStore, ReviewLogStore } = stores;

  let rootDeck: Deck;
  let childDeck: Deck;
  let reviewCardId = '';
  let ordinaryCardIds: string[] = [];

  await t.test('empty reads and argument bounds fail safely', async () => {
    assert.deepEqual(await DeckStore.getAll(), []);
    assert.equal(await CardStore.getDueCardCount(), 0);
    assert.deepEqual(await CardStore.getAllDueCardsWithNotes(), []);
    assert.deepEqual(await ReviewLogStore.getStats(), {
      totalReviews: 0,
      retentionRate: 0,
      last7Days: (await ReviewLogStore.getStats()).last7Days,
      knobDistribution: [
        { range: '0-25 (Hard)', count: 0 },
        { range: '26-50 (Med)', count: 0 },
        { range: '51-75 (Good)', count: 0 },
        { range: '76-100 (Easy)', count: 0 },
      ],
    });
    assert.equal((await ReviewLogStore.getStats()).last7Days.length, 7);
    await assert.rejects(CardStore.getDueCards('missing', 0), /limits must be integers/);
    await assert.rejects(CardStore.getAllCardsForDeckWithNotes('missing', 50, -1), /offsets must be non-negative/);
    await assert.rejects(CardStore.getAllCardsForDeckWithNotes('missing', 10_001), /limits must be integers/);
    await assert.rejects(EditorStore.createCardsWithLayers('', [{ frontContent: 'x', layers: ['y'] }]), /destination deck/);
    await assert.rejects(EditorStore.createCardsWithLayers('missing', []), /Create between 1 and 100,000/);
    await assert.rejects(
      EditorStore.createCardsWithLayers('missing', new Array(100_001).fill({ frontContent: 'x', layers: ['y'] })),
      /Create between 1 and 100,000/,
    );
  });

  await t.test('deck hierarchy CRUD is cloned, durable, concurrent, and cycle-safe', async () => {
    rootDeck = makeDeck('qa-root-a', 'qa-account-a');
    childDeck = { ...makeDeck('qa-child-a', 'qa-account-a', rootDeck.id), position: 1 };
    await DeckStore.insert(rootDeck);
    await DeckStore.insert(childDeck);

    const returned = await DeckStore.getById(rootDeck.id);
    assert.ok(returned);
    (returned.settings.nested as { retained: boolean }).retained = false;
    assert.equal(((await DeckStore.getById(rootDeck.id))!.settings.nested as { retained: boolean }).retained, true);

    await assert.rejects(DeckStore.update({ ...rootDeck, parent_id: childDeck.id }), /descendants/);
    assert.equal((await DeckStore.getById(rootDeck.id))?.parent_id, undefined);
    rootDeck = { ...rootDeck, name: 'Updated root deck', settings: { updated: true } };
    await DeckStore.update(rootDeck);
    assert.equal((await DeckStore.getById(rootDeck.id))?.name, 'Updated root deck');

    const concurrentDecks = Array.from({ length: 8 }, (_, index) => ({
      ...makeDeck(`qa-concurrent-${index}`, 'qa-account-a'),
      position: index + 2,
    }));
    await Promise.all(concurrentDecks.map(deck => DeckStore.insert(deck)));
    assert.equal((await DeckStore.getAll()).length, 10);

    const duplicateResults = await Promise.allSettled([
      DeckStore.insert({ ...makeDeck('qa-duplicate', 'qa-account-a'), position: 20 }),
      DeckStore.insert({ ...makeDeck('qa-duplicate', 'qa-account-a'), position: 21 }),
    ]);
    assert.equal(duplicateResults.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(duplicateResults.filter(result => result.status === 'rejected').length, 1);
  });

  await t.test('account isolation covers decks, cards, notes, layers, stats, and cross-account parents', async () => {
    setFlashcardPrincipal('qa-account-b');
    const otherDeck = makeDeck('qa-root-b', 'qa-account-b');
    await DeckStore.insert(otherDeck);
    await assert.rejects(
      DeckStore.insert(makeDeck('qa-cross-parent', 'qa-account-b', rootDeck.id)),
      /parent deck no longer exists/,
    );
    const [{ cardId: otherCardId }] = await EditorStore.createCardsWithLayers(otherDeck.id, [{
      frontContent: 'Other account front',
      layers: ['Other account answer'],
    }]);
    assert.deepEqual((await DeckStore.getAll()).map(deck => deck.id), [otherDeck.id]);

    setFlashcardPrincipal('qa-account-a');
    assert.equal(await DeckStore.getById(otherDeck.id), null);
    assert.deepEqual(await CardStore.getCardsByDeck(otherDeck.id), []);
    assert.deepEqual(await DepthLayerStore.getByCard(otherCardId), []);
    await assert.rejects(CardStore.deleteCard(otherCardId), /no longer exists/);
    assert.equal((await DeckStore.getAll()).some(deck => deck.id === otherDeck.id), false);
  });

  await t.test('card, note, page, tag, reorder, pagination, due queue, and stats CRUD stays consistent', async () => {
    const created = await EditorStore.createCardsWithLayers(rootDeck.id, [
      {
        frontContent: 'Front one',
        layers: ['Layer one', 'Layer two'],
        initialUnlockedLayers: 2,
        tags: [' Biology ', 'biology', 'EXAM'],
        additionalFields: { hint: 'A hint' },
      },
      { frontContent: 'Front two', layers: ['Answer two'] },
      { frontContent: 'Front three', layers: ['Answer three'] },
    ]);
    ordinaryCardIds = created.map(item => item.cardId);
    const initial = await CardStore.getAllCardsForDeckWithNotes(rootDeck.id, 50);
    assert.equal(initial.length, 3);
    for (let index = 0; index < initial.length; index += 1) {
      const due = Date.now() - 10_000 - index;
      initial[index].card.due = due;
      await CardStore.updateCard({ ...initial[index].card, due });
    }
    assert.deepEqual(initial[0].card.tags, ['biology', 'exam']);
    assert.deepEqual(initial[0].note.field_values, { hint: 'A hint', front: 'Front one' });
    assert.deepEqual(initial[0].layers.map(layer => layer.content), ['Layer one', 'Layer two']);

    initial[0].note.field_values.front = 'Mutated outside';
    initial[0].layers[0].content = 'Mutated outside';
    initial[0].card.tags!.push('mutated');
    const clonedAgain = (await CardStore.getAllCardsForDeckWithNotes(rootDeck.id, 1))[0];
    assert.equal(clonedAgain.note.field_values.front, 'Front one');
    assert.equal(clonedAgain.layers[0].content, 'Layer one');
    assert.deepEqual(clonedAgain.card.tags, ['biology', 'exam']);

    await CardStore.updateNote(clonedAgain.note.id, { front: 'Edited front', hint: 'Edited hint' });
    await DepthLayerStore.updateLayerContent(clonedAgain.layers[0].id, 'Edited layer');
    await CardStore.updateCardTags(clonedAgain.card.id, ['  NEW ', 'new', 'Tag Two']);

    const appendedLayer: DepthLayer = {
      id: 'qa-appended-layer',
      card_id: clonedAgain.card.id,
      layer_number: 3,
      content: 'Appended locked layer',
      source: 'user',
      is_unlocked: false,
    };
    await DepthLayerStore.insert(appendedLayer);
    let edited = (await CardStore.getAllCardsForDeckWithNotes(rootDeck.id, 1))[0];
    assert.equal(edited.card.total_layers, 3);
    assert.equal(edited.card.current_max_layer, 2);
    assert.equal(edited.note.field_values.front, 'Edited front');
    assert.equal(edited.layers[0].content, 'Edited layer');
    assert.deepEqual(edited.card.tags, ['new', 'tag two']);
    await DepthLayerStore.updateUnlockedStatus(appendedLayer.id, true, Date.now());
    edited = (await CardStore.getAllCardsForDeckWithNotes(rootDeck.id, 1))[0];
    assert.equal(edited.card.current_max_layer, 3);
    assert.equal(edited.layers[2].is_unlocked, true);
    await assert.rejects(
      DepthLayerStore.updateUnlockedStatus(edited.layers[0].id, false, Date.now()),
      /Only the last unlocked/,
    );
    await DepthLayerStore.updateUnlockedStatus(appendedLayer.id, false, Date.now());
    edited = (await CardStore.getAllCardsForDeckWithNotes(rootDeck.id, 1))[0];
    assert.equal(edited.card.current_max_layer, 2);
    assert.equal(edited.layers[2].unlocked_at, undefined);
    await DepthLayerStore.deleteLastLayer(edited.card.id);

    const contentTarget = initial.find(item => item.card.id === ordinaryCardIds[1])!;
    await EditorStore.updateCardContent(
      contentTarget.card.id,
      contentTarget.note.id,
      { front: 'Inline edited front', extra: 'Inline field' },
      ['Inline page one', 'Inline page two'],
    );
    let contentEdited = (await CardStore.getAllCardsForDeckWithNotes(rootDeck.id, 50))
      .find(item => item.card.id === contentTarget.card.id)!;
    assert.equal(contentEdited.card.total_layers, 2);
    assert.deepEqual(contentEdited.layers.map(layer => layer.content), ['Inline page one', 'Inline page two']);
    await EditorStore.updateCardContent(
      contentEdited.card.id,
      contentEdited.note.id,
      { front: 'Inline edited again' },
      ['Only page'],
    );
    contentEdited = (await CardStore.getAllCardsForDeckWithNotes(rootDeck.id, 50))
      .find(item => item.card.id === contentTarget.card.id)!;
    assert.equal(contentEdited.card.total_layers, 1);
    assert.equal(contentEdited.card.current_max_layer, 1);
    edited = (await CardStore.getAllCardsForDeckWithNotes(rootDeck.id, 1))[0];
    assert.equal(edited.card.total_layers, 2);
    assert.equal(edited.layers.length, 2);
    await DepthLayerStore.addLayer(edited.card.id, 3, 'Added page');
    edited = (await CardStore.getAllCardsForDeckWithNotes(rootDeck.id, 1))[0];
    assert.equal(edited.card.current_max_layer, 3);
    assert.equal(edited.layers[2].content, 'Added page');
    await DepthLayerStore.deleteLastLayer(edited.card.id);

    const reversed = [...initial].reverse().map((item, position) => ({ id: item.card.id, position }));
    await CardStore.updatePositions(reversed);
    assert.deepEqual((await CardStore.getCardsByDeck(rootDeck.id)).map(card => card.id), reversed.map(item => item.id));
    const beforeFailedOrder = await CardStore.getCardsByDeck(rootDeck.id);
    await assert.rejects(
      CardStore.updatePositions([{ id: beforeFailedOrder[0].id, position: 99 }, { id: 'missing-card', position: 1 }]),
      /missing-card.*no longer exists/,
    );
    assert.deepEqual(
      (await CardStore.getCardsByDeck(rootDeck.id)).map(card => card.position),
      beforeFailedOrder.map(card => card.position),
    );
    await assert.rejects(
      CardStore.updatePositions([{ id: ordinaryCardIds[0], position: 1 }, { id: ordinaryCardIds[0], position: 2 }]),
      /unique card IDs/,
    );

    assert.equal((await CardStore.getAllCardsForDeckWithNotes(rootDeck.id, 2, 1)).length, 2);
    assert.equal((await CardStore.getDueCards(rootDeck.id, 2)).length, 2);
    assert.ok((await CardStore.getAllDueCardsWithNotes(50)).length >= 3);
    assert.ok((await CardStore.getDueCardsForDeckWithNotes(rootDeck.id, 50)).length >= 3);
    assert.equal((await CardStore.getStudyQueueWithNotes(rootDeck.id, 2)).length, 2);
    const dashboard = (await DeckStore.getAllWithStats()).find(deck => deck.id === rootDeck.id)!;
    assert.equal(dashboard.totalCount, 3);
    assert.equal(dashboard.newCount, 3);
    const detailed = await DeckStore.getDeckDetailedStats(rootDeck.id);
    assert.equal(detailed.totalCards, 3);
    assert.equal(detailed.newCards, 3);
    assert.equal(detailed.completionPercentage, 0);

    const disposable = await EditorStore.createCardWithLayers(rootDeck.id, 'Disposable', ['Disposable answer']);
    await CardStore.deleteCard(disposable.cardId);
    assert.equal(
      (await CardStore.getAllCardsForDeckWithNotes(rootDeck.id, 50)).some(item => item.card.id === disposable.cardId),
      false,
    );

    await assert.rejects(CardStore.updateCardTags(ordinaryCardIds[0], new Array(101).fill(0).map((_, i) => `tag-${i}`)), /at most 100/);
    await assert.rejects(CardStore.updateNote(edited.note.id, { front: 'x'.repeat(250_001) }), /250,000/);
    await assert.rejects(DepthLayerStore.updateLayerContent(edited.layers[0].id, 'x'.repeat(250_001)), /250,000/);
  });

  await t.test('failed storage writes and browser-size overflow roll back complete mutations', async () => {
    const beforeDeck = (await DeckStore.getById(rootDeck.id))!;
    storage.failNextWrites = 1;
    await assert.rejects(DeckStore.update({ ...beforeDeck, name: 'Must roll back' }), /could not be saved.*quota failure/);
    assert.equal((await DeckStore.getById(rootDeck.id))?.name, beforeDeck.name);

    const beforeCards = await CardStore.getAllCardsForDeckWithNotes(rootDeck.id, 10_000);
    const oversizedDefinitions = Array.from({ length: 17 }, (_, index) => ({
      frontContent: `Oversized ${index}`,
      layers: ['x'.repeat(250_000)],
    }));
    await assert.rejects(EditorStore.createCardsWithLayers(rootDeck.id, oversizedDefinitions), /exceeds the 4 MB/);
    assert.deepEqual(
      (await CardStore.getAllCardsForDeckWithNotes(rootDeck.id, 10_000)).map(item => item.card.id),
      beforeCards.map(item => item.card.id),
    );
  });

  await t.test('review transaction validates log linkage, page unlock, monotonic revision, and concurrent CAS', async () => {
    const { cardId } = await EditorStore.createCardWithLayers(
      childDeck.id,
      'Review front',
      ['Visible answer', 'Locked depth'],
      1,
    );
    reviewCardId = cardId;
    let item = (await CardStore.getAllCardsForDeckWithNotes(childDeck.id, 1))[0];
    const lockedLayer = item.layers[1];
    const first = makeReview(item.card, 'qa-review-1', Date.now() + 1_000, { current_max_layer: 2 });
    await assert.rejects(
      ReviewLogStore.recordReview(item.card.last_review, first.updated, { ...first.log, state_before: CardState.Review }, lockedLayer.id),
      /review log does not match/,
    );
    item = (await CardStore.getAllCardsForDeckWithNotes(childDeck.id, 1))[0];
    assert.equal(item.card.last_review, 0);
    assert.equal(item.layers[1].is_unlocked, false);

    await ReviewLogStore.recordReview(item.card.last_review, first.updated, first.log, lockedLayer.id);
    item = (await CardStore.getAllCardsForDeckWithNotes(childDeck.id, 1))[0];
    assert.equal(item.card.last_review, first.log.reviewed_at);
    assert.equal(item.card.current_max_layer, 2);
    assert.equal(item.layers[1].is_unlocked, true);
    await assert.rejects(
      ReviewLogStore.insert({ ...first.log, id: 'qa-duplicate-revision' }),
      /revision already has a review log/,
    );
    await assert.rejects(
      ReviewLogStore.insert({ ...first.log, id: 'qa-mismatched-log', reviewed_at: first.log.reviewed_at + 1 }),
      /does not match the current card revision/,
    );

    const duplicate = makeReview(item.card, first.log.id, item.card.last_review + 1_000);
    await assert.rejects(
      ReviewLogStore.recordReview(item.card.last_review, duplicate.updated, duplicate.log),
      /already been recorded/,
    );
    const forged = makeReview(item.card, 'qa-forged-review', item.card.last_review + 1_500, { total_layers: 99 });
    await assert.rejects(
      ReviewLogStore.recordReview(item.card.last_review, forged.updated, forged.log),
      /identity changed unexpectedly/,
    );
    const nonMonotonic = makeReview(item.card, 'qa-old-review', item.card.last_review);
    await assert.rejects(
      ReviewLogStore.recordReview(item.card.last_review, nonMonotonic.updated, nonMonotonic.log),
      /must advance/,
    );

    const concurrentA = makeReview(item.card, 'qa-review-concurrent-a', item.card.last_review + 2);
    const concurrentB = makeReview(item.card, 'qa-review-concurrent-b', item.card.last_review + 3);
    const results = await Promise.allSettled([
      ReviewLogStore.recordReview(item.card.last_review, concurrentA.updated, concurrentA.log),
      ReviewLogStore.recordReview(item.card.last_review, concurrentB.updated, concurrentB.log),
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected').length, 1);
    const activeQueue = await CardStore.getStudyQueueWithNotes(childDeck.id, 10);
    assert.equal(activeQueue.length, 1);
    assert.equal(activeQueue[0].card.id, reviewCardId);
    assert.ok(activeQueue[0].card.retrievability >= 0 && activeQueue[0].card.retrievability <= 1);
    const stats = await ReviewLogStore.getStats();
    assert.equal(stats.totalReviews, 2);
    assert.equal(stats.retentionRate, 100);
    assert.equal(stats.knobDistribution[2].count, 2);
    assert.equal(stats.last7Days.reduce((sum, day) => sum + day.count, 0), 2);
  });

  await t.test('reset and recursive delete cascade only owned dependent records', async () => {
    await DeckStore.resetDeckStats(childDeck.id);
    const reviewed = (await CardStore.getAllCardsForDeckWithNotes(childDeck.id, 10))[0];
    assert.equal(reviewed.card.id, reviewCardId);
    assert.equal(reviewed.card.state, CardState.New);
    assert.equal(reviewed.card.reps, 0);
    assert.equal(reviewed.card.last_review, 0);
    assert.equal((await ReviewLogStore.getStats()).totalReviews, 0);

    const deletedIds = await DeckStore.softDelete(rootDeck.id);
    assert.deepEqual(new Set(deletedIds), new Set([rootDeck.id, childDeck.id]));
    assert.equal(await DeckStore.getById(rootDeck.id), null);
    assert.equal(await DeckStore.getById(childDeck.id), null);
    assert.deepEqual(await CardStore.getCardsByDeck(rootDeck.id), []);
    assert.deepEqual(await DepthLayerStore.getByCard(reviewCardId), []);
    assert.equal(await CardStore.getDueCardCount(), 0);
    assert.deepEqual(await DeckStore.getAll(), (await DeckStore.getAll()).filter(deck => deck.id.startsWith('qa-concurrent') || deck.id === 'qa-duplicate'));
  });

  await t.test('durable snapshot reloads and corrupt stored data fails closed', async () => {
    const durableBefore = storage.values.get(WEB_DATA_KEY);
    assert.ok(durableBefore);
    const reloaded = await loadFreshStore();
    const reloadedDecks = await reloaded.DeckStore.getAll();
    assert.deepEqual(
      reloadedDecks.map(deck => deck.id).sort(),
      (await DeckStore.getAll()).map(deck => deck.id).sort(),
    );

    storage.values.set(WEB_DATA_KEY, '{"version":1,"data":{"decks":[]}}');
    const corruptStore = await loadFreshStore();
    await assert.rejects(corruptStore.DeckStore.getAll(), /missing cards/);
    storage.values.set(WEB_DATA_KEY, durableBefore);
  });

  await t.test('shared notes survive deletion of one referencing card and one referencing deck', async () => {
    const now = Date.now();
    const sharedFixture = {
      version: 1,
      data: {
        decks: [
          makeDeck('shared-root', 'qa-account-a'),
          makeDeck('shared-child', 'qa-account-a', 'shared-root'),
        ],
        notes: [{
          id: 'shared-note',
          note_type_id: 'default_type',
          field_values: { front: 'Shared front' },
          created_at: now,
          updated_at: now,
        }],
        cards: [
          {
            id: 'shared-root-card', note_id: 'shared-note', deck_id: 'shared-root', template_id: 'default_template',
            position: 0, difficulty: 0, stability: 0, retrievability: 0, state: CardState.New,
            last_knob_value: 0, current_max_layer: 1, total_layers: 1, due: now, reps: 0, lapses: 0,
            learning_steps: 0, last_review: 0, created_at: now,
          },
          {
            id: 'shared-child-card', note_id: 'shared-note', deck_id: 'shared-child', template_id: 'default_template',
            position: 0, difficulty: 0, stability: 0, retrievability: 0, state: CardState.New,
            last_knob_value: 0, current_max_layer: 1, total_layers: 1, due: now + 1, reps: 0, lapses: 0,
            learning_steps: 0, last_review: 0, created_at: now + 1,
          },
        ],
        depth_layers: [
          { id: 'shared-root-layer', card_id: 'shared-root-card', layer_number: 1, content: 'Root answer', source: 'user', is_unlocked: true, unlocked_at: now },
          { id: 'shared-child-layer', card_id: 'shared-child-card', layer_number: 1, content: 'Child answer', source: 'user', is_unlocked: true, unlocked_at: now },
        ],
        review_logs: [],
      },
    };
    storage.values.set(WEB_DATA_KEY, JSON.stringify(sharedFixture));
    const sharedStore = await loadFreshStore();
    await sharedStore.CardStore.deleteCard('shared-child-card');
    let surviving = await sharedStore.CardStore.getAllCardsForDeckWithNotes('shared-root', 10);
    assert.equal(surviving.length, 1);
    assert.equal(surviving[0].note.id, 'shared-note');

    storage.values.set(WEB_DATA_KEY, JSON.stringify(sharedFixture));
    const sharedDeckStore = await loadFreshStore();
    assert.deepEqual(await sharedDeckStore.DeckStore.softDelete('shared-child'), ['shared-child']);
    surviving = await sharedDeckStore.CardStore.getAllCardsForDeckWithNotes('shared-root', 10);
    assert.equal(surviving.length, 1);
    assert.equal(surviving[0].note.id, 'shared-note');
    await sharedDeckStore.DeckStore.softDelete('shared-root');
    assert.deepEqual(await sharedDeckStore.DeckStore.getAll(), []);
    assert.deepEqual(await sharedDeckStore.CardStore.getAllDueCardsWithNotes(), []);
  });
});

test('independent web runtimes coordinate writes and reload fresh durable data', async () => {
  storage.values.clear();
  setFlashcardPrincipal('qa-tabs');
  const a = await loadFreshStore();
  const b = await loadFreshStore();
  await Promise.all([a.DeckStore.getAll(), b.DeckStore.getAll()]);
  await Promise.all([
    a.DeckStore.insert(makeDeck('tab-a', 'qa-tabs')),
    b.DeckStore.insert(makeDeck('tab-b', 'qa-tabs')),
  ]);
  assert.deepEqual((await a.DeckStore.getAll()).map(deck => deck.id).sort(), ['tab-a', 'tab-b']);
  const c = await loadFreshStore();
  assert.equal((await c.DeckStore.getAll()).length, 2);
  await a.EditorStore.createCardWithLayers('tab-a', 'Review from either tab', ['Answer']);
  const card = (await b.CardStore.getAllCardsForDeckWithNotes('tab-a', 1))[0].card;
  const reviewA = makeReview(card, 'tab-review-a', Date.now() + 1_000);
  const reviewB = makeReview(card, 'tab-review-b', Date.now() + 2_000);
  const reviews = await Promise.allSettled([
    a.ReviewLogStore.recordReview(card.last_review, reviewA.updated, reviewA.log),
    b.ReviewLogStore.recordReview(card.last_review, reviewB.updated, reviewB.log),
  ]);
  assert.equal(reviews.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(reviews.filter(result => result.status === 'rejected').length, 1);
  assert.equal((await c.CardStore.getAllCardsForDeckWithNotes('tab-a', 1))[0].card.reps, 1);
  assert.equal((await c.ReviewLogStore.getStats()).totalReviews, 1);
  setFlashcardPrincipal('qa-other');
  await b.DeckStore.insert(makeDeck('other-principal', 'qa-other'));
  setFlashcardPrincipal('qa-tabs');
  await a.DeckStore.insert(makeDeck('tab-a-new', 'qa-tabs'));
  setFlashcardPrincipal('qa-other');
  assert.deepEqual((await c.DeckStore.getAll()).map(deck => deck.id), ['other-principal']);
});

test('web storage without origin locks permits export reads and rejects unsafe writes', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, 'locks');
  Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true });
  try {
    const stores = await loadFreshStore();
    assert.equal((await stores.DeckStore.getAll()).length, 1);
    await assert.rejects(stores.DeckStore.insert(makeDeck('unsafe', 'qa-other')), /Web Locks/);
  } finally {
    if (descriptor) Object.defineProperty(navigator, 'locks', descriptor);
    else Reflect.deleteProperty(navigator, 'locks');
  }
});

test.after(() => {
  moduleHooks.deregister();
  delete (globalThis as typeof globalThis & { __flashcardStoreTestStorage?: MemoryAsyncStorage })
    .__flashcardStoreTestStorage;
  setFlashcardPrincipal(null);
});
