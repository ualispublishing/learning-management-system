/**
 * @fileoverview src/app/study/[deckId].tsx.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, SafeAreaView, Platform, KeyboardAvoidingView, PanResponder, ScrollView, AccessibilityInfo, AppState } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { RectLoader } from '../../components/ui/RectLoader';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withSequence, withDelay, runOnJS } from 'react-native-reanimated';
import { CardData, CardDisplay } from '../../components/ui/CardDisplay';
import { BottomBar } from '../../components/ui/BottomBar';
import { useThemeColors } from '../../lib/useThemeColors';
import { typography, spacing } from '../../lib/theme';
import { BackButton } from '../../components/ui/BackButton';
import i18n from '../../lib/i18n';
import { shouldIgnoreStudyShortcut } from '../../lib/studyKeyboard';
import { normalizeStudyRoute } from '../../lib/studyRoute';
import { DIAGNOSTIC_CONTEXTS, logDiagnosticError } from '../../lib/diagnosticLog';
import {
  applyStudyRatingResult,
  commitStudyRating,
  gradeQuizAnswer,
  loadStudySession,
  requestStudyReveal,
  updateStudyLayerNote,
} from '../../lib/studySession';

export default function StudySession() {
  const routeParams = useLocalSearchParams<{
    deckId?: string | string[];
    target?: string | string[];
    mode?: string | string[];
    startPos?: string | string[];
    group?: string | string[];
  }>();
  const normalizedRoute = normalizeStudyRoute({
    deckId: routeParams.deckId,
    target: routeParams.target,
    mode: routeParams.mode,
    startPos: routeParams.startPos,
    group: routeParams.group,
  });
  const routeError = normalizedRoute.success ? null : normalizedRoute.error;
  const deckId = normalizedRoute.success ? normalizedRoute.deckId : '';
  const target = normalizedRoute.success ? normalizedRoute.target : 'all';
  const mode = normalizedRoute.success ? normalizedRoute.mode : 'study';
  const startPos = normalizedRoute.success ? normalizedRoute.startPos : '1';
  const group = normalizedRoute.success ? normalizedRoute.group : 'all';
  const router = useRouter();
  const colors = useThemeColors();
  
  const [loading, setLoading] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [deckSettings, setDeckSettings] = useState<any>({});
  const [cardsToStudy, setCardsToStudy] = useState<{ card: any, note: any, layers: any[] }[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const currentCardItem = cardsToStudy[currentIndex];
  const [depthIndex, setDepthIndex] = useState(-1);
  const [isRevealed, setIsRevealed] = useState(false);
  const [submittedAnswer, setSubmittedAnswer] = useState('');
  const [quizResults, setQuizResults] = useState<{ correct: number, total: number, details: any[] }>({ correct: 0, total: 0, details: [] });
  const [showQuizSummary, setShowQuizSummary] = useState(false);
  // Notification State
  const notifOpacity = useSharedValue(0);
  const notifTranslateY = useSharedValue(-20);
  const [notificationText, setNotificationText] = useState('');
  
  const advanceTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const startTimeRef = React.useRef<number>(0);
  const isGradingRef = React.useRef(false);
  const loadGenerationRef = React.useRef(0);

  const backgroundTimeRef = React.useRef<number>(0);
  const appStateRef = React.useRef(AppState.currentState);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (appStateRef.current.match(/active/) && nextState.match(/inactive|background/)) {
        backgroundTimeRef.current = Date.now();
      } else if (appStateRef.current.match(/inactive|background/) && nextState === 'active') {
        if (backgroundTimeRef.current > 0) {
          const pausedDuration = Date.now() - backgroundTimeRef.current;
          startTimeRef.current += pausedDuration;
          backgroundTimeRef.current = 0;
        }
      }
      appStateRef.current = nextState;
    });
    return () => {
      if (advanceTimeoutRef.current) clearTimeout(advanceTimeoutRef.current);
      sub.remove();
    };
  }, []);

  const isNavigatingRef = React.useRef(false);
  const handleBack = () => {
    if (isNavigatingRef.current) return;
    isNavigatingRef.current = true;
    router.replace('/');
    setTimeout(() => isNavigatingRef.current = false, 500);
  };

  async function loadCards(currentTarget: string, currentMode: string, startPositionStr: string) {
    const generation = ++loadGenerationRef.current;
    try {
      setLoading(true);
      setSessionError(null);
      setReviewError(null);
      if (currentMode !== 'learn' && currentMode !== 'study' && currentMode !== 'quiz') {
        throw new Error('The requested study mode is invalid.');
      }
      const loaded = await loadStudySession({
        deckId,
        target: currentTarget,
        mode: currentMode,
        startPosition: startPositionStr,
        group,
      });
      if (generation !== loadGenerationRef.current) return;
      setDeckSettings(loaded.deckSettings);
      setCardsToStudy(loaded.cards);
      setCurrentIndex(0);
      setDepthIndex(-1);
      startTimeRef.current = Date.now();
      
    } catch (e) {
      logDiagnosticError(DIAGNOSTIC_CONTEXTS.studySessionLoad, e);
      if (generation === loadGenerationRef.current) {
        setCardsToStudy([]);
        setSessionError(e instanceof Error ? e.message : 'The study session could not be loaded.');
      }
    } finally {
      if (generation === loadGenerationRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    if (routeError) {
      const timer = setTimeout(() => {
        setCardsToStudy([]);
        setSessionError(routeError);
        setLoading(false);
      }, 0);
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(() => void loadCards(target || 'all', mode, startPos), 0);
    return () => clearTimeout(timer);
  // loadCards receives volatile route inputs explicitly and only closes over deckId/group.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckId, target, mode, startPos, group, routeError]);

  const showNotification = (text: string, advanceAfter: boolean = false) => {
    setNotificationText(text);
    notifTranslateY.value = -20;
    notifOpacity.value = withSequence(
      withTiming(1, { duration: 300 }),
      withDelay(1200, withTiming(0, { duration: 300 }, (finished) => {
        if (finished) {
          runOnJS(setNotificationText)('');
          if (advanceAfter) runOnJS(advanceCard)();
        }
      }))
    );
    notifTranslateY.value = withTiming(0, { duration: 300 });
  };

  const selectCard = (nextIndex: number | ((previous: number) => number)) => {
    setDepthIndex(-1);
    setIsRevealed(false);
    setSubmittedAnswer('');
    startTimeRef.current = Date.now();
    setCurrentIndex(nextIndex);
  };

  const handleReveal = (answer?: string) => {
    const result = requestStudyReveal(mode, answer);
    if (!result.revealed) {
      showNotification(result.error);
      AccessibilityInfo.announceForAccessibility(result.error);
      return false;
    }
    setSubmittedAnswer(result.submittedAnswer);
    setIsRevealed(true);
    return true;
  };

  const advanceCard = (immediate: boolean = false) => {
    setIsRevealed(false);
    setSubmittedAnswer('');
    if (immediate) {
      if (advanceTimeoutRef.current) clearTimeout(advanceTimeoutRef.current);
      selectCard(prev => prev + 1);
      isGradingRef.current = false;
    } else {
      if (advanceTimeoutRef.current) clearTimeout(advanceTimeoutRef.current);
      advanceTimeoutRef.current = setTimeout(() => {
        selectCard(prev => prev + 1);
        isGradingRef.current = false;
      }, 150);
    }
  };

  const handleGrade = async (rating: number) => { // rating is 0-100 from knob
    if (!currentCardItem || isGradingRef.current) return;
    isGradingRef.current = true;
    setReviewError(null);
    
    try {
      const durationMs = Date.now() - startTimeRef.current;

      if (mode === 'quiz') {
        const isCorrect = gradeQuizAnswer(rating);
        setQuizResults(prev => ({ 
          correct: prev.correct + (isCorrect ? 1 : 0), 
          total: prev.total + 1,
          details: [...prev.details, { cardItem: currentCardItem, isCorrect, submittedAnswer }]
        }));
        advanceCard();
        return;
      }
      
      if (mode === 'learn') {
        advanceCard();
        return;
      }

      const result = await commitStudyRating({ item: currentCardItem, rating, durationMs });
      setCardsToStudy(previous => applyStudyRatingResult(previous, currentIndex, result));

      if (result.unlockedLayerId) showNotification(i18n.t('newInfoUnlocked'), true);
      else advanceCard();
    } catch (e) {
      logDiagnosticError(DIAGNOSTIC_CONTEXTS.studyReviewSave, e);
      setReviewError(e instanceof Error ? e.message : 'Your review could not be saved. Please retry.');
      isGradingRef.current = false;
    }
  };

  const handleSkip = () => {
    if (isGradingRef.current) return; // Prevent skip while grading
    advanceCard(true);
  };

  useEffect(() => {
    if (Platform.OS !== 'web') return;

    const currentCardItem = cardsToStudy[currentIndex];
    const unlockedLayers = currentCardItem ? currentCardItem.layers.filter(l => l.is_unlocked).map(l => l.content) : [];
    const depthContent = unlockedLayers.length > 1 ? unlockedLayers.slice(1) : [];
    const totalPages = 1 + depthContent.length;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (shouldIgnoreStudyShortcut(e.target)) return;
      
      if (e.repeat) return; // Prevent unthrottled keyboard rapid-firing

      
      if (!isRevealed) {
        if (e.code === 'Space' || e.code === 'Enter') {
          e.preventDefault();
          handleReveal();
        } else if (e.code === 'ArrowRight' || e.code === 'ArrowUp') {
          e.preventDefault();
          handleSkip();
        } else if (e.code === 'ArrowLeft' || e.code === 'ArrowDown') {
          e.preventDefault();
          if (currentIndex > 0) {
            selectCard(currentIndex - 1);
          }
        }
      } else {
        if (e.code === 'Space' || e.code === 'Enter') {
          e.preventDefault();
          if (mode === 'learn' || mode === 'quiz') {
             if (depthIndex < totalPages - 2) setDepthIndex(depthIndex + 1);
             else handleSkip();
          } else {
             setIsRevealed(false);
          }
        } else if (e.code === 'Digit1' || e.code === 'Numpad1') {
          e.preventDefault();
          if (mode === 'study') handleGrade(0); // 0-25 -> Again
        } else if (e.code === 'Digit2' || e.code === 'Numpad2') {
          e.preventDefault();
          if (mode === 'study') handleGrade(33); // 26-50 -> Hard
        } else if (e.code === 'Digit3' || e.code === 'Numpad3') {
          e.preventDefault();
          if (mode === 'study') handleGrade(66); // 51-75 -> Good
        } else if (e.code === 'Digit4' || e.code === 'Numpad4') {
          e.preventDefault();
          if (mode === 'study') handleGrade(100); // 76-100 -> Easy
        } else if (e.code === 'ArrowRight' || e.code === 'ArrowUp') {
          e.preventDefault();
          if (depthIndex < totalPages - 2) {
             setDepthIndex(prev => prev + 1);
          } else {
             handleSkip();
          }
        } else if (e.code === 'ArrowLeft' || e.code === 'ArrowDown') {
          e.preventDefault();
          if (depthIndex > -1) {
             setDepthIndex(prev => prev - 1);
          } else {
             if (currentIndex > 0) {
               selectCard(currentIndex - 1);
             }
          }
        }
      }
    };

    if (Platform.OS === 'web') {
      window.addEventListener('keydown', handleKeyDown as any);
      return () => window.removeEventListener('keydown', handleKeyDown as any);
    }
  // The effect is intentionally rebound for every piece of study state used by
  // the keyboard handler; action callbacks are refreshed by those same values.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRevealed, currentIndex, cardsToStudy, mode, depthIndex]);

  /* eslint-disable react-hooks/refs -- Gesture callbacks read refs only after an input event; the compiler cannot model that boundary. */
  const panResponder = React.useMemo(() => {
    const currentCardItem = cardsToStudy[currentIndex];
    if (!currentCardItem) return PanResponder.create({});
    const unlockedLayers = currentCardItem ? currentCardItem.layers.filter(l => l.is_unlocked).map(l => l.content) : [];
    const depthContent = unlockedLayers.length > 1 ? unlockedLayers.slice(1) : [];
    const totalPages = 1 + depthContent.length;

    return PanResponder.create({
      onMoveShouldSetPanResponderCapture: (evt, gestureState) => {
        return Math.abs(gestureState.dx) > 30 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy);
      },
      onPanResponderRelease: (evt, gestureState) => {
        if (gestureState.dx < -50) {
          // Swiped Left -> Next
          if (isRevealed && depthIndex < totalPages - 2) {
             setDepthIndex(depthIndex + 1);
          } else {
             handleSkip();
          }
        } else if (gestureState.dx > 50) {
          // Swiped Right -> Previous
          if (isRevealed && depthIndex > -1) {
             setDepthIndex(depthIndex - 1);
          } else {
             if (currentIndex > 0) {
               selectCard(currentIndex - 1);
             }
          }
        }
      }
    });
  // handleSkip is an event action backed by current refs/state above.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, cardsToStudy, isRevealed, depthIndex]);
  /* eslint-enable react-hooks/refs */

  const notifStyle = useAnimatedStyle(() => ({
    opacity: notifOpacity.value,
    transform: [{ translateY: notifTranslateY.value }]
  }));
  const currentCardData: CardData = React.useMemo(() => {
    if (!currentCardItem) {
      return { id: '', front: '', back: '', depthLayers: [], layerNotes: {}, retrievability: 1.0 };
    }
    const unlockedLayers = currentCardItem.layers.filter(l => l.is_unlocked).map(l => l.content);
    const backContent = unlockedLayers.length > 0 ? unlockedLayers[0] : (currentCardItem.note.field_values.back || 'Back side content');
    const depthContent = unlockedLayers.length > 1 ? unlockedLayers.slice(1) : [];
    
    return {
      id: currentCardItem.card.id,
      front: currentCardItem.note.field_values.front,
      back: backContent,
      depthLayers: depthContent,
      layerNotes: currentCardItem.note.field_values.layerNotes ? JSON.parse(currentCardItem.note.field_values.layerNotes) : {},
      userNotes: currentCardItem.note.field_values.userNotes, // legacy support
      voiceNoteUri: currentCardItem.note.field_values.voiceNoteUri, // legacy support
      textColor: currentCardItem.note.field_values.textColor,
      retrievability: 1.0, // Force high retrievability to show layers
    };
  }, [currentCardItem]);


  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.centerContainer}>
          <RectLoader text="Preparing your study session..." />
        </View>
      </SafeAreaView>
    );
  }

  if (sessionError) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}> 
        <View style={styles.centerContainer}>
          <View style={[styles.completionCard, { backgroundColor: colors.card, borderColor: colors.border }]}> 
            <Text accessibilityRole="alert" style={[styles.completionTitle, { color: colors.error }]}>Session unavailable</Text>
            <Text style={{ color: colors.textSecondary, textAlign: 'center', marginBottom: spacing[5] }}>{sessionError}</Text>
            {!routeError && (
              <Pressable
                accessibilityRole="button"
                style={[styles.completionBtn, { backgroundColor: colors.primary, marginBottom: spacing[3] }]}
                onPress={() => void loadCards(target || 'all', mode, startPos)}
              >
                <Text style={[styles.completionBtnText, { color: colors.buttonText }]}>Retry</Text>
              </Pressable>
            )}
            <Pressable accessibilityRole="button" style={[styles.completionBtn, { backgroundColor: colors.border }]} onPress={handleBack}>
              <Text style={[styles.completionBtnText, { color: colors.text }]}>{i18n.t('returnToDecks')}</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (!currentCardItem) {
    if (mode === 'quiz' && quizResults.total > 0) {
       if (showQuizSummary) {
          return (
            <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
              <View style={styles.topBar}>
                <Pressable accessibilityRole="button" accessibilityLabel="Back to quiz results" style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }} onPress={() => setShowQuizSummary(false)}><Text style={{color: colors.primary, fontSize: typography.lg}}>Back</Text></Pressable>
                <Text style={{color: colors.text, fontSize: typography.xl, fontWeight: 'bold'}}>Quiz Summary</Text>
                <View style={{width: 40}} />
              </View>
              <ScrollView keyboardShouldPersistTaps="handled" style={{flex: 1, padding: spacing[4]}}>
                {quizResults.details.map((detail, idx) => {
                   const stripMarkdown = (str: string) => {
                     return str
                       .replace(/!\[.*?\]\(.*?\)|\[VIDEO:.*?\]|\[AUDIO:.*?\]/g, '[Media]')
                       .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
                       .replace(/(\*\*|__)(.*?)\1/g, '$2')
                       .replace(/(\*|_)(.*?)\1/g, '$2')
                       .replace(/~~(.*?)~~/g, '$1')
                       .replace(/`{1,3}([^`]+)`{1,3}/g, '$1')
                       .replace(/#+\s/g, '')
                       .replace(/>\s/g, '')
                       .trim();
                   };
                   const front = stripMarkdown(detail.cardItem.note.field_values.front || '');
                   const back = stripMarkdown(detail.cardItem.note.field_values.back || '');
                   return (
                     <View key={idx} style={{marginBottom: spacing[4], padding: spacing[4], backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border}}>
                        <Text style={{color: colors.text, fontSize: typography.base, fontWeight: 'bold', marginBottom: spacing[2]}}>Q: {front || '(Blank)'}</Text>
                        <Text style={{color: colors.textSecondary, fontSize: typography.sm, marginBottom: spacing[2]}}>A: {back || '(Blank)'}</Text>
                        <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'}}>
                          <Text style={{color: detail.isCorrect ? colors.success : colors.danger, fontWeight: 'bold'}}>
                             {detail.isCorrect ? 'Correct' : 'Incorrect'}
                          </Text>
                          <Text style={{color: colors.textSecondary, fontSize: typography.sm}}>
                             Your answer: {detail.submittedAnswer || '(None)'}
                          </Text>
                        </View>
                     </View>
                   );
                })}
              </ScrollView>
            </SafeAreaView>
          );
       }
       return (
         <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} {...panResponder.panHandlers}>
           <View style={styles.centerContainer}>
             <View style={[styles.completionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
               <Text style={[styles.completionTitle, { color: colors.text }]}>Quiz Complete!</Text>
               <Text style={{ color: colors.textSecondary, fontSize: typography.xl, textAlign: 'center', marginBottom: spacing[6] }}>
                 You scored {quizResults.correct} out of {quizResults.total} ({Math.round(quizResults.correct / quizResults.total * 100)}%).
               </Text>
               <Pressable accessibilityRole="button" style={[styles.completionBtn, { backgroundColor: colors.info, marginBottom: spacing[4] }]} onPress={() => setShowQuizSummary(true)}>
                 <Text style={[styles.completionBtnText, { color: colors.onInfo }]}>Review Quiz</Text>
               </Pressable>
               <Pressable accessibilityRole="button" style={[styles.completionBtn, { backgroundColor: colors.primary }]} onPress={handleBack}>
                 <Text style={[styles.completionBtnText, { color: colors.buttonText }]}>{i18n.t('returnToDecks')}</Text>
               </Pressable>
             </View>
           </View>
         </SafeAreaView>
       );
    }

    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} {...panResponder.panHandlers}>
        <View style={styles.centerContainer}>
          <View style={[styles.completionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text accessibilityRole="header" style={[styles.completionTitle, { color: colors.text }]}>{mode !== 'study' ? i18n.t('sessionComplete') : i18n.t('emptyReviewTitle')}</Text>
            <Text style={{ color: colors.textSecondary, fontSize: typography.base, textAlign: 'center', marginBottom: spacing[6] }}>
              {mode !== 'study' ? "You've finished your session." : "There are no more cards due for review today."}
            </Text>
            
            {deckId !== 'all' && (
              <Pressable accessibilityRole="button" style={[styles.completionBtn, { backgroundColor: colors.warning, marginBottom: spacing[3] }]} onPress={() => {
                selectCard(0);
                const nextStartPos = (parseInt(startPos || '1', 10) || 1) + cardsToStudy.length;
                router.replace(`/study/${encodeURIComponent(deckId)}?target=${encodeURIComponent(target || 'all')}&mode=learn&startPos=${nextStartPos}`);
              }}>
                <Text style={[styles.completionBtnText, { color: colors.buttonText }]}>Study Anyway (Continue)</Text>
              </Pressable>
            )}

            <Pressable accessibilityRole="button" style={[styles.completionBtn, { backgroundColor: colors.primary }]} onPress={handleBack}>
              <Text style={[styles.completionBtnText, { color: colors.buttonText }]}>{i18n.t('returnToDecks')}</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const handleUpdateNotes = async (notes: string, voiceNoteUri?: string, targetLayer?: number) => {
    if (!currentCardItem) return;
    const updatedNote = await updateStudyLayerNote(currentCardItem.note, notes, voiceNoteUri, targetLayer);
    setCardsToStudy(prev => prev.map((item, index) => index === currentIndex
      ? { ...item, note: updatedNote }
      : item));
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} {...panResponder.panHandlers}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={styles.topBar}>
          <BackButton />
          {mode !== 'study' && (
            <View style={{ backgroundColor: colors.warning, paddingHorizontal: spacing[2], paddingVertical: spacing[1], borderRadius: 8 }}>
              <Text style={{ color: colors.buttonText, fontSize: typography.xs, fontWeight: 'bold' }}>{mode.toUpperCase()} MODE</Text>
            </View>
          )}
          <Text accessibilityLiveRegion="polite" style={[styles.counter, { color: colors.textSecondary }]}>{cardsToStudy.length - currentIndex} {i18n.t('moreToGo')}</Text>
        </View>

        <View style={styles.cardArea}>
          {reviewError && (
            <View style={{ backgroundColor: colors.error, padding: spacing[3], borderRadius: 8, marginBottom: spacing[2] }}>
              <Text accessibilityRole="alert" style={{ color: colors.onError, textAlign: 'center' }}>{reviewError}</Text>
            </View>
          )}
          {/* Notification Toast */}
          <Animated.View
            {...(Platform.OS === 'web' ? ({ 'aria-hidden': !notificationText } as object) : {})}
            style={[styles.notificationOverlay, notifStyle, { pointerEvents: 'none' as any }]}
          >
            <View accessibilityLiveRegion="polite" style={[styles.notificationBox, { backgroundColor: colors.info }]}>
              <Text style={[styles.notificationText, { color: colors.onInfo }]}>{notificationText}</Text>
            </View>
          </Animated.View>

          <CardDisplay
            key={currentCardItem.card.id}
            card={currentCardData}
            isRevealed={isRevealed}
            onReveal={() => { handleReveal(); }}
            onUpdateNotes={handleUpdateNotes}
            submittedAnswer={submittedAnswer}
            cardColor={currentCardItem.note.field_values.color || deckSettings.cardColor || colors.card}
            depthIndex={depthIndex}
            onDepthIndexChange={setDepthIndex}
            onComplete={handleSkip}
          />
        </View>

        <BottomBar
          key={currentCardItem.card.id}
          isRevealed={isRevealed}
          canGoPrevious={currentIndex > 0}
          initialKnobValue={currentCardItem.card.reps > 0 ? currentCardItem.card.last_knob_value : 50}
          onPrevious={() => {
            if (currentIndex > 0) {
              selectCard(currentIndex - 1);
            }
          }}
          onReveal={handleReveal}
          onResetReveal={() => {
            setIsRevealed(false);
            setSubmittedAnswer('');
          }}
          onSkip={handleSkip}
          onRate={handleGrade}
          mode={mode as 'learn' | 'study' | 'quiz'}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing[5],
    paddingTop: 30, // Delevated for aesthetic breathing room
    paddingBottom: spacing[2],
  },
  counter: {
    fontSize: typography.base,
    fontWeight: '700',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing[5],
  },
  cardArea: {
    flex: 1,
    justifyContent: 'center',
    position: 'relative',
  },
  notificationOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    start: 0,
    end: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
    elevation: 100,
  },
  notificationBox: {
    paddingHorizontal: spacing[6],
    paddingVertical: spacing[3],
    borderRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  notificationText: {
    fontSize: typography.lg,
    fontWeight: '800',
  },
  answerBubbleOverlay: {
    position: 'absolute',
    bottom: '100%',
    marginBottom: spacing[3],
    start: spacing[5],
    end: spacing[5],
    alignItems: 'center',
    zIndex: 50,
    elevation: 50,
  },
  answerBubble: {
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[3],
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    maxWidth: '100%',
  },
  answerBubbleTitle: {
    fontSize: typography.xs,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: spacing[1],
  },
  answerBubbleText: {
    fontSize: typography.base,
    fontWeight: '600',
  },
  completionCard: {
    padding: 32,
    borderRadius: 24,
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
    borderWidth: 1,
  },
  completionTitle: {
    fontSize: typography['3xl'],
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: spacing[6],
  },
  completionBtn: {
    paddingVertical: spacing[4],
    paddingHorizontal: spacing[6],
    borderRadius: 16,
    width: '100%',
    alignItems: 'center',
    marginBottom: spacing[6],
  },
  completionBtnText: {
    fontSize: typography.lg,
    fontWeight: '800',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: spacing[3],
  },
  toggleLabel: {
    fontSize: typography.lg,
    fontWeight: '700',
  },
  toggleTrack: {
    width: 50,
    height: 30,
    borderRadius: 15,
    padding: 2,
    justifyContent: 'center',
  },
  toggleThumb: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#FFF', 
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
});
