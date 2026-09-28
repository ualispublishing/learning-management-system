/**
 * @fileoverview src/components/lms/PopQuizParticipant.tsx.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Modal, StyleSheet, TextInput } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLMSStore } from '../../lib/store/useLMSStore';
import { ContentItem } from '../../types/lms';
import { useThemeColors } from '../../lib/useThemeColors';

interface PopQuizParticipantProps {
  item: ContentItem;
  onClose: () => void;
}

export const PopQuizParticipant = (props: PopQuizParticipantProps) => {
  const sessionKey = useLMSStore(state => `${state.popQuizState?.courseworkId ?? 'none'}:${state.popQuizState?.currentQuestionId ?? state.popQuizState?.status ?? 'waiting'}:${state.popQuizState?.questionOpenedAt ?? 'closed'}`);
  return <PopQuizParticipantSession key={sessionKey} {...props} />;
};

const PopQuizParticipantSession = ({ item, onClose }: PopQuizParticipantProps) => {
  const colors = useThemeColors();
  const styles = getStyles(colors);
  const { popQuizState, submitPopQuizAnswer, subscribeToPopQuiz, currentUserId, liveSessionError } = useLMSStore();
  
  const isWaiting = !popQuizState || popQuizState.status !== 'active' || popQuizState.courseworkId !== item.id;
  const activeQId = popQuizState?.currentQuestionId;
  const q = item.questions?.find(x => x.id === activeQId);

  // The keyed wrapper remounts this state for each revealed question.
  const [answer, setAnswer] = useState<unknown>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const questionClosesAt = popQuizState?.questionClosesAt ?? null;
  const [clockNow, setClockNow] = useState(Date.now);
  const timeLeft = questionClosesAt === null
    ? null
    : Math.max(0, Math.ceil((questionClosesAt - clockNow) / 1_000));

  useEffect(() => subscribeToPopQuiz(item.id), [item.id, subscribeToPopQuiz]);

  // Derive time remaining from the shared absolute deadline. A late joiner must
  // never receive a fresh client-local timer.
  useEffect(() => {
    if (questionClosesAt === null || isWaiting) return;
    const timer = setInterval(() => setClockNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [isWaiting, questionClosesAt]);

  const submitAnswer = useCallback(async (val: unknown) => {
    if (timeLeft === 0) return;
    if (!currentUserId || !activeQId) return;
    setIsSubmitting(true);
    try {
      await submitPopQuizAnswer(currentUserId, activeQId, val);
      setIsSubmitted(true);
    } catch {
      setIsSubmitted(false);
    } finally {
      setIsSubmitting(false);
    }
  }, [activeQId, currentUserId, submitPopQuizAnswer, timeLeft]);

  const handleSelect = useCallback((val: unknown) => {
    setAnswer(val);
    void submitAnswer(val);
  }, [submitAnswer]);

  const handleMultipleSelect = useCallback((value: string) => {
    setAnswer((current: unknown) => {
      const selected = Array.isArray(current) ? current.filter(entry => typeof entry === 'string') as string[] : [];
      return selected.includes(value) ? selected.filter(entry => entry !== value) : [...selected, value];
    });
    setIsSubmitted(false);
  }, []);

  const renderQuestion = () => {
    if (!q) return null;

    return (
      <View style={{ marginBottom: 30 }}>
        {q.title && <Text style={{ color: colors.text, fontSize: 20, fontWeight: 'bold', marginBottom: 5 }}>{q.title}</Text>}
        <Text style={{ color: colors.text, fontSize: 16, marginBottom: 15 }}>{q.label ? `${q.label}. ` : ''}{q.content}</Text>

        {q.answerType === 'multiple_choice' && (
          <View>
            {q.options?.map((opt, oIdx) => {
              const isSelected = q.allowMultipleCorrect ? Array.isArray(answer) && answer.includes(opt) : answer === opt;
              const isDisabled = timeLeft === 0 || isSubmitting;
              
              return (
                <TouchableOpacity 
                  key={oIdx} 
                  style={[styles.optionCard, { borderColor: isSelected ? colors.primary : colors.border, backgroundColor: isSelected ? colors.primary + '10' : colors.card, opacity: isDisabled ? 0.5 : 1 }]}
                  onPress={() => q.allowMultipleCorrect ? handleMultipleSelect(opt) : handleSelect(opt)}
                  disabled={isDisabled}
                  accessibilityRole={q.allowMultipleCorrect ? 'checkbox' : 'radio'}
                  accessibilityLabel={opt}
                  accessibilityState={{ checked: isSelected, disabled: isDisabled }}
                >
                  <Ionicons 
                    name={isSelected ? (q.allowMultipleCorrect ? 'checkbox' : 'radio-button-on') : (q.allowMultipleCorrect ? 'square-outline' : 'radio-button-off')}
                    size={24} 
                    color={isSelected ? colors.primary : colors.textSecondary} 
                  />
                  <Text style={{ color: colors.text, marginLeft: 10, fontSize: 16 }}>{opt}</Text>
                </TouchableOpacity>
              );
            })}
            {q.allowMultipleCorrect && (
              <TouchableOpacity
                disabled={!Array.isArray(answer) || answer.length === 0 || timeLeft === 0 || isSubmitting}
                onPress={() => void submitAnswer(answer)}
                style={[styles.submitBtn, { backgroundColor: Array.isArray(answer) && answer.length > 0 && timeLeft !== 0 ? colors.primary : colors.border }]}
                accessibilityRole="button"
                accessibilityState={{ disabled: !Array.isArray(answer) || answer.length === 0 || timeLeft === 0 || isSubmitting }}
              >
                <Text style={{ color: Array.isArray(answer) && answer.length > 0 && timeLeft !== 0 ? colors.buttonText : colors.textSecondary, fontWeight: 'bold' }}>{isSubmitting ? 'Submitting…' : isSubmitted ? 'Submitted' : 'Submit selections'}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {q.answerType === 'spectrum' && (
          <View style={{ marginTop: 20 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingRight: 8 }}>
              {Array.from({ length: (q.customConfig?.max ?? 5) - (q.customConfig?.min ?? 1) + 1 }).map((_, i) => {
                const val = (q.customConfig?.min ?? 1) + i;
                const isSelected = answer === val;
                const isDisabled = timeLeft === 0 || isSubmitting;
                return (
                  <View key={val} style={{ alignItems: 'center', width: 64, opacity: isDisabled ? 0.5 : 1 }}>
                    <TouchableOpacity 
                      style={[
                        styles.spectrumBtn, 
                        { backgroundColor: isSelected ? colors.primary : colors.card, borderColor: isSelected ? colors.primary : colors.border }
                      ]}
                      onPress={() => handleSelect(val)}
                      disabled={isDisabled}
                      accessibilityRole="radio"
                      accessibilityLabel={q.customConfig?.valueLabels?.[val] ? `${val}: ${q.customConfig.valueLabels[val]}` : String(val)}
                      accessibilityState={{ checked: isSelected, disabled: isDisabled }}
                    >
                      <Text style={{ color: isSelected ? colors.buttonText : colors.text, fontWeight: 'bold', fontSize: 16 }}>{val}</Text>
                    </TouchableOpacity>
                    {q.customConfig?.valueLabels?.[val] ? (
                      <Text style={{ color: colors.textSecondary, fontSize: 10, marginTop: 5, textAlign: 'center' }}>
                        {q.customConfig.valueLabels[val]}
                      </Text>
                    ) : null}
                  </View>
                );
              })}
            </ScrollView>
          </View>
        )}

        {(q.answerType === 'text' || q.answerType === 'timed') && (
          <View>
            <TextInput
              accessibilityLabel="Quiz answer"
              style={[{ borderWidth: 1, borderRadius: 8, padding: 12, borderColor: colors.border, color: colors.text, height: 80, textAlignVertical: 'top', marginTop: 10, opacity: timeLeft === 0 ? 0.5 : 1 }]}
              multiline
              placeholder="Type your answer..."
              placeholderTextColor={colors.textSecondary}
              value={typeof answer === 'string' ? answer : ''}
              maxLength={20_000}
              onChangeText={(value) => { setAnswer(value); setIsSubmitted(false); }}
              editable={timeLeft !== 0 && !isSubmitting}
            />
            <TouchableOpacity
              disabled={!String(answer || '').trim() || timeLeft === 0 || isSubmitting}
              onPress={() => void submitAnswer(answer)}
              style={[styles.submitBtn, { backgroundColor: String(answer || '').trim() && timeLeft !== 0 ? colors.primary : colors.border }]}
              accessibilityRole="button"
              accessibilityLabel="Submit quiz answer"
              accessibilityState={{ disabled: !String(answer || '').trim() || timeLeft === 0 || isSubmitting, busy: isSubmitting }}
            >
              <Text style={{ color: String(answer || '').trim() && timeLeft !== 0 ? colors.buttonText : colors.textSecondary, fontWeight: 'bold' }}>{isSubmitting ? 'Submitting…' : isSubmitted ? 'Submitted' : 'Submit answer'}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderColor: colors.border }}>
            <View>
              <Text style={{ color: colors.text, fontSize: 20, fontWeight: 'bold' }}>{item.title} (Live)</Text>
              {(q?.customConfig?.timerSeconds ?? 0) > 0 && timeLeft !== null && !isWaiting && (
                <Text style={{ color: timeLeft === 0 ? '#FF5252' : colors.textSecondary, fontWeight: 'bold', marginTop: 5 }}>
                  {timeLeft === 0 ? "TIME'S UP!" : `Time Remaining: ${timeLeft}s`}
                </Text>
              )}
            </View>
            <TouchableOpacity 
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Exit Pop-Quiz"
            >
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          
          <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1, padding: 20 }} contentContainerStyle={isWaiting ? { flex: 1, justifyContent: 'center', alignItems: 'center' } : {}}>
            {liveSessionError && <Text accessibilityRole="alert" style={{ color: colors.error, marginBottom: 12 }}>{liveSessionError}</Text>}
            {isWaiting ? (
              <View style={{ alignItems: 'center' }}>
                <Ionicons name="hourglass-outline" size={64} color={colors.primary} style={{ marginBottom: 20 }} />
                <Text style={{ color: colors.text, fontSize: 20, fontWeight: 'bold', textAlign: 'center' }}>Waiting for Teacher...</Text>
                <Text style={{ color: colors.textSecondary, textAlign: 'center', marginTop: 10 }}>Look at the board or wait for the host to reveal the next question.</Text>
              </View>
            ) : (
              renderQuestion()
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const getStyles = (colors: any) => StyleSheet.create({
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { height: '90%', borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, overflow: 'hidden' },
  optionCard: { flexDirection: 'row', alignItems: 'center', padding: 15, borderRadius: 12, borderWidth: 2, marginBottom: 15 },
  input: { borderWidth: 1, borderRadius: 8, padding: 15, fontSize: 16 },
  spectrumBtn: { width: 50, height: 50, borderRadius: 25, borderWidth: 2, justifyContent: 'center', alignItems: 'center' },
  submitBtn: { minHeight: 44, borderRadius: 8, marginTop: 10, alignItems: 'center', justifyContent: 'center' },
});
