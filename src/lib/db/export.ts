/**
 * @fileoverview src/lib/db/export.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import { CardStore, DeckStore } from './store';
import { FlashcardCSVRow, MAX_CSV_ROWS, serializeFlashcardCSV } from './csv';

export async function exportToCSV(deckId: string): Promise<string> {
  const deck = await DeckStore.getById(deckId);
  if (!deck) throw new Error('The deck no longer exists.');

  const batchSize = 500;
  const rows: FlashcardCSVRow[] = [];
  for (let offset = 0; ; offset += batchSize) {
    const batch = await CardStore.getAllCardsForDeckWithNotes(deckId, batchSize, offset);
    for (const item of batch) {
      const front = item.note.field_values.front ?? item.note.field_values.Front ?? '';
      rows.push({
        front: String(front),
        layers: item.layers.map(layer => layer.content),
      });
      if (rows.length > MAX_CSV_ROWS) {
        throw new Error(`Decks with more than ${MAX_CSV_ROWS.toLocaleString()} cards cannot be exported to CSV.`);
      }
    }
    if (batch.length < batchSize) break;
  }

  return serializeFlashcardCSV(rows);
}
