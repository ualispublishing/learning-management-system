/** Bounded, local extraction of UTF-8 source text. No URLs, OCR, model calls or rendering. */
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import type { ExtractedAISource } from './providerAdapter.server.ts';

export const TEXT_EXTRACTION_LIMITS = Object.freeze({
  fileBytes: 2_000_000, textCharacters: 500_000, lines: 20_000,
  segmentCharacters: 6000, segments: 10_000, totalSegmentCharacters: 1_000_000,
  cues: 10_000, captionWindowMs: 60_000,
});
export type TextSourceFormat = 'txt' | 'md' | 'vtt' | 'srt';
type ExtractionErrorCode = 'unsupported_format' | 'invalid_encoding' | 'size_limit' | 'invalid_captions' | 'empty_source' | 'type_mismatch' | 'invalid_metadata';
export class SourceExtractionError extends Error {
  readonly code: ExtractionErrorCode;
  constructor(code: ExtractionErrorCode, message: string) {
    super(message); this.name = 'SourceExtractionError'; this.code = code;
  }
}
export interface TextSourceExtraction {
  source: ExtractedAISource;
  extraction: {
    version: 'text-source.v1';
    format: TextSourceFormat;
    documentSha256: string;
    sourceSha256: string;
    segmentsSha256: string;
    byteLength: number;
    sourceLineCount: number;
    cueCount?: number;
    normalizations: string[];
    warnings: string[];
  };
}
interface Block { lines: string[]; firstLine: number }
interface Cue { text: string; start: number; end: number; firstLine: number; lastLine: number }
const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
function fail(code: SourceExtractionError['code'], message: string): never { throw new SourceExtractionError(code, message); }

function blocks(lines: string[]): Block[] {
  const result: Block[] = [];
  let current: Block | undefined;
  lines.forEach((line, i) => {
    if (!line.trim()) { current = undefined; return; }
    if (!current) { current = { lines: [], firstLine: i + 1 }; result.push(current); }
    current.lines.push(line);
  });
  return result;
}

function textSegments(lines: string[]): ExtractedAISource['segments'] {
  const result: ExtractedAISource['segments'] = [];
  for (const block of blocks(lines)) {
    let pending: string[] = [];
    let first = block.firstLine;
    let length = 0;
    const flush = () => {
      if (pending.length) result.push({ location: pending.length === 1 ? `Line ${first}` : `Lines ${first}–${first + pending.length - 1}`, text: pending.join('\n') });
      pending = []; length = 0;
    };
    block.lines.forEach((line, i) => {
      if (line.length > TEXT_EXTRACTION_LIMITS.segmentCharacters) {
        flush();
        // Overlap long-line fragments so a short evidence quote can cross a boundary.
        let start = 0;
        while (start < line.length) {
          let end = Math.min(start + TEXT_EXTRACTION_LIMITS.segmentCharacters, line.length);
          if (end < line.length && /[\uD800-\uDBFF]/.test(line[end - 1])) end -= 1;
          const fragment = line.slice(start, end);
          if (fragment.trim()) result.push({ location: `Line ${block.firstLine + i}, UTF-16 columns ${start + 1}–${end}`, text: fragment });
          if (end === line.length) break;
          start = end - 600;
          if (/[\uDC00-\uDFFF]/.test(line[start])) start -= 1;
        }
      } else {
        if (length + line.length + (pending.length ? 1 : 0) > TEXT_EXTRACTION_LIMITS.segmentCharacters) flush();
        if (!pending.length) first = block.firstLine + i;
        length += line.length + (pending.length ? 1 : 0);
        pending.push(line);
      }
    });
    flush();
  }
  return result;
}

function timestamp(raw: string, format: 'vtt' | 'srt', line: number): number {
  const match = (format === 'vtt'
    ? /^(?:(\d{2,6}):)?([0-5]\d):([0-5]\d)\.(\d{3})$/
    : /^(\d{2,6}):([0-5]\d):([0-5]\d),(\d{3})$/).exec(raw);
  if (!match) fail('invalid_captions', `Invalid ${format.toUpperCase()} timestamp at line ${line}.`);
  return ((Number(match[1] ?? 0) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000 + Number(match[4]);
}
function displayTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}

function captionCues(lines: string[], format: 'vtt' | 'srt', warnings: string[]): Cue[] {
  const parts = blocks(lines);
  const cues: Cue[] = [];
  const identifiers = new Set<string>();
  let ignoredBlocks = 0;
  let layoutSettings = 0;
  if (format === 'vtt') {
    const header = parts.shift();
    if (!header || header.firstLine !== 1 || !/^WEBVTT(?:[ \t][^\r\n]*)?$/.test(header.lines[0]) || header.lines.some(line => line.includes('-->'))) fail('invalid_captions', 'WebVTT requires a WEBVTT header followed by a blank line.');
    if (header.lines.some(line => /^X-TIMESTAMP-MAP\s*=/i.test(line.trim()))) fail('invalid_captions', 'WebVTT timestamp maps require media-aware extraction; they cannot be ignored.');
    if (header.lines.some(line => /^Kind:\s*metadata\s*$/i.test(line))) fail('invalid_captions', 'Timed metadata is not a caption transcript.');
    if (header.lines.length > 1) warnings.push('WebVTT header metadata was excluded from teaching text.');
  }
  for (const block of parts) {
    if (format === 'vtt' && /^NOTE(?:[ \t]|$)/.test(block.lines[0])) {
      if (block.lines.some(line => line.includes('-->'))) fail('invalid_captions', `Invalid WebVTT comment block at line ${block.firstLine}; check cue separators.`);
      ignoredBlocks += 1; continue;
    }
    if (format === 'vtt' && /^(STYLE|REGION)$/.test(block.lines[0])) {
      if (cues.length || block.lines.some(line => line.includes('-->'))) fail('invalid_captions', `Invalid WebVTT layout block at line ${block.firstLine}.`);
      ignoredBlocks += 1; continue;
    }
    const timingIndex = block.lines[0].includes('-->') ? 0 : 1;
    if (format === 'srt' && (timingIndex !== 1 || !/^\d{1,9}$/.test(block.lines[0]))) fail('invalid_captions', `SRT requires a numeric cue identifier at line ${block.firstLine}.`);
    if (timingIndex) {
      const id = format === 'srt' ? String(Number(block.lines[0])) : block.lines[0];
      if (!id.trim() || id.length > 160 || identifiers.has(id)) fail('invalid_captions', `Invalid or duplicate cue identifier at line ${block.firstLine}.`);
      identifiers.add(id);
    }
    const timing = /^([^ \t]+)[ \t]+-->[ \t]+([^ \t]+)(?:[ \t]+(.+))?$/.exec(block.lines[timingIndex] ?? '');
    const timingLine = block.firstLine + timingIndex;
    if (!timing || block.lines.length <= timingIndex + 1) fail('invalid_captions', `Missing timing or caption text at line ${timingLine}.`);
    const start = timestamp(timing[1], format, timingLine);
    const end = timestamp(timing[2], format, timingLine);
    if (end <= start || (cues.length && start < cues[cues.length - 1].start)) fail('invalid_captions', `Invalid or out-of-order caption interval at line ${timingLine}.`);
    if (timing[3]) {
      if (format === 'srt' || timing[3].length > 1000) fail('invalid_captions', `Unsupported caption timing settings at line ${timingLine}.`);
      const keys = new Set<string>();
      for (const setting of timing[3].split(/[ \t]+/)) {
        const match = /^(vertical|line|position|size|align|region):([^\s]+)$/.exec(setting);
        if (!match || keys.has(match[1])) fail('invalid_captions', `Invalid WebVTT cue setting at line ${timingLine}.`);
        keys.add(match[1]);
      }
      layoutSettings += 1;
    }
    const payload = block.lines.slice(timingIndex + 1);
    if (payload.some(line => line.includes('-->'))) fail('invalid_captions', `Unexpected timing arrow in caption text near line ${timingLine}; check cue separators.`);
    const text = payload.join('\n');
    if (text.length > TEXT_EXTRACTION_LIMITS.segmentCharacters) fail('size_limit', `Caption text at line ${timingLine} exceeds the per-cue limit.`);
    cues.push({ text, start, end, firstLine: block.firstLine, lastLine: block.firstLine + block.lines.length - 1 });
    if (cues.length > TEXT_EXTRACTION_LIMITS.cues) fail('size_limit', 'Caption cue count exceeds the extraction limit.');
  }
  if (!cues.length) fail('empty_source', 'No caption cues were found.');
  if (ignoredBlocks) warnings.push(`${ignoredBlocks} WebVTT comment/layout blocks were excluded from teaching text.`);
  if (layoutSettings) warnings.push(`Display-layout settings on ${layoutSettings} cues were excluded from teaching text; inspect the original captions when positioning affects meaning.`);
  if (cues.some(cue => /<[^>\n]+>|&(?:[A-Za-z][A-Za-z0-9]*|#\d+|#x[0-9a-f]+);/i.test(cue.text))) warnings.push('Caption markup and character references are preserved verbatim for source fidelity; review them against the original captions. They are never rendered or executed by this extractor.');
  return cues;
}

function captionSegments(cues: Cue[]): ExtractedAISource['segments'] {
  const segments: ExtractedAISource['segments'] = [];
  let first = 0;
  while (first < cues.length) {
    let last = first + 1;
    let text = cues[first].text;
    let end = cues[first].end;
    while (last < cues.length) {
      const cue = cues[last];
      if (text.length + cue.text.length + 1 > TEXT_EXTRACTION_LIMITS.segmentCharacters || Math.max(end, cue.end) - cues[first].start > TEXT_EXTRACTION_LIMITS.captionWindowMs) break;
      text += `\n${cue.text}`; end = Math.max(end, cue.end); last += 1;
    }
    segments.push({ location: `Cue${last - first > 1 ? `s ${first + 1}–${last}` : ` ${last}`} · ${displayTime(cues[first].start)}–${displayTime(end)} · lines ${cues[first].firstLine}–${cues[last - 1].lastLine}`, text });
    if (last === cues.length) break;
    first = last - first > 1 ? last - 1 : last;
  }
  return segments;
}

/** Call only after gateway authorization/upload scanning. Bytes, not filename, are hashed. */
export function extractTextSource(input: { bytes: Uint8Array; name: string; mimeType?: string; signal?: AbortSignal }): TextSourceExtraction {
  input.signal?.throwIfAborted();
  if (!(input.bytes instanceof Uint8Array) || !input.bytes.byteLength || input.bytes.byteLength > TEXT_EXTRACTION_LIMITS.fileBytes) fail('size_limit', 'Text extraction requires a nonempty file no larger than 2 MB.');
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 255 || /[\\/\x00-\x1F\x7F]/.test(input.name)) fail('invalid_metadata', 'Provide a valid source filename without a path.');
  const format = input.name.toLowerCase().match(/\.(txt|md|vtt|srt)$/)?.[1] as TextSourceFormat | undefined;
  if (!format) fail('unsupported_format', 'This extractor supports UTF-8 TXT, Markdown, VTT and SRT only. Other documents and media require a configured extraction worker.');
  const allowedMimes: Record<TextSourceFormat, string[]> = { txt: ['text/plain'], md: ['text/plain', 'text/markdown'], vtt: ['text/plain', 'text/vtt'], srt: ['text/plain', 'application/x-subrip'] };
  if (input.mimeType !== undefined) {
    if (typeof input.mimeType !== 'string' || input.mimeType.length > 160 || /[\r\n]/.test(input.mimeType)) fail('invalid_metadata', 'Invalid source content type.');
    const mime = input.mimeType.split(';', 1)[0].trim().toLowerCase();
    if (mime !== 'application/octet-stream' && !allowedMimes[format].includes(mime)) fail('type_mismatch', 'The source content type does not match its file extension.');
    const charset = /;\s*charset\s*=\s*"?([^;"\s]+)/i.exec(input.mimeType)?.[1];
    if (charset && !/^utf-?8$/i.test(charset)) fail('invalid_encoding', 'Convert the source to UTF-8 before extraction.');
  }
  let decoded: string;
  try { decoded = new TextDecoder('utf-8', { fatal: true }).decode(input.bytes); }
  catch { return fail('invalid_encoding', 'Source bytes are not valid UTF-8. Convert the text file before extraction.'); }
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(decoded) || decoded.trimStart().startsWith('%PDF-')) fail('type_mismatch', 'Binary or control-character content cannot be processed as text.');
  const normalizations: string[] = [];
  const warnings: string[] = [];
  if (input.bytes[0] === 0xef && input.bytes[1] === 0xbb && input.bytes[2] === 0xbf) normalizations.push('Removed the UTF-8 byte-order mark.');
  if (decoded.includes('\r')) { decoded = decoded.replace(/\r\n?/g, '\n'); normalizations.push('Normalized CRLF/CR line endings to LF.'); }
  if (decoded.length > TEXT_EXTRACTION_LIMITS.textCharacters) fail('size_limit', 'Source text exceeds 500000 characters; split it into separately reviewed documents.');
  if (!decoded.trim()) fail('empty_source', 'No source text was found.');
  const lines = decoded.split('\n');
  if (lines.length > TEXT_EXTRACTION_LIMITS.lines) fail('size_limit', 'Source line count exceeds the extraction limit.');
  let text = decoded;
  let segments: ExtractedAISource['segments'];
  let cueCount: number | undefined;
  if (format === 'vtt' || format === 'srt') {
    const cues = captionCues(lines, format, warnings);
    cueCount = cues.length;
    text = cues.map(cue => cue.text).join('\n');
    segments = captionSegments(cues);
    normalizations.push('Joined caption payloads with LF; kept source order, wording and cue locations.');
  } else {
    if (/^WEBVTT(?:[ \t\n]|$)/.test(decoded) || /^\d+\n\d{2,}:\d{2}:\d{2},\d{3}\s+-->/.test(decoded)) fail('type_mismatch', 'Caption content must use its VTT or SRT extension so timestamps are retained.');
    segments = textSegments(lines);
  }
  if (!segments.length) fail('empty_source', 'No source passages were found.');
  if (segments.length > TEXT_EXTRACTION_LIMITS.segments || segments.reduce((sum, segment) => sum + segment.text.length, 0) > TEXT_EXTRACTION_LIMITS.totalSegmentCharacters) fail('size_limit', 'Located source text exceeds the extraction limits; split the source.');
  input.signal?.throwIfAborted();
  const documentSha256 = digest(input.bytes);
  return { source: { text, segments, documentSha256 }, extraction: {
    version: 'text-source.v1', format, documentSha256, sourceSha256: digest(text), segmentsSha256: digest(JSON.stringify(segments)),
    byteLength: input.bytes.byteLength, sourceLineCount: lines.length, cueCount, normalizations, warnings,
  } };
}

/** Local maintenance/CLI helper; never pass an untrusted HTTP path to this function. */
export async function extractTextFile(filePath: string, options: { mimeType?: string; signal?: AbortSignal } = {}): Promise<TextSourceExtraction> {
  options.signal?.throwIfAborted();
  const file = await open(filePath, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const before = await file.stat();
    if (!before.isFile() || !before.size || before.size > TEXT_EXTRACTION_LIMITS.fileBytes) fail('size_limit', 'Select a nonempty regular file no larger than 2 MB.');
    const chunks: Buffer[] = [];
    let size = 0;
    while (true) {
      options.signal?.throwIfAborted();
      const chunk = Buffer.alloc(Math.min(65_536, TEXT_EXTRACTION_LIMITS.fileBytes - size + 1));
      const { bytesRead } = await file.read(chunk);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > TEXT_EXTRACTION_LIMITS.fileBytes) fail('size_limit', 'The source grew beyond the 2 MB extraction limit.');
      chunks.push(chunk.subarray(0, bytesRead));
    }
    const after = await file.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || size !== before.size) fail('invalid_metadata', 'The source changed during extraction; retry with a stable file.');
    return extractTextSource({ bytes: Buffer.concat(chunks), name: path.basename(filePath), mimeType: options.mimeType, signal: options.signal });
  } finally { await file.close(); }
}
