/**
 * @fileoverview src/components/lms/RoleOnboardingModal.tsx.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import React, { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { CourseRole } from '../../types/lms';
import { getRoleOnboarding, roleOnboardingStorageKey } from '../../lib/demoAccounts';
import { getRoleOnboardingFlowState, updateRoleOnboardingStep } from '../../lib/roleOnboardingFlow';
import { useThemeColors } from '../../lib/useThemeColors';
import { spacing, typography } from '../../lib/theme';
import { BaseModal } from './BaseModal';

interface RoleOnboardingModalProps {
  principalId: string | null;
  role: CourseRole;
  replayNonce: number;
}

export function RoleOnboardingModal({ principalId, role, replayNonce }: RoleOnboardingModalProps) {
  const colors = useThemeColors();
  const [visible, setVisible] = useState(false);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const model = getRoleOnboarding(role);
  const storageKey = principalId ? roleOnboardingStorageKey(principalId, role) : null;
  const navigation = getRoleOnboardingFlowState(currentStepIndex, model.steps.length);
  const step = model.steps[navigation.currentStepIndex];

  useEffect(() => {
    if (!storageKey) return;
    let active = true;
    void (async () => {
      let shouldShow = true;
      if (replayNonce === 0) {
        try {
          shouldShow = await AsyncStorage.getItem(storageKey) !== 'complete';
        } catch {
          shouldShow = true;
        }
      } else {
        await Promise.resolve();
      }
      if (!active) return;
      setCurrentStepIndex(previous => updateRoleOnboardingStep(previous, 'restart', model.steps.length));
      setSaveError('');
      setVisible(shouldShow);
      setLoadedKey(storageKey);
    })();
    return () => { active = false; };
  }, [model.steps.length, replayNonce, storageKey]);

  const finish = async () => {
    if (!principalId || saving) return;
    setSaving(true);
    setSaveError('');
    try {
      await AsyncStorage.setItem(roleOnboardingStorageKey(principalId, role), 'complete');
      setVisible(false);
    } catch {
      setSaveError('The completion could not be saved. You can continue, but this tour may appear again.');
    } finally {
      setSaving(false);
    }
  };

  if (!storageKey || loadedKey !== storageKey) return null;

  const move = (action: 'back' | 'next') => {
    setSaveError('');
    setCurrentStepIndex(previous => updateRoleOnboardingStep(previous, action, model.steps.length));
  };

  return (
    <BaseModal visible={visible} onClose={() => void finish()} title={model.title} closeDisabled={saving}>
      <Text style={[styles.summary, { color: colors.textSecondary }]}>{model.summary}</Text>
      <View style={styles.progressHeader}>
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.progressLabel, { color: colors.primary }]}
        >
          {`Step ${navigation.stepNumber} of ${navigation.stepCount}`}
        </Text>
        <View
          accessibilityRole="progressbar"
          accessibilityValue={{
            min: 0,
            max: navigation.stepCount,
            now: navigation.stepNumber,
            text: `Step ${navigation.stepNumber} of ${navigation.stepCount}`,
          }}
          style={[styles.progressTrack, { backgroundColor: colors.border }]}
        >
          <View
            style={[
              styles.progressFill,
              {
                backgroundColor: colors.primary,
                width: `${(navigation.stepNumber / navigation.stepCount) * 100}%`,
              },
            ]}
          />
        </View>
      </View>
      <View style={[styles.step, { borderColor: colors.border, backgroundColor: colors.card }]}> 
        <View style={[styles.stepNumber, { backgroundColor: colors.primary }]}> 
          <Text style={{ color: colors.buttonText, fontWeight: '800' }}>{navigation.stepNumber}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text accessibilityRole="header" style={[styles.stepTitle, { color: colors.text }]}>{step.title}</Text>
          <Text style={[styles.stepBody, { color: colors.textSecondary }]}>{step.body}</Text>
        </View>
      </View>
      <View style={[styles.boundary, { borderColor: colors.primary }]}> 
        <Text style={[styles.boundaryTitle, { color: colors.primary }]}>Your role boundary</Text>
        <Text style={{ color: colors.text, lineHeight: 20 }}>{model.boundary}</Text>
      </View>
      {saveError ? <Text accessibilityRole="alert" style={{ color: colors.error, marginTop: spacing[4] }}>{saveError}</Text> : null}
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous role tour step"
          accessibilityState={{ disabled: !navigation.canGoBack || saving }}
          disabled={!navigation.canGoBack || saving}
          onPress={() => move('back')}
          style={[
            styles.navigationButton,
            styles.backButton,
            { borderColor: colors.border, opacity: navigation.canGoBack && !saving ? 1 : 0.45 },
          ]}
        >
          <Text style={{ color: colors.text, fontWeight: '800' }}>Back</Text>
        </Pressable>
        {navigation.canGoNext ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next role tour step"
            accessibilityState={{ disabled: saving, busy: saving }}
            disabled={saving}
            onPress={() => move('next')}
            style={[styles.navigationButton, { backgroundColor: colors.primary, opacity: saving ? 0.6 : 1 }]}
          >
            <Text style={{ color: colors.buttonText, fontWeight: '800' }}>Next</Text>
          </Pressable>
        ) : null}
        {navigation.canFinish ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: saving, busy: saving }}
            disabled={saving}
            onPress={() => void finish()}
            style={[styles.navigationButton, { backgroundColor: colors.primary, opacity: saving ? 0.6 : 1 }]}
          >
            {saving ? <ActivityIndicator color={colors.buttonText} /> : <Text style={{ color: colors.buttonText, fontWeight: '800' }}>Finish role tour</Text>}
          </Pressable>
        ) : null}
      </View>
      {saveError ? (
        <Pressable accessibilityRole="button" onPress={() => setVisible(false)} style={styles.continueButton}>
          <Text style={{ color: colors.primary, fontWeight: '700' }}>Continue without saving</Text>
        </Pressable>
      ) : null}
    </BaseModal>
  );
}

const styles = StyleSheet.create({
  summary: { fontSize: typography.base, lineHeight: 23, marginBottom: spacing[4] },
  progressHeader: { marginBottom: spacing[4] },
  progressLabel: { fontSize: typography.sm, fontWeight: '800', marginBottom: spacing[2] },
  progressTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },
  step: { flexDirection: 'row', gap: spacing[3], padding: spacing[4], borderWidth: 1, borderRadius: 12, marginBottom: spacing[3], minHeight: 132 },
  stepNumber: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  stepTitle: { fontSize: typography.base, fontWeight: '800' },
  stepBody: { lineHeight: 20, marginTop: 3 },
  boundary: { borderLeftWidth: 4, paddingLeft: spacing[3], marginTop: spacing[2] },
  boundaryTitle: { fontWeight: '800', marginBottom: 3 },
  actions: { flexDirection: 'row', gap: spacing[3], marginTop: spacing[5], marginBottom: spacing[4] },
  navigationButton: { flex: 1, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing[4] },
  backButton: { borderWidth: 1 },
  continueButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginBottom: spacing[4] },
});
