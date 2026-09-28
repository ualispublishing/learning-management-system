/**
 * @fileoverview src/components/ui/InterleaveSelector.tsx.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { Deck } from '../../types'; // assume it exists in types
import { useThemeColors } from '../../lib/useThemeColors';
import { typography, spacing } from '../../lib/theme';

interface InterleaveSelectorProps {
  decks: Deck[];
  onStartSession: (selectedDeckIds: string[]) => void;
  onCancel: () => void;
}

export function InterleaveSelector({ decks, onStartSession, onCancel }: InterleaveSelectorProps) {
  const colors = useThemeColors();
  const [selectedDeckIds, setSelectedDeckIds] = useState<Set<string>>(new Set());

  const toggleDeck = (id: string) => {
    const newSet = new Set(selectedDeckIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedDeckIds(newSet);
  };

  const toggleAll = () => {
    if (selectedDeckIds.size === decks.length) {
      setSelectedDeckIds(new Set());
    } else {
      setSelectedDeckIds(new Set(decks.map(d => d.id)));
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background, borderColor: colors.border }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>Mixed Study Session</Text>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Select decks to interleave</Text>

      <Pressable
        style={styles.toggleAllBtn}
        onPress={toggleAll}
        disabled={decks.length === 0}
        accessibilityRole="button"
        accessibilityLabel={selectedDeckIds.size === decks.length && decks.length > 0 ? 'Deselect all decks' : 'Select all decks'}
        accessibilityState={{ disabled: decks.length === 0 }}
      >
        <Text style={[styles.toggleAllText, { color: colors.primary }]}> 
          {selectedDeckIds.size === decks.length && decks.length > 0 ? 'Deselect All' : 'Select All'}
        </Text>
      </Pressable>

      <ScrollView keyboardShouldPersistTaps="handled" style={styles.list} contentContainerStyle={styles.listContent}>
        {decks.length === 0 && <Text style={{ color: colors.textSecondary }}>No decks are available for a mixed session.</Text>}
        {decks.map(deck => {
          const isSelected = selectedDeckIds.has(deck.id);
          return (
            <Pressable 
              key={deck.id} 
              style={[styles.deckItem, { backgroundColor: colors.card }, isSelected && [styles.deckItemSelected, { borderColor: colors.primary, backgroundColor: colors.secondary }]]}
              onPress={() => toggleDeck(deck.id)}
              accessibilityRole="checkbox"
              accessibilityLabel={deck.name}
              accessibilityState={{ checked: isSelected }}
            >
              <View style={[styles.checkbox, { borderColor: colors.border }, isSelected && [styles.checkboxSelected, { borderColor: colors.primary }]]}>
                {isSelected && <View style={[styles.checkboxInner, { backgroundColor: colors.primary }]} />}
              </View>
              <Text style={[styles.deckName, { color: isSelected ? colors.onSecondary : colors.text }]}>{deck.name}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.actions}>
        <Pressable accessibilityRole="button" style={styles.cancelBtn} onPress={onCancel}>
          <Text style={[styles.cancelText, { color: colors.textSecondary }]}>Cancel</Text>
        </Pressable>
        <Pressable 
          style={[styles.startBtn, { backgroundColor: colors.primary }, selectedDeckIds.size === 0 && [styles.startBtnDisabled, { backgroundColor: colors.border }]]}
          onPress={() => selectedDeckIds.size > 0 && onStartSession(Array.from(selectedDeckIds))}
          disabled={selectedDeckIds.size === 0}
          accessibilityRole="button"
          accessibilityState={{ disabled: selectedDeckIds.size === 0 }}
        >
          <Text style={[styles.startText, { color: selectedDeckIds.size > 0 ? colors.buttonText : colors.textSecondary }]}>Start ({selectedDeckIds.size})</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    padding: spacing[5],
    width: '100%',
    maxHeight: '80%',
    borderWidth: 1,
  },
  title: {
    fontSize: typography.xl,
    fontWeight: 'bold',
    marginBottom: spacing[1],
  },
  subtitle: {
    fontSize: typography.sm,
    marginBottom: spacing[4],
  },
  toggleAllBtn: {
    alignSelf: 'flex-start',
    marginBottom: spacing[3],
    minHeight: 44,
    justifyContent: 'center',
  },
  toggleAllText: {
    fontSize: typography.sm,
    fontWeight: '500',
  },
  list: {
    maxHeight: 300,
    marginBottom: spacing[5],
  },
  listContent: {
    gap: spacing[2],
  },
  deckItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing[3],
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
    minHeight: 44,
  },
  deckItemSelected: {
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    marginRight: spacing[3],
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxSelected: {
  },
  checkboxInner: {
    width: 10,
    height: 10,
    borderRadius: 2,
  },
  deckName: {
    fontSize: typography.base,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing[3],
  },
  cancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: spacing[4],
    minHeight: 44,
    justifyContent: 'center',
  },
  cancelText: {
    fontSize: typography.base,
    fontWeight: '600',
  },
  startBtn: {
    paddingVertical: 10,
    paddingHorizontal: spacing[5],
    borderRadius: 8,
    minHeight: 44,
    justifyContent: 'center',
  },
  startBtnDisabled: {
  },
  startText: {
    fontSize: typography.base,
    fontWeight: 'bold',
  },
});
