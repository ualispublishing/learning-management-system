/**
 * @fileoverview src/components/ui/TargetSelector.tsx.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, FlatList, ActivityIndicator } from 'react-native';
import { useSettingsStore } from '../../lib/store/useSettingsStore';
import { typography, spacing } from '../../lib/theme';
import { useThemeColors } from '../../lib/useThemeColors';
import i18n from '../../lib/i18n';
import { CardStore, DeckStore } from '../../lib/db/store';
import { Card, Note } from '../../types';
import { parseSessionLimit, parseStartPosition } from '../../lib/sessionTarget';
import { cardPlainText } from '../../lib/cardText';
import { DIAGNOSTIC_CONTEXTS, logDiagnosticError } from '../../lib/diagnosticLog';

export type SessionTarget = '5' | '10' | '20' | 'custom' | 'all';

interface TargetSelectorProps {
  onSelect: (target: SessionTarget | number, mode: 'learn' | 'study' | 'quiz', startPosition?: number) => void;
  deckId?: string;
}

export function TargetSelector({ onSelect, deckId }: TargetSelectorProps) {
  const colors = useThemeColors();
  const { lastQuizStartPositions, setLastQuizStartPosition, customTargets, setCustomTarget } = useSettingsStore();
  const [showCustom, setShowCustom] = useState(false);
  const [mode, setMode] = useState<'learn' | 'study' | 'quiz'>('study');
  const [customValInput, setCustomValInput] = useState('20');

  // Use saved start position if available
  const initialStartPos = (deckId && lastQuizStartPositions[deckId]) ? lastQuizStartPositions[deckId].toString() : '1';
  const [startPosition, setStartPosition] = useState(initialStartPos);

  const [showCardBrowser, setShowCardBrowser] = useState(false);
  const [browserCards, setBrowserCards] = useState<{card: Card, note: Note}[]>([]);
  const [loadingBrowser, setLoadingBrowser] = useState(false);
  const [browserPage, setBrowserPage] = useState(0);
  const [hasMoreCards, setHasMoreCards] = useState(true);
  const [totalCards, setTotalCards] = useState(0);
  const [browserError, setBrowserError] = useState<string | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [startPositionError, setStartPositionError] = useState<string | null>(null);
  const browserRequestRef = React.useRef(0);
  const parsedCustomLimit = parseSessionLimit(customValInput);

  // Fetch deck stats when the keyed selector opens for a deck.
  useEffect(() => {
    let active = true;
    if (deckId) {
      DeckStore.getDeckDetailedStats(deckId).then(stats => {
        if (active) {
          setStatsError(null);
          setTotalCards(stats.totalCards);
        }
      }).catch(error => {
        logDiagnosticError(DIAGNOSTIC_CONTEXTS.deckStatisticsLoad, error);
        if (active) setStatsError('Deck size could not be loaded.');
      });
    }
    return () => { active = false; };
  }, [deckId]);

  const loadMoreCards = async (reset = false) => {
    if (!deckId || (loadingBrowser && !reset) || (!hasMoreCards && !reset)) return;
    
    const request = ++browserRequestRef.current;
    setLoadingBrowser(true);
    setBrowserError(null);
    const page = reset ? 0 : browserPage;
    if (reset) {
      setBrowserCards([]);
      setBrowserPage(0);
      setHasMoreCards(true);
    }
    try {
      const results = await CardStore.getAllCardsForDeckWithNotes(deckId, 50, page * 50);
      if (request !== browserRequestRef.current) return;
      if (results.length < 50) setHasMoreCards(false);
      
      setBrowserCards(prev => reset ? results : [...prev, ...results]);
      setBrowserPage(page + 1);
    } catch (e) {
      logDiagnosticError(DIAGNOSTIC_CONTEXTS.deckCardsLoad, e);
      if (request === browserRequestRef.current) setBrowserError('Cards could not be loaded. Please retry.');
    } finally {
      if (request === browserRequestRef.current) setLoadingBrowser(false);
    }
  };

  const handleCardSelect = (card: Card, note: Note, index: number) => {
    const pos = index + 1; // 1-indexed
    setStartPosition(pos.toString());
    if (deckId) setLastQuizStartPosition(deckId, pos);
    setShowCardBrowser(false);
  };

  const startSession = (target: SessionTarget | number) => {
    const startPos = mode === 'study' ? 1 : parseStartPosition(startPosition, totalCards || undefined);
    if (startPos === null) {
      setStartPositionError(totalCards > 0
        ? `Enter a starting card from 1 to ${totalCards}.`
        : 'Enter a positive whole-number starting card.');
      return;
    }
    setStartPositionError(null);
    if (deckId && mode === 'quiz') setLastQuizStartPosition(deckId, startPos);
    onSelect(target, mode, startPos);
  };

  if (showCustom) {
    return (
      <View style={[styles.container, { backgroundColor: colors.card, shadowColor: colors.text }]}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{i18n.t('customLimit')}</Text>
        <TextInput
          accessibilityLabel="Custom card limit"
          style={[styles.customInput, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
          value={customValInput}
          onChangeText={(text) => {
            setCustomValInput(text.replace(/[^\d∞]/g, '').slice(0, 4));
          }}
          keyboardType="numeric"
          accessibilityHint="Enter a whole number from 1 to 1000"
          autoFocus
        />
        <Text style={[styles.validationHint, { color: parsedCustomLimit === null ? colors.error : colors.textSecondary }]} accessibilityLiveRegion="polite">
          {parsedCustomLimit === null ? 'Enter a whole number from 1 to 1000.' : parsedCustomLimit === 'all' ? 'All available cards' : `${parsedCustomLimit} cards`}
        </Text>
        <View style={styles.row}>
          <Pressable accessibilityRole="button" style={[styles.cancelBtn, { backgroundColor: colors.border }]} onPress={() => setShowCustom(false)}>
            <Text style={[styles.cancelBtnText, { color: colors.textSecondary }]}>{i18n.t('cancel')}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: parsedCustomLimit === null }} disabled={parsedCustomLimit === null} style={[styles.startBtn, { backgroundColor: colors.primary }, parsedCustomLimit === null && styles.disabled]} onPress={() => {
            if (parsedCustomLimit === null) return;
            setCustomTarget(mode, parsedCustomLimit === 'all' ? '∞' : String(parsedCustomLimit));
            startSession(parsedCustomLimit === 'all' ? 'all' : parsedCustomLimit);
          }}>
            <Text style={[styles.startBtnText, { color: colors.buttonText }]}>Start</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.card, shadowColor: colors.text }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>Choose your session goal</Text>
      {statsError && <Text accessibilityRole="alert" style={{ color: colors.error, textAlign: 'center', marginBottom: spacing[3] }}>{statsError}</Text>}
      
      <View style={styles.grid}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${mode === 'learn' ? 'Learn' : mode === 'quiz' ? 'Quiz' : 'Study'} 5 cards`} style={[styles.gridItem, { backgroundColor: colors.background, borderColor: colors.border }]} onPress={() => startSession('5')}>
          <Text style={[styles.itemTitle, { color: colors.text }]}>5</Text>
          <Text style={[styles.itemSub, { color: colors.textSecondary }]}>Cards</Text>
        </Pressable>
        
        <Pressable accessibilityRole="button" accessibilityLabel={`${mode === 'learn' ? 'Learn' : mode === 'quiz' ? 'Quiz' : 'Study'} 10 cards`} style={[styles.gridItem, { backgroundColor: colors.background, borderColor: colors.border }]} onPress={() => startSession('10')}>
          <Text style={[styles.itemTitle, { color: colors.text }]}>10</Text>
          <Text style={[styles.itemSub, { color: colors.textSecondary }]}>Cards</Text>
        </Pressable>
        
        <Pressable accessibilityRole="button" accessibilityLabel={`Study saved target of ${customTargets[mode] === '∞' ? 'all available' : customTargets[mode]} cards`} style={[styles.gridItem, { backgroundColor: colors.background, borderColor: colors.border }]} onPress={() => {
          const parsed = parseSessionLimit(customTargets[mode]);
          if (parsed === null) {
            setCustomValInput('20');
            setShowCustom(true);
            return;
          }
          startSession(parsed === 'all' ? 'all' : parsed);
        }}>
          <Text style={[styles.itemTitle, { color: colors.text }]}> 
            {customTargets[mode]}
          </Text>
          <Text style={[styles.itemSub, { color: colors.textSecondary }]}>Cards</Text>
        </Pressable>
        
        <Pressable accessibilityRole="button" accessibilityLabel="Set a custom card target" style={[styles.gridItem, { backgroundColor: colors.background, borderColor: colors.border }]} onPress={() => {
          setCustomValInput(customTargets[mode]);
          setShowCustom(true);
        }}>
          <Text style={[styles.itemTitle, { color: colors.text }]}>Custom</Text>
          <Text style={[styles.itemSub, { color: colors.textSecondary }]}>Cards</Text>
        </Pressable>
      </View>

      <View style={styles.modeSelectorContainer}>
        <Text style={[styles.modeSelectorTitle, { color: colors.text }]}>Mode</Text>
        <View style={styles.radioRow}>
          <Pressable 
            style={[styles.radioItem, { borderColor: colors.border }, mode === 'learn' && { borderColor: colors.primary, backgroundColor: 'rgba(29, 53, 87, 0.1)' }]} 
            onPress={() => { setMode('learn'); setStartPositionError(null); }}
            accessibilityRole="radio"
            accessibilityState={{ checked: mode === 'learn' }}
          >
            <Text style={[styles.radioText, { color: colors.text }, mode === 'learn' && { color: colors.primary, fontWeight: '800' }]}>Learn</Text>
          </Pressable>
          <Pressable 
            style={[styles.radioItem, { borderColor: colors.border }, mode === 'study' && { borderColor: colors.primary, backgroundColor: 'rgba(29, 53, 87, 0.1)' }]} 
            onPress={() => { setMode('study'); setStartPositionError(null); }}
            accessibilityRole="radio"
            accessibilityState={{ checked: mode === 'study' }}
          >
            <Text style={[styles.radioText, { color: colors.text }, mode === 'study' && { color: colors.primary, fontWeight: '800' }]}>Study</Text>
          </Pressable>
          <Pressable 
            style={[styles.radioItem, { borderColor: colors.border }, mode === 'quiz' && { borderColor: colors.primary, backgroundColor: 'rgba(29, 53, 87, 0.1)' }]} 
            onPress={() => { setMode('quiz'); setStartPositionError(null); }}
            accessibilityRole="radio"
            accessibilityState={{ checked: mode === 'quiz' }}
          >
            <Text style={[styles.radioText, { color: colors.text }, mode === 'quiz' && { color: colors.primary, fontWeight: '800' }]}>Quiz</Text>
          </Pressable>
        </View>

        <Text style={[styles.modeBlurb, { color: colors.textSecondary }]}>
          {mode === 'learn' && 'For casually viewing flashcards.'}
          {mode === 'study' && 'For adding a proficiency score to cards and utilizing spaced repetition.'}
          {mode === 'quiz' && 'Requires answering a flashcard.'}
        </Text>

        {(mode === 'quiz' || mode === 'learn') && (
          <View style={styles.startPosContainer}>
            <Text style={[styles.startPosLabel, { color: colors.text }]}>Start Position</Text>
            {mode === 'quiz' ? (
              <Pressable 
                style={[styles.startPosSelectBtn, { backgroundColor: colors.card, borderColor: colors.border }]} 
                onPress={() => {
                  loadMoreCards(true);
                  setShowCardBrowser(true);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Select starting card. Current selection: card ${startPosition}`}
              >
                <Text style={[styles.startPosSelectBtnText, { color: colors.primary }]}>
                  {startPosition ? `Card ${startPosition}` : 'Select Card'}
                </Text>
              </Pressable>
            ) : (
              <TextInput
                accessibilityLabel="Starting card position"
                style={[styles.startPosInput, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                value={startPosition}
                onChangeText={(value) => { setStartPosition(value.replace(/\D/g, '')); setStartPositionError(null); }}
                keyboardType="numeric"
              />
            )}
            {startPositionError && <Text accessibilityRole="alert" style={{ color: colors.error, marginTop: spacing[2] }}>{startPositionError}</Text>}
          </View>
        )}
      </View>
      
      <Pressable accessibilityRole="button" style={[styles.allButton, { backgroundColor: colors.buttonBackground }]} onPress={() => startSession('all')}>
        <Text style={[styles.allButtonText, { color: colors.buttonText }]}>{mode === 'learn' ? 'Learn' : mode === 'quiz' ? 'Quiz' : 'Study'} All Available</Text>
      </Pressable>

      {showCardBrowser && (
        <View accessibilityViewIsModal style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.background, padding: spacing[4], paddingTop: 60, zIndex: 1000, elevation: 1000 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing[4] }}>
            <Text accessibilityRole="header" style={{ fontSize: typography.xl, fontWeight: 'bold', color: colors.text }}>Select Start Position</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close card browser" onPress={() => setShowCardBrowser(false)} style={{ padding: spacing[2], minWidth: 44, minHeight: 44, justifyContent: 'center' }}>
              <Text style={{ color: colors.primary, fontWeight: 'bold' }}>Close</Text>
            </Pressable>
          </View>
          
          <FlatList keyboardShouldPersistTaps="handled"
            data={browserCards}
            keyExtractor={(item) => item.card.id}
            renderItem={({ item, index }) => (
              <Pressable 
                style={[
                  styles.browserCardItem, 
                  { backgroundColor: colors.card, borderColor: colors.border },
                  parseInt(startPosition, 10) === index + 1 && { borderColor: colors.primary, borderWidth: 2 }
                ]}
                onPress={() => handleCardSelect(item.card, item.note, index)}
                accessibilityRole="button"
                accessibilityLabel={`Start at card ${index + 1}: ${cardPlainText(item.note.field_values.front || item.note.field_values.Front || '')}`}
                accessibilityState={{ selected: parseInt(startPosition, 10) === index + 1 }}
              >
                <Text style={[styles.browserCardIndex, { color: colors.textSecondary }]}>#{index + 1}</Text>
                <View style={styles.browserCardContent}>
                  <Text numberOfLines={3} style={{ color: colors.text, fontSize: typography.base }}>
                    {cardPlainText(item.note.field_values.front || item.note.field_values.Front || '')}
                  </Text>
                </View>
              </Pressable>
            )}
            onEndReached={() => loadMoreCards(false)}
            onEndReachedThreshold={0.5}
            ListFooterComponent={() => loadingBrowser
              ? <ActivityIndicator style={{ padding: 20 }} color={colors.primary} />
              : browserError && browserCards.length > 0
                ? (
                    <Pressable accessibilityRole="button" onPress={() => void loadMoreCards(false)} style={{ alignSelf: 'center', padding: spacing[3] }}>
                      <Text accessibilityRole="alert" style={{ color: colors.error }}>{browserError} Tap to retry.</Text>
                    </Pressable>
                  )
                : null}
            ListEmptyComponent={() => !loadingBrowser ? (
              browserError ? (
                <View style={{ alignItems: 'center', marginTop: 40 }}>
                  <Text accessibilityRole="alert" style={{ textAlign: 'center', color: colors.error, marginBottom: spacing[3] }}>{browserError}</Text>
                  <Pressable accessibilityRole="button" onPress={() => void loadMoreCards(true)} style={{ backgroundColor: colors.primary, borderRadius: 8, paddingHorizontal: spacing[4], paddingVertical: spacing[2] }}>
                    <Text style={{ color: colors.buttonText, fontWeight: 'bold' }}>Retry</Text>
                  </Pressable>
                </View>
              ) : <Text style={{ textAlign: 'center', marginTop: 40, color: colors.textSecondary }}>No cards found in this deck.</Text>
            ) : null}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing[6],
    borderRadius: 20,
    width: '90%',
    maxWidth: 400,
    alignSelf: 'center',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 15,
    elevation: 8,
  },
  title: {
    fontSize: typography['2xl'],
    fontWeight: '800',
    marginBottom: spacing[6],
    textAlign: 'center',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[3],
    justifyContent: 'space-between',
    marginBottom: spacing[6],
  },
  gridItem: {
    width: '47%',
    padding: spacing[5],
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1,
  },
  itemTitle: {
    fontSize: typography['2xl'],
    fontWeight: '800',
    marginBottom: spacing[1],
  },
  itemSub: {
    fontSize: typography.sm,
    fontWeight: '600',
  },
  allButton: {
    padding: spacing[4],
    borderRadius: 16,
    alignItems: 'center',
  },
  allButtonText: {
    fontSize: typography.base,
    fontWeight: '800',
  },
  modeSelectorContainer: {
    marginBottom: spacing[5],
  },
  modeSelectorTitle: {
    fontSize: typography.base,
    fontWeight: '800',
    marginBottom: spacing[2],
  },
  radioRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing[2],
  },
  radioItem: {
    flex: 1,
    paddingVertical: spacing[3],
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
  },
  radioText: {
    fontSize: typography.sm,
    fontWeight: '600',
  },
  modeBlurb: {
    fontSize: typography.sm,
    marginTop: spacing[2],
    textAlign: 'center',
    fontStyle: 'italic',
  },
  startPosContainer: {
    marginTop: spacing[4],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  startPosLabel: {
    fontSize: typography.sm,
    fontWeight: '600',
  },
  startPosInput: {
    width: 100,
    padding: spacing[2],
    borderRadius: 8,
    borderWidth: 1,
    textAlign: 'center',
    fontSize: typography.base,
  },
  customInput: {
    fontSize: typography['3xl'],
    fontWeight: '800',
    textAlign: 'center',
    padding: spacing[5],
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: spacing[2],
  },
  validationHint: {
    fontSize: typography.sm,
    textAlign: 'center',
    marginBottom: spacing[5],
  },
  row: {
    flexDirection: 'row',
    gap: spacing[3],
  },
  cancelBtn: {
    flex: 1,
    padding: spacing[4],
    borderRadius: 16,
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: typography.base,
    fontWeight: '700',
  },
  startBtn: {
    flex: 1,
    padding: spacing[4],
    borderRadius: 16,
    alignItems: 'center',
  },
  startBtnText: {
    fontSize: typography.base,
    fontWeight: '700',
  },
  disabled: {
    opacity: 0.45,
  },
  startPosSelectBtn: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: 8,
    borderWidth: 1,
    minWidth: 100,
    alignItems: 'center',
  },
  startPosSelectBtnText: {
    fontSize: typography.base,
    fontWeight: '700',
  },
  browserCardItem: {
    flexDirection: 'row',
    padding: spacing[4],
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: spacing[3],
    alignItems: 'center',
  },
  browserCardIndex: {
    fontSize: typography.xl,
    fontWeight: '800',
    width: 50,
    marginRight: spacing[2],
  },
  browserCardContent: {
    flex: 1,
  },
});
