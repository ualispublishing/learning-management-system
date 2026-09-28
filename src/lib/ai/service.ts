/**
 * @fileoverview src/lib/ai/service.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import { createEntityId } from '../id';
import { appendMultipartAsset, isPickerOwnedAssetUri, validateMultipartAssetBytes } from '../integration/multipartAsset';
import { readBoundedResponseText, readRemoteErrorDetail } from '../integration/httpResponse';
import {
  FLASHCARD_PROMPT_VERSION,
  SYLLABUS_PROMPT_VERSION,
} from './prompts';
import {
  AIDocumentAsset,
  AIGenerationInput,
  AIProvenance,
  AIService,
  GeneratedFlashcard,
  SyllabusEvidence,
  SyllabusExtraction,
} from './types';

const MAX_TEXT_CHARACTERS = 500_000;
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
const MAX_MEDIA_BYTES = 50 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 300_000;
const MAX_RESPONSE_BYTES = 2_000_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DOCUMENT_MIME_TYPES: Record<string, readonly string[]> = {
  pdf: ['application/pdf'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  pptx: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  txt: ['text/plain'],
  md: ['text/markdown', 'text/plain'],
  rtf: ['application/rtf', 'text/rtf'],
  vtt: ['text/vtt', 'text/plain'],
  srt: ['application/x-subrip', 'text/plain'],
  mp3: ['audio/mpeg'],
  m4a: ['audio/mp4', 'audio/x-m4a'],
  wav: ['audio/wav', 'audio/x-wav'],
  mp4: ['video/mp4'],
  mov: ['video/quicktime'],
  webm: ['video/webm', 'audio/webm'],
};
const MEDIA_EXTENSIONS = new Set(['mp3', 'm4a', 'wav', 'mp4', 'mov', 'webm']);

export const inferAIDocumentKind = (document: AIDocumentAsset): NonNullable<AIDocumentAsset['kind']> => {
  const extension = document.name.toLocaleLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
  const normalizedMimeType = document.mimeType?.split(';', 1)[0].trim().toLocaleLowerCase();
  return ['vtt', 'srt'].includes(extension)
    ? 'captions'
    : ['mp3', 'm4a', 'wav'].includes(extension) || (extension === 'webm' && normalizedMimeType?.startsWith('audio/'))
      ? 'audio'
      : ['mp4', 'mov', 'webm'].includes(extension) ? 'video' : 'document';
};

export class AIConfigurationError extends Error {}
export class AIResponseError extends Error {}

interface AIServiceConfig {
  baseUrl: string;
  getAccessToken?: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
}

function safeBaseUrl(baseUrl: string): { url: string; localDevelopment: boolean } {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new AIConfigurationError('The AI service URL is invalid.');
  }
  const developmentBuild = typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production';
  const localDevelopment = developmentBuild && ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !localDevelopment) {
    throw new AIConfigurationError('The AI service must use HTTPS outside local development.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new AIConfigurationError('The AI service URL cannot contain credentials, a query, or a fragment.');
  }
  return { url: url.toString().replace(/\/+$/, ''), localDevelopment };
}

export const isValidISODate = (value: string): boolean => {
  if (!ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
};

function validateInput(input: AIGenerationInput, task: 'flashcards' | 'syllabus' = 'flashcards') {
  if (!input || typeof input !== 'object') throw new Error('AI generation input is required.');
  if (input.sourceText !== undefined && typeof input.sourceText !== 'string') throw new Error('Source material must be text.');
  const text = input.sourceText?.trim() || '';
  if (!text && !input.document) throw new Error('Paste source material or select a document first.');
  if (text.length > MAX_TEXT_CHARACTERS) throw new Error('Pasted source material exceeds the 500,000 character limit.');
  if (input.document) {
    if (!input.document.name.trim() || input.document.name.length > 255 || /[\\/\0]/.test(input.document.name)) {
      throw new Error('The selected document has an invalid file name.');
    }
    if (!isPickerOwnedAssetUri(input.document.uri)) {
      throw new Error('The selected document URI is not supported.');
    }
    const extension = input.document.name.toLocaleLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
    const isMedia = MEDIA_EXTENSIONS.has(extension);
    const normalizedMimeType = input.document.mimeType?.split(';', 1)[0].trim().toLocaleLowerCase();
    const inferredKind = inferAIDocumentKind(input.document);
    if (input.document.kind && input.document.kind !== inferredKind) throw new Error('The selected source kind does not match its file extension.');
    if (task === 'syllabus' && inferredKind !== 'document') throw new Error('Syllabus extraction supports documents and text, not captions, audio, or video.');
    const maxBytes = isMedia ? MAX_MEDIA_BYTES : MAX_DOCUMENT_BYTES;
    if (input.document.size !== undefined && (!Number.isInteger(input.document.size) || input.document.size < 0 || input.document.size > maxBytes)) {
      throw new Error(`The selected source size is invalid or exceeds the ${Math.floor(maxBytes / 1024 / 1024)} MB limit.`);
    }
    validateMultipartAssetBytes(input.document, maxBytes);
    const expectedMimeTypes = DOCUMENT_MIME_TYPES[extension];
    const mimeType = normalizedMimeType;
    if (input.document.mimeType && (input.document.mimeType.length > 160 || /[\r\n]/.test(input.document.mimeType))) {
      throw new Error('The selected document MIME type is invalid.');
    }
    const mimeMatches = !mimeType || mimeType === 'application/octet-stream' || expectedMimeTypes?.includes(mimeType);
    if (!expectedMimeTypes || !mimeMatches) {
      throw new Error('Supported AI sources are PDF, DOCX, PPTX, TXT, Markdown, RTF, VTT/SRT captions, MP3/M4A/WAV audio, and MP4/MOV/WebM video.');
    }
  }
  if (input.courseTitle !== undefined && typeof input.courseTitle !== 'string') throw new Error('Course title context must be text.');
  if (input.courseTitle && input.courseTitle.length > 300) throw new Error('Course title context exceeds 300 characters.');
  if (input.locale) {
    try {
      if (Intl.getCanonicalLocales(input.locale).length !== 1) throw new Error();
    } catch {
      throw new Error('Locale must be a valid BCP 47 language tag.');
    }
  }
  if (input.requestedCardCount !== undefined && (!Number.isInteger(input.requestedCardCount) || input.requestedCardCount < 1 || input.requestedCardCount > 100)) {
    throw new Error('Requested flashcard count must be a whole number from 1 to 100.');
  }
}

function strictString(
  value: unknown,
  path: string,
  maxLength: number,
  options: { required?: boolean; minLength?: number } = {},
): string | undefined {
  if (value === undefined) {
    if (options.required) throw new AIResponseError(`${path} is required.`);
    return undefined;
  }
  if (typeof value !== 'string') throw new AIResponseError(`${path} must be a string.`);
  if (value.length > maxLength) throw new AIResponseError(`${path} exceeds ${maxLength.toLocaleString()} characters.`);
  const trimmed = value.trim();
  const minLength = options.minLength ?? (options.required ? 1 : 0);
  if (trimmed.length < minLength) throw new AIResponseError(`${path} must contain at least ${minLength} non-whitespace character${minLength === 1 ? '' : 's'}.`);
  return trimmed || undefined;
}

function assertAllowedKeys(record: Record<string, unknown>, allowed: readonly string[], path: string) {
  const allowedKeys = new Set(allowed);
  const unsupported = Object.keys(record).find(key => !allowedKeys.has(key));
  if (unsupported) throw new AIResponseError(`${path}.${unsupported} is not supported by the active AI response schema.`);
}

function strictStringArray(value: unknown, path: string, limit: number, maxLength: number): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new AIResponseError(`${path} must be an array.`);
  if (value.length > limit) throw new AIResponseError(`${path} exceeds ${limit.toLocaleString()} entries.`);
  return value.map((entry, index) => strictString(entry, `${path}[${index}]`, maxLength, { required: true })!);
}

function numberValue(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : undefined;
}

const normalizedEvidenceText = (value: string) => value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase();

const evidenceAppearsInSource = (excerpt: string, sourceText?: string, hasDocument = false) =>
  hasDocument || !sourceText?.trim() || normalizedEvidenceText(sourceText).includes(normalizedEvidenceText(excerpt));

function readServerProvenance(
  payload: unknown,
  task: 'flashcards' | 'syllabus',
  required: boolean,
  documentRequired = false,
): AIProvenance | undefined {
  if (!required) return undefined;
  const provenance = payload && typeof payload === 'object' ? (payload as { provenance?: unknown }).provenance : undefined;
  if (!provenance || typeof provenance !== 'object') throw new AIResponseError('The AI service omitted its server validation attestation.');
  const record = provenance as Record<string, unknown>;
  assertAllowedKeys(record, ['promptVersion', 'evidenceVerified', 'sourceSha256', 'documentSha256', 'requestId', 'model'], 'provenance');
  const expectedVersion = task === 'flashcards' ? FLASHCARD_PROMPT_VERSION : SYLLABUS_PROMPT_VERSION;
  if (record.promptVersion !== expectedVersion || record.evidenceVerified !== true) {
    throw new AIResponseError('The AI service did not attest to the requested prompt version and source-grounding checks.');
  }
  if (typeof record.sourceSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(record.sourceSha256)) {
    throw new AIResponseError('The AI service did not attest to the SHA-256 digest of the processed source.');
  }
  if (documentRequired && (typeof record.documentSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(record.documentSha256))) {
    throw new AIResponseError('The AI service did not attest to the SHA-256 digest of the uploaded document bytes.');
  }
  if (record.documentSha256 !== undefined && (typeof record.documentSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(record.documentSha256))) {
    throw new AIResponseError('provenance.documentSha256 must be a 64-character hexadecimal digest.');
  }
  return {
    promptVersion: expectedVersion,
    evidenceVerified: true,
    sourceSha256: record.sourceSha256.toLocaleLowerCase(),
    documentSha256: typeof record.documentSha256 === 'string' ? record.documentSha256.toLocaleLowerCase() : undefined,
    requestId: strictString(record.requestId, 'provenance.requestId', 160),
    model: strictString(record.model, 'provenance.model', 160),
  };
}

function validateCards(payload: unknown, input: AIGenerationInput): GeneratedFlashcard[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new AIResponseError('The AI service returned an invalid flashcard response.');
  const payloadRecord = payload as Record<string, unknown>;
  assertAllowedKeys(payloadRecord, ['cards', 'provenance'], 'flashcardResponse');
  if (!Array.isArray(payloadRecord.cards)) throw new AIResponseError('The AI service returned an invalid flashcard response.');
  const source = payloadRecord.cards;
  const requestedLimit = input.requestedCardCount ?? 30;
  if (source.length > Math.min(100, requestedLimit)) throw new AIResponseError(`The AI service returned more than the requested ${requestedLimit} flashcards.`);
  const provenance = readServerProvenance(payload, 'flashcards', Boolean(payloadRecord.provenance), Boolean(input.document));
  const seen = new Set<string>();
  const cards: GeneratedFlashcard[] = [];
  source.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new AIResponseError(`cards[${index}] must be an object.`);
    const record = raw as Record<string, unknown>;
    assertAllowedKeys(record, ['front', 'back', 'sourceExcerpt', 'sourceLocation', 'confidence', 'tags'], `cards[${index}]`);
    const front = strictString(record.front, `cards[${index}].front`, 500, { required: true, minLength: 3 })!;
    const back = strictString(record.back, `cards[${index}].back`, 2000, { required: true })!;
    const sourceExcerpt = strictString(record.sourceExcerpt, `cards[${index}].sourceExcerpt`, 600, { required: true })!;
    const sourceLocation = strictString(record.sourceLocation, `cards[${index}].sourceLocation`, 160);
    const confidence = numberValue(record.confidence, 0, 1);
    const duplicateKey = `${normalizedEvidenceText(front)}\u0000${normalizedEvidenceText(back)}`;
    if (confidence === undefined) throw new AIResponseError(`cards[${index}].confidence must be a number from 0 to 1.`);
    if (!evidenceAppearsInSource(sourceExcerpt, input.sourceText, Boolean(input.document))) throw new AIResponseError(`cards[${index}].sourceExcerpt was not found in the supplied source text.`);
    if (seen.has(duplicateKey)) throw new AIResponseError(`cards[${index}] duplicates an earlier flashcard.`);
    const sourceExtension = input.document?.name.toLocaleLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
    if (MEDIA_EXTENSIONS.has(sourceExtension) && (!sourceLocation || !/\b(?:\d{1,2}:)?\d{1,2}:\d{2}\b/.test(sourceLocation))) {
      throw new AIResponseError(`cards[${index}].sourceLocation must include a transcript timestamp for audio or video sources.`);
    }
    seen.add(duplicateKey);
    cards.push({
      id: createEntityId(`ai-card-${index + 1}`),
      front,
      back,
      sourceExcerpt,
      sourceLocation,
      confidence,
      tags: strictStringArray(record.tags, `cards[${index}].tags`, 8, 60),
      reviewerVerified: false,
      provenance,
    });
  });
  if (!cards.length) throw new AIResponseError('The AI service returned no reviewable, source-grounded flashcards.');
  return cards;
}

function validateEvidence(value: unknown): SyllabusEvidence[] {
  if (!Array.isArray(value)) throw new AIResponseError('evidence must be an array.');
  if (value.length > 200) throw new AIResponseError('evidence exceeds 200 entries.');
  return value.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new AIResponseError(`evidence[${index}] must be an object.`);
    const record = raw as Record<string, unknown>;
    assertAllowedKeys(record, ['field', 'sourceExcerpt', 'sourceLocation'], `evidence[${index}]`);
    return {
      field: strictString(record.field, `evidence[${index}].field`, 160, { required: true })!,
      sourceExcerpt: strictString(record.sourceExcerpt, `evidence[${index}].sourceExcerpt`, 600, { required: true })!,
      sourceLocation: strictString(record.sourceLocation, `evidence[${index}].sourceLocation`, 160),
    };
  });
}

const hasEvidenceFor = (evidenceFields: string[], path: string) =>
  evidenceFields.some(field => field === path || field.startsWith(`${path}.`));

function validateSchedule(value: unknown): { entries?: { date?: string; topic: string }[]; invalidDateCount: number } {
  if (value === undefined) return { invalidDateCount: 0 };
  if (!Array.isArray(value)) throw new AIResponseError('schedule must be an array.');
  if (value.length > 500) throw new AIResponseError('schedule exceeds 500 entries.');
  let invalidDateCount = 0;
  const entries = value.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new AIResponseError(`schedule[${index}] must be an object.`);
    const record = raw as Record<string, unknown>;
    assertAllowedKeys(record, ['date', 'topic'], `schedule[${index}]`);
    const topic = strictString(record.topic, `schedule[${index}].topic`, 600, { required: true })!;
    const candidateDate = strictString(record.date, `schedule[${index}].date`, 10);
    const date = candidateDate && isValidISODate(candidateDate) ? candidateDate : undefined;
    if (candidateDate && !date) invalidDateCount += 1;
    return { topic, date };
  });
  return { entries, invalidDateCount };
}

function validatePolicies(value: unknown): { name: string; text: string }[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new AIResponseError('policies must be an array.');
  if (value.length > 100) throw new AIResponseError('policies exceeds 100 entries.');
  return value.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new AIResponseError(`policies[${index}] must be an object.`);
    const record = raw as Record<string, unknown>;
    assertAllowedKeys(record, ['name', 'text'], `policies[${index}]`);
    return {
      name: strictString(record.name, `policies[${index}].name`, 160, { required: true })!,
      text: strictString(record.text, `policies[${index}].text`, 4000, { required: true })!,
    };
  });
}

function validateSyllabus(payload: unknown, input: AIGenerationInput): SyllabusExtraction {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new AIResponseError('The AI service returned an invalid syllabus response.');
  const record = payload as Record<string, unknown>;
  assertAllowedKeys(record, ['title', 'description', 'termStart', 'termEnd', 'gradingWeights', 'instructorNames', 'schedule', 'requiredMaterials', 'policies', 'evidence', 'warnings', 'provenance'], 'syllabusResponse');
  const provenance = readServerProvenance(payload, 'syllabus', Boolean(record.provenance), Boolean(input.document));
  const gradingWeights: Record<string, number> = {};
  if (record.gradingWeights !== undefined && (!record.gradingWeights || typeof record.gradingWeights !== 'object' || Array.isArray(record.gradingWeights))) {
    throw new AIResponseError('gradingWeights must be an object.');
  }
  if (record.gradingWeights && typeof record.gradingWeights === 'object') {
    if (Object.keys(record.gradingWeights).length > 100) throw new AIResponseError('gradingWeights exceeds 100 categories.');
    Object.entries(record.gradingWeights as Record<string, unknown>).forEach(([label, value]) => {
      const safeLabel = strictString(label, 'gradingWeights category', 120, { required: true });
      const safeValue = numberValue(value, 0, 100);
      if (!safeLabel || safeValue === undefined) throw new AIResponseError('The syllabus result contains an invalid grading category or percentage.');
      if (Object.keys(gradingWeights).some(existing => existing.toLocaleLowerCase() === safeLabel.toLocaleLowerCase())) {
        throw new AIResponseError(`The syllabus result duplicated grading category "${safeLabel}".`);
      }
      gradingWeights[safeLabel] = safeValue;
    });
  }
  const date = (value: unknown, path: string) => {
    const parsed = strictString(value, path, 10);
    if (parsed && !isValidISODate(parsed)) throw new AIResponseError(`${path} must be a valid YYYY-MM-DD calendar date.`);
    return parsed;
  };
  const evidence = validateEvidence(record.evidence);
  if (!evidence.length) throw new AIResponseError('The syllabus result did not include evidence for human review.');
  const ungroundedEvidence = evidence.find(entry => !evidenceAppearsInSource(entry.sourceExcerpt, input.sourceText, Boolean(input.document)));
  if (ungroundedEvidence) throw new AIResponseError(`The syllabus evidence for "${ungroundedEvidence.field}" was not found in the supplied source text.`);
  const schedule = validateSchedule(record.schedule);
  const result: SyllabusExtraction = {
    title: strictString(record.title, 'title', 300),
    description: strictString(record.description, 'description', 4000),
    termStart: date(record.termStart, 'termStart'),
    termEnd: date(record.termEnd, 'termEnd'),
    gradingWeights: Object.keys(gradingWeights).length ? gradingWeights : undefined,
    instructorNames: strictStringArray(record.instructorNames, 'instructorNames', 30, 200),
    schedule: schedule.entries,
    requiredMaterials: strictStringArray(record.requiredMaterials, 'requiredMaterials', 100, 600),
    policies: validatePolicies(record.policies),
    evidence,
    warnings: (() => {
      if (!Array.isArray(record.warnings)) throw new AIResponseError('warnings must be an array.');
      return strictStringArray(record.warnings, 'warnings', 100, 600)!;
    })(),
    provenance,
  };
  if (result.gradingWeights) {
    const total = Object.values(result.gradingWeights).reduce((sum, weight) => sum + weight, 0);
    if (Math.abs(total - 100) > 0.01) result.warnings.push(`Extracted grading weights total ${total}%, not 100%.`);
  }
  if (schedule.invalidDateCount) result.warnings.push(`${schedule.invalidDateCount} schedule date${schedule.invalidDateCount === 1 ? ' was' : 's were'} omitted because the date was not a valid YYYY-MM-DD calendar date.`);
  if (result.termStart && result.termEnd && result.termStart >= result.termEnd) {
    result.warnings.push('Extracted term dates were omitted because the term end was not after the term start.');
    result.termStart = undefined;
    result.termEnd = undefined;
  }
  const populatedFields = [
    result.title && 'title',
    result.description && 'description',
    result.termStart && 'termStart',
    result.termEnd && 'termEnd',
    result.gradingWeights && 'gradingWeights',
    result.instructorNames?.length && 'instructorNames',
    result.schedule?.length && 'schedule',
    result.requiredMaterials?.length && 'requiredMaterials',
    result.policies?.length && 'policies',
  ].filter((field): field is string => typeof field === 'string');
  const evidenceRoots = new Set(evidence.map(entry => entry.field.split(/[.\[]/, 1)[0]));
  const missingEvidence = populatedFields.filter(field => !evidenceRoots.has(field));
  if (missingEvidence.length) {
    throw new AIResponseError(`The syllabus result omitted source evidence for: ${missingEvidence.join(', ')}.`);
  }
  const evidenceFields = evidence.map(entry => entry.field);
  const missingEntryEvidence = [
    ...Object.keys(result.gradingWeights || {}).map((_entry, index) => `gradingWeights[${index}]`),
    ...(result.instructorNames || []).map((_entry, index) => `instructorNames[${index}]`),
    ...(result.schedule || []).map((_entry, index) => `schedule[${index}]`),
    ...(result.requiredMaterials || []).map((_entry, index) => `requiredMaterials[${index}]`),
    ...(result.policies || []).map((_entry, index) => `policies[${index}]`),
  ].filter(path => !hasEvidenceFor(evidenceFields, path));
  if (missingEntryEvidence.length) {
    throw new AIResponseError(`The syllabus result omitted entry-level source evidence for: ${missingEntryEvidence.join(', ')}.`);
  }
  return result;
}

/**
 * Runtime boundary for institution-supplied AIService adapters. TypeScript
 * return types are not a trust boundary, and generated records must never be
 * allowed to arrive pre-verified by an adapter.
 */
export function validateInstitutionFlashcardResult(result: unknown, input: AIGenerationInput): GeneratedFlashcard[] {
  if (!Array.isArray(result)) throw new AIResponseError('The institution AI adapter returned a non-array flashcard result.');
  const allowedKeys = ['id', 'front', 'back', 'sourceExcerpt', 'sourceLocation', 'confidence', 'tags', 'reviewerEdited', 'reviewerVerified', 'provenance'];
  const records = result.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new AIResponseError(`cards[${index}] must be an object.`);
    const record = raw as Record<string, unknown>;
    assertAllowedKeys(record, allowedKeys, `cards[${index}]`);
    return record;
  });
  const provenanceRecords = records.map((record, index) => record.provenance === undefined
    ? undefined
    : readServerProvenance({ provenance: record.provenance }, 'flashcards', true, Boolean(input.document)));
  const provenance = provenanceRecords.find((entry): entry is AIProvenance => entry !== undefined);
  if (provenanceRecords.some(entry => !entry)) {
    throw new AIResponseError('Every generated flashcard must include the server prompt/source-digest attestation.');
  }
  if (provenance && provenanceRecords.some(entry => !entry
    || entry.promptVersion !== provenance.promptVersion
    || entry.sourceSha256 !== provenance.sourceSha256
    || entry.documentSha256 !== provenance.documentSha256
    || entry.evidenceVerified !== provenance.evidenceVerified)) {
    throw new AIResponseError('Generated flashcards contain missing or contradictory source provenance.');
  }
  const payload = {
    cards: records.map(record => ({
      front: record.front,
      back: record.back,
      sourceExcerpt: record.sourceExcerpt,
      sourceLocation: record.sourceLocation,
      confidence: record.confidence,
      tags: record.tags,
    })),
    ...(provenance ? { provenance } : {}),
  };
  return validateCards(payload, input).map(card => ({
    ...card,
    reviewerEdited: false,
    reviewerVerified: false,
  }));
}

/** Revalidates a typed custom adapter result and requires document provenance. */
export function validateInstitutionSyllabusResult(result: unknown, input: AIGenerationInput): SyllabusExtraction {
  if (!result || typeof result !== 'object' || Array.isArray(result) || !(result as Record<string, unknown>).provenance) {
    throw new AIResponseError('Every generated syllabus result must include the server prompt/source-digest attestation.');
  }
  return validateSyllabus(result, input);
}

export async function generateValidatedFlashcards(input: AIGenerationInput): Promise<GeneratedFlashcard[]> {
  validateInput(input, 'flashcards');
  return validateInstitutionFlashcardResult(await getAIService().generateFlashcards(input), input);
}

export async function extractValidatedSyllabus(input: AIGenerationInput): Promise<SyllabusExtraction> {
  validateInput(input, 'syllabus');
  return validateInstitutionSyllabusResult(await getAIService().extractSyllabus(input), input);
}

function appendDocument(form: FormData, document: AIDocumentAsset) {
  appendMultipartAsset(form, 'document', document);
}

export class InstitutionAIService implements AIService {
  private readonly fetchImpl: typeof fetch;
  private readonly localDevelopment: boolean;
  private readonly baseUrl: string;

  constructor(private readonly config: AIServiceConfig) {
    const validatedUrl = safeBaseUrl(config.baseUrl);
    this.localDevelopment = validatedUrl.localDevelopment;
    this.baseUrl = validatedUrl.url;
    if (!this.localDevelopment && !config.getAccessToken) {
      throw new AIConfigurationError('Remote AI services require an authenticated access-token provider.');
    }
    this.fetchImpl = config.fetchImpl || fetch;
  }

  private async request(task: 'flashcards' | 'syllabus', input: AIGenerationInput) {
    validateInput(input, task);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const token = (await this.config.getAccessToken?.())?.trim();
      if (!this.localDevelopment && !token) throw new AIConfigurationError('An authenticated AI session is required.');
      if (token && (token.length > 8_192 || /[\u0000-\u001f\u007f]/.test(token))) {
        throw new AIConfigurationError('The AI service access token is invalid.');
      }
      const form = new FormData();
      form.append('task', task);
      form.append('promptVersion', task === 'flashcards' ? FLASHCARD_PROMPT_VERSION : SYLLABUS_PROMPT_VERSION);
      form.append('courseTitle', input.courseTitle || '');
      form.append('locale', input.locale || 'en');
      if (task === 'flashcards') form.append('requestedCardCount', String(input.requestedCardCount ?? 30));
      if (input.sourceText?.trim()) form.append('sourceText', input.sourceText.trim());
      if (input.document) {
        form.append('sourceKind', inferAIDocumentKind(input.document));
        appendDocument(form, input.document);
      }
      const requestId = createEntityId('ai-request');
      const response = await this.fetchImpl(`${this.baseUrl}/lms/v1/ai/generate`, {
        method: 'POST',
        // Do not replay learner source material or bearer credentials to a
        // redirect target controlled outside the configured AI origin.
        redirect: 'error',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'Idempotency-Key': requestId,
          'X-Request-Id': requestId,
        },
        body: form,
        signal: controller.signal,
      });
      const text = await readBoundedResponseText(response, MAX_RESPONSE_BYTES, () =>
        new AIResponseError('The AI service response exceeded the 2 MB limit.'));
      if (!response.ok) {
        let payload: unknown;
        try {
          payload = JSON.parse(text) as unknown;
        } catch {
          // Do not surface arbitrary upstream HTML or debug output.
        }
        const detail = readRemoteErrorDetail(payload, this.localDevelopment);
        const suffix = this.localDevelopment && detail.message
          ? `: ${detail.message}${detail.code ? ` (${detail.code})` : ''}`
          : detail.code ? ` (${detail.code})` : '';
        throw new AIResponseError(`AI service failed (${response.status})${suffix}`);
      }
      if (!this.localDevelopment && !/^application\/(?:[a-z0-9.+-]*\+)?json\b/i.test(response.headers.get('Content-Type') || '')) {
        throw new AIResponseError('The AI service returned an unexpected content type.');
      }
      let payload: unknown;
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        throw new AIResponseError('The AI service returned malformed JSON.');
      }
      const attestation = readServerProvenance(payload, task, !this.localDevelopment || Boolean(input.document), Boolean(input.document));
      if (!this.localDevelopment && attestation?.requestId !== requestId) {
        throw new AIResponseError('The AI service response was not bound to this request identifier.');
      }
      return payload;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw new Error('The AI request timed out. Try a smaller document.');
      if (error instanceof AIConfigurationError || error instanceof AIResponseError) throw error;
      throw new Error(
        this.localDevelopment && error instanceof Error ? error.message : 'The AI service request could not be completed.',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async generateFlashcards(input: AIGenerationInput) {
    return validateCards(await this.request('flashcards', input), input);
  }

  async extractSyllabus(input: AIGenerationInput) {
    return validateSyllabus(await this.request('syllabus', input), input);
  }
}

let configuredService: AIService | null = null;

export function configureAIService(service: AIService | null) {
  configuredService = service;
}

export function getAIService(): AIService {
  if (configuredService) return configuredService;
  const baseUrl = process.env.EXPO_PUBLIC_LMS_AI_BASE_URL?.trim();
  const isDevelopmentBuild = typeof __DEV__ !== 'undefined' && __DEV__;
  if (!baseUrl || !isDevelopmentBuild) {
    throw new AIConfigurationError(
      isDevelopmentBuild
        ? 'AI generation is not configured. Set EXPO_PUBLIC_LMS_AI_BASE_URL or inject an institutional AIService adapter.'
        : 'AI generation is not configured. Inject an authenticated institutional AIService adapter before using AI in production.',
    );
  }
  configuredService = new InstitutionAIService({ baseUrl });
  return configuredService;
}
