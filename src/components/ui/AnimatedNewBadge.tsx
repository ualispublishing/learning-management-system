/**
 * @fileoverview src/components/ui/AnimatedNewBadge.tsx.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import React, { useEffect } from 'react';
import { Text, StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useThemeColors } from '../../lib/useThemeColors';
import { useSettingsStore } from '../../lib/store/useSettingsStore';

export function AnimatedNewBadge({ count }: { count?: number }) {
  const colors = useThemeColors();
  const translateY = useSharedValue(0);
  const { reducedMotion } = useSettingsStore();

  useEffect(() => {
    cancelAnimation(translateY);
    translateY.value = 0;
    if (!count || count <= 0 || reducedMotion) return undefined;

    translateY.value = withRepeat(
      withTiming(-12, { duration: 2500, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );

    return () => {
      cancelAnimation(translateY);
      translateY.value = 0;
    };
  }, [count, reducedMotion, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  if (!count || count <= 0) return null;

  return (
    <View
      style={styles.wrapper}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${count} cards have not been reviewed yet`}
    >
      <Animated.View style={animatedStyle}>
        <Text accessible={false} style={[styles.text, { color: colors.warning, textShadowColor: colors.accent }]}>!</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 40,
    height: 48,
  },
  text: {
    fontWeight: '900',
    fontSize: 44,
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
});
