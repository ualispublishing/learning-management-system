/**
 * @fileoverview src/app/deck/new.tsx.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter, Stack } from 'expo-router';
import DeckEditor from '../../components/editor/DeckEditor';
import { useThemeColors } from '../../lib/useThemeColors';

export default function NewDeckScreen() {
  const router = useRouter();
  const colors = useThemeColors();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false, headerLeft: () => null, headerBackVisible: false }} />
      <DeckEditor onSave={() => router.replace('/')} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
