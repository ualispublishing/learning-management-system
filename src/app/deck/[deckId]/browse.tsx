/**
 * @fileoverview src/app/deck/[deckId]/browse.tsx.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, TextInput, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import DraggableFlatList, { ScaleDecorator } from 'react-native-draggable-flatlist';
import { RectLoader } from '../../../components/ui/RectLoader';
import { CardStore, DeckStore } from '../../../lib/db/store';
import { Card, Note, Deck, DepthLayer } from '../../../types';
import { useThemeColors } from '../../../lib/useThemeColors';
import { typography, spacing } from '../../../lib/theme';
import { BackButton } from '../../../components/ui/BackButton';
import { InlineCardEditor } from '../../../components/editor/InlineCardEditor';
import {
  buildCardPositionUpdates,
  filterBrowsableCards,
  listBrowsableCardTags,
  moveBrowsableCard,
  rollbackBrowsableCardOrder,
} from '../../../lib/flashcardLibrary';

const CARD_PAGE_SIZE = 500;

export default function CardBrowser() {
  const params = useLocalSearchParams<{ deckId?: string | string[] }>();
  const deckId = (Array.isArray(params.deckId)
    ? params.deckId.length === 1 ? params.deckId[0] : undefined
    : params.deckId) || '';
  const router = useRouter();
  const colors = useThemeColors();
  
  const [deck, setDeck] = useState<Deck | null>(null);
  const [cardsWithNotes, setCardsWithNotes] = useState<{card: Card & { tags?: string[] }, note: Note, layers: DepthLayer[]}[]>([]);
  const [loading, setLoading] = useState(Boolean(deckId));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [hasMoreCards, setHasMoreCards] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const isNavigating = useRef(false);
  const reorderInFlight = useRef(false);
  const loadMoreInFlight = useRef(false);
  const loadedCountRef = useRef(0);

  const [massEditing, setMassEditing] = useState(false);
  const [editingCardIds, setEditingCardIds] = useState<Set<string>>(new Set());

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const loadedDeck = await DeckStore.getById(deckId);
      setDeck(loadedDeck);
      const page = await CardStore.getAllCardsForDeckWithNotes(deckId, CARD_PAGE_SIZE + 1);
      const items = page.slice(0, CARD_PAGE_SIZE);
      setCardsWithNotes(items);
      loadedCountRef.current = items.length;
      setHasMoreCards(page.length > CARD_PAGE_SIZE);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Deck contents could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [deckId]);

  const refreshCards = useCallback(async () => {
    try {
      setMutationError(null);
      const limit = Math.max(CARD_PAGE_SIZE, loadedCountRef.current);
      const page = await CardStore.getAllCardsForDeckWithNotes(deckId, limit + 1);
      const refreshed = page.slice(0, limit);
      setCardsWithNotes(refreshed);
      loadedCountRef.current = refreshed.length;
      setHasMoreCards(page.length > limit);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'The saved card could not be refreshed. Reload this deck.');
    }
  }, [deckId]);

  const loadMoreCards = useCallback(async () => {
    if (!hasMoreCards || loadMoreInFlight.current) return;
    loadMoreInFlight.current = true;
    setLoadingMore(true);
    setMutationError(null);
    try {
      const offset = loadedCountRef.current;
      const page = await CardStore.getAllCardsForDeckWithNotes(deckId, CARD_PAGE_SIZE + 1, offset);
      const nextPage = page.slice(0, CARD_PAGE_SIZE);
      setCardsWithNotes(previous => {
        const knownIds = new Set(previous.map(item => item.card.id));
        const merged = [...previous, ...nextPage.filter(item => !knownIds.has(item.card.id))];
        loadedCountRef.current = merged.length;
        return merged;
      });
      setHasMoreCards(page.length > CARD_PAGE_SIZE);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'More cards could not be loaded. Please retry.');
    } finally {
      setLoadingMore(false);
      loadMoreInFlight.current = false;
    }
  }, [deckId, hasMoreCards]);

  useEffect(() => {
    if (!deckId) return;
    const timer = setTimeout(() => void loadData(), 0);
    return () => clearTimeout(timer);
  }, [deckId, loadData]);

  const handleReorderEnd = async (data: typeof cardsWithNotes) => {
    if (reorderInFlight.current) return;
    reorderInFlight.current = true;
    const previous = cardsWithNotes;
    // Update local state immediately
    setCardsWithNotes(data);
    setMutationError(null);

    // Save positions to DB
    const updates = buildCardPositionUpdates(data);
    try {
      await CardStore.updatePositions(updates);
    } catch (e) {
      setCardsWithNotes(current => rollbackBrowsableCardOrder(previous, current));
      setMutationError(e instanceof Error ? e.message : 'The new card order could not be saved and was rolled back.');
    } finally {
      reorderInFlight.current = false;
    }
  };

  const moveCard = (cardId: string, offset: -1 | 1) => {
    if (reorderInFlight.current) return;
    const reordered = moveBrowsableCard(cardsWithNotes, cardId, offset);
    if (!reordered) return;
    void handleReorderEnd(reordered);
  };

  const listFooter = hasMoreCards ? (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: loadingMore, busy: loadingMore }}
      disabled={loadingMore}
      onPress={() => void loadMoreCards()}
      style={[styles.loadMoreButton, { borderColor: colors.border, backgroundColor: colors.card }]}
    >
      <Text style={{ color: colors.text, fontWeight: '700' }}>{loadingMore ? 'Loading more cards…' : 'Load more cards'}</Text>
    </Pressable>
  ) : null;

  if (loading) {
    return (
      <View style={[styles.container, styles.center, { backgroundColor: colors.background }]}>
        <RectLoader text="Fetching deck contents..." />
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={[styles.container, styles.center, { backgroundColor: colors.background }]}> 
        <Text accessibilityRole="alert" style={[styles.errorText, { color: colors.error, textAlign: 'center' }]}>{loadError}</Text>
        <Pressable accessibilityRole="button" onPress={() => void loadData()} style={[styles.addButton, { backgroundColor: colors.primary, marginTop: spacing[4], width: 'auto', paddingHorizontal: spacing[5] }]}>
          <Text style={[styles.addButtonText, { color: colors.buttonText, fontSize: typography.base }]}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (!deck) {
    return (
      <View style={[styles.container, styles.center, { backgroundColor: colors.background }]}> 
        <Text accessibilityRole="alert" style={[styles.errorText, { color: colors.error, textAlign: 'center', marginBottom: spacing[4] }]}>Deck not found.</Text>
        <BackButton />
      </View>
    );
  }

  const allTags = listBrowsableCardTags(cardsWithNotes);
  const filteredItems = filterBrowsableCards(cardsWithNotes, searchQuery, selectedTag);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}> 
      {!!mutationError && (
        <Pressable accessibilityRole="button" accessibilityLabel={`${mutationError} Dismiss error`} onPress={() => setMutationError(null)} style={{ backgroundColor: colors.error, padding: spacing[3], flexDirection: 'row' }}>
          <Text accessibilityRole="alert" style={{ color: colors.onError, flex: 1 }}>{mutationError}</Text>
          <Text style={{ color: colors.onError, fontWeight: 'bold' }}>Dismiss</Text>
        </Pressable>
      )}
      <View style={styles.header}>
        <BackButton />
        <Text accessibilityRole="header" style={[styles.headerTitle, { color: colors.text }]}>{deck.name} Cards</Text>
        <View style={{ flexDirection: 'row', gap: spacing[2] }}>
          <Pressable 
            onPress={() => setMassEditing(!massEditing)} 
            style={[styles.addButton, { backgroundColor: massEditing ? colors.primary : colors.card, borderWidth: 1, borderColor: colors.primary }]}
            accessibilityRole="button"
            accessibilityLabel={massEditing ? "Exit mass edit" : "Enter mass edit"}
            accessibilityState={{ selected: massEditing }}
          >
            <Text style={[styles.addButtonText, { color: massEditing ? colors.buttonText : colors.primary, fontSize: typography.xl }]}>✏️</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Add card" onPress={() => { if(!isNavigating.current){ isNavigating.current=true; router.push(`/card/new?deckId=${deckId}`); setTimeout(()=>isNavigating.current=false, 500); } }} style={[styles.addButton, { backgroundColor: colors.primary }]}> 
            <Text style={[styles.addButtonText, { color: colors.buttonText }]}>+</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.searchContainer}>
        <TextInput
          accessibilityLabel="Search cards"
          style={[styles.searchInput, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
          placeholder="Search cards..."
          placeholderTextColor={colors.textSecondary}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        {allTags.length > 0 && (
          <View style={styles.tagsContainer}>
            <FlatList keyboardShouldPersistTaps="handled"
              horizontal
              showsHorizontalScrollIndicator={false}
              data={['All', ...allTags]}
              keyExtractor={item => item}
              renderItem={({ item }) => (
                <Pressable 
                  style={[styles.tagChip, { backgroundColor: colors.card }, (selectedTag === item || (item === 'All' && !selectedTag)) && [styles.tagChipActive, { backgroundColor: colors.primary }]]}
                  onPress={() => setSelectedTag(item === 'All' ? null : item)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: selectedTag === item || (item === 'All' && !selectedTag) }}
                  accessibilityLabel={`Filter by ${item}`}
                >
                  <Text style={[styles.tagChipText, { color: colors.text }, (selectedTag === item || (item === 'All' && !selectedTag)) && [styles.tagChipTextActive, { color: colors.buttonText }]]}>
                    {item}
                  </Text>
                </Pressable>
              )}
            />
          </View>
        )}
      </View>

      {searchQuery || selectedTag ? (
        <FlatList keyboardShouldPersistTaps="handled"
          data={filteredItems}
          keyExtractor={item => item.card.id}
          renderItem={({ item, index }) => {
            const isEditing = massEditing || editingCardIds.has(item.card.id);
            return (
              <View style={{ flex: 1, paddingLeft: spacing[3] }}>
                <InlineCardEditor
                  item={item as any}
                  isEditing={isEditing}
                  onToggleEdit={() => {
                    setEditingCardIds(prev => {
                      const newSet = new Set(prev);
                      if (newSet.has(item.card.id)) newSet.delete(item.card.id);
                      else newSet.add(item.card.id);
                      return newSet;
                    });
                  }}
                  onSave={() => { void refreshCards(); }}
                  onDeleteCard={(cardId) => {
                    setCardsWithNotes(prev => prev.filter(c => c.card.id !== cardId));
                  }}
                />
              </View>
            );
          }}
          contentContainerStyle={styles.listContent}
          ListFooterComponent={listFooter}
          ListEmptyComponent={<Text style={[styles.emptyText, { color: colors.textSecondary }]}>No cards found.</Text>}
        />
      ) : (
        <DraggableFlatList
          data={filteredItems}
          onDragEnd={({ data }) => handleReorderEnd(data)}
          keyExtractor={item => item.card.id}
          activationDistance={20}
          renderItem={({ item, drag, isActive, getIndex }) => {
            const isEditing = massEditing || editingCardIds.has(item.card.id);
            const itemIndex = getIndex() ?? -1;
            return (
              <ScaleDecorator>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Pressable 
                    onLongPress={drag} 
                    delayLongPress={200}
                    style={{ padding: spacing[3], justifyContent: 'center', alignItems: 'center', minWidth: 44, minHeight: 44 }}
                    accessibilityRole="button"
                    accessibilityLabel={`Reorder card ${itemIndex + 1}`}
                    accessibilityHint="Long press and drag, or use the move up and move down accessibility actions"
                    accessibilityActions={[
                      ...(itemIndex > 0 ? [{ name: 'moveUp', label: 'Move card up' }] : []),
                      ...(itemIndex >= 0 && itemIndex < cardsWithNotes.length - 1 ? [{ name: 'moveDown', label: 'Move card down' }] : []),
                    ]}
                    onAccessibilityAction={(event) => {
                      if (event.nativeEvent.actionName === 'moveUp') moveCard(item.card.id, -1);
                      if (event.nativeEvent.actionName === 'moveDown') moveCard(item.card.id, 1);
                    }}
                  >
                    <Text style={{ fontSize: 24, color: isActive ? colors.primary : colors.textSecondary }}>≡</Text>
                  </Pressable>
                  {Platform.OS === 'web' && (
                    <View>
                      <Pressable accessibilityRole="button" accessibilityLabel={`Move card ${itemIndex + 1} up`} accessibilityState={{ disabled: itemIndex <= 0 }} disabled={itemIndex <= 0} onPress={() => moveCard(item.card.id, -1)} style={styles.reorderButton}><Text style={{ color: colors.text }}>↑</Text></Pressable>
                      <Pressable accessibilityRole="button" accessibilityLabel={`Move card ${itemIndex + 1} down`} accessibilityState={{ disabled: itemIndex < 0 || itemIndex >= cardsWithNotes.length - 1 }} disabled={itemIndex < 0 || itemIndex >= cardsWithNotes.length - 1} onPress={() => moveCard(item.card.id, 1)} style={styles.reorderButton}><Text style={{ color: colors.text }}>↓</Text></Pressable>
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <InlineCardEditor
                      item={item as any}
                      isEditing={isEditing}
                      onToggleEdit={() => {
                        setEditingCardIds(prev => {
                          const newSet = new Set(prev);
                          if (newSet.has(item.card.id)) newSet.delete(item.card.id);
                          else newSet.add(item.card.id);
                          return newSet;
                        });
                      }}
                      onSave={() => { void refreshCards(); }}
                      onDeleteCard={(cardId) => {
                        setCardsWithNotes(prev => prev.filter(c => c.card.id !== cardId));
                      }}
                    />
                  </View>
                </View>
              </ScaleDecorator>
            );
          }}
          contentContainerStyle={styles.listContent}
          ListFooterComponent={listFooter}
          ListEmptyComponent={<Text style={[styles.emptyText, { color: colors.textSecondary }]}>No cards found.</Text>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing[4],
    paddingTop: Platform.OS === 'ios' ? 60 : spacing[4],
  },
  headerTitle: {
    fontSize: typography.xl,
    fontWeight: '800',
  },
  addButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addButtonText: {
    fontSize: typography['2xl'],
    lineHeight: 28,
  },
  searchContainer: {
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[4],
  },
  searchInput: {
    padding: spacing[3],
    borderRadius: 12,
    borderWidth: 1,
    fontSize: typography.base,
  },
  listContent: {
    padding: spacing[4],
    paddingTop: 0,
  },
  cardRow: {
    padding: spacing[4],
    borderRadius: 12,
    marginBottom: spacing[3],
    borderWidth: 1,
  },
  cardFrontText: {
    fontSize: typography.base,
    fontWeight: '700',
    marginBottom: spacing[1],
  },
  cardBackText: {
    fontSize: typography.sm,
    marginBottom: spacing[2],
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    paddingTop: spacing[2],
  },
  statsText: {
    fontSize: typography.xs,
  },
  errorText: {
    fontSize: typography.lg,
  },
  emptyText: {
    textAlign: 'center',
    marginTop: spacing[10],
    fontSize: typography.base,
  },
  loadMoreButton: {
    minHeight: 44,
    marginVertical: spacing[4],
    marginHorizontal: spacing[3],
    paddingHorizontal: spacing[4],
    borderWidth: 1,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reorderButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagsContainer: {
    marginTop: spacing[3],
  },
  tagChip: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1] + 2, // approximation for 6
    borderRadius: 16,
    marginRight: spacing[2],
    minHeight: 44,
    justifyContent: 'center',
  },
  tagChipActive: {
  },
  tagChipText: {
    fontSize: typography.sm,
    fontWeight: '600',
  },
  tagChipTextActive: {
  },
  cardTagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: spacing[2],
  },
  cardTagSmall: {
    paddingHorizontal: spacing[1] + 2, // 6
    paddingVertical: spacing[0] + 2, // 2
    borderRadius: 8,
  },
  cardTagSmallText: {
    fontSize: typography.xs - 2, // 10
    fontWeight: 'bold',
  },
});
