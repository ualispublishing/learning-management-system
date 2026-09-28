/**
 * @fileoverview src/components/lms/AssessmentBuilder.tsx.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Modal, Platform, Switch, ScrollView } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useThemeColors } from '../../lib/useThemeColors';
import { userAlert as Alert } from '../../lib/userAlert';
import { ContentItem, QuizQuestion, AnswerType } from '../../types/lms';
import { useLMSStore } from '../../lib/store/useLMSStore';
import { AssessmentPlayer } from './AssessmentPlayer';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import DraggableFlatList, { ScaleDecorator } from 'react-native-draggable-flatlist';
import { DatePicker } from './DatePicker';
import { normalizeAssessmentForPersistence, validateAssessment } from '../../lib/assessment/engine';
import { createEntityId } from '../../lib/id';
import { parseContentDateTime } from '../../lib/contentDateTime';
import { NumericInput } from './NumericInput';

export const AssessmentBuilder = ({ item: initialItem, onClose, isNew = false }: { item: ContentItem, onClose: () => void, isNew?: boolean }) => {
  const colors = useThemeColors();
  const persistContentItem = useLMSStore(state => state.updateContentItem);
  const createContentItem = useLMSStore(state => state.addContentItem);
  const course = useLMSStore(state => state.courses.find(candidate => candidate.id === initialItem.courseId));
  const [item, setItem] = useState<ContentItem>(() => ({ ...initialItem }));
  const [questions, setQuestions] = useState<QuizQuestion[]>(initialItem.questions || []);
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(isNew);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveLockRef = useRef(false);

  const updateDraftItem = (updates: Partial<ContentItem>) => {
    setItem(previous => ({ ...previous, ...updates }));
    setIsDirty(true);
  };

  const isPoll = !!item.isPoll;
  const isPopQuiz = !!item.isPopQuiz;
  const isGraded = !isPoll && item.isGraded === true;
  const [showLiveToggle] = useState(!!item.isPopQuiz || !!item.isPoll);
  const [showDates, setShowDates] = useState(!!item.displayDate || !!item.availableDate);
  
  // Settings
  const initialSecs = item.quizConfig?.timeLimitSeconds || 0;
  const [hh, setHh] = useState(initialSecs > 0 ? Math.floor(initialSecs / 3600).toString() : '');
  const [mm, setMm] = useState(initialSecs > 0 ? Math.floor((initialSecs % 3600) / 60).toString() : '');
  const [ss, setSs] = useState(initialSecs > 0 ? (initialSecs % 60).toString() : '');
  
  const [enforceTimer, setEnforceTimer] = useState(item.quizConfig?.enforceTimer || false);
  
  const [previewMode, setPreviewMode] = useState(false);
  const [reorderMode, setReorderMode] = useState(false);
  const [showDetails, setShowDetails] = useState(true);

  const handleDiscard = () => {
    if (saveLockRef.current) return;
    if (!isDirty) {
      onClose();
      return;
    }
    Alert.alert('Discard assessment changes?', 'Changes made in this builder have not been saved.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: onClose },
    ]);
  };

  const handleSave = async () => {
    if (saveLockRef.current) return;
    const gradingCategories = Object.keys(course?.gradingWeights || {});
    if (isGraded && gradingCategories.length && !item.gradingCategory) {
      Alert.alert('Assessment needs attention', 'Select a grading category.');
      return;
    }
    if (!isPopQuiz && !isPoll && item.workType === 'group' && (!item.groupSetId || !course?.groupSets?.some(groupSet => groupSet.id === item.groupSetId))) {
      Alert.alert('Assessment needs attention', 'Select a valid course group set for group submissions.');
      return;
    }
    const usesGlobalTimer = !isPopQuiz && !isPoll;
    const timeParts = usesGlobalTimer ? [hh, mm, ss].map(value => value.trim() ? Number(value) : 0) : [0, 0, 0];
    if (usesGlobalTimer && (timeParts.some(value => !Number.isInteger(value) || value < 0) || timeParts[0] > 168 || timeParts[1] > 59 || timeParts[2] > 59)) {
      Alert.alert('Assessment needs attention', 'Use 0–168 hours and 0–59 minutes/seconds for the time limit.');
      return;
    }
    const timeLimitSeconds = timeParts[0] * 3600 + timeParts[1] * 60 + timeParts[2];
    if (usesGlobalTimer && enforceTimer && timeLimitSeconds < 1) {
      Alert.alert('Assessment needs attention', 'Set a time limit before enforcing the timer.');
      return;
    }
    const availableAt = parseContentDateTime(item.availableDate);
    const dueAt = parseContentDateTime(item.displayDate);
    if (item.availableDate && availableAt === undefined || item.displayDate && dueAt === undefined) {
      Alert.alert('Assessment needs attention', 'Availability and due dates must be valid date-times.');
      return;
    }
    if (availableAt !== undefined && dueAt !== undefined && dueAt < availableAt) {
      Alert.alert('Assessment needs attention', 'The due date cannot be before the availability date.');
      return;
    }
    const draft = normalizeAssessmentForPersistence({
      ...item,
      presentationSlot: item.availableDate ? 'scheduled' : item.presentationSlot === 'scheduled' ? 'current' : item.presentationSlot,
      questions,
      quizConfig: {
        ...(item.quizConfig || { questionsPerPage: 'all', maxAttempts: 1, allowRevisit: false }),
        timeLimitSeconds: timeLimitSeconds || undefined,
        enforceTimer: usesGlobalTimer && enforceTimer,
      },
    });
    const errors = validateAssessment(draft).filter(entry => entry.severity === 'error');
    if (errors.length) {
      Alert.alert('Assessment needs attention', errors.slice(0, 6).map(entry => `• ${entry.message}`).join('\n'));
      return;
    }
    saveLockRef.current = true;
    setIsSaving(true);
    setSaveError(null);
    try {
      if (isNew) await createContentItem(draft);
      else await persistContentItem(draft.id, draft);
      setIsDirty(false);
      onClose();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Assessment changes could not be saved.');
    } finally {
      saveLockRef.current = false;
      setIsSaving(false);
    }
  };

  const saveSettings = (newHh = hh, newMm = mm, newSs = ss, newEnforce = enforceTimer) => {
    const total = (parseInt(newHh)||0)*3600 + (parseInt(newMm)||0)*60 + (parseInt(newSs)||0);
    updateDraftItem({
      quizConfig: {
        ...(item.quizConfig || { questionsPerPage: 'all', maxAttempts: 1, allowRevisit: false }),
        timeLimitSeconds: total > 0 ? total : undefined,
        enforceTimer: newEnforce
      }
    });
  };

  const updateQuizConfig = (updates: Partial<NonNullable<ContentItem['quizConfig']>>) => {
    updateDraftItem({
      quizConfig: {
        ...(item.quizConfig || { questionsPerPage: 'all', maxAttempts: 1, allowRevisit: false }),
        ...updates,
      },
    });
  };

  const recalculateLabels = (data: QuizQuestion[]) => {
    let qNum = 1;
    return data.map(q => {
      if (q.answerType === 'page_break') return { ...q, label: '' };
      return { ...q, label: String(qNum++) };
    });
  };

  const addQuestion = (type: AnswerType) => {
    if (questions.length >= 1_000) {
      Alert.alert('Question limit reached', 'An assessment cannot contain more than 1,000 questions. Split this work into multiple assessments.');
      return;
    }
    const newQ: QuizQuestion = {
      id: createEntityId('q'),
      label: type === 'page_break' ? '' : `${questions.filter(q => q.answerType !== 'page_break').length + 1}`,
      content: type === 'page_break' ? 'Page Break' : '',
      answerType: type,
      options: type === 'multiple_choice' ? ['', ''] : [],
      points: type === 'page_break' || !isGraded ? 0 : 10,
      gradingType: 'points',
      allowMultipleCorrect: false,
      deduction: 0,
      customConfig: type === 'custom_code' ? { language: 'javascript', initialCode: '// Write your code here' } : undefined
    };
    const updated = recalculateLabels([...questions, newQ]);
    setQuestions(updated);
    updateDraftItem({ questions: updated });
    if (type !== 'page_break') setEditingQuestionId(newQ.id);
  };

  const updateQuestion = (id: string, updates: Partial<QuizQuestion>) => {
    const updated = questions.map(q => q.id === id ? { ...q, ...updates } : q);
    setQuestions(updated);
    updateDraftItem({ questions: updated });
  };

  const deleteQuestion = (id: string) => {
    const question = questions.find(candidate => candidate.id === id);
    if (!question) return;
    Alert.alert(
      question.answerType === 'page_break' ? 'Delete page break?' : `Delete question ${question.label}?`,
      'This removes it from the unsaved assessment draft.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            const updated = recalculateLabels(questions.filter(candidate => candidate.id !== id));
            setQuestions(updated);
            setEditingQuestionId(current => current === id ? null : current);
            updateDraftItem({ questions: updated });
          },
        },
      ],
    );
  };

  const renderQuestionEditor = (q: QuizQuestion) => (
    <View style={[styles.qCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ color: colors.text, fontWeight: 'bold' }}>
            {q.answerType === 'page_break' ? 'Page Break' : `Question ${q.label} (${q.answerType})`}
          </Text>
        </View>
        <TouchableOpacity onPress={() => deleteQuestion(q.id)} accessibilityRole="button" accessibilityLabel={`Delete ${q.answerType === 'page_break' ? 'page break' : `question ${q.label}`}`}>
          <Ionicons name="trash" size={20} color="#FF5252" />
        </TouchableOpacity>
      </View>
      
      {q.answerType !== 'page_break' && (
        <>
          <TextInput
            style={[styles.input, { borderColor: colors.border, color: colors.text, marginTop: 10, fontWeight: 'bold' }]}
            value={q.title || ''}
            onChangeText={(text) => updateQuestion(q.id, { title: text })}
            maxLength={500}
            placeholder={q.answerType === 'custom_code' ? "Question Title (Required)" : "Question Title (Optional)"}
            placeholderTextColor={colors.textSecondary}
            accessibilityLabel={`Question ${q.label} title`}
          />
          <TextInput
            style={[styles.input, { borderColor: colors.border, color: colors.text, marginTop: 10, minHeight: 60, textAlignVertical: 'top' }]}
            multiline
            value={q.content}
            onChangeText={(text) => updateQuestion(q.id, { content: text })}
            maxLength={100_000}
            placeholder={q.answerType === 'custom_code' ? "Question text (Optional)" : "Question text..."}
            placeholderTextColor={colors.textSecondary}
            accessibilityLabel={`Question ${q.label} text`}
          />

          {isGraded && (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 15, marginBottom: 15 }}>
                <Text style={{ color: colors.textSecondary, marginRight: 10 }}>Grading Type:</Text>
                <TouchableOpacity onPress={() => updateQuestion(q.id, { gradingType: 'points' })} style={{ marginRight: 10 }} accessibilityRole="radio" accessibilityState={{ checked: q.gradingType === 'points' }} accessibilityLabel="Grade with points and optional rubric">
                  <Text style={{ color: q.gradingType === 'points' ? colors.primary : colors.textSecondary, fontWeight: q.gradingType === 'points' ? 'bold' : 'normal' }}>Points</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => updateQuestion(q.id, { gradingType: 'true_false', rubric: undefined })} accessibilityRole="radio" accessibilityState={{ checked: q.gradingType === 'true_false' }} accessibilityLabel="Grade correct or incorrect">
                  <Text style={{ color: q.gradingType === 'true_false' ? colors.primary : colors.textSecondary, fontWeight: q.gradingType === 'true_false' ? 'bold' : 'normal' }}>Correct / incorrect</Text>
                </TouchableOpacity>
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={{ color: colors.textSecondary, marginRight: 10 }}>Points:</Text>
                  <NumericInput
                    style={[styles.input, { borderColor: colors.border, color: colors.text, width: 60, padding: 5 }]}
                    value={q.points || 0}
                    max={1_000_000}
                    onCommit={points => updateQuestion(q.id, { points })}
                    accessibilityLabel="Question points"
                  />
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={{ color: colors.textSecondary, marginRight: 10 }}>Penalty:</Text>
                  <NumericInput
                    style={[styles.input, { borderColor: colors.border, color: colors.text, width: 60, padding: 5 }]}
                    value={q.deduction || 0}
                    max={1_000_000}
                    onCommit={deduction => updateQuestion(q.id, { deduction })}
                    accessibilityLabel="Incorrect-answer penalty"
                  />
                </View>
              </View>
              {q.gradingType !== 'true_false' && (
                <View style={{ marginTop: 15, paddingTop: 15, borderTopWidth: 1, borderColor: colors.border }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <View>
                      <Text style={{ color: colors.text, fontWeight: 'bold' }}>Question rubric</Text>
                      <Text style={{ color: colors.textSecondary, fontSize: 12 }}>Optional criteria must total {q.points || 0} points</Text>
                    </View>
                    <TouchableOpacity
                      disabled={(q.rubric?.length || 0) >= 200}
                      onPress={() => updateQuestion(q.id, {
                        rubric: [...(q.rubric || []), { id: createEntityId('criterion'), label: '', maxPoints: 0 }],
                      })}
                      accessibilityRole="button"
                      accessibilityLabel="Add rubric criterion"
                      accessibilityState={{ disabled: (q.rubric?.length || 0) >= 200 }}
                    >
                      <Text style={{ color: colors.primary, fontWeight: 'bold' }}>+ Add criterion</Text>
                    </TouchableOpacity>
                  </View>
                  {(q.rubric || []).map((criterion, criterionIndex) => (
                    <View key={criterion.id} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                      <TextInput
                        style={[styles.input, { flex: 1, borderColor: colors.border, color: colors.text, padding: 8, marginRight: 8 }]}
                        value={criterion.label}
                        maxLength={500}
                        onChangeText={label => {
                          const rubric = [...(q.rubric || [])];
                          rubric[criterionIndex] = { ...criterion, label };
                          updateQuestion(q.id, { rubric });
                        }}
                        placeholder="Criterion label"
                        placeholderTextColor={colors.textSecondary}
                        accessibilityLabel={`Rubric criterion ${criterionIndex + 1} label`}
                      />
                      <NumericInput
                        style={[styles.input, { width: 64, borderColor: colors.border, color: colors.text, padding: 8, textAlign: 'center' }]}
                        value={criterion.maxPoints}
                        max={1_000_000}
                        onCommit={maxPoints => {
                          const rubric = [...(q.rubric || [])];
                          rubric[criterionIndex] = { ...criterion, maxPoints };
                          updateQuestion(q.id, { rubric });
                        }}
                        accessibilityLabel={`${criterion.label} maximum points`}
                      />
                      <TouchableOpacity style={{ padding: 8 }} onPress={() => updateQuestion(q.id, { rubric: (q.rubric || []).filter(entry => entry.id !== criterion.id) })} accessibilityRole="button" accessibilityLabel={`Delete rubric criterion ${criterion.label || criterionIndex + 1}`}>
                        <Ionicons name="trash-outline" size={18} color={colors.error} />
                      </TouchableOpacity>
                    </View>
                  ))}
                  {!!q.rubric?.length && (
                    <Text style={{ color: q.rubric.reduce((sum, criterion) => sum + criterion.maxPoints, 0) === (q.points || 0) ? colors.success : colors.error, textAlign: 'right', fontWeight: 'bold' }}>
                      Rubric total: {q.rubric.reduce((sum, criterion) => sum + criterion.maxPoints, 0)} / {q.points || 0}
                    </Text>
                  )}
                </View>
              )}
            </>
          )}

          {isPopQuiz && (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 15, marginBottom: 5 }}>
              <Ionicons name="timer-outline" size={20} color={colors.textSecondary} style={{ marginRight: 5 }} />
              <Text style={{ color: colors.textSecondary, marginRight: 10 }}>Time Limit (sec):</Text>
              <NumericInput
                style={[styles.input, { borderColor: colors.border, color: colors.text, padding: 4, width: 60, textAlign: 'center' }]}
                value={q.customConfig?.timerSeconds ?? 30}
                min={1}
                max={86_400}
                integer
                onCommit={(timerSeconds) => updateQuestion(q.id, { customConfig: { ...q.customConfig, timerSeconds } })}
                accessibilityLabel={`Question ${q.label} live timer in seconds`}
              />
            </View>
          )}


        </>
      )}

      {q.answerType === 'multiple_choice' && (
        <View style={{ marginTop: 15 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <Text style={{ color: colors.text, fontWeight: 'bold' }}>Options</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={{ color: colors.textSecondary, marginRight: 5, fontSize: 12 }}>Multiple Correct?</Text>
              <Switch
                value={q.allowMultipleCorrect}
                onValueChange={(val) => updateQuestion(q.id, {
                  allowMultipleCorrect: val,
                  correctAnswer: val
                    ? (typeof q.correctAnswer === 'string' ? [q.correctAnswer] : Array.isArray(q.correctAnswer) ? q.correctAnswer : [])
                    : (Array.isArray(q.correctAnswer) ? q.correctAnswer[0] : q.correctAnswer),
                })}
                accessibilityLabel={`Allow multiple correct answers for question ${q.label}`}
              />
            </View>
          </View>
          {q.options?.map((opt, idx) => {
            const isCorrect = q.allowMultipleCorrect 
              ? Array.isArray(q.correctAnswer) && q.correctAnswer.includes(opt)
              : q.correctAnswer === opt;
            
            return (
              <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 5 }}>
                <TouchableOpacity 
                  style={{ marginRight: 10 }}
                  onPress={() => {
                    if (q.allowMultipleCorrect) {
                      const current = Array.isArray(q.correctAnswer) ? q.correctAnswer : [];
                      if (current.includes(opt)) {
                        updateQuestion(q.id, { correctAnswer: current.filter(c => c !== opt) });
                      } else {
                        updateQuestion(q.id, { correctAnswer: [...current, opt] });
                      }
                    } else {
                      updateQuestion(q.id, { correctAnswer: opt });
                    }
                  }}
                  accessibilityRole={q.allowMultipleCorrect ? 'checkbox' : 'radio'}
                  accessibilityState={{ checked: isCorrect }}
                  accessibilityLabel={`Mark option ${idx + 1} as correct`}
                >
                  <Ionicons 
                    name={isCorrect ? "checkmark-circle" : "ellipse-outline"} 
                    size={24} 
                    color={isCorrect ? '#4CAF50' : colors.textSecondary} 
                  />
                </TouchableOpacity>
                <TextInput
                  style={[styles.input, { flex: 1, borderColor: colors.border, color: colors.text, padding: 8 }]}
                  value={opt}
                  maxLength={10_000}
                  onChangeText={(text) => {
                    const newOpts = [...(q.options || [])];
                    const oldOption = newOpts[idx];
                    newOpts[idx] = text;
                    const correctAnswer = Array.isArray(q.correctAnswer)
                      ? q.correctAnswer.map(answer => answer === oldOption ? text : answer)
                      : q.correctAnswer === oldOption ? text : q.correctAnswer;
                    updateQuestion(q.id, { options: newOpts, correctAnswer });
                  }}
                  accessibilityLabel={`Question ${q.label} option ${idx + 1}`}
                />
                <TouchableOpacity 
                  style={{ marginLeft: 10 }}
                  onPress={() => {
                    const newOpts = [...(q.options || [])];
                    const [removed] = newOpts.splice(idx, 1);
                    const correctAnswer = Array.isArray(q.correctAnswer)
                      ? q.correctAnswer.filter(answer => answer !== removed)
                      : q.correctAnswer === removed ? undefined : q.correctAnswer;
                    updateQuestion(q.id, { options: newOpts, correctAnswer });
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete option ${idx + 1}`}
                >
                  <Ionicons name="close" size={20} color="#FF5252" />
                </TouchableOpacity>
              </View>
            );
          })}
          <TouchableOpacity 
            disabled={(q.options?.length || 0) >= 500}
            style={{ marginTop: 10, padding: 10, backgroundColor: colors.primary + '20', borderRadius: 8, alignItems: 'center' }}
            onPress={() => updateQuestion(q.id, { options: [...(q.options || []), ''] })}
            accessibilityRole="button"
            accessibilityLabel="Add answer option"
            accessibilityState={{ disabled: (q.options?.length || 0) >= 500 }}
          >
            <Text style={{ color: colors.primary, fontWeight: 'bold' }}>+ Add Option</Text>
          </TouchableOpacity>
        </View>
      )}

      {q.answerType === 'custom_code' && (
        <View style={{ marginTop: 15 }}>
          <Text style={{ color: colors.text, fontWeight: 'bold', marginBottom: 8 }}>Response Language</Text>
          <View style={{ flexDirection: 'row', marginBottom: 10 }}>
            {['javascript', 'python', 'html', 'css'].map(lang => (
              <TouchableOpacity
                key={lang}
                style={{ flex: 1, padding: 10, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: (q.customConfig?.language || 'html') === lang ? colors.primary : colors.border }}
                onPress={() => updateQuestion(q.id, { customConfig: { ...q.customConfig, language: lang } })}
                accessibilityRole="radio"
                accessibilityState={{ checked: (q.customConfig?.language || 'html') === lang }}
                accessibilityLabel={`${lang} response language`}
              >
                <Text style={{ color: (q.customConfig?.language || 'html') === lang ? colors.primary : colors.textSecondary, fontWeight: 'bold', textTransform: 'uppercase' }}>{lang}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={{ color: colors.text, fontWeight: 'bold', marginBottom: 5 }}>Starter Code (Visible to Students)</Text>
          <TextInput
            style={[styles.input, { borderColor: colors.border, color: colors.text, padding: 8, fontFamily: 'monospace', height: 250, textAlignVertical: 'top' }]}
            value={q.customConfig?.initialCode || ''}
            multiline
            maxLength={65_000}
            onChangeText={(text) => updateQuestion(q.id, { customConfig: { ...q.customConfig, initialCode: text } })}
            placeholder="Optional starter code"
            placeholderTextColor={colors.textSecondary}
            accessibilityLabel={`Question ${q.label} starter code`}
          />
          <Text style={{ color: colors.text, fontWeight: 'bold', marginBottom: 5, marginTop: 15 }}>Private Grading Notes / Test Cases</Text>
          <TextInput
            style={[styles.input, { borderColor: colors.border, color: colors.text, padding: 8, fontFamily: 'monospace', minHeight: 100, textAlignVertical: 'top' }]}
            value={q.customConfig?.testCases || ''}
            multiline
            maxLength={65_000}
            onChangeText={(text) => updateQuestion(q.id, { customConfig: { ...q.customConfig, testCases: text } })}
            placeholder="Not shown to students. Execution must occur in a sandboxed grading service."
            placeholderTextColor={colors.textSecondary}
            accessibilityLabel={`Question ${q.label} private grading notes and test cases`}
          />
        </View>
      )}

      {q.answerType === 'spectrum' && (
        <View style={{ marginTop: 15 }}>
          <Text style={{ color: colors.text, fontWeight: 'bold', marginBottom: 10 }}>Spectrum Settings</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
            <View style={{ flex: 1, marginRight: 10 }}>
              <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 5 }}>Min Value (e.g. 1)</Text>
              <NumericInput
                style={[styles.input, { borderColor: colors.border, color: colors.text, padding: 8 }]}
                value={q.customConfig?.min ?? 1}
                min={-1_000_000}
                max={1_000_000}
                integer
                onCommit={min => {
                  const max = q.customConfig?.max ?? 5;
                  const valueLabels = min <= max
                    ? Object.fromEntries(Object.entries(q.customConfig?.valueLabels || {}).filter(([key]) => Number(key) >= min && Number(key) <= max))
                    : q.customConfig?.valueLabels;
                  updateQuestion(q.id, { customConfig: { ...q.customConfig, min, valueLabels } });
                }}
                accessibilityLabel={`Question ${q.label} scale minimum`}
              />
            </View>
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 5 }}>Max Value (e.g. 5)</Text>
              <NumericInput
                style={[styles.input, { borderColor: colors.border, color: colors.text, padding: 8 }]}
                value={q.customConfig?.max ?? 5}
                min={-1_000_000}
                max={1_000_000}
                integer
                onCommit={max => {
                  const min = q.customConfig?.min ?? 1;
                  const valueLabels = min <= max
                    ? Object.fromEntries(Object.entries(q.customConfig?.valueLabels || {}).filter(([key]) => Number(key) >= min && Number(key) <= max))
                    : q.customConfig?.valueLabels;
                  updateQuestion(q.id, { customConfig: { ...q.customConfig, max, valueLabels } });
                }}
                accessibilityLabel={`Question ${q.label} scale maximum`}
              />
            </View>
          </View>
          <View style={{ marginTop: 15 }}>
            <Text style={{ color: colors.text, fontWeight: 'bold', marginBottom: 5 }}>Specific Value Labels (Optional)</Text>
            {Array.from({ length: Math.max(0, Math.min(21, (q.customConfig?.max ?? 5) - (q.customConfig?.min ?? 1) + 1)) }).map((_, i) => {
              const val = (q.customConfig?.min ?? 1) + i;
              return (
                <View key={val} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 5 }}>
                  <Text style={{ color: colors.textSecondary, width: 30, textAlign: 'right', marginRight: 10 }}>{val}:</Text>
                  <TextInput
                    style={[styles.input, { flex: 1, borderColor: colors.border, color: colors.text, padding: 8 }]}
                    value={q.customConfig?.valueLabels?.[val] || ''}
                    placeholder={`Label for ${val}...`}
                    placeholderTextColor={colors.textSecondary}
                    onChangeText={(text) => {
                      const currentLabels = q.customConfig?.valueLabels || {};
                      const valueLabels = { ...currentLabels };
                      if (text.trim()) valueLabels[val] = text;
                      else delete valueLabels[val];
                      updateQuestion(q.id, { customConfig: { ...q.customConfig, valueLabels } });
                    }}
                    maxLength={200}
                    accessibilityLabel={`Label for scale value ${val}`}
                  />
                </View>
              );
            })}
          </View>
        </View>
      )}

      {(q.answerType === 'text' || q.answerType === 'timed') && (
        <View style={{ marginTop: 15 }}>
          <Text style={{ color: colors.text, fontWeight: 'bold', marginBottom: 5 }}>Correct Answer Keyword (Optional)</Text>
          <TextInput
            style={[styles.input, { borderColor: colors.border, color: colors.text, padding: 8 }]}
            value={q.correctAnswer as string || ''}
            onChangeText={(text) => updateQuestion(q.id, { correctAnswer: text })}
            maxLength={10_000}
            placeholder="e.g. inheritance"
            placeholderTextColor={colors.textSecondary}
            accessibilityLabel={`Question ${q.label} correct answer keyword`}
          />
          <View style={{ flexDirection: 'row', marginTop: 8 }}>
            {(['exact', 'contains'] as const).map(mode => {
              const selected = (q.textMatchMode || 'exact') === mode;
              return (
                <TouchableOpacity
                  key={mode}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  onPress={() => updateQuestion(q.id, { textMatchMode: mode })}
                  style={{ paddingHorizontal: 12, paddingVertical: 7, marginRight: 8, borderRadius: 16, borderWidth: 1, borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? `${colors.primary}20` : colors.background }}
                >
                  <Text style={{ color: selected ? colors.primary : colors.text }}>{mode === 'exact' ? 'Exact match' : 'Contains keyword'}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}
    </View>
  );

  const renderReorderItem = ({ item: q, drag, isActive }: any) => {
    return (
      <ScaleDecorator>
        <TouchableOpacity 
          style={[styles.qCard, {
            backgroundColor: q.answerType === 'page_break' ? colors.primary + '10' : colors.card,
            borderColor: isActive ? colors.primary : colors.border,
            opacity: isActive ? 0.9 : 1,
            marginBottom: 10,
            padding: 15,
            ...(Platform.OS === 'web'
              ? { boxShadow: isActive ? '0 2px 10px rgba(0,0,0,0.3)' : 'none' }
              : { shadowColor: '#000', shadowOpacity: isActive ? 0.3 : 0, shadowRadius: isActive ? 10 : 0 }),
          }]}
          onPressIn={drag}
          accessibilityRole="button"
          accessibilityLabel={`Reorder ${q.answerType === 'page_break' ? 'page break' : `question ${q.label}`}`}
          accessibilityHint="Press and drag to change its position"
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Ionicons name="reorder-three" size={28} color={colors.textSecondary} style={{ marginRight: 15 }} />
            {q.answerType === 'page_break' ? (
              <Text style={{ color: colors.primary, fontWeight: 'bold', fontSize: 16 }}>--- Page Break ---</Text>
            ) : (
              <Text style={{ color: colors.text, fontWeight: 'bold', fontSize: 16, flex: 1 }} numberOfLines={1}>Q{q.label}. {q.content}</Text>
            )}
          </View>
        </TouchableOpacity>
      </ScaleDecorator>
    );
  };

  const renderNormalItem = (q: QuizQuestion) => {
    return (
      <View style={{ marginBottom: 20 }}>
        {editingQuestionId === q.id ? (
          renderQuestionEditor(q)
        ) : (
          <TouchableOpacity 
            style={[styles.qCard, { backgroundColor: q.answerType === 'page_break' ? colors.primary + '10' : colors.card, borderColor: colors.border }]}
            onPress={() => setEditingQuestionId(q.id)}
            accessibilityRole="button"
            accessibilityLabel={`Edit ${q.answerType === 'page_break' ? 'page break' : `question ${q.label}`}`}
          >
            {q.answerType === 'page_break' ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: colors.primary, fontWeight: 'bold', textAlign: 'center' }}>--- Page Break ---</Text>
              </View>
            ) : (
              <>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={{ color: colors.text, fontWeight: 'bold' }}>Q{q.label}. {q.content}</Text>
                  </View>
                  <Text style={{ color: colors.textSecondary }}>{q.points} pts</Text>
                </View>
                <Text style={{ color: colors.textSecondary, marginTop: 5 }}>Type: {q.answerType === 'custom_code' ? 'Custom Question' : q.answerType}</Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </View>
    );
  };

  const listHeader = (
    <View style={{ marginBottom: 20 }}>
      <View style={{ backgroundColor: colors.card, padding: 20, borderRadius: 12, borderWidth: 1, borderColor: colors.border, marginBottom: 20 }}>
        <TouchableOpacity 
          style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: showDetails ? 15 : 0 }}
          onPress={() => setShowDetails(!showDetails)}
          accessibilityRole="button"
          accessibilityLabel="Assessment details"
          accessibilityState={{ expanded: showDetails }}
        >
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: 'bold' }}>Assessment Details</Text>
          <Ionicons name={showDetails ? "chevron-up" : "pencil"} size={20} color={colors.primary} />
        </TouchableOpacity>
        
        {showDetails && (
          <>
            <Text style={{ color: colors.text, fontWeight: 'bold', marginBottom: 5 }}>Title</Text>
            <TextInput 
          accessibilityLabel="Assessment title"
          style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.background, marginBottom: 15 }]}
	          value={item.title}
	          onChangeText={(val) => updateDraftItem({ title: val })}
	          maxLength={500}
        />

        <Text style={{ color: colors.text, fontWeight: 'bold', marginBottom: 5 }}>Description</Text>
        <TextInput 
          accessibilityLabel="Assessment description"
          style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.background, marginBottom: 15, height: 80, textAlignVertical: 'top' }]}
	          value={item.description}
	          onChangeText={(val) => updateDraftItem({ description: val })}
	          maxLength={250_000}
          multiline
        />

        <TouchableOpacity
          accessibilityRole="button"
          accessibilityState={{ expanded: showDates }}
          onPress={() => setShowDates(value => !value)}
          style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 15, justifyContent: 'space-between' }}
        >
          <Text style={{ color: colors.text, fontWeight: 'bold' }}>Schedule & Dates</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ color: colors.primary, marginRight: 4 }}>{showDates ? 'Hide' : 'Show'}</Text>
            <Ionicons name={showDates ? 'chevron-up' : 'chevron-down'} size={18} color={colors.primary} />
          </View>
        </TouchableOpacity>

        {showDates && (
          <View style={{ backgroundColor: colors.background, padding: 15, borderRadius: 8, marginBottom: 15, borderWidth: 1, borderColor: colors.border }}>
            {(!isPopQuiz && !isPoll) && (
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 15, justifyContent: 'space-between' }}>
                <Text style={{ color: colors.text, fontWeight: 'bold' }}>Date Available</Text>
                <DatePicker 
                  courseId={item.courseId} 
                  value={item.availableDate || ''} 
                  onChange={(val) => updateDraftItem({ availableDate: val })} 
                  accessibilityLabel="Assessment available date and time"
                />
              </View>
            )}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: colors.text, fontWeight: 'bold' }}>Date Due</Text>
              <DatePicker 
                courseId={item.courseId} 
                value={item.displayDate || ''} 
                onChange={(val) => updateDraftItem({ displayDate: val })} 
                accessibilityLabel="Assessment due date and time"
              />
            </View>
          </View>
        )}

        {!isPoll && (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 15, justifyContent: 'space-between' }}>
            <Text style={{ color: colors.text, fontWeight: 'bold' }}>Graded Assessment</Text>
            <Switch 
              accessibilityLabel="Graded assessment"
              value={isGraded} 
              onValueChange={(val) => updateDraftItem({ isGraded: val })} 
            />
          </View>
        )}

        {!isPoll && isGraded && Object.keys(course?.gradingWeights || {}).length > 0 && (
          <View style={{ marginBottom: 15 }}>
            <Text style={{ color: colors.text, fontWeight: 'bold', marginBottom: 8 }}>Grading Category *</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {Object.keys(course?.gradingWeights || {}).map(gradingCategory => {
                const selected = item.gradingCategory === gradingCategory;
                return (
                  <TouchableOpacity
                    key={gradingCategory}
                    onPress={() => updateDraftItem({ gradingCategory })}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    style={{ paddingHorizontal: 12, paddingVertical: 8, marginRight: 8, marginBottom: 8, borderRadius: 16, borderWidth: 1, borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? `${colors.primary}20` : colors.background }}
                  >
                    <Text style={{ color: selected ? colors.primary : colors.text }}>{gradingCategory}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {showLiveToggle && (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 15, justifyContent: 'space-between' }}>
            <View>
              <Text style={{ color: colors.text, fontWeight: 'bold' }}>In-Class (Live) Mode</Text>
              <Text style={{ color: colors.textSecondary, fontSize: 12 }}>Toggle off for standard offline access</Text>
            </View>
            <Switch 
              accessibilityLabel="In-class live mode"
              value={isPopQuiz} 
              onValueChange={(val) => updateDraftItem({ isPopQuiz: val })} 
            />
          </View>
        )}

        {(!isPopQuiz && !isPoll) && (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 15 }}>
              <Text style={{ color: colors.text, marginRight: 15 }}>Time Limit:</Text>
              <TextInput
                accessibilityLabel="Time limit hours"
                style={[styles.input, { borderColor: colors.border, color: colors.text, width: 60, padding: 8, marginRight: 5 }]}
                value={hh}
                keyboardType="numeric"
                maxLength={3}
                onChangeText={(val) => { setHh(val); saveSettings(val, mm, ss, enforceTimer); }}
                placeholder="HH"
                placeholderTextColor={colors.textSecondary}
              />
              <Text style={{ color: colors.textSecondary, marginRight: 5 }}>h</Text>
              <TextInput
                accessibilityLabel="Time limit minutes"
                style={[styles.input, { borderColor: colors.border, color: colors.text, width: 60, padding: 8, marginRight: 5 }]}
                value={mm}
                keyboardType="numeric"
                maxLength={2}
                onChangeText={(val) => { setMm(val); saveSettings(hh, val, ss, enforceTimer); }}
                placeholder="MM"
                placeholderTextColor={colors.textSecondary}
              />
              <Text style={{ color: colors.textSecondary, marginRight: 5 }}>m</Text>
              <TextInput
                accessibilityLabel="Time limit seconds"
                style={[styles.input, { borderColor: colors.border, color: colors.text, width: 60, padding: 8, marginRight: 5 }]}
                value={ss}
                keyboardType="numeric"
                maxLength={2}
                onChangeText={(val) => { setSs(val); saveSettings(hh, mm, val, enforceTimer); }}
                placeholder="SS"
                placeholderTextColor={colors.textSecondary}
              />
              <Text style={{ color: colors.textSecondary }}>s</Text>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View>
                <Text style={{ color: colors.text, fontWeight: 'bold' }}>Enforce Time Limit Strictly</Text>
                <Text style={{ color: colors.textSecondary, fontSize: 12 }}>Auto-submits when timer runs out</Text>
              </View>
              <Switch 
                accessibilityLabel="Enforce time limit strictly"
                value={enforceTimer}
                onValueChange={(val) => { setEnforceTimer(val); saveSettings(hh, mm, ss, val); }}
              />
            </View>
            <View style={{ marginTop: 20, paddingTop: 15, borderTopWidth: 1, borderColor: colors.border }}>
              <Text style={{ color: colors.text, fontWeight: 'bold', marginBottom: 10 }}>Questions per page</Text>
              <View style={{ flexDirection: 'row', marginBottom: 15 }}>
                {(['all', 1, 5, 10] as const).map(pageSize => {
                  const selected = (item.quizConfig?.questionsPerPage ?? 'all') === pageSize;
                  return (
                    <TouchableOpacity
                      key={pageSize}
                      onPress={() => updateQuizConfig({ questionsPerPage: pageSize })}
                      style={{ paddingHorizontal: 14, paddingVertical: 8, minHeight: 44, justifyContent: 'center', marginRight: 8, borderRadius: 8, borderWidth: 1, borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? `${colors.primary}20` : colors.card }}
                      accessibilityRole="radio"
                      accessibilityLabel={`${pageSize === 'all' ? 'All questions' : `${pageSize} questions`} per page`}
                      accessibilityState={{ checked: selected }}
                    >
                      <Text style={{ color: selected ? colors.primary : colors.text }}>{pageSize === 'all' ? 'All' : pageSize}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 15 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: 'bold' }}>Maximum attempts</Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 12 }}>Use 1–100 attempts</Text>
                </View>
                <NumericInput
                  style={[styles.input, { borderColor: colors.border, color: colors.text, width: 70, padding: 8, textAlign: 'center' }]}
                  value={item.quizConfig?.maxAttempts ?? 1}
                  min={1}
                  max={100}
                  integer
                  onCommit={maxAttempts => updateQuizConfig({ maxAttempts })}
                  accessibilityLabel="Maximum assessment attempts"
                />
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: 'bold' }}>Allow revisiting earlier pages</Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 12 }}>When disabled, moving forward locks prior pages</Text>
                </View>
                <Switch accessibilityLabel="Allow revisiting earlier pages" value={item.quizConfig?.allowRevisit !== false} onValueChange={value => updateQuizConfig({ allowRevisit: value })} />
              </View>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 15 }}>
              <View>
                <Text style={{ color: colors.text, fontWeight: 'bold' }}>Group Submission</Text>
                <Text style={{ color: colors.textSecondary, fontSize: 12 }}>One submission applies to the whole group</Text>
              </View>
              <Switch 
                accessibilityLabel="Group submission"
                value={item.workType === 'group'}
                onValueChange={(val) => updateDraftItem({
                  workType: val ? 'group' : 'individual',
                  groupSetId: val ? item.groupSetId || course?.groupSets?.[0]?.id : undefined,
                })}
              />
            </View>
            {item.workType === 'group' && (
              <View style={{ marginTop: 12 }}>
                <Text style={{ color: colors.text, fontWeight: 'bold', marginBottom: 8 }}>Course Group Set *</Text>
                {(course?.groupSets || []).length ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                    {(course?.groupSets || []).map(groupSet => {
                      const selected = item.groupSetId === groupSet.id;
                      return (
                        <TouchableOpacity
                          key={groupSet.id}
                          onPress={() => updateDraftItem({ groupSetId: groupSet.id })}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: selected }}
                          style={{ paddingHorizontal: 12, paddingVertical: 8, marginRight: 8, marginBottom: 8, borderRadius: 16, borderWidth: 1, borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? `${colors.primary}20` : colors.card }}
                        >
                          <Text style={{ color: selected ? colors.primary : colors.text }}>{groupSet.name}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ) : (
                  <Text style={{ color: colors.error }}>Create a course group set before enabling group submissions.</Text>
                )}
              </View>
            )}
          </>
        )}
        </>
        )}
      </View>
      <Text style={{ color: colors.text, fontSize: 20, fontWeight: 'bold', marginBottom: 10 }}>Questions</Text>
    </View>
  );

  const listFooter = (
      <View style={{ paddingBottom: 60 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 10, marginBottom: 20 }}>
        <TouchableOpacity 
          style={[styles.addBtn, { backgroundColor: colors.primary }]} 
          onPress={() => addQuestion('multiple_choice')}
          accessibilityRole="button"
          accessibilityLabel="Add Multiple Choice Question"
        >
          <Text style={{ color: colors.buttonText, fontWeight: 'bold' }}>+ Multiple Choice</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.addBtn, { backgroundColor: colors.primary }]} 
          onPress={() => addQuestion('text')}
          accessibilityRole="button"
          accessibilityLabel="Add Text Answer Question"
        >
          <Text style={{ color: colors.buttonText, fontWeight: 'bold' }}>+ Text Answer</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.addBtn, { backgroundColor: colors.primary }]}
          onPress={() => addQuestion('timed')}
          accessibilityRole="button"
          accessibilityLabel="Add Timed Text Question"
        >
          <Text style={{ color: colors.buttonText, fontWeight: 'bold' }}>+ Timed Text</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.addBtn, { backgroundColor: colors.primary }]} 
          onPress={() => addQuestion('spectrum')}
          accessibilityRole="button"
          accessibilityLabel="Add Spectrum Question"
        >
          <Text style={{ color: colors.buttonText, fontWeight: 'bold' }}>+ Scale Response</Text>
        </TouchableOpacity>
        
        {!isPoll && (
          <>
            <TouchableOpacity 
              style={[styles.addBtn, { backgroundColor: colors.primary }]} 
              onPress={() => addQuestion('dropbox')}
              accessibilityRole="button"
              accessibilityLabel="Add File Upload Question"
            >
              <Text style={{ color: colors.buttonText, fontWeight: 'bold' }}>+ File Upload</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.addBtn, { backgroundColor: colors.primary }]} 
              onPress={() => addQuestion('custom_code')}
              accessibilityRole="button"
              accessibilityLabel="Add Custom Question"
            >
              <Text style={{ color: colors.buttonText, fontWeight: 'bold' }}>+ Custom Question</Text>
            </TouchableOpacity>
          </>
        )}

        <TouchableOpacity 
          style={[styles.addBtn, { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }]} 
          onPress={() => addQuestion('page_break')}
          accessibilityRole="button"
          accessibilityLabel="Add Page Break"
        >
          <Text style={{ color: colors.text, fontWeight: 'bold' }}>+ Page Break</Text>
        </TouchableOpacity>
      </View>


        {saveError && <Text accessibilityRole="alert" style={{ color: colors.error, marginTop: 16 }}>{saveError}</Text>}
        <TouchableOpacity 
          disabled={isSaving}
          style={{ backgroundColor: isSaving ? colors.border : colors.primary, padding: 15, borderRadius: 8, alignItems: 'center', marginTop: 20 }}
          onPress={() => void handleSave()}
          accessibilityRole="button"
          accessibilityLabel="Confirm and Save Assessment"
          accessibilityState={{ disabled: isSaving, busy: isSaving }}
        >
          <Text style={{ color: isSaving ? colors.textSecondary : colors.buttonText, fontWeight: 'bold', fontSize: 16 }}>{isSaving ? 'Saving…' : 'Confirm & Save Assessment'}</Text>
        </TouchableOpacity>
      </View>
  );

  return (
    <Modal visible transparent animationType="slide" onRequestClose={handleDiscard}>
      <GestureHandlerRootView style={styles.modalOverlay}>
        <View pointerEvents={isSaving ? 'none' : 'auto'} style={[styles.modalContent, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderColor: colors.border }}>
            <Text style={{ color: colors.text, fontSize: 20, fontWeight: 'bold' }} accessibilityRole="header">Assessment Builder: {item.title}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <TouchableOpacity 
                onPress={() => setReorderMode(!reorderMode)} 
                style={{ marginRight: 15, backgroundColor: reorderMode ? colors.primary : colors.card, borderWidth: 1, borderColor: colors.primary, paddingHorizontal: 15, paddingVertical: 8, borderRadius: 8 }}
                accessibilityRole="button"
                accessibilityLabel={reorderMode ? 'Done Reordering' : 'Reorder Questions'}
              >
                <Text style={{ color: reorderMode ? colors.buttonText : colors.primary, fontWeight: 'bold' }}>{reorderMode ? 'Done Reordering' : 'Reorder'}</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                onPress={() => setPreviewMode(true)} 
                style={{ marginRight: 15, backgroundColor: colors.primary + '20', paddingHorizontal: 15, paddingVertical: 8, borderRadius: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Preview Assessment"
              >
                <Text style={{ color: colors.primary, fontWeight: 'bold' }}>Preview</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                disabled={isSaving}
                onPress={handleDiscard}
                accessibilityRole="button"
                accessibilityLabel="Close Builder"
                accessibilityState={{ disabled: isSaving }}
              >
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>
          
          <View style={{ flex: 1 }}>
            {reorderMode ? (
              <DraggableFlatList
                contentContainerStyle={{ padding: 20 }}
                data={questions}
                onDragEnd={({ data }) => {
                  const updated = recalculateLabels(data);
                  setQuestions(updated);
                  updateDraftItem({ questions: updated });
                }}
                keyExtractor={(item) => item.id}
                ListHeaderComponent={listHeader}
                renderItem={renderReorderItem}
              />
            ) : (
              <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1 }} contentContainerStyle={{ padding: 20 }}>
                {listHeader}
                {questions.map(q => (
                  <View key={q.id}>
                    {renderNormalItem(q)}
                  </View>
                ))}
                {listFooter}
              </ScrollView>
            )}
          </View>
        </View>
      </GestureHandlerRootView>
      {previewMode && (
        <AssessmentPlayer 
          item={{
            ...item, 
            questions, 
            quizConfig: { 
              ...(item.quizConfig || { questionsPerPage: 'all', maxAttempts: 1, allowRevisit: false }), 
              timeLimitSeconds: (parseInt(hh)||0)*3600 + (parseInt(mm)||0)*60 + (parseInt(ss)||0),
              enforceTimer
            }
          }} 
          onClose={() => setPreviewMode(false)} 
          previewMode 
        />
      )}
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { height: '90%', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1 },
  qCard: { padding: 15, borderRadius: 12, borderWidth: 1 },
  input: { borderWidth: 1, borderRadius: 8, padding: 12 },
  addBtn: { paddingHorizontal: 15, paddingVertical: 10, borderRadius: 8, marginRight: 10, marginBottom: 10 }
});
