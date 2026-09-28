/**
 * @fileoverview src/lib/db/csv.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import { utf8ByteLength } from '../utf8';

export { utf8ByteLength } from '../utf8';

export const MAX_CSV_BYTES = 10 * 1024 * 1024;
export const MAX_CSV_ROWS = 100_000;
export const MAX_CSV_COLUMNS = 1_001;
export const MAX_CSV_CELL_CHARACTERS = 250_000;

export interface FlashcardCSVRow {
  front: string;
  layers: string[];
}

export class CSVValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CSVValidationError';
  }
}

const SPREADSHEET_FORMULA_PREFIX = /^[\t\r ]*[=+\-@]/;

function protectSpreadsheetCell(value: string): string {
  return SPREADSHEET_FORMULA_PREFIX.test(value) ? `'${value}` : value;
}

function removeSpreadsheetProtection(value: string): string {
  return value.startsWith("'") && SPREADSHEET_FORMULA_PREFIX.test(value.slice(1))
    ? value.slice(1)
    : value;
}

function validateCellLength(value: string, recordNumber: number): void {
  if (value.length > MAX_CSV_CELL_CHARACTERS) {
    throw new CSVValidationError(
      `CSV row ${recordNumber} contains a cell longer than ${MAX_CSV_CELL_CHARACTERS.toLocaleString()} characters.`,
    );
  }
}

/**
 * Parses RFC 4180-style CSV, including escaped quotes and line breaks inside
 * quoted cells. Every nonblank record must contain a front and at least one
 * layer; malformed input rejects the whole import before the database changes.
 */
export function parseFlashcardCSV(input: string): FlashcardCSVRow[] {
  const byteLength = utf8ByteLength(input);
  if (byteLength > MAX_CSV_BYTES) {
    throw new CSVValidationError(
      `CSV files must be ${Math.floor(MAX_CSV_BYTES / (1024 * 1024))} MB or smaller.`,
    );
  }

  const content = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const parsed: FlashcardCSVRow[] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let justClosedQuote = false;
  let physicalLine = 1;

  const recordNumber = () => parsed.length + 1;

  const append = (character: string) => {
    field += character;
    validateCellLength(field, recordNumber());
  };

  const pushField = () => {
    validateCellLength(field, recordNumber());
    row.push(field);
    field = '';
    if (row.length > MAX_CSV_COLUMNS) {
      throw new CSVValidationError(
        `CSV row ${recordNumber()} has more than ${MAX_CSV_COLUMNS.toLocaleString()} columns.`,
      );
    }
  };

  const finishRecord = () => {
    pushField();
    if (row.length === 1 && row[0].trim() === '') {
      row = [];
      return;
    }
    if (row.length < 2) {
      throw new CSVValidationError(
        `CSV row ${recordNumber()} must contain a front and at least one layer.`,
      );
    }

    const cells = row.map(removeSpreadsheetProtection);
    if (!cells[0].trim()) {
      throw new CSVValidationError(`CSV row ${recordNumber()} has an empty card front.`);
    }
    parsed.push({ front: cells[0], layers: cells.slice(1) });
    if (parsed.length > MAX_CSV_ROWS) {
      throw new CSVValidationError(
        `CSV files may contain at most ${MAX_CSV_ROWS.toLocaleString()} cards.`,
      );
    }
    row = [];
  };

  for (let index = 0; index < content.length; index++) {
    const character = content[index];
    if (character === '\0') {
      throw new CSVValidationError(`CSV row ${recordNumber()} contains an invalid null character.`);
    }

    if (inQuotes) {
      if (character === '"') {
        if (content[index + 1] === '"') {
          append('"');
          index += 1;
        } else {
          inQuotes = false;
          justClosedQuote = true;
        }
      } else {
        append(character);
        if (character === '\n') physicalLine += 1;
      }
      continue;
    }

    if (justClosedQuote) {
      if (character === ',') {
        pushField();
        justClosedQuote = false;
        continue;
      }
      if (character !== '\r' && character !== '\n') {
        throw new CSVValidationError(
          `CSV row ${recordNumber()} has an unexpected character after a closing quote (line ${physicalLine}).`,
        );
      }
      finishRecord();
      justClosedQuote = false;
      if (character === '\r' && content[index + 1] === '\n') index += 1;
      physicalLine += 1;
      continue;
    }

    if (character === '"') {
      if (field.length > 0) {
        throw new CSVValidationError(
          `CSV row ${recordNumber()} contains a quote in an unquoted cell (line ${physicalLine}).`,
        );
      }
      inQuotes = true;
    } else if (character === ',') {
      pushField();
    } else if (character === '\r' || character === '\n') {
      finishRecord();
      if (character === '\r' && content[index + 1] === '\n') index += 1;
      physicalLine += 1;
    } else {
      append(character);
    }
  }

  if (inQuotes) {
    throw new CSVValidationError(
      `CSV row ${recordNumber()} has an unclosed quoted cell (starting before line ${physicalLine}).`,
    );
  }
  if (justClosedQuote || field.length > 0 || row.length > 0) finishRecord();

  return parsed;
}

function escapeCell(value: string, recordNumber: number): string {
  if (value.includes('\0')) {
    throw new CSVValidationError(`CSV row ${recordNumber} contains an invalid null character.`);
  }
  validateCellLength(value, recordNumber);
  return `"${protectSpreadsheetCell(value).replace(/"/g, '""')}"`;
}

/** Serializes a secure, UTF-8 BOM-prefixed CSV that round-trips through this app. */
export function serializeFlashcardCSV(rows: FlashcardCSVRow[]): string {
  if (rows.length > MAX_CSV_ROWS) {
    throw new CSVValidationError(
      `CSV files may contain at most ${MAX_CSV_ROWS.toLocaleString()} cards.`,
    );
  }

  const records = rows.map((row, index) => {
    const recordNumber = index + 1;
    if (!row.front.trim()) {
      throw new CSVValidationError(`CSV row ${recordNumber} has an empty card front.`);
    }
    if (row.layers.length < 1) {
      throw new CSVValidationError(`CSV row ${recordNumber} must contain at least one layer.`);
    }
    if (row.layers.length + 1 > MAX_CSV_COLUMNS) {
      throw new CSVValidationError(
        `CSV row ${recordNumber} has more than ${MAX_CSV_COLUMNS.toLocaleString()} columns.`,
      );
    }
    return [row.front, ...row.layers]
      .map(cell => escapeCell(cell, recordNumber))
      .join(',');
  });

  const csv = `\uFEFF${records.join('\r\n')}${records.length > 0 ? '\r\n' : ''}`;
  if (utf8ByteLength(csv) > MAX_CSV_BYTES) {
    throw new CSVValidationError(
      `The exported deck exceeds the ${Math.floor(MAX_CSV_BYTES / (1024 * 1024))} MB CSV limit.`,
    );
  }
  return csv;
}
