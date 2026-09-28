/**
 * @fileoverview src/lib/schema/CourseSchema.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import {
  ChatMessage,
  ChatThread,
  ContentCategory,
  ContentItem,
  ContentProgress,
  CourseStudyCard,
  Course,
  CourseAnnouncement,
  CourseGroupSet,
  CourseRole,
  CourseUser,
  PresentationMode,
  QuestionResponse,
  QuizQuestion,
  StudentSubmission,
} from '../../types/lms';
import { getGradingMaxScore, validateAssessment } from '../assessment/engine';
import { isExplicitContentDateTime, normalizeContentDateTime, parseContentDateTime } from '../contentDateTime';
import { getGroupForUser, getGroupFromSet } from '../groups/courseGroups';
import { hasVisibleMentionToken } from '../chat/threadPolicy';
import { isSafeHttpsUrl } from '../safeUrl';
import { utf8ByteLength } from '../utf8';
import { areVideoCaptionTracksBoundToAsset, validateCourseVideoAlternatives } from '../videoAlternatives';
import { isCourseVideoMimeType } from '../coursePresentation';

export const INSTITUTION_SCHEMA_VERSION = '1.0' as const;

export const INSTITUTION_INTEGRATION_CAPABILITIES = [
  'courses.read',
  'courses.write',
  'roster.read',
  'roster.write',
  'content.read',
  'content.write',
  'content-progress.read',
  'content-progress.write',
  'submissions.read',
  'submissions.write',
  'grades.read',
  'grades.write',
  'chat.read',
  'chat.write',
  'chat.realtime',
  'live-sessions.read',
  'live-sessions.write',
  'live-sessions.realtime',
  'assets.write',
  'ai.generate',
] as const;

export type InstitutionIntegrationCapability = typeof INSTITUTION_INTEGRATION_CAPABILITIES[number];

/**
 * Describes one upstream system behind the institution gateway. `kind` is
 * deliberately open so standards and vendor APIs can be added without a
 * mobile-app release; provider-specific configuration belongs on the gateway.
 */
export interface InstitutionIntegrationSource {
  id: string;
  kind: string;
  displayName: string;
  version?: string;
  capabilities: InstitutionIntegrationCapability[];
  metadata?: Record<string, unknown>;
}

/** Stable tombstones used by cursor upserts to reconcile add/drop and deletes. */
export interface InstitutionSyncDeletions {
  users?: string[];
  courses?: string[];
  contentItems?: string[];
  threads?: string[];
  messages?: string[];
  submissions?: string[];
}

export interface EnrollmentPayload {
  userId: string;
  courseRole: CourseRole;
  secondaryRoles?: string[];
}

/**
 * Backwards-compatible single-course import shape. Enrollments may be top-level
 * (preferred) or nested in `course` (legacy mock format).
 */
export interface CourseImportPayload {
  course: Omit<Course, 'participantsCount' | 'materialsCount' | 'hasUpdates' | 'nextDueDate' | 'staff'> & {
    enrollments?: EnrollmentPayload[];
  };
  enrollments?: EnrollmentPayload[];
  items?: (Omit<ContentItem, 'id' | 'courseId'> & { id?: string })[];
}

export interface InstitutionDescriptor {
  id: string;
  name: string;
  timeZone: string;
  metadata?: Record<string, unknown>;
}

export interface InstitutionSyncPayload {
  schemaVersion: typeof INSTITUTION_SCHEMA_VERSION;
  syncId: string;
  generatedAt: number;
  mode: 'snapshot' | 'upsert';
  institution: InstitutionDescriptor;
  /** Omit for legacy 1.0 gateways, which are treated as implementing the full contract. */
  integrations?: InstitutionIntegrationSource[];
  users: CourseUser[];
  courses: CourseImportPayload[];
  threads?: ChatThread[];
  messages?: ChatMessage[];
  submissions?: StudentSubmission[];
  /** Must be pre-filtered to the authenticated principal by the gateway. */
  contentProgress?: ContentProgress[];
  /** Valid only for cursor upserts. Every dependent record must also be removed. */
  deletions?: InstitutionSyncDeletions;
  cursor?: string;
  etag?: string;
}

export interface NormalizedCourseImport {
  course: Course;
  enrollments: EnrollmentPayload[];
  items: ContentItem[];
}

export interface NormalizedInstitutionSync
  extends Omit<InstitutionSyncPayload, 'courses'> {
  courses: NormalizedCourseImport[];
}

export type ValidationSeverity = 'error' | 'warning';

export interface ValidationIssue {
  severity: ValidationSeverity;
  code: string;
  path: string;
  message: string;
}

export type ValidationResult<T> =
  | { success: true; data: T; issues: ValidationIssue[] }
  | { success: false; issues: ValidationIssue[] };

const COURSE_ROLES: CourseRole[] = ['teacher', 'ta', 'it', 'student', 'admin'];
const PRESENTATION_MODES: PresentationMode[] = ['timeline', 'sequential', 'custom'];
const CONTENT_CATEGORIES: ContentCategory[] = ['admin', 'material', 'coursework'];
const PRESENTATION_SLOTS: ContentItem['presentationSlot'][] = ['past', 'current', 'future', 'scheduled', 'block-header'];
const ANSWER_TYPES: QuizQuestion['answerType'][] = ['multiple_choice', 'text', 'dropbox', 'timed', 'spectrum', 'custom_code', 'page_break'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const MAX_EXTENSION_CHARACTERS = 65_536;
const MAX_EXTENSION_DEPTH = 12;
const MAX_EXTENSION_NODES = 10_000;
const MAX_QUESTION_POINTS = 1_000_000;
const MAX_INSTITUTION_PAYLOAD_BYTES = 10 * 1024 * 1024;
const MAX_IDENTIFIER_CHARACTERS = 256;
const MAX_LABEL_CHARACTERS = 500;
const MAX_DESCRIPTION_CHARACTERS = 250_000;
const MAX_URL_CHARACTERS = 8_192;
const MAX_QUESTIONS_PER_ITEM = 1_000;
const MAX_OPTIONS_PER_QUESTION = 500;
const MAX_RUBRIC_CRITERIA = 200;
const MAX_ITEMS_PER_COURSE = 10_000;

const normalizeExtensionRecord = (
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): Record<string, unknown> | undefined => {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    issue(issues, 'error', 'invalid_extension', path, 'Institution extensions must be a JSON object.');
    return undefined;
  }

  const seen = new Set<object>();
  let nodes = 0;
  const validateValue = (entry: unknown, entryPath: string, depth: number): boolean => {
    nodes += 1;
    if (nodes > MAX_EXTENSION_NODES) {
      issue(issues, 'error', 'extension_too_complex', path, `Extension data cannot exceed ${MAX_EXTENSION_NODES.toLocaleString()} values.`);
      return false;
    }
    if (depth > MAX_EXTENSION_DEPTH) {
      issue(issues, 'error', 'extension_too_deep', entryPath, `Extension data cannot be nested more than ${MAX_EXTENSION_DEPTH} levels.`);
      return false;
    }
    if (entry === null || typeof entry === 'string' || typeof entry === 'boolean') return true;
    if (typeof entry === 'number') {
      if (!Number.isFinite(entry)) {
        issue(issues, 'error', 'invalid_extension_number', entryPath, 'Extension numbers must be finite JSON numbers.');
        return false;
      }
      return true;
    }
    if (typeof entry !== 'object') {
      issue(issues, 'error', 'invalid_extension_value', entryPath, 'Extension values must be JSON strings, numbers, booleans, nulls, arrays, or objects.');
      return false;
    }
    if (seen.has(entry)) {
      issue(issues, 'error', 'circular_extension', entryPath, 'Extension data cannot contain circular references.');
      return false;
    }
    seen.add(entry);
    let valid = true;
    if (Array.isArray(entry)) {
      entry.forEach((child, index) => {
        valid = validateValue(child, `${entryPath}[${index}]`, depth + 1) && valid;
      });
    } else {
      const prototype = Object.getPrototypeOf(entry);
      if (prototype !== Object.prototype && prototype !== null) {
        issue(issues, 'error', 'invalid_extension_object', entryPath, 'Extension objects must contain plain JSON data.');
        valid = false;
      }
      Object.entries(entry as Record<string, unknown>).forEach(([key, child]) => {
        if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
          issue(issues, 'error', 'unsafe_extension_key', `${entryPath}.${key}`, `Extension key "${key}" is reserved.`);
          valid = false;
        }
        valid = validateValue(child, `${entryPath}.${key}`, depth + 1) && valid;
      });
    }
    seen.delete(entry);
    return valid;
  };

  if (!validateValue(value, path, 0)) return undefined;
  const serialized = JSON.stringify(value);
  if (serialized.length > MAX_EXTENSION_CHARACTERS) {
    issue(issues, 'error', 'extension_too_large', path, `Extension data cannot exceed ${MAX_EXTENSION_CHARACTERS.toLocaleString()} serialized characters.`);
    return undefined;
  }
  return JSON.parse(serialized) as Record<string, unknown>;
};

const cleanString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.trim();
  return cleaned || undefined;
};

const finiteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const validateOptionalBoolean = (
  record: Record<string, unknown>,
  field: string,
  path: string,
  issues: ValidationIssue[],
) => {
  if (record[field] !== undefined && typeof record[field] !== 'boolean') {
    issue(issues, 'error', 'invalid_boolean', `${path}.${field}`, `${field} must be a JSON boolean.`);
  }
};

const validateOptionalNumber = (
  record: Record<string, unknown>,
  field: string,
  path: string,
  issues: ValidationIssue[],
) => {
  if (record[field] !== undefined && finiteNumber(record[field]) === undefined) {
    issue(issues, 'error', 'invalid_number', `${path}.${field}`, `${field} must be a finite JSON number.`);
  }
};

const validateOptionalString = (
  record: Record<string, unknown>,
  field: string,
  path: string,
  issues: ValidationIssue[],
) => {
  if (record[field] !== undefined && typeof record[field] !== 'string') {
    issue(issues, 'error', 'invalid_string', `${path}.${field}`, `${field} must be a JSON string.`);
  }
};

const validateStringLength = (
  value: unknown,
  path: string,
  maxCharacters: number,
  issues: ValidationIssue[],
) => {
  if (typeof value === 'string' && value.length > maxCharacters) {
    issue(issues, 'error', 'string_too_long', path, `Value cannot exceed ${maxCharacters.toLocaleString()} characters.`);
  }
  if (maxCharacters === MAX_IDENTIFIER_CHARACTERS && typeof value === 'string' && /[\u0000-\u001f\u007f]/.test(value)) {
    issue(issues, 'error', 'invalid_identifier', path, 'Identifiers cannot contain control characters.');
  }
};

const timestamp = (value: unknown): number | undefined => {
  const direct = finiteNumber(value);
  if (direct !== undefined) return direct >= 0 ? direct : undefined;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

const isValidTimeZone = (value: string): boolean => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
};

const issue = (
  issues: ValidationIssue[],
  severity: ValidationSeverity,
  code: string,
  path: string,
  message: string,
) => issues.push({ severity, code, path, message });

const rejectUnknownFields = (
  record: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  issues: ValidationIssue[],
) => {
  const allowedFields = new Set(allowed);
  Object.keys(record).forEach(field => {
    if (!allowedFields.has(field)) {
      issue(issues, 'error', 'unknown_field', `${path}.${field}`, `Unsupported field "${field}" would be discarded. Move institution-specific extensions under metadata.`);
    }
  });
};

const requiredString = (
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): string => {
  const parsed = cleanString(value);
  if (!parsed) issue(issues, 'error', 'required_string', path, 'A non-empty string is required.');
  return parsed || '';
};

const uniqueStrings = (
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): string[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    issue(issues, 'error', 'invalid_array', path, 'Expected an array of strings.');
    return [];
  }
  const output: string[] = [];
  value.forEach((entry, index) => {
    const parsed = cleanString(entry);
    if (!parsed) {
      issue(issues, 'error', 'invalid_string', `${path}[${index}]`, 'Expected a non-empty string.');
    } else if (output.includes(parsed)) {
      issue(issues, 'error', 'duplicate_array_value', `${path}[${index}]`, `Duplicate value "${parsed}" is not allowed.`);
    } else {
      output.push(parsed);
    }
  });
  return output;
};

const integrationCapabilitySet = new Set<string>(INSTITUTION_INTEGRATION_CAPABILITIES);

const normalizeIntegrationSources = (
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): InstitutionIntegrationSource[] | undefined => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    issue(issues, 'error', 'invalid_integrations', path, 'integrations must be an array.');
    return [];
  }
  const seenIds = new Set<string>();
  return value.flatMap((raw, index) => {
    const sourcePath = `${path}[${index}]`;
    if (!isRecord(raw)) {
      issue(issues, 'error', 'invalid_integration', sourcePath, 'Each integration source must be a JSON object.');
      return [];
    }
    rejectUnknownFields(raw, ['id', 'kind', 'displayName', 'version', 'capabilities', 'metadata'], sourcePath, issues);
    validateStringLength(raw.id, `${sourcePath}.id`, MAX_IDENTIFIER_CHARACTERS, issues);
    validateStringLength(raw.kind, `${sourcePath}.kind`, 200, issues);
    validateStringLength(raw.displayName, `${sourcePath}.displayName`, MAX_LABEL_CHARACTERS, issues);
    validateStringLength(raw.version, `${sourcePath}.version`, 100, issues);
    const id = requiredString(raw.id, `${sourcePath}.id`, issues);
    const kind = requiredString(raw.kind, `${sourcePath}.kind`, issues);
    const displayName = requiredString(raw.displayName, `${sourcePath}.displayName`, issues);
    if (id && seenIds.has(id)) issue(issues, 'error', 'duplicate_integration_id', `${sourcePath}.id`, `Duplicate integration id "${id}".`);
    seenIds.add(id);
    const capabilities = uniqueStrings(raw.capabilities, `${sourcePath}.capabilities`, issues);
    capabilities.forEach((capability, capabilityIndex) => {
      if (!integrationCapabilitySet.has(capability)) {
        issue(issues, 'error', 'unknown_integration_capability', `${sourcePath}.capabilities[${capabilityIndex}]`, `Unsupported integration capability "${capability}".`);
      }
    });
    return [{
      id,
      kind,
      displayName,
      version: cleanString(raw.version),
      capabilities: capabilities.filter((capability): capability is InstitutionIntegrationCapability => integrationCapabilitySet.has(capability)),
      metadata: normalizeExtensionRecord(raw.metadata, `${sourcePath}.metadata`, issues),
    }];
  });
};

const deletionFields = ['users', 'courses', 'contentItems', 'threads', 'messages', 'submissions'] as const;

const normalizeSyncDeletions = (
  value: unknown,
  mode: 'snapshot' | 'upsert' | undefined,
  issues: ValidationIssue[],
): InstitutionSyncDeletions | undefined => {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    issue(issues, 'error', 'invalid_deletions', 'deletions', 'deletions must be a JSON object.');
    return undefined;
  }
  rejectUnknownFields(value, deletionFields, 'deletions', issues);
  if (mode !== 'upsert') {
    issue(issues, 'error', 'unexpected_deletions', 'deletions', 'Tombstones are valid only in cursor upserts. Complete snapshots express the current state directly.');
  }
  const normalized: InstitutionSyncDeletions = {};
  deletionFields.forEach(field => {
    if (value[field] === undefined) return;
    const ids = uniqueStrings(value[field], `deletions.${field}`, issues);
    ids.forEach((id, index) => validateStringLength(id, `deletions.${field}[${index}]`, MAX_IDENTIFIER_CHARACTERS, issues));
    normalized[field] = ids;
  });
  return normalized;
};

const normalizeQuestion = (
  raw: unknown,
  path: string,
  fallbackId: string,
  issues: ValidationIssue[],
  requireStableIds = false,
): QuizQuestion | null => {
  if (!isRecord(raw)) {
    issue(issues, 'error', 'invalid_question', path, 'Question must be a JSON object.');
    return null;
  }
  rejectUnknownFields(raw, ['id', 'label', 'title', 'content', 'answerType', 'options', 'correctAnswer', 'allowMultipleCorrect', 'gradingType', 'deduction', 'textMatchMode', 'rubric', 'customConfig', 'points'], path, issues);
  ['id', 'label', 'title', 'content'].forEach(field => validateOptionalString(raw, field, path, issues));
  validateStringLength(raw.id, `${path}.id`, MAX_IDENTIFIER_CHARACTERS, issues);
  if (requireStableIds) requiredString(raw.id, `${path}.id`, issues);
  validateStringLength(raw.label, `${path}.label`, 100, issues);
  validateStringLength(raw.title, `${path}.title`, MAX_LABEL_CHARACTERS, issues);
  validateStringLength(raw.content, `${path}.content`, 100_000, issues);
  ['points', 'deduction'].forEach(field => validateOptionalNumber(raw, field, path, issues));
  validateOptionalBoolean(raw, 'allowMultipleCorrect', path, issues);
  if (raw.gradingType !== undefined && raw.gradingType !== 'points' && raw.gradingType !== 'true_false') {
    issue(issues, 'error', 'invalid_grading_type', `${path}.gradingType`, 'gradingType must be points or true_false.');
  }
  if (raw.textMatchMode !== undefined && raw.textMatchMode !== 'exact' && raw.textMatchMode !== 'contains') {
    issue(issues, 'error', 'invalid_text_match_mode', `${path}.textMatchMode`, 'textMatchMode must be exact or contains.');
  }
  if (raw.correctAnswer !== undefined && typeof raw.correctAnswer !== 'string' && !Array.isArray(raw.correctAnswer)) {
    issue(issues, 'error', 'invalid_correct_answer', `${path}.correctAnswer`, 'correctAnswer must be a string or an array of strings.');
  }
  if (raw.rubric !== undefined && !Array.isArray(raw.rubric)) {
    issue(issues, 'error', 'invalid_rubric', `${path}.rubric`, 'rubric must be an array.');
  }

  const answerType = cleanString(raw.answerType) as QuizQuestion['answerType'] | undefined;
  if (!answerType || !ANSWER_TYPES.includes(answerType)) {
    issue(issues, 'error', 'invalid_answer_type', `${path}.answerType`, `Expected one of: ${ANSWER_TYPES.join(', ')}.`);
  }
  const actualType = answerType && ANSWER_TYPES.includes(answerType) ? answerType : 'text';
  const points = finiteNumber(raw.points) ?? (actualType === 'page_break' ? 0 : 0);
  if (points < 0) issue(issues, 'error', 'negative_points', `${path}.points`, 'Points cannot be negative.');
  if (points > MAX_QUESTION_POINTS) issue(issues, 'error', 'points_too_large', `${path}.points`, `Points cannot exceed ${MAX_QUESTION_POINTS.toLocaleString()} per question.`);
  const deduction = finiteNumber(raw.deduction) ?? 0;
  if (deduction < 0) issue(issues, 'error', 'negative_deduction', `${path}.deduction`, 'Deduction cannot be negative.');
  if (deduction > MAX_QUESTION_POINTS) issue(issues, 'error', 'deduction_too_large', `${path}.deduction`, `Deductions cannot exceed ${MAX_QUESTION_POINTS.toLocaleString()} per question.`);

  const options = uniqueStrings(raw.options, `${path}.options`, issues);
  if (options.length > MAX_OPTIONS_PER_QUESTION) issue(issues, 'error', 'too_many_options', `${path}.options`, `A question cannot contain more than ${MAX_OPTIONS_PER_QUESTION} options.`);
  options.forEach((option, optionIndex) => validateStringLength(option, `${path}.options[${optionIndex}]`, 10_000, issues));
  const allowMultipleCorrect = raw.allowMultipleCorrect === true;
  let correctAnswer: string | string[] | undefined;
  if (Array.isArray(raw.correctAnswer)) {
    correctAnswer = uniqueStrings(raw.correctAnswer, `${path}.correctAnswer`, issues);
  } else {
    correctAnswer = cleanString(raw.correctAnswer);
  }
  (Array.isArray(correctAnswer) ? correctAnswer : correctAnswer ? [correctAnswer] : [])
    .forEach((answer, answerIndex) => validateStringLength(answer, `${path}.correctAnswer${Array.isArray(correctAnswer) ? `[${answerIndex}]` : ''}`, 10_000, issues));

  if (actualType === 'multiple_choice') {
    if (options.length < 2) issue(issues, 'error', 'insufficient_options', `${path}.options`, 'Multiple-choice questions require at least two unique options.');
    const answers = Array.isArray(correctAnswer) ? correctAnswer : correctAnswer ? [correctAnswer] : [];
    answers.forEach(answer => {
      if (!options.includes(answer)) issue(issues, 'error', 'answer_not_in_options', `${path}.correctAnswer`, `Correct answer "${answer}" is not one of the options.`);
    });
    if (allowMultipleCorrect && correctAnswer !== undefined && !Array.isArray(correctAnswer)) {
      issue(issues, 'error', 'invalid_multiple_answer', `${path}.correctAnswer`, 'Multiple-correct questions require an array of answers.');
    }
    if (!allowMultipleCorrect && Array.isArray(correctAnswer) && correctAnswer.length > 1) {
      issue(issues, 'error', 'unexpected_multiple_answers', `${path}.correctAnswer`, 'Single-answer questions cannot define more than one correct answer.');
    }
  }

  const customConfig = normalizeExtensionRecord(raw.customConfig, `${path}.customConfig`, issues);
  if (customConfig) {
    ['language', 'initialCode', 'testCases', 'minLabel', 'maxLabel'].forEach(field => validateOptionalString(customConfig, field, `${path}.customConfig`, issues));
    ['min', 'max', 'timerSeconds'].forEach(field => validateOptionalNumber(customConfig, field, `${path}.customConfig`, issues));
    const timerSeconds = finiteNumber(customConfig.timerSeconds);
    if (timerSeconds !== undefined && (!Number.isInteger(timerSeconds) || timerSeconds < 1 || timerSeconds > 86_400)) {
      issue(issues, 'error', 'invalid_live_timer', `${path}.customConfig.timerSeconds`, 'Live question timerSeconds must be a whole number from 1 second to 24 hours.');
    }
    if (customConfig.valueLabels !== undefined && !isRecord(customConfig.valueLabels)) {
      issue(issues, 'error', 'invalid_value_labels', `${path}.customConfig.valueLabels`, 'valueLabels must be a JSON object keyed by spectrum value.');
    }
  }
  if (actualType === 'spectrum') {
    const min = finiteNumber(customConfig?.min) ?? 1;
    const max = finiteNumber(customConfig?.max) ?? 5;
    if (!Number.isInteger(min) || !Number.isInteger(max) || min >= max || max - min > 20) {
      issue(issues, 'error', 'invalid_spectrum_range', `${path}.customConfig`, 'Spectrum min/max must be integers with min < max and no more than 20 choices.');
    }
    if (isRecord(customConfig?.valueLabels)) {
      Object.entries(customConfig.valueLabels).forEach(([key, value]) => {
        const numericKey = Number(key);
        if (!Number.isInteger(numericKey) || numericKey < min || numericKey > max) {
          issue(issues, 'error', 'invalid_value_label_key', `${path}.customConfig.valueLabels.${key}`, 'Spectrum label keys must be integer choices within the configured range.');
        }
        if (typeof value !== 'string' || !value.trim()) {
          issue(issues, 'error', 'invalid_value_label', `${path}.customConfig.valueLabels.${key}`, 'Spectrum labels must be non-empty strings.');
        } else {
          validateStringLength(value, `${path}.customConfig.valueLabels.${key}`, 200, issues);
        }
      });
    }
  }

  const rubric = Array.isArray(raw.rubric)
    ? raw.rubric.flatMap((criterion, index) => {
        const criterionPath = `${path}.rubric[${index}]`;
        if (!isRecord(criterion)) {
          issue(issues, 'error', 'invalid_rubric', criterionPath, 'Rubric criterion must be an object.');
          return [];
        }
        rejectUnknownFields(criterion, ['id', 'label', 'description', 'maxPoints'], criterionPath, issues);
        validateStringLength(criterion.id, `${criterionPath}.id`, MAX_IDENTIFIER_CHARACTERS, issues);
        validateStringLength(criterion.label, `${criterionPath}.label`, MAX_LABEL_CHARACTERS, issues);
        validateStringLength(criterion.description, `${criterionPath}.description`, 5_000, issues);
        const maxPoints = finiteNumber(criterion.maxPoints);
        if (maxPoints === undefined || maxPoints < 0) {
          issue(issues, 'error', 'invalid_rubric_points', `${criterionPath}.maxPoints`, 'Rubric maxPoints must be a non-negative number.');
        }
        if (maxPoints !== undefined && maxPoints > MAX_QUESTION_POINTS) {
          issue(issues, 'error', 'rubric_points_too_large', `${criterionPath}.maxPoints`, `Rubric maxPoints cannot exceed ${MAX_QUESTION_POINTS.toLocaleString()}.`);
        }
        return [{
          id: requiredString(criterion.id, `${criterionPath}.id`, issues),
          label: requiredString(criterion.label, `${criterionPath}.label`, issues),
          description: cleanString(criterion.description),
          maxPoints: Math.max(0, maxPoints ?? 0),
        }];
      })
    : undefined;
  if (Array.isArray(raw.rubric) && raw.rubric.length > MAX_RUBRIC_CRITERIA) {
    issue(issues, 'error', 'too_many_rubric_criteria', `${path}.rubric`, `A question cannot contain more than ${MAX_RUBRIC_CRITERIA} rubric criteria.`);
  }

  if (rubric?.length) {
    const rubricTotal = rubric.reduce((sum, criterion) => sum + criterion.maxPoints, 0);
    if (Math.abs(rubricTotal - Math.max(0, points)) > 0.0001) {
      issue(issues, 'error', 'rubric_total_mismatch', `${path}.rubric`, `Rubric totals ${rubricTotal}, but the question is worth ${points} points.`);
    }
  }
  if (raw.gradingType === 'true_false' && rubric?.length) {
    issue(issues, 'error', 'binary_grading_has_rubric', `${path}.rubric`, 'Correct/incorrect grading cannot also use a point rubric.');
  }

  const question: QuizQuestion = {
    id: cleanString(raw.id) || fallbackId,
    label: typeof raw.label === 'string' ? raw.label.trim() : '',
    title: cleanString(raw.title),
    content: actualType === 'page_break' ? 'Page Break' : requiredString(raw.content, `${path}.content`, issues),
    answerType: actualType,
    options: actualType === 'multiple_choice' ? options : undefined,
    correctAnswer,
    allowMultipleCorrect,
    gradingType: raw.gradingType === 'true_false' ? 'true_false' : 'points',
    deduction: Math.max(0, deduction),
    textMatchMode: raw.textMatchMode === 'contains' ? 'contains' : 'exact',
    rubric,
    customConfig,
    points: actualType === 'page_break' ? 0 : Math.max(0, points),
  };
  return question;
};

const normalizeStudyCard = (
  raw: unknown,
  path: string,
  issues: ValidationIssue[],
): CourseStudyCard | null => {
  if (!isRecord(raw)) {
    issue(issues, 'error', 'invalid_study_card', path, 'Study card must be a JSON object.');
    return null;
  }
  rejectUnknownFields(raw, ['id', 'front', 'back', 'tags', 'sourceExcerpt', 'sourceLocation', 'confidence', 'reviewerEdited', 'reviewerVerified'], path, issues);
  ['id', 'front', 'back', 'sourceExcerpt', 'sourceLocation'].forEach(field => validateOptionalString(raw, field, path, issues));
  ['reviewerEdited', 'reviewerVerified'].forEach(field => validateOptionalBoolean(raw, field, path, issues));
  validateOptionalNumber(raw, 'confidence', path, issues);
  const id = requiredString(raw.id, `${path}.id`, issues);
  const front = requiredString(raw.front, `${path}.front`, issues);
  const back = requiredString(raw.back, `${path}.back`, issues);
  const sourceExcerpt = cleanString(raw.sourceExcerpt);
  const sourceLocation = cleanString(raw.sourceLocation);
  const confidence = finiteNumber(raw.confidence);
  const tags = uniqueStrings(raw.tags, `${path}.tags`, issues);
  if (front.length > 500) issue(issues, 'error', 'study_card_front_too_long', `${path}.front`, 'Study card fronts cannot exceed 500 characters.');
  if (back.length > 2_000) issue(issues, 'error', 'study_card_back_too_long', `${path}.back`, 'Study card backs cannot exceed 2,000 characters.');
  if (sourceExcerpt && sourceExcerpt.length > 600) issue(issues, 'error', 'study_card_evidence_too_long', `${path}.sourceExcerpt`, 'Study card source excerpts cannot exceed 600 characters.');
  if (sourceLocation && sourceLocation.length > 160) issue(issues, 'error', 'study_card_location_too_long', `${path}.sourceLocation`, 'Study card source locations cannot exceed 160 characters.');
  if (tags.length > 20 || tags.some(tag => tag.length > 80)) issue(issues, 'error', 'invalid_study_card_tags', `${path}.tags`, 'Study cards support at most 20 tags of 80 characters each.');
  if (confidence !== undefined && (confidence < 0 || confidence > 1)) issue(issues, 'error', 'invalid_study_card_confidence', `${path}.confidence`, 'Study card confidence must be between 0 and 1.');
  return {
    id,
    front,
    back,
    tags: tags.length ? tags : undefined,
    sourceExcerpt,
    sourceLocation,
    confidence,
    reviewerEdited: raw.reviewerEdited === true,
    reviewerVerified: raw.reviewerVerified === true,
  };
};

const normalizeItem = (
  raw: unknown,
  courseId: string,
  index: number,
  basePath: string,
  fallbackTime: number,
  issues: ValidationIssue[],
  requireStableIds = false,
): ContentItem | null => {
  const path = `${basePath}[${index}]`;
  if (!isRecord(raw)) {
    issue(issues, 'error', 'invalid_item', path, 'Content item must be a JSON object.');
    return null;
  }
  rejectUnknownFields(raw, [
    'id', 'courseId', 'category', 'title', 'description', 'contentUrl', 'isPopQuiz', 'isPoll',
    'releaseDate', 'lockDate', 'availableDate', 'displayDate', 'presentationSlot', 'groupIcon',
    'isHighlighted', 'isGraded', 'gradingCategory', 'isParticipationOnly', 'workType', 'groupSetId',
    'submissionTarget', 'externalUrl', 'questions', 'studyCards', 'videoAlternatives', 'quizConfig', 'createdAt', 'deletedAt', 'orderIndex', 'metadata',
  ], path, issues);
  ['id', 'courseId', 'title', 'description', 'contentUrl', 'groupIcon', 'gradingCategory', 'groupSetId', 'externalUrl']
    .forEach(field => validateOptionalString(raw, field, path, issues));
  validateStringLength(raw.id, `${path}.id`, MAX_IDENTIFIER_CHARACTERS, issues);
  if (requireStableIds) requiredString(raw.id, `${path}.id`, issues);
  validateStringLength(raw.courseId, `${path}.courseId`, MAX_IDENTIFIER_CHARACTERS, issues);
  validateStringLength(raw.title, `${path}.title`, MAX_LABEL_CHARACTERS, issues);
  validateStringLength(raw.description, `${path}.description`, MAX_DESCRIPTION_CHARACTERS, issues);
  validateStringLength(raw.contentUrl, `${path}.contentUrl`, MAX_URL_CHARACTERS, issues);
  validateStringLength(raw.externalUrl, `${path}.externalUrl`, MAX_URL_CHARACTERS, issues);
  ['isPopQuiz', 'isPoll', 'isHighlighted', 'isGraded', 'isParticipationOnly']
    .forEach(field => validateOptionalBoolean(raw, field, path, issues));
  validateOptionalNumber(raw, 'orderIndex', path, issues);
  ['createdAt', 'deletedAt'].forEach(field => {
    if (raw[field] !== undefined && timestamp(raw[field]) === undefined) {
      issue(issues, 'error', 'invalid_timestamp', `${path}.${field}`, `${field} must be an epoch timestamp or ISO-8601 date.`);
    }
  });
  if (raw.courseId !== undefined && cleanString(raw.courseId) !== courseId) {
    issue(issues, 'error', 'content_course_mismatch', `${path}.courseId`, `Content item courseId must match its containing course "${courseId}".`);
  }
  if (raw.workType !== undefined && raw.workType !== 'individual' && raw.workType !== 'group') {
    issue(issues, 'error', 'invalid_work_type', `${path}.workType`, 'workType must be individual or group.');
  }
  if (raw.submissionTarget !== undefined && raw.submissionTarget !== 'in-app' && raw.submissionTarget !== 'external-link') {
    issue(issues, 'error', 'invalid_submission_target', `${path}.submissionTarget`, 'submissionTarget must be in-app or external-link.');
  }
  if (raw.questions !== undefined && !Array.isArray(raw.questions)) {
    issue(issues, 'error', 'invalid_questions', `${path}.questions`, 'questions must be an array.');
  }
  if (Array.isArray(raw.questions) && raw.questions.length > MAX_QUESTIONS_PER_ITEM) {
    issue(issues, 'error', 'too_many_questions', `${path}.questions`, `A content item cannot contain more than ${MAX_QUESTIONS_PER_ITEM.toLocaleString()} questions.`);
  }
  if (raw.studyCards !== undefined && !Array.isArray(raw.studyCards)) {
    issue(issues, 'error', 'invalid_study_cards', `${path}.studyCards`, 'studyCards must be an array.');
  }
  if (raw.createdAt === undefined) {
    issue(issues, 'error', 'missing_timestamp', `${path}.createdAt`, 'createdAt is required for deterministic ordering and audit history.');
  }
  const category = cleanString(raw.category) as ContentCategory | undefined;
  if (!category || !CONTENT_CATEGORIES.includes(category)) {
    issue(issues, 'error', 'invalid_category', `${path}.category`, `Expected one of: ${CONTENT_CATEGORIES.join(', ')}.`);
  }
  const presentationSlot = cleanString(raw.presentationSlot) as ContentItem['presentationSlot'] | undefined;
  if (!presentationSlot || !PRESENTATION_SLOTS.includes(presentationSlot)) {
    issue(issues, 'error', 'invalid_presentation_slot', `${path}.presentationSlot`, `Expected one of: ${PRESENTATION_SLOTS.join(', ')}.`);
  }
  const questions = Array.isArray(raw.questions)
    ? raw.questions.flatMap((question, questionIndex) => {
        const normalized = normalizeQuestion(question, `${path}.questions[${questionIndex}]`, `${courseId}__q_${index + 1}_${questionIndex + 1}`, issues, requireStableIds);
        return normalized ? [normalized] : [];
      })
    : undefined;
  const questionIds = new Set<string>();
  questions?.forEach((question, questionIndex) => {
    if (questionIds.has(question.id)) issue(issues, 'error', 'duplicate_question_id', `${path}.questions[${questionIndex}].id`, `Duplicate question id "${question.id}".`);
    questionIds.add(question.id);
  });
  const studyCards = Array.isArray(raw.studyCards)
    ? raw.studyCards.flatMap((card, cardIndex) => {
        const normalized = normalizeStudyCard(card, `${path}.studyCards[${cardIndex}]`, issues);
        return normalized ? [normalized] : [];
      })
    : undefined;
  if ((raw.studyCards as unknown[] | undefined)?.length && (raw.studyCards as unknown[]).length > 500) {
    issue(issues, 'error', 'too_many_study_cards', `${path}.studyCards`, 'A content item cannot contain more than 500 study cards.');
  }
  const studyCardIds = new Set<string>();
  studyCards?.forEach((card, cardIndex) => {
    if (studyCardIds.has(card.id)) issue(issues, 'error', 'duplicate_study_card_id', `${path}.studyCards[${cardIndex}].id`, `Duplicate study card id "${card.id}".`);
    studyCardIds.add(card.id);
  });
  if (questions?.length && studyCards?.length) issue(issues, 'error', 'mixed_learning_interaction', path, 'A content item cannot mix assessment questions with learner-visible study cards.');
  if (studyCards?.length && (category !== 'material' || raw.isGraded === true || raw.isPoll === true || raw.isPopQuiz === true)) {
    issue(issues, 'error', 'invalid_study_card_item', `${path}.studyCards`, 'Study cards must be ungraded material, not an assessment, poll, or live quiz.');
  }

  let quizConfig: ContentItem['quizConfig'];
  if (raw.quizConfig !== undefined) {
    if (!isRecord(raw.quizConfig)) {
      issue(issues, 'error', 'invalid_quiz_config', `${path}.quizConfig`, 'quizConfig must be an object.');
    } else {
      const rawQuizConfig = raw.quizConfig;
      rejectUnknownFields(rawQuizConfig, ['questionsPerPage', 'maxAttempts', 'allowRevisit', 'timeLimitSeconds', 'enforceTimer'], `${path}.quizConfig`, issues);
      ['maxAttempts', 'timeLimitSeconds'].forEach(field => validateOptionalNumber(rawQuizConfig, field, `${path}.quizConfig`, issues));
      ['allowRevisit', 'enforceTimer'].forEach(field => validateOptionalBoolean(rawQuizConfig, field, `${path}.quizConfig`, issues));
      ['questionsPerPage', 'maxAttempts', 'allowRevisit'].forEach(field => {
        if (rawQuizConfig[field] === undefined) issue(issues, 'error', 'missing_quiz_config', `${path}.quizConfig.${field}`, `${field} is required when quizConfig is present.`);
      });
      if (raw.quizConfig.questionsPerPage !== undefined && raw.quizConfig.questionsPerPage !== 'all' && finiteNumber(raw.quizConfig.questionsPerPage) === undefined) {
        issue(issues, 'error', 'invalid_questions_per_page', `${path}.quizConfig.questionsPerPage`, 'questionsPerPage must be "all" or a finite number.');
      }
      const questionsPerPage = raw.quizConfig.questionsPerPage === 'all'
        ? 'all'
        : finiteNumber(raw.quizConfig.questionsPerPage) ?? 'all';
      const maxAttempts = finiteNumber(raw.quizConfig.maxAttempts) ?? 1;
      const timeLimitSeconds = finiteNumber(raw.quizConfig.timeLimitSeconds);
      if (questionsPerPage !== 'all' && (!Number.isInteger(questionsPerPage) || questionsPerPage < 1)) {
        issue(issues, 'error', 'invalid_questions_per_page', `${path}.quizConfig.questionsPerPage`, 'Use "all" or a positive integer.');
      }
      if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 100) {
        issue(issues, 'error', 'invalid_max_attempts', `${path}.quizConfig.maxAttempts`, 'maxAttempts must be an integer from 1 to 100.');
      }
      if (timeLimitSeconds !== undefined && (!Number.isInteger(timeLimitSeconds) || timeLimitSeconds < 1 || timeLimitSeconds > 604_800)) {
        issue(issues, 'error', 'invalid_time_limit', `${path}.quizConfig.timeLimitSeconds`, 'Time limit must be a whole number from 1 second to 7 days.');
      }
      if (raw.quizConfig.enforceTimer === true && timeLimitSeconds === undefined) {
        issue(issues, 'error', 'timer_without_limit', `${path}.quizConfig.enforceTimer`, 'Timer enforcement requires timeLimitSeconds.');
      }
      quizConfig = {
        questionsPerPage: questionsPerPage === 'all' ? 'all' : Math.max(1, Math.floor(questionsPerPage)),
        maxAttempts: Math.min(100, Math.max(1, Math.floor(maxAttempts))),
        allowRevisit: raw.quizConfig.allowRevisit !== false,
        timeLimitSeconds: timeLimitSeconds && timeLimitSeconds > 0 ? Math.floor(timeLimitSeconds) : undefined,
        enforceTimer: raw.quizConfig.enforceTimer === true,
      };
    }
  }

  const contentUrl = cleanString(raw.contentUrl);
  if (contentUrl && !isSafeHttpsUrl(contentUrl)) {
    issue(issues, 'error', 'unsafe_content_url', `${path}.contentUrl`, 'Content URLs must use HTTPS. Resolve opaque asset IDs to authorized HTTPS URLs in the gateway.');
  }
  const submissionTarget = raw.submissionTarget === 'external-link' ? 'external-link' : 'in-app';
  const externalUrl = cleanString(raw.externalUrl);
  if (submissionTarget === 'external-link' && !externalUrl) {
    issue(issues, 'error', 'missing_external_url', `${path}.externalUrl`, 'External-link submissions require an externalUrl.');
  }
  if (externalUrl && !isSafeHttpsUrl(externalUrl)) {
    issue(issues, 'error', 'unsafe_external_url', `${path}.externalUrl`, 'External submission URLs must use HTTPS.');
  }

  const releaseDate = timestamp(raw.releaseDate);
  const lockDate = timestamp(raw.lockDate);
  if (raw.releaseDate !== undefined && releaseDate === undefined) {
    issue(issues, 'error', 'invalid_timestamp', `${path}.releaseDate`, 'releaseDate must be an epoch timestamp or ISO-8601 date.');
  }
  if (raw.lockDate !== undefined && lockDate === undefined) {
    issue(issues, 'error', 'invalid_timestamp', `${path}.lockDate`, 'lockDate must be an epoch timestamp or ISO-8601 date.');
  }
  if (releaseDate !== undefined && lockDate !== undefined && releaseDate >= lockDate) {
    issue(issues, 'error', 'invalid_availability_range', `${path}.lockDate`, 'lockDate must be after releaseDate.');
  }
  const availableDate = isExplicitContentDateTime(raw.availableDate) ? normalizeContentDateTime(raw.availableDate) : undefined;
  const displayDate = isExplicitContentDateTime(raw.displayDate) ? normalizeContentDateTime(raw.displayDate) : undefined;
  if (raw.availableDate !== undefined && availableDate === undefined) {
    issue(issues, 'error', 'invalid_content_datetime', `${path}.availableDate`, 'Institution JSON dates must be epoch timestamps or ISO-8601 date-times with an explicit offset.');
  }
  if (raw.displayDate !== undefined && displayDate === undefined) {
    issue(issues, 'error', 'invalid_content_datetime', `${path}.displayDate`, 'Institution JSON dates must be epoch timestamps or ISO-8601 date-times with an explicit offset.');
  }
  if (presentationSlot === 'scheduled' && availableDate === undefined) {
    issue(issues, 'error', 'scheduled_without_available_date', `${path}.availableDate`, 'Scheduled content requires an availableDate.');
  }
  if (availableDate && displayDate && parseContentDateTime(displayDate)! < parseContentDateTime(availableDate)!) {
    issue(issues, 'error', 'invalid_content_date_range', `${path}.displayDate`, 'displayDate cannot be before availableDate.');
  }

  const metadata = normalizeExtensionRecord(raw.metadata, `${path}.metadata`, issues);
  const videoAlternativeResult = validateCourseVideoAlternatives(raw.videoAlternatives);
  let videoAlternatives: ContentItem['videoAlternatives'];
  if (!videoAlternativeResult.success) {
    videoAlternativeResult.issues.forEach(alternativeIssue => {
      issue(
        issues,
        'error',
        alternativeIssue.code,
        `${path}.videoAlternatives${alternativeIssue.path ? `.${alternativeIssue.path}` : ''}`,
        alternativeIssue.message,
      );
    });
  } else {
    videoAlternatives = videoAlternativeResult.data;
  }
  const presentationAsset = metadata?.asset;
  const hasVideoAsset = isRecord(presentationAsset)
    && Boolean(cleanString(presentationAsset.id))
    && Boolean(cleanString(presentationAsset.name))
    && isCourseVideoMimeType(presentationAsset.mimeType)
    && isSafeHttpsUrl(presentationAsset.url)
    && (presentationAsset.size === undefined || (typeof presentationAsset.size === 'number' && Number.isFinite(presentationAsset.size) && presentationAsset.size >= 0))
    && (presentationAsset.sha256 === undefined || (typeof presentationAsset.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(presentationAsset.sha256)));
  if (videoAlternatives && !hasVideoAsset) {
    issue(issues, 'error', 'video_alternatives_without_video', `${path}.videoAlternatives`, 'Video alternatives can only be attached to an institution-hosted video asset.');
  } else if (videoAlternatives && !areVideoCaptionTracksBoundToAsset(videoAlternatives, isRecord(presentationAsset) ? presentationAsset.url : undefined)) {
    issue(issues, 'error', 'cross_origin_video_caption_url', `${path}.videoAlternatives.captionTracks`, 'Caption tracks must share the authorized video asset HTTPS origin so rendering cannot create a silent third-party request.');
  }

  const item: ContentItem = {
    id: cleanString(raw.id) || `${courseId}__item_${index + 1}`,
    courseId,
    category: category && CONTENT_CATEGORIES.includes(category) ? category : 'material',
    title: requiredString(raw.title, `${path}.title`, issues),
    description: typeof raw.description === 'string' ? raw.description : undefined,
    contentUrl,
    isPopQuiz: raw.isPopQuiz === true,
    isPoll: raw.isPoll === true,
    releaseDate,
    lockDate,
    availableDate,
    displayDate,
    presentationSlot: presentationSlot && PRESENTATION_SLOTS.includes(presentationSlot) ? presentationSlot : 'current',
    groupIcon: cleanString(raw.groupIcon),
    isHighlighted: raw.isHighlighted === true,
    isGraded: raw.isPoll === true ? false : raw.isGraded === true,
    gradingCategory: cleanString(raw.gradingCategory),
    isParticipationOnly: raw.isParticipationOnly === true,
    workType: raw.workType === 'group' ? 'group' : 'individual',
    groupSetId: cleanString(raw.groupSetId),
    submissionTarget,
    externalUrl,
    questions,
    studyCards,
    videoAlternatives,
    quizConfig,
    createdAt: timestamp(raw.createdAt) ?? fallbackTime,
    deletedAt: timestamp(raw.deletedAt),
    orderIndex: finiteNumber(raw.orderIndex),
    metadata,
  };
  if (questions) {
    validateAssessment(item).forEach(assessmentIssue => {
      if (assessmentIssue.code === 'missing_correct_answer') {
        issue(issues, 'warning', 'server_graded_answer_redacted', `${path}.${assessmentIssue.path}`, 'No client answer key was supplied. The institution grading service must score this question authoritatively.');
        return;
      }
      issue(issues, assessmentIssue.severity, assessmentIssue.code, `${path}.${assessmentIssue.path}`, assessmentIssue.message);
    });
  }
  return item;
};

export function validateCourseImport(
  input: unknown,
  directoryUsers: CourseUser[],
  basePath = 'courseImport',
  options: { requireStableIds?: boolean } = {},
): ValidationResult<NormalizedCourseImport> {
  const issues: ValidationIssue[] = [];
  if (!isRecord(input)) {
    return { success: false, issues: [{ severity: 'error', code: 'invalid_payload', path: basePath, message: 'Course import must be a JSON object.' }] };
  }
  if (!isRecord(input.course)) {
    return { success: false, issues: [{ severity: 'error', code: 'missing_course', path: `${basePath}.course`, message: 'A course object is required.' }] };
  }

  rejectUnknownFields(input, ['course', 'enrollments', 'items'], basePath, issues);
  if (input.enrollments !== undefined && !Array.isArray(input.enrollments)) {
    issue(issues, 'error', 'invalid_enrollments', `${basePath}.enrollments`, 'enrollments must be an array.');
  }
  if (input.items !== undefined && !Array.isArray(input.items)) {
    issue(issues, 'error', 'invalid_items', `${basePath}.items`, 'items must be an array.');
  }

  const rawCourse = input.course;
  rejectUnknownFields(rawCourse, [
    'id', 'title', 'timeZone', 'status', 'description', 'presentationMode', 'participantsCount', 'materialsCount',
    'currentGrade', 'staff', 'announcements', 'termStart', 'termEnd', 'gradingWeights', 'visibilityTimer',
    'groupSets', 'hasUpdates', 'nextDueDate', 'metadata', 'enrollments',
  ], `${basePath}.course`, issues);
  ['id', 'title', 'timeZone', 'description', 'currentGrade'].forEach(field => validateOptionalString(rawCourse, field, `${basePath}.course`, issues));
  validateStringLength(rawCourse.id, `${basePath}.course.id`, MAX_IDENTIFIER_CHARACTERS, issues);
  validateStringLength(rawCourse.title, `${basePath}.course.title`, MAX_LABEL_CHARACTERS, issues);
  validateStringLength(rawCourse.description, `${basePath}.course.description`, MAX_DESCRIPTION_CHARACTERS, issues);
  validateStringLength(rawCourse.timeZone, `${basePath}.course.timeZone`, 200, issues);
  const courseTimeZone = cleanString(rawCourse.timeZone);
  if (courseTimeZone && !isValidTimeZone(courseTimeZone)) issue(issues, 'error', 'invalid_time_zone', `${basePath}.course.timeZone`, 'Course timeZone must be a valid IANA identifier.');
  validateOptionalBoolean(rawCourse, 'hasUpdates', `${basePath}.course`, issues);
  ['participantsCount', 'materialsCount', 'visibilityTimer'].forEach(field => validateOptionalNumber(rawCourse, field, `${basePath}.course`, issues));
  if (rawCourse.announcements === undefined || !Array.isArray(rawCourse.announcements)) {
    issue(issues, 'error', 'invalid_announcements', `${basePath}.course.announcements`, 'announcements must be an array, even when empty.');
  }
  if (rawCourse.staff !== undefined && !Array.isArray(rawCourse.staff)) {
    issue(issues, 'error', 'invalid_course_staff', `${basePath}.course.staff`, 'staff must be an array when a normalized course projection includes it.');
  }
  if (rawCourse.enrollments !== undefined && !Array.isArray(rawCourse.enrollments)) {
    issue(issues, 'error', 'invalid_enrollments', `${basePath}.course.enrollments`, 'course.enrollments must be an array.');
  }
  if (Array.isArray(input.enrollments) && Array.isArray(rawCourse.enrollments)) {
    issue(issues, 'error', 'duplicate_enrollment_source', `${basePath}.course.enrollments`, 'Provide enrollments either beside course or inside course, not in both locations.');
  }
  if (rawCourse.nextDueDate !== undefined && timestamp(rawCourse.nextDueDate) === undefined) {
    issue(issues, 'error', 'invalid_timestamp', `${basePath}.course.nextDueDate`, 'nextDueDate must be an epoch timestamp or ISO-8601 date.');
  }
  if (rawCourse.visibilityTimer === undefined) {
    issue(issues, 'error', 'missing_visibility_timer', `${basePath}.course.visibilityTimer`, 'visibilityTimer is required; use 0 to disable advance visibility.');
  }
  if (rawCourse.gradingWeights === undefined) {
    issue(issues, 'error', 'invalid_grading_weights', `${basePath}.course.gradingWeights`, 'gradingWeights is required; use an empty object for an ungraded course.');
  }
  const courseId = requiredString(rawCourse.id, `${basePath}.course.id`, issues);
  const rawEnrollments = Array.isArray(input.enrollments)
    ? input.enrollments
    : Array.isArray(rawCourse.enrollments)
      ? rawCourse.enrollments
      : [];
  if (!rawEnrollments.length) issue(issues, 'warning', 'empty_enrollments', `${basePath}.enrollments`, 'Course has no enrollments.');

  const userById = new Map(directoryUsers.map(user => [user.id, user]));
  const enrollmentUserIds = new Set<string>();
  const enrollments: EnrollmentPayload[] = rawEnrollments.flatMap((raw, index) => {
    const path = `${basePath}.enrollments[${index}]`;
    if (!isRecord(raw)) {
      issue(issues, 'error', 'invalid_enrollment', path, 'Enrollment must be an object.');
      return [];
    }
    rejectUnknownFields(raw, ['userId', 'courseRole', 'secondaryRoles'], path, issues);
    const userId = requiredString(raw.userId, `${path}.userId`, issues);
    const role = cleanString(raw.courseRole) as CourseRole | undefined;
    if (!role || !COURSE_ROLES.includes(role)) issue(issues, 'error', 'invalid_course_role', `${path}.courseRole`, `Expected one of: ${COURSE_ROLES.join(', ')}.`);
    if (enrollmentUserIds.has(userId)) issue(issues, 'error', 'duplicate_enrollment', `${path}.userId`, `User "${userId}" is enrolled more than once.`);
    enrollmentUserIds.add(userId);
    if (userId && !userById.has(userId)) issue(issues, 'error', 'unknown_user', `${path}.userId`, `User "${userId}" is not present in the institution user directory.`);
    return [{ userId, courseRole: role && COURSE_ROLES.includes(role) ? role : 'student', secondaryRoles: uniqueStrings(raw.secondaryRoles, `${path}.secondaryRoles`, issues) }];
  });

  const staff: CourseUser[] = enrollments.flatMap(enrollment => {
    const user = userById.get(enrollment.userId);
    return user ? [{ ...user, role: enrollment.courseRole, secondaryRoles: enrollment.secondaryRoles }] : [];
  });
  if (Array.isArray(rawCourse.staff)) {
    const suppliedStaffIds = rawCourse.staff.flatMap((member, index) => {
      const path = `${basePath}.course.staff[${index}]`;
      if (!isRecord(member)) {
        issue(issues, 'error', 'invalid_course_staff', path, 'Each staff projection must be an object.');
        return [];
      }
      rejectUnknownFields(member, ['id', 'name', 'email', 'role', 'secondaryRoles', 'metadata'], path, issues);
      const id = requiredString(member.id, `${path}.id`, issues);
      const derived = staff.find(candidate => candidate.id === id);
      if (derived && (
        member.name !== derived.name
        || member.email !== derived.email
        || member.role !== derived.role
        || JSON.stringify(member.secondaryRoles ?? []) !== JSON.stringify(derived.secondaryRoles ?? [])
      )) {
        issue(issues, 'error', 'derived_staff_mismatch', path, 'Staff identity, role, and secondary roles must match the institution directory and enrollment.');
      }
      normalizeExtensionRecord(member.metadata, `${path}.metadata`, issues);
      return id ? [id] : [];
    }).sort();
    const derivedStaffIds = staff.map(member => member.id).sort();
    if (JSON.stringify(suppliedStaffIds) !== JSON.stringify(derivedStaffIds)) {
      issue(issues, 'error', 'derived_staff_mismatch', `${basePath}.course.staff`, 'course.staff must contain exactly the users represented by enrollments.');
    }
  }

  const studentIds = new Set(staff.filter(member => member.role === 'student').map(member => member.id));
  const groupSets: CourseGroupSet[] = Array.isArray(rawCourse.groupSets)
    ? rawCourse.groupSets.flatMap((rawGroupSet, groupSetIndex) => {
        const groupSetPath = `${basePath}.course.groupSets[${groupSetIndex}]`;
        if (!isRecord(rawGroupSet)) {
          issue(issues, 'error', 'invalid_group_set', groupSetPath, 'A group set must be an object.');
          return [];
        }
        rejectUnknownFields(rawGroupSet, ['id', 'name', 'groups'], groupSetPath, issues);
        validateStringLength(rawGroupSet.id, `${groupSetPath}.id`, MAX_IDENTIFIER_CHARACTERS, issues);
        validateStringLength(rawGroupSet.name, `${groupSetPath}.name`, MAX_LABEL_CHARACTERS, issues);
        const groups = Array.isArray(rawGroupSet.groups)
          ? rawGroupSet.groups.flatMap((rawGroup, groupIndex) => {
              const groupPath = `${groupSetPath}.groups[${groupIndex}]`;
              if (!isRecord(rawGroup)) {
                issue(issues, 'error', 'invalid_group', groupPath, 'A course group must be an object.');
                return [];
              }
              rejectUnknownFields(rawGroup, ['id', 'name', 'memberIds'], groupPath, issues);
              validateStringLength(rawGroup.id, `${groupPath}.id`, MAX_IDENTIFIER_CHARACTERS, issues);
              validateStringLength(rawGroup.name, `${groupPath}.name`, MAX_LABEL_CHARACTERS, issues);
              const memberIds = uniqueStrings(rawGroup.memberIds, `${groupPath}.memberIds`, issues);
              memberIds.forEach((memberId, memberIndex) => {
                if (!studentIds.has(memberId)) issue(issues, 'error', 'group_member_not_student', `${groupPath}.memberIds[${memberIndex}]`, `Group member "${memberId}" must be enrolled as a student.`);
              });
              return [{
                id: requiredString(rawGroup.id, `${groupPath}.id`, issues),
                name: requiredString(rawGroup.name, `${groupPath}.name`, issues),
                memberIds,
              }];
            })
          : [];
        if (rawGroupSet.groups !== undefined && !Array.isArray(rawGroupSet.groups)) {
          issue(issues, 'error', 'invalid_groups', `${groupSetPath}.groups`, 'Group-set groups must be an array.');
        }
        const groupIds = new Set<string>();
        const groupNames = new Set<string>();
        const assignedMembers = new Set<string>();
        groups.forEach((group, groupIndex) => {
          const normalizedName = group.name.toLocaleLowerCase();
          if (groupIds.has(group.id)) issue(issues, 'error', 'duplicate_group_id', `${groupSetPath}.groups[${groupIndex}].id`, `Group id "${group.id}" is duplicated in this group set.`);
          if (groupNames.has(normalizedName)) issue(issues, 'error', 'duplicate_group_name', `${groupSetPath}.groups[${groupIndex}].name`, `Group name "${group.name}" is duplicated in this group set.`);
          groupIds.add(group.id);
          groupNames.add(normalizedName);
          group.memberIds.forEach(memberId => {
            if (assignedMembers.has(memberId)) issue(issues, 'error', 'duplicate_group_membership', `${groupSetPath}.groups[${groupIndex}].memberIds`, `Student "${memberId}" belongs to more than one group in this group set.`);
            assignedMembers.add(memberId);
          });
        });
        return [{
          id: requiredString(rawGroupSet.id, `${groupSetPath}.id`, issues),
          name: requiredString(rawGroupSet.name, `${groupSetPath}.name`, issues),
          groups,
        }];
      })
    : [];
  if (rawCourse.groupSets !== undefined && !Array.isArray(rawCourse.groupSets)) {
    issue(issues, 'error', 'invalid_group_sets', `${basePath}.course.groupSets`, 'Course groupSets must be an array.');
  }
  const groupSetIds = new Set<string>();
  groupSets.forEach((groupSet, groupSetIndex) => {
    if (groupSetIds.has(groupSet.id)) issue(issues, 'error', 'duplicate_group_set_id', `${basePath}.course.groupSets[${groupSetIndex}].id`, `Group-set id "${groupSet.id}" is duplicated.`);
    groupSetIds.add(groupSet.id);
  });
  if (!groupSets.length) {
    const legacyGroupNames = Array.from(new Set(staff
      .filter(member => member.role === 'student')
      .flatMap(member => member.secondaryRoles ?? [])));
    if (legacyGroupNames.length) {
      groupSets.push({
        id: 'legacy-assignment-groups',
        name: 'Legacy Assignment Groups',
        groups: legacyGroupNames.map(name => ({
          id: name,
          name,
          memberIds: staff.filter(member => member.role === 'student' && member.secondaryRoles?.includes(name)).map(member => member.id),
        })),
      });
      groupSetIds.add('legacy-assignment-groups');
      issue(issues, 'warning', 'legacy_group_model', `${basePath}.course.groupSets`, 'Assignment groups were inferred from secondaryRoles. Export explicit groupSets to keep sections, cohorts, and assignment groups unambiguous.');
    }
  }

  const gradingWeights: Record<string, number> = {};
  if (rawCourse.gradingWeights !== undefined && !isRecord(rawCourse.gradingWeights)) {
    issue(issues, 'error', 'invalid_grading_weights', `${basePath}.course.gradingWeights`, 'Grading weights must be a JSON object.');
  } else if (isRecord(rawCourse.gradingWeights)) {
    Object.entries(rawCourse.gradingWeights).forEach(([name, rawWeight]) => {
      const label = cleanString(name);
      const weight = finiteNumber(rawWeight);
      if (!label) {
        issue(issues, 'error', 'invalid_grading_label', `${basePath}.course.gradingWeights`, 'Grading category labels must be non-empty.');
      } else if (Object.keys(gradingWeights).some(existing => existing.toLocaleLowerCase() === label.toLocaleLowerCase())) {
        issue(issues, 'error', 'duplicate_grading_label', `${basePath}.course.gradingWeights.${name}`, `Grading category "${label}" is duplicated.`);
      } else if (weight === undefined || weight < 0 || weight > 100) {
        issue(issues, 'error', 'invalid_grading_weight', `${basePath}.course.gradingWeights.${name}`, 'Each grading weight must be between 0 and 100.');
      } else {
        gradingWeights[label] = weight;
      }
    });
    const total = Object.values(gradingWeights).reduce((sum, value) => sum + value, 0);
    if (Object.keys(gradingWeights).length && Math.abs(total - 100) > 0.01) {
      issue(issues, 'error', 'grading_weights_total', `${basePath}.course.gradingWeights`, `Grading weights total ${total}; expected 100.`);
    }
  }

  const termStart = timestamp(rawCourse.termStart) ?? 0;
  const termEnd = timestamp(rawCourse.termEnd) ?? 0;
  if (timestamp(rawCourse.termStart) === undefined) issue(issues, 'error', 'invalid_timestamp', `${basePath}.course.termStart`, 'termStart must be an epoch timestamp or ISO-8601 date.');
  if (timestamp(rawCourse.termEnd) === undefined) issue(issues, 'error', 'invalid_timestamp', `${basePath}.course.termEnd`, 'termEnd must be an epoch timestamp or ISO-8601 date.');
  if (termStart >= termEnd) issue(issues, 'error', 'invalid_term_range', `${basePath}.course.termEnd`, 'termEnd must be after termStart.');
  const visibilityTimer = finiteNumber(rawCourse.visibilityTimer) ?? 0;
  if (!Number.isInteger(visibilityTimer) || visibilityTimer < 0 || visibilityTimer > 8760) {
    issue(issues, 'error', 'invalid_visibility_timer', `${basePath}.course.visibilityTimer`, 'visibilityTimer must be a whole number from 0 to 8,760 hours.');
  }

  const announcements: CourseAnnouncement[] = Array.isArray(rawCourse.announcements)
    ? rawCourse.announcements.flatMap((raw, index) => {
        const path = `${basePath}.course.announcements[${index}]`;
        if (!isRecord(raw)) {
          issue(issues, 'error', 'invalid_announcement', path, 'Announcement must be an object.');
          return [];
        }
        rejectUnknownFields(raw, ['id', 'title', 'content', 'type', 'createdAt'], path, issues);
        ['id', 'title', 'content'].forEach(field => validateOptionalString(raw, field, path, issues));
        validateStringLength(raw.id, `${path}.id`, MAX_IDENTIFIER_CHARACTERS, issues);
        validateStringLength(raw.title, `${path}.title`, MAX_LABEL_CHARACTERS, issues);
        validateStringLength(raw.content, `${path}.content`, 100_000, issues);
        if (raw.type !== 'info' && raw.type !== 'alert') {
          issue(issues, 'error', 'invalid_announcement_type', `${path}.type`, 'Announcement type must be info or alert.');
        }
        if (timestamp(raw.createdAt) === undefined) {
          issue(issues, 'error', 'invalid_timestamp', `${path}.createdAt`, 'Announcement createdAt must be an epoch timestamp or ISO-8601 date.');
        }
        return [{
          id: requiredString(raw.id, `${path}.id`, issues),
          title: requiredString(raw.title, `${path}.title`, issues),
          content: requiredString(raw.content, `${path}.content`, issues),
          type: raw.type === 'alert' ? 'alert' : 'info',
          createdAt: timestamp(raw.createdAt) ?? termStart,
        }];
      })
    : [];

  const rawItems = Array.isArray(input.items) ? input.items : [];
  if (rawItems.length > MAX_ITEMS_PER_COURSE) {
    issue(issues, 'error', 'too_many_content_items', `${basePath}.items`, `A single course payload cannot contain more than ${MAX_ITEMS_PER_COURSE.toLocaleString()} content items; use incremental synchronization.`);
  }
  const items = rawItems.flatMap((raw, index) => {
    const normalized = normalizeItem(raw, courseId, index, `${basePath}.items`, termStart, issues, options.requireStableIds === true);
    return normalized ? [normalized] : [];
  });
  const itemIds = new Set<string>();
  items.forEach((item, index) => {
    if (itemIds.has(item.id)) issue(issues, 'error', 'duplicate_item_id', `${basePath}.items[${index}].id`, `Duplicate content item id "${item.id}".`);
    itemIds.add(item.id);
    if (item.workType === 'group') {
      const matchedGroupSet = item.groupSetId
        ? groupSets.find(groupSet => groupSet.id === item.groupSetId)
        : groupSets.length === 1 ? groupSets[0] : undefined;
      if (!matchedGroupSet) {
        issue(issues, 'error', item.groupSetId ? 'unknown_group_set' : 'missing_group_set', `${basePath}.items[${index}].groupSetId`, item.groupSetId
          ? `Group set "${item.groupSetId}" is not defined by the course.`
          : 'Group coursework must select a course group set.');
      } else if (!matchedGroupSet.groups.length) {
        issue(issues, 'error', 'empty_group_set', `${basePath}.items[${index}].groupSetId`, 'Group coursework cannot use an empty group set.');
      } else {
        item.groupSetId = matchedGroupSet.id;
      }
    } else if (item.groupSetId) {
      issue(issues, 'error', 'individual_has_group_set', `${basePath}.items[${index}].groupSetId`, 'Individual coursework cannot select a group set.');
    }
    const gradingCategories = Object.keys(gradingWeights);
    if (item.isGraded && gradingCategories.length) {
      const matchedCategory = item.gradingCategory
        ? gradingCategories.find(category => category.toLocaleLowerCase() === item.gradingCategory?.toLocaleLowerCase())
        : gradingCategories.length === 1 ? gradingCategories[0] : undefined;
      if (!matchedCategory) {
        issue(issues, 'error', item.gradingCategory ? 'unknown_grading_category' : 'missing_grading_category', `${basePath}.items[${index}].gradingCategory`, item.gradingCategory
          ? `Grading category "${item.gradingCategory}" is not defined in course.gradingWeights.`
          : 'Graded content must select one of the course grading categories.');
      } else {
        item.gradingCategory = matchedCategory;
      }
    }
    const requiresSubmissionDefinition = item.category === 'coursework' && (item.isGraded || item.isPoll || item.isPopQuiz) && item.submissionTarget !== 'external-link';
    if (requiresSubmissionDefinition && !(item.questions || []).some(question => question.answerType !== 'page_break')) {
      issue(issues, 'error', 'missing_submission_definition', `${basePath}.items[${index}].questions`, 'Assessments, polls, and graded in-app coursework require at least one answerable question or upload field.');
    }
    const configuredGradeMaximum = item.metadata?.gradingMaxPoints;
    if (configuredGradeMaximum !== undefined) {
      if (item.submissionTarget !== 'external-link') {
        issue(issues, 'error', 'unexpected_grading_maximum', `${basePath}.items[${index}].metadata.gradingMaxPoints`, 'gradingMaxPoints is only supported for external-link grade columns.');
      } else if (typeof configuredGradeMaximum !== 'number' || !Number.isFinite(configuredGradeMaximum) || configuredGradeMaximum <= 0 || configuredGradeMaximum > 1_000_000) {
        issue(issues, 'error', 'invalid_grading_maximum', `${basePath}.items[${index}].metadata.gradingMaxPoints`, 'External gradingMaxPoints must be a finite number greater than zero and no more than 1,000,000.');
      }
    }
    if (item.isGraded && item.submissionTarget === 'external-link' && getGradingMaxScore(item) <= 0) {
      issue(issues, 'error', 'missing_grading_maximum', `${basePath}.items[${index}].metadata.gradingMaxPoints`, 'A graded external-link item needs answerable questions or a positive metadata.gradingMaxPoints value.');
    }
  });

  const presentationMode = cleanString(rawCourse.presentationMode) as PresentationMode | undefined;
  if (!presentationMode || !PRESENTATION_MODES.includes(presentationMode)) {
    issue(issues, 'error', 'invalid_presentation_mode', `${basePath}.course.presentationMode`, `Expected one of: ${PRESENTATION_MODES.join(', ')}.`);
  }
  const status = rawCourse.status === 'past' ? 'past' : rawCourse.status === 'active' ? 'active' : undefined;
  if (!status) issue(issues, 'error', 'invalid_course_status', `${basePath}.course.status`, 'Expected "active" or "past".');

  const course: Course = {
    id: courseId,
    title: requiredString(rawCourse.title, `${basePath}.course.title`, issues),
    timeZone: courseTimeZone,
    status: status || 'active',
    description: typeof rawCourse.description === 'string' ? rawCourse.description : '',
    presentationMode: presentationMode && PRESENTATION_MODES.includes(presentationMode) ? presentationMode : 'timeline',
    participantsCount: staff.filter(user => user.role === 'student').length,
    materialsCount: items.length,
    currentGrade: cleanString(rawCourse.currentGrade),
    staff,
    announcements,
    termStart,
    termEnd,
    gradingWeights,
    visibilityTimer: Math.min(8760, Math.max(0, Math.floor(visibilityTimer))),
    groupSets,
    hasUpdates: rawCourse.hasUpdates === true,
    nextDueDate: timestamp(rawCourse.nextDueDate),
    metadata: normalizeExtensionRecord(rawCourse.metadata, `${basePath}.course.metadata`, issues),
  };

  const derivedParticipantsCount = staff.filter(user => user.role === 'student').length;
  const derivedMaterialsCount = items.length;
  if (rawCourse.participantsCount !== undefined && finiteNumber(rawCourse.participantsCount) !== derivedParticipantsCount) {
    issue(issues, 'error', 'derived_count_mismatch', `${basePath}.course.participantsCount`, `participantsCount must equal the ${derivedParticipantsCount} enrolled students.`);
  }
  if (rawCourse.materialsCount !== undefined && finiteNumber(rawCourse.materialsCount) !== derivedMaterialsCount) {
    issue(issues, 'error', 'derived_count_mismatch', `${basePath}.course.materialsCount`, `materialsCount must equal the ${derivedMaterialsCount} imported items.`);
  }

  if (issues.some(entry => entry.severity === 'error')) return { success: false, issues };
  return { success: true, data: { course, enrollments, items }, issues };
}

const normalizeDirectoryUser = (
  raw: unknown,
  index: number,
  issues: ValidationIssue[],
): CourseUser | null => {
  const path = `users[${index}]`;
  if (!isRecord(raw)) {
    issue(issues, 'error', 'invalid_user', path, 'User must be a JSON object.');
    return null;
  }
  rejectUnknownFields(raw, ['id', 'name', 'email', 'role', 'secondaryRoles', 'metadata'], path, issues);
  validateStringLength(raw.id, `${path}.id`, MAX_IDENTIFIER_CHARACTERS, issues);
  validateStringLength(raw.name, `${path}.name`, MAX_LABEL_CHARACTERS, issues);
  validateStringLength(raw.email, `${path}.email`, 320, issues);
  if (raw.email !== undefined && typeof raw.email !== 'string') {
    issue(issues, 'error', 'invalid_string', `${path}.email`, 'email must be a JSON string.');
  }
  const email = cleanString(raw.email)?.toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) issue(issues, 'error', 'invalid_email', `${path}.email`, 'Email address is invalid.');
  const role = cleanString(raw.role) as CourseRole | undefined;
  if (!role || !COURSE_ROLES.includes(role)) issue(issues, 'error', 'invalid_course_role', `${path}.role`, `Expected one of: ${COURSE_ROLES.join(', ')}.`);
  return {
    id: requiredString(raw.id, `${path}.id`, issues),
    name: requiredString(raw.name, `${path}.name`, issues),
    email,
    role: role && COURSE_ROLES.includes(role) ? role : 'student',
    secondaryRoles: uniqueStrings(raw.secondaryRoles, `${path}.secondaryRoles`, issues),
    metadata: normalizeExtensionRecord(raw.metadata, `${path}.metadata`, issues),
  };
};

/** Validates a single, authenticated directory lookup result. */
export const validateDirectoryUser = (input: unknown): ValidationResult<CourseUser> => {
  const issues: ValidationIssue[] = [];
  const user = normalizeDirectoryUser(input, 0, issues);
  if (!user || issues.some(entry => entry.severity === 'error')) return { success: false, issues };
  return { success: true, data: user, issues };
};

const normalizeThread = (
  raw: unknown,
  index: number,
  courseIds: Set<string>,
  userIds: Set<string>,
  issues: ValidationIssue[],
): ChatThread | null => {
  const path = `threads[${index}]`;
  if (!isRecord(raw)) {
    issue(issues, 'error', 'invalid_thread', path, 'Thread must be a JSON object.');
    return null;
  }
  rejectUnknownFields(raw, ['id', 'courseId', 'title', 'isAnnouncement', 'createdAt', 'updatedAt', 'scope', 'groupId', 'groupSetId', 'participantIds', 'createdBy', 'isLocked', 'description', 'guidelines', 'kind', 'opensAt', 'closesAt', 'isPinned', 'allowStudentPosts', 'allowReplies', 'allowAttachments', 'allowMentions', 'unreadCount', 'lastMessagePreview', 'lastMessageAt'], path, issues);
  ['id', 'courseId', 'title', 'groupId', 'groupSetId', 'createdBy', 'description', 'guidelines', 'kind', 'lastMessagePreview'].forEach(field => validateOptionalString(raw, field, path, issues));
  ['id', 'courseId', 'groupId', 'groupSetId', 'createdBy'].forEach(field => validateStringLength(raw[field], `${path}.${field}`, MAX_IDENTIFIER_CHARACTERS, issues));
  validateStringLength(raw.title, `${path}.title`, MAX_LABEL_CHARACTERS, issues);
  validateStringLength(raw.description, `${path}.description`, 4_000, issues);
  validateStringLength(raw.guidelines, `${path}.guidelines`, 4_000, issues);
  validateStringLength(raw.lastMessagePreview, `${path}.lastMessagePreview`, 500, issues);
  ['isAnnouncement', 'isLocked', 'isPinned', 'allowStudentPosts', 'allowReplies', 'allowAttachments', 'allowMentions'].forEach(field => validateOptionalBoolean(raw, field, path, issues));
  validateOptionalNumber(raw, 'unreadCount', path, issues);
  ['createdAt', 'updatedAt', 'lastMessageAt', 'opensAt', 'closesAt'].forEach(field => {
    if (raw[field] !== undefined && timestamp(raw[field]) === undefined) {
      issue(issues, 'error', 'invalid_timestamp', `${path}.${field}`, `${field} must be an epoch timestamp or ISO-8601 date.`);
    }
  });
  if (raw.scope !== undefined && raw.scope !== 'direct' && raw.scope !== 'group' && raw.scope !== 'course') {
    issue(issues, 'error', 'invalid_thread_scope', `${path}.scope`, 'Expected course, group, or direct.');
  }
  const scope = raw.scope === 'direct' || raw.scope === 'group' || raw.scope === 'course' ? raw.scope : 'course';
  const threadKinds = ['discussion', 'q-and-a', 'announcements', 'study-group', 'office-hours'] as const;
  const kind = typeof raw.kind === 'string' && threadKinds.includes(raw.kind as typeof threadKinds[number]) ? raw.kind as typeof threadKinds[number] : undefined;
  if (raw.kind !== undefined && !kind) issue(issues, 'error', 'invalid_thread_kind', `${path}.kind`, `Expected one of: ${threadKinds.join(', ')}.`);
  const courseId = cleanString(raw.courseId);
  const participantIds = uniqueStrings(raw.participantIds, `${path}.participantIds`, issues);
  if (scope !== 'direct' && !courseId) issue(issues, 'error', 'missing_course', `${path}.courseId`, 'Course and group threads require courseId.');
  if (courseId && !courseIds.has(courseId)) issue(issues, 'error', 'unknown_course', `${path}.courseId`, `Course "${courseId}" does not exist in this payload.`);
  participantIds.forEach((userId, participantIndex) => {
    if (!userIds.has(userId)) issue(issues, 'error', 'unknown_user', `${path}.participantIds[${participantIndex}]`, `User "${userId}" does not exist in this payload.`);
  });
  if (scope === 'direct' && participantIds.length !== 2) issue(issues, 'error', 'invalid_direct_participants', `${path}.participantIds`, 'Direct threads require exactly two unique participants.');
  const groupId = cleanString(raw.groupId);
  const groupSetId = cleanString(raw.groupSetId);
  if (scope === 'group' && !groupId) issue(issues, 'error', 'missing_group', `${path}.groupId`, 'Group threads require groupId.');
  const createdBy = requiredString(raw.createdBy, `${path}.createdBy`, issues);
  if (createdBy && !userIds.has(createdBy)) issue(issues, 'error', 'unknown_user', `${path}.createdBy`, `User "${createdBy}" does not exist in this payload.`);
  const createdAt = timestamp(raw.createdAt);
  if (createdAt === undefined) issue(issues, 'error', 'invalid_timestamp', `${path}.createdAt`, 'createdAt must be a valid timestamp.');
  const updatedAt = timestamp(raw.updatedAt);
  const lastMessageAt = timestamp(raw.lastMessageAt);
  const opensAt = timestamp(raw.opensAt);
  const closesAt = timestamp(raw.closesAt);
  if (opensAt !== undefined && closesAt !== undefined && opensAt >= closesAt) {
    issue(issues, 'error', 'invalid_thread_window', `${path}.closesAt`, 'closesAt must be after opensAt.');
  }
  if (updatedAt !== undefined && createdAt !== undefined && updatedAt < createdAt) {
    issue(issues, 'error', 'thread_updated_before_creation', `${path}.updatedAt`, 'updatedAt cannot be before createdAt.');
  }
  if (lastMessageAt !== undefined && createdAt !== undefined && lastMessageAt < createdAt) {
    issue(issues, 'error', 'message_before_thread', `${path}.lastMessageAt`, 'lastMessageAt cannot be before thread creation.');
  }
  const lastMessagePreview = cleanString(raw.lastMessagePreview);
  if (Boolean(lastMessagePreview) !== (lastMessageAt !== undefined)) {
    issue(issues, 'error', 'incomplete_thread_summary', path, 'lastMessagePreview and lastMessageAt must be provided together.');
  }
  if (lastMessageAt !== undefined && updatedAt !== undefined && updatedAt < lastMessageAt) {
    issue(issues, 'error', 'thread_summary_after_update', `${path}.lastMessageAt`, 'lastMessageAt cannot be later than updatedAt.');
  }
  const unreadCount = finiteNumber(raw.unreadCount);
  if (unreadCount !== undefined && (!Number.isInteger(unreadCount) || unreadCount < 0 || unreadCount > 1_000_000)) {
    issue(issues, 'error', 'invalid_unread_count', `${path}.unreadCount`, 'unreadCount must be a non-negative integer no greater than 1,000,000.');
  }
  return {
    id: requiredString(raw.id, `${path}.id`, issues),
    courseId,
    title: requiredString(raw.title, `${path}.title`, issues),
    isAnnouncement: raw.isAnnouncement === true,
    createdAt: createdAt || 0,
    updatedAt: updatedAt ?? createdAt,
    scope,
    groupId,
    groupSetId,
    participantIds: participantIds.length ? participantIds : undefined,
    createdBy,
    isLocked: raw.isLocked === true,
    description: cleanString(raw.description),
    guidelines: cleanString(raw.guidelines),
    kind,
    opensAt,
    closesAt,
    isPinned: raw.isPinned === true,
    allowStudentPosts: typeof raw.allowStudentPosts === 'boolean' ? raw.allowStudentPosts : undefined,
    allowReplies: typeof raw.allowReplies === 'boolean' ? raw.allowReplies : undefined,
    allowAttachments: typeof raw.allowAttachments === 'boolean' ? raw.allowAttachments : undefined,
    allowMentions: typeof raw.allowMentions === 'boolean' ? raw.allowMentions : undefined,
    unreadCount: unreadCount === undefined ? undefined : Math.floor(unreadCount),
    lastMessagePreview,
    lastMessageAt,
  };
};

const normalizeMessage = (
  raw: unknown,
  index: number,
  threadIds: Set<string>,
  userIds: Set<string>,
  issues: ValidationIssue[],
): ChatMessage | null => {
  const path = `messages[${index}]`;
  if (!isRecord(raw)) {
    issue(issues, 'error', 'invalid_message', path, 'Message must be a JSON object.');
    return null;
  }
  rejectUnknownFields(raw, ['id', 'revision', 'threadId', 'senderId', 'senderName', 'role', 'text', 'timestamp', 'readBy', 'readByUserIds', 'mediaUrl', 'mediaType', 'mediaName', 'replyToMessageId', 'mentionedUserIds', 'announcementId', 'announcementTitle', 'announcementSeverity', 'contentItemId', 'editedAt', 'deletedAt'], path, issues);
  ['id', 'threadId', 'senderId', 'senderName', 'text', 'mediaUrl', 'mediaName', 'replyToMessageId', 'announcementId', 'announcementTitle', 'contentItemId'].forEach(field => validateOptionalString(raw, field, path, issues));
  ['id', 'threadId', 'senderId', 'replyToMessageId', 'announcementId', 'contentItemId'].forEach(field => validateStringLength(raw[field], `${path}.${field}`, MAX_IDENTIFIER_CHARACTERS, issues));
  validateStringLength(raw.senderName, `${path}.senderName`, MAX_LABEL_CHARACTERS, issues);
  validateStringLength(raw.announcementTitle, `${path}.announcementTitle`, MAX_LABEL_CHARACTERS, issues);
  validateStringLength(raw.mediaUrl, `${path}.mediaUrl`, MAX_URL_CHARACTERS, issues);
  validateStringLength(raw.mediaName, `${path}.mediaName`, 1_024, issues);
  validateOptionalNumber(raw, 'readBy', path, issues);
  validateOptionalNumber(raw, 'revision', path, issues);
  ['timestamp', 'editedAt', 'deletedAt'].forEach(field => {
    if (raw[field] !== undefined && timestamp(raw[field]) === undefined) {
      issue(issues, 'error', 'invalid_timestamp', `${path}.${field}`, `${field} must be an epoch timestamp or ISO-8601 date.`);
    }
  });
  const threadId = requiredString(raw.threadId, `${path}.threadId`, issues);
  if (threadId && !threadIds.has(threadId)) issue(issues, 'error', 'unknown_thread', `${path}.threadId`, `Thread "${threadId}" does not exist in this payload.`);
  const senderId = requiredString(raw.senderId, `${path}.senderId`, issues);
  if (senderId && !userIds.has(senderId)) issue(issues, 'error', 'unknown_user', `${path}.senderId`, `User "${senderId}" does not exist in this payload.`);
  const role = cleanString(raw.role) as CourseRole | undefined;
  if (!role || !COURSE_ROLES.includes(role)) issue(issues, 'error', 'invalid_course_role', `${path}.role`, `Expected one of: ${COURSE_ROLES.join(', ')}.`);
  const text = typeof raw.text === 'string' ? raw.text.trim() : '';
  if (text.length > 20_000) issue(issues, 'error', 'message_too_long', `${path}.text`, 'Messages cannot exceed 20,000 characters.');
  const mediaUrl = cleanString(raw.mediaUrl);
  // A deletion event may be a redacted tombstone. New/edit operations enforce
  // content separately, while snapshots should not have to disclose deleted text.
  if (!text && !mediaUrl && raw.deletedAt === undefined) issue(issues, 'error', 'empty_message', path, 'A message requires text or an attachment.');
  if (mediaUrl && !isSafeHttpsUrl(mediaUrl)) issue(issues, 'error', 'unsafe_media_url', `${path}.mediaUrl`, 'Attachments must use a valid HTTPS URL without embedded credentials.');
  const mediaType = raw.mediaType === 'image' || raw.mediaType === 'document' ? raw.mediaType : undefined;
  if (raw.mediaType !== undefined && !mediaType) issue(issues, 'error', 'invalid_media_type', `${path}.mediaType`, 'mediaType must be image or document.');
  if (mediaUrl && !mediaType) issue(issues, 'error', 'missing_media_type', `${path}.mediaType`, 'mediaType is required when mediaUrl is present.');
  const messageTimestamp = timestamp(raw.timestamp);
  if (messageTimestamp === undefined) issue(issues, 'error', 'invalid_timestamp', `${path}.timestamp`, 'timestamp must be valid.');
  const readBy = finiteNumber(raw.readBy);
  if (readBy !== undefined && (!Number.isInteger(readBy) || readBy < 0)) {
    issue(issues, 'error', 'invalid_read_count', `${path}.readBy`, 'readBy must be a non-negative integer.');
  }
  const readByUserIds = uniqueStrings(raw.readByUserIds, `${path}.readByUserIds`, issues);
  const mentionedUserIds = uniqueStrings(raw.mentionedUserIds, `${path}.mentionedUserIds`, issues);
  const announcementId = cleanString(raw.announcementId);
  const announcementTitle = cleanString(raw.announcementTitle);
  const contentItemId = cleanString(raw.contentItemId);
  ['announcementId', 'announcementTitle', 'contentItemId'].forEach(field => {
    if (raw[field] !== undefined && !cleanString(raw[field])) {
      issue(issues, 'error', 'invalid_announcement_metadata', `${path}.${field}`, `${field} cannot be empty when provided.`);
    }
  });
  const announcementSeverity = raw.announcementSeverity === 'info' || raw.announcementSeverity === 'alert'
    ? raw.announcementSeverity
    : undefined;
  if (raw.announcementSeverity !== undefined && !announcementSeverity) {
    issue(issues, 'error', 'invalid_announcement_severity', `${path}.announcementSeverity`, 'announcementSeverity must be info or alert.');
  }
  readByUserIds.forEach((userId, readIndex) => {
    if (!userIds.has(userId)) issue(issues, 'error', 'unknown_user', `${path}.readByUserIds[${readIndex}]`, `User "${userId}" does not exist in this payload.`);
  });
  mentionedUserIds.forEach((userId, mentionIndex) => {
    if (!userIds.has(userId)) issue(issues, 'error', 'unknown_user', `${path}.mentionedUserIds[${mentionIndex}]`, `Mentioned user "${userId}" does not exist in this payload.`);
  });
  if (readByUserIds.length && readBy !== undefined && readBy !== readByUserIds.length) {
    issue(issues, 'error', 'read_count_mismatch', `${path}.readBy`, 'readBy must match the number of unique readByUserIds.');
  }
  const revision = finiteNumber(raw.revision) ?? 1;
  if (!Number.isSafeInteger(revision) || revision < 1) {
    issue(issues, 'error', 'invalid_message_revision', `${path}.revision`, 'Message revision must be a positive safe integer.');
  }
  if ((raw.editedAt !== undefined || raw.deletedAt !== undefined) && revision < 2) {
    issue(issues, 'error', 'missing_message_revision', `${path}.revision`, 'Edited or deleted messages must advance beyond revision 1.');
  }
  const editedAt = timestamp(raw.editedAt);
  const deletedAt = timestamp(raw.deletedAt);
  if (editedAt !== undefined && messageTimestamp !== undefined && editedAt < messageTimestamp) {
    issue(issues, 'error', 'invalid_message_audit_time', `${path}.editedAt`, 'editedAt cannot predate the original message timestamp.');
  }
  if (deletedAt !== undefined && messageTimestamp !== undefined && deletedAt < Math.max(messageTimestamp, editedAt ?? messageTimestamp)) {
    issue(issues, 'error', 'invalid_message_audit_time', `${path}.deletedAt`, 'deletedAt cannot predate the message or its latest edit.');
  }
  return {
    id: requiredString(raw.id, `${path}.id`, issues),
    revision,
    threadId,
    senderId,
    senderName: requiredString(raw.senderName, `${path}.senderName`, issues),
    role: role && COURSE_ROLES.includes(role) ? role : 'student',
    text: deletedAt === undefined ? text.slice(0, 20_000) : '',
    timestamp: messageTimestamp || 0,
    readBy: readByUserIds.length || Math.max(0, readBy ?? 0),
    readByUserIds,
    mediaUrl: deletedAt === undefined ? mediaUrl : undefined,
    mediaType: deletedAt === undefined ? mediaType : undefined,
    mediaName: deletedAt === undefined ? cleanString(raw.mediaName) : undefined,
    replyToMessageId: cleanString(raw.replyToMessageId),
    mentionedUserIds: deletedAt === undefined && mentionedUserIds.length ? mentionedUserIds : undefined,
    announcementId,
    announcementTitle: deletedAt === undefined ? announcementTitle : undefined,
    announcementSeverity,
    contentItemId,
    editedAt,
    deletedAt,
  };
};

const CHAT_STAFF_ROLES = new Set<CourseRole>(['teacher', 'ta', 'admin']);

const membershipForThread = (courseById: Map<string, Course>, thread: ChatThread, userId: string) =>
  thread.courseId ? courseById.get(thread.courseId)?.staff.find(member => member.id === userId) : undefined;

const userCanAccessThread = (courseById: Map<string, Course>, thread: ChatThread, userId: string): boolean => {
  if (thread.scope === 'direct') return thread.participantIds?.includes(userId) === true;
  const membership = membershipForThread(courseById, thread, userId);
  if (!membership) return false;
  if (thread.scope !== 'group') return true;
  return CHAT_STAFF_ROLES.has(membership.role)
    || thread.participantIds?.includes(userId) === true
    || getGroupFromSet(courseById.get(thread.courseId || ''), thread.groupSetId, thread.groupId)?.memberIds.includes(userId) === true;
};

const validateThreadIntegrity = (
  thread: ChatThread,
  index: number,
  courseById: Map<string, Course>,
  issues: ValidationIssue[],
) => {
  const path = `threads[${index}]`;
  if (thread.scope === 'direct') {
    if (thread.courseId) issue(issues, 'error', 'direct_thread_has_course', `${path}.courseId`, 'Direct threads cannot be attached to a course.');
    if (thread.groupId) issue(issues, 'error', 'direct_thread_has_group', `${path}.groupId`, 'Direct threads cannot use a groupId.');
    if (thread.groupSetId) issue(issues, 'error', 'direct_thread_has_group_set', `${path}.groupSetId`, 'Direct threads cannot use a groupSetId.');
    if (thread.isAnnouncement) issue(issues, 'error', 'invalid_direct_announcement', `${path}.isAnnouncement`, 'Direct threads cannot be announcements.');
    if (thread.isLocked) issue(issues, 'error', 'invalid_direct_lock', `${path}.isLocked`, 'Direct threads cannot use course-staff locking.');
  } else {
    const course = thread.courseId ? courseById.get(thread.courseId) : undefined;
    thread.participantIds?.forEach((userId, participantIndex) => {
      if (!course?.staff.some(member => member.id === userId)) {
        issue(issues, 'error', 'thread_participant_not_enrolled', `${path}.participantIds[${participantIndex}]`, `User "${userId}" is not enrolled in this thread's course.`);
      }
    });
    if (thread.createdBy && !membershipForThread(courseById, thread, thread.createdBy)) {
      issue(issues, 'error', 'thread_creator_not_authorized', `${path}.createdBy`, 'The thread creator must be able to access the conversation.');
    }
    // Course roles can change after a thread is created. Creation endpoints
    // enforce the current staff permission; snapshots retain the historical
    // creator as long as that identity remains enrolled in the course.
    if (thread.kind === 'announcements' && (!thread.isAnnouncement || thread.allowStudentPosts !== false)) {
      issue(issues, 'error', 'invalid_announcement_policy', path, 'Announcement topics must set isAnnouncement=true and allowStudentPosts=false.');
    }
    if (thread.scope === 'course' && thread.groupId) {
      issue(issues, 'error', 'course_thread_has_group', `${path}.groupId`, 'Only group threads may use groupId.');
    }
    if (thread.scope === 'course' && thread.groupSetId) {
      issue(issues, 'error', 'course_thread_has_group_set', `${path}.groupSetId`, 'Only group threads may use groupSetId.');
    }
    if (thread.scope === 'group' && course) {
      const resolvedGroup = getGroupFromSet(course, thread.groupSetId, thread.groupId);
      if (thread.groupSetId && !resolvedGroup) {
        issue(issues, 'error', 'unknown_thread_group', `${path}.groupId`, 'The group thread does not resolve to the selected course group set.');
      } else if (!thread.groupSetId && course.groupSets?.length === 1 && resolvedGroup) {
        thread.groupSetId = course.groupSets[0].id;
      } else if (!thread.groupSetId && (course.groupSets?.length || 0) > 1 && resolvedGroup === undefined) {
        issue(issues, 'error', 'ambiguous_thread_group', `${path}.groupSetId`, 'A groupSetId is required when a course has multiple group sets.');
      }
      if (resolvedGroup) {
        thread.participantIds?.forEach((userId, participantIndex) => {
          const participant = course.staff.find(member => member.id === userId);
          if (participant && !CHAT_STAFF_ROLES.has(participant.role) && !resolvedGroup.memberIds.includes(userId)) {
            issue(issues, 'error', 'thread_participant_outside_group', `${path}.participantIds[${participantIndex}]`, `User "${userId}" is not staff or a member of this thread's resolved group.`);
          }
        });
      }
      const hasReachableMember = course.staff.some(member =>
        CHAT_STAFF_ROLES.has(member.role)
        ||
        resolvedGroup?.memberIds.includes(member.id)
        || thread.participantIds?.includes(member.id),
      );
      if (!hasReachableMember) {
        issue(issues, 'error', 'orphan_group_thread', `${path}.groupId`, 'A group thread must resolve to at least one enrolled participant.');
      }
    }
  }
  if (thread.scope === 'direct' && thread.createdBy && !thread.participantIds?.includes(thread.createdBy)) {
    issue(issues, 'error', 'thread_creator_not_participant', `${path}.createdBy`, 'A direct-thread creator must be one of its participants.');
  }
};

const validateMessageIntegrity = (
  message: ChatMessage,
  index: number,
  threadById: Map<string, ChatThread>,
  courseById: Map<string, Course>,
  userById: Map<string, CourseUser>,
  itemById: Map<string, ContentItem>,
  issues: ValidationIssue[],
) => {
  const path = `messages[${index}]`;
  const thread = threadById.get(message.threadId);
  const sender = userById.get(message.senderId);
  if (!thread || !sender) return;
  const membership = membershipForThread(courseById, thread, message.senderId);
  // Course roles and group assignments can change after a message is sent.
  // Historical records remain valid while the sender is still enrolled; new
  // messages are checked against current access and role at the repository
  // boundary before they enter this snapshot.
  const hasHistoricalAccess = thread.scope === 'direct'
    ? userCanAccessThread(courseById, thread, message.senderId)
    : Boolean(membership);
  if (!hasHistoricalAccess) {
    issue(issues, 'error', 'message_sender_not_authorized', `${path}.senderId`, 'The message sender cannot access this conversation.');
  }
  if (thread.scope === 'direct' && message.role !== sender.role) {
    issue(issues, 'error', 'message_role_mismatch', `${path}.role`, `Direct-message role "${message.role}" does not match the sender's directory role "${sender.role}".`);
  }
  if (message.senderName !== sender.name) {
    issue(issues, 'error', 'message_sender_name_mismatch', `${path}.senderName`, 'senderName must match the institution directory record.');
  }
  if ((thread.isAnnouncement || thread.isLocked) && !CHAT_STAFF_ROLES.has(message.role)) {
    issue(issues, 'error', 'restricted_thread_message', `${path}.senderId`, 'Only course staff may post to announcement or locked threads.');
  }
  if (thread.allowStudentPosts === false && !CHAT_STAFF_ROLES.has(message.role)) {
    issue(issues, 'error', 'restricted_thread_message', `${path}.senderId`, 'Students may not post to this staff-only conversation.');
  }
  const hasAnnouncementMetadata = message.announcementId !== undefined
    || message.announcementTitle !== undefined
    || message.announcementSeverity !== undefined
    || message.contentItemId !== undefined;
  if (hasAnnouncementMetadata && !thread.isAnnouncement) {
    issue(issues, 'error', 'announcement_metadata_outside_announcement_thread', path, 'Announcement metadata is only valid in a course announcement conversation.');
  }
  if (message.contentItemId) {
    const contentItem = itemById.get(message.contentItemId);
    if (!contentItem) {
      issue(issues, 'error', 'unknown_announcement_content_item', `${path}.contentItemId`, `Content item "${message.contentItemId}" does not exist in this payload.`);
    } else if (!thread.courseId || contentItem.courseId !== thread.courseId) {
      issue(issues, 'error', 'announcement_content_course_mismatch', `${path}.contentItemId`, 'The linked announcement content item must belong to the conversation course.');
    }
  }
  if (message.replyToMessageId && thread.allowReplies === false) {
    issue(issues, 'error', 'reply_not_allowed', `${path}.replyToMessageId`, 'Replies are disabled for this conversation.');
  }
  if (message.mediaUrl && thread.allowAttachments === false) {
    issue(issues, 'error', 'attachment_not_allowed', `${path}.mediaUrl`, 'Attachments are disabled for this conversation.');
  }
  if (message.mentionedUserIds?.length && thread.allowMentions === false) {
    issue(issues, 'error', 'mentions_not_allowed', `${path}.mentionedUserIds`, 'Mentions are disabled for this conversation.');
  }
  message.mentionedUserIds?.forEach((userId, mentionIndex) => {
    const mentionedUser = userById.get(userId);
    const historicallyReachable = thread.scope === 'direct'
      ? userCanAccessThread(courseById, thread, userId)
      : Boolean(membershipForThread(courseById, thread, userId));
    if (!historicallyReachable) {
      issue(issues, 'error', 'unauthorized_mention', `${path}.mentionedUserIds[${mentionIndex}]`, `User "${userId}" cannot access this conversation.`);
    } else if (mentionedUser && !hasVisibleMentionToken(message.text, mentionedUser.name)) {
      issue(issues, 'error', 'mention_text_mismatch', `${path}.mentionedUserIds[${mentionIndex}]`, 'Every notified mention must have a matching visible @Name token.');
    }
  });
  message.readByUserIds?.forEach((userId, readIndex) => {
    const historicallyReachable = thread.scope === 'direct'
      ? userCanAccessThread(courseById, thread, userId)
      : Boolean(membershipForThread(courseById, thread, userId));
    if (!historicallyReachable) {
      issue(issues, 'error', 'invalid_read_receipt', `${path}.readByUserIds[${readIndex}]`, `User "${userId}" cannot access this conversation.`);
    }
  });
  if (message.timestamp < thread.createdAt) {
    issue(issues, 'error', 'message_before_thread', `${path}.timestamp`, 'A message cannot predate its thread.');
  }
  if (message.editedAt !== undefined && message.editedAt < message.timestamp) {
    issue(issues, 'error', 'invalid_message_edit_time', `${path}.editedAt`, 'editedAt cannot be before the original message timestamp.');
  }
  if (message.deletedAt !== undefined && message.deletedAt < message.timestamp) {
    issue(issues, 'error', 'invalid_message_delete_time', `${path}.deletedAt`, 'deletedAt cannot be before the original message timestamp.');
  }
};

const normalizeSubmission = (
  raw: unknown,
  index: number,
  courseIds: Set<string>,
  userIds: Set<string>,
  itemById: Map<string, ContentItem>,
  issues: ValidationIssue[],
): StudentSubmission | null => {
  const path = `submissions[${index}]`;
  if (!isRecord(raw)) {
    issue(issues, 'error', 'invalid_submission', path, 'Submission must be a JSON object.');
    return null;
  }
  rejectUnknownFields(raw, [
    'id', 'liveSessionId', 'studentId', 'studentName', 'groupId', 'contentItemId', 'courseId', 'submittedAt', 'updatedAt',
    'revision', 'startedAt', 'attemptNumber', 'timeLimitExpiresAt', 'status', 'responses', 'totalScore',
    'overallFeedback', 'gradedBy', 'gradedAt', 'gradeRevision', 'gradeStatus', 'isLate', 'deletedAt',
  ], path, issues);
  ['id', 'liveSessionId', 'studentId', 'studentName', 'groupId', 'contentItemId', 'courseId', 'overallFeedback', 'gradedBy']
    .forEach(field => validateOptionalString(raw, field, path, issues));
  ['id', 'liveSessionId', 'studentId', 'groupId', 'contentItemId', 'courseId', 'gradedBy']
    .forEach(field => validateStringLength(raw[field], `${path}.${field}`, MAX_IDENTIFIER_CHARACTERS, issues));
  validateStringLength(raw.studentName, `${path}.studentName`, MAX_LABEL_CHARACTERS, issues);
  validateStringLength(raw.overallFeedback, `${path}.overallFeedback`, 100_000, issues);
  ['revision', 'attemptNumber', 'totalScore', 'gradeRevision']
    .forEach(field => validateOptionalNumber(raw, field, path, issues));
  validateOptionalBoolean(raw, 'isLate', path, issues);
  const courseId = requiredString(raw.courseId, `${path}.courseId`, issues);
  const studentId = requiredString(raw.studentId, `${path}.studentId`, issues);
  const contentItemId = requiredString(raw.contentItemId, `${path}.contentItemId`, issues);
  if (courseId && !courseIds.has(courseId)) issue(issues, 'error', 'unknown_course', `${path}.courseId`, `Course "${courseId}" does not exist in this payload.`);
  if (studentId && !userIds.has(studentId)) issue(issues, 'error', 'unknown_user', `${path}.studentId`, `User "${studentId}" does not exist in this payload.`);
  const contentItem = itemById.get(contentItemId);
  if (!contentItem) issue(issues, 'error', 'unknown_content_item', `${path}.contentItemId`, `Content item "${contentItemId}" does not exist in this payload.`);
  if (contentItem && contentItem.courseId !== courseId) issue(issues, 'error', 'content_course_mismatch', `${path}.contentItemId`, 'The content item belongs to a different course.');
  const liveSessionId = cleanString(raw.liveSessionId);
  if (liveSessionId && contentItem && !contentItem.isPopQuiz && !contentItem.isPoll) {
    issue(issues, 'error', 'unexpected_live_session', `${path}.liveSessionId`, 'Only live quiz or poll submissions may reference a live session.');
  }
  const status = raw.status === 'draft' || raw.status === 'submitted' || raw.status === 'graded' || raw.status === 'discarded' ? raw.status : undefined;
  if (!status) issue(issues, 'error', 'invalid_submission_status', `${path}.status`, 'Expected draft, submitted, graded, or discarded.');
  const allowedQuestionIds = new Set((contentItem?.questions || []).filter(question => question.answerType !== 'page_break').map(question => question.id));
  const responseQuestionIds = new Set<string>();
  const responses: QuestionResponse[] = Array.isArray(raw.responses) ? raw.responses.flatMap((response, responseIndex) => {
    const responsePath = `${path}.responses[${responseIndex}]`;
    if (!isRecord(response)) {
      issue(issues, 'error', 'invalid_response', responsePath, 'Question response must be an object.');
      return [];
    }
    rejectUnknownFields(response, ['questionId', 'answer', 'isCorrect', 'score', 'teacherFeedback', 'needsManualGrading', 'isManuallyGraded', 'rubricScores', 'attachment'], responsePath, issues);
    ['questionId', 'teacherFeedback'].forEach(field => validateOptionalString(response, field, responsePath, issues));
    validateStringLength(response.questionId, `${responsePath}.questionId`, MAX_IDENTIFIER_CHARACTERS, issues);
    validateStringLength(response.teacherFeedback, `${responsePath}.teacherFeedback`, 100_000, issues);
    validateOptionalNumber(response, 'score', responsePath, issues);
    ['isCorrect', 'needsManualGrading', 'isManuallyGraded'].forEach(field => validateOptionalBoolean(response, field, responsePath, issues));
    const questionId = requiredString(response.questionId, `${responsePath}.questionId`, issues);
    if (responseQuestionIds.has(questionId)) issue(issues, 'error', 'duplicate_question_response', `${responsePath}.questionId`, `Question "${questionId}" has more than one response.`);
    responseQuestionIds.add(questionId);
    if (contentItem?.questions?.length && !allowedQuestionIds.has(questionId)) issue(issues, 'error', 'unknown_question', `${responsePath}.questionId`, `Question "${questionId}" does not belong to this assessment.`);
    if (!Object.prototype.hasOwnProperty.call(response, 'answer')) {
      issue(issues, 'error', 'missing_answer', `${responsePath}.answer`, 'Every response must include answer, using null when unanswered.');
    }
    const answer = typeof response.answer === 'string' || typeof response.answer === 'number' || response.answer === null || (Array.isArray(response.answer) && response.answer.every(value => typeof value === 'string'))
      ? response.answer as QuestionResponse['answer']
      : null;
    if (answer === null && response.answer !== null) issue(issues, 'error', 'invalid_answer', `${responsePath}.answer`, 'Answer must be a string, string array, number, or null.');
    if (response.answer !== undefined) {
      let serializedAnswer = '';
      try {
        serializedAnswer = JSON.stringify(response.answer);
      } catch {
        issue(issues, 'error', 'invalid_answer', `${responsePath}.answer`, 'Answer must be valid JSON.');
      }
      if (serializedAnswer.length > 250_000) issue(issues, 'error', 'answer_too_large', `${responsePath}.answer`, 'An individual answer cannot exceed 250,000 serialized characters.');
    }
    const score = finiteNumber(response.score);
    const responseQuestion = contentItem?.questions?.find(question => question.id === questionId);
    const minimumScore = -Math.max(0, responseQuestion?.deduction || 0);
    if (score !== undefined && score < minimumScore) issue(issues, 'error', 'score_below_penalty', `${responsePath}.score`, `Score cannot be below the configured penalty of ${minimumScore}.`);
    let attachment: QuestionResponse['attachment'];
    if (response.attachment !== undefined) {
      if (!isRecord(response.attachment)) {
        issue(issues, 'error', 'invalid_attachment', `${responsePath}.attachment`, 'Attachment must be an object.');
      } else {
        const rawAttachment = response.attachment;
        rejectUnknownFields(rawAttachment, ['id', 'url', 'name', 'mimeType', 'size', 'sha256'], `${responsePath}.attachment`, issues);
        ['id', 'url', 'name', 'mimeType', 'sha256'].forEach(field => validateOptionalString(rawAttachment, field, `${responsePath}.attachment`, issues));
        validateOptionalNumber(rawAttachment, 'size', `${responsePath}.attachment`, issues);
        const url = requiredString(rawAttachment.url, `${responsePath}.attachment.url`, issues);
        if (url && !isSafeHttpsUrl(url)) issue(issues, 'error', 'unsafe_media_url', `${responsePath}.attachment.url`, 'Attachment URL must use valid HTTPS without embedded credentials.');
        attachment = {
          id: requiredString(rawAttachment.id, `${responsePath}.attachment.id`, issues),
          url,
          name: requiredString(rawAttachment.name, `${responsePath}.attachment.name`, issues),
          mimeType: requiredString(rawAttachment.mimeType, `${responsePath}.attachment.mimeType`, issues),
          size: finiteNumber(rawAttachment.size),
          sha256: cleanString(rawAttachment.sha256),
        };
        if (attachment.size !== undefined && (!Number.isInteger(attachment.size) || attachment.size < 0)) {
          issue(issues, 'error', 'invalid_attachment_size', `${responsePath}.attachment.size`, 'Attachment size must be a non-negative integer.');
        }
        if (attachment.sha256 && !/^[a-f0-9]{64}$/i.test(attachment.sha256)) {
          issue(issues, 'error', 'invalid_attachment_digest', `${responsePath}.attachment.sha256`, 'Attachment sha256 must be a 64-character hexadecimal digest.');
        }
      }
    }
    if (response.rubricScores !== undefined && !isRecord(response.rubricScores)) {
      issue(issues, 'error', 'invalid_rubric_scores', `${responsePath}.rubricScores`, 'rubricScores must be an object keyed by criterion id.');
    }
    const rubricScores = isRecord(response.rubricScores) ? Object.fromEntries(Object.entries(response.rubricScores).flatMap(([key, value]) => {
      const scoreValue = finiteNumber(value);
      const criterion = responseQuestion?.rubric?.find(candidate => candidate.id === key);
      const isDefaultCriterion = !responseQuestion?.rubric?.length && key === `${responseQuestion?.id}:overall`;
      const maximum = criterion?.maxPoints ?? (isDefaultCriterion ? Math.max(0, responseQuestion?.points || 0) : undefined);
      if (scoreValue === undefined || scoreValue < 0) {
        issue(issues, 'error', 'invalid_rubric_score', `${responsePath}.rubricScores.${key}`, 'Rubric scores must be non-negative finite numbers.');
        return [];
      }
      if (maximum === undefined) {
        issue(issues, 'error', 'unknown_rubric_criterion', `${responsePath}.rubricScores.${key}`, `Rubric criterion "${key}" is not defined for this question.`);
        return [];
      }
      if (scoreValue > maximum) {
        issue(issues, 'error', 'rubric_score_above_maximum', `${responsePath}.rubricScores.${key}`, `Rubric score cannot exceed ${maximum}.`);
      }
      return [[key, scoreValue]];
    })) : undefined;
    if (response.needsManualGrading === true && response.isManuallyGraded === true) {
      issue(issues, 'error', 'conflicting_grading_state', responsePath, 'A response cannot simultaneously need manual grading and be manually graded.');
    }
    if (rubricScores && score !== undefined) {
      const rubricTotal = Object.values(rubricScores).reduce((sum, value) => sum + value, 0);
      if (Math.abs(rubricTotal - score) > 0.0001) {
        issue(issues, 'error', 'rubric_score_mismatch', `${responsePath}.score`, `Response score ${score} does not match rubric total ${rubricTotal}.`);
      }
    }
    if (responseQuestion?.gradingType === 'true_false' && response.isManuallyGraded === true && score !== undefined) {
      const correctScore = Math.max(0, responseQuestion.points || 0);
      const incorrectScore = -Math.max(0, responseQuestion.deduction || 0);
      if (score !== correctScore && score !== incorrectScore) {
        issue(issues, 'error', 'invalid_binary_score', `${responsePath}.score`, `Correct/incorrect grading requires either ${correctScore} or ${incorrectScore} points.`);
      }
      if (typeof response.isCorrect !== 'boolean' || (response.isCorrect && score !== correctScore) || (!response.isCorrect && score !== incorrectScore)) {
        issue(issues, 'error', 'binary_score_mismatch', `${responsePath}.isCorrect`, 'isCorrect must agree with the manually assigned correct/incorrect score.');
      }
    }
    return [{
      questionId,
      answer,
      isCorrect: typeof response.isCorrect === 'boolean' ? response.isCorrect : undefined,
      score,
      teacherFeedback: cleanString(response.teacherFeedback),
      needsManualGrading: response.needsManualGrading === true,
      isManuallyGraded: response.isManuallyGraded === true,
      rubricScores,
      attachment,
    }];
  }) : [];
  if (!Array.isArray(raw.responses)) issue(issues, 'error', 'invalid_responses', `${path}.responses`, 'responses must be an array.');
  const submittedAt = timestamp(raw.submittedAt);
  if (submittedAt === undefined) issue(issues, 'error', 'invalid_timestamp', `${path}.submittedAt`, 'submittedAt must be valid.');
  const updatedAt = timestamp(raw.updatedAt);
  const startedAt = timestamp(raw.startedAt);
  const timeLimitExpiresAt = timestamp(raw.timeLimitExpiresAt);
  const gradedAt = timestamp(raw.gradedAt);
  const deletedAt = timestamp(raw.deletedAt);
  ([
    ['updatedAt', raw.updatedAt, updatedAt],
    ['startedAt', raw.startedAt, startedAt],
    ['timeLimitExpiresAt', raw.timeLimitExpiresAt, timeLimitExpiresAt],
    ['gradedAt', raw.gradedAt, gradedAt],
    ['deletedAt', raw.deletedAt, deletedAt],
  ] as const).forEach(([field, source, normalized]) => {
    if (source !== undefined && normalized === undefined) issue(issues, 'error', 'invalid_timestamp', `${path}.${field}`, `${field} must be a valid timestamp.`);
  });
  if (startedAt !== undefined && submittedAt !== undefined && submittedAt < startedAt) {
    issue(issues, 'error', 'submission_before_start', `${path}.submittedAt`, 'submittedAt cannot be before startedAt.');
  }
  if (updatedAt !== undefined && submittedAt !== undefined && updatedAt < Math.min(startedAt ?? submittedAt, submittedAt)) {
    issue(issues, 'error', 'invalid_submission_update_time', `${path}.updatedAt`, 'updatedAt cannot predate the submission record.');
  }
  if (timeLimitExpiresAt !== undefined && startedAt !== undefined && timeLimitExpiresAt <= startedAt) {
    issue(issues, 'error', 'invalid_timer_expiration', `${path}.timeLimitExpiresAt`, 'timeLimitExpiresAt must be after startedAt.');
  }
  const totalScore = finiteNumber(raw.totalScore);
  if (totalScore !== undefined && totalScore < 0) issue(issues, 'error', 'negative_score', `${path}.totalScore`, 'totalScore cannot be negative.');
  const maximumScore = contentItem ? getGradingMaxScore(contentItem) : 0;
  if (totalScore !== undefined && totalScore > maximumScore) issue(issues, 'error', 'score_above_maximum', `${path}.totalScore`, `totalScore exceeds the assessment maximum of ${maximumScore}.`);
  responses.forEach((response, responseIndex) => {
    const question = contentItem?.questions?.find(candidate => candidate.id === response.questionId);
    if (question && (response.score || 0) > Math.max(0, question.points || 0)) {
      issue(issues, 'error', 'score_above_maximum', `${path}.responses[${responseIndex}].score`, `Score exceeds the question maximum of ${question.points || 0}.`);
    }
  });
  if (totalScore !== undefined && contentItem?.submissionTarget !== 'external-link') {
    const responseTotal = Math.max(0, responses.reduce((sum, response) => sum + (response.score ?? 0), 0));
    if (Math.abs(responseTotal - totalScore) > 0.0001) {
      issue(issues, 'error', 'submission_total_mismatch', `${path}.totalScore`, `totalScore ${totalScore} does not match the response total ${responseTotal}.`);
    }
  }
  if (status && status !== 'draft') {
    allowedQuestionIds.forEach(questionId => {
      if (!responseQuestionIds.has(questionId)) issue(issues, 'error', 'missing_question_response', `${path}.responses`, `Submitted attempts must include a response for question "${questionId}", using null for an unanswered question.`);
    });
  }
  const attemptNumber = finiteNumber(raw.attemptNumber);
  if (attemptNumber !== undefined && (!Number.isInteger(attemptNumber) || attemptNumber < 1)) issue(issues, 'error', 'invalid_attempt_number', `${path}.attemptNumber`, 'attemptNumber must be a positive integer.');
  const gradedBy = cleanString(raw.gradedBy);
  if (gradedBy && !userIds.has(gradedBy)) issue(issues, 'error', 'unknown_user', `${path}.gradedBy`, `Grader "${gradedBy}" does not exist in this payload.`);
  const gradeRevision = finiteNumber(raw.gradeRevision);
  if (gradeRevision !== undefined && (!Number.isInteger(gradeRevision) || gradeRevision < 0)) issue(issues, 'error', 'invalid_grade_revision', `${path}.gradeRevision`, 'gradeRevision must be a non-negative integer.');
  const gradeStatus = raw.gradeStatus === 'released' ? 'released' : raw.gradeStatus === 'draft' ? 'draft' : undefined;
  if (raw.gradeStatus !== undefined && !gradeStatus) issue(issues, 'error', 'invalid_grade_status', `${path}.gradeStatus`, 'Expected draft or released.');
  if (gradeStatus === 'released' && status !== 'graded') issue(issues, 'error', 'released_ungraded_submission', `${path}.gradeStatus`, 'Only a graded submission can be released to a student.');
  if (status === 'discarded' && !deletedAt) issue(issues, 'error', 'discarded_without_timestamp', `${path}.deletedAt`, 'Discarded submissions require deletedAt for retention and recovery enforcement.');
  if (status === 'graded' && (!gradedBy || !gradedAt || totalScore === undefined)) issue(issues, 'error', 'incomplete_grade_audit', path, 'Graded submissions require totalScore, gradedBy, and gradedAt.');
  if (status === 'graded' && contentItem?.submissionTarget !== 'external-link' && responses.some(response => response.needsManualGrading && !response.isManuallyGraded)) {
    issue(issues, 'error', 'unresolved_manual_grading', `${path}.responses`, 'A submission cannot be marked graded while a response still requires manual grading.');
  }
  if (gradedAt !== undefined && submittedAt !== undefined && gradedAt < submittedAt) issue(issues, 'error', 'grade_before_submission', `${path}.gradedAt`, 'gradedAt cannot be before submittedAt.');
  if (deletedAt !== undefined && submittedAt !== undefined && deletedAt < submittedAt) issue(issues, 'error', 'delete_before_submission', `${path}.deletedAt`, 'deletedAt cannot be before submittedAt.');
  const revision = finiteNumber(raw.revision);
  if (revision !== undefined && (!Number.isInteger(revision) || revision < 0)) issue(issues, 'error', 'invalid_revision', `${path}.revision`, 'revision must be a non-negative integer.');
  return {
    id: requiredString(raw.id, `${path}.id`, issues),
    liveSessionId,
    studentId,
    studentName: cleanString(raw.studentName),
    groupId: cleanString(raw.groupId),
    contentItemId,
    courseId,
    submittedAt: submittedAt || 0,
    updatedAt,
    revision: revision === undefined ? undefined : Math.floor(revision),
    startedAt,
    attemptNumber: attemptNumber ? Math.floor(attemptNumber) : undefined,
    timeLimitExpiresAt,
    status: status || 'draft',
    responses,
    totalScore: totalScore === undefined ? undefined : Math.max(0, totalScore),
    overallFeedback: cleanString(raw.overallFeedback),
    gradedBy,
    gradedAt,
    gradeRevision: Math.max(0, gradeRevision ?? 0),
    gradeStatus,
    isLate: raw.isLate === true,
    deletedAt,
  };
};

const normalizeContentProgress = (
  raw: unknown,
  index: number,
  issues: ValidationIssue[],
): ContentProgress | null => {
  const path = `contentProgress[${index}]`;
  if (!isRecord(raw)) {
    issue(issues, 'error', 'invalid_content_progress', path, 'Content progress must be a JSON object.');
    return null;
  }
  rejectUnknownFields(raw, [
    'userId', 'courseId', 'contentItemId', 'firstViewedAt', 'lastViewedAt', 'completedAt', 'revision',
  ], path, issues);
  const userId = requiredString(raw.userId, `${path}.userId`, issues);
  const courseId = requiredString(raw.courseId, `${path}.courseId`, issues);
  const contentItemId = requiredString(raw.contentItemId, `${path}.contentItemId`, issues);
  [
    ['userId', userId], ['courseId', courseId], ['contentItemId', contentItemId],
  ].forEach(([field, value]) => validateStringLength(value, `${path}.${field}`, MAX_IDENTIFIER_CHARACTERS, issues));
  const firstViewedAt = timestamp(raw.firstViewedAt);
  const lastViewedAt = timestamp(raw.lastViewedAt);
  const completedAt = raw.completedAt === undefined ? undefined : timestamp(raw.completedAt);
  if (firstViewedAt === undefined) issue(issues, 'error', 'invalid_timestamp', `${path}.firstViewedAt`, 'firstViewedAt must be an epoch timestamp or ISO-8601 date.');
  if (lastViewedAt === undefined) issue(issues, 'error', 'invalid_timestamp', `${path}.lastViewedAt`, 'lastViewedAt must be an epoch timestamp or ISO-8601 date.');
  if (raw.completedAt !== undefined && completedAt === undefined) issue(issues, 'error', 'invalid_timestamp', `${path}.completedAt`, 'completedAt must be an epoch timestamp or ISO-8601 date.');
  const revision = finiteNumber(raw.revision);
  if (!Number.isSafeInteger(revision) || (revision ?? 0) < 1) {
    issue(issues, 'error', 'invalid_content_progress_revision', `${path}.revision`, 'revision must be a positive whole number.');
  }
  if (firstViewedAt !== undefined && lastViewedAt !== undefined && lastViewedAt < firstViewedAt) {
    issue(issues, 'error', 'content_progress_time_reversed', `${path}.lastViewedAt`, 'lastViewedAt cannot precede firstViewedAt.');
  }
  if (firstViewedAt !== undefined && completedAt !== undefined && completedAt < firstViewedAt) {
    issue(issues, 'error', 'content_progress_time_reversed', `${path}.completedAt`, 'completedAt cannot precede firstViewedAt.');
  }
  if (!userId || !courseId || !contentItemId || firstViewedAt === undefined || lastViewedAt === undefined || !Number.isSafeInteger(revision) || (revision ?? 0) < 1) return null;
  return { userId, courseId, contentItemId, firstViewedAt, lastViewedAt, completedAt, revision: revision as number };
};

const mergeRecordsById = <T extends { id: string }>(existing: T[], incoming: T[], removed: Set<string>): T[] => {
  const merged = new Map(existing.filter(record => !removed.has(record.id)).map(record => [record.id, record]));
  incoming.forEach(record => merged.set(record.id, record));
  return Array.from(merged.values());
};

/**
 * Applies an already validated cursor upsert without knowing anything about the
 * upstream provider. Tombstones are explicit so roster add/drop and remote
 * deletes do not depend on vendor-specific null or status conventions.
 */
export const mergeNormalizedInstitutionSync = (
  existing: NormalizedInstitutionSync,
  incoming: NormalizedInstitutionSync,
): NormalizedInstitutionSync => {
  if (incoming.mode !== 'upsert') return incoming;
  const deletions = incoming.deletions ?? {};
  const removedCourses = new Set(deletions.courses ?? []);
  const removedContent = new Set(deletions.contentItems ?? []);
  const removedUsers = new Set(deletions.users ?? []);
  const courses = new Map(
    existing.courses
      .filter(entry => !removedCourses.has(entry.course.id))
      .map(entry => [entry.course.id, {
        ...entry,
        items: entry.items.filter(item => !removedContent.has(item.id)),
      }]),
  );
  incoming.courses.forEach(entry => {
    const current = courses.get(entry.course.id);
    courses.set(entry.course.id, current ? {
      ...entry,
      items: mergeRecordsById(current.items, entry.items, removedContent),
    } : {
      ...entry,
      items: entry.items.filter(item => !removedContent.has(item.id)),
    });
  });
  const mergedCourses = Array.from(courses.values()).map(entry => ({
    ...entry,
    course: {
      ...entry.course,
      // These are projections, not upstream-authored facts. Recompute them
      // after item/tombstone reconciliation so a partial upsert cannot leave
      // otherwise valid state with stale counts.
      participantsCount: entry.course.staff.filter(member => member.role === 'student').length,
      materialsCount: entry.items.length,
    },
  }));
  const progressKey = (record: ContentProgress) => JSON.stringify([record.userId, record.contentItemId]);
  const progress = new Map(
    (existing.contentProgress ?? [])
      .filter(record => !removedUsers.has(record.userId) && !removedCourses.has(record.courseId) && !removedContent.has(record.contentItemId))
      .map(record => [progressKey(record), record]),
  );
  (incoming.contentProgress ?? []).forEach(record => progress.set(progressKey(record), record));
  return {
    ...existing,
    ...incoming,
    mode: 'snapshot',
    integrations: incoming.integrations === undefined ? existing.integrations : incoming.integrations,
    users: mergeRecordsById(existing.users, incoming.users, new Set(deletions.users ?? [])),
    courses: mergedCourses,
    threads: mergeRecordsById(existing.threads ?? [], incoming.threads ?? [], new Set(deletions.threads ?? [])),
    messages: mergeRecordsById(existing.messages ?? [], incoming.messages ?? [], new Set(deletions.messages ?? [])),
    submissions: mergeRecordsById(existing.submissions ?? [], incoming.submissions ?? [], new Set(deletions.submissions ?? [])),
    contentProgress: Array.from(progress.values()),
    deletions: undefined,
  };
};

/** Validates a snapshot, or an incremental upsert against a previously validated snapshot. */
export function validateInstitutionSync(input: unknown, context?: NormalizedInstitutionSync): ValidationResult<NormalizedInstitutionSync> {
  const issues: ValidationIssue[] = [];
  if (!isRecord(input)) {
    return { success: false, issues: [{ severity: 'error', code: 'invalid_payload', path: '$', message: 'Institution sync must be a JSON object.' }] };
  }
  try {
    const serialized = JSON.stringify(input);
    if (utf8ByteLength(serialized) > MAX_INSTITUTION_PAYLOAD_BYTES) {
      return { success: false, issues: [{ severity: 'error', code: 'payload_too_large', path: '$', message: 'Institution sync cannot exceed 10 MB. Use cursor-based incremental synchronization for larger datasets.' }] };
    }
  } catch {
    return { success: false, issues: [{ severity: 'error', code: 'invalid_payload', path: '$', message: 'Institution sync must be serializable JSON without circular references.' }] };
  }
  rejectUnknownFields(input, ['schemaVersion', 'syncId', 'generatedAt', 'mode', 'institution', 'integrations', 'users', 'courses', 'threads', 'messages', 'submissions', 'contentProgress', 'deletions', 'cursor', 'etag'], '$', issues);
  ['syncId', 'cursor', 'etag'].forEach(field => validateOptionalString(input, field, '$', issues));
  validateStringLength(input.syncId, 'syncId', MAX_IDENTIFIER_CHARACTERS, issues);
  validateStringLength(input.cursor, 'cursor', 2_048, issues);
  validateStringLength(input.etag, 'etag', 2_048, issues);
  ['cursor', 'etag'].forEach(field => {
    if (typeof input[field] === 'string' && /[\u0000-\u001f\u007f]/.test(input[field] as string)) {
      issue(issues, 'error', 'invalid_sync_token', field, `${field} cannot contain control characters.`);
    }
  });
  if (input.schemaVersion !== INSTITUTION_SCHEMA_VERSION) {
    issue(issues, 'error', 'unsupported_schema_version', 'schemaVersion', `Expected schemaVersion "${INSTITUTION_SCHEMA_VERSION}".`);
  }
  if (!isRecord(input.institution)) issue(issues, 'error', 'invalid_institution', 'institution', 'Institution descriptor is required.');
  const rawInstitution = isRecord(input.institution) ? input.institution : {};
  rejectUnknownFields(rawInstitution, ['id', 'name', 'timeZone', 'metadata'], 'institution', issues);
  const institutionMetadata = normalizeExtensionRecord(rawInstitution.metadata, 'institution.metadata', issues);
  validateStringLength(rawInstitution.id, 'institution.id', MAX_IDENTIFIER_CHARACTERS, issues);
  validateStringLength(rawInstitution.name, 'institution.name', MAX_LABEL_CHARACTERS, issues);
  validateStringLength(rawInstitution.timeZone, 'institution.timeZone', 200, issues);
  const syncId = requiredString(input.syncId, 'syncId', issues);
  const institutionId = requiredString(rawInstitution.id, 'institution.id', issues);
  const institutionName = requiredString(rawInstitution.name, 'institution.name', issues);
  const institutionTimeZone = requiredString(rawInstitution.timeZone, 'institution.timeZone', issues);
  const integrations = normalizeIntegrationSources(input.integrations, 'integrations', issues);
  if (institutionTimeZone && !isValidTimeZone(institutionTimeZone)) {
    issue(issues, 'error', 'invalid_time_zone', 'institution.timeZone', 'timeZone must be a valid IANA time-zone identifier, such as "America/Toronto" or "UTC".');
  }
  const generatedAt = timestamp(input.generatedAt) ?? 0;
  if (timestamp(input.generatedAt) === undefined) issue(issues, 'error', 'invalid_timestamp', 'generatedAt', 'generatedAt must be an epoch timestamp or ISO-8601 date.');
  const mode = input.mode === 'upsert' ? 'upsert' : input.mode === 'snapshot' ? 'snapshot' : undefined;
  if (!mode) issue(issues, 'error', 'invalid_sync_mode', 'mode', 'Expected "snapshot" or "upsert".');
  const deletions = normalizeSyncDeletions(input.deletions, mode, issues);
  if (mode === 'upsert' && context && context.institution.id !== institutionId) {
    issue(issues, 'error', 'institution_mismatch', 'institution.id', 'An upsert cannot change the institution identifier.');
  }

  const users = Array.isArray(input.users)
    ? input.users.flatMap((raw, index) => {
        const user = normalizeDirectoryUser(raw, index, issues);
        return user ? [user] : [];
      })
    : [];
  if (!Array.isArray(input.users) && !(mode === 'upsert' && input.users === undefined)) issue(issues, 'error', 'invalid_users', 'users', 'users must be an array.');
  const incomingUserIds = new Set<string>();
  users.forEach((user, index) => {
    if (incomingUserIds.has(user.id)) issue(issues, 'error', 'duplicate_user_id', `users[${index}].id`, `Duplicate user id "${user.id}".`);
    incomingUserIds.add(user.id);
  });
  const directoryUsers = Array.from(new Map([...(context?.users ?? []), ...users].map(user => [user.id, user])).values());
  const userIds = new Set(directoryUsers.map(user => user.id));

  const rawCourses = Array.isArray(input.courses) ? input.courses : [];
  if (!Array.isArray(input.courses) && !(mode === 'upsert' && input.courses === undefined)) issue(issues, 'error', 'invalid_courses', 'courses', 'courses must be an array.');
  const courses = rawCourses.flatMap((raw, index) => {
    const result = validateCourseImport(raw, directoryUsers, `courses[${index}]`, { requireStableIds: true });
    issues.push(...result.issues);
    return result.success ? [result.data] : [];
  });
  courses.forEach(entry => {
    entry.course.timeZone ||= institutionTimeZone;
  });
  const courseIds = new Set((context?.courses ?? []).map(entry => entry.course.id));
  const incomingCourseIds = new Set<string>();
  courses.forEach((entry, index) => {
    if (incomingCourseIds.has(entry.course.id)) issue(issues, 'error', 'duplicate_course_id', `courses[${index}].course.id`, `Duplicate course id "${entry.course.id}".`);
    incomingCourseIds.add(entry.course.id);
    courseIds.add(entry.course.id);
  });
  const courseById = new Map(
    [...(context?.courses ?? []), ...courses].map(entry => [entry.course.id, entry.course]),
  );
  const existingItemById = new Map((context?.courses ?? []).flatMap(entry => entry.items).map(item => [item.id, item]));
  const incomingItemCourseById = new Map<string, string>();
  courses.forEach((entry, courseIndex) => entry.items.forEach((item, itemIndex) => {
    const previousIncomingCourseId = incomingItemCourseById.get(item.id);
    if (previousIncomingCourseId) {
      issue(issues, 'error', 'duplicate_content_id', `courses[${courseIndex}].items[${itemIndex}].id`, `Content id "${item.id}" is already used by course "${previousIncomingCourseId}". Content ids must be institution-wide unique.`);
    }
    incomingItemCourseById.set(item.id, entry.course.id);
    const existing = existingItemById.get(item.id);
    if (existing && existing.courseId !== item.courseId) {
      issue(issues, 'error', 'content_id_course_mismatch', `courses[${courseIndex}].items[${itemIndex}].id`, `Content id "${item.id}" cannot move from course "${existing.courseId}" to "${item.courseId}".`);
    }
  }));
  const itemById = new Map([...(context?.courses ?? []), ...courses].flatMap(entry => entry.items).map(item => [item.id, item]));
  const userById = new Map(directoryUsers.map(user => [user.id, user]));

  const threads = Array.isArray(input.threads)
    ? input.threads.flatMap((raw, index) => {
        const thread = normalizeThread(raw, index, courseIds, userIds, issues);
        return thread ? [thread] : [];
      })
    : [];
  if (input.threads !== undefined && !Array.isArray(input.threads)) issue(issues, 'error', 'invalid_threads', 'threads', 'threads must be an array.');
  const threadIds = new Set((context?.threads ?? []).map(thread => thread.id));
  const incomingThreadIds = new Set<string>();
  threads.forEach((thread, index) => {
    if (incomingThreadIds.has(thread.id)) issue(issues, 'error', 'duplicate_thread_id', `threads[${index}].id`, `Duplicate thread id "${thread.id}".`);
    incomingThreadIds.add(thread.id);
    threadIds.add(thread.id);
    validateThreadIntegrity(thread, index, courseById, issues);
    const existing = context?.threads?.find(candidate => candidate.id === thread.id);
    if (existing) {
      const immutableIdentityChanged = existing.scope !== thread.scope
        || existing.courseId !== thread.courseId
        || existing.groupId !== thread.groupId
        || existing.groupSetId !== thread.groupSetId
        || existing.createdBy !== thread.createdBy
        || existing.createdAt !== thread.createdAt
        || existing.isAnnouncement !== thread.isAnnouncement
        || JSON.stringify([...(existing.participantIds ?? [])].sort()) !== JSON.stringify([...(thread.participantIds ?? [])].sort());
      if (immutableIdentityChanged) {
        issue(issues, 'error', 'thread_identity_changed', `threads[${index}].id`, 'An upsert cannot change a conversation\'s scope, audience, creator, creation time, or announcement identity. Create a new thread instead.');
      }
    }
  });
  const threadById = new Map(
    [...(context?.threads ?? []), ...threads].map(thread => [thread.id, thread]),
  );
  const messages = Array.isArray(input.messages)
    ? input.messages.flatMap((raw, index) => {
        const message = normalizeMessage(raw, index, threadIds, userIds, issues);
        return message ? [message] : [];
      })
    : [];
  if (input.messages !== undefined && !Array.isArray(input.messages)) issue(issues, 'error', 'invalid_messages', 'messages', 'messages must be an array.');
  const messageIds = new Set<string>();
  const allMessages = [...(context?.messages ?? []), ...messages];
  const messageById = new Map(allMessages.map(message => [message.id, message]));
  messages.forEach((message, index) => {
    if (messageIds.has(message.id)) issue(issues, 'error', 'duplicate_message_id', `messages[${index}].id`, `Duplicate message id "${message.id}".`);
    messageIds.add(message.id);
    const replyTarget = message.replyToMessageId ? messageById.get(message.replyToMessageId) : undefined;
    if (message.replyToMessageId === message.id) {
      issue(issues, 'error', 'cyclic_message_reply', `messages[${index}].replyToMessageId`, 'A message cannot reply to itself.');
    } else if (message.replyToMessageId && replyTarget?.threadId !== message.threadId) {
      issue(issues, 'error', 'invalid_message_reply', `messages[${index}].replyToMessageId`, 'Reply target must exist in the same thread.');
    } else if (replyTarget) {
      const visited = new Set<string>([message.id]);
      let cursor: ChatMessage | undefined = replyTarget;
      while (cursor) {
        if (visited.has(cursor.id)) {
          issue(issues, 'error', 'cyclic_message_reply', `messages[${index}].replyToMessageId`, 'Message replies cannot form a cycle.');
          break;
        }
        visited.add(cursor.id);
        cursor = cursor.replyToMessageId ? messageById.get(cursor.replyToMessageId) : undefined;
      }
    }
    validateMessageIntegrity(message, index, threadById, courseById, userById, itemById, issues);
    const existing = context?.messages?.find(candidate => candidate.id === message.id);
    if (existing && (existing.threadId !== message.threadId
      || existing.senderId !== message.senderId
      || existing.timestamp !== message.timestamp
      || existing.replyToMessageId !== message.replyToMessageId
      || (existing.announcementId !== undefined && existing.announcementId !== message.announcementId)
      || (existing.contentItemId !== undefined && existing.contentItemId !== message.contentItemId))) {
      issue(issues, 'error', 'message_identity_changed', `messages[${index}].id`, 'An upsert cannot change a message\'s thread, sender, original timestamp, or reply target.');
    }
    if (existing) {
      const existingRevision = existing.revision ?? 1;
      const incomingRevision = message.revision ?? 1;
      const contentChanged = existing.text !== message.text
        || existing.mediaUrl !== message.mediaUrl
        || existing.mediaType !== message.mediaType
        || existing.mediaName !== message.mediaName
        || existing.announcementId !== message.announcementId
        || existing.announcementTitle !== message.announcementTitle
        || existing.announcementSeverity !== message.announcementSeverity
        || existing.contentItemId !== message.contentItemId
        || existing.editedAt !== message.editedAt
        || JSON.stringify(existing.mentionedUserIds ?? []) !== JSON.stringify(message.mentionedUserIds ?? [])
        || existing.deletedAt !== message.deletedAt;
      if (incomingRevision < existingRevision) {
        issue(issues, 'error', 'stale_message_revision', `messages[${index}].revision`, `Message revision ${incomingRevision} is older than revision ${existingRevision}.`);
      } else if (contentChanged && incomingRevision <= existingRevision) {
        issue(issues, 'error', 'message_revision_conflict', `messages[${index}].revision`, `Changed message content must advance beyond revision ${existingRevision}.`);
      }
      if (existing.deletedAt !== undefined && message.deletedAt === undefined) {
        issue(issues, 'error', 'message_tombstone_reversed', `messages[${index}].deletedAt`, 'A deleted message tombstone cannot be restored by an upsert.');
      }
      if (existing.editedAt !== undefined && (message.editedAt === undefined || message.editedAt < existing.editedAt)) {
        issue(issues, 'error', 'message_audit_time_reversed', `messages[${index}].editedAt`, 'An upsert cannot erase or move a message edit timestamp backwards.');
      }
      if (existing.deletedAt !== undefined && message.deletedAt !== undefined && message.deletedAt < existing.deletedAt) {
        issue(issues, 'error', 'message_audit_time_reversed', `messages[${index}].deletedAt`, 'An upsert cannot move a message deletion timestamp backwards.');
      }
    }
  });
  const submissions = Array.isArray(input.submissions)
    ? input.submissions.flatMap((raw, index) => {
        const submission = normalizeSubmission(raw, index, courseIds, userIds, itemById, issues);
        return submission ? [submission] : [];
      })
    : [];
  if (input.submissions !== undefined && !Array.isArray(input.submissions)) issue(issues, 'error', 'invalid_submissions', 'submissions', 'submissions must be an array.');
  const submissionIds = new Set<string>();
  const submissionAttemptKeys = new Set<string>();
  const liveSessionParticipantKeys = new Set<string>();
  submissions.forEach((submission, index) => {
    if (submissionIds.has(submission.id)) issue(issues, 'error', 'duplicate_submission_id', `submissions[${index}].id`, `Duplicate submission id "${submission.id}".`);
    submissionIds.add(submission.id);
    const path = `submissions[${index}]`;
    const course = courseById.get(submission.courseId);
    const student = course?.staff.find(member => member.id === submission.studentId);
    const item = itemById.get(submission.contentItemId);
    const currentSubmissionGroup = student && item?.workType === 'group' ? getGroupForUser(course, item, student.id) : undefined;
    const referencedSubmissionGroup = item?.workType === 'group' && submission.groupId
      ? getGroupFromSet(course, item.groupSetId, submission.groupId)
      : undefined;
    const submissionGroup = currentSubmissionGroup || (student?.role !== 'student' ? referencedSubmissionGroup : undefined);
    if (!student) {
      issue(issues, 'error', 'submission_student_not_enrolled', `${path}.studentId`, 'The historical submission owner must remain enrolled in this course.');
    }
    if (item?.workType === 'group') {
      if (!submission.groupId) issue(issues, 'error', 'missing_submission_group', `${path}.groupId`, 'Group coursework requires a groupId.');
      else if (!student
        || (student.role === 'student' && currentSubmissionGroup?.id !== submission.groupId)
        || (student.role !== 'student' && !referencedSubmissionGroup)) {
        issue(issues, 'error', 'submission_group_mismatch', `${path}.groupId`, 'The submission group is not valid for this coursework and historical owner.');
      }
    } else if (submission.groupId) {
      issue(issues, 'error', 'unexpected_submission_group', `${path}.groupId`, 'Individual coursework cannot carry a groupId.');
    }
    const attemptNumber = submission.attemptNumber ?? 1;
    const attemptOwner = item?.workType === 'group' ? submission.groupId : submission.studentId;
    const attemptKey = JSON.stringify([submission.contentItemId, attemptOwner, attemptNumber]);
    if (submissionAttemptKeys.has(attemptKey)) {
      issue(issues, 'error', 'duplicate_submission_attempt', `${path}.attemptNumber`, 'An assessment owner cannot have two records for the same attempt number.');
    }
    submissionAttemptKeys.add(attemptKey);
    if (submission.liveSessionId) {
      const liveParticipantKey = JSON.stringify([submission.contentItemId, submission.liveSessionId, submission.studentId]);
      if (liveSessionParticipantKeys.has(liveParticipantKey)) {
        issue(issues, 'error', 'duplicate_live_session_submission', `${path}.liveSessionId`, 'A live session can archive only one submission per participant.');
      }
      liveSessionParticipantKeys.add(liveParticipantKey);
    }
    const expectedDisplayName = item?.workType === 'group' ? submissionGroup?.name : student?.name;
    if (submission.studentName && expectedDisplayName && submission.studentName !== expectedDisplayName) {
      issue(issues, 'error', 'submission_name_mismatch', `${path}.studentName`, 'Submission display names must match the authoritative directory user or assignment group name.');
    }
    if (expectedDisplayName) submission.studentName = expectedDisplayName;
    if (submission.gradedBy) {
      const grader = course?.staff.find(member => member.id === submission.gradedBy);
      if (!grader || !CHAT_STAFF_ROLES.has(grader.role)) {
        issue(issues, 'error', 'grader_not_authorized', `${path}.gradedBy`, 'The grader must be course staff with grading permission.');
      }
    }
    const existing = context?.submissions?.find(candidate => candidate.id === submission.id);
    if (existing && (
      existing.studentId !== submission.studentId
      || existing.courseId !== submission.courseId
      || existing.contentItemId !== submission.contentItemId
      || existing.groupId !== submission.groupId
      || existing.liveSessionId !== submission.liveSessionId
      || (existing.attemptNumber ?? 1) !== (submission.attemptNumber ?? 1)
    )) {
      issue(issues, 'error', 'submission_identity_changed', `${path}.id`, 'An upsert cannot change a submission\'s owner, course, content item, group, or attempt number.');
    }
  });

  const contentProgress = Array.isArray(input.contentProgress)
    ? input.contentProgress.flatMap((raw, index) => {
        const record = normalizeContentProgress(raw, index, issues);
        return record ? [record] : [];
      })
    : [];
  if (input.contentProgress !== undefined && !Array.isArray(input.contentProgress)) {
    issue(issues, 'error', 'invalid_content_progress', 'contentProgress', 'contentProgress must be an array.');
  }
  const progressKeys = new Set<string>();
  contentProgress.forEach((record, index) => {
    const path = `contentProgress[${index}]`;
    const key = JSON.stringify([record.userId, record.contentItemId]);
    if (progressKeys.has(key)) {
      issue(issues, 'error', 'duplicate_content_progress', path, 'A learner can have only one progress record per content item.');
    }
    progressKeys.add(key);
    const course = courseById.get(record.courseId);
    const item = itemById.get(record.contentItemId);
    const membership = course?.staff.find(member => member.id === record.userId);
    if (!course || !membership) {
      issue(issues, 'error', 'content_progress_user_not_enrolled', `${path}.userId`, 'The progress owner must be enrolled in this course.');
    } else if (membership.role !== 'student') {
      issue(issues, 'error', 'content_progress_not_learner', `${path}.userId`, 'Course progress may be recorded only for a student enrollment.');
    }
    if (!item || item.courseId !== record.courseId) {
      issue(issues, 'error', 'content_progress_item_mismatch', `${path}.contentItemId`, 'The progress item must belong to this course.');
    }
    const existing = context?.contentProgress?.find(candidate => candidate.userId === record.userId && candidate.contentItemId === record.contentItemId);
    if (existing) {
      if (existing.courseId !== record.courseId) {
        issue(issues, 'error', 'content_progress_identity_changed', `${path}.courseId`, 'A progress record cannot move between courses.');
      }
      if (record.revision < existing.revision) {
        issue(issues, 'error', 'stale_content_progress_revision', `${path}.revision`, `Content progress revision ${record.revision} is older than revision ${existing.revision}.`);
      } else if ((record.lastViewedAt !== existing.lastViewedAt || record.completedAt !== existing.completedAt) && record.revision <= existing.revision) {
        issue(issues, 'error', 'content_progress_revision_conflict', `${path}.revision`, `Changed content progress must advance beyond revision ${existing.revision}.`);
      }
      if (record.firstViewedAt !== existing.firstViewedAt || record.lastViewedAt < existing.lastViewedAt) {
        issue(issues, 'error', 'content_progress_audit_changed', path, 'Progress cannot change its first view or move its last view backwards.');
      }
    }
  });

  if (deletions) {
    const incomingIdsByField: Record<keyof InstitutionSyncDeletions, Set<string>> = {
      users: incomingUserIds,
      courses: incomingCourseIds,
      contentItems: new Set(incomingItemCourseById.keys()),
      threads: incomingThreadIds,
      messages: messageIds,
      submissions: submissionIds,
    };
    deletionFields.forEach(field => {
      (deletions[field] ?? []).forEach((id, index) => {
        if (incomingIdsByField[field].has(id)) {
          issue(issues, 'error', 'upsert_delete_conflict', `deletions.${field}[${index}]`, `Entity "${id}" cannot be upserted and deleted in the same atomic payload.`);
        }
      });
    });
  }

  if (integrations !== undefined) {
    const availableCapabilities = new Set(integrations.flatMap(source => source.capabilities));
    const requireCapability = (required: InstitutionIntegrationCapability, path: string, reason: string) => {
      if (!availableCapabilities.has(required)) {
        issue(issues, 'error', 'undeclared_integration_capability', path, `${reason} requires a declared "${required}" integration capability.`);
      }
    };
    if (users.length) requireCapability('roster.read', 'integrations', 'Returning directory users');
    if (courses.length) {
      requireCapability('courses.read', 'integrations', 'Returning courses');
      if (courses.some(entry => entry.enrollments.length)) requireCapability('roster.read', 'integrations', 'Returning course enrollments');
      if (courses.some(entry => entry.items.length)) requireCapability('content.read', 'integrations', 'Returning course content');
    }
    if (submissions.length) {
      requireCapability('submissions.read', 'integrations', 'Returning submissions');
      if (submissions.some(submission => submission.totalScore !== undefined
        || submission.gradeStatus !== undefined
        || submission.gradedBy !== undefined
        || submission.responses.some(response => response.score !== undefined || response.isCorrect !== undefined))) {
        requireCapability('grades.read', 'integrations', 'Returning grading data');
      }
    }
    if (contentProgress.length) requireCapability('content-progress.read', 'integrations', 'Returning learner content progress');
    if (threads.length || messages.length) requireCapability('chat.read', 'integrations', 'Returning conversations or messages');
  }

  if (issues.some(entry => entry.severity === 'error')) return { success: false, issues };
  const data: NormalizedInstitutionSync = {
    schemaVersion: INSTITUTION_SCHEMA_VERSION,
    syncId,
    generatedAt,
    mode: mode || 'snapshot',
    institution: {
      id: institutionId,
      name: institutionName,
      timeZone: institutionTimeZone,
      metadata: institutionMetadata,
    },
    integrations,
    users,
    courses,
    threads,
    messages,
    submissions,
    contentProgress,
    deletions,
    cursor: cleanString(input.cursor),
    etag: cleanString(input.etag),
  };
  if (mode === 'upsert' && context) {
    const effectiveResult = validateInstitutionSync(mergeNormalizedInstitutionSync(context, data));
    if (!effectiveResult.success) {
      return {
        success: false,
        issues: [
          ...issues,
          ...effectiveResult.issues.map(entry => ({
            ...entry,
            code: `effective_${entry.code}`,
            message: `After applying this upsert: ${entry.message}`,
          })),
        ],
      };
    }
  }
  return { success: true, issues, data };
}

export const formatValidationIssues = (issues: ValidationIssue[]): string =>
  issues.map(entry => `${entry.severity.toUpperCase()} ${entry.path}: ${entry.message}`).join('\n');
