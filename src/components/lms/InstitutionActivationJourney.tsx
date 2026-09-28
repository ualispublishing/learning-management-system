/**
 * @fileoverview src/components/lms/InstitutionActivationJourney.tsx.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  ACTIVATION_PREFLIGHT_CHECKS,
  ACTIVATION_STEPS,
  ActivationDataSource,
  ActivationIdentityProvider,
  ActivationOrganizationType,
  ActivationRegion,
  buildTenantPreview,
  createInstitutionActivationDraft,
  getActivationStepError,
  INSTITUTION_ACTIVATION_STORAGE_KEY,
  InstitutionActivationDraft,
  normalizeActivationStepIndex,
  parseInstitutionActivationDraft,
} from '../../lib/institutionActivation';
import { spacing, typography } from '../../lib/theme';
import { useThemeColors } from '../../lib/useThemeColors';
import { BaseModal } from './BaseModal';

interface InstitutionActivationJourneyProps {
  visible: boolean;
  onClose: () => void;
}

interface Choice<T extends string | number> {
  value: T;
  label: string;
  detail?: string;
}

const ORGANIZATION_TYPES: readonly Choice<ActivationOrganizationType>[] = [
  { value: 'education', label: 'Education institution', detail: 'School, district, college, or university' },
  { value: 'business', label: 'Business or nonprofit', detail: 'Workforce, partner, or customer learning' },
];

const REGIONS: readonly Choice<ActivationRegion>[] = [
  { value: 'canada', label: 'Canada' },
  { value: 'united-states', label: 'United States' },
  { value: 'european-union', label: 'European Union' },
  { value: 'other', label: 'Other / multiple' },
];

const IDENTITY_PROVIDERS: readonly Choice<ActivationIdentityProvider>[] = [
  { value: 'oidc', label: 'OpenID Connect', detail: 'Recommended for modern identity platforms' },
  { value: 'saml', label: 'SAML 2.0', detail: 'Server-mediated exchange for an existing enterprise IdP' },
];

const DATA_SOURCES: readonly Choice<ActivationDataSource>[] = [
  { value: 'oneroster', label: 'OneRoster / SIS', detail: 'Courses, people, sections, and enrollments' },
  { value: 'existing-lms', label: 'Existing LMS gateway', detail: 'Canonical snapshot and mutation adapter' },
  { value: 'hris', label: 'HRIS / directory', detail: 'Teams, roles, and workforce learning groups' },
  { value: 'secure-csv', label: 'Secure CSV pilot', detail: 'A bounded pilot before an automated connection' },
];

const PILOT_SIZES: readonly Choice<50 | 250 | 1000>[] = [
  { value: 50, label: '50 people' },
  { value: 250, label: '250 people' },
  { value: 1000, label: '1,000 people' },
];

const dataSourceAllowed = (organizationType: ActivationOrganizationType, source: ActivationDataSource) =>
  organizationType === 'education' ? source !== 'hris' : source !== 'oneroster';

function ChoiceGrid<T extends string | number>({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: T;
  choices: readonly Choice<T>[];
  onChange: (value: T) => void;
}) {
  const colors = useThemeColors();
  return (
    <View style={styles.fieldGroup} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <Text style={[styles.fieldLabel, { color: colors.text }]}>{label}</Text>
      <View style={styles.choiceGrid}>
        {choices.map(choice => {
          const selected = value === choice.value;
          return (
            <Pressable
              key={String(choice.value)}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={`${label}: ${choice.label}`}
              onPress={() => onChange(choice.value)}
              style={({ pressed }) => [
                styles.choice,
                {
                  borderColor: selected ? colors.primary : colors.border,
                  backgroundColor: selected ? `${colors.primary}12` : colors.card,
                  opacity: pressed ? 0.78 : 1,
                },
              ]}
            >
              <View style={[styles.radio, { borderColor: selected ? colors.primary : colors.textSecondary }]}>
                {selected ? <View style={[styles.radioDot, { backgroundColor: colors.primary }]} /> : null}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.choiceTitle, { color: colors.text }]}>{choice.label}</Text>
                {choice.detail ? <Text style={[styles.choiceDetail, { color: colors.textSecondary }]}>{choice.detail}</Text> : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function InstitutionActivationJourney({ visible, onClose }: InstitutionActivationJourneyProps) {
  const colors = useThemeColors();
  const [draft, setDraft] = useState<InstitutionActivationDraft>(createInstitutionActivationDraft);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const checkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    void AsyncStorage.getItem(INSTITUTION_ACTIVATION_STORAGE_KEY)
      .then(source => {
        if (!active) return;
        setError('');
        if (!source) {
          setDraft(createInstitutionActivationDraft());
          return;
        }
        try {
          setDraft(parseInstitutionActivationDraft(JSON.parse(source)) ?? createInstitutionActivationDraft());
        } catch {
          setDraft(createInstitutionActivationDraft());
        }
      })
      .catch(() => {
        if (active) setError('The saved demo activation draft could not be loaded. A new local draft was opened.');
      })
      .finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [visible]);

  useEffect(() => () => {
    if (checkTimerRef.current) clearTimeout(checkTimerRef.current);
  }, []);

  const updateDraft = <K extends keyof InstitutionActivationDraft>(key: K, value: InstitutionActivationDraft[K]) => {
    setError('');
    setDraft(current => {
      const next = { ...current, [key]: value, updatedAt: Date.now() };
      if (key === 'organizationType' && !dataSourceAllowed(value as ActivationOrganizationType, next.dataSource)) {
        next.dataSource = value === 'business' ? 'hris' : 'oneroster';
      }
      next.preflightCompleted = false;
      next.activated = false;
      return next;
    });
  };

  const persist = async (nextDraft: InstitutionActivationDraft) => {
    setSaving(true);
    try {
      await AsyncStorage.setItem(INSTITUTION_ACTIVATION_STORAGE_KEY, JSON.stringify(nextDraft));
      setDraft(nextDraft);
      return true;
    } catch {
      setError('This demo draft could not be saved locally. Check browser storage and retry.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const move = async (direction: -1 | 1) => {
    if (saving || checking) return;
    if (direction === 1) {
      const validationError = getActivationStepError(draft);
      if (validationError) {
        setError(validationError);
        return;
      }
    }
    const nextIndex = normalizeActivationStepIndex(draft.stepIndex + direction);
    setError('');
    await persist({ ...draft, stepIndex: nextIndex, updatedAt: Date.now() });
  };

  const runPreflight = () => {
    if (checking || saving) return;
    setChecking(true);
    setError('');
    checkTimerRef.current = setTimeout(() => {
      checkTimerRef.current = null;
      setChecking(false);
      setDraft(current => ({ ...current, preflightCompleted: true, activated: false, updatedAt: Date.now() }));
    }, 650);
  };

  const activate = async () => {
    if (saving || checking) return;
    const validationError = getActivationStepError(draft, 4);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError('');
    await persist({ ...draft, activated: true, updatedAt: Date.now() });
  };

  const reset = async () => {
    if (saving || checking) return;
    setSaving(true);
    setError('');
    try {
      await AsyncStorage.removeItem(INSTITUTION_ACTIVATION_STORAGE_KEY);
      setDraft(createInstitutionActivationDraft());
    } catch {
      setError('The local activation demo could not be reset.');
    } finally {
      setSaving(false);
    }
  };

  const step = ACTIVATION_STEPS[normalizeActivationStepIndex(draft.stepIndex)];
  const tenantPreview = buildTenantPreview(draft.organizationName);
  const allowedDataSources = DATA_SOURCES.filter(choice => dataSourceAllowed(draft.organizationType, choice.value));

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      closeDisabled={saving || checking}
      isLoading={!loaded}
      title={draft.activated ? 'Pilot workspace activated' : 'Organization activation'}
    >
      <View style={[styles.demoNotice, { borderColor: colors.warning, backgroundColor: `${colors.warning}16` }]}> 
        <Ionicons name="flask-outline" size={20} color={colors.warning} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
        <View style={{ flex: 1 }}>
          <Text style={[styles.noticeTitle, { color: colors.text }]}>Interactive activation simulation</Text>
          <Text style={[styles.noticeBody, { color: colors.textSecondary }]}>No tenant, identity connection, contract, or learner record is created. A production deployment owner completes these stages in a protected deployment console.</Text>
        </View>
      </View>

      {!draft.activated ? (
        <>
          <View style={styles.progressHeader}>
            <Text accessibilityLiveRegion="polite" style={[styles.progressLabel, { color: colors.primary }]}>Step {draft.stepIndex + 1} of {ACTIVATION_STEPS.length} · {step.shortLabel}</Text>
            <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: ACTIVATION_STEPS.length, now: draft.stepIndex + 1 }} style={[styles.progressTrack, { backgroundColor: colors.border }]}> 
              <View style={[styles.progressFill, { backgroundColor: colors.primary, width: `${((draft.stepIndex + 1) / ACTIVATION_STEPS.length) * 100}%` }]} />
            </View>
          </View>

          <Text accessibilityRole="header" aria-level={2} style={[styles.stepTitle, { color: colors.text }]}>{step.title}</Text>

          {step.id === 'organization' ? (
            <View>
              <Text style={[styles.intro, { color: colors.textSecondary }]}>The sponsor identifies the legal organization, accountable owner, hosting region, and intended learning context before technical access is provisioned.</Text>
              <ChoiceGrid label="Organization type" value={draft.organizationType} choices={ORGANIZATION_TYPES} onChange={value => updateDraft('organizationType', value)} />
              <Text style={[styles.fieldLabel, { color: colors.text }]}>Organization name</Text>
              <TextInput accessibilityLabel="Organization name" value={draft.organizationName} onChangeText={value => updateDraft('organizationName', value)} maxLength={120} placeholder={draft.organizationType === 'education' ? 'Northstar University' : 'Northstar Learning'} placeholderTextColor={colors.textSecondary} style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]} />
              <Text style={[styles.fieldLabel, { color: colors.text }]}>Deployment owner</Text>
              <TextInput accessibilityLabel="Deployment owner name" value={draft.ownerName} onChangeText={value => updateDraft('ownerName', value)} maxLength={120} placeholder="Jordan Lee" placeholderTextColor={colors.textSecondary} style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]} />
              <TextInput accessibilityLabel="Deployment owner work email" value={draft.ownerEmail} onChangeText={value => updateDraft('ownerEmail', value)} maxLength={254} keyboardType="email-address" autoCapitalize="none" placeholder="jordan@organization.example" placeholderTextColor={colors.textSecondary} style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]} />
              <ChoiceGrid label="Primary data region" value={draft.region} choices={REGIONS} onChange={value => updateDraft('region', value)} />
            </View>
          ) : null}

          {step.id === 'identity' ? (
            <View>
              <Text style={[styles.intro, { color: colors.textSecondary }]}>The identity team supplies a tenant-bound SSO configuration. The app never asks an administrator to paste signing secrets into the learner client.</Text>
              <ChoiceGrid label="Identity protocol" value={draft.identityProvider} choices={IDENTITY_PROVIDERS} onChange={value => updateDraft('identityProvider', value)} />
              <Text style={[styles.fieldLabel, { color: colors.text }]}>{draft.identityProvider === 'oidc' ? 'OIDC issuer URL' : 'SAML metadata URL'}</Text>
              <TextInput accessibilityLabel={draft.identityProvider === 'oidc' ? 'OIDC issuer URL' : 'SAML metadata URL'} value={draft.identityDomain} onChangeText={value => updateDraft('identityDomain', value)} autoCapitalize="none" autoCorrect={false} keyboardType="url" maxLength={2048} placeholder="https://login.organization.example/tenant" placeholderTextColor={colors.textSecondary} style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]} />
              <View style={[styles.boundary, { borderColor: colors.primary }]}>
                <Text style={[styles.boundaryTitle, { color: colors.primary }]}>Production boundary</Text>
                <Text style={{ color: colors.text, lineHeight: 20 }}>Issuer discovery, redirect URIs, key rotation, logout, token audience, and tenant isolation are verified server-side before activation.</Text>
              </View>
            </View>
          ) : null}

          {step.id === 'data' ? (
            <View>
              <Text style={[styles.intro, { color: colors.textSecondary }]}>Select the system that owns people, memberships, and learning structure. Provider-specific mapping happens behind the authenticated gateway.</Text>
              <ChoiceGrid label="Authoritative source" value={draft.dataSource} choices={allowedDataSources} onChange={value => updateDraft('dataSource', value)} />
              <ChoiceGrid label="Pilot cohort" value={draft.pilotCohortSize} choices={PILOT_SIZES} onChange={value => updateDraft('pilotCohortSize', value)} />
              <View style={[styles.boundary, { borderColor: colors.primary }]}>
                <Text style={[styles.boundaryTitle, { color: colors.primary }]}>Previewed sync contract</Text>
                <Text style={{ color: colors.text, lineHeight: 20 }}>Stable IDs, explicit role mappings, atomic validation, cursor-based reconciliation, and principal-scoped records. The simulation does not read a real roster.</Text>
              </View>
            </View>
          ) : null}

          {step.id === 'governance' ? (
            <View>
              <Text style={[styles.intro, { color: colors.textSecondary }]}>Activation requires named internal owners. These selections acknowledge responsibility; they are not legal approvals.</Text>
              {([
                ['securityOwnerConfirmed', 'Security owner assigned', 'Owns tenant isolation, access, incident response, and evidence.'],
                ['privacyOwnerConfirmed', 'Privacy owner assigned', 'Owns data flow, retention, consent, residency, and deletion.'],
                ['accessibilityOwnerConfirmed', 'Accessibility owner assigned', 'Owns keyboard, screen-reader, zoom, device, and content acceptance.'],
              ] as const).map(([key, title, detail]) => {
                const selected = draft[key];
                return (
                  <Pressable key={key} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} onPress={() => updateDraft(key, !selected)} style={[styles.checkChoice, { borderColor: selected ? colors.success : colors.border, backgroundColor: colors.card }]}> 
                    <Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={23} color={selected ? colors.success : colors.textSecondary} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.choiceTitle, { color: colors.text }]}>{title}</Text>
                      <Text style={[styles.choiceDetail, { color: colors.textSecondary }]}>{detail}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          {step.id === 'preflight' ? (
            <View>
              <Text style={[styles.intro, { color: colors.textSecondary }]}>Run the deterministic demo preflight to see what the deployment team verifies before a limited pilot. Production uses real provider evidence and manual approvals.</Text>
              <View style={[styles.preflightPanel, { backgroundColor: colors.card, borderColor: colors.border }]}> 
                {ACTIVATION_PREFLIGHT_CHECKS.map(check => (
                  <View key={check} style={styles.preflightRow}>
                    <Ionicons name={draft.preflightCompleted ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={draft.preflightCompleted ? colors.success : colors.textSecondary} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
                    <Text style={{ color: colors.text, flex: 1, lineHeight: 20 }}>{check}</Text>
                  </View>
                ))}
              </View>
              <Pressable disabled={checking || draft.preflightCompleted} accessibilityRole="button" accessibilityState={{ disabled: checking || draft.preflightCompleted, busy: checking }} onPress={runPreflight} style={[styles.secondaryButton, { borderColor: colors.primary, opacity: checking || draft.preflightCompleted ? 0.65 : 1 }]}> 
                {checking ? <ActivityIndicator color={colors.primary} /> : <Text style={{ color: colors.primary, fontWeight: '800' }}>{draft.preflightCompleted ? 'Demo preflight passed' : 'Run pilot preflight'}</Text>}
              </Pressable>
            </View>
          ) : null}

          {step.id === 'activate' ? (
            <View>
              <Text style={[styles.intro, { color: colors.textSecondary }]}>Review the deployment handoff. In production, activation stays blocked until the provider evidence and six institutional approvals are complete.</Text>
              <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}> 
                <Text style={[styles.summaryName, { color: colors.text }]}>{draft.organizationName}</Text>
                <Text style={[styles.summaryTenant, { color: colors.primary }]}>{tenantPreview}.learning.example</Text>
                <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
                <Text style={[styles.summaryLine, { color: colors.textSecondary }]}>Owner · {draft.ownerName} ({draft.ownerEmail})</Text>
                <Text style={[styles.summaryLine, { color: colors.textSecondary }]}>Identity · {draft.identityProvider.toUpperCase()} via {draft.identityDomain}</Text>
                <Text style={[styles.summaryLine, { color: colors.textSecondary }]}>Source · {DATA_SOURCES.find(source => source.value === draft.dataSource)?.label}</Text>
                <Text style={[styles.summaryLine, { color: colors.textSecondary }]}>Pilot · {draft.pilotCohortSize.toLocaleString()} people · {REGIONS.find(region => region.value === draft.region)?.label}</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityHint="Completes only the local activation simulation" accessibilityState={{ disabled: saving, busy: saving }} disabled={saving} onPress={() => void activate()} style={[styles.activateButton, { backgroundColor: colors.success, opacity: saving ? 0.65 : 1 }]}> 
                {saving ? <ActivityIndicator color={colors.onSuccess} /> : <Text style={{ color: colors.onSuccess, fontWeight: '900' }}>Activate simulated pilot</Text>}
              </Pressable>
            </View>
          ) : null}

          {error ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.error }]}>{error}</Text> : null}

          <View style={styles.actions}>
            <Pressable accessibilityRole="button" accessibilityState={{ disabled: draft.stepIndex === 0 || saving || checking }} disabled={draft.stepIndex === 0 || saving || checking} onPress={() => void move(-1)} style={[styles.navigationButton, { borderColor: colors.border, opacity: draft.stepIndex === 0 || saving || checking ? 0.45 : 1 }]}> 
              <Text style={{ color: colors.text, fontWeight: '800' }}>Back</Text>
            </Pressable>
            {draft.stepIndex < ACTIVATION_STEPS.length - 1 ? (
              <Pressable accessibilityRole="button" accessibilityState={{ disabled: saving || checking, busy: saving }} disabled={saving || checking} onPress={() => void move(1)} style={[styles.navigationButton, { backgroundColor: colors.primary, opacity: saving || checking ? 0.6 : 1 }]}> 
                {saving ? <ActivityIndicator color={colors.buttonText} /> : <Text style={{ color: colors.buttonText, fontWeight: '800' }}>Save and continue</Text>}
              </Pressable>
            ) : null}
          </View>
        </>
      ) : (
        <View style={styles.completion}>
          <View style={[styles.completionIcon, { backgroundColor: `${colors.success}20` }]}> 
            <Ionicons name="checkmark" size={38} color={colors.success} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
          </View>
          <Text accessibilityRole="header" aria-level={2} style={[styles.completionTitle, { color: colors.text }]}>The simulated pilot is ready</Text>
          <Text style={[styles.completionBody, { color: colors.textSecondary }]}>The deployment owner would now invite the bounded pilot cohort, monitor the first sync, test each role, and collect support and accessibility feedback.</Text>
          <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border, width: '100%' }]}> 
            <Text style={[styles.summaryTenant, { color: colors.primary }]}>{tenantPreview}.learning.example</Text>
            <Text style={[styles.summaryLine, { color: colors.textSecondary }]}>Pilot capacity · {draft.pilotCohortSize.toLocaleString()}</Text>
            <Text style={[styles.summaryLine, { color: colors.textSecondary }]}>Next gate · production evidence and institutional approvals</Text>
          </View>
          <View style={styles.completionActions}>
            <Pressable accessibilityRole="button" onPress={onClose} style={[styles.navigationButton, { borderColor: colors.border }]}><Text style={{ color: colors.text, fontWeight: '800' }}>Return to LMS</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Restart activation simulation" accessibilityState={{ disabled: saving, busy: saving }} disabled={saving} onPress={() => void reset()} style={[styles.navigationButton, { backgroundColor: colors.primary, opacity: saving ? 0.65 : 1 }]}><Text style={{ color: colors.buttonText, fontWeight: '800' }}>Start over</Text></Pressable>
          </View>
          {error ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.error }]}>{error}</Text> : null}
        </View>
      )}
    </BaseModal>
  );
}

const styles = StyleSheet.create({
  demoNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3], borderWidth: 1, borderRadius: 12, padding: spacing[3], marginBottom: spacing[5] },
  noticeTitle: { fontWeight: '800' },
  noticeBody: { fontSize: typography.sm, lineHeight: 19, marginTop: 2 },
  progressHeader: { marginBottom: spacing[5] },
  progressLabel: { fontSize: typography.sm, fontWeight: '800', marginBottom: spacing[2] },
  progressTrack: { height: 7, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 4 },
  stepTitle: { fontSize: typography.xl, fontWeight: '900', marginBottom: spacing[2] },
  intro: { lineHeight: 22, marginBottom: spacing[5] },
  fieldGroup: { marginBottom: spacing[5] },
  fieldLabel: { fontSize: typography.sm, fontWeight: '800', marginBottom: spacing[2] },
  choiceGrid: { gap: spacing[2] },
  choice: { minHeight: 58, borderWidth: 1, borderRadius: 12, padding: spacing[3], flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  choiceTitle: { fontWeight: '800', lineHeight: 20 },
  choiceDetail: { fontSize: typography.sm, lineHeight: 18, marginTop: 2 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 10, paddingHorizontal: spacing[3], marginBottom: spacing[4], fontSize: typography.base },
  boundary: { borderLeftWidth: 4, paddingLeft: spacing[3], marginTop: spacing[2], marginBottom: spacing[4] },
  boundaryTitle: { fontWeight: '800', marginBottom: 3 },
  checkChoice: { minHeight: 72, flexDirection: 'row', gap: spacing[3], alignItems: 'center', borderWidth: 1, borderRadius: 12, padding: spacing[3], marginBottom: spacing[3] },
  preflightPanel: { borderWidth: 1, borderRadius: 12, padding: spacing[4], gap: spacing[3] },
  preflightRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3] },
  secondaryButton: { minHeight: 48, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: spacing[4] },
  summaryCard: { borderWidth: 1, borderRadius: 14, padding: spacing[4] },
  summaryName: { fontSize: typography.lg, fontWeight: '900' },
  summaryTenant: { fontWeight: '800', marginTop: 4 },
  summaryDivider: { height: 1, marginVertical: spacing[3] },
  summaryLine: { lineHeight: 21, marginTop: 4 },
  activateButton: { minHeight: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: spacing[4] },
  error: { marginTop: spacing[4], fontWeight: '700', lineHeight: 20 },
  actions: { flexDirection: 'row', gap: spacing[3], marginTop: spacing[6], paddingBottom: spacing[4] },
  navigationButton: { flex: 1, minHeight: 48, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing[3] },
  completion: { alignItems: 'center', paddingBottom: spacing[5] },
  completionIcon: { width: 70, height: 70, borderRadius: 35, alignItems: 'center', justifyContent: 'center', marginTop: spacing[2] },
  completionTitle: { fontSize: typography['2xl'], fontWeight: '900', textAlign: 'center', marginTop: spacing[4] },
  completionBody: { lineHeight: 22, textAlign: 'center', marginVertical: spacing[4] },
  completionActions: { width: '100%', flexDirection: 'row', gap: spacing[3], marginTop: spacing[5] },
});
