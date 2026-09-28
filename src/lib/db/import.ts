/**
 * @fileoverview src/lib/db/import.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import { DeckStore, EditorStore } from './store';
import { parseFlashcardCSV } from './csv';
import { captureFlashcardPrincipal, isFlashcardPrincipalCurrent } from './principal';

export async function importCSV(deckId: string, csvContent: string): Promise<number> {
  const principal = captureFlashcardPrincipal();
  const parsedRows = parseFlashcardCSV(csvContent);

  if (parsedRows.length === 0) return 0;

  const deck = await DeckStore.getById(deckId);
  if (!deck || !isFlashcardPrincipalCurrent(principal)) throw new Error('The destination deck no longer exists for the active account.');

  await EditorStore.createCardsWithLayers(deckId, parsedRows.map(row => ({
    frontContent: row.front,
    layers: row.layers,
    initialUnlockedLayers: 1,
  })));

  return parsedRows.length;
}
