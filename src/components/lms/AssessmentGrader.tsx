/**
 * @fileoverview src/components/lms/AssessmentGrader.tsx.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import React, { useMemo, useRef, useState } from 'react';
import {
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { userAlert as Alert } from '../../lib/userAlert';
import { useThemeColors } from '../../lib/useThemeColors';
import { getGroupsForItem } from '../../lib/groups/courseGroups';
import {
  ContentItem,
  CourseUser,
  QuestionResponse,
  QuizQuestion,
  RubricCriterion,
  StudentSubmission,
} from '../../types/lms';
import { useLMSStore } from '../../lib/store/useLMSStore';
import { clampQuestionScore, getGradingMaxScore } from '../../lib/assessment/engine';
import { NumericInput } from './NumericInput';
import { useCourseRole } from '../../lib/store/selectors';
import { hasCoursePermission } from '../../lib/authorization/coursePermissions';
import { isSafeHttpsUrl } from '../../lib/safeUrl';

const currentTimestamp = () => Date.now();

interface GradingRow {
  student: CourseUser;
  groupId?: string;
  submission?: StudentSubmission;
  draft?: StudentSubmission;
}

function getExternalMaxPoints(item: ContentItem): number {
  return getGradingMaxScore(item);
}

function getRubric(question: QuizQuestion): RubricCriterion[] {
  if (question.rubric?.length) return question.rubric;
  return [{
    id: `${question.id}:overall`,
    label: 'Overall achievement',
    description: 'Score this response against the question requirements.',
    maxPoints: Math.max(0, question.points ?? 0),
  }];
}

function responseMapFor(submission: StudentSubmission, item: ContentItem) {
  const existing = new Map(submission.responses.map(response => [response.questionId, response]));
  return Object.fromEntries(
    (item.questions || [])
      .filter(question => question.answerType !== 'page_break')
      .map(question => [question.id, existing.get(question.id) || {
        questionId: question.id,
        answer: null,
        score: 0,
        needsManualGrading: true,
      }]),
  ) as Record<string, QuestionResponse>;
}

function formatSubmittedAt(timestamp: number) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 'Unknown submission time';
  return new Date(timestamp).toLocaleString();
}

export const AssessmentGrader = ({ item, onClose }: { item: ContentItem; onClose: () => void }) => {
  const colors = useThemeColors();
  const allSubmissions = useLMSStore(state => state.submissions);
  const updateSubmission = useLMSStore(state => state.updateSubmission);
  const course = useLMSStore(state => state.courses.find(candidate => candidate.id === item.courseId));
  const currentUserId = useLMSStore(state => state.currentUserId);
  const courseRole = useCourseRole(item.courseId);

  const canGrade = Boolean(currentUserId && hasCoursePermission(courseRole, 'grade'));
  const submissions = useMemo(
    () => allSubmissions.filter(submission => submission.contentItemId === item.id),
    [allSubmissions, item.id],
  );
  const activeSubmissions = submissions.filter(submission => submission.status !== 'discarded');
  const discardedSubmissions = submissions.filter(submission => submission.status === 'discarded');
  const students = (course?.staff || []).filter(user => user.role === 'student');
  const maxPoints = getExternalMaxPoints(item);

  const [activeSubId, setActiveSubId] = useState<string | null>(null);
  const [editedResponses, setEditedResponses] = useState<Record<string, QuestionResponse>>({});
  const [overallFeedback, setOverallFeedback] = useState('');
  const [globalScore, setGlobalScore] = useState(0);
  const [releaseGrade, setReleaseGrade] = useState(false);
  const [filter, setFilter] = useState<'all' | 'needs-grading' | 'graded'>('all');
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [restoringSubmissionId, setRestoringSubmissionId] = useState<string | null>(null);
  const saveLockRef = useRef(false);
  const gradingBaseRef = useRef<{ submissionId: string; gradeRevision: number } | null>(null);

  const activeSub = activeSubmissions.find(submission => submission.id === activeSubId);
  const isGlobalGrading = !item.questions?.some(question => question.answerType !== 'page_break')
    || item.submissionTarget === 'external-link';

  const gradingEntities = item.workType === 'group'
    ? getGroupsForItem(course, item).flatMap(group => {
        const student = students.find(candidate => group.memberIds.includes(candidate.id));
        return student ? [{ student: { ...student, name: group.name }, groupId: group.id }] : [];
      })
    : students.map(student => ({ student, groupId: undefined as string | undefined }));
  const rows = gradingEntities.flatMap<GradingRow>(({ student, groupId }) => {
    const matching = activeSubmissions
      .filter(candidate => groupId ? candidate.groupId === groupId : candidate.studentId === student.id)
      .sort((a, b) => (b.attemptNumber || 1) - (a.attemptNumber || 1) || b.submittedAt - a.submittedAt);
    const gradeable = matching.filter(candidate => candidate.status === 'submitted' || candidate.status === 'graded');
    const filtered = gradeable.filter(submission =>
      filter === 'graded' ? submission.status === 'graded'
        : filter === 'needs-grading' ? submission.status === 'submitted'
          : true,
    );
    if (filtered.length) return filtered.map(submission => ({ student, groupId, submission }));
    if (filter !== 'all' || gradeable.length) return [];
    return [{ student, groupId, submission: undefined, draft: matching.find(candidate => candidate.status === 'draft') }];
  });

  const startGrading = (submission: StudentSubmission) => {
    if (!canGrade) return;
    gradingBaseRef.current = { submissionId: submission.id, gradeRevision: submission.gradeRevision ?? 0 };
    setEditedResponses(responseMapFor(submission, item));
    setOverallFeedback(submission.overallFeedback || '');
    setGlobalScore(Math.min(maxPoints, Math.max(0, submission.totalScore || 0)));
    setReleaseGrade(submission.gradeStatus === 'released');
    setIsDirty(false);
    setSaveError(null);
    setActiveSubId(submission.id);
  };

  const updateResponse = (questionId: string, updates: Partial<QuestionResponse>) => {
    setIsDirty(true);
    setEditedResponses(previous => ({
      ...previous,
      [questionId]: { ...previous[questionId], ...updates },
    }));
  };

  const updateRubricScore = (question: QuizQuestion, criterion: RubricCriterion, rawValue: string) => {
    const parsed = Number(rawValue);
    const score = Number.isFinite(parsed) ? Math.min(criterion.maxPoints, Math.max(0, parsed)) : 0;
    const previousRubric = editedResponses[question.id]?.rubricScores || {};
    const rubricScores = { ...previousRubric, [criterion.id]: score };
    const total = getRubric(question).reduce((sum, current) => sum + (rubricScores[current.id] || 0), 0);
    updateResponse(question.id, {
      rubricScores,
      score: clampQuestionScore(question, total),
      isManuallyGraded: true,
      needsManualGrading: false,
    });
  };

  const saveGrade = async () => {
    if (saveLockRef.current || !activeSub || !canGrade || !currentUserId) return;
    const gradingBase = gradingBaseRef.current;
    if (!gradingBase || gradingBase.submissionId !== activeSub.id
      || gradingBase.gradeRevision !== (activeSub.gradeRevision ?? 0)) {
      setSaveError('This grade changed after you opened it. Return to the submission list and reopen it before saving so another grader’s work is not overwritten.');
      return;
    }
    if (activeSub.status === 'graded' && !isDirty) return;
    const questions = (item.questions || []).filter(question => question.answerType !== 'page_break');
    const responses = isGlobalGrading
      ? activeSub.responses
      : questions.map(question => {
        const response = editedResponses[question.id];
        return {
          ...response,
          questionId: question.id,
          answer: response?.answer ?? null,
          score: clampQuestionScore(question, response?.score || 0),
        } satisfies QuestionResponse;
      });
    const totalScore = isGlobalGrading
      ? Math.min(maxPoints, Math.max(0, globalScore))
      : Math.max(0, Math.min(maxPoints, responses.reduce((sum, response) => sum + (response.score || 0), 0)));
    if (!isGlobalGrading && responses.some(response => response.needsManualGrading && !response.isManuallyGraded)) {
      setSaveError('Score every response that requires manual grading before saving the grade.');
      return;
    }

    saveLockRef.current = true;
    setIsSaving(true);
    setSaveError(null);
    try {
      await updateSubmission(activeSub.id, {
        responses,
        totalScore,
        overallFeedback: overallFeedback.trim(),
        status: 'graded',
        gradeStatus: releaseGrade ? 'released' : 'draft',
        gradedBy: currentUserId,
        gradedAt: currentTimestamp(),
        gradeRevision: gradingBase.gradeRevision + 1,
      });
      setIsDirty(false);
      gradingBaseRef.current = null;
      setActiveSubId(null);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Grade could not be saved.');
    } finally {
      saveLockRef.current = false;
      setIsSaving(false);
    }
  };

  const restoreSubmission = async (submission: StudentSubmission) => {
    if (!canGrade || !currentUserId || restoringSubmissionId) return;
    const expiresAt = submission.deletedAt || 0;
    if (expiresAt && expiresAt < currentTimestamp() - 24 * 60 * 60 * 1000) {
      Alert.alert('Restore window expired', 'This discarded submission has passed its recovery window.');
      return;
    }
    const conflicts = activeSubmissions.some(candidate =>
      candidate.id !== submission.id
      && (submission.groupId ? candidate.groupId === submission.groupId : candidate.studentId === submission.studentId)
      && candidate.attemptNumber === submission.attemptNumber,
    );
    if (conflicts) {
      Alert.alert('Cannot restore', 'An active record already uses this attempt number for the student or group. Resolve that conflict first.');
      return;
    }
    const completedAttempts = activeSubmissions.filter(candidate =>
      (submission.groupId ? candidate.groupId === submission.groupId : candidate.studentId === submission.studentId)
      && (candidate.status === 'submitted' || candidate.status === 'graded'),
    ).length;
    if (completedAttempts >= (item.quizConfig?.maxAttempts ?? 1)) {
      Alert.alert('Cannot restore', 'Restoring this submission would exceed the assessment attempt limit.');
      return;
    }
    setRestoringSubmissionId(submission.id);
    try {
      await updateSubmission(submission.id, { status: 'submitted', deletedAt: undefined });
    } catch (error) {
      Alert.alert('Restore failed', error instanceof Error ? error.message : 'Submission could not be restored.');
    } finally {
      setRestoringSubmissionId(null);
    }
  };

  const totalEditedScore = isGlobalGrading
    ? globalScore
    : Object.values(editedResponses).reduce((sum, response) => sum + (response.score || 0), 0);

  const confirmDiscard = (action: () => void) => {
    if (saveLockRef.current) return;
    if (!activeSub || !isDirty) {
      action();
      return;
    }
    Alert.alert('Discard unsaved grade changes?', 'Rubric scores, feedback, and release settings have not been saved.', [
      { text: 'Keep grading', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: action },
    ]);
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={() => confirmDiscard(onClose)}>
      <View style={styles.modalOverlay}>
        <View pointerEvents={isSaving ? 'none' : 'auto'} style={[styles.modalContent, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <View style={[styles.header, { borderColor: colors.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontSize: 20, fontWeight: 'bold' }}>Assessment Grader</Text>
              <Text style={{ color: colors.textSecondary }}>{item.title} · {maxPoints} points</Text>
            </View>
            <TouchableOpacity disabled={isSaving} onPress={() => confirmDiscard(onClose)} accessibilityRole="button" accessibilityLabel="Close grader" accessibilityState={{ disabled: isSaving }}>
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {!canGrade ? (
            <View style={styles.centered}>
              <Ionicons name="lock-closed" size={36} color={colors.textSecondary} />
              <Text style={{ color: colors.text, fontWeight: 'bold', fontSize: 18, marginTop: 12 }}>Staff access required</Text>
              <Text style={{ color: colors.textSecondary, textAlign: 'center', marginTop: 6 }}>Only authenticated teachers, teaching assistants, and administrators can grade submissions.</Text>
            </View>
          ) : !activeSub ? (
            <ScrollView contentContainerStyle={{ padding: 20 }}>
              <View style={styles.filterRow}>
                {(['all', 'needs-grading', 'graded'] as const).map(option => (
                  <TouchableOpacity
                    key={option}
                    onPress={() => setFilter(option)}
                    style={[styles.chip, { backgroundColor: filter === option ? colors.primary : colors.card, borderColor: filter === option ? colors.primary : colors.border }]}
                    accessibilityRole="radio"
                    accessibilityLabel={`Show ${option.replace('-', ' ')} submissions`}
                    accessibilityState={{ checked: filter === option }}
                  >
                    <Text style={{ color: filter === option ? colors.buttonText : colors.text, fontWeight: '600' }}>{option.replace('-', ' ')}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {rows.map(({ student, groupId, submission, draft }) => (
                <TouchableOpacity
                  key={`${groupId || student.id}:${submission?.id || 'none'}`}
                  disabled={!submission}
                  onPress={() => submission && startGrading(submission)}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !submission }}
                  style={[styles.submissionCard, { backgroundColor: colors.card, borderColor: colors.border, opacity: submission ? 1 : 0.65 }]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: 'bold', fontSize: 16 }}>{student.name}</Text>
                    <Text style={{ color: colors.textSecondary, marginTop: 3 }}>
                      {groupId ? `${groupId} · ` : ''}{submission ? `Attempt ${submission.attemptNumber || 1} · ${formatSubmittedAt(submission.submittedAt)}` : draft ? 'Attempt in progress' : 'Not submitted'}
                    </Text>
                    {submission?.isLate && <Text style={{ color: '#C62828', marginTop: 3 }}>Late submission</Text>}
                    {submission?.gradeStatus === 'released' && <Text style={{ color: '#2E7D32', marginTop: 3 }}>Grade released</Text>}
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ color: colors.text, fontWeight: 'bold' }}>{submission?.totalScore ?? '—'} / {maxPoints}</Text>
                    <Text style={{ color: colors.textSecondary, marginTop: 3 }}>{submission?.status.replace('-', ' ') || (draft ? 'draft' : 'not submitted')}</Text>
                  </View>
                </TouchableOpacity>
              ))}

              {rows.length === 0 && <Text style={{ color: colors.textSecondary, textAlign: 'center', marginTop: 40 }}>No roster entries match this filter.</Text>}

              {discardedSubmissions.length > 0 && (
                <View style={{ marginTop: 24 }}>
                  <Text style={{ color: colors.text, fontWeight: 'bold', marginBottom: 10 }}>Recoverable discarded submissions</Text>
                  {discardedSubmissions.map(submission => (
                    <View key={submission.id} style={[styles.restoreRow, { borderColor: colors.border }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.text }}>{submission.studentName || submission.studentId}</Text>
                        <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{submission.groupId ? `${submission.groupId} · ` : ''}{formatSubmittedAt(submission.submittedAt)}</Text>
                      </View>
                      <TouchableOpacity disabled={restoringSubmissionId !== null} onPress={() => void restoreSubmission(submission)} accessibilityRole="button" accessibilityState={{ disabled: restoringSubmissionId !== null }} style={{ opacity: restoringSubmissionId !== null && restoringSubmissionId !== submission.id ? 0.5 : 1 }}>
                        <Text style={{ color: colors.primary, fontWeight: 'bold' }}>{restoringSubmissionId === submission.id ? 'Restoring…' : 'Restore'}</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}
            </ScrollView>
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20 }}>
              <TouchableOpacity onPress={() => confirmDiscard(() => setActiveSubId(null))} style={styles.backRow} accessibilityRole="button">
                <Ionicons name="arrow-back" size={20} color={colors.primary} />
                <Text style={{ color: colors.primary, fontWeight: 'bold', marginLeft: 6 }}>Back to submissions</Text>
              </TouchableOpacity>
              <Text style={{ color: colors.text, fontSize: 22, fontWeight: 'bold' }}>{activeSub.studentName || activeSub.studentId}</Text>
              <Text style={{ color: colors.textSecondary, marginBottom: 20 }}>Attempt {activeSub.attemptNumber || 1} · {formatSubmittedAt(activeSub.submittedAt)}</Text>

              {isGlobalGrading ? (
                <View style={[styles.questionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={{ color: colors.text, fontWeight: 'bold', marginBottom: 10 }}>Final score</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <NumericInput
                      style={[styles.input, { color: colors.text, borderColor: colors.border, width: 100 }]}
                      value={globalScore}
                      max={maxPoints}
                      onCommit={value => { setGlobalScore(value); setIsDirty(true); }}
                      accessibilityLabel="Final score"
                    />
                    <Text style={{ color: colors.textSecondary, marginLeft: 8 }}>/ {maxPoints}</Text>
                  </View>
                </View>
              ) : (item.questions || []).filter(question => question.answerType !== 'page_break').map(question => {
                const response = editedResponses[question.id];
                const rubric = getRubric(question);
                return (
                  <View key={question.id} style={[styles.questionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <View style={styles.questionHeader}>
                      <Text style={{ color: colors.text, fontWeight: 'bold', flex: 1 }}>{question.label}. {question.content}</Text>
                      <Text style={{ color: colors.textSecondary }}>{question.points || 0} pts</Text>
                    </View>
                    <View style={[styles.answerBox, { backgroundColor: colors.background, borderColor: colors.border }]}>
                      <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 5 }}>Student answer</Text>
                      {response?.attachment ? (
                        <TouchableOpacity disabled={!isSafeHttpsUrl(response.attachment.url)} onPress={() => void Linking.openURL(response.attachment!.url).catch(error => Alert.alert('Attachment could not be opened', error instanceof Error ? error.message : 'Try again or contact your institution.'))} accessibilityRole="link" accessibilityLabel={`Open attachment ${response.attachment.name}`} accessibilityState={{ disabled: !isSafeHttpsUrl(response.attachment.url) }}>
                          <Text style={{ color: colors.primary, fontWeight: 'bold' }}>{response.attachment.name}</Text>
                          <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{response.attachment.mimeType}{response.attachment.size ? ` · ${response.attachment.size} bytes` : ''}</Text>
                        </TouchableOpacity>
                      ) : (
                        <Text style={{ color: colors.text, fontFamily: question.answerType === 'custom_code' ? 'monospace' : undefined }}>
                          {Array.isArray(response?.answer) ? response.answer.join(', ') : String(response?.answer ?? 'No answer')}
                        </Text>
                      )}
                    </View>
                    {question.gradingType === 'true_false' ? (
                      <View style={{ marginBottom: 12 }}>
                        <Text style={{ color: colors.text, fontWeight: 'bold', marginBottom: 8 }}>Mark response</Text>
                        <View style={{ flexDirection: 'row' }}>
                          {([
                            { label: 'Incorrect', value: false },
                            { label: 'Correct', value: true },
                          ] as const).map(option => {
                            const selected = response?.isCorrect === option.value && response?.isManuallyGraded === true;
                            return (
                              <TouchableOpacity
                                key={option.label}
                                accessibilityRole="radio"
                                accessibilityState={{ checked: selected }}
                                onPress={() => updateResponse(question.id, {
                                  isCorrect: option.value,
                                  score: option.value ? Math.max(0, question.points || 0) : -Math.max(0, question.deduction || 0),
                                  rubricScores: undefined,
                                  isManuallyGraded: true,
                                  needsManualGrading: false,
                                })}
                                style={[styles.chip, { backgroundColor: selected ? colors.primary : colors.card, borderColor: selected ? colors.primary : colors.border }]}
                              >
                                <Text style={{ color: selected ? colors.buttonText : colors.text, fontWeight: '600' }}>{option.label}</Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      </View>
                    ) : (
                      <>
                        <Text style={{ color: colors.text, fontWeight: 'bold', marginBottom: 8 }}>Rubric</Text>
                        {rubric.map(criterion => (
                          <View key={criterion.id} style={styles.rubricRow}>
                            <View style={{ flex: 1, paddingRight: 10 }}>
                              <Text style={{ color: colors.text }}>{criterion.label}</Text>
                              {criterion.description && <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{criterion.description}</Text>}
                            </View>
                            <NumericInput
                              style={[styles.input, { color: colors.text, borderColor: colors.border, width: 65, textAlign: 'center' }]}
                              value={response?.rubricScores?.[criterion.id] ?? 0}
                              max={criterion.maxPoints}
                              onCommit={value => updateRubricScore(question, criterion, String(value))}
                              accessibilityLabel={`${criterion.label} score`}
                            />
                            <Text style={{ color: colors.textSecondary, width: 48, marginLeft: 6 }}>/ {criterion.maxPoints}</Text>
                          </View>
                        ))}
                      </>
                    )}
                    <Text style={{ color: colors.text, fontWeight: 'bold', textAlign: 'right', marginBottom: 12 }}>Question score: {response?.score || 0} / {question.points || 0}</Text>
                    <TextInput
                      accessibilityLabel={`Feedback for ${question.title || 'this response'}`}
                      style={[styles.input, { color: colors.text, borderColor: colors.border, minHeight: 72, textAlignVertical: 'top' }]}
                      value={response?.teacherFeedback || ''}
                      onChangeText={value => updateResponse(question.id, { teacherFeedback: value })}
                      maxLength={100_000}
                      placeholder="Feedback for this response"
                      placeholderTextColor={colors.textSecondary}
                      multiline
                    />
                  </View>
                );
              })}

              <View style={[styles.questionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={{ color: colors.text, fontWeight: 'bold', marginBottom: 8 }}>Overall feedback</Text>
                <TextInput
                  accessibilityLabel="Overall feedback"
                  style={[styles.input, { color: colors.text, borderColor: colors.border, minHeight: 90, textAlignVertical: 'top' }]}
                  value={overallFeedback}
                  onChangeText={value => { setOverallFeedback(value); setIsDirty(true); }}
                  maxLength={100_000}
                  placeholder="Summary feedback visible to the student"
                  placeholderTextColor={colors.textSecondary}
                  multiline
                />
                <View style={styles.releaseRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: 'bold' }}>Release grade to student</Text>
                    <Text style={{ color: colors.textSecondary, fontSize: 12 }}>Off saves a staff-only grading draft.</Text>
                  </View>
                  <Switch accessibilityLabel="Release grade to student" value={releaseGrade} onValueChange={value => { setReleaseGrade(value); setIsDirty(true); }} />
                </View>
              </View>

              {saveError && <Text accessibilityRole="alert" style={{ color: colors.error, marginBottom: 10 }}>{saveError}</Text>}
              <TouchableOpacity
                disabled={isSaving || (activeSub.status === 'graded' && !isDirty)}
                style={[styles.saveButton, { backgroundColor: colors.primary, opacity: isSaving || (activeSub.status === 'graded' && !isDirty) ? 0.6 : 1 }]}
                onPress={() => void saveGrade()}
                accessibilityRole="button"
                accessibilityState={{ disabled: isSaving || (activeSub.status === 'graded' && !isDirty) }}
              >
                <Text style={{ color: colors.buttonText, fontWeight: 'bold' }}>{isSaving ? 'Saving…' : `Save ${releaseGrade ? '& release ' : ''}grade (${Math.max(0, Math.min(maxPoints, totalEditedScore))} / ${maxPoints})`}</Text>
              </TouchableOpacity>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { height: '92%', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 20, borderBottomWidth: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 16 },
  chip: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 13, paddingVertical: 7, marginRight: 8, marginBottom: 8 },
  submissionCard: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 12, padding: 15, marginBottom: 12 },
  restoreRow: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, paddingVertical: 12 },
  backRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 18 },
  questionCard: { borderWidth: 1, borderRadius: 12, padding: 16, marginBottom: 16 },
  questionHeader: { flexDirection: 'row', marginBottom: 12 },
  answerBox: { borderWidth: 1, borderRadius: 8, padding: 10, marginBottom: 15 },
  rubricRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 9 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  releaseRow: { flexDirection: 'row', alignItems: 'center', marginTop: 16 },
  saveButton: { alignItems: 'center', padding: 15, borderRadius: 10, marginBottom: 40 },
});
