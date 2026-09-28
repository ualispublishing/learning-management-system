import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAssessmentResponses,
  calculateSubmissionTotal,
  clampQuestionScore,
  getAttemptEligibility,
  hasAssessmentAnswer,
  isGradeReleasedToStudent,
  normalizeAssessmentForPersistence,
  validateAssessment,
} from '../src/lib/assessment/engine';
import { ContentItem, StudentSubmission } from '../src/types/lms';

const assessment: ContentItem = {
  id: 'quiz-1',
  courseId: 'course-1',
  category: 'coursework',
  title: 'Reliable grading',
  presentationSlot: 'current',
  createdAt: 1,
  isGraded: true,
  workType: 'individual',
  quizConfig: { questionsPerPage: 'all', maxAttempts: 2, allowRevisit: true },
  questions: [
    { id: 'mc', label: '1', content: 'Choose both.', answerType: 'multiple_choice', options: ['Alpha', 'Beta', 'Gamma'], correctAnswer: ['Alpha', 'Beta'], allowMultipleCorrect: true, points: 5, deduction: 2 },
    { id: 'text', label: '2', content: 'Name the protocol.', answerType: 'text', correctAnswer: 'HTTPS', textMatchMode: 'exact', points: 3 },
    { id: 'upload', label: '3', content: 'Upload your work.', answerType: 'dropbox', points: 7 },
  ],
};

test('assessment auto-grading is normalized, order-independent, and auditable', () => {
  const responses = buildAssessmentResponses(assessment, {
    mc: [' beta ', 'ALPHA'],
    text: 'https',
  });
  assert.equal(responses.length, 3);
  assert.deepEqual(responses.map(response => response.score), [5, 3, 0]);
  assert.equal(responses[0].isManuallyGraded, false);
  assert.equal(responses[2].answer, null);
  assert.equal(responses[2].needsManualGrading, false);
  assert.equal(calculateSubmissionTotal(responses), 8);
});

test('manual grading is requested only when an answer exists', () => {
  const responses = buildAssessmentResponses(assessment, { upload: 'https://assets.example.edu/submission/file-1' });
  assert.equal(responses[2].needsManualGrading, true);
  assert.equal(responses[2].isManuallyGraded, false);
});

test('an erased text answer key cannot make every response auto-correct', () => {
  const [response] = buildAssessmentResponses({
    ...assessment,
    questions: [{
      id: 'empty-key',
      label: '1',
      content: 'Explain the result.',
      answerType: 'text',
      correctAnswer: '   ',
      textMatchMode: 'contains',
      points: 4,
    }],
  }, { 'empty-key': 'Any non-empty response' });
  assert.equal(response.isCorrect, undefined);
  assert.equal(response.score, 0);
  assert.equal(response.needsManualGrading, true);
});

test('blank answer detection treats empty multi-select values as unanswered', () => {
  assert.equal(hasAssessmentAnswer([]), false);
  assert.equal(hasAssessmentAnswer('   '), false);
  assert.equal(hasAssessmentAnswer(0), true);
  assert.equal(hasAssessmentAnswer(['Alpha']), true);
});

test('ungraded assessments and polls never manufacture grading metadata', () => {
  const ungradedResponses = buildAssessmentResponses({ ...assessment, isGraded: false }, {
    mc: ['Alpha', 'Beta'],
    text: 'HTTPS',
  });
  assert.equal(calculateSubmissionTotal(ungradedResponses), 0);
  assert.equal(ungradedResponses[0].score, undefined);
  assert.equal(ungradedResponses[0].isCorrect, undefined);
  assert.equal(ungradedResponses[2].needsManualGrading, undefined);

  const pollResponses = buildAssessmentResponses({ ...assessment, isPoll: true }, { mc: ['Alpha', 'Beta'] });
  assert.equal(pollResponses[0].score, undefined);
  assert.equal(pollResponses[0].answer instanceof Array, true);
});

test('assessment persistence normalizes contradictory poll and live timer settings', () => {
  const normalized = normalizeAssessmentForPersistence({
    ...assessment,
    isPoll: true,
    isPopQuiz: true,
    gradingCategory: 'Assessments',
    quizConfig: { ...assessment.quizConfig!, timeLimitSeconds: 300, enforceTimer: true },
  });
  assert.equal(normalized.isGraded, false);
  assert.equal(normalized.gradingCategory, undefined);
  assert.equal(normalized.quizConfig?.timeLimitSeconds, undefined);
  assert.equal(normalized.quizConfig?.enforceTimer, false);
  assert.equal(normalized.workType, 'individual');
  assert.equal(normalized.groupSetId, undefined);
});

test('assessment validation catches structural and rubric inconsistencies', () => {
  const invalid: ContentItem = {
    ...assessment,
    questions: [
      { id: 'dup', label: '1', content: '', answerType: 'multiple_choice', options: ['A', 'A'], points: 5 },
      { id: 'dup', label: '2', content: 'Rubric', answerType: 'text', points: 5, rubric: [{ id: 'r', label: 'Quality', maxPoints: 4 }] },
    ],
  };
  const codes = validateAssessment(invalid).map(issue => issue.code);
  assert.ok(codes.includes('missing_question_text'));
  assert.ok(codes.includes('duplicate_options'));
  assert.ok(codes.includes('missing_correct_answer'));
  assert.ok(codes.includes('duplicate_question_id'));
  assert.ok(codes.includes('rubric_total_mismatch'));
});

test('assessment validation rejects blank multiple-choice options', () => {
  const invalid: ContentItem = {
    ...assessment,
    questions: [{
      ...assessment.questions![0],
      options: ['Answer', '   '],
      correctAnswer: 'Answer',
    }],
  };
  assert.ok(validateAssessment(invalid).some(issue => issue.code === 'empty_option'));
});

test('assessment validation enforces persistence-size limits in every repository mode', () => {
  const oversized: ContentItem = {
    ...assessment,
    title: 'x'.repeat(501),
    questions: [{
      id: 'large', label: '1', content: 'Question', answerType: 'custom_code', points: 1,
      customConfig: { initialCode: 'x'.repeat(65_537) },
    }],
  };
  const codes = validateAssessment(oversized).map(issue => issue.code);
  assert.ok(codes.includes('title_too_long'));
  assert.ok(codes.includes('custom_config_too_large'));
});

test('live assessments reject unsupported interactions and invalid timers before hosting', () => {
  const invalid: ContentItem = {
    ...assessment,
    isPopQuiz: true,
    questions: [
      { id: 'upload-live', label: '1', content: 'Upload work.', answerType: 'dropbox', points: 5 },
      { id: 'timer-live', label: '2', content: 'Respond.', answerType: 'text', points: 5, customConfig: { timerSeconds: -1 } },
    ],
  };
  const codes = validateAssessment(invalid).map(issue => issue.code);
  assert.ok(codes.includes('unsupported_live_question'));
  assert.ok(codes.includes('invalid_live_timer'));
});

test('correct-or-incorrect grading is binary and cannot carry an unused rubric', () => {
  const binary: ContentItem = {
    ...assessment,
    questions: [{
      id: 'binary', label: '1', content: 'Explain the result.', answerType: 'text', points: 4,
      gradingType: 'true_false', rubric: [{ id: 'unused', label: 'Unused', maxPoints: 4 }],
    }],
  };
  assert.ok(validateAssessment(binary).some(issue => issue.code === 'binary_grading_has_rubric'));
});

test('attempt limits resume drafts and reject excess completed attempts', () => {
  const base: StudentSubmission = {
    id: 'attempt-1', studentId: 'student-1', contentItemId: assessment.id, courseId: assessment.courseId,
    submittedAt: 1, status: 'draft', responses: [], attemptNumber: 1,
  };
  const resumable = getAttemptEligibility(assessment, [base], 'student-1');
  assert.equal(resumable.resumableSubmission?.id, base.id);

  const completed = [1, 2].map(attemptNumber => ({ ...base, id: `attempt-${attemptNumber}`, status: 'submitted' as const, attemptNumber }));
  const blocked = getAttemptEligibility(assessment, completed, 'student-1');
  assert.equal(blocked.allowed, false);
  assert.match(blocked.reason || '', /Maximum attempts/);
  const afterDiscard = getAttemptEligibility(assessment, [
    { ...base, status: 'discarded', deletedAt: 2, attemptNumber: 1 },
  ], 'student-1');
  assert.equal(afterDiscard.allowed, true);
  assert.equal(afterDiscard.nextAttemptNumber, 2, 'Discarded audit records must not cause attempt-number reuse.');
  assert.equal(clampQuestionScore(assessment.questions![0], 999), 5);
  assert.equal(clampQuestionScore(assessment.questions![0], -4), -2);
});

test('student grade visibility requires an explicitly released graded submission', () => {
  assert.equal(isGradeReleasedToStudent({ status: 'graded', gradeStatus: 'draft' }), false);
  assert.equal(isGradeReleasedToStudent({ status: 'submitted', gradeStatus: 'released' }), false);
  assert.equal(isGradeReleasedToStudent({ status: 'graded', gradeStatus: 'released' }), true);
});
