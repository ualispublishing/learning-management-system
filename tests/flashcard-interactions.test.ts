import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

import { performAudioPlaybackAction } from '../src/lib/audio/playbackAction';
import {
  buildCardPositionUpdates,
  filterBrowsableCards,
  filterDeckLibrary,
  listBrowsableCardTags,
  moveBrowsableCard,
  rollbackBrowsableCardOrder,
  runExclusiveFlashcardAction,
} from '../src/lib/flashcardLibrary';
import { setFlashcardPrincipal } from '../src/lib/db/principal';
import { hasAccessibleTextContrast } from '../src/lib/color';
import type { Deck } from '../src/types';

class InteractionStorage {
  readonly values = new Map<string, string>();
  async getItem(key: string): Promise<string | null> { return this.values.get(key) ?? null; }
  async setItem(key: string, value: string): Promise<void> { this.values.set(key, value); }
}

const storage = new InteractionStorage();
(globalThis as typeof globalThis & { __flashcardInteractionStorage?: InteractionStorage })
  .__flashcardInteractionStorage = storage;

const stubUrls: Record<string, string> = {
  'react-native': 'interaction-test:react-native',
  '@react-native-async-storage/async-storage': 'interaction-test:async-storage',
  'expo-sqlite': 'interaction-test:sqlite',
};
const stubSources: Record<string, string> = {
  'interaction-test:react-native': 'export const Platform = { OS: "web" };',
  'interaction-test:async-storage': 'export default globalThis.__flashcardInteractionStorage;',
  'interaction-test:sqlite': 'export {};',
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

const deckFixture = (id: string, principal: string, name: string): Deck => ({
  id,
  user_id: principal,
  name,
  description: `${name} description`,
  settings: {},
  position: 0,
  completed_once: false,
  created_at: Date.now(),
});

test('library and card-browser clicks produce deterministic search, filter, move, and rollback outputs', () => {
  const tutorial = { ...deckFixture('tutorial', 'account-a', 'Tutorial'), settings: { isTutorial: true } };
  const algebra = deckFixture('algebra', 'account-a', 'Linear Algebra');
  const biology = deckFixture('biology', 'account-a', 'Biology');
  const showcase = {
    ...deckFixture('showcase', 'account-a', 'Programming Showcase'),
    settings: { isLearnShowcase: true },
    position: 99,
  };
  assert.deepEqual(filterDeckLibrary([tutorial, algebra, biology], 'ALG').map(deck => deck.id), ['algebra']);
  assert.deepEqual(filterDeckLibrary([tutorial, biology, showcase, algebra], '').map(deck => deck.id), ['showcase', 'algebra', 'biology']);

  const items = [
    {
      card: { id: 'one', tags: ['science', 'exam'] },
      note: { field_values: { front: 'Alpha prompt', back: 'Fallback answer' } },
      layers: [{ content: 'Primary answer' }],
    },
    {
      card: { id: 'two', tags: ['exam'] },
      note: { field_values: { Front: 'Beta prompt', Back: 'Beta answer' } },
      layers: [],
    },
  ] as unknown as Parameters<typeof filterBrowsableCards>[0];
  assert.deepEqual(listBrowsableCardTags(items), ['exam', 'science']);
  assert.deepEqual(filterBrowsableCards(items, 'PRIMARY', null).map(item => item.card.id), ['one']);
  assert.deepEqual(filterBrowsableCards(items, 'beta answer', 'exam').map(item => item.card.id), ['two']);
  assert.deepEqual(moveBrowsableCard(items, 'two', -1)?.map(item => item.card.id), ['two', 'one']);
  assert.equal(moveBrowsableCard(items, 'one', -1), null);
  assert.equal(moveBrowsableCard(items, 'missing', 1), null);
  assert.deepEqual(buildCardPositionUpdates(items), [{ id: 'one', position: 0 }, { id: 'two', position: 1 }]);
  const arrival = { ...items[0], card: { ...items[0].card, id: 'three' } };
  assert.deepEqual(
    rollbackBrowsableCardOrder(items, [items[1], arrival, items[0]]).map(item => item.card.id),
    ['one', 'two', 'three'],
  );
});

test('study reveal and quiz grade clicks enforce the same answer rule from every input surface', async () => {
  const { gradeQuizAnswer, requestStudyReveal } = await import('../src/lib/studySession');
  assert.deepEqual(requestStudyReveal('quiz'), {
    revealed: false,
    submittedAnswer: '',
    error: 'An answer is required before flipping in Quiz Mode.',
  });
  assert.deepEqual(requestStudyReveal('quiz', '   '), {
    revealed: false,
    submittedAnswer: '',
    error: 'An answer is required before flipping in Quiz Mode.',
  });
  assert.deepEqual(requestStudyReveal('quiz', 'My answer'), { revealed: true, submittedAnswer: 'My answer' });
  assert.deepEqual(requestStudyReveal('learn'), { revealed: true, submittedAnswer: '' });
  assert.deepEqual(requestStudyReveal('study'), { revealed: true, submittedAnswer: '' });
  assert.equal(gradeQuizAnswer(50), false);
  assert.equal(gradeQuizAnswer(50.01), true);
  assert.throws(() => gradeQuizAnswer(Number.NaN), /quiz score is invalid/);
  assert.throws(() => gradeQuizAnswer(101), /quiz score is invalid/);
});

test('rapid import/export clicks share one synchronous lock and release it after success or failure', async () => {
  const lock = { current: false };
  let releaseFirst!: () => void;
  const firstPending = new Promise<void>(resolve => { releaseFirst = resolve; });
  const calls: string[] = [];
  const first = runExclusiveFlashcardAction(lock, async () => {
    calls.push('import:start');
    await firstPending;
    calls.push('import:end');
    return 1;
  });
  const duplicateImport = await runExclusiveFlashcardAction(lock, async () => {
    calls.push('duplicate-import');
    return 2;
  });
  const overlappingExport = await runExclusiveFlashcardAction(lock, async () => {
    calls.push('overlapping-export');
    return 'csv';
  });
  assert.deepEqual(duplicateImport, { started: false });
  assert.deepEqual(overlappingExport, { started: false });
  assert.equal(lock.current, true);
  assert.deepEqual(calls, ['import:start']);

  releaseFirst();
  assert.deepEqual(await first, { started: true, value: 1 });
  assert.equal(lock.current, false);
  assert.deepEqual(calls, ['import:start', 'import:end']);

  await assert.rejects(
    runExclusiveFlashcardAction(lock, async () => { throw new Error('export failed'); }),
    /export failed/,
  );
  assert.equal(lock.current, false);
  assert.deepEqual(
    await runExclusiveFlashcardAction(lock, async () => 'retry csv'),
    { started: true, value: 'retry csv' },
  );
});

test('card audio click is lazy, replays completed media, pauses, and fails closed', async () => {
  const calls: string[] = [];
  const player = {
    pause: () => { calls.push('pause'); },
    replace: ({ uri }: { uri: string }) => { calls.push(`replace:${uri}`); },
    play: () => { calls.push('play'); },
    seekTo: async (position: number) => { calls.push(`seek:${position}`); },
  };
  assert.equal(calls.length, 0, 'remote media must not load before the user clicks play');
  const loaded = await performAudioPlaybackAction({
    player, playbackUri: 'https://media.example.edu/card.m4a', loadedUri: null, isPlaying: false, didJustFinish: false,
  });
  assert.equal(loaded, 'https://media.example.edu/card.m4a');
  assert.equal(calls.join('|'), 'replace:https://media.example.edu/card.m4a|play');

  calls.length = 0;
  await performAudioPlaybackAction({
    player, playbackUri: loaded!, loadedUri: loaded, isPlaying: false, didJustFinish: true,
  });
  assert.equal(calls.join('|'), 'seek:0|play');
  calls.length = 0;
  await performAudioPlaybackAction({
    player, playbackUri: loaded!, loadedUri: loaded, isPlaying: false, didJustFinish: false,
  });
  assert.equal(calls.join('|'), 'play', 'already loaded media must not be replaced');
  calls.length = 0;
  await performAudioPlaybackAction({
    player, playbackUri: loaded!, loadedUri: loaded, isPlaying: true, didJustFinish: false,
  });
  assert.equal(calls.join('|'), 'pause');

  calls.length = 0;
  await assert.rejects(
    performAudioPlaybackAction({
      player: { ...player, play: () => { calls.push('play'); throw new Error('decoder failed'); } },
      playbackUri: loaded!, loadedUri: loaded, isPlaying: false, didJustFinish: false,
    }),
    /decoder failed/,
  );
  assert.equal(calls.join('|'), 'play|pause');

  calls.length = 0;
  await assert.rejects(
    performAudioPlaybackAction({
      player, playbackUri: '', loadedUri: null, isPlaying: false, didJustFinish: false,
    }),
    /Invalid audio source/,
  );
  assert.equal(calls.join('|'), 'pause');

  calls.length = 0;
  await assert.rejects(
    performAudioPlaybackAction({
      player: { ...player, seekTo: async () => { calls.push('seek'); throw new Error('seek failed'); } },
      playbackUri: loaded!, loadedUri: loaded, isPlaying: false, didJustFinish: true,
    }),
    /seek failed/,
  );
  assert.equal(calls.join('|'), 'seek|pause');
});

test('headless flashcard journey executes the same CRUD, browse, import/export, study, retry, unlock, note, and isolation handlers', { concurrency: false }, async () => {
  storage.values.clear();
  setFlashcardPrincipal('account-a');
  const stores = await import('../src/lib/db/store');
  const study = await import('../src/lib/studySession');
  const { importCSV } = await import('../src/lib/db/import');
  const { exportToCSV } = await import('../src/lib/db/export');
  const { parseFlashcardCSV, serializeFlashcardCSV } = await import('../src/lib/db/csv');
  const { CardStore, DeckStore, DepthLayerStore, EditorStore, ReviewLogStore } = stores;
  const access = {
    getDeck: DeckStore.getById.bind(DeckStore),
    getAllDueCards: CardStore.getAllDueCardsWithNotes.bind(CardStore),
    getAllCards: CardStore.getAllCardsForDeckWithNotes.bind(CardStore),
    getStudyQueue: CardStore.getStudyQueueWithNotes.bind(CardStore),
    getLayers: DepthLayerStore.getByCard.bind(DepthLayerStore),
    recordReview: ReviewLogStore.recordReview.bind(ReviewLogStore),
    updateNote: CardStore.updateNote.bind(CardStore),
  };

  const deck = deckFixture('interaction-deck', 'account-a', 'Interaction Deck');
  await DeckStore.insert(deck);
  const created = await EditorStore.createCardsWithLayers(deck.id, [
    { frontContent: 'Alpha front', layers: ['Alpha answer', 'Alpha depth'], initialUnlockedLayers: 1, tags: ['science'] },
    { frontContent: 'Beta front', layers: ['Beta answer', 'Beta depth'], initialUnlockedLayers: 1, tags: ['exam'] },
    { frontContent: 'Gamma front', layers: ['Gamma answer'], tags: ['science', 'exam'] },
  ]);
  let browserItems = await CardStore.getAllCardsForDeckWithNotes(deck.id, 50);
  assert.deepEqual(listBrowsableCardTags(browserItems), ['exam', 'science']);
  assert.deepEqual(filterBrowsableCards(browserItems, 'BETA DEPTH', null).map(item => item.card.id), [created[1].cardId]);
  assert.deepEqual(filterBrowsableCards(browserItems, '', 'science').map(item => item.card.id), [created[0].cardId, created[2].cardId]);

  const moved = moveBrowsableCard(browserItems, created[2].cardId, -1);
  assert.ok(moved);
  await CardStore.updatePositions(buildCardPositionUpdates(moved));
  browserItems = await CardStore.getAllCardsForDeckWithNotes(deck.id, 50);
  assert.deepEqual(browserItems.map(item => item.card.id), [created[0].cardId, created[2].cardId, created[1].cardId]);
  const arrivedDuringFailedSave = { ...browserItems[0], card: { ...browserItems[0].card, id: 'new-arrival' } };
  assert.deepEqual(
    rollbackBrowsableCardOrder([browserItems[0], browserItems[1]], [browserItems[1], browserItems[0], arrivedDuringFailedSave]).map(item => item.card.id),
    [browserItems[0].card.id, browserItems[1].card.id, 'new-arrival'],
  );
  assert.equal(moveBrowsableCard(browserItems, browserItems[0].card.id, -1), null);

  const importedRows = [{ front: 'Imported, front', layers: ['Imported answer', 'Imported depth'] }];
  assert.equal(await importCSV(deck.id, serializeFlashcardCSV(importedRows)), 1);
  const exportedRows = parseFlashcardCSV(await exportToCSV(deck.id));
  assert.deepEqual(exportedRows.find(row => row.front === importedRows[0].front), importedRows[0]);

  const learn = await study.loadStudySession({
    deckId: deck.id, target: '2', mode: 'learn', startPosition: '2', group: 'all',
  }, access);
  const currentOrder = (await CardStore.getAllCardsForDeckWithNotes(deck.id, 50)).map(item => item.card.id);
  assert.deepEqual(learn.cards.map(item => item.card.id), currentOrder.slice(1, 3));
  await assert.rejects(
    study.loadStudySession({ deckId: deck.id, target: '1001', mode: 'study', startPosition: '1', group: 'all' }, access),
    /session size is invalid/,
  );
  await assert.rejects(
    study.loadStudySession({ deckId: deck.id, target: '2', mode: 'learn', startPosition: '0', group: 'all' }, access),
    /start position is invalid/,
  );

  const first = (await study.loadStudySession({
    deckId: deck.id, target: '1', mode: 'learn', startPosition: '1', group: 'all',
  }, access)).cards[0];
  const noteUpdated = await study.updateStudyLayerNote(first.note, 'Remember alpha', 'voice-note.m4a', -1, access);
  const depthUpdated = await study.updateStudyLayerNote(noteUpdated, 'Depth note', undefined, 0, access);
  assert.deepEqual(study.parseStudyLayerNotes(depthUpdated.field_values.layerNotes), {
    '-1': { text: 'Remember alpha', voiceUri: 'voice-note.m4a' },
    '0': { text: 'Depth note' },
  });
  const rereadNote = (await CardStore.getAllCardsForDeckWithNotes(deck.id, 1))[0].note;
  assert.equal(rereadNote.field_values.layerNotes, depthUpdated.field_values.layerNotes);
  await assert.rejects(study.updateStudyLayerNote(rereadNote, 'bad', undefined, 1000, access), /page is invalid/);
  const noteBeforeFailedSave = structuredClone(depthUpdated);
  await assert.rejects(
    study.updateStudyLayerNote(depthUpdated, 'Not persisted', undefined, 0, {
      updateNote: async () => { throw new Error('note storage offline'); },
    }),
    /note storage offline/,
  );
  assert.deepEqual(depthUpdated, noteBeforeFailedSave, 'a failed note click must not mutate the visible note object');

  const retryAt = Date.now() + 5_000;
  const firstBeforeFailedReview = structuredClone(first);
  await assert.rejects(
    study.commitStudyRating({
      item: first, rating: 75, durationMs: 100, now: retryAt - 1, reviewId: 'failed-review',
    }, {
      recordReview: async () => { throw new Error('review storage offline'); },
    }),
    /review storage offline/,
  );
  assert.deepEqual(first, firstBeforeFailedReview, 'a failed grade click must not mutate repository-owned session state');
  const retryResult = await study.commitStudyRating({
    item: { ...first, note: depthUpdated }, rating: 0, durationMs: 100_000, now: retryAt, reviewId: 'interaction-review-retry',
  }, access);
  assert.equal(retryResult.retry, true);
  assert.equal(retryResult.reviewedItem.card.last_review, retryAt);
  const queuedForRetry = study.applyStudyRatingResult([first], 0, retryResult);
  assert.deepEqual(queuedForRetry.map(item => item.card.id), [first.card.id, first.card.id]);
  assert.equal((await ReviewLogStore.getStats()).totalReviews, 1);
  await assert.rejects(
    study.commitStudyRating({ item: retryResult.reviewedItem, rating: -1, durationMs: 1, now: retryAt + 1 }, access),
    /between 0 and 100/,
  );
  assert.throws(() => study.applyStudyRatingResult([first], 1, retryResult), /no longer in this study session/);
  assert.throws(() => study.applyStudyRatingResult([first], 0, { ...retryResult, reviewedItem: learn.cards[0] }), /session changed/);

  const beta = (await CardStore.getAllCardsForDeckWithNotes(deck.id, 50)).find(item => item.card.id === created[1].cardId)!;
  const unlockAt = retryAt + 1_000;
  const unlockResult = await study.commitStudyRating({
    item: beta, rating: 100, durationMs: -50, now: unlockAt, reviewId: 'interaction-review-unlock',
  }, access);
  assert.equal(unlockResult.retry, false);
  assert.ok(unlockResult.unlockedLayerId);
  assert.equal(unlockResult.reviewedItem.card.current_max_layer, 2);
  assert.equal(unlockResult.reviewedItem.layers[1].is_unlocked, true);
  assert.deepEqual(study.applyStudyRatingResult([beta], 0, unlockResult), [unlockResult.reviewedItem]);
  assert.equal(study.gradeQuizAnswer(50), false);
  assert.equal(study.gradeQuizAnswer(100), true);

  const brokenPageItem = {
    ...beta,
    card: { ...beta.card, total_layers: 2, current_max_layer: 1 },
    layers: beta.layers.slice(0, 1),
  };
  await assert.rejects(
    study.commitStudyRating({ item: brokenPageItem, rating: 100, durationMs: 1, now: unlockAt + 1_000 }, access),
    /next card page no longer exists/,
  );

  await CardStore.updateNote(created[2].noteId, { front: 'Gamma front', layerNotes: '[]' });
  await assert.rejects(
    study.loadStudySession({ deckId: deck.id, target: 'all', mode: 'learn', startPosition: '1', group: 'all' }, access),
    /corrupt study-note data/,
  );
  await CardStore.updateNote(created[2].noteId, { front: 'Gamma front' });

  setFlashcardPrincipal('account-b');
  assert.deepEqual(await DeckStore.getAll(), []);
  await assert.rejects(
    study.loadStudySession({ deckId: deck.id, target: '1', mode: 'study', startPosition: '1', group: 'all' }, access),
    /deck no longer exists/,
  );
  await assert.rejects(importCSV(deck.id, serializeFlashcardCSV(importedRows)), /destination deck no longer exists/);
  await assert.rejects(exportToCSV(deck.id), /deck no longer exists/);

  setFlashcardPrincipal('account-a');
  await DeckStore.resetDeckStats(deck.id);
  assert.equal((await ReviewLogStore.getStats()).totalReviews, 0);
  assert.deepEqual(await DeckStore.softDelete(deck.id), [deck.id]);
  assert.deepEqual(await CardStore.getCardsByDeck(deck.id), []);
});

test('Learn showcase seeds four distinct, mode-compatible decks once per principal', { concurrency: false }, async () => {
  storage.values.clear();
  setFlashcardPrincipal('showcase-account-a');
  const { CardStore, DeckStore, DepthLayerStore, ReviewLogStore } = await import('../src/lib/db/store');
  const study = await import('../src/lib/studySession');
  const {
    LEARN_SHOWCASE_DEFINITIONS,
    PROGRAMMING_COURSE_VIDEO_URL,
    seedProgrammingCourseLearnDemo,
  } = await import('../src/lib/db/seedProgrammingCourse');

  const firstSeed = await seedProgrammingCourseLearnDemo();
  const secondSeed = await seedProgrammingCourseLearnDemo();
  assert.deepEqual(secondSeed, firstSeed, 'reloading Learn must reuse the same principal-owned showcase decks');
  assert.equal(firstSeed.length, 4);
  assert.ok(LEARN_SHOWCASE_DEFINITIONS.every(deck => (
    hasAccessibleTextContrast(deck.cardTextColor, deck.cardColor)
    && deck.cards.every(card => !card.color || (
      !!card.textColor && hasAccessibleTextContrast(card.textColor, card.color)
    ))
  )), 'every showcase color pairing must meet the app WCAG contrast rule');

  const accountADecks = (await DeckStore.getAll()).filter(deck => deck.settings.isLearnShowcase === true);
  assert.equal(accountADecks.length, 4);
  assert.deepEqual(
    accountADecks.map(deck => deck.settings.learnShowcaseKey).sort(),
    LEARN_SHOWCASE_DEFINITIONS.map(deck => deck.key).sort(),
  );
  assert.ok(accountADecks.every(deck => deck.user_id === 'showcase-account-a'));
  assert.ok(accountADecks.every(deck => deck.settings.cardColor && deck.settings.cardTextColor));

  const allItems = (await Promise.all(accountADecks.map(deck => (
    CardStore.getAllCardsForDeckWithNotes(deck.id, 10_000)
  )))).flat();
  assert.equal(allItems.length, 21);
  assert.ok(allItems.every(item => item.card.tags?.includes('showcase')));
  assert.ok(allItems.some(item => item.card.total_layers === 4 && item.card.current_max_layer === 1));
  assert.ok(allItems.some(item => item.card.current_max_layer === item.card.total_layers));
  assert.ok(allItems.some(item => item.note.field_values.layerNotes?.includes('seeded example note')));
  assert.ok(allItems.some(item => item.layers.some(layer => layer.content.includes(`[VIDEO:${PROGRAMMING_COURSE_VIDEO_URL}]`))));
  assert.ok(allItems.some(item => item.note.field_values.color === '#102A43' && item.note.field_values.textColor === '#FFFFFF'));

  const programmingDeck = accountADecks.find(deck => deck.settings.learnShowcaseKey === 'programming-concept-ladder')!;
  assert.deepEqual(programmingDeck.settings.lmsCourseIds, ['c1', 'c2']);
  assert.match(String(programmingDeck.settings.sourceLicense), /CC BY-NC-SA 4\.0/);
  const programmingItems = await CardStore.getAllCardsForDeckWithNotes(programmingDeck.id, 50);
  assert.equal(programmingItems.length, 6);
  assert.ok(listBrowsableCardTags(programmingItems).includes('programming'));
  assert.equal(filterBrowsableCards(programmingItems, 'invariant', 'reasoning').length, 1);

  const access = {
    getDeck: DeckStore.getById.bind(DeckStore),
    getAllDueCards: CardStore.getAllDueCardsWithNotes.bind(CardStore),
    getAllCards: CardStore.getAllCardsForDeckWithNotes.bind(CardStore),
    getStudyQueue: CardStore.getStudyQueueWithNotes.bind(CardStore),
    getLayers: DepthLayerStore.getByCard.bind(DepthLayerStore),
    recordReview: ReviewLogStore.recordReview.bind(ReviewLogStore),
    updateNote: CardStore.updateNote.bind(CardStore),
  };
  for (const mode of ['learn', 'study', 'quiz'] as const) {
    const session = await study.loadStudySession({
      deckId: programmingDeck.id, target: '2', mode, startPosition: '1', group: 'all',
    }, access);
    assert.equal(session.cards.length, 2, `${mode} should load showcase content through the production session path`);
  }
  const layeredItem = programmingItems.find(item => item.note.field_values.learnShowcaseCardKey === 'loop-invariant')!;
  const reviewed = await study.commitStudyRating({
    item: layeredItem,
    rating: 100,
    durationMs: 250,
    now: Date.now() + 10_000,
    reviewId: 'showcase-review',
  }, access);
  assert.equal(reviewed.reviewedItem.card.current_max_layer, 2);
  assert.ok(reviewed.unlockedLayerId);

  setFlashcardPrincipal('showcase-account-b');
  assert.deepEqual(await DeckStore.getAll(), []);
  assert.equal(await DeckStore.getById(programmingDeck.id), null);
  const accountBIds = await seedProgrammingCourseLearnDemo();
  assert.equal(accountBIds.length, 4);
  assert.ok(accountBIds.every(id => !firstSeed.includes(id)));
  assert.ok((await DeckStore.getAll()).every(deck => deck.user_id === 'showcase-account-b'));

  for (const id of accountBIds) await DeckStore.softDelete(id);
  setFlashcardPrincipal('showcase-account-a');
  for (const id of firstSeed) await DeckStore.softDelete(id);
  assert.deepEqual(await DeckStore.getAll(), []);
});

test.after(() => {
  moduleHooks.deregister();
  delete (globalThis as typeof globalThis & { __flashcardInteractionStorage?: InteractionStorage })
    .__flashcardInteractionStorage;
  setFlashcardPrincipal(null);
});
