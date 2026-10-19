/** Pure shared AI output validation. Safe for both the client and Node gateway. */
import { createEntityId } from '../id.ts';
import { FLASHCARD_PROMPT_VERSION, SYLLABUS_PROMPT_VERSION } from './prompts.ts';
import type { AIGenerationInput, AIProvenance, GeneratedFlashcard, SyllabusEvidence, SyllabusExtraction } from './types.ts';
import { readPreparedGeneration } from './generationAttribution.ts';

export class AIResponseError extends Error {}
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MEDIA_EXTENSIONS = new Set(['mp3', 'm4a', 'wav', 'mp4', 'mov', 'webm']);

export const isValidISODate = (value: string): boolean => {
  if (!ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
};

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

/** Snapshot gateway processing notes before asynchronous work or client review. */
export function readSourceReviewNotices(value: unknown): string[] | undefined {
  const notices = strictStringArray(value, 'provenance.sourceReviewNotices', 10, 600);
  return notices?.length ? [...new Set(notices)] : undefined;
}

function numberValue(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : undefined;
}

const normalizedEvidenceText = (value: string) => value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase();

const evidenceAppearsInSource = (excerpt: string, sourceText?: string, hasDocument = false) =>
  hasDocument || !sourceText?.trim() || normalizedEvidenceText(sourceText).includes(normalizedEvidenceText(excerpt));

export function readServerProvenance(
  payload: unknown,
  task: 'flashcards' | 'syllabus',
  required: boolean,
  documentRequired = false,
): AIProvenance | undefined {
  if (!required) return undefined;
  const provenance = payload && typeof payload === 'object' ? (payload as { provenance?: unknown }).provenance : undefined;
  if (!provenance || typeof provenance !== 'object') throw new AIResponseError('The AI service omitted its server validation attestation.');
  const record = provenance as Record<string, unknown>;
  assertAllowedKeys(record, ['promptVersion', 'evidenceVerified', 'sourceSha256', 'documentSha256', 'requestId', 'model', 'sourceReviewNotices', 'preparedGeneration'], 'provenance');
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
  const sourceReviewNotices = readSourceReviewNotices(record.sourceReviewNotices);
  let preparedGeneration;
  try { preparedGeneration = readPreparedGeneration(record.preparedGeneration); }
  catch { throw new AIResponseError('provenance.preparedGeneration contains invalid authoring metadata.'); }
  if (preparedGeneration && (record.model !== 'prepared-demo/v1' || !record.documentSha256)) {
    throw new AIResponseError('provenance.preparedGeneration requires the prepared replay engine and a source file digest.');
  }
  return {
    promptVersion: expectedVersion,
    evidenceVerified: true,
    sourceSha256: record.sourceSha256.toLocaleLowerCase(),
    documentSha256: typeof record.documentSha256 === 'string' ? record.documentSha256.toLocaleLowerCase() : undefined,
    requestId: strictString(record.requestId, 'provenance.requestId', 160),
    model: strictString(record.model, 'provenance.model', 160),
    ...(preparedGeneration ? { preparedGeneration } : {}),
    ...(sourceReviewNotices ? { sourceReviewNotices } : {}),
  };
}

export function validateCards(payload: unknown, input: AIGenerationInput): GeneratedFlashcard[] {
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

export function validateSyllabus(payload: unknown, input: AIGenerationInput): SyllabusExtraction {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new AIResponseError('The AI service returned an invalid syllabus response.');
  const record = payload as Record<string, unknown>;
  assertAllowedKeys(record, ['courseCode', 'courseDuration', 'intendedAudience', 'learningObjectives', 'meetingTimes', 'title', 'description', 'termStart', 'termEnd', 'gradingWeights', 'instructorNames', 'schedule', 'requiredMaterials', 'policies', 'evidence', 'warnings', 'provenance'], 'syllabusResponse');
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
    courseCode: strictString(record.courseCode, 'courseCode', 80),
    courseDuration: strictString(record.courseDuration, 'courseDuration', 300),
    intendedAudience: strictString(record.intendedAudience, 'intendedAudience', 1000),
    learningObjectives: strictStringArray(record.learningObjectives, 'learningObjectives', 50, 600),
    meetingTimes: strictStringArray(record.meetingTimes, 'meetingTimes', 30, 600),
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
    result.courseCode && 'courseCode',
    result.courseDuration && 'courseDuration',
    result.intendedAudience && 'intendedAudience',
    result.learningObjectives?.length && 'learningObjectives',
    result.meetingTimes?.length && 'meetingTimes',
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
    ...(result.learningObjectives || []).map((_entry, index) => `learningObjectives[${index}]`),
    ...(result.meetingTimes || []).map((_entry, index) => `meetingTimes[${index}]`),
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
    || entry.requestId !== provenance.requestId
    || entry.model !== provenance.model
    || JSON.stringify(entry.preparedGeneration) !== JSON.stringify(provenance.preparedGeneration)
    || JSON.stringify(entry.sourceReviewNotices) !== JSON.stringify(provenance.sourceReviewNotices)
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

