/**
 * @fileoverview Role-aware course list and demo/institution review controls.
 *
 * Reviewer notes:
 * - Groups courses by lifecycle and launches the modal surfaces attached to a
 *   selected course.
 * - Contains development-only demo identity switching and JSON import tooling.
 * - Production ingestion must remain on authenticated institution sync, not the
 *   browser-local import path.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { useLMSStore } from '../../lib/store/useLMSStore';
import { useThemeColors } from '../../lib/useThemeColors';
import { CourseCard, AnnouncementPopup, CourseGradingModal, SyllabusModal, AnalyticsModal, CourseSettingsModal, StudentInfoModal, ContactInfoModal, StudentGradesModal } from './LMSComponents';
import { Course } from '../../types/lms';
import { formatValidationIssues, ValidationIssue } from '../../lib/schema/CourseSchema';
import { hasCoursePermission } from '../../lib/authorization/coursePermissions';
import { utf8ByteLength } from '../../lib/utf8';
import { getCourseLifecyclePhase, isCoursePastAt } from '../../lib/courseLifecycle';
import { isSharedDemoMode } from '../../lib/repositories/remote/SharedDemoRepositoryFactory';
import { DEMO_ACCOUNTS } from '../../lib/demoAccounts';
import { RoleOnboardingModal } from './RoleOnboardingModal';
import { InstitutionActivationJourney } from './InstitutionActivationJourney';

export const CourseList = () => {
  const colors = useThemeColors();
  const {
    courses,
    currentUserId,
    currentUserRole,
    login,
    initializeMocks,
    importInstitutionPayload,
    institutionDataSource,
    institutionDataWarning,
    clearInstitutionDataWarning,
  } = useLMSStore();

  const [now, setNow] = useState(() => Date.now());
  const upcomingCourses = courses.filter(course => getCourseLifecyclePhase(course, now) === 'future');
  const activeCourses = courses.filter(course => getCourseLifecyclePhase(course, now) === 'active');
  const pastCourses = courses.filter(course => isCoursePastAt(course, now));

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const [activeModal, setActiveModal] = useState<string | null>(null);
  const [activeCourseId, setActiveCourseId] = useState<string | null>(null);
  const activeCourse = courses.find(course => course.id === activeCourseId) || null;
  const [importVisible, setImportVisible] = useState(false);
  const [importJSON, setImportJSON] = useState('');
  const [importFileName, setImportFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [importSummary, setImportSummary] = useState('');
  const [demoLoginError, setDemoLoginError] = useState('');
  const [switchingDemoEmail, setSwitchingDemoEmail] = useState<string | null>(null);
  const [onboardingReplayNonce, setOnboardingReplayNonce] = useState(0);
  const [activationJourneyVisible, setActivationJourneyVisible] = useState(false);
  const demoSwitchInFlightRef = useRef(false);
  const pickerInFlightRef = useRef(false);
  const importInFlightRef = useRef(false);

  const handleActionPress = (action: string, course: Course) => {
    setActiveCourseId(course.id);
    setActiveModal(action);
  };

  const closeModals = () => {
    setActiveModal(null);
  };

  const switchDemoAccount = async (email: string) => {
    if (demoSwitchInFlightRef.current) return;
    demoSwitchInFlightRef.current = true;
    setSwitchingDemoEmail(email);
    setDemoLoginError('');
    try {
      await login(email);
      await initializeMocks();
    } catch (error) {
      setDemoLoginError(error instanceof Error ? error.message : 'The demo account could not be loaded.');
    } finally {
      demoSwitchInFlightRef.current = false;
      setSwitchingDemoEmail(null);
    }
  };
  // Browser/file imports mutate the local demo repository only. Production ingestion
  // belongs on the institution's authenticated, audited synchronization endpoint.
  const canImportInstitution = __DEV__ && courses.some(course => (
    hasCoursePermission(course.staff.find(member => member.id === currentUserId)?.role, 'manageCourse')
  ));

  const chooseInstitutionJSON = async () => {
    if (pickerInFlightRef.current || importInFlightRef.current) return;
    pickerInFlightRef.current = true;
    setImportError('');
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'application/json', copyToCacheDirectory: true, multiple: false });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) throw new Error('The selected institution JSON file could not be read.');
      if (asset.size && asset.size > 10 * 1024 * 1024) {
        setImportError('Institution JSON files are limited to 10 MB on the client. Use the synchronization API for larger datasets.');
        return;
      }
      const source = Platform.OS === 'web'
        ? await (() => {
            if (!asset.file) throw new Error('The browser did not provide the selected institution JSON bytes. Choose the file again.');
            if (asset.file.size > 10 * 1024 * 1024) throw new Error('Institution JSON files are limited to 10 MB on the client. Use the synchronization API for larger datasets.');
            return asset.file.text();
          })()
        : await FileSystem.readAsStringAsync(asset.uri);
      if (utf8ByteLength(source) > 10 * 1024 * 1024) {
        setImportError('Institution JSON files are limited to 10 MB on the client. Use the synchronization API for larger datasets.');
        return;
      }
      setImportJSON(source);
      setImportFileName(asset.name);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'The institution JSON picker could not be opened.');
    } finally {
      pickerInFlightRef.current = false;
    }
  };

  const runInstitutionImport = async () => {
    if (importInFlightRef.current || pickerInFlightRef.current) return;
    importInFlightRef.current = true;
    setImporting(true);
    setImportError('');
    setImportSummary('');
    try {
      if (utf8ByteLength(importJSON) > 10 * 1024 * 1024) {
        setImportError('Institution JSON is limited to 10 MB on the client. Use the synchronization API for larger datasets.');
        return;
      }
      let payload: unknown;
      try {
        payload = JSON.parse(importJSON);
      } catch {
        setImportError('The selected text is not valid JSON.');
        return;
      }
      const report = await importInstitutionPayload(payload);
      const counts = report.counts;
      setImportSummary(`Imported ${counts.users} users, ${counts.courses} courses, ${counts.contentItems} content items, ${counts.threads} threads, ${counts.messages} messages, and ${counts.submissions} submissions.`);
    } catch (error) {
      const issues = (error as Error & { issues?: ValidationIssue[] }).issues;
      setImportError(issues?.length ? formatValidationIssues(issues) : error instanceof Error ? error.message : 'Institution import failed.');
    } finally {
      importInFlightRef.current = false;
      setImporting(false);
    }
  };

  const closeInstitutionImport = () => {
    if (importInFlightRef.current || pickerInFlightRef.current) return;
    setImportVisible(false);
  };

  return (
    <View style={styles.container}>
      <RoleOnboardingModal principalId={currentUserId} role={currentUserRole} replayNonce={onboardingReplayNonce} />
      {__DEV__ && (
        <>
        <View style={[styles.roleSwitcher, { backgroundColor: colors.card, borderColor: colors.border }]}> 
          {isSharedDemoMode && (
            <Text accessibilityLiveRegion="polite" style={{ color: colors.primary, fontWeight: 'bold', marginBottom: 6 }}>
              Shared multi-user server connected. Other signed-in test sessions receive these changes.
            </Text>
          )}
          <Text style={{ color: colors.textSecondary, marginBottom: 5 }}>Demo identity:</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {DEMO_ACCOUNTS.map(account => (
            <TouchableOpacity 
              key={account.email}
              disabled={switchingDemoEmail !== null}
              onPress={() => void switchDemoAccount(account.email)}
              style={[styles.roleBtn, { backgroundColor: 'transparent', borderColor: colors.primary, opacity: switchingDemoEmail && switchingDemoEmail !== account.email ? 0.5 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel={`Switch demo identity to ${account.label}`}
              accessibilityState={{ selected: currentUserId === account.id, disabled: switchingDemoEmail !== null }}
            >
              <Text style={{ color: colors.primary }}>{switchingDemoEmail === account.email ? 'Loading…' : account.label}</Text>
            </TouchableOpacity>
          ))}
          </View>
          <TouchableOpacity
            onPress={() => setOnboardingReplayNonce(value => value + 1)}
            style={[styles.replayOnboardingButton, { borderColor: colors.border }]}
            accessibilityRole="button"
            accessibilityLabel="Replay role onboarding"
          >
            <Text style={{ color: colors.primary, fontWeight: '700' }}>Replay role onboarding</Text>
          </TouchableOpacity>
          {!!demoLoginError && <Text accessibilityRole="alert" style={{ color: colors.error, marginTop: 8 }}>{demoLoginError}</Text>}
        </View>
        <View style={[styles.activationCard, { backgroundColor: colors.card, borderColor: colors.border }]}> 
          <View style={{ flex: 1 }}>
            <Text accessibilityRole="header" aria-level={2} style={[styles.activationTitle, { color: colors.text }]}>Institution & business activation</Text>
            <Text style={[styles.activationBody, { color: colors.textSecondary }]}>Walk through the deployment-owner journey from organization registration to a bounded pilot handoff. Progress is saved only in this browser.</Text>
          </View>
          <TouchableOpacity
            onPress={() => setActivationJourneyVisible(true)}
            style={[styles.activationButton, { backgroundColor: colors.primary }]}
            accessibilityRole="button"
            accessibilityLabel="Open organization activation journey"
          >
            <Text style={{ color: colors.buttonText, fontWeight: '800' }}>Open activation journey</Text>
          </TouchableOpacity>
        </View>
        <InstitutionActivationJourney visible={activationJourneyVisible} onClose={() => setActivationJourneyVisible(false)} />
        </>
      )}

      {canImportInstitution && (
        <TouchableOpacity onPress={() => setImportVisible(true)} style={[styles.importButton, { borderColor: colors.primary }]} accessibilityRole="button">
          <Text style={{ color: colors.primary, fontWeight: 'bold' }}>Import institution JSON</Text>
        </TouchableOpacity>
      )}

      {!!institutionDataWarning && (
        <View
          accessibilityRole="alert"
          style={[
            styles.dataWarning,
            {
              backgroundColor: institutionDataSource === 'offline-cache' ? '#FFF4D6' : colors.card,
              borderColor: institutionDataSource === 'offline-cache' ? '#B26A00' : colors.border,
            },
          ]}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontWeight: 'bold' }}>
              {institutionDataSource === 'offline-cache' ? 'Offline institution data' : 'Institution data notice'}
            </Text>
            <Text style={{ color: colors.textSecondary, marginTop: 3 }}>{institutionDataWarning}</Text>
          </View>
          <TouchableOpacity onPress={clearInstitutionDataWarning} accessibilityRole="button" accessibilityLabel="Dismiss institution data notice">
            <Text style={{ color: colors.primary, fontWeight: 'bold', padding: 6 }}>Dismiss</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Render Announcements for active courses */}
      {activeCourses.map(c => (
        <AnnouncementPopup key={`announcement-${c.id}`} courseId={c.id} />
      ))}

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scrollContent}>
        {upcomingCourses.length > 0 && (
          <>
            <View style={styles.divider}>
              <View style={[styles.line, { backgroundColor: colors.border }]} />
              <Text style={[styles.dividerText, { color: colors.textSecondary }]}>Upcoming</Text>
              <View style={[styles.line, { backgroundColor: colors.border }]} />
            </View>
            {upcomingCourses.map(course => (
              <CourseCard key={course.id} course={course} onActionPress={handleActionPress} />
            ))}
          </>
        )}

        <View style={styles.divider}>
          <View style={[styles.line, { backgroundColor: colors.border }]} />
          <Text style={[styles.dividerText, { color: colors.textSecondary }]}>Current</Text>
          <View style={[styles.line, { backgroundColor: colors.border }]} />
        </View>

        {activeCourses.map(course => (
          <CourseCard key={course.id} course={course} onActionPress={handleActionPress} />
        ))}
        {activeCourses.length === 0 && (
          <Text accessibilityLiveRegion="polite" style={[styles.emptyCourses, { color: colors.textSecondary }]}>No current courses are assigned to this account.</Text>
        )}

        <View style={[styles.divider, { marginTop: 20 }]}>
          <View style={[styles.line, { backgroundColor: colors.border }]} />
          <Text style={[styles.dividerText, { color: colors.textSecondary }]}>Past</Text>
          <View style={[styles.line, { backgroundColor: colors.border }]} />
        </View>

        {pastCourses.map(course => (
          <CourseCard key={course.id} course={course} onActionPress={handleActionPress} />
        ))}
        {pastCourses.length === 0 && (
          <Text accessibilityLiveRegion="polite" style={[styles.emptyCourses, { color: colors.textSecondary }]}>No past courses are available.</Text>
        )}
      </ScrollView>

      {/* Centralized Modals (Strict Unmounting) */}
      {activeCourse && (
        <>
          {activeModal === 'grading' && <CourseGradingModal visible={true} onClose={closeModals} course={activeCourse} />}
          {activeModal === 'syllabus' && <SyllabusModal visible={true} onClose={closeModals} course={activeCourse} />}
          {activeModal === 'analytics' && <AnalyticsModal visible={true} onClose={closeModals} course={activeCourse} />}
          {activeModal === 'settings' && <CourseSettingsModal visible={true} onClose={closeModals} course={activeCourse} />}
          {activeModal === 'info' && <StudentInfoModal visible={true} onClose={closeModals} course={activeCourse} onOpenSettings={() => setActiveModal('settings')} />}
          {activeModal === 'contact' && <ContactInfoModal visible={true} onClose={closeModals} course={activeCourse} />}
          {activeModal === 'student_grades' && <StudentGradesModal visible={true} onClose={closeModals} course={activeCourse} />}
        </>
      )}

      <Modal visible={importVisible} transparent animationType="fade" onRequestClose={closeInstitutionImport}>
        <View style={styles.importOverlay}>
          <View style={[styles.importModal, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: colors.text, fontSize: 20, fontWeight: 'bold' }}>Import institution JSON</Text>
              <TouchableOpacity disabled={importing} onPress={closeInstitutionImport} accessibilityRole="button" accessibilityLabel="Close institution import" accessibilityState={{ disabled: importing, busy: importing }}><Text style={{ color: importing ? colors.textSecondary : colors.primary }}>Close</Text></TouchableOpacity>
            </View>
            <Text style={{ color: colors.textSecondary, marginTop: 8 }}>Imports are validated atomically against schema version 1.0. Invalid payloads do not partially update the LMS.</Text>
            <TouchableOpacity disabled={importing} onPress={() => void chooseInstitutionJSON()} style={[styles.fileButton, { borderColor: importing ? colors.border : colors.primary }]} accessibilityRole="button" accessibilityLabel="Choose institution JSON file" accessibilityState={{ disabled: importing, busy: importing }}>
              <Text style={{ color: colors.primary, fontWeight: 'bold' }}>{importFileName || 'Choose JSON file'}</Text>
            </TouchableOpacity>
            <TextInput
              accessibilityLabel="Institution JSON payload"
              value={importJSON}
              onChangeText={text => { setImportJSON(text); setImportFileName(''); }}
              placeholder="Or paste institution JSON here"
              placeholderTextColor={colors.textSecondary}
              style={[styles.jsonInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
              multiline
              editable={!importing}
            />
            {!!importError && <ScrollView style={{ maxHeight: 140 }}><Text selectable style={{ color: colors.error, fontFamily: 'monospace', fontSize: 12 }}>{importError}</Text></ScrollView>}
            {!!importSummary && <Text style={{ color: '#2E7D32', marginTop: 10 }}>{importSummary}</Text>}
            <TouchableOpacity disabled={!importJSON.trim() || importing} onPress={() => void runInstitutionImport()} style={[styles.runImportButton, { backgroundColor: importJSON.trim() && !importing ? colors.primary : colors.border }]} accessibilityRole="button" accessibilityLabel="Validate and import institution JSON" accessibilityState={{ disabled: !importJSON.trim() || importing, busy: importing }}>
              {importing
                ? <ActivityIndicator color={colors.textSecondary} />
                : <Text style={{ color: importJSON.trim() ? colors.buttonText : colors.textSecondary, fontWeight: 'bold' }}>Validate and import</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
  },
  scrollContent: {
    padding: 20,
    paddingTop: 10,
    paddingBottom: 100,
  },
  roleSwitcher: {
    padding: 15,
    marginHorizontal: 20,
    marginTop: 20,
    borderRadius: 12,
    borderWidth: 1,
  },
  dataWarning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    marginHorizontal: 20,
    marginTop: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  roleBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    marginRight: 10,
    marginBottom: 5,
  },
  replayOnboardingButton: { minHeight: 44, marginTop: 8, borderWidth: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  activationCard: { marginHorizontal: 20, marginTop: 12, borderWidth: 1, borderRadius: 14, padding: 16, gap: 14 },
  activationTitle: { fontSize: 18, fontWeight: '900' },
  activationBody: { lineHeight: 20, marginTop: 4 },
  activationButton: { minHeight: 46, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  importButton: { marginHorizontal: 20, marginTop: 10, padding: 12, borderWidth: 1, borderRadius: 10, alignItems: 'center' },
  importOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  importModal: { width: '100%', maxWidth: 720, maxHeight: '88%', padding: 20, borderWidth: 1, borderRadius: 16 },
  fileButton: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 8, padding: 13, alignItems: 'center', marginTop: 16 },
  jsonInput: { borderWidth: 1, borderRadius: 8, minHeight: 190, maxHeight: 320, padding: 12, textAlignVertical: 'top', marginTop: 12, fontFamily: 'monospace' },
  runImportButton: { padding: 14, borderRadius: 8, alignItems: 'center', marginTop: 16 },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 20,
  },
  line: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    marginHorizontal: 15,
    fontWeight: 'bold',
    letterSpacing: 1,
    fontSize: 12,
  },
  emptyCourses: {
    paddingHorizontal: 12,
    paddingVertical: 18,
    textAlign: 'center',
  },
});
