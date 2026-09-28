/**
 * @fileoverview src/components/ui/ProficiencyKnob.tsx.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import React, { useEffect } from 'react';
import { View, StyleSheet, Pressable, Text, useWindowDimensions, Platform } from 'react-native';
import { useThemeColors } from '../../lib/useThemeColors';
import { typography, spacing } from '../../lib/theme';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  runOnJS,
  interpolateColor,
} from 'react-native-reanimated';
import Svg, { Path, Circle } from 'react-native-svg';
import { useSettingsStore } from '../../lib/store/useSettingsStore';
import i18n from '../../lib/i18n';

const THUMB_RADIUS = 22;

interface ProficiencyKnobProps {
  value: number; // 0-100
  onChange: (value: number) => void;
  onRelease: (value: number) => void;
}

const detents = [15, 40, 70, 100];
const SNAP_DISTANCE = 3;

export function ProficiencyKnob({ value, onChange, onRelease }: ProficiencyKnobProps) {
  const colors = useThemeColors();
  const { simpleControls } = useSettingsStore();
  const { width } = useWindowDimensions();
  const knobWidth = Math.min(Math.max(width - 40, THUMB_RADIUS * 4), 400);
  const knobRadius = knobWidth / 2;
  const knobHeight = knobRadius + 20;
  const isInteracting = useSharedValue(false);
  const rawValue = useSharedValue(value);

  // Update shared value when prop changes, but not while interacting
  useEffect(() => {
    if (!isInteracting.value) {
      rawValue.value = value;
    }
  }, [value, isInteracting, rawValue]);

  /* eslint-disable react-hooks/immutability -- Reanimated shared values are intentionally mutated inside UI-thread worklets. */
  const panGesture = Gesture.Pan()
    .onBegin(() => {
      isInteracting.value = true;
    })
    .onUpdate((e) => {
      // e.x, e.y relative to the gesture view which we'll make cover the semi-circle
      const dx = e.x - knobRadius;
      const dy = e.y - knobRadius; // assuming origin of semi-circle is at bottom center of the area
      
      let angle = Math.atan2(dy, dx);
      // Math.atan2 returns angle from -pi to pi. We want only -pi to 0.
      // If y > 0 (below the center line), we clamp it.
      if (angle > 0) {
        if (angle < Math.PI / 2) angle = 0;
        else angle = -Math.PI;
      }
      
      // Map angle (-pi to 0) to 0-100
      let val = (1 + angle / Math.PI) * 100;
      val = Math.max(0, Math.min(100, val));
      
      // Magnetic detents
      for (const d of detents) {
        if (Math.abs(val - d) < SNAP_DISTANCE) {
          val = d;
          break;
        }
      }
      
      rawValue.value = val;
    })
    .onEnd(() => {
      isInteracting.value = false;
      runOnJS(onChange)(rawValue.value);
      runOnJS(onRelease)(rawValue.value);
    })
    .onFinalize(() => {
      isInteracting.value = false;
    });

  const tapGesture = Gesture.Tap()
    .onEnd((e) => {
      const dx = e.x - knobRadius;
      const dy = e.y - knobRadius;
      let angle = Math.atan2(dy, dx);
      if (angle > 0) {
        if (angle < Math.PI / 2) angle = 0;
        else angle = -Math.PI;
      }
      let val = (1 + angle / Math.PI) * 100;
      val = Math.max(0, Math.min(100, val));
      for (const d of detents) {
        if (Math.abs(val - d) < SNAP_DISTANCE) {
          val = d;
          break;
        }
      }
      rawValue.value = val;
      runOnJS(onChange)(val);
      runOnJS(onRelease)(val);
    });

  const composedGesture = Gesture.Exclusive(panGesture, tapGesture);
  /* eslint-enable react-hooks/immutability */

  const animatedThumbStyle = useAnimatedStyle(() => {
    const angle = (rawValue.value / 100 - 1) * Math.PI;
    const x = knobRadius + Math.cos(angle) * (knobRadius - THUMB_RADIUS) - THUMB_RADIUS;
    const y = knobRadius + Math.sin(angle) * (knobRadius - THUMB_RADIUS) - THUMB_RADIUS;
    
    const color = interpolateColor(
      rawValue.value,
      [0, 25, 50, 75, 100],
      [
        'hsl(0, 85%, 55%)',
        'hsl(30, 90%, 55%)',
        'hsl(50, 90%, 55%)',
        'hsl(120, 70%, 45%)',
        'hsl(210, 80%, 55%)'
      ]
    );

    return {
      transform: [{ translateX: x }, { translateY: y }],
      backgroundColor: color,
    };
  });

  // Arc path
  const r = knobRadius - THUMB_RADIUS;
  const cx = knobRadius;
  const cy = knobRadius;
  const pathData = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;

  if (simpleControls) {
    return (
      <View style={[styles.container, { flexDirection: 'row', gap: 12, paddingHorizontal: spacing[4] }]}>
        <Pressable 
          style={[styles.simpleBtn, { backgroundColor: '#B91C1C' }]} 
          onPress={() => onRelease(15)}
          accessibilityRole="button"
          accessibilityLabel="Rate Again"
        >
          <Text style={styles.simpleBtnText}>{i18n.t('rateAgain')}</Text>
        </Pressable>
        <Pressable 
          style={[styles.simpleBtn, { backgroundColor: '#9A3412' }]} 
          onPress={() => onRelease(40)}
          accessibilityRole="button"
          accessibilityLabel="Rate Hard"
        >
          <Text style={styles.simpleBtnText}>{i18n.t('rateHard')}</Text>
        </Pressable>
        <Pressable 
          style={[styles.simpleBtn, { backgroundColor: '#166534' }]} 
          onPress={() => onRelease(70)}
          accessibilityRole="button"
          accessibilityLabel="Rate Good"
        >
          <Text style={styles.simpleBtnText}>{i18n.t('rateGood')}</Text>
        </Pressable>
        <Pressable 
          style={[styles.simpleBtn, { backgroundColor: '#1D4ED8' }]} 
          onPress={() => onRelease(100)}
          accessibilityRole="button"
          accessibilityLabel="Rate Easy"
        >
          <Text style={styles.simpleBtnText}>{i18n.t('rateEasy')}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Svg
        width={knobWidth}
        height={knobHeight}
        {...(Platform.OS === 'web'
          ? ({ 'aria-hidden': true } as object)
          : { accessible: false, accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const })}
      >
        <Path d={pathData} stroke={colors.primary} strokeWidth={4} fill="none" opacity={0.3} />
        {/* Detent markers */}
        {detents.map((d) => {
          const angle = (d / 100 - 1) * Math.PI;
          const markerX = cx + Math.cos(angle) * r;
          const markerY = cy + Math.sin(angle) * r;
          return (
            <Circle key={d} cx={markerX} cy={markerY} r={4} fill={colors.primary} opacity={0.5} />
          );
        })}
      </Svg>
      
      {/* Dynamic Text Value */}
      <View style={[styles.valueContainer, { pointerEvents: 'none' as any }]}>
        <Text style={[styles.valueText, { color: colors.text }]}>
          {Math.round(value)}
        </Text>
      </View>

      <GestureDetector gesture={composedGesture}>
        <Animated.View
          style={[styles.gestureArea, { width: knobWidth, height: knobHeight }]}
          {...(Platform.OS === 'web' ? ({
            'aria-valuemin': 0,
            'aria-valuemax': 100,
            'aria-valuenow': Math.round(value),
            'aria-valuetext': `${Math.round(value)} out of 100`,
            tabIndex: 0,
            onKeyDown: (event: { key?: string; nativeEvent?: { key?: string }; preventDefault?: () => void }) => {
              const key = event.key ?? event.nativeEvent?.key;
              if (key === 'Enter' || key === ' ') {
                event.preventDefault?.();
                onRelease(value);
                return;
              }
              const nextValue = key === 'Home'
                ? 0
                : key === 'End'
                  ? 100
                  : key === 'ArrowLeft' || key === 'ArrowDown'
                    ? Math.max(0, value - 5)
                    : key === 'ArrowRight' || key === 'ArrowUp'
                      ? Math.min(100, value + 5)
                      : null;
              if (nextValue === null) return;
              event.preventDefault?.();
              onChange(nextValue);
            },
          } as object) : {})}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Card proficiency rating"
          accessibilityHint="Adjust the value, then activate to submit the rating"
          accessibilityValue={{ min: 0, max: 100, now: Math.round(value), text: `${Math.round(value)} out of 100` }}
          accessibilityActions={[
            { name: 'increment', label: 'Increase rating' },
            { name: 'decrement', label: 'Decrease rating' },
            { name: 'activate', label: 'Submit rating' },
          ]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'activate') {
              onRelease(value);
              return;
            }
            const delta = event.nativeEvent.actionName === 'increment' ? 5 : event.nativeEvent.actionName === 'decrement' ? -5 : 0;
            if (!delta) return;
            const nextValue = Math.max(0, Math.min(100, value + delta));
            onChange(nextValue);
          }}
        >
          <Animated.View style={[styles.thumb, animatedThumbStyle, { borderColor: colors.card, shadowColor: colors.text }]} />
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  valueContainer: {
    position: 'absolute',
    bottom: spacing[5],
    alignItems: 'center',
    justifyContent: 'center',
  },
  valueText: {
    fontSize: 42,
    fontWeight: '900',
  },
  gestureArea: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  thumb: {
    position: 'absolute',
    width: THUMB_RADIUS * 2,
    height: THUMB_RADIUS * 2,
    borderRadius: THUMB_RADIUS,
    borderWidth: 3,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 8,
  },
  simpleBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  simpleBtnText: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: typography.sm,
  }
});
