/**
 * @fileoverview src/components/ui/BottomBar.tsx.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import React, { useState } from 'react';
import { View, StyleSheet, TextInput, Pressable, Text, Keyboard, Platform } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { ProficiencyKnob } from './ProficiencyKnob';
import { useThemeColors } from '../../lib/useThemeColors';
import { typography, spacing } from '../../lib/theme';
import { useSettingsStore } from '../../lib/store/useSettingsStore';

interface BottomBarProps {
  isRevealed: boolean;
  onSkip: () => void; // Next card
  onPrevious: () => void; // Previous card
  onRate: (rating: number) => void;
  onReveal: (answer: string) => void;
  onResetReveal: () => void;
  initialKnobValue?: number;
  mode?: 'learn' | 'study' | 'quiz';
  canGoPrevious?: boolean;
}

export function BottomBar({ isRevealed, onSkip, onPrevious, onRate, onReveal, onResetReveal, initialKnobValue = 50, mode = 'study', canGoPrevious = true }: BottomBarProps) {
  const colors = useThemeColors();
  const { reducedMotion } = useSettingsStore();
  const [typedAnswer, setTypedAnswer] = useState('');
  const [knobValue, setKnobValue] = useState(initialKnobValue);

  const handleReset = () => {
    setTypedAnswer('');
    setKnobValue(initialKnobValue);
    onResetReveal();
  };

  const handleKnobRelease = (val: number) => {
    onRate(val);
  };

  const duration = reducedMotion ? 0 : 250;

  const beforeRevealStyle = useAnimatedStyle(() => {
    return {
      opacity: withTiming(isRevealed ? 0 : 1, { duration }),
      zIndex: isRevealed ? 0 : 1,
      transform: [{ translateY: withTiming(isRevealed ? 20 : 0, { duration }) }],
      position: 'absolute',
      width: '100%',
      bottom: 40,
    };
  });

  const afterRevealStyle = useAnimatedStyle(() => {
    return {
      opacity: withTiming(isRevealed ? 1 : 0, { duration }),
      zIndex: isRevealed ? 1 : 0,
      transform: [{ translateY: withTiming(isRevealed ? 0 : 20, { duration }) }],
      position: 'absolute',
      width: '100%',
      bottom: 40,
    };
  });

  return (
    <View style={styles.container}>
      {/* Before Reveal */}
      <Animated.View
        {...(Platform.OS === 'web'
          ? ({ 'aria-hidden': isRevealed } as object)
          : { accessibilityElementsHidden: isRevealed, importantForAccessibility: isRevealed ? 'no-hide-descendants' as const : 'yes' as const })}
        style={[
          styles.section,
          beforeRevealStyle,
          Platform.OS === 'web' && isRevealed ? styles.webHidden : null,
          { pointerEvents: isRevealed ? 'none' : 'auto' } as any,
        ]}
      >
        {(mode === 'quiz' || mode === 'study') && (
          <View style={styles.inputRow}>
            <TextInput
              style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
              placeholder="Type your answer (optional)..."
              placeholderTextColor={colors.textSecondary}
              maxLength={80}
              value={typedAnswer}
              onChangeText={setTypedAnswer}
              onSubmitEditing={() => {
                Keyboard.dismiss();
                onReveal(typedAnswer);
              }}
              returnKeyType="done"
              accessibilityLabel="Type your answer"
              accessibilityHint="Optional text input to write your answer before revealing it"
            />
          </View>
        )}
        <View style={styles.btnRow}>
          <Pressable 
            style={[styles.skipBtn, { backgroundColor: colors.secondary }, !canGoPrevious && styles.disabledBtn]} 
            onPress={onPrevious}
            disabled={!canGoPrevious}
            accessibilityRole="button"
            accessibilityLabel="Previous card"
            accessibilityHint="Go back to the previous flashcard"
            accessibilityState={{ disabled: !canGoPrevious }}
          >
            <Text style={[styles.skipBtnText, { color: colors.onSecondary }]}>Previous</Text>
          </Pressable>
          <Pressable 
            style={[styles.revealBtn, { backgroundColor: colors.primary }]} 
            onPress={() => { Keyboard.dismiss(); onReveal(typedAnswer); }}
            accessibilityRole="button"
            accessibilityLabel={mode === 'quiz' ? "Submit Answer" : "Reveal Answer"}
            accessibilityHint="Show the answer for the current flashcard"
            accessibilityState={{ disabled: isRevealed }}
          >
            <Text style={[styles.revealBtnText, { color: colors.buttonText }]}>{mode === 'quiz' ? 'Submit Answer' : 'Reveal Answer'}</Text>
          </Pressable>
          <Pressable 
            style={[styles.skipBtn, { backgroundColor: colors.secondary }]} 
            onPress={onSkip}
            accessibilityRole="button"
            accessibilityLabel="Next card"
            accessibilityHint="Skip to the next flashcard"
            accessibilityState={{ disabled: isRevealed }}
          >
            <Text style={[styles.skipBtnText, { color: colors.onSecondary }]}>Next</Text>
          </Pressable>
        </View>
      </Animated.View>

      {/* After Reveal */}
      <Animated.View
        {...(Platform.OS === 'web'
          ? ({ 'aria-hidden': !isRevealed } as object)
          : { accessibilityElementsHidden: !isRevealed, importantForAccessibility: isRevealed ? 'yes' as const : 'no-hide-descendants' as const })}
        style={[
          styles.section,
          afterRevealStyle,
          Platform.OS === 'web' && !isRevealed ? styles.webHidden : null,
          { pointerEvents: isRevealed ? 'auto' : 'none' } as any,
        ]}
      >
        {mode === 'study' && (
          <>
            <View style={styles.knobContainer}>
              <ProficiencyKnob
                value={knobValue}
                onChange={setKnobValue}
                onRelease={handleKnobRelease}
              />
            </View>
            
            <View style={styles.btnRow}>
              <Pressable 
                style={[styles.skipBtn, { backgroundColor: colors.secondary }, !canGoPrevious && styles.disabledBtn]} 
                onPress={onPrevious}
                disabled={!canGoPrevious}
                accessibilityRole="button"
                accessibilityLabel="Previous card"
                accessibilityHint="Go back to the previous flashcard"
                accessibilityState={{ disabled: !canGoPrevious }}
              >
                <Text style={[styles.skipBtnText, { color: colors.onSecondary }]}>Previous</Text>
              </Pressable>
              <Pressable 
                style={[styles.skipBtn, { backgroundColor: colors.secondary }]} 
                onPress={handleReset}
                accessibilityRole="button"
                accessibilityLabel="Flip Card"
                accessibilityHint="Hide the answer and show the question again"
                accessibilityState={{ disabled: !isRevealed }}
              >
                <Text style={[styles.skipBtnText, { color: colors.onSecondary }]}>Flip Card</Text>
              </Pressable>
              <Pressable 
                style={[styles.skipBtn, { backgroundColor: colors.secondary }]} 
                onPress={onSkip}
                accessibilityRole="button"
                accessibilityLabel="Next card"
                accessibilityHint="Skip to the next flashcard"
                accessibilityState={{ disabled: !isRevealed }}
              >
                <Text style={[styles.skipBtnText, { color: colors.onSecondary }]}>Next</Text>
              </Pressable>
            </View>
          </>
        )}
        
        {mode === 'learn' && (
          <View style={styles.btnRow}>
            <Pressable 
              style={[styles.skipBtn, { backgroundColor: colors.secondary }, !canGoPrevious && styles.disabledBtn]} 
              onPress={onPrevious}
              disabled={!canGoPrevious}
              accessibilityRole="button"
              accessibilityLabel="Previous card"
              accessibilityHint="Go back to the previous flashcard"
              accessibilityState={{ disabled: !canGoPrevious }}
            >
              <Text style={[styles.skipBtnText, { color: colors.onSecondary }]}>Previous</Text>
            </Pressable>
            <Pressable 
              style={[styles.skipBtn, { backgroundColor: colors.secondary }]} 
              onPress={handleReset}
              accessibilityRole="button"
              accessibilityLabel="Flip Card"
              accessibilityHint="Hide the answer and show the question again"
              accessibilityState={{ disabled: !isRevealed }}
            >
              <Text style={[styles.skipBtnText, { color: colors.onSecondary }]}>Flip Card</Text>
            </Pressable>
            <Pressable 
              style={[styles.skipBtn, { backgroundColor: colors.secondary }]} 
              onPress={onSkip}
              accessibilityRole="button"
              accessibilityLabel="Next card"
              accessibilityHint="Skip to the next flashcard"
              accessibilityState={{ disabled: !isRevealed }}
            >
              <Text style={[styles.skipBtnText, { color: colors.onSecondary }]}>Next</Text>
            </Pressable>
          </View>
        )}

        {mode === 'quiz' && (
          <>
            <View style={[styles.btnRow, { marginBottom: spacing[4] }]}>
              <Pressable accessibilityRole="button" accessibilityLabel="Mark answer incorrect" style={[styles.skipBtn, { backgroundColor: '#ef4444' }]} onPress={() => onRate(0)}>
                <Text style={[styles.skipBtnText, { color: '#000000' }]}>❌ Incorrect</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Mark answer correct" style={[styles.skipBtn, { backgroundColor: '#22c55e' }]} onPress={() => onRate(100)}>
                <Text style={[styles.skipBtnText, { color: '#000000' }]}>✅ Correct</Text>
              </Pressable>
            </View>
            <View style={styles.btnRow}>
              <Pressable accessibilityRole="button" accessibilityLabel="Previous card" accessibilityState={{ disabled: !canGoPrevious }} disabled={!canGoPrevious} style={[styles.skipBtn, { backgroundColor: colors.secondary }, !canGoPrevious && styles.disabledBtn]} onPress={onPrevious}>
                <Text style={[styles.skipBtnText, { color: colors.onSecondary }]}>Previous</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Flip card" style={[styles.skipBtn, { backgroundColor: colors.secondary }]} onPress={handleReset}>
                <Text style={[styles.skipBtnText, { color: colors.onSecondary }]}>Flip Card</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Next card" style={[styles.skipBtn, { backgroundColor: colors.secondary }]} onPress={onSkip}>
                <Text style={[styles.skipBtnText, { color: colors.onSecondary }]}>Next</Text>
              </Pressable>
            </View>
          </>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  webHidden: {
    display: 'none',
  },
  container: {
    height: 240, // increased to accommodate more padding
    width: '100%',
    justifyContent: 'flex-end',
    paddingBottom: 60, // Elevated to give aesthetic breathing room
    position: 'relative',
  },
  section: {
    paddingHorizontal: spacing[5],
    alignItems: 'center',
  },
  inputRow: {
    width: '100%',
    marginBottom: spacing[4],
  },
  input: {
    padding: spacing[4],
    borderRadius: 12,
    fontSize: typography.base,
    borderWidth: 1,
  },
  btnRow: {
    flexDirection: 'row',
    width: '100%',
    justifyContent: 'space-between',
    gap: 12,
  },
  skipBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    minWidth: 44,
    minHeight: 44,
  },
  skipBtnText: {
    fontSize: typography.base,
    fontWeight: '800',
  },
  disabledBtn: {
    opacity: 0.45,
  },
  revealBtn: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    minWidth: 44,
    minHeight: 44,
  },
  revealBtnText: {
    fontSize: typography.base,
    fontWeight: 'bold',
  },
  knobContainer: {
    width: '100%',
    alignItems: 'center',
    marginBottom: spacing[5],
  },
  cramModeContainer: {
    width: '100%',
    alignItems: 'center',
    paddingTop: spacing[5],
  },
});
