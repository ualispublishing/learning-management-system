/**
 * @fileoverview src/components/ui/RectLoader.tsx.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import React, { useEffect } from 'react';
import { View, StyleSheet, Text, ActivityIndicator } from 'react-native';
import { useSettingsStore } from '../../lib/store/useSettingsStore';
import { useThemeColors } from '../../lib/useThemeColors';
import { typography, spacing } from '../../lib/theme';
import Animated, { 
  useSharedValue, 
  useAnimatedStyle, 
  withRepeat, 
  withTiming, 
  withSequence,
  Easing,
  interpolate,
  SharedValue,
} from 'react-native-reanimated';

interface RectLoaderProps {
  text?: string;
  barProgress?: number; // 0 to 1
}

function useRectAnimatedStyle(progress: SharedValue<number>, index: number) {
  return useAnimatedStyle(() => {
    const phase = (progress.value + index) % 3;
    const translateX = interpolate(phase, [0, 0.5, 1, 2, 3], [0, 35, 16, 8, 0]);
    const translateY = interpolate(phase, [0, 0.5, 1, 2, 3], [0, 5, -16, -8, 0]);
    const scale = interpolate(phase, [0, 0.5, 1, 2, 3], [1, 0.9, 0.8, 0.9, 1]);
    const zIndex = phase < 0.05 ? 3 : phase < 1 ? 0 : phase < 2 ? 1 : 2;

    return {
      transform: [{ translateX }, { translateY }, { scale }],
      zIndex,
    };
  });
}

export function RectLoader({ text, barProgress }: RectLoaderProps) {
  const colors = useThemeColors();
  const { enableCustomLoader, reducedMotion } = useSettingsStore();
  const progress = useSharedValue(0);
  const fakeProgress = useSharedValue(0);

  useEffect(() => {
    // 3 discrete shifts, each taking 600ms to move and 300ms to pause
    const moveConfig = { duration: 500, easing: Easing.inOut(Easing.quad) };
    const pauseConfig = { duration: 300 };

    progress.value = withRepeat(
      withSequence(
        withTiming(1, moveConfig),
        withTiming(1, pauseConfig),
        withTiming(2, moveConfig),
        withTiming(2, pauseConfig),
        withTiming(3, moveConfig),
        withTiming(3, pauseConfig)
      ),
      -1,
      false
    );

    // If no real progress is provided, fake a slow load that asymptotes around 85%
    if (barProgress === undefined) {
      fakeProgress.value = withTiming(0.85, { duration: 4000, easing: Easing.out(Easing.cubic) });
    }
  }, [barProgress, fakeProgress, progress]);

  const firstRectStyle = useRectAnimatedStyle(progress, 0);
  const secondRectStyle = useRectAnimatedStyle(progress, 1);
  const thirdRectStyle = useRectAnimatedStyle(progress, 2);

  const barStyle = useAnimatedStyle(() => {
    const currentProgress = barProgress !== undefined ? barProgress : fakeProgress.value;
    const widthPercent = interpolate(currentProgress, [0, 1], [0, 100]);
    return {
      width: `${widthPercent}%`,
    };
  });

  if (!enableCustomLoader || reducedMotion) {
    return (
      <View style={styles.wrapper}>
        {text && <Text style={[styles.loaderText, { color: colors.text }]}>{text}</Text>}
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.wrapper}>
      {text && (
        <Text style={[styles.loaderText, { color: colors.text }]}>{text}</Text>
      )}
      <View style={styles.container}>
        {/* Offsets inside the array are 0, 1, 2 so they start at different phases */}
        <Animated.View style={[styles.rect, styles.rect1, firstRectStyle]} />
        <Animated.View style={[styles.rect, styles.rect2, secondRectStyle]} />
        <Animated.View style={[styles.rect, styles.rect3, thirdRectStyle]} />
      </View>
      <View style={styles.barContainer}>
        <Animated.View style={[styles.barFill, barStyle, { backgroundColor: colors.primary }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  loaderText: {
    fontSize: typography.base,
    fontWeight: 'bold',
    marginBottom: spacing[5],
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  container: {
    width: 100,
    height: 100,
    justifyContent: 'center',
    alignItems: 'center',
  },
  barContainer: {
    marginTop: spacing[5],
    width: 80,
    height: 6,
    backgroundColor: 'rgba(0,0,0,0.1)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 3,
  },
  rect: {
    position: 'absolute',
    width: 80, // Sideways (width > height)
    height: 48,
    borderRadius: 8,
    borderWidth: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 8,
  },
  rect1: {
    backgroundColor: 'rgba(128, 0, 0, 0.9)', // Maroon
    borderColor: '#FFD700', // Gold outline
  },
  rect2: {
    backgroundColor: 'rgba(0, 0, 128, 0.9)', // Navy Blue
    borderColor: '#FFD700',
  },
  rect3: {
    backgroundColor: 'rgba(75, 0, 130, 0.9)', // Royal Purple
    borderColor: '#FFD700',
  },
});
