import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CSVValidationError,
  MAX_CSV_BYTES,
  parseFlashcardCSV,
  serializeFlashcardCSV,
  utf8ByteLength,
} from '../src/lib/db/csv';

test('CSV codec round-trips commas, quotes, Unicode, and embedded newlines', () => {
  const rows = [
    {
      front: 'What is "premium", exactly?\nExplain briefly.',
      layers: ['A correct, reliable experience', 'Works for José and 東京'],
    },
  ];

  const serialized = serializeFlashcardCSV(rows);

  assert.equal(serialized.charCodeAt(0), 0xfeff);
  assert.match(serialized, /""premium""/);
  assert.deepEqual(parseFlashcardCSV(serialized), rows);
});

test('CSV parser handles CRLF, bare CR, escaped quotes, and blank records', () => {
  const csv = '\uFEFF"front 1","layer ""one"""\r\n\r\n"front 2","line 1\nline 2"\rfront 3,layer 3';

  assert.deepEqual(parseFlashcardCSV(csv), [
    { front: 'front 1', layers: ['layer "one"'] },
    { front: 'front 2', layers: ['line 1\nline 2'] },
    { front: 'front 3', layers: ['layer 3'] },
  ]);
});

test('CSV export neutralizes spreadsheet formulas and app import reverses its protection', () => {
  const rows = [
    { front: '=HYPERLINK("https://example.invalid")', layers: ['  +cmd', '@mention', '-1'] },
  ];

  const serialized = serializeFlashcardCSV(rows);

  assert.match(serialized, /^\uFEFF"'=HYPERLINK/);
  assert.match(serialized, /"'  \+cmd"/);
  assert.deepEqual(parseFlashcardCSV(serialized), rows);
});

test('CSV parser rejects malformed records instead of partially importing them', () => {
  const malformed = [
    ['unclosed quote', '"front,layer'],
    ['quote in an unquoted cell', 'fr"ont,layer'],
    ['characters after a quote', '"front"oops,layer'],
    ['missing layer', 'front-only'],
    ['empty front', ',layer'],
    ['null character', 'front,la\0yer'],
  ] as const;

  for (const [label, csv] of malformed) {
    assert.throws(() => parseFlashcardCSV(csv), CSVValidationError, label);
  }
});

test('CSV codec enforces its UTF-8 byte limit', () => {
  assert.equal(utf8ByteLength('Aé😀'), 7);
  const oversized = 'a'.repeat(MAX_CSV_BYTES + 1);
  assert.throws(() => parseFlashcardCSV(oversized), /10 MB or smaller/);
});

test('CSV export requires a front and at least one layer', () => {
  assert.throws(
    () => serializeFlashcardCSV([{ front: '   ', layers: ['answer'] }]),
    /empty card front/,
  );
  assert.throws(
    () => serializeFlashcardCSV([{ front: 'question', layers: [] }]),
    /at least one layer/,
  );
});
