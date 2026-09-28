/**
 * @fileoverview src/lib/studyKeyboard.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
export interface KeyboardEventTargetLike {
  tagName?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => unknown;
}

const INTERACTIVE_SELECTOR = [
  'input',
  'textarea',
  'select',
  'button',
  'a[href]',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="link"]',
  '[role="slider"]',
  '[role="spinbutton"]',
  '[role="adjustable"]',
].join(',');

/** Global study shortcuts must never override a focused form or widget. */
export function shouldIgnoreStudyShortcut(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false;
  const candidate = target as KeyboardEventTargetLike;
  if (candidate.isContentEditable) return true;

  const tagName = candidate.tagName?.toUpperCase();
  if (tagName && ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(tagName)) return true;

  if (typeof candidate.closest === 'function') {
    try {
      return Boolean(candidate.closest(INTERACTIVE_SELECTOR));
    } catch {
      // A non-DOM target may expose an incompatible closest method.
    }
  }
  return false;
}
