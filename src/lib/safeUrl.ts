/**
 * @fileoverview src/lib/safeUrl.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
export const canonicalSafeHttpsUrl = (value: unknown, maxLength = 8_192): string | null => {
  if (typeof value !== 'string' || !value || value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
};

export const isSafeHttpsUrl = (value: unknown, maxLength = 8_192): value is string =>
  canonicalSafeHttpsUrl(value, maxLength) !== null;
