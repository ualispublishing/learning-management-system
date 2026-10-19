import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { extractTextFile, extractTextSource, SourceExtractionError, TEXT_EXTRACTION_LIMITS } from '../src/lib/ai/textExtraction.server';
import { runAIProvider, sha256 } from '../src/lib/ai/providerAdapter.server';
import { validateCards, validateInstitutionSyllabusResult } from '../src/lib/ai/service';

const extract = (text: string, name = 'source.txt', mimeType?: string) => extractTextSource({ bytes: Buffer.from(text), name, mimeType });
const code = (expected: SourceExtractionError['code']) => (error: unknown) => error instanceof SourceExtractionError && error.code === expected;

test('text extraction preserves Unicode, punctuation and line references with auditable normalization', () => {
  const bytes = Buffer.from('\uFEFF# Mathematics\r\n\r\nA ≤ B; do not invert the inequality.\r\nUse π, café and 数学.\r\n');
  const result = extractTextSource({ bytes, name: 'notes.MD', mimeType: 'text/markdown; charset=UTF-8' });
  assert.equal(result.source.text, '# Mathematics\n\nA ≤ B; do not invert the inequality.\nUse π, café and 数学.\n');
  assert.deepEqual(result.source.segments, [
    { location: 'Line 1', text: '# Mathematics' },
    { location: 'Lines 3–4', text: 'A ≤ B; do not invert the inequality.\nUse π, café and 数学.' },
  ]);
  assert.equal(result.source.documentSha256, sha256(bytes));
  assert.equal(result.extraction.sourceSha256, sha256(result.source.text));
  assert.equal(result.extraction.segmentsSha256, sha256(JSON.stringify(result.source.segments)));
  assert.equal(result.extraction.normalizations.length, 2);
  assert.deepEqual(extractTextSource({ bytes, name: 'renamed.md' }), result, 'renaming does not affect extraction or hashes');
});

test('long lines remain bounded and overlapping without splitting surrogate pairs or losing evidence', () => {
  const text = `${'x'.repeat(5999)}😀${'y'.repeat(200)} Evidence across a split. ${'z'.repeat(9000)}`;
  const result = extract(text);
  assert.equal(result.source.text, text);
  assert.ok(result.source.segments.some(segment => segment.text.includes('😀' + 'y'.repeat(200))));
  for (const segment of result.source.segments) {
    assert.ok(segment.text.length <= TEXT_EXTRACTION_LIMITS.segmentCharacters);
    assert.ok(text.includes(segment.text));
    assert.equal(/[\uD800-\uDBFF]$/.test(segment.text), false);
    assert.equal(/^[\uDC00-\uDFFF]/.test(segment.text), false);
    assert.match(segment.location, /UTF-16 columns/);
  }
  assert.equal(result.source.segments.at(-1)?.text.endsWith('z'.repeat(100)), true);
  const paddedText = `${' '.repeat(15_000)}Keep this statement.${' '.repeat(15_000)}`;
  const padded = extract(paddedText);
  assert.equal(padded.source.text, paddedText);
  assert.ok(padded.source.segments.every(segment => segment.text.trim()), 'whitespace-only fragments cannot serve as provider evidence');
  assert.ok(padded.source.segments.some(segment => segment.text.includes('Keep this statement.')));
});

test('WebVTT preserves cue wording, overlapping timing and readable context while excluding comments/layout', () => {
  const text = 'WEBVTT\n\nNOTE\nDo not teach this comment.\n\nSTYLE\n::cue { color: red; }\n\nfirst\n00:00.000 --> 00:04.000 align:start\nDeclarative knowledge\nmeans statements of fact.\n\nsecond\n00:03.000 --> 00:05.000\nImperative knowledge describes how to do something.\n';
  const result = extract(text, 'lesson.vtt', 'text/vtt');
  assert.equal(result.extraction.cueCount, 2);
  assert.equal(result.source.text, 'Declarative knowledge\nmeans statements of fact.\nImperative knowledge describes how to do something.');
  assert.equal(result.source.text.includes('Do not teach'), false);
  assert.equal(result.source.segments[0].location, 'Cues 1–2 · 00:00:00.000–00:00:05.000 · lines 9–16');
  assert.ok(result.extraction.warnings.some(warning => warning.includes('2 WebVTT')));
  assert.ok(result.extraction.warnings.some(warning => warning.includes('Display-layout')));
});

test('caption grouping bridges windows and retains the longest end when cues overlap', () => {
  const result = extract('WEBVTT\n\n00:00.000 --> 00:50.000\nLong cue.\n\n00:10.000 --> 00:11.000\nShort cue.\n\n00:55.000 --> 01:05.000\nNext idea.\n', 'overlap.vtt');
  assert.equal(result.source.segments.length, 2);
  assert.match(result.source.segments[0].location, /00:00:00\.000–00:00:50\.000/);
  assert.equal(result.source.segments[1].text, 'Short cue.\nNext idea.');
  for (const segment of result.source.segments) assert.ok(result.source.text.includes(segment.text));
});

test('SRT keeps multiline captions, precise milliseconds and verbatim markup as untrusted text', () => {
  const result = extract('1\r\n01:02:03,004 --> 01:02:05,006\r\n<i>Not</i> all values are equal.\r\nA &lt; B.\r\n\r\n2\r\n01:02:05,006 --> 01:02:08,000\r\nKeep the qualification.\r\n', 'lesson.srt', 'application/x-subrip');
  assert.equal(result.extraction.cueCount, 2);
  assert.match(result.source.segments[0].location, /01:02:03\.004–01:02:08\.000/);
  assert.equal(result.source.text, '<i>Not</i> all values are equal.\nA &lt; B.\nKeep the qualification.');
  assert.ok(result.extraction.warnings.some(warning => warning.includes('preserved verbatim')));
});

test('malformed caption files fail rather than silently discarding invalid or untimed passages', () => {
  for (const text of [
    '00:00.000 --> 00:01.000\nMissing header.',
    'WEBVTT\n00:00.000 --> 00:01.000\nMissing separator.',
    'WEBVTT\nX-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:900000\n\n00:00.000 --> 00:01.000\nShifted.',
    'WEBVTT\n\n00:61.000 --> 00:62.000\nBad minute.',
    'WEBVTT\n\n00:01.000 --> 00:00.000\nBackwards.',
    'WEBVTT\n\n00:01.000 --> 00:01.000\nZero duration.',
    'WEBVTT\n\n00:02.000 --> 00:03.000\nFirst.\n\n00:01.000 --> 00:04.000\nOut of order.',
    'WEBVTT\n\nsame\n00:00.000 --> 00:01.000\nFirst.\n\nsame\n00:01.000 --> 00:02.000\nDuplicate.',
    'WEBVTT\n\n00:00.000 --> 00:01.000\nFirst.\n00:01.000 --> 00:02.000\nMissing separator.',
    'WEBVTT\n\nNOTE\nA comment.\n00:00.000 --> 00:01.000\nA swallowed cue.',
    'WEBVTT\n\n00:00.000 --> 00:01.000\nFirst.\nmalformed --> 00:02.000\nA malformed cue.',
    'WEBVTT\n\n00:00.000 --> 00:01.000',
    'WEBVTT\n\nA paragraph with no timing.',
    'WEBVTT\n\n00:00.000 --> 00:01.000 align:start align:end\nRepeated setting.',
    'WEBVTT\n\n00:00.000 --> 00:01.000\nFirst.\n\nSTYLE\n::cue { color: red; }',
  ]) assert.throws(() => extract(text, 'bad.vtt'), code('invalid_captions'));
  for (const text of [
    '00:00:00,000 --> 00:00:01,000\nNo index.',
    '1\n00:00:00.000 --> 00:00:01.000\nWrong separator.',
    '1\n00:00:00,000 --> 00:00:01,000\nFirst.\n\n01\n00:00:01,000 --> 00:00:02,000\nDuplicate index.',
  ]) assert.throws(() => extract(text, 'bad.srt'), code('invalid_captions'));
});

test('text extraction rejects binary disguise, unsupported formats and invalid encodings', () => {
  assert.throws(() => extract('%PDF-1.7\nPretend text', 'renamed.txt'), code('type_mismatch'));
  assert.throws(() => extract('PK\x03\x04 archive', 'renamed.txt'), code('type_mismatch'));
  assert.throws(() => extract('Any bytes', 'slides.pptx'), code('unsupported_format'));
  assert.throws(() => extract('Any bytes', 'notes.txt', 'application/pdf'), code('type_mismatch'));
  assert.throws(() => extract('Any bytes', '../notes.txt'), code('invalid_metadata'));
  assert.throws(() => extract('Any bytes', 'notes.txt', 'text/plain; charset=iso-8859-1'), code('invalid_encoding'));
  assert.throws(() => extractTextSource({ bytes: Buffer.from([0xff, 0xfe, 0x61, 0]), name: 'utf16.txt' }), code('invalid_encoding'));
  assert.throws(() => extractTextSource({ bytes: Buffer.from([0xc3, 0x28]), name: 'invalid.txt' }), code('invalid_encoding'));
  assert.throws(() => extract('WEBVTT\n\n00:00.000 --> 00:01.000\nCaption.', 'renamed.txt'), code('type_mismatch'));
  assert.throws(() => extract('1\n00:00:00,000 --> 00:00:01,000\nCaption.', 'renamed.txt'), code('type_mismatch'));
});

test('extraction size, line and per-cue limits reject the whole input without partial output', () => {
  assert.throws(() => extractTextSource({ bytes: new Uint8Array(2_000_001), name: 'large.txt' }), code('size_limit'));
  assert.throws(() => extract('x'.repeat(500_001)), code('size_limit'));
  assert.throws(() => extract('x\n'.repeat(20_000)), code('size_limit'));
  assert.throws(() => extract('WEBVTT\n\n00:00.000 --> 00:01.000\n' + 'x'.repeat(6001), 'long.vtt'), code('size_limit'));
  assert.throws(() => extract('  \n \t '), code('empty_source'));
  assert.throws(() => extract('WEBVTT\n\nNOTE\nOnly metadata.', 'empty.vtt'), code('empty_source'));
  const controller = new AbortController(); controller.abort();
  assert.throws(() => extractTextSource({ bytes: Buffer.from('text'), name: 'test.txt', signal: controller.signal }), { name: 'AbortError' });
});

test('newly extracted arbitrary syllabus text runs through provider evidence validation and course fields', async () => {
  const result = extract('Course: Practical Algorithms\n\nDuration: six weeks.\n');
  const provider = { id: 'test-provider', generate: async () => ({ title: 'Practical Algorithms', courseDuration: 'six weeks', evidence: [
    { field: 'title', sourceExcerpt: 'Course: Practical Algorithms', sourceLocation: 'Line 1' },
    { field: 'courseDuration', sourceExcerpt: 'Duration: six weeks.', sourceLocation: 'Line 3' },
  ], warnings: ['No explicit term dates.'] }) };
  const input = { document: { uri: 'file:///syllabus.txt', name: 'syllabus.txt' } };
  const generated = await runAIProvider(provider, 'syllabus', input, result.source, 'extraction-integration');
  const checked = validateInstitutionSyllabusResult(generated, input);
  assert.equal(checked.title, 'Practical Algorithms');
  assert.equal(checked.courseDuration, 'six weeks');
  assert.equal(checked.provenance?.documentSha256, result.extraction.documentSha256);
});

test('caption context permits exact evidence across adjacent cues and rejects a fabricated timestamp', async () => {
  const result = extract('WEBVTT\n\n00:00.000 --> 00:02.000\nDeclarative knowledge\n\n00:02.000 --> 00:04.000\nmeans statements of fact.\n', 'lesson.vtt');
  const input = { document: { uri: 'file:///lesson.vtt', name: 'lesson.vtt' } };
  const card = { front: 'What is declarative knowledge?', back: 'Statements of fact.', sourceExcerpt: result.source.text, sourceLocation: result.source.segments[0].location, confidence: 1 };
  const generated = await runAIProvider({ id: 'test', generate: async () => ({ cards: [card] }) }, 'flashcards', input, result.source, 'caption-integration');
  assert.equal(validateCards(generated, input)[0].reviewerVerified, false);
  await assert.rejects(runAIProvider({ id: 'test', generate: async () => ({ cards: [{ ...card, sourceLocation: '00:50:00.000' }] }) }, 'flashcards', input, result.source, 'bad-location'), /does not match/);
});

test('the complete bundled caption file extracts all cues without changing the prepared artifacts', async () => {
  const file = 'demo/ai/sources/mit-6.0001-lecture1-captions.vtt';
  const bytes = await readFile(file);
  const result = await extractTextFile(file);
  const timestamps = bytes.toString('utf8').split('\n').filter(line => line.includes(' --> '));
  assert.equal(result.extraction.cueCount, timestamps.length);
  assert.equal(result.extraction.documentSha256, sha256(bytes));
  assert.ok(result.source.text.includes('declarative knowledge'));
  assert.ok(result.source.text.includes('statements of fact'));
  assert.equal(result.source.text.includes('commercial permission'), false);
  for (const segment of result.source.segments) assert.ok(result.source.text.includes(segment.text));
  assert.equal(sha256(await readFile(file)), sha256(bytes));
});

test('local extraction CLI writes a private new artifact, never calls AI and refuses overwrites', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'lms-source-extraction-'));
  try {
    const sourcePath = path.join(directory, 'source.txt');
    const outputPath = path.join(directory, 'extracted.json');
    await writeFile(sourcePath, 'Unpublished course notes.');
    const args = ['--max-old-space-size=256', '--import', 'tsx', 'scripts/extract-ai-source.ts', '--input', sourcePath, '--out', outputPath];
    const result = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 10_000, maxBuffer: 100_000 });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /no AI call/);
    assert.equal(result.stdout.includes('Unpublished course notes.'), false);
    const saved = await readFile(outputPath);
    assert.equal(JSON.parse(saved.toString()).source.text, 'Unpublished course notes.');
    if (process.platform !== 'win32') assert.equal((await stat(outputPath)).mode & 0o777, 0o600);
    await writeFile(sourcePath, 'Changed input.');
    const overwrite = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 10_000, maxBuffer: 100_000 });
    assert.notEqual(overwrite.status, 0);
    assert.match(overwrite.stderr, /Output already exists/);
    assert.equal((await readFile(outputPath)).toString(), saved.toString());
    await assert.rejects(extractTextFile(directory), code('size_limit'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
