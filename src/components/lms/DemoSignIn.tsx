/**
 * @fileoverview src/components/lms/DemoSignIn.tsx.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { DEMO_ACCOUNTS, DEMO_ACCOUNT_GROUPS } from '../../lib/demoAccounts';
import { useThemeColors } from '../../lib/useThemeColors';
import { spacing, typography } from '../../lib/theme';

import branding from '../../lib/branding.generated.json';
import { InstitutionBrand, InstitutionColorBar } from '../ui/InstitutionBrand';

interface DemoSignInProps {
  onShowAI?: () => void;
  onShowGuide?: () => void;
  busyEmail: string | null;
  error: string | null;
  onSignIn: (email: string) => Promise<void>;
}

export function DemoSignIn({ busyEmail, error, onSignIn, onShowAI, onShowGuide }: DemoSignInProps) {
  const colors = useThemeColors();

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.page}
      keyboardShouldPersistTaps="handled"
    >
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}> 
        <InstitutionBrand size={64} showName />
        <View style={{ marginTop: 20, marginBottom: 20 }}><InstitutionColorBar /></View>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>Explore the learning demo</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{branding.tagline} Choose a role below to explore courses, assessments and conversations.</Text>
        {onShowAI ? <Pressable onPress={onShowAI} accessibilityRole="button" style={[styles.notice, { borderColor: colors.primary, backgroundColor: colors.background }]}>
          <Text style={{ color: colors.primary, fontWeight: '800' }}>Open AI before & after demo →</Text>
          <Text style={{ color: colors.textSecondary, marginTop: 4 }}>Compare a syllabus and lesson files with their prepared results. No course setup needed.</Text>
        </Pressable> : null}
        {onShowGuide ? <Pressable onPress={onShowGuide} accessibilityRole="button" accessibilityLabel="Open Demo guide" style={{ paddingVertical: 14 }}><Text style={{ color: colors.primary, fontWeight: '700' }}>Explore all demo features →</Text></Pressable> : null}
        <View style={[styles.notice, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <Text style={{ color: colors.text, fontWeight: '700' }}>Demo accounts</Text>
          <Text style={{ color: colors.textSecondary, marginTop: 3 }}>No password needed. These sample accounts use fictional data. Open another tab to try a different role. Refreshing signs you out.</Text>
        </View>

        {error ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.error }]}>{error}</Text> : null}

        {DEMO_ACCOUNT_GROUPS.map(group => {
          const accounts = DEMO_ACCOUNTS.filter(account => account.group === group.id);
          return (
            <View key={group.id} style={styles.group}>
              <Text accessibilityRole="header" aria-level={2} style={[styles.groupTitle, { color: colors.text }]}>{group.title}</Text>
              <Text style={[styles.groupDescription, { color: colors.textSecondary }]}>{group.description}</Text>
              {accounts.map(account => {
                const busy = busyEmail === account.email;
                const disabled = busyEmail !== null;
                return (
                  <Pressable
                    key={account.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Sign in as ${account.label}, ${account.name}`}
                    accessibilityHint={account.summary}
                    accessibilityState={{ disabled, busy }}
                    disabled={disabled}
                    onPress={() => void onSignIn(account.email)}
                    style={({ pressed }) => [
                      styles.account,
                      { borderColor: colors.border, backgroundColor: colors.background, opacity: disabled && !busy ? 0.55 : pressed ? 0.8 : 1 },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.accountTitle, { color: colors.text }]}>{account.label} · {account.name}</Text>
                      <Text style={[styles.accountSummary, { color: colors.textSecondary }]}>{account.summary}</Text>
                    </View>
                    {busy
                      ? <ActivityIndicator accessibilityLabel={`Signing in as ${account.label}`} color={colors.primary} />
                      : <Ionicons name="arrow-forward" size={20} color={colors.primary} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />}
                  </Pressable>
                );
              })}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: spacing[5] },
  card: { width: '100%', maxWidth: 680, borderWidth: 1, borderRadius: 20, padding: spacing[6] },
  icon: { width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: spacing[4] },
  title: { fontSize: typography['3xl'], fontWeight: '800' },
  subtitle: { fontSize: typography.base, lineHeight: 23, marginTop: spacing[2] },
  notice: { borderWidth: 1, borderRadius: 12, padding: spacing[4], marginTop: spacing[5] },
  error: { fontWeight: '700', marginTop: spacing[4] },
  group: { marginTop: spacing[6] },
  groupTitle: { fontSize: typography.lg, fontWeight: '800' },
  groupDescription: { marginTop: 2, marginBottom: spacing[3], lineHeight: 20 },
  account: { minHeight: 72, borderWidth: 1, borderRadius: 12, padding: spacing[4], marginBottom: spacing[3], flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  accountTitle: { fontSize: typography.base, fontWeight: '800' },
  accountSummary: { fontSize: typography.sm, lineHeight: 19, marginTop: 3 },
});
