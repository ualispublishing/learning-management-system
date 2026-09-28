/**
 * @fileoverview src/lib/flashcardLibrary.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import type { Card, Deck, DepthLayer, Note } from '../types';

export interface BrowsableCardItem {
  card: Card & { tags?: string[] };
  note: Note;
  layers: DepthLayer[];
}

export function filterDeckLibrary(decks: Deck[], query: string): Deck[] {
  const normalizedQuery = query.toLocaleLowerCase();
  return decks
    .filter(deck => (
      deck.settings.isTutorial !== true
      && deck.name.toLocaleLowerCase().includes(normalizedQuery)
    ))
    .sort((left, right) => {
      const showcaseDifference = Number(right.settings.isLearnShowcase === true)
        - Number(left.settings.isLearnShowcase === true);
      return showcaseDifference
        || left.position - right.position
        || left.created_at - right.created_at
        || left.id.localeCompare(right.id);
    });
}

export function listBrowsableCardTags(items: BrowsableCardItem[]): string[] {
  return Array.from(new Set(items.flatMap(item => item.card.tags ?? []))).sort((a, b) => a.localeCompare(b));
}

export function filterBrowsableCards(
  items: BrowsableCardItem[],
  query: string,
  selectedTag: string | null,
): BrowsableCardItem[] {
  const normalizedQuery = query.toLocaleLowerCase();
  return items.filter(item => {
    const front = (item.note.field_values.front ?? item.note.field_values.Front ?? '').toLocaleLowerCase();
    const fallbackBack = item.note.field_values.back ?? item.note.field_values.Back ?? '';
    const back = (item.layers.length > 0
      ? item.layers.map(layer => layer.content).join(' ')
      : fallbackBack).toLocaleLowerCase();
    const matchesSearch = front.includes(normalizedQuery) || back.includes(normalizedQuery);
    const matchesTag = selectedTag === null || (item.card.tags ?? []).includes(selectedTag);
    return matchesSearch && matchesTag;
  });
}

export function moveBrowsableCard(
  items: BrowsableCardItem[],
  cardId: string,
  offset: -1 | 1,
): BrowsableCardItem[] | null {
  const currentIndex = items.findIndex(item => item.card.id === cardId);
  const nextIndex = currentIndex + offset;
  if (currentIndex < 0 || nextIndex < 0 || nextIndex >= items.length) return null;
  const reordered = [...items];
  const [moved] = reordered.splice(currentIndex, 1);
  reordered.splice(nextIndex, 0, moved);
  return reordered;
}

export function buildCardPositionUpdates(items: BrowsableCardItem[]): { id: string; position: number }[] {
  return items.map((item, position) => ({ id: item.card.id, position }));
}

/**
 * Restores the order shown before a failed persistence attempt without dropping
 * cards that arrived from pagination or an inline create while the request ran.
 */
export function rollbackBrowsableCardOrder(
  previous: BrowsableCardItem[],
  current: BrowsableCardItem[],
): BrowsableCardItem[] {
  const currentById = new Map(current.map(item => [item.card.id, item]));
  const previousIds = new Set(previous.map(item => item.card.id));
  return [
    ...previous.flatMap(item => currentById.get(item.card.id) ? [currentById.get(item.card.id)!] : []),
    ...current.filter(item => !previousIds.has(item.card.id)),
  ];
}

export interface FlashcardActionLock {
  current: boolean;
}

export type ExclusiveFlashcardActionResult<T> =
  | { started: false }
  | { started: true; value: T };

/**
 * Runs one import/export action at a time. The lock is claimed synchronously so
 * two taps in the same render frame cannot both reach a file picker or write.
 */
export async function runExclusiveFlashcardAction<T>(
  lock: FlashcardActionLock,
  action: () => Promise<T>,
): Promise<ExclusiveFlashcardActionResult<T>> {
  if (lock.current) return { started: false };
  lock.current = true;
  try {
    return { started: true, value: await action() };
  } finally {
    lock.current = false;
  }
}
