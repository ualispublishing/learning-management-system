/**
 * @fileoverview src/components/lms/AssessmentPlayer.tsx.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useThemeColors } from '../../lib/useThemeColors';
import { userAlert as Alert } from '../../lib/userAlert';
import { ContentItem, QuestionResponse, QuizQuestion, StudentSubmission } from '../../types/lms';
import { useLMSStore } from '../../lib/store/useLMSStore';
import {
  buildAssessmentResponses,
  calculateSubmissionTotal,
  getAssessmentMaxScore,
  getAttemptEligibility,
  hasAssessmentAnswer,
  isGradeReleasedToStudent,
} from '../../lib/assessment/engine';
import { createEntityId } from '../../lib/id';
import { DraftSaver } from '../../lib/assessment/draftSaver';
import { getAssetService } from '../../lib/integration/assetService';
import { AIDocumentAsset } from '../../lib/ai';
import { getGroupForUser } from '../../lib/groups/courseGroups';
import { getLearningStateService, recordConsentedLearningActivity } from '../../lib/learningState';

const buildPages = (questions: QuizQuestion[], questionsPerPage: number | 'all'): QuizQuestion[][] => {
  const explicitPages: QuizQuestion[][] = [[]];
  questions.forEach(question => {
    if (question.answerType === 'page_break') explicitPages.push([]);
    else explicitPages[explicitPages.length - 1].push(question);
  });
  const nonEmptyPages = explicitPages.filter(page => page.length > 0);
  if (questionsPerPage === 'all') return nonEmptyPages;
  return nonEmptyPages.flatMap(page => {
    const chunks: QuizQuestion[][] = [];
    for (let index = 0; index < page.length; index += questionsPerPage) chunks.push(page.slice(index, index + questionsPerPage));
    return chunks;
  });
};

const answersFromSubmission = (submission?: StudentSubmission): Record<string, unknown> =>
  Object.fromEntries((submission?.responses || []).map(response => [response.questionId, response.answer]));
const assetsFromSubmission = (submission?: StudentSubmission): Record<string, NonNullable<QuestionResponse['attachment']>> =>
  Object.fromEntries((submission?.responses || []).flatMap(response => response.attachment ? [[response.questionId, response.attachment]] : []));

const currentTimestamp = () => Date.now();
const spectrumValues = (question: QuizQuestion): number[] => {
  const minimum = Number(question.customConfig?.min ?? 1);
  const maximum = Number(question.customConfig?.max ?? 5);
  const count = Number.isInteger(minimum) && Number.isInteger(maximum) && maximum > minimum && maximum - minimum <= 20
    ? maximum - minimum + 1
    : 0;
  return Array.from({ length: count }, (_, index) => minimum + index);
};
type PendingAssessmentUpload = {
  asset: AIDocumentAsset;
  idempotencyKey: string;
};

export const AssessmentPlayer = ({ item, onClose, previewMode = false }: { item: ContentItem; onClose: () => void; previewMode?: boolean }) => {
  const colors = useThemeColors();
  const addSubmission = useLMSStore(state => state.addSubmission);
  const updateSubmission = useLMSStore(state => state.updateSubmission);
  const currentUserId = useLMSStore(state => state.currentUserId);
  const courses = useLMSStore(state => state.courses);
  const submissions = useLMSStore(state => state.submissions);

  const course = courses.find(candidate => candidate.id === item.courseId);
  const userInCourse = course?.staff.find(user => user.id === currentUserId);
  const userGroup = item.workType === 'group' ? getGroupForUser(course, item, currentUserId) : undefined;
  const userGroupId = userGroup?.id;
  const relevantSubmissions = submissions
    .filter(submission => submission.contentItemId === item.id && submission.status !== 'discarded')
    .filter(submission => item.workType === 'group' ? submission.groupId === userGroupId : submission.studentId === currentUserId)
    .sort((a, b) => b.submittedAt - a.submittedAt);
  const latestCompleted = relevantSubmissions.find(submission => submission.status === 'submitted' || submission.status === 'graded');
  const eligibility = getAttemptEligibility(item, submissions, userInCourse ? currentUserId : null, userGroupId);
  const initialSubmission = previewMode ? undefined : (eligibility.resumableSubmission || latestCompleted);

  const pages = useMemo(
    () => buildPages(item.questions || [], item.quizConfig?.questionsPerPage ?? 'all'),
    [item.questions, item.quizConfig?.questionsPerPage],
  );
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, unknown>>(() => {
    const existing = answersFromSubmission(initialSubmission);
    (item.questions || []).forEach(question => {
      if (existing[question.id] === undefined && question.answerType === 'custom_code' && question.customConfig?.initialCode) existing[question.id] = question.customConfig.initialCode;
    });
    return existing;
  });
  const [answerAssets, setAnswerAssets] = useState<Record<string, NonNullable<QuestionResponse['attachment']>>>(() => assetsFromSubmission(initialSubmission));
  const [uploadingQuestionId, setUploadingQuestionId] = useState<string | null>(null);
  const [pendingUploads, setPendingUploads] = useState<Record<string, PendingAssessmentUpload>>({});
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [navigationStateError, setNavigationStateError] = useState<string | null>(null);
  const [navigationStateReady, setNavigationStateReady] = useState(false);
  const [viewingSubmission, setViewingSubmission] = useState<StudentSubmission | null>(latestCompleted || null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [isLate, setIsLate] = useState(false);

  const configuredTimeLimit = item.quizConfig?.timeLimitSeconds;
  const [attemptTiming, setAttemptTiming] = useState(() => {
    const startedAt = eligibility.resumableSubmission?.startedAt || currentTimestamp();
    return {
      startedAt,
      expiresAt: eligibility.resumableSubmission?.timeLimitExpiresAt || (configuredTimeLimit ? startedAt + configuredTimeLimit * 1000 : null),
    };
  });
  const [timeLeft, setTimeLeft] = useState<number | null>(() => attemptTiming.expiresAt
    ? Math.max(0, Math.ceil((attemptTiming.expiresAt - currentTimestamp()) / 1_000))
    : null);
  const submitRef = useRef<(forced?: boolean) => void>(() => undefined);
  const timerSubmittedRef = useRef(false);
  const submitLockRef = useRef(false);
  const submitPromptRef = useRef(false);
  const attemptSubmittedRef = useRef(false);
  const draftSaverRef = useRef(new DraftSaver<{ id: string; updates: Partial<StudentSubmission> }>(
    draft => updateSubmission(draft.id, draft.updates),
    error => setSaveError(error === null ? null : error instanceof Error ? error.message : 'Draft could not be saved.'),
  ));
  const activeSubmissionIdRef = useRef<string | null>(eligibility.resumableSubmission?.id || null);
  const draftCreationRef = useRef<Promise<boolean> | null>(null);
  const attemptBindingStartedRef = useRef(false);
  const skipNavigationHydrationRef = useRef(false);
  const isReadOnly = !!viewingSubmission && !previewMode;
  const [attemptBindingStatus, setAttemptBindingStatus] = useState<'binding' | 'ready' | 'failed'>(() =>
    previewMode || eligibility.resumableSubmission || latestCompleted || !eligibility.allowed ? 'ready' : 'binding',
  );

  /* A new assessment scope must clear the previous attempt's navigation before hydration. */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    let cancelled = false;
    setNavigationStateError(null);
    setNavigationStateReady(false);
    if (skipNavigationHydrationRef.current) {
      skipNavigationHydrationRef.current = false;
      setNavigationStateReady(true);
      return () => { cancelled = true; };
    }
    if (previewMode || isReadOnly || !currentUserId || !pages.length) {
      setNavigationStateReady(true);
      return () => { cancelled = true; };
    }
    const scope = { principalId: currentUserId, courseId: item.courseId, contentItemId: item.id };
    void getLearningStateService().load(scope, 'assessment-navigation').then(record => {
      if (cancelled) return;
      if (record) {
        setCurrentPageIndex(Math.max(0, Math.min(pages.length - 1, record.payload.pageIndex)));
        void recordConsentedLearningActivity({
          type: 'assessment-resumed',
          scope,
          occurredAt: Date.now(),
          source: 'lms-ui',
        }).catch(() => undefined);
      }
      setNavigationStateReady(true);
    }).catch(error => {
      if (cancelled) return;
      setNavigationStateError(error instanceof Error ? error.message : 'Saved assessment position could not be restored.');
      setNavigationStateReady(true);
    });
    return () => { cancelled = true; };
  }, [currentUserId, isReadOnly, item.courseId, item.id, pages.length, previewMode]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!navigationStateReady || previewMode || isReadOnly || !currentUserId || !pages.length) return;
    const timer = setTimeout(() => {
      void getLearningStateService().save(
        { principalId: currentUserId, courseId: item.courseId, contentItemId: item.id },
        'assessment-navigation',
        { pageIndex: currentPageIndex },
      ).then(() => setNavigationStateError(null)).catch(error => {
        setNavigationStateError(error instanceof Error ? error.message : 'Assessment position could not be saved.');
      });
    }, 200);
    return () => clearTimeout(timer);
  }, [currentPageIndex, currentUserId, isReadOnly, item.courseId, item.id, navigationStateReady, pages.length, previewMode]);

  const flushPendingDraft = useCallback(() => draftSaverRef.current.flush(), []);

  const scheduleDraftUpdate = useCallback((id: string, updates: Partial<StudentSubmission>) => {
    draftSaverRef.current.pending = { id, updates };
    // Persist immediately. Changes made while a request is in flight replace
    // the pending payload and are coalesced into the next serialized write.
    void flushPendingDraft();
  }, [flushPendingDraft]);

  const persistDraft = useCallback((nextAnswers: Record<string, unknown>, nextAssets = answerAssets): string | null => {
    if (previewMode || isReadOnly || !currentUserId) return null;
    const responses = buildAssessmentResponses(item, nextAnswers, nextAssets);
    if (activeSubmissionIdRef.current) {
      const id = activeSubmissionIdRef.current;
      if (draftCreationRef.current) draftSaverRef.current.pending = { id, updates: { responses } };
      else scheduleDraftUpdate(id, { responses });
      return id;
    }
    const id = createEntityId('sub');
    activeSubmissionIdRef.current = id;
    const creation = addSubmission({
      id,
      studentId: currentUserId,
      studentName: item.workType === 'group' ? userGroup?.name || 'Unknown group' : userInCourse?.name || 'Unknown student',
      groupId: userGroupId,
      contentItemId: item.id,
      courseId: item.courseId,
      startedAt: attemptTiming.startedAt,
      submittedAt: currentTimestamp(),
      timeLimitExpiresAt: attemptTiming.expiresAt || undefined,
      attemptNumber: eligibility.nextAttemptNumber,
      status: 'draft',
      responses,
      totalScore: calculateSubmissionTotal(responses),
    }).then(() => {
      setSaveError(null);
      const pending = draftSaverRef.current.pending;
      if (pending?.id === id) scheduleDraftUpdate(id, pending.updates);
      return true;
    }).catch(error => {
      activeSubmissionIdRef.current = null;
      if (draftSaverRef.current.pending?.id === id) draftSaverRef.current.pending = null;
      setSaveError(error instanceof Error ? error.message : 'Draft could not be saved.');
      return false;
    }).finally(() => {
      if (draftCreationRef.current === creation) draftCreationRef.current = null;
    });
    draftCreationRef.current = creation;
    return id;
  }, [addSubmission, answerAssets, attemptTiming.expiresAt, attemptTiming.startedAt, currentUserId, eligibility.nextAttemptNumber, isReadOnly, item, previewMode, scheduleDraftUpdate, userGroup?.name, userGroupId, userInCourse?.name]);

  useEffect(() => {
    if (attemptBindingStatus !== 'binding' || attemptBindingStartedRef.current || previewMode || isReadOnly || !eligibility.allowed || !currentUserId || !pages.length) return;
    attemptBindingStartedRef.current = true;
    const id = persistDraft(answers);
    const creation = draftCreationRef.current;
    if (!id) {
      void Promise.resolve().then(() => {
        setAttemptBindingStatus('failed');
        setSaveError('The institution repository did not start this attempt.');
      });
      return;
    }
    if (!creation) {
      void Promise.resolve().then(() => setAttemptBindingStatus('ready'));
      return;
    }
    void creation.then(saved => setAttemptBindingStatus(saved ? 'ready' : 'failed'));
  }, [answers, attemptBindingStatus, currentUserId, eligibility.allowed, isReadOnly, pages.length, persistDraft, previewMode]);

  const handleAnswer = (questionId: string, value: unknown, multiple = false) => {
    if (isReadOnly) return;
    let nextValue = value;
    if (multiple) {
      const current = Array.isArray(answers[questionId]) ? answers[questionId] as unknown[] : [];
      nextValue = current.includes(value) ? current.filter(entry => entry !== value) : [...current, value];
    }
    const next = { ...answers, [questionId]: nextValue };
    setAnswers(next);
    persistDraft(next);
  };

  const handleFileUpload = async (questionId: string, chooseDifferent = false) => {
    if (isReadOnly || uploadingQuestionId) return;
    setUploadError(null);
    if (previewMode) {
      setUploadError('File uploads are disabled in preview so test runs cannot create institutional assets.');
      return;
    }
    try {
      let pending = chooseDifferent ? undefined : pendingUploads[questionId];
      if (!pending) {
        const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
        if (result.canceled) return;
        const selected = result.assets[0];
        if (!selected) throw new Error('The selected file could not be read. Choose the file again.');
        pending = {
          asset: { uri: selected.uri, name: selected.name, mimeType: selected.mimeType, size: selected.size, file: selected.file },
          idempotencyKey: createEntityId('assessment-upload'),
        };
        setPendingUploads(current => ({ ...current, [questionId]: pending! }));
      }
      setUploadingQuestionId(questionId);
      const attemptId = activeSubmissionIdRef.current;
      if (!attemptId) throw new Error('The saved attempt was not bound before the file upload started. Close and reopen the assessment.');
      const stored = await getAssetService().upload(
        pending.asset,
        { courseId: item.courseId, purpose: 'assessment-submission', idempotencyKey: pending.idempotencyKey },
      );
      const attachment: NonNullable<QuestionResponse['attachment']> = stored;
      const nextAnswers = { ...answers, [questionId]: stored.url };
      const nextAssets = { ...answerAssets, [questionId]: attachment };
      setAnswers(nextAnswers);
      setAnswerAssets(nextAssets);
      setPendingUploads(current => {
        const next = { ...current };
        delete next[questionId];
        return next;
      });
      persistDraft(nextAnswers, nextAssets);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'File upload failed.');
    } finally {
      setUploadingQuestionId(null);
    }
  };

  const submitAssessment = (forced = false) => {
    if (submitLockRef.current || attemptSubmittedRef.current || isReadOnly || (submitPromptRef.current && !forced)) return;
    if (previewMode) {
      Alert.alert('Preview complete', 'No submission was created in preview mode.');
      onClose();
      return;
    }
    if (!eligibility.allowed || !currentUserId) {
      Alert.alert('Unable to submit', eligibility.reason || 'Sign in before submitting.');
      return;
    }

    const performSubmit = async () => {
      if (submitLockRef.current || attemptSubmittedRef.current) return;
      submitLockRef.current = true;
      setIsSubmitting(true);
      try {
        const draftCreated = draftCreationRef.current ? await draftCreationRef.current : true;
        if (!draftCreated) throw new Error('The saved attempt could not be confirmed before submission.');
        if (!await flushPendingDraft()) throw new Error('The latest draft could not be confirmed before submission.');
        const responses = buildAssessmentResponses(item, answers, answerAssets);
        const completedAt = currentTimestamp();
        const submission: Omit<StudentSubmission, 'id'> = {
          studentId: currentUserId,
          studentName: item.workType === 'group' ? userGroup?.name || 'Unknown group' : userInCourse?.name || 'Unknown student',
          groupId: userGroupId,
          contentItemId: item.id,
          courseId: item.courseId,
          startedAt: attemptTiming.startedAt,
          submittedAt: completedAt,
          timeLimitExpiresAt: attemptTiming.expiresAt || undefined,
          attemptNumber: eligibility.nextAttemptNumber,
          status: 'submitted',
          responses,
          totalScore: calculateSubmissionTotal(responses),
          isLate: isLate || (!!attemptTiming.expiresAt && completedAt > attemptTiming.expiresAt),
        };
        const currentDraftId = activeSubmissionIdRef.current;
        const savedId = currentDraftId || createEntityId('sub');
        if (currentDraftId) await updateSubmission(currentDraftId, submission);
        else {
          await addSubmission({ id: savedId, ...submission });
          activeSubmissionIdRef.current = savedId;
        }
        // Read back the repository-confirmed record. Institution adapters strip
        // client-computed grading fields and may normalize audit metadata.
        const confirmedSubmission = useLMSStore.getState().submissions.find(candidate => candidate.id === savedId);
        if (!confirmedSubmission) throw new Error('The authenticated account changed before the saved attempt could be confirmed.');
        setViewingSubmission(confirmedSubmission);
        void getLearningStateService().remove(
          { principalId: currentUserId, courseId: item.courseId, contentItemId: item.id },
          'assessment-navigation',
        ).catch(() => undefined);
        attemptSubmittedRef.current = true;
        setSaveError(null);
        Alert.alert(forced ? 'Time is up' : 'Assessment submitted', 'Your submission was recorded by the institution repository.');
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : 'Submission could not be saved.');
        Alert.alert('Submission not saved', 'Your answers remain open. Check the connection and try again.');
      } finally {
        submitLockRef.current = false;
        setIsSubmitting(false);
      }
    };

    const unanswered = (item.questions || []).filter(question => question.answerType !== 'page_break' && !hasAssessmentAnswer(answers[question.id])).length;
    if (!forced && unanswered > 0) {
      submitPromptRef.current = true;
      Alert.alert('Submit with unanswered questions?', `${unanswered} question${unanswered === 1 ? '' : 's'} will be left blank.`, [
        { text: 'Review', style: 'cancel', onPress: () => { submitPromptRef.current = false; } },
        { text: 'Submit', style: 'destructive', onPress: () => { submitPromptRef.current = false; void performSubmit(); } },
      ]);
    } else {
      submitPromptRef.current = false;
      void performSubmit();
    }
  };

  useEffect(() => {
    submitRef.current = submitAssessment;
  });

  const closeAssessment = async () => {
    if (isClosing) return;
    if (previewMode || isReadOnly || attemptBindingStatus !== 'ready') {
      onClose();
      return;
    }
    setIsClosing(true);
    try {
      const draftCreated = draftCreationRef.current ? await draftCreationRef.current : true;
      if (!draftCreated) return;
      if (await flushPendingDraft()) onClose();
    } finally {
      setIsClosing(false);
    }
  };

  const timerEnabled = timeLeft !== null && !isReadOnly;
  useEffect(() => {
    if (!timerEnabled) return;
    const interval = setInterval(() => {
      const remaining = attemptTiming.expiresAt ? Math.max(0, Math.ceil((attemptTiming.expiresAt - currentTimestamp()) / 1000)) : null;
      setTimeLeft(remaining);
      if (remaining === 0 && !timerSubmittedRef.current) {
        timerSubmittedRef.current = true;
        if (item.quizConfig?.enforceTimer) submitRef.current(true);
        else setIsLate(true);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [attemptTiming.expiresAt, item.quizConfig?.enforceTimer, timerEnabled]);

  const startAnotherAttempt = () => {
    if (!eligibility.allowed) return;
    setViewingSubmission(null);
    setAnswers(Object.fromEntries((item.questions || []).flatMap(question => question.answerType === 'custom_code' && question.customConfig?.initialCode ? [[question.id, question.customConfig.initialCode]] : [])));
    activeSubmissionIdRef.current = null;
    setAnswerAssets({});
    setPendingUploads({});
    setUploadError(null);
    setNavigationStateError(null);
    skipNavigationHydrationRef.current = true;
    setCurrentPageIndex(0);
    const startedAt = currentTimestamp();
    setAttemptTiming({ startedAt, expiresAt: configuredTimeLimit ? startedAt + configuredTimeLimit * 1000 : null });
    setTimeLeft(configuredTimeLimit || null);
    setIsLate(false);
    timerSubmittedRef.current = false;
    submitLockRef.current = false;
    submitPromptRef.current = false;
    attemptSubmittedRef.current = false;
    attemptBindingStartedRef.current = false;
    setAttemptBindingStatus('binding');
  };

  const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const currentQuestions = pages[currentPageIndex] || [];
  const allowRevisit = item.quizConfig?.allowRevisit !== false;
  const maxScore = getAssessmentMaxScore(item);
  const submissionStatusLabel = viewingSubmission
    ? item.isPoll || !item.isGraded
      ? 'Submitted'
      : viewingSubmission.responses.some(response => response.needsManualGrading)
        ? 'Submitted · Awaiting grading'
        : 'Submitted · Score pending instructor release'
    : null;

  if (!pages.length) {
    return (
      <Modal visible transparent animationType="slide" onRequestClose={onClose}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, styles.centered, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <Text style={{ color: colors.text, fontSize: 18 }}>This assessment has no questions.</Text>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close assessment" style={[styles.primaryButton, { backgroundColor: colors.primary }]} onPress={onClose}><Text style={[styles.primaryButtonText, { color: colors.buttonText }]}>Close</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  if (!isReadOnly && !previewMode && !eligibility.allowed) {
    return (
      <Modal visible transparent animationType="slide" onRequestClose={onClose}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, styles.centered, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <Ionicons name="lock-closed" size={42} color={colors.textSecondary} />
            <Text style={{ color: colors.text, fontSize: 20, fontWeight: 'bold', marginTop: 14 }}>Assessment unavailable</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 16, textAlign: 'center', marginTop: 8 }}>{eligibility.reason || 'You are not eligible to start this assessment.'}</Text>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close assessment" style={[styles.primaryButton, { backgroundColor: colors.primary }]} onPress={onClose}><Text style={[styles.primaryButtonText, { color: colors.buttonText }]}>Close</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  if (!isReadOnly && !previewMode && attemptBindingStatus !== 'ready') {
    const failed = attemptBindingStatus === 'failed';
    return (
      <Modal visible transparent animationType="slide" onRequestClose={onClose}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, styles.centered, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <Ionicons name={failed ? 'cloud-offline' : 'hourglass'} size={42} color={failed ? colors.error : colors.primary} />
            <Text accessibilityRole={failed ? 'alert' : undefined} style={{ color: colors.text, fontSize: 20, fontWeight: 'bold', marginTop: 14 }}>{failed ? 'Attempt not started' : 'Starting your attempt…'}</Text>
            <Text style={{ color: failed ? colors.error : colors.textSecondary, fontSize: 16, textAlign: 'center', marginTop: 8 }}>
              {failed ? saveError || 'Your attempt could not be saved. No questions have been revealed.' : 'Confirming the attempt and time limit with the institution repository.'}
            </Text>
            {failed && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry starting assessment" style={[styles.primaryButton, { backgroundColor: colors.primary }]} onPress={() => { attemptBindingStartedRef.current = false; setSaveError(null); setAttemptBindingStatus('binding'); }}><Text style={[styles.primaryButtonText, { color: colors.buttonText }]}>Retry</Text></TouchableOpacity>}
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close assessment" style={[styles.primaryButton, { backgroundColor: failed ? colors.card : colors.primary }]} onPress={onClose}><Text style={[styles.primaryButtonText, { color: failed ? colors.text : colors.buttonText }]}>Close</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={() => void closeAssessment()}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontSize: 20, fontWeight: 'bold' }}>{previewMode ? '[Preview] ' : ''}{item.title}</Text>
              {viewingSubmission && isGradeReleasedToStudent(viewingSubmission) ? (
                <Text style={{ color: colors.success, fontWeight: 'bold', marginTop: 5 }}>Grade: {viewingSubmission.totalScore ?? 0} / {maxScore}</Text>
              ) : submissionStatusLabel ? (
                <Text style={{ color: colors.warning, fontWeight: 'bold', marginTop: 5 }}>{submissionStatusLabel}</Text>
              ) : timeLeft !== null ? (
                <Text style={{ color: isLate ? colors.error : colors.textSecondary, fontWeight: 'bold', marginTop: 5 }}>
                  {isLate ? 'Time limit exceeded' : `Time remaining: ${formatTime(timeLeft)}`}
                </Text>
              ) : null}
            </View>
            <TouchableOpacity disabled={isClosing} onPress={() => void closeAssessment()} accessibilityRole="button" accessibilityLabel="Exit assessment" accessibilityState={{ disabled: isClosing }}><Ionicons name="close" size={24} color={colors.textSecondary} /></TouchableOpacity>
          </View>

          {isReadOnly && eligibility.allowed && (
            <View style={[styles.resultBanner, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
              <Text style={{ color: colors.textSecondary, flex: 1 }}>You are viewing attempt {viewingSubmission?.attemptNumber || 1}.</Text>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Start attempt ${eligibility.nextAttemptNumber}`} onPress={startAnotherAttempt}><Text style={{ color: colors.primary, fontWeight: 'bold' }}>Start attempt {eligibility.nextAttemptNumber}</Text></TouchableOpacity>
            </View>
          )}

          <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1 }} contentContainerStyle={{ padding: 20 }}>
            <Text style={{ color: colors.textSecondary, marginBottom: 20 }}>Page {currentPageIndex + 1} of {pages.length}</Text>
            {currentQuestions.map(question => {
              const savedResponse = viewingSubmission?.responses.find(response => response.questionId === question.id);
              return (
                <View key={question.id} style={{ marginBottom: 30 }}>
                  {!!question.title && <Text style={{ color: colors.text, fontSize: 20, fontWeight: 'bold', marginBottom: 5 }}>{question.title}</Text>}
                  <Text style={{ color: colors.text, fontSize: 16, marginBottom: 15 }}>{question.label ? `${question.label}. ` : ''}{question.content}</Text>

                  {question.answerType === 'multiple_choice' && (question.options || []).map(option => {
                    const selected = question.allowMultipleCorrect ? Array.isArray(answers[question.id]) && (answers[question.id] as unknown[]).includes(option) : answers[question.id] === option;
                    return (
                      <TouchableOpacity
                        key={option}
                        disabled={isReadOnly}
                        accessibilityRole={question.allowMultipleCorrect ? 'checkbox' : 'radio'}
                        accessibilityLabel={`${question.label || 'Question'}: ${option}`}
                        accessibilityState={{ checked: selected, disabled: isReadOnly }}
                        style={[styles.optionCard, { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? `${colors.primary}10` : colors.card }]}
                        onPress={() => handleAnswer(question.id, option, question.allowMultipleCorrect)}
                      >
                        <Ionicons name={selected ? (question.allowMultipleCorrect ? 'checkbox' : 'radio-button-on') : (question.allowMultipleCorrect ? 'square-outline' : 'radio-button-off')} size={24} color={selected ? colors.primary : colors.textSecondary} />
                        <Text style={{ color: colors.text, marginLeft: 10, fontSize: 16, flex: 1 }}>{option}</Text>
                      </TouchableOpacity>
                    );
                  })}

                  {(question.answerType === 'text' || question.answerType === 'timed') && (
                    <TextInput accessibilityLabel={`Answer for ${question.label || 'question'}`} style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.card, opacity: isReadOnly ? 0.75 : 1 }]} multiline maxLength={200_000} placeholder="Type your answer…" placeholderTextColor={colors.textSecondary} value={typeof answers[question.id] === 'string' ? answers[question.id] as string : ''} editable={!isReadOnly} onChangeText={value => handleAnswer(question.id, value)} />
                  )}

                  {question.answerType === 'custom_code' && (
                    <View>
                      <Text style={{ color: colors.textSecondary, marginBottom: 6 }}>{String(question.customConfig?.language || 'text').toUpperCase()} response</Text>
                      <TextInput accessibilityLabel={`Code answer for ${question.label || 'question'}`} style={[styles.codeInput, { borderColor: colors.border, color: colors.text, backgroundColor: colors.card, opacity: isReadOnly ? 0.75 : 1 }]} multiline maxLength={200_000} autoCapitalize="none" autoCorrect={false} value={typeof answers[question.id] === 'string' ? answers[question.id] as string : ''} editable={!isReadOnly} onChangeText={value => handleAnswer(question.id, value)} />
                    </View>
                  )}

                  {question.answerType === 'spectrum' && (
                    <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.spectrumRow}>
                      {spectrumValues(question).map(value => {
                        const selected = answers[question.id] === value;
                        return (
                          <View key={value} style={{ alignItems: 'center', flex: 1 }}>
                      <TouchableOpacity disabled={isReadOnly} accessibilityRole="radio" accessibilityLabel={`${question.label || 'Question'}: ${value}`} accessibilityState={{ checked: selected, disabled: isReadOnly }} style={[styles.scaleButton, { backgroundColor: selected ? colors.primary : colors.card, borderColor: selected ? colors.primary : colors.border }]} onPress={() => handleAnswer(question.id, value)}><Text style={{ color: selected ? colors.buttonText : colors.text, fontWeight: 'bold' }}>{value}</Text></TouchableOpacity>
                            {!!question.customConfig?.valueLabels?.[value] && <Text style={{ color: colors.textSecondary, fontSize: 10, marginTop: 5, textAlign: 'center' }}>{question.customConfig.valueLabels[value]}</Text>}
                          </View>
                        );
                      })}
                    </ScrollView>
                  )}

                  {question.answerType === 'dropbox' && (
                    <View>
                      <TouchableOpacity disabled={isReadOnly || uploadingQuestionId === question.id} accessibilityRole="button" accessibilityLabel={`Upload file for ${question.label || 'question'}`} accessibilityState={{ disabled: isReadOnly || uploadingQuestionId === question.id }} style={[styles.uploadButton, { borderColor: colors.primary, backgroundColor: `${colors.primary}10`, opacity: isReadOnly ? 0.75 : 1 }]} onPress={() => void handleFileUpload(question.id)}>
                        <Ionicons name="cloud-upload" size={38} color={colors.primary} />
                        <Text style={{ color: colors.primary, fontWeight: 'bold', marginTop: 8 }}>{uploadingQuestionId === question.id ? 'Uploading…' : pendingUploads[question.id] ? `Retry ${pendingUploads[question.id].asset.name}` : answerAssets[question.id]?.name || 'Select file'}</Text>
                      </TouchableOpacity>
                      {!!pendingUploads[question.id] && uploadingQuestionId !== question.id && (
                        <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Choose a different file for ${question.label || 'question'}`} onPress={() => void handleFileUpload(question.id, true)} style={{ alignSelf: 'center', padding: 10 }}>
                          <Text style={{ color: colors.primary }}>Choose a different file</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  )}

                  {viewingSubmission && isGradeReleasedToStudent(viewingSubmission) && savedResponse ? (
                    <View style={[styles.feedbackBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
                      <Text style={{ color: colors.text, fontWeight: 'bold' }}>Score: {savedResponse.score ?? 0} / {question.points || 0}</Text>
                      {!!savedResponse.teacherFeedback && <Text style={{ color: colors.textSecondary, marginTop: 6 }}>{savedResponse.teacherFeedback}</Text>}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </ScrollView>

          {!!(uploadError || saveError || navigationStateError) && <Text accessibilityRole="alert" style={{ color: colors.error, paddingHorizontal: 20, paddingBottom: 8 }}>{uploadError || saveError || navigationStateError}</Text>}

          <View style={[styles.footer, { borderTopColor: colors.border }]}>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Previous assessment page" accessibilityState={{ disabled: currentPageIndex === 0 || (!allowRevisit && !isReadOnly) }} style={[styles.navButton, { backgroundColor: colors.card, borderColor: colors.border, opacity: currentPageIndex === 0 || (!allowRevisit && !isReadOnly) ? 0.5 : 1 }]} disabled={currentPageIndex === 0 || (!allowRevisit && !isReadOnly)} onPress={() => setCurrentPageIndex(index => index - 1)}><Text style={{ color: colors.text, fontWeight: 'bold' }}>Previous</Text></TouchableOpacity>
            {currentPageIndex === pages.length - 1 ? (
              isReadOnly ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close assessment" style={[styles.navButton, { backgroundColor: colors.primary, borderColor: colors.primary }]} onPress={() => void closeAssessment()}><Text style={[styles.primaryButtonText, { color: colors.buttonText }]}>Close</Text></TouchableOpacity>
                : <TouchableOpacity accessibilityRole="button" accessibilityLabel="Submit assessment" accessibilityState={{ disabled: isSubmitting }} style={[styles.navButton, { backgroundColor: colors.primary, borderColor: colors.primary, opacity: isSubmitting ? 0.6 : 1 }]} disabled={isSubmitting} onPress={() => submitAssessment(false)}><Text style={[styles.primaryButtonText, { color: colors.buttonText }]}>{isSubmitting ? 'Submitting…' : 'Submit'}</Text></TouchableOpacity>
            ) : (
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Next assessment page" style={[styles.navButton, { backgroundColor: colors.primary, borderColor: colors.primary }]} onPress={() => setCurrentPageIndex(index => index + 1)}><Text style={[styles.primaryButtonText, { color: colors.buttonText }]}>Next</Text></TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { height: '92%', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, overflow: 'hidden' },
  centered: { justifyContent: 'center', alignItems: 'center', padding: 30 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1 },
  resultBanner: { flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1 },
  optionCard: { flexDirection: 'row', alignItems: 'center', padding: 15, borderRadius: 12, borderWidth: 1, marginBottom: 10 },
  input: { borderWidth: 1, borderRadius: 12, padding: 15, minHeight: 90, textAlignVertical: 'top' },
  codeInput: { borderWidth: 1, borderRadius: 12, padding: 15, minHeight: 220, textAlignVertical: 'top', fontFamily: 'monospace' },
  spectrumRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 10, paddingRight: 8, gap: 10 },
  scaleButton: { width: 46, height: 46, borderRadius: 23, borderWidth: 2, justifyContent: 'center', alignItems: 'center' },
  uploadButton: { padding: 24, borderWidth: 1, borderStyle: 'dashed', borderRadius: 12, alignItems: 'center' },
  feedbackBox: { padding: 12, borderWidth: 1, borderRadius: 10, marginTop: 12 },
  footer: { flexDirection: 'row', padding: 20, borderTopWidth: 1, justifyContent: 'space-between' },
  navButton: { paddingHorizontal: 24, paddingVertical: 14, borderRadius: 12, borderWidth: 1, minWidth: 110, alignItems: 'center' },
  primaryButton: { marginTop: 20, paddingHorizontal: 24, paddingVertical: 14, borderRadius: 10 },
  primaryButtonText: { fontWeight: 'bold' },
});
