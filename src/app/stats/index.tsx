/**
 * @fileoverview src/app/stats/index.tsx.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import React from 'react';
import { View, Text, StyleSheet, ScrollView, SafeAreaView, Pressable } from 'react-native';
import { RectLoader } from '../../components/ui/RectLoader';
import { useStats } from '../../hooks/useStats';
import { useThemeColors } from '../../lib/useThemeColors';
import { typography, spacing } from '../../lib/theme';
import { BackButton } from '../../components/ui/BackButton';
import i18n from '../../lib/i18n';

export default function StatsScreen() {
  const colors = useThemeColors();
  const { stats, loading, error, retry } = useStats();

  if (error) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}> 
        <View style={[styles.topBar, { borderBottomColor: colors.border }]}> 
          <BackButton />
          <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{i18n.t('statistics')}</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.centerContainer}>
          <Text accessibilityRole="alert" style={{ color: colors.error, textAlign: 'center', marginBottom: spacing[4] }}>{error}</Text>
          <Pressable accessibilityRole="button" onPress={retry} style={{ backgroundColor: colors.primary, paddingHorizontal: spacing[5], paddingVertical: spacing[3], borderRadius: 8 }}>
            <Text style={{ color: colors.buttonText, fontWeight: 'bold' }}>Retry</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (loading || !stats) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.topBar, { borderBottomColor: colors.border }]}>
          <BackButton />
          <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{i18n.t('statistics')}</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={[styles.container, styles.centerContainer, { backgroundColor: colors.background }]}>
        <RectLoader text="Calculating your learning stats..." />
      </View>
      </SafeAreaView>
    );
  }

  // Calculate max values for charts
  const maxReviews = Math.max(...stats.last7Days.map(d => d.count), 1); // Avoid div by 0
  const maxKnob = Math.max(...stats.knobDistribution.map(d => d.count), 1);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.topBar, { borderBottomColor: colors.border }]}>
        <BackButton />
        <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{i18n.t('statistics')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" style={styles.scrollArea} contentContainerStyle={styles.content}>
        
        {/* Overview Cards */}
        <View style={styles.row}>
          <View accessible accessibilityRole="text" accessibilityLabel={`${stats.totalReviews} total reviews`} style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}> 
            <Text style={[styles.statValue, { color: colors.text }]}>{stats.totalReviews}</Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Total Reviews</Text>
          </View>
          <View accessible accessibilityRole="text" accessibilityLabel={`${stats.retentionRate.toFixed(1)} percent retention rate`} style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}> 
            <Text style={[styles.statValue, { color: colors.text }]}>{stats.retentionRate.toFixed(1)}%</Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Retention Rate</Text>
          </View>
        </View>

        {/* Review History */}
        <View style={[styles.chartContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.text }]}>Reviews - Last 7 Days</Text>
          <View style={styles.barChart}>
            {stats.last7Days.map((day, i) => {
              const heightPercentage = (day.count / maxReviews) * 100;
              const dateObj = new Date(day.date);
              const dayLabel = ['S','M','T','W','T','F','S'][dateObj.getUTCDay()];
              
              return (
                <View key={i} accessible accessibilityRole="text" accessibilityLabel={`${dateObj.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' })}: ${day.count} reviews`} style={styles.barColumn}>
                  <Text style={[styles.barValueText, { color: colors.textSecondary }]}>{day.count}</Text>
                  <View style={[styles.barTrack, { backgroundColor: colors.background }]}>
                    <View style={[styles.barFill, { height: `${heightPercentage}%`, backgroundColor: colors.primary }]} />
                  </View>
                  <Text style={[styles.barLabelText, { color: colors.textSecondary }]}>{dayLabel}</Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* Knob Distribution */}
        <View style={[styles.chartContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.text }]}>Proficiency Distribution</Text>
          <View style={styles.barChart}>
            {stats.knobDistribution.map((dist, i) => {
              const heightPercentage = (dist.count / maxKnob) * 100;
              let color = colors.error; // 0-25
              if (i === 1) color = colors.warning; // 26-50
              if (i === 2) color = colors.info; // 51-75
              if (i === 3) color = colors.success; // 76-100

              return (
                <View key={i} accessible accessibilityRole="text" accessibilityLabel={`${dist.range}: ${dist.count} reviews`} style={styles.barColumn}>
                  <Text style={[styles.barValueText, { color: colors.textSecondary }]}>{dist.count}</Text>
                  <View style={[styles.barTrack, { backgroundColor: colors.background }]}>
                    <View style={[styles.barFill, { height: `${heightPercentage}%`, backgroundColor: color }]} />
                  </View>
                  <Text style={[styles.barLabelText, { color: colors.textSecondary }]}>{dist.range.split(' ')[0]}</Text>
                </View>
              );
            })}
          </View>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
  },
  title: {
    fontSize: typography.lg,
    fontWeight: 'bold',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollArea: {
    flex: 1,
  },
  content: {
    padding: spacing[5],
    gap: 24,
  },
  row: {
    flexDirection: 'row',
    gap: spacing[4],
  },
  statCard: {
    flex: 1,
    padding: spacing[5],
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1,
  },
  statValue: {
    fontSize: typography['3xl'],
    fontWeight: 'bold',
    marginBottom: spacing[2],
  },
  statLabel: {
    fontSize: typography.sm,
  },
  chartContainer: {
    padding: spacing[5],
    borderRadius: 16,
    borderWidth: 1,
  },
  sectionTitle: {
    fontSize: typography.base,
    fontWeight: '600',
    marginBottom: spacing[5],
  },
  barChart: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: 180,
    paddingTop: spacing[5],
  },
  barColumn: {
    alignItems: 'center',
    width: 36,
  },
  barTrack: {
    width: 16,
    height: 120,
    borderRadius: 8,
    justifyContent: 'flex-end',
    overflow: 'hidden',
    marginVertical: spacing[2],
  },
  barFill: {
    width: '100%',
    borderRadius: 8,
  },
  barValueText: {
    fontSize: typography.xs,
  },
  barLabelText: {
    fontSize: typography.xs,
  },
});
