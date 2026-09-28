/**
 * @fileoverview src/components/ui/ShuffleLoader.tsx.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import React, { useEffect } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { useThemeColors } from '../../lib/useThemeColors';
import { typography, spacing } from '../../lib/theme';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  interpolate,
  Extrapolation,
  SharedValue,
} from 'react-native-reanimated';

const CARD_WIDTH = 60;
const CARD_HEIGHT = 80;

interface ShuffleLoaderProps {
  text?: string;
}

function useShuffleCardStyle(progress: SharedValue<number>, index: number) {
  return useAnimatedStyle(() => {
    const phase = (progress.value + index) % 3;
    let translateX = 0;
    let translateY = 0;
    let zIndex = 0;
    let scale = 1;

    if (phase < 1) {
      translateX = interpolate(phase, [0, 0.5, 1], [0, 80, 20], Extrapolation.CLAMP);
      translateY = interpolate(phase, [0, 0.5, 1], [0, -10, -20], Extrapolation.CLAMP);
      zIndex = phase < 0.5 ? 3 : 0;
      scale = interpolate(phase, [0, 0.5, 1], [1, 1.1, 0.9], Extrapolation.CLAMP);
    } else if (phase < 2) {
      translateX = interpolate(phase, [1, 2], [20, 10], Extrapolation.CLAMP);
      translateY = interpolate(phase, [1, 2], [-20, -10], Extrapolation.CLAMP);
      zIndex = 1;
      scale = interpolate(phase, [1, 2], [0.9, 0.95], Extrapolation.CLAMP);
    } else {
      translateX = interpolate(phase, [2, 3], [10, 0], Extrapolation.CLAMP);
      translateY = interpolate(phase, [2, 3], [-10, 0], Extrapolation.CLAMP);
      zIndex = 2;
      scale = interpolate(phase, [2, 3], [0.95, 1], Extrapolation.CLAMP);
    }

    return { transform: [{ translateX }, { translateY }, { scale }], zIndex };
  });
}

export function ShuffleLoader({ text = 'Loading...' }: ShuffleLoaderProps) {
  const colors = useThemeColors();
  // progress goes from 0 to 3
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(
      withTiming(3, {
        duration: 2000, // 2 seconds for a full cycle
        easing: Easing.linear,
      }),
      -1, // infinite
      false
    );
  }, [progress]);

  const backStyle = useShuffleCardStyle(progress, 1);
  const middleStyle = useShuffleCardStyle(progress, 2);
  const frontStyle = useShuffleCardStyle(progress, 0);
  const progressBarStyle = useAnimatedStyle(() => ({
    width: `${interpolate(progress.value % 1, [0, 1], [0, 100])}%`,
  }));

  return (
    <View style={styles.container}>
      <View style={styles.loaderContainer}>
        {/* Render 3 cards */}
        <Animated.View style={[styles.card, styles.cardBack, backStyle, { borderColor: colors.border, backgroundColor: colors.card, shadowColor: colors.text }]} />
        <Animated.View style={[styles.card, styles.cardMiddle, middleStyle, { borderColor: colors.border, backgroundColor: colors.secondary, shadowColor: colors.text }]} />
        <Animated.View style={[styles.card, styles.cardFront, frontStyle, { borderColor: colors.border, backgroundColor: colors.primary, shadowColor: colors.text }]} />
      </View>
      
      <View style={styles.progressContainer}>
        <View style={[styles.progressBarTrack, { backgroundColor: colors.border }]}>
          {/* Simple indeterminate progress bar */}
          <Animated.View style={[styles.progressBarFill, { backgroundColor: colors.primary }, progressBarStyle]} />
        </View>
        {text && <Text style={[styles.text, { color: colors.text }]}>{text}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    padding: spacing[10],
  },
  loaderContainer: {
    height: 120, // Enough room for the cards and their offsets
    width: 120,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    marginBottom: spacing[10],
  },
  card: {
    position: 'absolute',
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 8,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
    elevation: 5,
  },
  cardFront: {
  },
  cardMiddle: {
  },
  cardBack: {
  },
  progressContainer: {
    width: '80%',
    alignItems: 'center',
  },
  progressBarTrack: {
    width: '100%',
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: spacing[3],
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  text: {
    fontSize: typography.sm,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
});
