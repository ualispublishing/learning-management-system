/**
 * @fileoverview src/components/ui/BackButton.tsx.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import React from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useThemeColors } from '../../lib/useThemeColors';
import { typography, spacing } from '../../lib/theme';

export function BackButton() {
  const router = useRouter();
  const colors = useThemeColors();

  return (
    <Pressable 
      style={[styles.button, { backgroundColor: colors.buttonBackground }]} 
      onPress={() => {
        if (router.canGoBack()) {
          router.back();
        } else {
          router.replace('/');
        }
      }}
      accessibilityLabel="Go back"
      accessibilityRole="button"
    >
      <Text style={[styles.text, { color: colors.buttonText }]}>← Back</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: 8,
    alignSelf: 'flex-start',
    marginBottom: spacing[2],
  },
  text: {
    fontSize: typography.base,
    fontWeight: '600',
  },
});
