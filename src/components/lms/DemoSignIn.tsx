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

interface DemoSignInProps {
  busyEmail: string | null;
  error: string | null;
  onSignIn: (email: string) => Promise<void>;
}

export function DemoSignIn({ busyEmail, error, onSignIn }: DemoSignInProps) {
  const colors = useThemeColors();

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.page}
      keyboardShouldPersistTaps="handled"
    >
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}> 
        <View style={[styles.icon, { backgroundColor: colors.primary }]}> 
          <Ionicons name="school" size={30} color={colors.buttonText} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
        </View>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>Sign in to the shared LMS demo</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Choose a synthetic account for this browser tab. Other tabs can sign in separately and will share the same loopback-only course data.</Text>
        <View style={[styles.notice, { backgroundColor: colors.background, borderColor: colors.border }]}> 
          <Text style={{ color: colors.text, fontWeight: '700' }}>Local acceptance environment</Text>
          <Text style={{ color: colors.textSecondary, marginTop: 3 }}>No password or real institutional identity is used. Refreshing this demo tab signs it out.</Text>
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
