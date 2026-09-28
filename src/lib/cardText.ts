/**
 * @fileoverview src/lib/cardText.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
/** Produces a network-free, screen-reader-friendly preview for a card face. */
export function cardPlainText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return 'Blank card';
  return value
    .replace(/\[(IMAGE|VIDEO|AUDIO):[^\]]*\]/gi, (_match, kind: string) => `[${kind.toLowerCase()}]`)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_match, alt: string) => alt ? `[Image: ${alt}]` : '[Image]')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[`*_~>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim() || 'Blank card';
}
