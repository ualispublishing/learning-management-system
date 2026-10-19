/** Shared presentation for course study sets and the isolated AI demo. No storage or publication side effects. */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { CourseStudyCard } from '../../types/lms';
import { useThemeColors } from '../../lib/useThemeColors';

export function CourseStudyCardBody({ cards, index, revealed, onToggleAnswer, onRate }: {
  cards: CourseStudyCard[]; index: number; revealed: boolean; onToggleAnswer: () => void; onRate: (understood: boolean) => void;
}) {
  const colors = useThemeColors();
  const card = cards[index];
  if (!card) return <Text style={{ color: colors.textSecondary }}>This study set has no cards.</Text>;
  return <View style={{ width: '100%', alignItems: 'center' }}>
              <TouchableOpacity
                onPress={() => onToggleAnswer()}
                accessibilityRole="button"
                accessibilityLabel={revealed ? `Answer: ${card.back}` : `Question: ${card.front}. Activate to reveal the answer.`}
                accessibilityState={{ expanded: revealed }}
                style={[styles.card, { backgroundColor: colors.card, borderColor: revealed ? colors.primary : colors.border }]}
              >
                <Text style={{ color: colors.textSecondary, fontWeight: 'bold', fontSize: 12 }}>{revealed ? 'ANSWER' : 'QUESTION'}</Text>
                <Text style={{ color: colors.text, fontSize: 24, lineHeight: 34, textAlign: 'center', marginTop: 20 }}>{revealed ? card.back : card.front}</Text>
                <Text style={{ color: colors.primary, marginTop: 24, fontWeight: 'bold' }}>{revealed ? 'Tap to show the question' : 'Tap to reveal the answer'}</Text>
              </TouchableOpacity>

              {revealed && (card.sourceExcerpt || card.sourceLocation) && (
                <View style={[styles.evidence, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: 'bold' }}>SOURCE EVIDENCE</Text>
                  {!!card.sourceExcerpt && <Text style={{ color: colors.text, marginTop: 6 }}>{card.sourceExcerpt}</Text>}
                  {!!card.sourceLocation && <Text style={{ color: colors.textSecondary, marginTop: 5, fontSize: 12 }}>{card.sourceLocation}</Text>}
                </View>
              )}

              {revealed && (
                <View style={styles.ratingRow}>
                  <TouchableOpacity onPress={() => onRate(false)} accessibilityRole="button" style={[styles.ratingButton, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Text style={{ color: colors.text, fontWeight: 'bold' }}>Review again</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => onRate(true)} accessibilityRole="button" style={[styles.ratingButton, { backgroundColor: colors.primary, borderColor: colors.primary }]}>
                    <Text style={{ color: colors.buttonText, fontWeight: 'bold' }}>{index === cards.length - 1 ? 'Mark understood' : 'Got it · Next'}</Text>
                  </TouchableOpacity>
                </View>
              )}
  </View>;
}

export function CourseStudyNavigation({ cards, index, onMove }: {
  cards: CourseStudyCard[]; index: number; onMove: (index: number) => void;
}) {
  const colors = useThemeColors();
  const card = cards[index];
  return <>
          {!!card && (
            <View style={[styles.footer, { borderTopColor: colors.border }]}>
              <TouchableOpacity disabled={index === 0} onPress={() => onMove(index - 1)} accessibilityRole="button" accessibilityState={{ disabled: index === 0 }} style={{ opacity: index === 0 ? 0.4 : 1, padding: 12 }}>
                <Text style={{ color: colors.primary, fontWeight: 'bold' }}>Previous</Text>
              </TouchableOpacity>
              <View style={styles.progressTrack} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: cards.length, now: index + 1 }}>
                <View style={[styles.progressFill, { backgroundColor: colors.primary, width: `${((index + 1) / cards.length) * 100}%` }]} />
              </View>
              <TouchableOpacity disabled={index === cards.length - 1} onPress={() => onMove(index + 1)} accessibilityRole="button" accessibilityState={{ disabled: index === cards.length - 1 }} style={{ opacity: index === cards.length - 1 ? 0.4 : 1, padding: 12 }}>
                <Text style={{ color: colors.primary, fontWeight: 'bold' }}>Next</Text>
              </TouchableOpacity>
            </View>
          )}
  </>;
}

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
