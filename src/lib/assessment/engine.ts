/**
 * @fileoverview src/lib/assessment/engine.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import { ContentItem, QuestionResponse, QuizQuestion, StudentSubmission } from '../../types/lms';

export interface AssessmentIssue {
  severity: 'error' | 'warning';
  code: string;
  path: string;
  message: string;
}

export interface AttemptEligibility {
  allowed: boolean;
  reason?: string;
  nextAttemptNumber: number;
  resumableSubmission?: StudentSubmission;
}

const normalizedText = (value: unknown): string => String(value ?? '')
  .normalize('NFKC')
  .trim()
  .replace(/\s+/g, ' ')
  .toLocaleLowerCase();

export const hasAssessmentAnswer = (answer: unknown): boolean => {
  if (Array.isArray(answer)) return answer.length > 0;
  return answer !== null && answer !== undefined && String(answer).trim().length > 0;
};

const questionPoints = (question: QuizQuestion) => Math.max(0, Number.isFinite(question.points) ? question.points || 0 : 0);

export const getAssessmentMaxScore = (item: Pick<ContentItem, 'questions'>): number =>
  (item.questions || [])
    .filter(question => question.answerType !== 'page_break')
    .reduce((total, question) => total + questionPoints(question), 0);

/** External gradebooks may publish a global maximum without synthetic questions. */
export const getGradingMaxScore = (item: Pick<ContentItem, 'questions' | 'submissionTarget' | 'metadata'>): number => {
  const configured = item.submissionTarget === 'external-link' ? item.metadata?.gradingMaxPoints : undefined;
  return typeof configured === 'number' && Number.isFinite(configured) && configured > 0
    ? configured
    : getAssessmentMaxScore(item);
};

/** Removes contradictory grading and timer flags before an authored assessment is persisted. */
export const normalizeAssessmentForPersistence = (item: ContentItem): ContentItem => {
  const isGraded = item.isPoll !== true && item.isGraded === true;
  const usesLiveQuestionTimers = item.isPoll === true || item.isPopQuiz === true;
  return {
    ...item,
    isGraded,
    gradingCategory: isGraded ? item.gradingCategory : undefined,
    workType: usesLiveQuestionTimers ? 'individual' : item.workType,
    groupSetId: usesLiveQuestionTimers ? undefined : item.groupSetId,
    quizConfig: item.quizConfig ? {
      ...item.quizConfig,
      timeLimitSeconds: usesLiveQuestionTimers ? undefined : item.quizConfig.timeLimitSeconds,
      enforceTimer: usesLiveQuestionTimers ? false : item.quizConfig.enforceTimer,
    } : undefined,
  };
};

export const validateAssessment = (item: ContentItem): AssessmentIssue[] => {
  const issues: AssessmentIssue[] = [];
  const questions = item.questions || [];
  const scoredQuestions = questions.filter(question => question.answerType !== 'page_break');
  if (!item.title.trim()) issues.push({ severity: 'error', code: 'missing_title', path: 'title', message: 'Assessment title is required.' });
  if (item.title.length > 500) issues.push({ severity: 'error', code: 'title_too_long', path: 'title', message: 'Assessment title cannot exceed 500 characters.' });
  if ((item.description?.length || 0) > 250_000) issues.push({ severity: 'error', code: 'description_too_long', path: 'description', message: 'Assessment description cannot exceed 250,000 characters.' });
  if (questions.length > 1_000) issues.push({ severity: 'error', code: 'too_many_questions', path: 'questions', message: 'An assessment cannot contain more than 1,000 questions.' });
  if (!scoredQuestions.length) issues.push({ severity: 'error', code: 'missing_questions', path: 'questions', message: 'Add at least one question.' });

  const ids = new Set<string>();
  questions.forEach((question, index) => {
    const path = `questions[${index}]`;
    if (!question.id.trim()) issues.push({ severity: 'error', code: 'missing_question_id', path: `${path}.id`, message: 'Question id is required.' });
    if (ids.has(question.id)) issues.push({ severity: 'error', code: 'duplicate_question_id', path: `${path}.id`, message: `Question id "${question.id}" is duplicated.` });
    ids.add(question.id);
    if (question.answerType === 'page_break') {
      if (index === 0 || index === questions.length - 1 || questions[index - 1]?.answerType === 'page_break') {
        issues.push({ severity: 'error', code: 'invalid_page_break', path, message: 'Page breaks cannot be first, last, or consecutive.' });
      }
      return;
    }
    if (!question.content.trim() && !question.title?.trim()) issues.push({ severity: 'error', code: 'missing_question_text', path: `${path}.content`, message: 'Question text is required.' });
    if ((question.title?.length || 0) > 500) issues.push({ severity: 'error', code: 'question_title_too_long', path: `${path}.title`, message: 'Question titles cannot exceed 500 characters.' });
    if (question.content.length > 100_000) issues.push({ severity: 'error', code: 'question_too_long', path: `${path}.content`, message: 'Question text cannot exceed 100,000 characters.' });
    if (!Number.isFinite(question.points) || (question.points || 0) < 0) issues.push({ severity: 'error', code: 'invalid_points', path: `${path}.points`, message: 'Points must be a non-negative number.' });
    if ((question.deduction || 0) < 0) issues.push({ severity: 'error', code: 'invalid_deduction', path: `${path}.deduction`, message: 'Penalty cannot be negative.' });
    if (question.gradingType === 'true_false' && question.rubric?.length) {
      issues.push({ severity: 'error', code: 'binary_grading_has_rubric', path: `${path}.rubric`, message: 'Correct/incorrect grading cannot also use a point rubric.' });
    }

    if (question.answerType === 'multiple_choice') {
      const options = question.options || [];
      if (options.length > 500) issues.push({ severity: 'error', code: 'too_many_options', path: `${path}.options`, message: 'A question cannot contain more than 500 options.' });
      if (options.length < 2) issues.push({ severity: 'error', code: 'insufficient_options', path: `${path}.options`, message: 'Multiple choice requires at least two options.' });
      if (options.some(option => !option.trim())) issues.push({ severity: 'error', code: 'empty_option', path: `${path}.options`, message: 'Multiple-choice options cannot be blank.' });
      if (options.some(option => option.length > 10_000)) issues.push({ severity: 'error', code: 'option_too_long', path: `${path}.options`, message: 'Multiple-choice options cannot exceed 10,000 characters.' });
      const uniqueOptions = new Set(options.map(normalizedText));
      if (uniqueOptions.size !== options.length) issues.push({ severity: 'error', code: 'duplicate_options', path: `${path}.options`, message: 'Multiple-choice options must be unique.' });
      const correct = Array.isArray(question.correctAnswer) ? question.correctAnswer : question.correctAnswer ? [question.correctAnswer] : [];
      if (item.isGraded && !correct.length) issues.push({ severity: 'error', code: 'missing_correct_answer', path: `${path}.correctAnswer`, message: 'A graded multiple-choice question needs a correct answer.' });
      correct.forEach(answer => {
        if (!options.some(option => normalizedText(option) === normalizedText(answer))) {
          issues.push({ severity: 'error', code: 'answer_not_in_options', path: `${path}.correctAnswer`, message: `Correct answer "${answer}" is not an option.` });
        }
      });
    }

    if (question.answerType === 'spectrum') {
      const min = Number(question.customConfig?.min ?? 1);
      const max = Number(question.customConfig?.max ?? 5);
      if (!Number.isInteger(min) || !Number.isInteger(max) || min >= max || max - min > 20) {
        issues.push({ severity: 'error', code: 'invalid_spectrum', path: `${path}.customConfig`, message: 'Scale min/max must be integers with 2–21 choices.' });
      }
    }

    if (item.isPopQuiz) {
      if (question.answerType === 'dropbox' || question.answerType === 'custom_code') {
        issues.push({ severity: 'error', code: 'unsupported_live_question', path: `${path}.answerType`, message: 'Live assessments support multiple choice, text, timed text, and spectrum questions only.' });
      }
      const timerSeconds = question.customConfig?.timerSeconds;
      if (timerSeconds !== undefined && (!Number.isInteger(timerSeconds) || timerSeconds < 1 || timerSeconds > 86_400)) {
        issues.push({ severity: 'error', code: 'invalid_live_timer', path: `${path}.customConfig.timerSeconds`, message: 'A live-question timer must be a whole number from 1 second to 24 hours.' });
      }
    }

    if (question.rubric?.length) {
      if (question.rubric.length > 200) issues.push({ severity: 'error', code: 'too_many_rubric_criteria', path: `${path}.rubric`, message: 'A rubric cannot contain more than 200 criteria.' });
      const rubricIds = new Set<string>();
      const total = question.rubric.reduce((sum, criterion, criterionIndex) => {
        if (!criterion.id.trim() || rubricIds.has(criterion.id)) issues.push({ severity: 'error', code: 'invalid_rubric_id', path: `${path}.rubric[${criterionIndex}].id`, message: 'Rubric criterion ids must be non-empty and unique.' });
        rubricIds.add(criterion.id);
        if (!criterion.label.trim()) issues.push({ severity: 'error', code: 'missing_rubric_label', path: `${path}.rubric[${criterionIndex}].label`, message: 'Rubric criterion label is required.' });
        if (!Number.isFinite(criterion.maxPoints) || criterion.maxPoints < 0) issues.push({ severity: 'error', code: 'invalid_rubric_points', path: `${path}.rubric[${criterionIndex}].maxPoints`, message: 'Rubric points must be non-negative.' });
        return sum + Math.max(0, criterion.maxPoints || 0);
      }, 0);
      if (Math.abs(total - questionPoints(question)) > 0.0001) issues.push({ severity: 'error', code: 'rubric_total_mismatch', path: `${path}.rubric`, message: `Rubric totals ${total}, but the question is worth ${questionPoints(question)} points.` });
    }
    if (question.customConfig) {
      try {
        if (JSON.stringify(question.customConfig).length > 65_536) {
          issues.push({ severity: 'error', code: 'custom_config_too_large', path: `${path}.customConfig`, message: 'Question configuration cannot exceed 65,536 serialized characters.' });
        }
      } catch {
        issues.push({ severity: 'error', code: 'invalid_custom_config', path: `${path}.customConfig`, message: 'Question configuration must be serializable JSON.' });
      }
    }
  });

  if (item.isPoll && item.isGraded) issues.push({ severity: 'error', code: 'graded_poll', path: 'isGraded', message: 'Polls cannot be graded.' });
  if (item.isGraded && getAssessmentMaxScore(item) <= 0) issues.push({ severity: 'error', code: 'zero_total', path: 'questions', message: 'A graded assessment must be worth more than zero points.' });
  const config = item.quizConfig;
  if (config) {
    if (!Number.isInteger(config.maxAttempts) || config.maxAttempts < 1 || config.maxAttempts > 100) issues.push({ severity: 'error', code: 'invalid_attempts', path: 'quizConfig.maxAttempts', message: 'Attempts must be from 1 to 100.' });
    if (config.questionsPerPage !== 'all' && (!Number.isInteger(config.questionsPerPage) || config.questionsPerPage < 1)) issues.push({ severity: 'error', code: 'invalid_page_size', path: 'quizConfig.questionsPerPage', message: 'Questions per page must be "all" or a positive integer.' });
    if (config.timeLimitSeconds !== undefined && (!Number.isInteger(config.timeLimitSeconds) || config.timeLimitSeconds < 1 || config.timeLimitSeconds > 604_800)) issues.push({ severity: 'error', code: 'invalid_time_limit', path: 'quizConfig.timeLimitSeconds', message: 'Time limit must be a whole number from 1 second to 7 days.' });
    if (config.enforceTimer && config.timeLimitSeconds === undefined) issues.push({ severity: 'error', code: 'timer_without_limit', path: 'quizConfig.enforceTimer', message: 'Timer enforcement requires a time limit.' });
  }
  return issues;
};

const gradeQuestion = (question: QuizQuestion, answer: unknown): QuestionResponse => {
  const response: QuestionResponse = {
    questionId: question.id,
    answer: (answer === undefined ? null : answer) as QuestionResponse['answer'],
    score: 0,
    needsManualGrading: false,
    isManuallyGraded: false,
  };
  if (!hasAssessmentAnswer(answer)) {
    response.isCorrect = false;
    return response;
  }

  const points = questionPoints(question);
  const deduction = Math.max(0, question.deduction || 0);
  if (question.answerType === 'multiple_choice' && question.correctAnswer !== undefined) {
    const expected = (Array.isArray(question.correctAnswer) ? question.correctAnswer : [question.correctAnswer]).map(normalizedText).sort();
    const actual = (Array.isArray(answer) ? answer : [answer]).map(normalizedText).sort();
    const isCorrect = expected.length === actual.length && expected.every((value, index) => value === actual[index]);
    return { ...response, isCorrect, score: isCorrect ? points : -deduction, isManuallyGraded: false };
  }

  if ((question.answerType === 'text' || question.answerType === 'timed') && typeof question.correctAnswer === 'string') {
    const expected = normalizedText(question.correctAnswer);
    // An erased optional answer key is represented as an empty string by text
    // inputs. Treat it as "no key"; `actual.includes('')` is always true and
    // would otherwise silently award full credit to every non-empty response.
    if (expected) {
      const actual = normalizedText(answer);
      const isCorrect = question.textMatchMode === 'contains' ? actual.includes(expected) : actual === expected;
      return { ...response, isCorrect, score: isCorrect ? points : -deduction, isManuallyGraded: false };
    }
  }

  if (points > 0) response.needsManualGrading = true;
  return response;
};

/** Builds one response per non-page-break question, including unanswered questions. */
export const buildAssessmentResponses = (
  item: Pick<ContentItem, 'questions' | 'isGraded' | 'isPoll'>,
  answers: Record<string, unknown>,
  attachments: Record<string, NonNullable<QuestionResponse['attachment']>> = {},
): QuestionResponse[] => (item.questions || [])
  .filter(question => question.answerType !== 'page_break')
  .map(question => {
    const answer = answers[question.id];
    if (item.isPoll || item.isGraded !== true) {
      return {
        questionId: question.id,
        answer: (answer === undefined ? null : answer) as QuestionResponse['answer'],
        attachment: attachments[question.id],
      };
    }
    return { ...gradeQuestion(question, answer), attachment: attachments[question.id] };
  });

export const calculateSubmissionTotal = (responses: QuestionResponse[]): number =>
  Math.max(0, responses.reduce((total, response) => total + (Number.isFinite(response.score) ? response.score || 0 : 0), 0));

/** Learners must never see staff grading drafts, even when scoring is complete. */
export const isGradeReleasedToStudent = (submission?: Pick<StudentSubmission, 'status' | 'gradeStatus'> | null): boolean =>
  submission?.status === 'graded' && submission.gradeStatus === 'released';

export const getAttemptEligibility = (
  item: Pick<ContentItem, 'id' | 'workType' | 'quizConfig'>,
  submissions: StudentSubmission[],
  studentId: string | null,
  groupId?: string,
): AttemptEligibility => {
  if (!studentId) return { allowed: false, reason: 'Sign in before starting this assessment.', nextAttemptNumber: 1 };
  if (item.workType === 'group' && !groupId) return { allowed: false, reason: 'Join a group before starting this assessment.', nextAttemptNumber: 1 };
  const history = submissions
    .filter(submission => submission.contentItemId === item.id)
    .filter(submission => item.workType === 'group' ? submission.groupId === groupId : submission.studentId === studentId)
    .sort((a, b) => (a.attemptNumber || 1) - (b.attemptNumber || 1));
  const relevant = history.filter(submission => submission.status !== 'discarded');
  const resumableSubmission = relevant.find(submission => submission.status === 'draft');
  const completedAttempts = relevant.filter(submission => submission.status === 'submitted' || submission.status === 'graded').length;
  const maxAttempts = item.quizConfig?.maxAttempts ?? 1;
  if (resumableSubmission) return { allowed: true, nextAttemptNumber: resumableSubmission.attemptNumber || completedAttempts + 1, resumableSubmission };
  const nextAttemptNumber = Math.max(0, ...history.map(submission => submission.attemptNumber || 1)) + 1;
  if (completedAttempts >= maxAttempts) return { allowed: false, reason: `Maximum attempts reached (${maxAttempts}).`, nextAttemptNumber };
  return { allowed: true, nextAttemptNumber };
};

export const clampQuestionScore = (question: QuizQuestion, value: number): number => {
  if (!Number.isFinite(value)) return 0;
  const minimum = -Math.max(0, Number.isFinite(question.deduction) ? question.deduction || 0 : 0);
  return Math.min(questionPoints(question), Math.max(minimum, value));
};
