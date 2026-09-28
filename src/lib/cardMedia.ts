/**
 * @fileoverview src/lib/cardMedia.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import { canonicalSafeHttpsUrl } from './safeUrl';

export type CardMediaSource =
  | { kind: 'local'; filename: string }
  | { kind: 'remote'; uri: string; host: string }
  | { kind: 'invalid'; reason: string };

export type ResolvedCardMediaSource =
  | { kind: 'local'; uri: string }
  | { kind: 'remote'; uri: string; host: string }
  | { kind: 'invalid'; reason: string };

const SAFE_LOCAL_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/;

/**
 * Card media is either an app-owned filename or an HTTPS resource. Rejecting
 * paths and other schemes keeps imported decks from reading device files or
 * opening executable/custom URI handlers.
 */
export function classifyCardMediaUri(value: unknown): CardMediaSource {
  if (typeof value !== 'string') {
    return { kind: 'invalid', reason: 'Media address is missing.' };
  }

  const raw = value.trim();
  if (!raw || raw !== value || raw.length > 8192 || /[\u0000-\u001F\u007F]/.test(raw)) {
    return { kind: 'invalid', reason: 'Media address is invalid.' };
  }

  if (SAFE_LOCAL_FILENAME.test(raw) && !raw.includes('..')) {
    return { kind: 'local', filename: raw };
  }

  const uri = canonicalSafeHttpsUrl(raw);
  if (!uri) {
    return { kind: 'invalid', reason: 'Only app-owned media and HTTPS links are supported.' };
  }

  return { kind: 'remote', uri, host: new URL(uri).hostname };
}

export function resolveCardMediaUri(
  value: unknown,
  documentDirectory: string | null | undefined,
): ResolvedCardMediaSource {
  const source = classifyCardMediaUri(value);
  if (source.kind !== 'local') return source;
  if (!documentDirectory) {
    return { kind: 'invalid', reason: 'This local media file is not available on this device.' };
  }

  const base = documentDirectory.endsWith('/') ? documentDirectory : `${documentDirectory}/`;
  return { kind: 'local', uri: `${base}${source.filename}` };
}

/** Returns unsafe image/video/audio references found in card Markdown/tags. */
export function findInvalidCardMediaUris(value: unknown): string[] {
  if (typeof value !== 'string' || !value) return [];
  const references: string[] = [];
  const customMedia = /\[(?:IMAGE|VIDEO|AUDIO):([^\]]*)\]/gi;
  const markdownImages = /!\[[^\]]*\]\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = customMedia.exec(value)) !== null) references.push(match[1]);
  while ((match = markdownImages.exec(value)) !== null) references.push(match[1]);
  return [...new Set(references.filter(uri => classifyCardMediaUri(uri).kind === 'invalid'))];
}
