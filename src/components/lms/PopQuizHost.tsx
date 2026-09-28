/**
 * @fileoverview src/components/lms/PopQuizHost.tsx.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Modal, Platform, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLMSStore } from '../../lib/store/useLMSStore';
import { ContentItem, QuizQuestion } from '../../types/lms';
import { useThemeColors } from '../../lib/useThemeColors';
import { userAlert as Alert } from '../../lib/userAlert';

interface PopQuizHostProps {
  item: ContentItem;
  onClose: () => void;
}

export const PopQuizHost = ({ item, onClose }: PopQuizHostProps) => {
  const colors = useThemeColors();
  const styles = getStyles(colors);
  const { popQuizState, startPopQuiz, revealPopQuizQuestion, lockPopQuizQuestion, endPopQuiz, subscribeToPopQuiz, liveSessionError } = useLMSStore();
  const [showResults, setShowResults] = useState<string | null>(null);
  const [isUpdatingSession, setIsUpdatingSession] = useState(false);
  const sessionOperationRef = useRef(false);
  const attemptedStartForRef = useRef<string | null>(null);

  const runSessionOperation = useCallback(async (operation: () => Promise<void>): Promise<boolean> => {
    if (sessionOperationRef.current) return false;
    sessionOperationRef.current = true;
    setIsUpdatingSession(true);
    try {
      await operation();
      return true;
    } catch {
      // The store publishes the transport/validation error in the visible banner.
      return false;
    } finally {
      sessionOperationRef.current = false;
      setIsUpdatingSession(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToPopQuiz(item.id);
    if (popQuizState?.courseworkId !== item.id && attemptedStartForRef.current !== item.id) {
      attemptedStartForRef.current = item.id;
      void runSessionOperation(() => startPopQuiz(item.id));
    }
    return unsubscribe;
  }, [item.id, popQuizState?.courseworkId, runSessionOperation, startPopQuiz, subscribeToPopQuiz]);

  const sessionReady = popQuizState?.courseworkId === item.id;

  const retryStart = () => {
    if (isUpdatingSession) return;
    attemptedStartForRef.current = item.id;
    void runSessionOperation(() => startPopQuiz(item.id));
  };

  const handleEnd = async () => {
    if (await runSessionOperation(endPopQuiz)) onClose();
  };

  const requestEnd = () => {
    if (isUpdatingSession) return;
    Alert.alert('End live session?', 'Students will no longer be able to answer. All responses will be archived before this session closes.', [
      { text: 'Keep hosting', style: 'cancel' },
      { text: 'End session', style: 'destructive', onPress: () => void handleEnd() },
    ]);
  };

  const activeQuestionId = sessionReady ? popQuizState.currentQuestionId : null;
  const isWaiting = !sessionReady || popQuizState.status === 'waiting';
  
  const getSubmissionCount = (qId: string) => {
    if (!sessionReady) return 0;
    let count = 0;
    Object.values(popQuizState.answers).forEach(studentAnswers => {
      if (studentAnswers[qId] !== undefined) count++;
    });
    return count;
  };

  const getResultsSummary = (qId: string) => {
    if (!sessionReady) return {};
    const summary: Record<string, number> = {};
    Object.values(popQuizState.answers).forEach(studentAnswers => {
      const ans = studentAnswers[qId];
      if (ans !== undefined) {
        const values = Array.isArray(ans) ? ans : [ans];
        values.forEach(value => {
          const key = String(value);
          summary[key] = (summary[key] || 0) + 1;
        });
      }
    });
    return summary;
  };

  const questions = item.questions?.filter(q => q.answerType !== 'page_break') || [];
  
  const completedIds = sessionReady ? popQuizState.completedQuestionIds : [];
  const upcomingQuestions = questions.filter(q => !completedIds.includes(q.id));
  const completedQuestions = questions.filter(q => completedIds.includes(q.id));

  const renderQuestion = (q: QuizQuestion, isCompletedSection: boolean) => {
    const isActive = activeQuestionId === q.id && !isWaiting;
    const isRevealedButLocked = activeQuestionId === q.id && isWaiting;
    const anotherQuestionActive = sessionReady && popQuizState.status === 'active' && activeQuestionId !== q.id;
    const subCount = getSubmissionCount(q.id);

    return (
      <View key={q.id} style={[styles.qCard, isActive && styles.qCardActive, isCompletedSection && { opacity: 0.8 }]}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 15, alignItems: 'flex-start' }}>
          <View style={{ flex: 1, marginRight: 10 }}>
            {q.title && <Text style={{ color: colors.text, fontSize: 16, fontWeight: 'bold' }}>{q.title}</Text>}
            <Text style={styles.qText}>Q{q.label}. {q.content}</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {(q.customConfig?.timerSeconds ?? 0) > 0 && (
              <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 15 }}>
                <Ionicons name="timer" size={16} color={colors.textSecondary} style={{ marginRight: 4 }} />
                <Text style={{ color: colors.textSecondary }}>{q.customConfig?.timerSeconds}s</Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.controlsRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ color: colors.textSecondary, marginRight: 15 }}>
              <Ionicons name="people" size={16} /> {subCount} answers
            </Text>
            {isCompletedSection ? (
              <View style={[styles.statusBadge, { backgroundColor: '#FF525220' }]}>
                <Text style={{ color: '#FF5252', fontWeight: 'bold', fontSize: 12 }}>LOCKED</Text>
              </View>
            ) : isActive ? (
              <View style={[styles.statusBadge, { backgroundColor: '#4CAF5020' }]}>
                <Text style={{ color: '#4CAF50', fontWeight: 'bold', fontSize: 12 }}>LIVE</Text>
              </View>
            ) : isRevealedButLocked ? (
              <View style={[styles.statusBadge, { backgroundColor: '#FF525220' }]}>
                <Text style={{ color: '#FF5252', fontWeight: 'bold', fontSize: 12 }}>LOCKED</Text>
              </View>
            ) : null}
          </View>

          <View style={{ flexDirection: 'row' }}>
            {(isActive || isRevealedButLocked || subCount > 0 || isCompletedSection) && (
              <TouchableOpacity 
                style={[styles.btn, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, marginRight: 10 }]}
                onPress={() => setShowResults(showResults === q.id ? null : q.id)}
                accessibilityRole="button"
                accessibilityLabel={`${showResults === q.id ? 'Hide' : 'Show'} results for ${q.label || 'question'}`}
                accessibilityState={{ expanded: showResults === q.id }}
              >
                <Text style={{ color: colors.text }}>{showResults === q.id ? 'Hide Results' : 'Show Results'}</Text>
              </TouchableOpacity>
            )}
            
            {isCompletedSection ? null : isActive ? (
              <TouchableOpacity 
                disabled={isUpdatingSession || !sessionReady}
                style={[styles.btn, { backgroundColor: '#FF5252', opacity: isUpdatingSession || !sessionReady ? 0.55 : 1 }]}
                onPress={() => void runSessionOperation(lockPopQuizQuestion)}
                accessibilityRole="button"
                accessibilityLabel={`Lock ${q.label || 'question'}`}
                accessibilityState={{ disabled: isUpdatingSession || !sessionReady, busy: isUpdatingSession }}
              >
                <Text style={{ color: colors.onError, fontWeight: 'bold' }}>{isUpdatingSession ? 'Updating…' : 'Lock'}</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity 
                disabled={isUpdatingSession || !sessionReady || anotherQuestionActive}
                style={[styles.btn, { backgroundColor: colors.primary, opacity: isUpdatingSession || !sessionReady || anotherQuestionActive ? 0.55 : 1 }]}
                onPress={() => void runSessionOperation(() => revealPopQuizQuestion(q.id))}
                accessibilityRole="button"
                accessibilityLabel={`Reveal ${q.label || 'question'}`}
                accessibilityState={{ disabled: isUpdatingSession || !sessionReady || anotherQuestionActive, busy: isUpdatingSession }}
              >
                <Text style={{ color: colors.buttonText, fontWeight: 'bold' }}>{isUpdatingSession ? 'Updating…' : anotherQuestionActive ? 'Lock current first' : 'Reveal'}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {showResults === q.id && (
          <View style={styles.resultsArea}>
            <Text style={{ color: colors.text, fontWeight: 'bold', marginBottom: 10 }}>Results Summary</Text>
            {Object.entries(getResultsSummary(q.id)).length === 0 ? (
              <Text style={{ color: colors.textSecondary }}>No answers yet.</Text>
            ) : (
              Object.entries(getResultsSummary(q.id)).map(([ans, count]) => (
                <View key={ans} style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 }}>
                  <Text style={{ color: colors.text }}>{ans}</Text>
                  <Text style={{ color: colors.textSecondary, fontWeight: 'bold' }}>{count}</Text>
                </View>
              ))
            )}
          </View>
        )}
      </View>
    );
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={sessionReady ? requestEnd : onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <View>
            <Text style={styles.headerTitle}>{item.isPoll ? 'Host Poll' : 'Host Live Quiz'}</Text>
            <Text style={styles.headerSubtitle}>{item.title}</Text>
          </View>
          <TouchableOpacity disabled={isUpdatingSession} onPress={sessionReady ? requestEnd : onClose} style={[styles.endBtn, { opacity: isUpdatingSession ? 0.55 : 1 }]} accessibilityRole="button" accessibilityLabel={sessionReady ? 'End live session' : 'Close live session'} accessibilityState={{ disabled: isUpdatingSession, busy: isUpdatingSession }}> 
            <Text style={{ color: colors.onError, fontWeight: 'bold' }}>{isUpdatingSession ? 'Connecting…' : sessionReady ? 'End Session' : 'Close'}</Text>
          </TouchableOpacity>
        </View>

        <ScrollView keyboardShouldPersistTaps="handled" style={styles.content}>
          {liveSessionError && <Text accessibilityRole="alert" style={{ color: colors.error, marginBottom: 12 }}>{liveSessionError}</Text>}
          {!sessionReady && !isUpdatingSession && (
            <TouchableOpacity onPress={retryStart} style={[styles.btn, { backgroundColor: colors.primary, alignSelf: 'flex-start', marginBottom: 12 }]} accessibilityRole="button">
              <Text style={{ color: colors.buttonText, fontWeight: 'bold' }}>Retry live session</Text>
            </TouchableOpacity>
          )}
          <View style={styles.infoCard}>
            <Ionicons name="information-circle" size={24} color={colors.primary} />
            <Text style={{ color: colors.text, marginLeft: 10, flex: 1 }}>
              {'Students see “Waiting for Teacher…” until you reveal a question. Only one question can be active at a time.'}
            </Text>
          </View>

          {upcomingQuestions.length > 0 && (
            <View>
              <Text style={{ color: colors.text, fontWeight: 'bold', fontSize: 18, marginBottom: 15, marginTop: 10 }}>Upcoming & Active</Text>
              {upcomingQuestions.map(q => renderQuestion(q, false))}
            </View>
          )}

          {completedQuestions.length > 0 && (
            <View style={{ marginTop: 20 }}>
              <Text style={{ color: colors.textSecondary, fontWeight: 'bold', fontSize: 18, marginBottom: 15 }}>Completed</Text>
              {completedQuestions.map(q => renderQuestion(q, true))}
            </View>
          )}

        </ScrollView>
      </View>
    </Modal>
  );
};

const getStyles = (colors: any) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  headerTitle: { color: colors.text, fontSize: 24, fontWeight: 'bold' },
  headerSubtitle: { color: colors.textSecondary, fontSize: 14, marginTop: 4 },
  endBtn: { backgroundColor: '#FF5252', paddingHorizontal: 15, paddingVertical: 10, borderRadius: 8, minHeight: 44, justifyContent: 'center' },
  content: { flex: 1, padding: 20 },
  infoCard: { flexDirection: 'row', backgroundColor: colors.primary + '10', padding: 15, borderRadius: 12, marginBottom: 20, alignItems: 'center' },
  qCard: { backgroundColor: colors.card, padding: 20, borderRadius: 12, marginBottom: 15, borderWidth: 2, borderColor: 'transparent' },
  qCardActive: {
    borderColor: colors.primary,
    ...(Platform.OS === 'web'
      ? { boxShadow: `0 2px 10px ${colors.primary}33` }
      : { shadowColor: colors.primary, shadowOpacity: 0.2, shadowRadius: 10 }),
  },
  qText: { color: colors.text, fontSize: 18, fontWeight: 'bold', flex: 1, marginRight: 10 },
  controlsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 15 },
  btn: { paddingHorizontal: 15, paddingVertical: 10, borderRadius: 8, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, marginLeft: 10 },
  resultsArea: { marginTop: 15, paddingTop: 15, borderTopWidth: 1, borderColor: colors.border, backgroundColor: '#00000010', padding: 15, borderRadius: 8 }
});
