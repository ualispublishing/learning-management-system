/** Deliberately small first service contract: individual, untimed, written assessments. */
export class GatewayError extends Error {
  status: number;
  constructor(code: string, status = 400) { super(code); this.status = status; }
}
export type JsonObject = Record<string, unknown>;
export function requireCondition(condition: unknown, code = 'invalid_payload', status = 400): asserts condition {
  if (!condition) throw new GatewayError(code, status);
}
export function object(value: unknown, keys: string[]): JsonObject {
  requireCondition(value !== null && typeof value === 'object' && !Array.isArray(value));
  const result = value as JsonObject;
  requireCondition(Object.keys(result).every(key => keys.includes(key)), 'unsupported_field');
  return result;
}
export function text(value: unknown, max = 500, allowEmpty = false): string {
  requireCondition(typeof value === 'string' && value.length <= max && (allowEmpty || !!value.trim()) && !value.includes('\u0000'));
  return value;
}
export function id(value: unknown): string {
  const result = text(value, 128);
  requireCondition(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(result), 'invalid_identifier');
  return result;
}
export function integer(value: unknown, min: number, max: number): number {
  requireCondition(typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max);
  return value;
}
export interface Institution { id: string; name: string; timeZone: string }
export function institution(value: unknown): Institution {
  const data = object(value, ['id', 'name', 'timeZone']);
  const timeZone = text(data.timeZone, 100);
  try { new Intl.DateTimeFormat('en', { timeZone }).format(); } catch { throw new GatewayError('invalid_time_zone'); }
  return { id: id(data.id), name: text(data.name), timeZone };
}
export interface Question { id: string; label: string; content: string; answerType: 'text'; points: number }
export interface Assignment {
  id: string; courseId: string; category: 'coursework'; title: string; description: string;
  presentationSlot: 'current'; createdAt: number; isGraded: true; gradingCategory: 'Assessments';
  workType: 'individual'; submissionTarget: 'in-app'; questions: Question[];
  quizConfig: { questionsPerPage: 'all'; maxAttempts: 1; allowRevisit: true };
}
export function assignment(value: unknown, now: number): Assignment {
  const data = object(value, ['id', 'courseId', 'category', 'title', 'description', 'presentationSlot', 'createdAt', 'isGraded', 'gradingCategory', 'workType', 'submissionTarget', 'questions', 'quizConfig']);
  requireCondition(data.category === 'coursework' && data.presentationSlot === 'current' && data.isGraded === true && data.gradingCategory === 'Assessments' && data.workType === 'individual', 'unsupported_assessment');
  requireCondition(data.submissionTarget === undefined || data.submissionTarget === 'in-app', 'unsupported_assessment');
  const config = object(data.quizConfig, ['questionsPerPage', 'maxAttempts', 'allowRevisit']);
  requireCondition(config.questionsPerPage === 'all' && config.maxAttempts === 1 && config.allowRevisit === true, 'unsupported_assessment');
  requireCondition(Array.isArray(data.questions) && data.questions.length >= 1 && data.questions.length <= 20);
  const questions = data.questions.map(raw => {
    const q = object(raw, ['id', 'label', 'content', 'answerType', 'points']);
    requireCondition(q.answerType === 'text', 'unsupported_question');
    return { id: id(q.id), label: text(q.label), content: text(q.content, 10_000), answerType: 'text' as const, points: integer(q.points, 1, 1000) };
  });
  requireCondition(new Set(questions.map(q => q.id)).size === questions.length, 'duplicate_question');
  return { id: id(data.id), courseId: id(data.courseId), category: 'coursework', title: text(data.title), description: data.description === undefined ? '' : text(data.description, 10_000, true), presentationSlot: 'current', createdAt: now, isGraded: true, gradingCategory: 'Assessments', workType: 'individual', submissionTarget: 'in-app', questions, quizConfig: { questionsPerPage: 'all', maxAttempts: 1, allowRevisit: true } };
}
export interface Mutation { id: string; entity: 'content' | 'submission'; operation: 'create' | 'update'; entityId: string; payload: JsonObject }
export interface Batch { mutations: Mutation[]; cursor?: string }
export function batch(value: unknown): Batch {
  const data = object(value, ['schemaVersion', 'atomic', 'cursor', 'mutations']);
  requireCondition(data.schemaVersion === '1.0' && data.atomic === true, 'unsupported_contract');
  requireCondition(Array.isArray(data.mutations) && data.mutations.length >= 1 && data.mutations.length <= 10);
  const mutations = data.mutations.map(raw => {
    const m = object(raw, ['id', 'entity', 'operation', 'entityId', 'occurredAt', 'payload']);
    requireCondition((m.entity === 'content' && m.operation === 'create') || (m.entity === 'submission' && (m.operation === 'create' || m.operation === 'update')), 'unsupported_operation');
    integer(m.occurredAt, 0, 8_640_000_000_000_000);
    requireCondition(m.payload !== null && typeof m.payload === 'object' && !Array.isArray(m.payload));
    return { id: id(m.id), entity: m.entity as Mutation['entity'], operation: m.operation as Mutation['operation'], entityId: id(m.entityId), payload: m.payload as JsonObject };
  });
  requireCondition(new Set(mutations.map(m => m.id)).size === mutations.length, 'duplicate_mutation');
  return { mutations, ...(data.cursor === undefined ? {} : { cursor: text(data.cursor, 256) }) };
}
export interface Answer { questionId: string; answer: string | null; score?: number; teacherFeedback?: string; isManuallyGraded?: boolean; needsManualGrading?: boolean }
export interface Submission {
  id: string; courseId: string; contentItemId: string; studentId: string; studentName: string;
  status: 'draft' | 'submitted' | 'graded'; responses: Answer[]; revision: number; gradeRevision: number;
  submittedAt: number; startedAt: number; updatedAt: number; attemptNumber: 1;
  gradeStatus?: 'draft' | 'released'; totalScore?: number; overallFeedback?: string; gradedBy?: string; gradedAt?: number;
}
export function submissionPayload(value: unknown): JsonObject {
  const payload = object(value, ['id', 'courseId', 'contentItemId', 'studentId', 'studentName', 'status', 'responses', 'revision', 'expectedRevision', 'expectedGradeRevision', 'gradeRevision', 'submittedAt', 'startedAt', 'updatedAt', 'attemptNumber', 'gradeStatus', 'totalScore', 'overallFeedback', 'gradedBy', 'gradedAt', 'isLate']);
  requireCondition(payload.isLate === undefined || payload.isLate === false, 'unsupported_deadline');
  return payload;
}
export function answers(raw: unknown, item: Assignment, grading: boolean): Answer[] {
  requireCondition(Array.isArray(raw) && raw.length <= item.questions.length);
  const result = raw.map(value => {
    const a = object(value, grading ? ['questionId', 'answer', 'score', 'teacherFeedback', 'isManuallyGraded', 'needsManualGrading', 'rubricScores', 'isCorrect'] : ['questionId', 'answer']);
    const questionId = id(a.questionId);
    const question = item.questions.find(q => q.id === questionId);
    requireCondition(question, 'unknown_question');
    const answer = a.answer === null ? null : text(a.answer, 10_000, true);
    if (!grading) return { questionId, answer };
    requireCondition(typeof a.score === 'number' && Number.isFinite(a.score) && a.score >= 0 && a.score <= question.points, 'invalid_score');
    if (a.rubricScores !== undefined) {
      const rubric = object(a.rubricScores, [`${questionId}:overall`]);
      requireCondition(rubric[`${questionId}:overall`] === a.score, 'invalid_score');
    }
    return { questionId, answer, score: a.score, teacherFeedback: a.teacherFeedback === undefined ? '' : text(a.teacherFeedback, 10_000, true), isManuallyGraded: true, needsManualGrading: false };
  });
  requireCondition(new Set(result.map(a => a.questionId)).size === result.length, 'duplicate_answer');
  // Stable order makes comparisons independent of JSON property/array order.
  return item.questions.flatMap(q => result.filter(a => a.questionId === q.id));
}
