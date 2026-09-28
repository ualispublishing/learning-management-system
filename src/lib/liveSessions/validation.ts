/**
 * @fileoverview src/lib/liveSessions/validation.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import { PopQuizState, QuizQuestion } from '../../types/lms';

const MAX_LIVE_STATE_BYTES = 1_000_000;
const MAX_LIVE_PARTICIPANTS = 10_000;
const MAX_ANSWER_BYTES = 50_000;
const UNSAFE_RECORD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const validIdentifier = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 256;

const validTimestamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0;

const assertJsonSafe = (value: unknown, path: string, seen = new Set<object>(), depth = 0): void => {
  if (depth > 20) throw new Error(`${path} exceeds the supported nesting depth.`);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} contains a non-finite number.`);
    return;
  }
  if (typeof value !== 'object') throw new Error(`${path} is not JSON-safe.`);
  if (seen.has(value)) throw new Error(`${path} contains a circular reference.`);
  seen.add(value);
  if (Array.isArray(value)) {
    if (value.length > 1_000) throw new Error(`${path} contains too many values.`);
    value.forEach((entry, index) => assertJsonSafe(entry, `${path}[${index}]`, seen, depth + 1));
  } else {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 1_000) throw new Error(`${path} contains too many fields.`);
    entries.forEach(([key, entry]) => {
      if (!validIdentifier(key) || UNSAFE_RECORD_KEYS.has(key)) throw new Error(`${path} contains an unsafe field name.`);
      assertJsonSafe(entry, `${path}.${key}`, seen, depth + 1);
    });
  }
  seen.delete(value);
};

export const validateLiveAnswer = (question: QuizQuestion, answer: unknown): void => {
  assertJsonSafe(answer, 'Live answer');
  const encoded = JSON.stringify(answer);
  if (encoded === undefined || encoded.length > MAX_ANSWER_BYTES) throw new Error('Live answer is too large.');

  if (question.answerType === 'multiple_choice') {
    const answers = question.allowMultipleCorrect
      ? Array.isArray(answer) ? answer : []
      : typeof answer === 'string' ? [answer] : [];
    if (!answers.length || answers.some(value => typeof value !== 'string' || !question.options?.includes(value))) {
      throw new Error('Live multiple-choice answer is not one of the available options.');
    }
    if (new Set(answers).size !== answers.length) throw new Error('Live multiple-choice answer contains duplicate options.');
    return;
  }
  if (question.answerType === 'spectrum') {
    const min = typeof question.customConfig?.min === 'number' ? question.customConfig.min : 1;
    const max = typeof question.customConfig?.max === 'number' ? question.customConfig.max : 5;
    if (typeof answer !== 'number' || !Number.isInteger(answer) || answer < min || answer > max) {
      throw new Error('Live spectrum answer is outside the configured range.');
    }
    return;
  }
  if (question.answerType === 'text' || question.answerType === 'timed') {
    if (typeof answer !== 'string' || !answer.trim() || answer.length > 20_000) {
      throw new Error('Live text answer must contain between 1 and 20,000 characters.');
    }
    return;
  }
  throw new Error(`Question type "${question.answerType}" is not supported in a live session.`);
};

export interface LiveStateValidationOptions {
  expectedCourseworkId: string;
  questions?: QuizQuestion[];
  participantIds?: Set<string>;
}

/** Reject untrusted realtime payloads before they can replace valid store state. */
export const validatePopQuizState = (value: unknown, options: LiveStateValidationOptions): PopQuizState | null => {
  if (value === null) return null;
  if (!isRecord(value)) throw new Error('Live session payload must be a JSON object or null.');
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new Error('Live session payload is not valid JSON.');
  }
  if (encoded.length > MAX_LIVE_STATE_BYTES) throw new Error('Live session payload exceeds the 1 MB safety limit.');
  if (value.courseworkId !== options.expectedCourseworkId) throw new Error('Live session payload belongs to a different coursework item.');
  if (!validIdentifier(value.sessionId)) throw new Error('Live session identifier is invalid.');
  if (!validTimestamp(value.startedAt) || value.startedAt < 1) throw new Error('Live session start time is invalid.');
  if (!Number.isSafeInteger(value.revision) || Number(value.revision) < 1) throw new Error('Live session revision must be a positive safe integer.');
  if (!['waiting', 'active', 'ended'].includes(String(value.status))) throw new Error('Live session status is invalid.');
  if (value.currentQuestionId !== null && !validIdentifier(value.currentQuestionId)) throw new Error('Live session current question identifier is invalid.');
  if (value.questionOpenedAt !== null && !validTimestamp(value.questionOpenedAt)) throw new Error('Live question start time is invalid.');
  if (value.questionClosesAt !== null && !validTimestamp(value.questionClosesAt)) throw new Error('Live question close time is invalid.');
  if (!Array.isArray(value.completedQuestionIds) || value.completedQuestionIds.some(id => !validIdentifier(id))) {
    throw new Error('Live session completed-question list is invalid.');
  }
  const completedQuestionIds = value.completedQuestionIds as string[];
  if (completedQuestionIds.length > 1_000 || new Set(completedQuestionIds).size !== completedQuestionIds.length) {
    throw new Error('Live session completed-question list is duplicated or too large.');
  }
  if (!isRecord(value.answers)) throw new Error('Live session answers must be a JSON object.');
  if (Object.keys(value.answers).length > MAX_LIVE_PARTICIPANTS) throw new Error('Live session has too many participant answer records.');

  const allowedQuestions = options.questions
    ? new Map(options.questions.filter(question => question.answerType !== 'page_break').map(question => [question.id, question]))
    : undefined;
  const currentQuestionId = value.currentQuestionId as string | null;
  if (currentQuestionId && allowedQuestions && !allowedQuestions.has(currentQuestionId)) throw new Error('Live session references a question outside this coursework item.');
  if (completedQuestionIds.some(id => allowedQuestions && !allowedQuestions.has(id))) throw new Error('Live session completed list references an unknown question.');
  if (value.status === 'active') {
    if (!currentQuestionId || value.questionOpenedAt === null) throw new Error('An active live session requires a current question and start time.');
    if (value.questionOpenedAt < value.startedAt) throw new Error('A live question cannot open before its session starts.');
    if (completedQuestionIds.includes(currentQuestionId)) throw new Error('An active live question cannot already be completed.');
  } else if (value.questionOpenedAt !== null || value.questionClosesAt !== null) {
    throw new Error('An inactive live session cannot retain an active question timer.');
  }
  if (value.questionClosesAt !== null && (value.questionOpenedAt === null || value.questionClosesAt <= value.questionOpenedAt)) {
    throw new Error('Live question close time must be after its start time.');
  }

  Object.entries(value.answers).forEach(([studentId, rawAnswers]) => {
    if (!validIdentifier(studentId) || UNSAFE_RECORD_KEYS.has(studentId)) throw new Error('Live session contains an invalid participant identifier.');
    if (options.participantIds && !options.participantIds.has(studentId)) throw new Error('Live session contains answers from a user who is not an enrolled student.');
    if (!isRecord(rawAnswers)) throw new Error(`Live answers for "${studentId}" must be a JSON object.`);
    Object.entries(rawAnswers).forEach(([questionId, answer]) => {
      if (!validIdentifier(questionId) || UNSAFE_RECORD_KEYS.has(questionId)) throw new Error('Live session contains an invalid answer question identifier.');
      const question = allowedQuestions?.get(questionId);
      if (allowedQuestions && !question) throw new Error('Live session answer references an unknown question.');
      if (question) validateLiveAnswer(question, answer);
      else assertJsonSafe(answer, `Live answer ${studentId}.${questionId}`);
    });
  });

  return JSON.parse(encoded) as PopQuizState;
};
