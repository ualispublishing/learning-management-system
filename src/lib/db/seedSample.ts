/**
 * @fileoverview src/lib/db/seedSample.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import { CardStore, DeckStore, EditorStore } from './store';
import { Deck } from '../../types';
import { createEntityId } from '../id';
import { getFlashcardPrincipalId } from './principal';

const LEGACY_TUTORIAL_DECK_ID = 'tutorial_deck';
const TUTORIAL_VERSION = 2;

const tutorialCards = [
  {
    key: 'welcome',
    frontContent: 'Welcome to the Tutorial Deck! 🎉\n\nTap the screen to reveal the back.',
    layers: ['This is the back of a basic text card. It supports **Markdown** naturally.'],
    tags: ['basics'],
  },
  {
    key: 'formatting',
    frontContent: '# Formatting\n\nCan you remember the colors of the rainbow?',
    layers: ['Try formatting such as [Red Text](color:#EF4444), [Blue Text](color:#3B82F6), *italics*, and **bold**.'],
    tags: ['formatting'],
  },
  {
    key: 'layers',
    frontContent: 'What are the three common states of water?',
    layers: ['Ice (solid)', 'Water (liquid)', 'Water vapour (gas)'],
    tags: ['science', 'multi-page'],
  },
  {
    key: 'media-safety',
    frontContent: 'How should images, audio, and video be added to a production deck?',
    layers: [
      'Use the editor’s media controls so files are copied to durable app or institution-managed storage.',
      'Remote media should use an authorized HTTPS URL. Avoid random public hosts because availability, privacy, and licensing cannot be guaranteed.',
    ],
    tags: ['media', 'safety'],
  },
  {
    key: 'study-flow',
    frontContent: 'What happens after you rate a card?',
    layers: [
      'The FSRS scheduler updates the next due time using your rating.',
      'The card update, review history, and any newly unlocked page commit together so a failed save cannot leave partial progress.',
    ],
    tags: ['scheduling'],
  },
] as const;

export const tutorialDeckNeedsSeed = (deck?: Deck): boolean => !deck
  || deck.settings.tutorialVersion !== TUTORIAL_VERSION
  || (deck.totalCount ?? 0) < tutorialCards.length;

const tutorialSeedPromises = new Map<string, Promise<string>>();

const seedTutorialDeck = async (): Promise<string> => {
  const ownedDecks = await DeckStore.getAll();
  let deck = ownedDecks.find(candidate => candidate.settings.isTutorial === true);
  // Adopt the old app-owned deck once, but only when it belongs to the active
  // principal. New principals receive globally unique IDs.
  if (!deck) deck = await DeckStore.getById(LEGACY_TUTORIAL_DECK_ID) ?? undefined;
  if (!deck) {
    const newDeck: Deck = {
      id: createEntityId('tutorial'),
      user_id: getFlashcardPrincipalId(),
      name: '🚀 Tutorial Deck',
      description: 'A safe local tutorial for formatting, multi-page cards, media handling, and review scheduling.',
      position: 0,
      completed_once: false,
      created_at: Date.now(),
      settings: {
        cardColor: '#E3F2FD',
        cardTextColor: '#0F172A',
        isTutorial: true,
        tutorialVersion: TUTORIAL_VERSION,
      },
    };
    await DeckStore.insert(newDeck);
    deck = newDeck;
  } else if (deck.settings.tutorialVersion !== TUTORIAL_VERSION) {
    // This fixed-ID deck is app-owned. Version upgrades remove old tutorial
    // content (including prior third-party media examples) and are restart-safe:
    // the version advances only after every old card has been removed.
    const oldCards = await CardStore.getAllCardsForDeckWithNotes(deck.id, 10_000);
    for (const { card } of oldCards) await CardStore.deleteCard(card.id);
    deck = {
      ...deck,
      name: '🚀 Tutorial Deck',
      description: 'A safe local tutorial for formatting, multi-page cards, media handling, and review scheduling.',
      position: 0,
      settings: {
        ...deck.settings,
        cardColor: '#E3F2FD',
        cardTextColor: '#0F172A',
        isTutorial: true,
        tutorialVersion: TUTORIAL_VERSION,
      },
    };
    await DeckStore.update(deck);
  }

  if (deck.settings.isTutorial !== true) {
    deck = { ...deck, settings: { ...deck.settings, isTutorial: true } };
    await DeckStore.update(deck);
  }

  const existing = await CardStore.getAllCardsForDeckWithNotes(deck.id, 10_000);
  const existingKeys = new Set(existing.map(({ note }) => note.field_values.tutorialKey).filter(Boolean));
  const missing = tutorialCards.filter(card => !existingKeys.has(card.key));
  if (missing.length) {
    await EditorStore.createCardsWithLayers(deck.id, missing.map(card => ({
      frontContent: card.frontContent,
      layers: [...card.layers],
      initialUnlockedLayers: 1,
      tags: [...card.tags],
      additionalFields: { tutorialKey: card.key },
    })));
  }

  return deck.id;
};

export function generateSampleDeck(): Promise<string> {
  const principalId = getFlashcardPrincipalId();
  const existing = tutorialSeedPromises.get(principalId);
  if (existing) return existing;
  const pending = seedTutorialDeck().finally(() => {
    if (tutorialSeedPromises.get(principalId) === pending) tutorialSeedPromises.delete(principalId);
  });
  tutorialSeedPromises.set(principalId, pending);
  return pending;
}
