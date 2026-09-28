/**
 * @fileoverview src/app/deck/[deckId]/edit.tsx.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, Text, Pressable } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { RectLoader } from '../../../components/ui/RectLoader';
import DeckEditor from '../../../components/editor/DeckEditor';
import ImportExport from '../../../components/editor/ImportExport';
import { DeckStore } from '../../../lib/db/store';
import { Deck } from '../../../types';
import { useThemeColors } from '../../../lib/useThemeColors';
import { typography, spacing } from '../../../lib/theme';
import { BackButton } from '../../../components/ui/BackButton';

export default function EditDeckScreen() {
  const params = useLocalSearchParams<{ deckId?: string | string[] }>();
  const deckId = (Array.isArray(params.deckId)
    ? params.deckId.length === 1 ? params.deckId[0] : undefined
    : params.deckId) || '';
  const [deck, setDeck] = useState<Deck | null>(null);
  const [loading, setLoading] = useState(Boolean(deckId));
  const [loadError, setLoadError] = useState<string | null>(null);
  const colors = useThemeColors();

  const loadDeck = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const loadedDeck = await DeckStore.getById(deckId);
      setDeck(loadedDeck);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Deck settings could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [deckId]);

  useEffect(() => {
    if (!deckId) return;
    const timer = setTimeout(() => void loadDeck(), 0);
    return () => clearTimeout(timer);
  }, [deckId, loadDeck]);

  if (loading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <RectLoader text="Loading deck settings..." />
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}> 
        <Text accessibilityRole="alert" style={[styles.errorText, { color: colors.error, textAlign: 'center' }]}>{loadError}</Text>
        <Pressable accessibilityRole="button" onPress={() => void loadDeck()} style={{ marginTop: spacing[4], padding: spacing[3], backgroundColor: colors.primary, borderRadius: 8 }}>
          <Text style={{ color: colors.buttonText, fontWeight: 'bold' }}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (!deck) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}> 
        <Text accessibilityRole="alert" style={[styles.errorText, { color: colors.error, marginBottom: spacing[4] }]}>Deck not found.</Text>
        <BackButton />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <DeckEditor initialDeck={deck || undefined} />
      <View style={styles.importExportWrapper}>
        <ImportExport deckId={deckId} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    fontSize: typography.lg,
  },
  importExportWrapper: {
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[8],
  },
});
