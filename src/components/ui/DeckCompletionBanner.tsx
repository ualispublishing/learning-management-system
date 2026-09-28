/**
 * @fileoverview src/components/ui/DeckCompletionBanner.tsx.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Platform } from 'react-native';
import { NotificationScheduler } from '../../lib/notifications/scheduler';
import * as Notifications from 'expo-notifications';
import { useThemeColors } from '../../lib/useThemeColors';
import { typography, spacing } from '../../lib/theme';
import { getError } from '../../lib/errorCodes';
import { userAlert as Alert } from '../../lib/userAlert';
import { DIAGNOSTIC_CONTEXTS, logDiagnosticError } from '../../lib/diagnosticLog';

interface DeckCompletionBannerProps {
  deckName: string;
  onEnableNotifications?: () => void;
  onDismiss?: () => void;
}

export function DeckCompletionBanner({ deckName, onEnableNotifications, onDismiss }: DeckCompletionBannerProps) {
  const colors = useThemeColors();
  const [isEnabling, setIsEnabling] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleEnableNotifications = async () => {
    if (isEnabling) return;
    setIsEnabling(true);

    try {
      if (Platform.OS !== 'web') {
        const { status } = await Notifications.requestPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission Denied', getError('E2001'));
          return;
        }
      }

      await NotificationScheduler.scheduleDueCards();
      setSuccess(true);
      if (onEnableNotifications) {
        onEnableNotifications();
      }
    } catch (error) {
      logDiagnosticError(DIAGNOSTIC_CONTEXTS.notificationsEnable, error);
      Alert.alert('Error', getError('E2002'));
    } finally {
      setIsEnabling(false);
    }
  };

  if (Platform.OS === 'web') {
    return (
      <View style={[styles.container, { backgroundColor: colors.card, borderColor: colors.border }]}> 
        <View style={styles.textCol}>
          <Text style={[styles.title, { color: colors.text }]}>{`You finished “${deckName}”!`}</Text>
          <Text style={[styles.desc, { color: colors.textSecondary }]}>Scheduled review reminders are available in the iOS and Android apps.</Text>
        </View>
        <Pressable accessibilityRole="button" style={[styles.laterBtn, { borderColor: colors.border }]} onPress={onDismiss}>
          <Text style={[styles.laterBtnText, { color: colors.textSecondary }]}>Return to Decks</Text>
        </Pressable>
      </View>
    );
  }

  if (success) {
    return (
      <View style={[styles.container, styles.successContainer, { backgroundColor: colors.success, borderColor: colors.border }]}>
        <View style={styles.textCol}>
          <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={[styles.title, { color: colors.onSuccess }]}>Notifications Enabled! 🎉</Text>
          <Text style={[styles.desc, { color: colors.onSuccess }]}>{`We will remind you when cards from “${deckName}” are due for review.`}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss reminder confirmation" onPress={onDismiss} style={styles.dismissBtn}>
          <Text style={[styles.dismissBtnText, { color: colors.onSuccess }]}>X</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.textCol}>
        <Text style={[styles.title, { color: colors.text }]}>{`You finished “${deckName}”!`}</Text>
        <Text style={[styles.desc, { color: colors.textSecondary }]}>To commit these to long-term memory, enable Spaced Repetition reminders.</Text>
      </View>
      <View style={styles.actionRow}>
        <Pressable 
          style={[styles.enableBtn, { backgroundColor: colors.primary }]} 
          onPress={handleEnableNotifications}
          disabled={isEnabling}
          accessibilityRole="button"
          accessibilityLabel={isEnabling ? 'Enabling reminders' : 'Enable reminders'}
          accessibilityState={{ disabled: isEnabling, busy: isEnabling }}
        >
          <Text style={[styles.enableBtnText, { color: colors.buttonText }]}>
            {isEnabling ? 'Enabling...' : 'Enable Reminders'}
          </Text>
        </Pressable>
        <Pressable accessibilityRole="button" style={[styles.laterBtn, { borderColor: colors.border }]} onPress={onDismiss}>
          <Text style={[styles.laterBtnText, { color: colors.textSecondary }]}>Return to Decks</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing[4],
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: spacing[5],
    position: 'relative',
  },
  successContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  textCol: {
    flex: 1,
    marginBottom: spacing[3],
  },
  title: {
    fontSize: typography.lg,
    fontWeight: 'bold',
    marginBottom: spacing[1],
  },
  desc: {
    fontSize: typography.sm,
    lineHeight: 20,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
  },
  enableBtn: {
    paddingVertical: 10,
    paddingHorizontal: spacing[4],
    borderRadius: 8,
    alignItems: 'center',
    flex: 1,
    minHeight: 44,
    justifyContent: 'center',
  },
  enableBtnText: {
    fontSize: typography.sm,
    fontWeight: '600',
  },
  laterBtn: {
    backgroundColor: 'transparent',
    paddingVertical: 10,
    paddingHorizontal: spacing[4],
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    flex: 1,
    minHeight: 44,
    justifyContent: 'center',
  },
  laterBtnText: {
    fontSize: typography.sm,
    fontWeight: '500',
  },
  dismissBtn: {
    padding: spacing[1],
    marginLeft: spacing[3],
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dismissBtnText: {
    fontSize: typography.base,
    fontWeight: 'bold',
  },
});
