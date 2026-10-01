/**
 * @fileoverview src/components/ui/GlobalHeader.tsx.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, Modal } from 'react-native';
import { useThemeColors } from '../../lib/useThemeColors';
import { useSettingsStore } from '../../lib/store/useSettingsStore';
import { useLMSStore } from '../../lib/store/useLMSStore';
import Ionicons from '@expo/vector-icons/Ionicons';
import branding from '../../lib/branding.generated.json';
import { InstitutionBrand, InstitutionColorBar } from './InstitutionBrand';
import { InstitutionThemeSettings } from './InstitutionThemeSettings';
import { spacing } from '../../lib/theme';

const MOTIVATIONAL_TEXTS = [
  "Ready to learn?",
  "Keep up the good work!",
  "Stay focused!",
  "You're doing great!",
  "Consistency is key!"
];

export function GlobalHeader() {
  const colors = useThemeColors();
  const { settingsError, clearSettingsError } = useSettingsStore();
  const {
    currentUserName,
    currentUserEmail,
    currentUserId,
    currentUserRole,
    logout,
    courseMutationError,
    contentMutationError,
    liveSessionError,
    chatError,
    institutionImportError,
    clearCourseMutationError,
    clearContentMutationError,
    clearLiveSessionError,
    clearChatError,
    clearInstitutionImportError,
  } = useLMSStore();
  const [greetingIndex, setGreetingIndex] = useState(0);
  const [showColorSettings, setShowColorSettings] = useState(false);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [accountError, setAccountError] = useState('');
  useEffect(() => {
    const interval = setInterval(() => {
      setGreetingIndex(prev => (prev + 1) % MOTIVATIONAL_TEXTS.length);
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const authenticatedName = currentUserName?.trim();
  const dataError = courseMutationError || contentMutationError || liveSessionError || chatError || institutionImportError || settingsError;
  const dismissDataError = () => {
    clearCourseMutationError();
    clearContentMutationError();
    clearLiveSessionError();
    clearChatError();
    clearInstitutionImportError();
    clearSettingsError();
  };

  return (
    <View style={{ backgroundColor: colors.navBg }}>
      <View style={[styles.container, { backgroundColor: colors.navBg }]}> 
        <InstitutionBrand size={36} />
        <View style={styles.greetingSection}>
          <Text numberOfLines={1} style={{ color: colors.primary, fontWeight: '800', fontSize: 13, marginBottom: 2 }}>{branding.name}</Text>
          <Text numberOfLines={1} accessibilityRole="header" style={[styles.greeting, { color: colors.text }]}>{authenticatedName ? `Hello, ${authenticatedName}` : 'Welcome'}</Text>
          <Text numberOfLines={1} style={[styles.motivational, { color: colors.textSecondary }]}>{MOTIVATIONAL_TEXTS[greetingIndex]}</Text>
        </View>
        <View style={styles.headerActions}>
          {currentUserId ? (
            <Pressable onPress={() => { setAccountError(''); setShowAccountMenu(true); }} style={styles.settingsIcon} accessibilityRole="button" accessibilityLabel="Open account menu">
              <Ionicons name="person-circle-outline" size={26} color={colors.text} />
            </Pressable>
          ) : null}
          <Pressable onPress={() => setShowColorSettings(true)} style={styles.settingsIcon} accessibilityRole="button" accessibilityLabel="Open theme settings">
            <Ionicons name="color-palette-outline" size={24} color={colors.text} />
          </Pressable>
        </View>
      </View>

      <InstitutionColorBar />

      {dataError && (
        <Pressable onPress={dismissDataError} accessibilityRole="button" accessibilityLabel={`Changes were not saved: ${dataError}. Dismiss error.`} style={[styles.errorBanner, { backgroundColor: colors.error }]}> 
          <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[styles.errorBannerText, { color: colors.onError }]} numberOfLines={2}>Changes were not saved: {dataError} Tap to dismiss.</Text>
        </Pressable>
      )}

      {showColorSettings ? <InstitutionThemeSettings onClose={() => setShowColorSettings(false)} /> : null}

      <Modal visible={showAccountMenu} transparent animationType="fade" onRequestClose={() => { if (!isSigningOut) setShowAccountMenu(false); }}>
        <View style={styles.modalOverlay}>
          <View accessibilityViewIsModal style={[styles.modalContent, { backgroundColor: colors.card }]}> 
            <Text accessibilityRole="header" style={[styles.accountTitle, { color: colors.text }]}>Account</Text>
            <Ionicons name="person-circle-outline" size={54} color={colors.primary} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
            <Text style={[styles.accountName, { color: colors.text }]}>{authenticatedName || 'Signed-in user'}</Text>
            {currentUserEmail ? <Text style={[styles.accountMeta, { color: colors.textSecondary }]}>{currentUserEmail}</Text> : null}
            <Text style={[styles.accountRole, { color: colors.primary }]}>{currentUserRole === 'ta' ? 'Teaching assistant' : currentUserRole.charAt(0).toUpperCase() + currentUserRole.slice(1)}</Text>
            {accountError ? <Text accessibilityRole="alert" style={{ color: colors.error, marginTop: spacing[3], textAlign: 'center' }}>{accountError}</Text> : null}
            <View style={styles.accountActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: isSigningOut }}
                disabled={isSigningOut}
                onPress={() => setShowAccountMenu(false)}
                style={[styles.modalAction, { borderWidth: 1, borderColor: colors.border }]}
              >
                <Text style={{ color: colors.text, fontWeight: 'bold' }}>Close</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Sign out"
                accessibilityState={{ disabled: isSigningOut, busy: isSigningOut }}
                disabled={isSigningOut}
                onPress={async () => {
                  if (isSigningOut) return;
                  setIsSigningOut(true);
                  setAccountError('');
                  try {
                    await logout();
                    setShowAccountMenu(false);
                  } catch {
                    setAccountError('Sign out could not be completed. Retry or close the app.');
                  } finally {
                    setIsSigningOut(false);
                  }
                }}
                style={[styles.modalAction, { backgroundColor: colors.error, opacity: isSigningOut ? 0.6 : 1 }]}
              >
                <Text style={{ color: colors.onError, fontWeight: 'bold' }}>{isSigningOut ? 'Signing out…' : 'Sign out'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 54,
    paddingBottom: 16,
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  iconSection: {
    padding: 10,
    backgroundColor: 'rgba(0,0,0,0.05)',
    borderRadius: 12,
  },
  greetingSection: {
    flex: 1,
    marginLeft: 12,
    minWidth: 0,
  },
  greeting: {
    fontSize: 18,
    fontWeight: '800',
  },
  motivational: {
    fontSize: 14,
    marginTop: 2,
    fontWeight: '600',
  },
  settingsIcon: {
    padding: 10,
    backgroundColor: 'rgba(0,0,0,0.05)',
    borderRadius: 12,
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  errorBanner: {
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  errorBannerText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    padding: 24,
    borderRadius: 16,
    width: 280,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 8,
  },
  modalAction: { minWidth: 80, minHeight: 44, paddingHorizontal: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  accountTitle: { alignSelf: 'flex-start', fontSize: 20, fontWeight: '800', marginBottom: 14 },
  accountName: { fontSize: 18, fontWeight: '800', marginTop: 8, textAlign: 'center' },
  accountMeta: { marginTop: 3, textAlign: 'center' },
  accountRole: { marginTop: 8, fontWeight: '800' },
  accountActions: { width: '100%', flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 22 },
});
