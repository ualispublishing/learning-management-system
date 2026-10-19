/**
 * @fileoverview src/components/lms/CourseFlashcardPlayer.tsx.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { CourseStudyCardBody, CourseStudyNavigation } from './CourseStudyCardView';
import { AIGenerationAttribution } from './AIGenerationAttribution';
import { ContentItem } from '../../types/lms';
import { useThemeColors } from '../../lib/useThemeColors';
import { Deck } from '../../types';
import { DeckStore, EditorStore } from '../../lib/db/store';
import { getFlashcardPrincipalId } from '../../lib/db/principal';
import { createEntityId } from '../../lib/id';
import { useLMSStore } from '../../lib/store/useLMSStore';
import { getLearningStateService, recordConsentedLearningActivity } from '../../lib/learningState';

export const CourseFlashcardPlayer = ({ item, onClose, previewMode = false }: { item: ContentItem; onClose: () => void; previewMode?: boolean }) => {
  const colors = useThemeColors();
  const rawAI = item.metadata?.ai;
  const savedAI = rawAI && typeof rawAI === 'object' && !Array.isArray(rawAI) ? rawAI as Record<string, unknown> : undefined;
  const currentUserId = useLMSStore(state => state.currentUserId);
  const cards = useMemo(() => item.studyCards || [], [item.studyCards]);
  const cardIds = useMemo(() => cards.map(card => card.id), [cards]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [masteredIds, setMasteredIds] = useState<Set<string>>(() => new Set());
  const [isSavingDeck, setIsSavingDeck] = useState(false);
  const deckSaveOperationRef = useRef(false);
  const [deckSaveStatus, setDeckSaveStatus] = useState<string | null>(null);
  const [deckSaveError, setDeckSaveError] = useState<string | null>(null);
  const [resumeStateError, setResumeStateError] = useState<string | null>(null);
  const [resumeStateReady, setResumeStateReady] = useState(false);

  /* A new study-set scope must not display state from the prior set while hydration runs. */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    let cancelled = false;
    setIndex(0);
    setRevealed(false);
    setMasteredIds(new Set());
    setResumeStateError(null);
    setResumeStateReady(false);
    if (previewMode || !currentUserId || !cardIds.length) {
      setResumeStateReady(true);
      return () => { cancelled = true; };
    }
    const scope = { principalId: currentUserId, courseId: item.courseId, contentItemId: item.id };
    void getLearningStateService().load(scope, 'course-study-set').then(record => {
      if (cancelled) return;
      if (record) {
        const restoredIndex = record.payload.cardId ? cardIds.indexOf(record.payload.cardId) : -1;
        if (restoredIndex >= 0) setIndex(restoredIndex);
        setRevealed(record.payload.revealed);
        const validIds = new Set(cardIds);
        setMasteredIds(new Set(record.payload.masteredIds.filter(id => validIds.has(id))));
        void recordConsentedLearningActivity({
          type: 'study-set-resumed',
          scope,
          occurredAt: Date.now(),
          source: 'lms-ui',
        }).catch(() => undefined);
      }
      setResumeStateReady(true);
    }).catch(error => {
      if (cancelled) return;
      setResumeStateError(error instanceof Error ? error.message : 'Saved study-set position could not be restored.');
      setResumeStateReady(true);
    });
    return () => { cancelled = true; };
  }, [cardIds, currentUserId, item.courseId, item.id, previewMode]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!resumeStateReady || previewMode || !currentUserId || !cards.length) return;
    const timer = setTimeout(() => {
      void getLearningStateService().save(
        { principalId: currentUserId, courseId: item.courseId, contentItemId: item.id },
        'course-study-set',
        { cardId: cards[index]?.id, revealed, masteredIds: Array.from(masteredIds) },
      ).then(() => setResumeStateError(null)).catch(error => {
        setResumeStateError(error instanceof Error ? error.message : 'Study-set position could not be saved.');
      });
    }, 200);
    return () => clearTimeout(timer);
  }, [cards, currentUserId, index, item.courseId, item.id, masteredIds, previewMode, resumeStateReady, revealed]);

  const card = cards[index];
  const moveTo = (nextIndex: number) => {
    setIndex(Math.max(0, Math.min(cards.length - 1, nextIndex)));
    setRevealed(false);
  };
  const markAndAdvance = (mastered: boolean) => {
    if (!card) return;
    setMasteredIds(previous => {
      const next = new Set(previous);
      if (mastered) next.add(card.id);
      else next.delete(card.id);
      return next;
    });
    if (index < cards.length - 1) moveTo(index + 1);
  };

  const saveAsPersonalDeck = async () => {
    if (deckSaveOperationRef.current || !cards.length) return;
    deckSaveOperationRef.current = true;
    setIsSavingDeck(true);
    setDeckSaveError(null);
    setDeckSaveStatus(null);
    let insertedDeckId: string | null = null;
    try {
      const decks = await DeckStore.getAll();
      const sourceDeck = decks.find(deck => deck.settings.lmsSourceContentItemId === item.id);
      if (sourceDeck) {
        const stats = await DeckStore.getDeckDetailedStats(sourceDeck.id);
        if (stats.totalCards > 0) {
          setDeckSaveStatus('Already saved to My Flashcards.');
          return;
        }
        // Repair an exact empty import left by an interrupted prior copy.
        await DeckStore.softDelete(sourceDeck.id);
      }

      const deck: Deck = {
        id: createEntityId('course_deck'),
        user_id: getFlashcardPrincipalId(),
        name: item.title,
        description: `Personal review copy of course study material: ${item.title}`,
        settings: {
          lmsSourceContentItemId: item.id,
          lmsCourseId: item.courseId,
        },
        position: decks.reduce((maximum, existing) => Math.max(maximum, existing.position), -1) + 1,
        completed_once: false,
        created_at: Date.now(),
      };
      await DeckStore.insert(deck);
      insertedDeckId = deck.id;
      await EditorStore.createCardsWithLayers(deck.id, cards.map(sourceCard => ({
        frontContent: sourceCard.front,
        layers: [
          sourceCard.back,
          ...((sourceCard.sourceExcerpt || sourceCard.sourceLocation) ? [
            [sourceCard.sourceExcerpt ? `Source: ${sourceCard.sourceExcerpt}` : '', sourceCard.sourceLocation || ''].filter(Boolean).join('\n'),
          ] : []),
        ],
        initialUnlockedLayers: 1,
        tags: sourceCard.tags,
      })));
      setDeckSaveStatus(`Saved ${cards.length} card${cards.length === 1 ? '' : 's'} to My Flashcards for spaced review.`);
    } catch (error) {
      if (insertedDeckId) {
        try {
          await DeckStore.softDelete(insertedDeckId);
        } catch {
          // A principal transition can make rollback inaccessible. The next
          // import repairs this exact empty source deck before retrying.
        }
      }
      setDeckSaveError(error instanceof Error ? error.message : 'The personal flashcard deck could not be created.');
    } finally {
      deckSaveOperationRef.current = false;
      setIsSavingDeck(false);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={isSavingDeck ? () => undefined : onClose}>
      <View style={styles.overlay}>
        <View style={[styles.container, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <View style={[styles.header, { borderBottomColor: colors.border }]}> 
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 20, fontWeight: 'bold' }}>{item.title}</Text>
              <Text style={{ color: colors.textSecondary, marginTop: 4 }}>{cards.length ? `Card ${index + 1} of ${cards.length} · ${masteredIds.size} marked understood` : 'No study cards'}</Text>
            </View>
            <TouchableOpacity disabled={isSavingDeck} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close flashcards" accessibilityState={{ disabled: isSavingDeck }} style={{ opacity: isSavingDeck ? 0.5 : 1 }}>
              <Ionicons name="close" size={26} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          {!!resumeStateError && (
            <Text accessibilityRole="alert" style={{ color: colors.error, paddingHorizontal: 20, paddingTop: 8 }}>
              {resumeStateError}
            </Text>
          )}

          {!card ? (
            <View style={styles.centered}>
              <Text style={{ color: colors.textSecondary }}>This study set has no cards.</Text>
            </View>
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
              <View style={[styles.personalDeckPanel, { backgroundColor: colors.card, borderColor: colors.border }]}> 
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={{ color: colors.text, fontWeight: 'bold' }}>Continue in My Flashcards</Text>
                  <Text style={{ color: colors.textSecondary, marginTop: 4, fontSize: 12 }}>Create a principal-scoped personal copy that uses the app’s spaced-review scheduler.</Text>
                  {!!deckSaveStatus && <Text accessibilityRole="alert" style={{ color: colors.primary, marginTop: 6 }}>{deckSaveStatus}</Text>}
                  {!!deckSaveError && <Text accessibilityRole="alert" style={{ color: colors.error, marginTop: 6 }}>{deckSaveError}</Text>}
                </View>
                <TouchableOpacity
                  disabled={isSavingDeck}
                  onPress={() => void saveAsPersonalDeck()}
                  accessibilityRole="button"
                  accessibilityLabel="Save course study set to My Flashcards"
                  accessibilityState={{ disabled: isSavingDeck }}
                  style={[styles.saveDeckButton, { backgroundColor: colors.primary, opacity: isSavingDeck ? 0.55 : 1 }]}
                >
                  <Text style={{ color: colors.buttonText, fontWeight: 'bold' }}>{isSavingDeck ? 'Saving…' : 'Save deck'}</Text>
                </TouchableOpacity>
              </View>
              <CourseStudyCardBody cards={cards} index={index} revealed={revealed} onToggleAnswer={() => setRevealed(value => !value)} onRate={markAndAdvance} />
              <View style={{ width: '100%', maxWidth: 720 }}>
                <AIGenerationAttribution provenance={savedAI?.provenance} sourceName={savedAI?.sourceFileName} />
              </View>
            </ScrollView>
          )}

          <CourseStudyNavigation cards={cards} index={index} onMove={moveTo} />
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  container: { height: '92%', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 20, borderBottomWidth: 1 },
  body: { flexGrow: 1, padding: 20, justifyContent: 'center', alignItems: 'center' },
  personalDeckPanel: { width: '100%', maxWidth: 720, borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 14, flexDirection: 'row', alignItems: 'center' },
  saveDeckButton: { borderRadius: 10, paddingHorizontal: 15, paddingVertical: 12 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 30 },
  card: { width: '100%', maxWidth: 720, minHeight: 330, borderWidth: 2, borderRadius: 18, padding: 28, justifyContent: 'center', alignItems: 'center' },
  evidence: { width: '100%', maxWidth: 720, borderWidth: 1, borderRadius: 12, padding: 14, marginTop: 14 },
  ratingRow: { width: '100%', maxWidth: 720, flexDirection: 'row', marginTop: 16 },
  ratingButton: { flex: 1, borderWidth: 1, borderRadius: 10, padding: 14, alignItems: 'center', marginHorizontal: 5 },
  footer: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, paddingHorizontal: 10, paddingVertical: 8 },
  progressTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: 'rgba(128,128,128,0.25)', overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },
});
