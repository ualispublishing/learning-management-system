/**
 * @fileoverview src/app/review/index.tsx.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, SafeAreaView } from 'react-native';
import { useRouter } from 'expo-router';
import { CardStore } from '../../lib/db/store';
import { Card, Note } from '../../types';
import { useThemeColors } from '../../lib/useThemeColors';
import { typography, spacing } from '../../lib/theme';
import { BackButton } from '../../components/ui/BackButton';
import i18n from '../../lib/i18n';

interface DueCardGroup {
  id: string;
  title: string;
  description: string;
  cards: { card: Card; note: Note }[];
}

export default function ReviewHub() {
  const router = useRouter();
  const colors = useThemeColors();
  const [groups, setGroups] = useState<DueCardGroup[]>([]);
  const [totalDue, setTotalDue] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadGenerationRef = useRef(0);

  const loadDueCards = useCallback(async () => {
    const generation = ++loadGenerationRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const [dueCards, dueCount] = await Promise.all([
        CardStore.getAllDueCardsWithNotes(1000),
        CardStore.getDueCardCount(),
      ]);
      if (generation !== loadGenerationRef.current) return;
      setTotalDue(dueCount);

      const now = Date.now();
      const overdue: { card: Card; note: Note }[] = [];
      const dueToday: { card: Card; note: Note }[] = [];
      const lowRetrievability: { card: Card; note: Note }[] = [];

      dueCards.forEach(item => {
        if (item.card.retrievability < 0.5 && item.card.state > 0) lowRetrievability.push(item);
        else if (item.card.due < now - 24 * 60 * 60 * 1000) overdue.push(item);
        else dueToday.push(item);
      });

      const newGroups: DueCardGroup[] = [];
      if (overdue.length > 0) newGroups.push({
        id: 'overdue',
        title: 'Overdue',
        description: 'Cards you missed from previous days.',
        cards: overdue
      });
      if (lowRetrievability.length > 0) newGroups.push({
        id: 'low_retrievability',
        title: 'Needs Work',
        description: 'Retrievability < 50%. High chance of forgetting.',
        cards: lowRetrievability
      });
      if (dueToday.length > 0) newGroups.push({
        id: 'due_today',
        title: 'Due Today',
        description: 'Scheduled for review today.',
        cards: dueToday
      });
      setGroups(newGroups);
    } catch (error) {
      if (generation === loadGenerationRef.current) {
        setGroups([]);
        setTotalDue(0);
        setLoadError(error instanceof Error ? error.message : 'Due cards could not be loaded.');
      }
    } finally {
      if (generation === loadGenerationRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void loadDueCards(), 0);
    return () => {
      clearTimeout(timer);
      loadGenerationRef.current += 1;
    };
  }, [loadDueCards]);

  const handleStartReview = (groupId: string) => {
    // We can route to a study session. The study session needs to know which group to study.
    // For now, we can route to study/all and pass a type param.
    router.push({ pathname: '/study/all', params: { group: groupId } });
  };

  const handleInterleaveAll = () => {
    router.push({ pathname: '/study/all', params: { group: 'all' } });
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <BackButton />
          <Text accessibilityRole="header" style={[styles.headerTitle, { color: colors.text }]}>{i18n.t('reviewHub')}</Text>
          <View style={{ width: 44 }} />
        </View>

        <View style={[styles.summaryContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text accessibilityLiveRegion="polite" style={[styles.summaryTitle, { color: colors.primary }]}>Total Due: {totalDue}</Text>
          <Text style={[styles.summarySub, { color: colors.textSecondary }]}>Across all decks</Text>
          {totalDue > 1000 && <Text style={[styles.summarySub, { color: colors.textSecondary }]}>The next 1,000 cards are shown per session.</Text>}
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: loading || totalDue === 0 }} disabled={loading || totalDue === 0} style={[styles.interleaveBtn, { backgroundColor: colors.primary, opacity: loading || totalDue === 0 ? 0.5 : 1 }]} onPress={handleInterleaveAll}>
            <Text style={[styles.interleaveBtnText, { color: colors.buttonText }]}>Start Interleaved Session</Text>
          </Pressable>
        </View>

        <FlatList keyboardShouldPersistTaps="handled"
          data={groups}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <View style={[styles.groupCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.groupHeader}>
                <Text accessibilityRole="header" style={[styles.groupTitle, { color: colors.text }]}>{item.title}</Text>
                <View style={[styles.badge, { backgroundColor: colors.background }]}>
                  <Text style={[styles.badgeText, { color: colors.text }]}>{item.cards.length}</Text>
                </View>
              </View>
              <Text style={[styles.groupDesc, { color: colors.textSecondary }]}>{item.description}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={`Study ${item.cards.length} cards in ${item.title}`} style={[styles.studyBtn, { backgroundColor: colors.background }]} onPress={() => handleStartReview(item.id)}>
                <Text style={[styles.studyBtnText, { color: colors.text }]}>Study {item.cards.length} Cards</Text>
              </Pressable>
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text accessibilityRole={loadError ? 'alert' : undefined} style={[styles.emptyText, { color: loadError ? colors.error : colors.textSecondary }]}>
                {loading ? 'Loading due cards…' : loadError || i18n.t('emptyReviewTitle')}
              </Text>
              {loadError && (
                <Pressable accessibilityRole="button" style={[styles.retryButton, { backgroundColor: colors.primary }]} onPress={() => void loadDueCards()}>
                  <Text style={{ color: colors.buttonText, fontWeight: '600' }}>Retry</Text>
                </Pressable>
              )}
            </View>
          }
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
    paddingHorizontal: spacing[5],
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[3],
  },
  headerTitle: {
    fontSize: typography.xl,
    fontWeight: 'bold',
  },
  summaryContainer: {
    padding: spacing[5],
    borderRadius: 12,
    marginBottom: spacing[5],
    borderWidth: 1,
    alignItems: 'center',
  },
  summaryTitle: {
    fontSize: typography['2xl'],
    fontWeight: 'bold',
    marginBottom: spacing[1],
  },
  summarySub: {
    fontSize: typography.sm,
    marginBottom: spacing[4],
  },
  interleaveBtn: {
    paddingVertical: 12,
    paddingHorizontal: spacing[6],
    borderRadius: 8,
    width: '100%',
    alignItems: 'center',
  },
  interleaveBtnText: {
    fontSize: typography.base,
    fontWeight: '600',
  },
  listContent: {
    paddingBottom: 40,
  },
  groupCard: {
    padding: spacing[4],
    borderRadius: 12,
    marginBottom: spacing[4],
    borderWidth: 1,
  },
  groupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing[2],
  },
  groupTitle: {
    fontSize: typography.lg,
    fontWeight: '600',
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: spacing[1],
    borderRadius: 12,
  },
  badgeText: {
    fontSize: typography.sm,
    fontWeight: 'bold',
  },
  groupDesc: {
    fontSize: typography.sm,
    marginBottom: spacing[4],
  },
  studyBtn: {
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  studyBtnText: {
    fontSize: typography.sm,
    fontWeight: '500',
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: typography.base,
  },
  retryButton: {
    marginTop: spacing[3],
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[3],
    borderRadius: 8,
  },
});
