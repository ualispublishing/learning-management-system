/**
 * @fileoverview Course administration UI bundle.
 *
 * Reviewer notes:
 * - Hosts the larger LMS modal/card surfaces that share course context and
 *   store operations.
 * - Preserve explicit permission checks before instructor/admin-only actions.
 * - Treat AI-assisted syllabus extraction as draft input that requires source
 *   rights confirmation and human review before applying changes.
 */
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, View, Text, StyleSheet, TouchableOpacity, useWindowDimensions, TextInput, Platform, Pressable, Linking } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as DocumentPicker from 'expo-document-picker';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Course } from '../../types/lms';
import { PreparedSourcePicker, PreparedAccuracyNotice } from './PreparedSourcePicker';
import { isPreparedAIDemo, resolvePreparedDemoUrl } from '../../lib/ai/preparedDemo';
import { mapSyllabusToCourse } from '../../lib/ai/syllabusCourseMapping';
import { useThemeColors } from '../../lib/useThemeColors';
import { userAlert as Alert } from '../../lib/userAlert';
import { useLMSStore } from '../../lib/store/useLMSStore';
import { useSettingsStore } from '../../lib/store/useSettingsStore';
import { router } from 'expo-router';
import { AssessmentGrader } from './AssessmentGrader';
import { PollResults } from './PollResults';
import { ExternalGradeCreator } from './ExternalGradeCreator';
import { AIDocumentAsset, AIRequestError, assertConfiguredAISource, getAISourceSupport, extractValidatedSyllabus, recoverValidatedSyllabus, isValidISODate, SyllabusExtraction, SYLLABUS_PROMPT_VERSION } from '../../lib/ai';
import { hasCoursePermission } from '../../lib/authorization/coursePermissions';
import { getAssessmentMaxScore } from '../../lib/assessment/engine';
import { useCourseRole } from '../../lib/store/selectors';
import { BaseModal } from './BaseModal';
import { createEntityId } from '../../lib/id';
import { calculateCourseAnalytics } from '../../lib/analytics/courseAnalytics';
import { userBelongsToSubmissionGroup } from '../../lib/groups/courseGroups';
import { assertAssetMatchesAIProvenance, getAssetService, StoredAsset } from '../../lib/integration/assetService';
import { getSavedSyllabusDetails } from '../../lib/ai/savedSyllabusDetails';
import { CourseInformationView, SyllabusAdditionalFields } from './CourseInformationView';
import { SyllabusLineListInput } from './SyllabusLineListInput';
import { AISourceReviewNotice } from './AISourceReviewNotice';
import { AIGenerationAttribution } from './AIGenerationAttribution';
import { AIRequestRecoveryActions } from './AIRequestRecoveryActions';
import { AIRequestHistoryPicker } from './AIRequestHistoryPicker';
import { buildCourseAnnouncementChatRoute, selectCourseAnnouncementThread, selectNewestVisibleCoursePopupAnnouncement } from '../../lib/chat/announcements';
import { getCourseCardActionDescriptors } from '../../lib/courseCardActions';

const groupDraftsForCourse = (course: Course): Record<string, Record<string, string>> => Object.fromEntries(
  (course.groupSets || []).map(groupSet => [groupSet.id, Object.fromEntries(
    course.staff.filter(member => member.role === 'student').map(student => [
      student.id,
      groupSet.groups.find(group => group.memberIds.includes(student.id))?.name || '',
    ]),
  )]),
);

export const useModalLoader = (visible: boolean, delayMs: number = 20) => {
  void delayMs;
  return visible;
};

// 1. Announcements UI
export const AnnouncementPopup = ({ courseId }: { courseId: string }) => {
  const {
    courses,
    dismissedAnnouncements,
    dismissAnnouncement,
    threads,
    messages,
    fetchThreads,
    fetchMessages,
    subscribeToMessages,
    currentUserId,
    contentItems,
  } = useLMSStore();
  const { width, height } = useWindowDimensions();
  const course = courses.find(c => c.id === courseId);
  const announcementThreadSignature = threads
    .filter(thread => thread.courseId === courseId && thread.isAnnouncement)
    .map(thread => thread.id)
    .sort()
    .join('\u0000');
  useEffect(() => {
    if (!currentUserId) return;
    void fetchThreads(courseId, currentUserId).catch(() => undefined);
  }, [courseId, currentUserId, fetchThreads]);
  useEffect(() => {
    if (!currentUserId || !announcementThreadSignature) return;
    const threadIds = announcementThreadSignature.split('\u0000');
    const unsubscribe = threadIds.map(threadId => subscribeToMessages(threadId, currentUserId));
    threadIds.forEach(threadId => void fetchMessages(threadId, currentUserId).catch(() => undefined));
    return () => unsubscribe.forEach(stop => stop());
  }, [announcementThreadSignature, currentUserId, fetchMessages, subscribeToMessages]);
  if (!course) return null;
  // CourseList mounts one bridge per active course so each can independently
  // load its authorized announcement threads. Elect exactly one global popup to
  // avoid absolute-positioned course notices stacking on top of each other.
  const newestVisible = selectNewestVisibleCoursePopupAnnouncement(
    courses,
    threads,
    messages,
    dismissedAnnouncements,
    contentItems.filter(item => item.deletedAt !== undefined || item.metadata?.lmsAnnouncementActive === false).map(item => item.id),
  );
  if (!newestVisible || newestVisible.courseId !== courseId) return null;
  const announcement = newestVisible.announcement;
  const popupCourse = courses.find(candidate => candidate.id === newestVisible.courseId)!;
  const announcementThread = announcement.threadId
    ? threads.find(thread => thread.id === announcement.threadId)
    : selectCourseAnnouncementThread(popupCourse.id, threads);
  const isAlert = announcement.type === 'alert';
  
  const isMobile = width < 768;
  const popupWidth = isMobile ? '100%' : '70%';
  const popupHeight = isMobile ? height * 0.2 : height * 0.15;
  const bgColor = isAlert ? 'rgba(180, 35, 24, 0.98)' : 'rgba(184, 242, 197, 0.98)';
  const textColor = isAlert ? '#fff' : '#000';

  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion={isAlert ? 'assertive' : 'polite'}
      style={[styles.announcementContainer, { width: popupWidth, minHeight: popupHeight, backgroundColor: bgColor }]}
    > 
      <View style={styles.announcementContent}>
        <Text style={[styles.announcementTitle, { color: textColor }]}>
          <Ionicons name={isAlert ? "alert-circle" : "information-circle"} size={20} color={textColor} /> {popupCourse.title}: {announcement.title}
        </Text>
        <Text style={[styles.announcementText, { color: textColor }]} numberOfLines={2}>{announcement.content}</Text>
      </View>
      <View style={styles.announcementActions}>
        <TouchableOpacity 
          style={styles.announcementBtn} 
          onPress={() => announcement.dismissalAliases.forEach(dismissAnnouncement)}
          accessibilityRole="button"
          accessibilityLabel="Dismiss Announcement"
          accessibilityHint="Closes this announcement popup without navigating."
        >
          <Text style={[styles.announcementBtnText, { color: textColor }]}>Dismiss</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={styles.announcementBtn} 
          onPress={() => {
            announcement.dismissalAliases.forEach(dismissAnnouncement);
            router.push(buildCourseAnnouncementChatRoute(popupCourse.id, announcement, announcementThread));
          }}
          accessibilityRole="button"
          accessibilityLabel="View Announcement"
          accessibilityHint="Opens the course announcements chat to read the full details."
        >
          <Text style={[styles.announcementBtnText, { color: textColor, fontWeight: 'bold' }]}>View</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

// 2. Modals (Syllabus, Analytics, Settings, Info)
type SyllabusModalProps = { visible: boolean; onClose: () => void; course: Course };
export const SyllabusModal = (props: SyllabusModalProps) => <SyllabusEditor key={`${props.course.id}:${props.visible}`} {...props} />;

// A course/visibility change discards the editor and its pending recovery callbacks.
const SyllabusEditor = ({ visible, onClose, course }: SyllabusModalProps) => {
  const colors = useThemeColors();
  const updateCourse = useLMSStore(state => state.updateCourse);
  const sourceSupport = getAISourceSupport('syllabus');
  const currentUserRole = useCourseRole(course.id) ?? 'student';
  const canImport = hasCoursePermission(currentUserRole, 'manageCourse');
  const contentItems = useLMSStore(state => state.contentItems);
  const savedSyllabus = getSavedSyllabusDetails(course);
  const referencedGradingCategories = useMemo(() => Array.from(new Set(contentItems
    .filter(item => item.courseId === course.id && item.isGraded && item.gradingCategory)
    .map(item => item.gradingCategory!))), [contentItems, course.id]);
  const [document, setDocument] = useState<AIDocumentAsset | null>(null);
  const [extraction, setExtraction] = useState<SyllabusExtraction | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [analysisFailure, setAnalysisFailure] = useState<AIRequestError | null>(null);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceRightsConfirmed, setSourceRightsConfirmed] = useState(false);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [reviewerEditedFields, setReviewerEditedFields] = useState<string[]>([]);
  const [gradingWeightNameDrafts, setGradingWeightNameDrafts] = useState<Record<string, string>>({});
  const [storedSourceAsset, setStoredSourceAsset] = useState<StoredAsset | null>(null);
  const [sourceUploadKey, setSourceUploadKey] = useState(() => createEntityId('syllabus-source'));
  const analysisRevision = useRef(0);
  const analysisInFlightFor = useRef<string | null>(null);
  const applyInFlight = useRef(false);

  const editExtraction = (field: string, updates: Partial<SyllabusExtraction>) => {
    setExtraction(current => current ? { ...current, ...updates } : current);
    setReviewerEditedFields(current => current.includes(field) ? current : [...current, field]);
    setReviewConfirmed(false);
  };

  const renameGradingWeight = (oldLabel: string, requestedLabel: string): boolean => {
    if (!extraction?.gradingWeights) return false;
    const label = requestedLabel.trim();
    if (!label || label.length > 120) {
      setError('Grading category labels must contain 1 to 120 characters.');
      return false;
    }
    if (Object.keys(extraction.gradingWeights).some(existing => existing !== oldLabel && existing.toLocaleLowerCase() === label.toLocaleLowerCase())) {
      setError(`Grading category "${label}" already exists.`);
      return false;
    }
    const gradingWeights = Object.fromEntries(Object.entries(extraction.gradingWeights).map(([existing, weight]) => [existing === oldLabel ? label : existing, weight]));
    setError(null);
    editExtraction(`gradingWeights.${oldLabel}`, { gradingWeights });
    return true;
  };

  const commitGradingWeightName = (oldLabel: string, requestedLabel: string) => {
    renameGradingWeight(oldLabel, requestedLabel);
    setGradingWeightNameDrafts(current => {
      const next = { ...current };
      delete next[oldLabel];
      return next;
    });
  };

  const addGradingWeight = () => {
    const current = extraction?.gradingWeights || {};
    if (Object.keys(current).length >= 100) {
      setError('The reviewed grading scheme cannot exceed 100 categories.');
      return;
    }
    let index = Object.keys(current).length + 1;
    let label = `New category ${index}`;
    while (Object.keys(current).some(existing => existing.toLocaleLowerCase() === label.toLocaleLowerCase())) {
      index += 1;
      label = `New category ${index}`;
    }
    editExtraction(`gradingWeights.${label}`, { gradingWeights: { ...current, [label]: 0 } });
  };

  const acceptSyllabus = (asset: AIDocumentAsset) => {
    try { assertConfiguredAISource({ document: asset }, 'syllabus'); }
    catch (selectionError) { setError(selectionError instanceof Error ? selectionError.message : 'This source is not supported by the AI service.'); return; }
    analysisRevision.current += 1;
    setError(null);
    setAnalysisFailure(null);
    setDocument(asset);
    setExtraction(null);
    setExtracting(false);
    setStoredSourceAsset(null);
    setSourceUploadKey(createEntityId('syllabus-source'));
    setSourceRightsConfirmed(false);
    setReviewConfirmed(false);
    setReviewerEditedFields([]);
    setGradingWeightNameDrafts({});
  };

  const selectSyllabus = async () => {
    setError(null);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type: sourceSupport.pickerTypes,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) throw new Error('The selected syllabus could not be read.');
      acceptSyllabus({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType, size: asset.size, file: asset.file });
    } catch (selectionError) {
      setError(selectionError instanceof Error ? selectionError.message : 'The syllabus picker could not be opened.');
    }
  };

  const analyzeSyllabus = async (recovery?: AIRequestError) => {
    const analysisKey = sourceUploadKey;
    if (!document || analysisInFlightFor.current === analysisKey) return;
    if (!sourceRightsConfirmed) {
      setError('Confirm that you are authorized to process this syllabus before sending it to the institution-configured AI service.');
      return;
    }
    analysisInFlightFor.current = analysisKey;
    const revision = ++analysisRevision.current;
    const selectedDocument = document;
    setExtracting(true);
    setError(null);
    if (!recovery) setAnalysisFailure(null);
    try {
      const input = { document: selectedDocument, courseId: course.id, courseTitle: course.title };
      const result = recovery ? await recoverValidatedSyllabus(recovery, input) : await extractValidatedSyllabus(input);
      if (analysisRevision.current === revision) {
        setAnalysisFailure(null);
        setExtraction(result);
        setReviewConfirmed(false);
        setReviewerEditedFields([]);
        setGradingWeightNameDrafts({});
      }
    } catch (analysisError) {
      if (analysisRevision.current === revision) {
        setError(analysisError instanceof Error ? analysisError.message : 'Syllabus analysis failed.');
        setAnalysisFailure(analysisError instanceof AIRequestError ? analysisError : null);
      }
    } finally {
      if (analysisInFlightFor.current === analysisKey) analysisInFlightFor.current = null;
      if (analysisRevision.current === revision) setExtracting(false);
    }
  };

  const applyExtraction = async () => {
    if (!extraction || !document || applyInFlight.current) return;
    if (!sourceRightsConfirmed) {
      setError('The source-rights and AI-processing confirmation is required before this extraction can be applied.');
      return;
    }
    if (!reviewConfirmed) {
      setError('Confirm that you verified the proposed values and any edits against the source document.');
      return;
    }
    const validDate = (value?: string) => !value || isValidISODate(value);
    if (!validDate(extraction.termStart) || !validDate(extraction.termEnd)) {
      setError('Course dates must be valid ISO dates in YYYY-MM-DD format.');
      return;
    }
    if (extraction.termStart && extraction.termEnd && extraction.termStart >= extraction.termEnd) {
      setError('The course end date must be after its start date.');
      return;
    }
    if (extraction.schedule?.some(entry => entry.date && !isValidISODate(entry.date))) {
      setError('Every reviewed schedule date must be a valid YYYY-MM-DD calendar date.');
      return;
    }
    if ([['learningObjectives', 50], ['meetingTimes', 30]].some(([field, limit]) => {
      const values = extraction[field as 'learningObjectives' | 'meetingTimes'];
      return (values?.length || 0) > Number(limit) || values?.some(value => !value.trim() || value.length > 600);
    })) {
      setError('Use at most 50 learning objectives and 30 meeting-time entries, each non-empty and no longer than 600 characters.');
      return;
    }
    if ((extraction.instructorNames?.length || 0) > 30 || extraction.instructorNames?.some(name => !name.trim() || name.length > 200)) {
      setError('Use at most 30 non-empty instructor names of 200 characters or fewer.');
      return;
    }
    if ((extraction.requiredMaterials?.length || 0) > 100 || extraction.requiredMaterials?.some(material => !material.trim() || material.length > 600)) {
      setError('Use at most 100 non-empty required materials of 600 characters or fewer.');
      return;
    }
    if ((extraction.schedule?.length || 0) > 500) {
      setError('The reviewed schedule cannot exceed 500 entries.');
      return;
    }
    if (extraction.schedule?.some(entry => !entry.topic.trim() || entry.topic.length > 600)) {
      setError('Every reviewed schedule entry needs a topic of 600 characters or fewer.');
      return;
    }
    if (extraction.policies?.some(policy => !policy.name.trim() || policy.name.length > 160 || !policy.text.trim() || policy.text.length > 4000)) {
      setError('Every reviewed policy needs a name of 160 characters or fewer and policy text of 4,000 characters or fewer.');
      return;
    }
    if ((extraction.policies?.length || 0) > 100) {
      setError('The reviewed policy list cannot exceed 100 entries.');
      return;
    }
    if (extraction.gradingWeights) {
      const proposedCategories = Object.keys(extraction.gradingWeights);
      if (proposedCategories.length > 100 || proposedCategories.some(category => !category.trim() || category.length > 120)) {
        setError('Use at most 100 non-empty grading categories of 120 characters or fewer.');
        return;
      }
      if (new Set(proposedCategories.map(category => category.trim().toLocaleLowerCase())).size !== proposedCategories.length) {
        setError('Grading category labels must be unique, ignoring capitalization and surrounding spaces.');
        return;
      }
      const missingReferencedCategories = referencedGradingCategories.filter(referenced => !proposedCategories.some(proposed => proposed.toLocaleLowerCase() === referenced.toLocaleLowerCase()));
      if (missingReferencedCategories.length) {
        setError(`Keep grading categories used by existing coursework before applying: ${missingReferencedCategories.join(', ')}.`);
        return;
      }
      const weights = Object.values(extraction.gradingWeights);
      const total = weights.reduce((sum, weight) => sum + weight, 0);
      if (weights.some(weight => !Number.isFinite(weight) || weight < 0 || weight > 100) || Math.abs(total - 100) > 0.01) {
        setError(`Reviewed grading weights must each be between 0 and 100 and total 100%. Current total: ${Number.isFinite(total) ? total : 'invalid'}%.`);
        return;
      }
    }
    const mapped = mapSyllabusToCourse(extraction, course);
    const syllabusAuditWithoutAsset = {
      promptVersion: SYLLABUS_PROMPT_VERSION,
      sourceFileName: document.name,
      ...mapped.syllabusDetails,
      reviewerEditedFields,
      sourceRightsAttested: true,
    };
    if (JSON.stringify({ ...(course.metadata || {}), syllabus: syllabusAuditWithoutAsset }).length > 55_000) {
      setError('The reviewed syllabus record is too large for course metadata. Reduce unusually long schedule or policy entries, or configure the institution to retain the full extraction in its document system.');
      return;
    }
    applyInFlight.current = true;
    setApplying(true);
    setError(null);
    try {
      const sourceAsset = storedSourceAsset || await getAssetService().upload(document, {
        courseId: course.id,
        purpose: 'course-content',
        idempotencyKey: sourceUploadKey,
      });
      setStoredSourceAsset(sourceAsset);
      assertAssetMatchesAIProvenance(sourceAsset, extraction.provenance);
      const reviewedAt = new Date().toISOString();
      const metadata = {
        ...(course.metadata || {}),
        syllabus: {
          promptVersion: SYLLABUS_PROMPT_VERSION,
          sourceFileName: document.name,
          sourceAsset,
          ...mapped.syllabusDetails,
          reviewerEditedFields,
          sourceRightsAttestedAt: reviewedAt,
          humanReviewedAt: reviewedAt,
          importedAt: reviewedAt,
        },
      };
      if (JSON.stringify(metadata).length > 65_536) {
        throw new Error('The reviewed syllabus and source reference exceed the course metadata limit. Shorten the reviewed details before retrying.');
      }
      await updateCourse(course.id, {
        ...mapped.courseFields,
        metadata,
      });
      setDocument(null);
      setAnalysisFailure(null);
      setExtraction(null);
      setStoredSourceAsset(null);
      setSourceRightsConfirmed(false);
      setReviewConfirmed(false);
      setReviewerEditedFields([]);
      setGradingWeightNameDrafts({});
      onClose();
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : 'The reviewed syllabus fields could not be saved.');
    } finally {
      applyInFlight.current = false;
      setApplying(false);
    }
  };

  const requestSyllabusClose = () => {
    if (applying) return;
    if (!document && !extraction) {
      onClose();
      return;
    }
    Alert.alert('Discard syllabus import?', 'The selected document, extraction, and review edits have not been applied to the course.', [
      { text: 'Keep reviewing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => {
        analysisRevision.current += 1;
        setDocument(null);
        setAnalysisFailure(null);
        setExtraction(null);
        setExtracting(false);
        setStoredSourceAsset(null);
        setError(null);
        setSourceRightsConfirmed(false);
        setReviewConfirmed(false);
        setReviewerEditedFields([]);
        setGradingWeightNameDrafts({});
        onClose();
      } },
    ]);
  };
  
  return (
    <BaseModal visible={visible} onClose={requestSyllabusClose} title={`Syllabus: ${course.title}`} closeDisabled={applying}>
      <Text style={{ color: colors.text, marginBottom: 10 }}>Term: {(course.termStart && course.termEnd) ? `${new Date(course.termStart).toLocaleDateString()} - ${new Date(course.termEnd).toLocaleDateString()}` : 'Not Set'}</Text>
      <Text style={{ color: colors.textSecondary, marginBottom: 20 }}>{course.description || ''}</Text>
      <Text style={{ color: colors.text, fontWeight: 'bold', fontSize: 18, marginBottom: 10 }}>Grading Weights</Text>
      {Object.entries(course.gradingWeights || {}).map(([key, value]) => (
        <View key={key} style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 }}>
          <Text style={{ color: colors.text }}>{key}</Text>
          <Text style={{ color: colors.text }}>{value}%</Text>
        </View>
      ))}
      {savedSyllabus && (
        <View style={{ marginTop: 18, paddingTop: 16, borderTopWidth: 1, borderColor: colors.border }}>
          <Text style={{ color: colors.text, fontWeight: 'bold', fontSize: 18 }}>Reviewed syllabus details</Text>
          <SyllabusAdditionalFields details={savedSyllabus} />
          {!!savedSyllabus.instructorNames.length && <Text style={{ color: colors.text, marginTop: 10 }}><Text style={{ fontWeight: 'bold' }}>Instructor{savedSyllabus.instructorNames.length === 1 ? '' : 's'}: </Text>{savedSyllabus.instructorNames.join(', ')}</Text>}
          {!!savedSyllabus.requiredMaterials.length && (
            <View style={{ marginTop: 12 }}>
              <Text style={{ color: colors.text, fontWeight: 'bold' }}>Required materials</Text>
              {savedSyllabus.requiredMaterials.map((material, index) => <Text key={`${material}-${index}`} style={{ color: colors.textSecondary, marginTop: 4 }}>• {material}</Text>)}
            </View>
          )}
          {!!savedSyllabus.schedule.length && (
            <View style={{ marginTop: 12 }}>
              <Text style={{ color: colors.text, fontWeight: 'bold' }}>Schedule</Text>
              {savedSyllabus.schedule.map((entry, index) => <Text key={`${entry.date || 'undated'}-${index}`} style={{ color: colors.textSecondary, marginTop: 4 }}>{entry.date ? `${entry.date} · ` : ''}{entry.topic}</Text>)}
            </View>
          )}
          {!!savedSyllabus.policies.length && (
            <View style={{ marginTop: 12 }}>
              <Text style={{ color: colors.text, fontWeight: 'bold' }}>Policies</Text>
              {savedSyllabus.policies.map((policy, index) => (
                <View key={`${policy.name}-${index}`} style={{ marginTop: 7 }}>
                  <Text style={{ color: colors.text, fontWeight: '600' }}>{policy.name}</Text>
                  <Text style={{ color: colors.textSecondary, marginTop: 2 }}>{policy.text}</Text>
                </View>
              ))}
            </View>
          )}
          {savedSyllabus.sourceAsset && (
            <TouchableOpacity
              onPress={() => void Linking.openURL(resolvePreparedDemoUrl(savedSyllabus.sourceAsset!.url)).catch(() => Alert.alert('Unable to open syllabus', 'The authorized syllabus link could not be opened.'))}
              style={{ marginTop: 14, flexDirection: 'row', alignItems: 'center' }}
              accessibilityRole="link"
            >
              <Ionicons name="document-attach-outline" size={18} color={colors.primary} />
              <Text style={{ color: colors.primary, fontWeight: 'bold', marginLeft: 7 }}>{savedSyllabus.sourceAsset.name}</Text>
            </TouchableOpacity>
          )}
          {savedSyllabus.humanReviewedAt && <Text style={{ color: colors.textSecondary, fontSize: 11, marginTop: 8 }}>Human reviewed {new Date(savedSyllabus.humanReviewedAt).toLocaleString()}</Text>}
          {canImport && savedSyllabus.warnings.map((warning, index) => <Text key={`${warning}-${index}`} style={{ color: '#C47F00', marginTop: 5 }}>⚠ {warning}</Text>)}
          {canImport && <AISourceReviewNotice notices={savedSyllabus.sourceReviewNotices} reviewed />}
          <AIGenerationAttribution provenance={savedSyllabus.provenance} sourceName={savedSyllabus.sourceAsset?.name || savedSyllabus.sourceFileName} />
        </View>
      )}
      {canImport && (
        <View style={{ marginTop: 24, paddingTop: 20, borderTopWidth: 1, borderColor: colors.border }}>
          <Text style={{ color: colors.text, fontWeight: 'bold', fontSize: 18 }}>Import syllabus with AI</Text>
          <Text style={{ color: colors.textSecondary, marginTop: 5, marginBottom: 14 }}>{sourceSupport.description} The source is integrity-checked and retained with the import; extracted fields are never applied until you review and confirm them.</Text>
          <TouchableOpacity disabled={applying} onPress={() => void selectSyllabus()} style={{ borderWidth: 1, borderStyle: 'dashed', borderColor: applying ? colors.border : colors.primary, borderRadius: 8, padding: 14, alignItems: 'center' }} accessibilityRole="button" accessibilityState={{ disabled: applying }}>
            <Text style={{ color: colors.primary, fontWeight: 'bold' }}>{document ? `Selected: ${document.name}` : 'Select syllabus document'}</Text>
          </TouchableOpacity>
          <PreparedSourcePicker task="syllabus" disabled={applying || extracting} onSelect={acceptSyllabus} />
          {document && !extraction && (
            <View>
              <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 12 }}>
                {isPreparedAIDemo() ? 'Prepared demo: this file stays on the local demo server and is matched to a saved result. No external AI provider is contacted.' : 'Analysis sends this syllabus to the institution-configured AI service. Vendor, retention, training use, deletion, and data residency are governed by your institution’s policy. Do not include learner personal data unless your institution authorizes it.'}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setSourceRightsConfirmed(confirmed => !confirmed);
                  setError(null);
                }}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: sourceRightsConfirmed, disabled: extracting }}
                aria-checked={sourceRightsConfirmed}
                disabled={extracting}
                style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, marginTop: 8 }}
              >
                <Ionicons name={sourceRightsConfirmed ? 'checkbox' : 'square-outline'} size={22} color={sourceRightsConfirmed ? colors.primary : colors.textSecondary} />
                <Text style={{ color: colors.text, marginLeft: 8, flex: 1 }}>I am authorized to process this syllabus and understand that it will be sent to the configured AI service.</Text>
              </TouchableOpacity>
              {!analysisFailure && <TouchableOpacity
                disabled={extracting || !sourceRightsConfirmed}
                onPress={() => void analyzeSyllabus()}
                style={{ backgroundColor: extracting || !sourceRightsConfirmed ? colors.border : colors.primary, borderRadius: 8, padding: 14, marginTop: 8, alignItems: 'center' }}
                accessibilityRole="button"
                accessibilityState={{ disabled: extracting || !sourceRightsConfirmed, busy: extracting }}
                accessibilityHint={sourceRightsConfirmed ? 'Sends the selected syllabus to the configured AI service for a draft extraction.' : 'Confirm source rights and AI processing before analysis.'}
              >
                {extracting
                  ? <ActivityIndicator color={colors.textSecondary} />
                  : <Text style={{ color: sourceRightsConfirmed ? colors.buttonText : colors.textSecondary, fontWeight: 'bold' }}>Analyze document</Text>}
              </TouchableOpacity>}
              <AIRequestHistoryPicker key={sourceUploadKey} task="syllabus" input={{ document, courseId: course.id, courseTitle: course.title }} disabled={!visible || extracting || !sourceRightsConfirmed} onSelect={request => void analyzeSyllabus(request)} />
            </View>
          )}
          {error && <Text style={{ color: colors.error, marginTop: 12 }}>{error}</Text>}
          {analysisFailure && <AIRequestRecoveryActions failure={analysisFailure} busy={extracting} disabled={!sourceRightsConfirmed} onCheck={() => void analyzeSyllabus(analysisFailure)} onNew={() => void analyzeSyllabus()} />}
          {extraction && (
            <View style={{ marginTop: 16 }} pointerEvents={applying ? 'none' : 'auto'}>
              <PreparedAccuracyNotice provenance={extraction.provenance} />
              <AIGenerationAttribution provenance={extraction.provenance} />
              <Text style={{ color: colors.text, fontWeight: 'bold', marginBottom: 8 }}>Review and edit proposed changes</Text>
              <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 5 }}>Course title</Text>
              <TextInput
                accessibilityLabel="Extracted course title"
                style={[styles.input, { borderColor: colors.border, color: colors.text, marginBottom: 10 }]}
                value={extraction.title || ''}
                onChangeText={title => editExtraction('title', { title })}
                maxLength={300}
              />
              {([{ key: 'courseCode', label: 'Course code', limit: 80 }, { key: 'courseDuration', label: 'Course duration', limit: 300 }, { key: 'intendedAudience', label: 'Intended audience', limit: 1000 }] as const).map(field => <View key={field.key}>
                <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{field.label}</Text>
                <TextInput accessibilityLabel={`Extracted ${field.label.toLowerCase()}`} style={[styles.input, { borderColor: colors.border, color: colors.text, marginBottom: 10 }]} value={extraction[field.key] || ''} onChangeText={value => editExtraction(field.key, { [field.key]: value })} maxLength={field.limit} />
              </View>)}
              {([{ key: 'learningObjectives', label: 'Learning objectives', limit: 50 }, { key: 'meetingTimes', label: 'Meeting times', limit: 30 }] as const).map(field => <View key={field.key}>
                <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{field.label} · one per line</Text>
                <SyllabusLineListInput accessibilityLabel={`Extracted ${field.label.toLowerCase()}`} style={[styles.input, { borderColor: colors.border, color: colors.text, minHeight: 70, marginBottom: 10 }]} values={extraction[field.key] || []} onChangeValues={values => editExtraction(field.key, { [field.key]: values })} maxLength={field.limit * 601} />
              </View>)}
              <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 5 }}>Course description</Text>
              <TextInput
                accessibilityLabel="Extracted course description"
                style={[styles.input, { borderColor: colors.border, color: colors.text, minHeight: 90, textAlignVertical: 'top', marginBottom: 10 }]}
                value={extraction.description || ''}
                onChangeText={description => editExtraction('description', { description })}
                multiline
                maxLength={4000}
              />
              <View style={{ flexDirection: 'row', marginBottom: 10 }}>
                <View style={{ flex: 1, marginRight: 5 }}>
                  <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 5 }}>Start (YYYY-MM-DD)</Text>
                  <TextInput accessibilityLabel="Extracted course start date" style={[styles.input, { borderColor: colors.border, color: colors.text }]} value={extraction.termStart || ''} onChangeText={termStart => editExtraction('termStart', { termStart })} maxLength={10} />
                </View>
                <View style={{ flex: 1, marginLeft: 5 }}>
                  <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 5 }}>End (YYYY-MM-DD)</Text>
                  <TextInput accessibilityLabel="Extracted course end date" style={[styles.input, { borderColor: colors.border, color: colors.text }]} value={extraction.termEnd || ''} onChangeText={termEnd => editExtraction('termEnd', { termEnd })} maxLength={10} />
                </View>
              </View>
              <View style={{ marginBottom: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                    <Text style={{ color: colors.text, fontWeight: 'bold' }}>Grading weights</Text>
                    <TouchableOpacity disabled={Object.keys(extraction.gradingWeights || {}).length >= 100} onPress={addGradingWeight} accessibilityRole="button" accessibilityState={{ disabled: Object.keys(extraction.gradingWeights || {}).length >= 100 }}><Text style={{ color: Object.keys(extraction.gradingWeights || {}).length >= 100 ? colors.textSecondary : colors.primary, fontWeight: 'bold' }}>+ Add category</Text></TouchableOpacity>
                  </View>
                  {Object.entries(extraction.gradingWeights || {}).map(([label, weight]) => (
                    <View key={label} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                      <TextInput
                        accessibilityLabel={`${label} grading category name`}
                        style={[styles.input, { borderColor: colors.border, color: colors.text, flex: 1, marginRight: 6 }]}
                        value={gradingWeightNameDrafts[label] ?? label}
                        onChangeText={value => setGradingWeightNameDrafts(current => ({ ...current, [label]: value }))}
                        onEndEditing={event => commitGradingWeightName(label, event.nativeEvent.text)}
                        maxLength={120}
                      />
                      <TextInput
                        accessibilityLabel={`${label} grading weight`}
                        style={[styles.input, { borderColor: colors.border, color: colors.text, width: 80, textAlign: 'right' }]}
                        value={String(weight)}
                        keyboardType="decimal-pad"
                        onChangeText={value => editExtraction(`gradingWeights.${label}`, {
                          gradingWeights: { ...(extraction.gradingWeights || {}), [label]: value.trim() ? Number(value) : Number.NaN },
                        })}
                      />
                      <Text style={{ color: colors.text, marginLeft: 5 }}>%</Text>
                      <TouchableOpacity
                        onPress={() => {
                          const remaining = Object.fromEntries(Object.entries(extraction.gradingWeights || {}).filter(([candidate]) => candidate !== label));
                          editExtraction(`gradingWeights.${label}`, { gradingWeights: Object.keys(remaining).length ? remaining : undefined });
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`Delete ${label} grading category`}
                        style={{ marginLeft: 8 }}
                      >
                        <Ionicons name="trash-outline" size={20} color={colors.error} />
                      </TouchableOpacity>
                    </View>
                  ))}
                  <Text style={{ color: colors.textSecondary, textAlign: 'right' }}>Total: {Object.values(extraction.gradingWeights || {}).reduce((sum, weight) => sum + weight, 0)}%</Text>
                </View>
              <Text style={{ color: colors.text, fontWeight: 'bold', marginTop: 10, marginBottom: 5 }}>Instructor names</Text>
              <SyllabusLineListInput
                accessibilityLabel="Extracted instructor names"
                style={[styles.input, { borderColor: colors.border, color: colors.text, minHeight: 70, textAlignVertical: 'top', marginBottom: 10 }]}
                values={extraction.instructorNames || []}
                onChangeValues={values => editExtraction('instructorNames', {
                  instructorNames: values,
                })}
                placeholder="One instructor per line"
                placeholderTextColor={colors.textSecondary}
                multiline
                maxLength={6000}
              />
              <Text style={{ color: colors.text, fontWeight: 'bold', marginTop: 4, marginBottom: 5 }}>Required materials</Text>
              <SyllabusLineListInput
                accessibilityLabel="Extracted required materials"
                style={[styles.input, { borderColor: colors.border, color: colors.text, minHeight: 90, textAlignVertical: 'top', marginBottom: 10 }]}
                values={extraction.requiredMaterials || []}
                onChangeValues={values => editExtraction('requiredMaterials', {
                  requiredMaterials: values,
                })}
                placeholder="One material per line"
                placeholderTextColor={colors.textSecondary}
                multiline
                maxLength={60_000}
              />
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                <Text style={{ color: colors.text, fontWeight: 'bold' }}>Schedule</Text>
                <TouchableOpacity
                  disabled={(extraction.schedule?.length || 0) >= 500}
                  onPress={() => editExtraction('schedule', { schedule: [...(extraction.schedule || []), { topic: '' }] })}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: (extraction.schedule?.length || 0) >= 500 }}
                >
                  <Text style={{ color: (extraction.schedule?.length || 0) >= 500 ? colors.textSecondary : colors.primary, fontWeight: 'bold' }}>+ Add entry</Text>
                </TouchableOpacity>
              </View>
              {(extraction.schedule || []).map((entry, index) => (
                <View key={`schedule-${index}`} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
                  <TextInput
                    accessibilityLabel={`Schedule entry ${index + 1} date`}
                    style={[styles.input, { borderColor: colors.border, color: colors.text, width: 112, marginRight: 6 }]}
                    value={entry.date || ''}
                    onChangeText={date => {
                      const schedule = [...(extraction.schedule || [])];
                      schedule[index] = { ...entry, date: date || undefined };
                      editExtraction(`schedule[${index}].date`, { schedule });
                    }}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={colors.textSecondary}
                    maxLength={10}
                  />
                  <TextInput
                    accessibilityLabel={`Schedule entry ${index + 1} topic`}
                    style={[styles.input, { borderColor: colors.border, color: colors.text, flex: 1, marginRight: 6 }]}
                    value={entry.topic}
                    onChangeText={topic => {
                      const schedule = [...(extraction.schedule || [])];
                      schedule[index] = { ...entry, topic };
                      editExtraction(`schedule[${index}].topic`, { schedule });
                    }}
                    placeholder="Topic or activity"
                    placeholderTextColor={colors.textSecondary}
                    maxLength={600}
                  />
                  <TouchableOpacity
                    onPress={() => editExtraction('schedule', { schedule: (extraction.schedule || []).filter((_candidate, candidateIndex) => candidateIndex !== index) })}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete schedule entry ${index + 1}`}
                  >
                    <Ionicons name="trash-outline" size={20} color={colors.error} />
                  </TouchableOpacity>
                </View>
              ))}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 }}>
                <Text style={{ color: colors.text, fontWeight: 'bold' }}>Policies</Text>
                <TouchableOpacity
                  disabled={(extraction.policies?.length || 0) >= 100}
                  onPress={() => editExtraction('policies', { policies: [...(extraction.policies || []), { name: '', text: '' }] })}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: (extraction.policies?.length || 0) >= 100 }}
                >
                  <Text style={{ color: (extraction.policies?.length || 0) >= 100 ? colors.textSecondary : colors.primary, fontWeight: 'bold' }}>+ Add policy</Text>
                </TouchableOpacity>
              </View>
              {(extraction.policies || []).map((policy, index) => (
                <View key={`policy-${index}`} style={{ marginTop: 8, padding: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <TextInput
                      accessibilityLabel={`Policy ${index + 1} name`}
                      style={[styles.input, { borderColor: colors.border, color: colors.text, flex: 1, marginRight: 8 }]}
                      value={policy.name}
                      onChangeText={name => {
                        const policies = [...(extraction.policies || [])];
                        policies[index] = { ...policy, name };
                        editExtraction(`policies[${index}].name`, { policies });
                      }}
                      placeholder="Policy name"
                      placeholderTextColor={colors.textSecondary}
                      maxLength={160}
                    />
                    <TouchableOpacity
                      onPress={() => editExtraction('policies', { policies: (extraction.policies || []).filter((_candidate, candidateIndex) => candidateIndex !== index) })}
                      accessibilityRole="button"
                      accessibilityLabel={`Delete policy ${index + 1}`}
                    >
                      <Ionicons name="trash-outline" size={20} color={colors.error} />
                    </TouchableOpacity>
                  </View>
                  <TextInput
                    accessibilityLabel={`Policy ${index + 1} text`}
                    style={[styles.input, { borderColor: colors.border, color: colors.text, minHeight: 80, textAlignVertical: 'top', marginTop: 6 }]}
                    value={policy.text}
                    onChangeText={text => {
                      const policies = [...(extraction.policies || [])];
                      policies[index] = { ...policy, text };
                      editExtraction(`policies[${index}].text`, { policies });
                    }}
                    placeholder="Policy text"
                    placeholderTextColor={colors.textSecondary}
                    multiline
                    maxLength={4000}
                  />
                </View>
              ))}
              {extraction.warnings.map((warning, index) => <Text key={`${warning}-${index}`} style={{ color: '#C47F00', marginTop: 6 }}>⚠ {warning}</Text>)}
              <AISourceReviewNotice notices={extraction.provenance?.sourceReviewNotices} />
              <Text style={{ color: colors.text, fontWeight: 'bold', marginTop: 16 }}>Source evidence ({extraction.evidence.length})</Text>
              {extraction.evidence.map((entry, index) => (
                <View key={`${entry.field}-${index}`} style={{ borderLeftWidth: 3, borderLeftColor: colors.primary, paddingLeft: 10, marginTop: 8 }}>
                  <Text style={{ color: colors.primary, fontWeight: 'bold', fontSize: 12 }}>{entry.field}{entry.sourceLocation ? ` · ${entry.sourceLocation}` : ''}</Text>
                  <Text style={{ color: colors.textSecondary, marginTop: 2 }}>{entry.sourceExcerpt}</Text>
                </View>
              ))}
              <TouchableOpacity
                onPress={() => setReviewConfirmed(confirmed => !confirmed)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: reviewConfirmed }}
                aria-checked={reviewConfirmed}
                style={{ flexDirection: 'row', alignItems: 'center', marginTop: 16, paddingVertical: 8 }}
              >
                <Ionicons name={reviewConfirmed ? 'checkbox' : 'square-outline'} size={22} color={reviewConfirmed ? colors.primary : colors.textSecondary} />
                <Text style={{ color: colors.text, marginLeft: 8, flex: 1 }}>I verified all proposed values and edits against the source syllabus.</Text>
              </TouchableOpacity>
              {!!reviewerEditedFields.length && <Text style={{ color: colors.textSecondary, fontSize: 12 }}>Edited during review: {reviewerEditedFields.join(', ')}</Text>}
              <TouchableOpacity disabled={applying || !reviewConfirmed} onPress={() => void applyExtraction()} style={{ backgroundColor: applying || !reviewConfirmed ? colors.border : colors.primary, borderRadius: 8, padding: 14, marginTop: 14, alignItems: 'center' }} accessibilityRole="button" accessibilityState={{ disabled: applying || !reviewConfirmed }}>
                {applying
                  ? <ActivityIndicator color={colors.textSecondary} />
                  : <Text style={{ color: reviewConfirmed ? colors.buttonText : colors.textSecondary, fontWeight: 'bold' }}>Apply reviewed fields</Text>}
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}
    </BaseModal>
  );
};

export const AnalyticsModal = ({ visible, onClose, course }: { visible: boolean, onClose: () => void, course: Course }) => {
  const colors = useThemeColors();
  const isReady = useModalLoader(visible);
  const courseRole = useCourseRole(course.id) ?? 'student';
  const { submissions, contentItems } = useLMSStore();
  const analytics = calculateCourseAnalytics(course, contentItems, submissions);

  if (!hasCoursePermission(courseRole, 'viewGradeAnalytics')) {
    return <BaseModal visible={visible} onClose={onClose} title="Analytics"><Text style={{ color: colors.error }}>You do not have permission to view course analytics.</Text></BaseModal>;
  }
  
  return (
    <BaseModal visible={visible} onClose={onClose} title={`Analytics: ${course.title}`} isLoading={!isReady}>
      <View style={styles.analyticsStats}>
        <View style={[styles.statBox, { backgroundColor: colors.card }]}>
          <Text style={[styles.statValue, { color: colors.primary }]}>{analytics.averageAttemptMinutes === null ? '—' : `${Math.round(analytics.averageAttemptMinutes)} min`}</Text>
          <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Avg Assessment Time</Text>
        </View>
        <View style={[styles.statBox, { backgroundColor: colors.card }]}>
          <Text style={[styles.statValue, { color: '#4caf50' }]}>{analytics.averageGradePercent === null ? '—' : `${Math.round(analytics.averageGradePercent)}%`}</Text>
          <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Avg Released Grade</Text>
        </View>
        <View style={[styles.statBox, { backgroundColor: colors.card }]}>
          <Text style={[styles.statValue, { color: colors.text }]}>{analytics.studentRows.length}</Text>
          <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Enrolled Students</Text>
        </View>
      </View>
      
      <Text style={{ color: colors.text, fontWeight: 'bold', fontSize: 18, marginTop: 20, marginBottom: 10 }}>Student Breakdown</Text>
      <View style={{ backgroundColor: colors.card, padding: 15, borderRadius: 12 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 10, marginBottom: 10 }}>
          <Text style={{ color: colors.textSecondary, flex: 2 }}>Student</Text>
          <Text style={{ color: colors.textSecondary, flex: 1, textAlign: 'center' }}>Submissions</Text>
          <Text style={{ color: colors.textSecondary, flex: 1, textAlign: 'right' }}>Grade</Text>
        </View>
        {analytics.studentRows.length === 0 && <Text style={{ color: colors.textSecondary }}>No enrolled students.</Text>}
        {analytics.studentRows.map(({ student, submissionCount, gradePercent }) => {
          return (
            <View key={student.id} style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
              <Text style={{ color: colors.text, flex: 2 }}>{student.name}</Text>
              <Text style={{ color: colors.text, flex: 1, textAlign: 'center' }}>{submissionCount}</Text>
              <Text style={{ color: gradePercent !== null && gradePercent >= 80 ? '#4caf50' : colors.text, flex: 1, textAlign: 'right' }}>{gradePercent === null ? '—' : `${Math.round(gradePercent)}%`}</Text>
            </View>
          );
        })}
      </View>
    </BaseModal>
  );
};



export const CourseGradingModal = ({ visible, onClose, course }: { visible: boolean, onClose: () => void, course: Course }) => {
  const colors = useThemeColors();
  const courseRole = useCourseRole(course.id) ?? 'student';
  const { contentItems, submissions } = useLMSStore();
  const [activeItem, setActiveItem] = useState<any>(null);
  const [isAddingExternal, setIsAddingExternal] = useState(false);
  const isReady = useModalLoader(visible);

  const reportableItems = contentItems.filter(i => i.courseId === course.id && (i.isGraded || i.isPoll));

  if (!hasCoursePermission(courseRole, 'grade')) {
    return <BaseModal visible={visible} onClose={onClose} title="Grading & Poll Results"><Text style={{ color: colors.error }}>You do not have permission to grade or view poll results for this course.</Text></BaseModal>;
  }

  if (activeItem) {
    return activeItem.isPoll
      ? <PollResults item={activeItem} onClose={() => setActiveItem(null)} />
      : <AssessmentGrader item={activeItem} onClose={() => setActiveItem(null)} />;
  }

  if (isAddingExternal) {
    return <ExternalGradeCreator courseId={course.id} onClose={() => setIsAddingExternal(false)} />;
  }


  return (
    <BaseModal visible={visible} onClose={onClose} title={`Grading & Poll Results: ${course.title}`} isLoading={!isReady}>
      <Text style={{ color: colors.text, marginBottom: 15 }}>
        Select a graded assignment to review submissions, or a poll to inspect its archived response sessions.
      </Text>
      {reportableItems.length === 0 ? (
         <Text style={{ color: colors.textSecondary, fontStyle: 'italic', textAlign: 'center', marginTop: 20 }}>No graded assignments or polls found.</Text>
      ) : (
        reportableItems.map(item => {
          const itemSubmissions = submissions.filter(s => s.contentItemId === item.id);
          const awaitingStaff = itemSubmissions.filter(submission => submission.status === 'submitted').length;
          const pollResponses = item.isPoll
            ? itemSubmissions.filter(submission => ['submitted', 'graded'].includes(submission.status)).length
            : 0;

          return (
            <TouchableOpacity 
              key={item.id}
              style={{ backgroundColor: colors.card, padding: 15, borderRadius: 12, marginBottom: 10, borderColor: colors.border, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
              onPress={() => setActiveItem(item)}
              accessibilityRole="button"
              accessibilityLabel={`${item.isPoll ? 'View poll results for' : 'Grade'} ${item.title}`}
            >
              <View>
                <Text style={{ color: colors.text, fontWeight: 'bold' }}>{item.title}</Text>
                <Text style={{ color: colors.textSecondary, marginTop: 4 }}>{item.isPoll ? 'POLL RESULTS' : item.category.toUpperCase()}</Text>
              </View>
              {(item.isPoll ? pollResponses : awaitingStaff) > 0 && (
                <View style={{ backgroundColor: '#FF5252', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 }}>
                  <Text style={{ color: '#000000', fontSize: 12, fontWeight: 'bold' }}>
                    {item.isPoll ? `${pollResponses} RESPONSES` : `${awaitingStaff} AWAITING REVIEW`}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })
      )}
      <TouchableOpacity 
        style={{ marginTop: 20, padding: 15, borderRadius: 12, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed', flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}
        onPress={() => setIsAddingExternal(true)}
        accessibilityRole="button"
        accessibilityLabel="Add external grade"
      >
        <Ionicons name="add" size={24} color={colors.primary} style={{ marginRight: 8 }} />
        <Text style={{ color: colors.primary, fontWeight: 'bold' }}>Add External Grade</Text>
      </TouchableOpacity>
    </BaseModal>
  );
};

export const StudentGradesModal = ({ visible, onClose, course }: { visible: boolean, onClose: () => void, course: Course }) => {
  const colors = useThemeColors();
  const { submissions, contentItems, currentUserId } = useLMSStore();
  const isReady = useModalLoader(visible);
  
  const membership = course.staff.find(member => member.id === currentUserId);
  const currentGrade = calculateCourseAnalytics(course, contentItems, submissions).studentRows
    .find(row => row.student.id === currentUserId)?.gradePercent ?? null;
  const courseSubmissions = submissions.filter(submission =>
    submission.courseId === course.id
    && submission.gradeStatus === 'released'
    && submission.status === 'graded'
    && (submission.studentId === currentUserId || userBelongsToSubmissionGroup(
      course,
      contentItems.find(item => item.id === submission.contentItemId),
      membership?.id,
      submission.groupId,
    )),
  );
  
  return (
    <BaseModal visible={visible} onClose={onClose} title={`My Grades: ${course.title}`} isLoading={!isReady}>
      <View style={{ backgroundColor: colors.card, padding: 15, borderRadius: 12, marginBottom: 14, borderColor: colors.border, borderWidth: 1 }}>
        <Text style={{ color: colors.textSecondary }}>Current weighted grade (released work)</Text>
        <Text style={{ color: currentGrade !== null && currentGrade >= 80 ? '#4CAF50' : colors.text, fontSize: 24, fontWeight: 'bold', marginTop: 4 }}>
          {currentGrade === null ? '—' : `${Math.round(currentGrade)}%`}
        </Text>
      </View>
      {courseSubmissions.length === 0 ? (
        <Text style={{ color: colors.textSecondary, fontStyle: 'italic', textAlign: 'center', marginTop: 20 }}>No graded submissions yet.</Text>
      ) : (
        courseSubmissions.map(sub => {
          const item = contentItems.find(i => i.id === sub.contentItemId);
          const maximum = item ? getAssessmentMaxScore(item) : 0;
          return (
            <View key={sub.id} style={{ backgroundColor: colors.card, padding: 15, borderRadius: 12, marginBottom: 10, borderColor: colors.border, borderWidth: 1 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: colors.text, fontWeight: 'bold' }}>{item?.title || 'Unknown Assignment'}{sub.attemptNumber ? ` · Attempt ${sub.attemptNumber}` : ''}</Text>
                <Text style={{ color: sub.status === 'graded' ? '#4CAF50' : '#FF9800', fontWeight: 'bold' }}>
                  {maximum > 0 ? `${sub.totalScore ?? 0} / ${maximum} pts` : `${sub.totalScore ?? 0} pts`}
                </Text>
              </View>
              {sub.overallFeedback && (
                <Text style={{ color: colors.textSecondary, marginTop: 8, fontStyle: 'italic' }}>Feedback: {sub.overallFeedback}</Text>
              )}
            </View>
          );
        })
      )}
    </BaseModal>
  );
};

export const CourseSettingsModal = ({ visible, onClose, course }: { visible: boolean, onClose: () => void, course: Course }) => {
  const colors = useThemeColors();
  const { addStudentToCourse, updateCourse, contentItems } = useLMSStore();
  const currentUserRole = useCourseRole(course.id) ?? 'student';
  const isReady = useModalLoader(visible);
  const [newStudent, setNewStudent] = useState('');
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [courseConfigError, setCourseConfigError] = useState<string | null>(null);
  const [weightError, setWeightError] = useState<string | null>(null);
  const [courseTitle, setCourseTitle] = useState(course.title);
  const [courseDescription, setCourseDescription] = useState(course.description || '');
  const [termStartInput, setTermStartInput] = useState(() => new Date(course.termStart).toISOString().slice(0, 10));
  const [termEndInput, setTermEndInput] = useState(() => new Date(course.termEnd).toISOString().slice(0, 10));
  const [visibilityTimerInput, setVisibilityTimerInput] = useState(String(course.visibilityTimer ?? 0));
  const [selectedGroupSetId, setSelectedGroupSetId] = useState(course.groupSets?.[0]?.id || '');
  const [groupDrafts, setGroupDrafts] = useState<Record<string, Record<string, string>>>(() => groupDraftsForCourse(course));
  const groupDraftsRef = useRef(groupDrafts);
  const [dirtyGroupAssignments, setDirtyGroupAssignments] = useState<Set<string>>(() => new Set());
  const [savingRoleFor, setSavingRoleFor] = useState<string | null>(null);
  const [pendingGroupMutations, setPendingGroupMutations] = useState(0);
  const [isAddingStudent, setIsAddingStudent] = useState(false);
  const groupMutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingGroupKeysRef = useRef(new Set<string>());
  const addStudentLockRef = useRef(false);
  const addGroupSetLockRef = useRef(false);
  const configSaveLockRef = useRef(false);
  const weightSaveLockRef = useRef(false);

  const [isEditConfig, setIsEditConfig] = useState(false);
  const [isEditWeights, setIsEditWeights] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [isSavingWeights, setIsSavingWeights] = useState(false);
  const [showRoles, setShowRoles] = useState(false);

  const [weights, setWeights] = useState(
    Object.entries(course.gradingWeights || {}).map(([k, v]) => ({ id: createEntityId('weight'), key: k, value: String(v) }))
  );
  const openedCourseRef = useRef<string | null>(null);

  useEffect(() => {
    if (!visible) {
      openedCourseRef.current = null;
      return;
    }
    if (openedCourseRef.current === course.id) return;
    openedCourseRef.current = course.id;
    const drafts = groupDraftsForCourse(course);
    setNewStudent('');
    setRosterError(null);
    setCourseConfigError(null);
    setWeightError(null);
    setCourseTitle(course.title);
    setCourseDescription(course.description || '');
    setTermStartInput(new Date(course.termStart).toISOString().slice(0, 10));
    setTermEndInput(new Date(course.termEnd).toISOString().slice(0, 10));
    setVisibilityTimerInput(String(course.visibilityTimer ?? 0));
    setSelectedGroupSetId(course.groupSets?.[0]?.id || '');
    setGroupDrafts(drafts);
    groupDraftsRef.current = drafts;
    setDirtyGroupAssignments(new Set());
    setWeights(Object.entries(course.gradingWeights || {}).map(([key, value]) => ({ id: createEntityId('weight'), key, value: String(value) })));
    setIsEditConfig(false);
    setIsEditWeights(false);
    setShowRoles(false);
  }, [course, visible]);

  const handleAddStudent = async () => {
    if (addStudentLockRef.current) return;
    const identifier = newStudent.trim();
    if (!identifier || identifier.length > 320 || /[\u0000-\u001f\u007f]/.test(identifier)) {
      setRosterError('Enter a valid institution user ID or disclosed email address.');
      return;
    }
    addStudentLockRef.current = true;
    setIsAddingStudent(true);
    try {
      await addStudentToCourse(course.id, identifier);
      setNewStudent('');
      setRosterError(null);
    } catch (error) {
      setRosterError(error instanceof Error ? error.message : 'Student enrollment failed.');
    } finally {
      addStudentLockRef.current = false;
      setIsAddingStudent(false);
    }
  };

  const handleGroupSave = async (targetGroupSetId: string, studentId: string) => {
    if (!targetGroupSetId) return;
    const assignmentKey = `${targetGroupSetId}:${studentId}`;
    if (pendingGroupKeysRef.current.has(assignmentKey)) return;
    const value = (groupDraftsRef.current[targetGroupSetId]?.[studentId] || '').trim();
    pendingGroupKeysRef.current.add(assignmentKey);
    setSavingRoleFor(assignmentKey);
    setPendingGroupMutations(count => count + 1);
    setRosterError(null);
    const mutation = groupMutationQueueRef.current.then(async () => {
      const latestCourse = useLMSStore.getState().courses.find(candidate => candidate.id === course.id) || course;
      const groupSet = latestCourse.groupSets?.find(candidate => candidate.id === targetGroupSetId);
      if (!groupSet) throw new Error('The selected group set is no longer available.');
      const currentValue = groupSet.groups.find(group => group.memberIds.includes(studentId))?.name || '';
      if (value === currentValue) return;
      let targetId = groupSet.groups.find(group => group.name.toLocaleLowerCase() === value.toLocaleLowerCase())?.id;
      if (value && !targetId) targetId = createEntityId('group');
      const nextGroups = groupSet.groups.map(group => ({
        ...group,
        memberIds: group.memberIds.filter(memberId => memberId !== studentId),
      }));
      if (value && targetId) {
        const target = nextGroups.find(group => group.id === targetId);
        if (target) target.memberIds = [...target.memberIds, studentId];
        else nextGroups.push({ id: targetId, name: value, memberIds: [studentId] });
      }
      const nextGroupSets = (latestCourse.groupSets || []).map(candidate => candidate.id === groupSet.id
        ? { ...candidate, groups: nextGroups }
        : candidate);
      await updateCourse(course.id, { groupSets: nextGroupSets });
    });
    groupMutationQueueRef.current = mutation.then(() => undefined, () => undefined);
    try {
      await mutation;
      if ((groupDraftsRef.current[targetGroupSetId]?.[studentId] || '').trim() === value) {
        setDirtyGroupAssignments(previous => {
          const next = new Set(previous);
          next.delete(assignmentKey);
          return next;
        });
      }
    } catch (error) {
      const latestCourse = useLMSStore.getState().courses.find(candidate => candidate.id === course.id) || course;
      const persistedValue = latestCourse.groupSets?.find(candidate => candidate.id === targetGroupSetId)
        ?.groups.find(group => group.memberIds.includes(studentId))?.name || '';
      if ((groupDraftsRef.current[targetGroupSetId]?.[studentId] || '').trim() === value) {
        setGroupDrafts(previous => {
          const next = {
            ...previous,
            [targetGroupSetId]: { ...(previous[targetGroupSetId] || {}), [studentId]: persistedValue },
          };
          groupDraftsRef.current = next;
          return next;
        });
        setDirtyGroupAssignments(previous => {
          const next = new Set(previous);
          next.delete(assignmentKey);
          return next;
        });
      }
      setRosterError(error instanceof Error ? error.message : 'Group assignment could not be saved.');
    } finally {
      pendingGroupKeysRef.current.delete(assignmentKey);
      setSavingRoleFor(current => current === assignmentKey ? null : current);
      setPendingGroupMutations(count => Math.max(0, count - 1));
    }
  };

  const addGroupSet = async () => {
    if (addGroupSetLockRef.current) return;
    addGroupSetLockRef.current = true;
    const id = createEntityId('group-set');
    setPendingGroupMutations(count => count + 1);
    const mutation = groupMutationQueueRef.current.then(async () => {
      const latestCourse = useLMSStore.getState().courses.find(candidate => candidate.id === course.id) || course;
      const nextGroupSet = { id, name: `Assignment Groups ${(latestCourse.groupSets?.length || 0) + 1}`, groups: [] };
      await updateCourse(course.id, { groupSets: [...(latestCourse.groupSets || []), nextGroupSet] });
    });
    groupMutationQueueRef.current = mutation.then(() => undefined, () => undefined);
    try {
      await mutation;
      setGroupDrafts(previous => {
        const next = { ...previous, [id]: {} };
        groupDraftsRef.current = next;
        return next;
      });
      setSelectedGroupSetId(id);
      setRosterError(null);
    } catch (error) {
      setRosterError(error instanceof Error ? error.message : 'Group set could not be created.');
    } finally {
      addGroupSetLockRef.current = false;
      setPendingGroupMutations(count => Math.max(0, count - 1));
    }
  };

  const saveCourseConfiguration = async () => {
    if (configSaveLockRef.current) return;
    const title = courseTitle.trim();
    const visibilityTimer = Number(visibilityTimerInput);
    if (!title) {
      setCourseConfigError('Course title is required.');
      return;
    }
    if (!isValidISODate(termStartInput) || !isValidISODate(termEndInput)) {
      setCourseConfigError('Term dates must be valid calendar dates in YYYY-MM-DD format.');
      return;
    }
    if (termStartInput >= termEndInput) {
      setCourseConfigError('Term end must be after term start.');
      return;
    }
    if (!Number.isInteger(visibilityTimer) || visibilityTimer < 0 || visibilityTimer > 8760) {
      setCourseConfigError('Visibility timer must be a whole number from 0 to 8,760 hours.');
      return;
    }
    configSaveLockRef.current = true;
    setIsSavingConfig(true);
    setCourseConfigError(null);
    try {
      await updateCourse(course.id, {
        title,
        description: courseDescription.trim(),
        termStart: Date.parse(`${termStartInput}T00:00:00Z`),
        termEnd: Date.parse(`${termEndInput}T23:59:59.999Z`),
        visibilityTimer,
      });
      setIsEditConfig(false);
    } catch (error) {
      setCourseConfigError(error instanceof Error ? error.message : 'Course configuration could not be saved.');
    } finally {
      configSaveLockRef.current = false;
      setIsSavingConfig(false);
    }
  };

  const saveGradingWeights = async () => {
    if (weightSaveLockRef.current) return;
    const normalized = weights.map(entry => ({ label: entry.key.trim(), weight: Number(entry.value.trim().replace(/%$/, '')) }));
    const labels = normalized.map(entry => entry.label.toLocaleLowerCase());
    if (normalized.some(entry => !entry.label)) {
      setWeightError('Every grading category requires a label.');
      return;
    }
    if (new Set(labels).size !== labels.length) {
      setWeightError('Grading category labels must be unique.');
      return;
    }
    if (normalized.some(entry => !Number.isFinite(entry.weight) || entry.weight < 0 || entry.weight > 100)) {
      setWeightError('Each grading weight must be a number from 0 to 100.');
      return;
    }
    const total = normalized.reduce((sum, entry) => sum + entry.weight, 0);
    if (normalized.length && Math.abs(total - 100) > 0.01) {
      setWeightError(`Grading weights must total 100%. Current total: ${total}%.`);
      return;
    }
    const nextLabels = new Set(normalized.map(entry => entry.label.toLocaleLowerCase()));
    const removedCategoriesInUse = Array.from(new Set(contentItems
      .filter(item => item.courseId === course.id && item.isGraded && item.gradingCategory && !nextLabels.has(item.gradingCategory.toLocaleLowerCase()))
      .map(item => item.gradingCategory as string)));
    if (removedCategoriesInUse.length) {
      setWeightError(`Reassign graded content before removing or renaming: ${removedCategoriesInUse.join(', ')}.`);
      return;
    }
    weightSaveLockRef.current = true;
    setIsSavingWeights(true);
    setWeightError(null);
    try {
      await updateCourse(course.id, { gradingWeights: Object.fromEntries(normalized.map(entry => [entry.label, entry.weight])) });
      setWeights(normalized.map(entry => ({ id: createEntityId('weight'), key: entry.label, value: String(entry.weight) })));
      setIsEditWeights(false);
    } catch (error) {
      setWeightError(error instanceof Error ? error.message : 'Grading weights could not be saved.');
    } finally {
      weightSaveLockRef.current = false;
      setIsSavingWeights(false);
    }
  };

  const settingsBusy = isAddingStudent || pendingGroupMutations > 0 || isSavingConfig || isSavingWeights;
  const requestSettingsExit = (action: () => void = onClose) => {
    if (settingsBusy) return;
    if (!newStudent.trim() && !isEditConfig && !isEditWeights && dirtyGroupAssignments.size === 0) {
      action();
      return;
    }
    Alert.alert('Discard unsaved course settings?', 'A pending enrollment, course configuration, grading weights, or group assignments have not been saved.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: action },
    ]);
  };

  if (!hasCoursePermission(currentUserRole, 'manageCourse')) {
    return <BaseModal visible={visible} onClose={onClose} title="Course Settings"><Text style={{ color: colors.error }}>You do not have permission to change course settings.</Text></BaseModal>;
  }

  return (
    <BaseModal visible={visible} onClose={() => requestSettingsExit()} title={`Settings: ${course.title}`} isLoading={!isReady} closeDisabled={settingsBusy}>
      <Text style={{ color: colors.text, fontWeight: 'bold', fontSize: 16, marginBottom: 10 }}>Roster Management</Text>
      {hasCoursePermission(currentUserRole, 'manageCourse') && (
        <View style={{ flexDirection: 'row', marginBottom: 20 }}>
          <TextInput 
            style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border, flex: 1, marginRight: 10 }]}
            placeholder="Institution user ID or disclosed email"
            placeholderTextColor={colors.textSecondary}
            value={newStudent}
            onChangeText={setNewStudent}
            maxLength={320}
            accessibilityLabel="Student institution user ID or disclosed email"
          />
          <TouchableOpacity 
            style={[styles.primaryBtn, { backgroundColor: colors.primary, opacity: isAddingStudent ? 0.6 : 1 }]} 
            disabled={isAddingStudent}
            onPress={() => void handleAddStudent()}
            accessibilityRole="button"
            accessibilityLabel="Add Student"
            accessibilityHint="Adds the specified student to this course."
            accessibilityState={{ disabled: isAddingStudent }}
          >
            <Text style={[styles.primaryBtnText, { color: colors.buttonText }]}>{isAddingStudent ? 'Adding…' : 'Add'}</Text>
          </TouchableOpacity>
        </View>
      )}
      {rosterError && <Text accessibilityRole="alert" style={{ color: colors.error, marginTop: -12, marginBottom: 16 }}>{rosterError}</Text>}

      {/* Roster Controls */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 15, flexWrap: 'wrap' }}>
        <TouchableOpacity disabled={settingsBusy} accessibilityRole="link" accessibilityLabel={`View course participants, ${course.staff.filter(member => member.role === 'student').length} students`} accessibilityState={{ disabled: settingsBusy }} style={{ minHeight: 44, justifyContent: 'center' }} onPress={() => requestSettingsExit(() => { onClose(); router.push({ pathname: '/admin/course/[id]/roster', params: { id: course.id } }); })}>
          <Text style={{ color: colors.primary, textDecorationLine: 'underline', marginRight: 15, marginBottom: 5 }}>
            Current Participants: {course.staff.filter(member => member.role === 'student').length}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity disabled={settingsBusy} accessibilityRole="button" accessibilityLabel="View course roster" accessibilityState={{ disabled: settingsBusy }} style={[styles.actionBtn, { paddingVertical: 4, minHeight: 44 }]} onPress={() => requestSettingsExit(() => { onClose(); router.push({ pathname: '/admin/course/[id]/roster', params: { id: course.id } }); })}>
          <Text style={[styles.actionBtnText, { color: colors.primary, marginLeft: 0 }]}>View</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Assignment groups" accessibilityState={{ expanded: showRoles }} style={[styles.actionBtn, { paddingVertical: 4, minHeight: 44 }]} onPress={() => { setShowRoles(!showRoles); }}>
          <Text style={[styles.actionBtnText, { color: colors.primary, marginLeft: 0 }]}>{showRoles ? 'Hide Groups' : 'Groups'}</Text>
        </TouchableOpacity>
      </View>

      {showRoles && (
        <View style={{ marginBottom: 20, backgroundColor: colors.background, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: colors.border }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <Text style={{ color: colors.text, fontWeight: 'bold' }}>Assignment Group Sets</Text>
            <TouchableOpacity disabled={settingsBusy} onPress={() => void addGroupSet()} accessibilityRole="button" accessibilityLabel="Add assignment group set" accessibilityState={{ disabled: settingsBusy, busy: pendingGroupMutations > 0 }} style={{ opacity: settingsBusy ? 0.5 : 1 }}>
              <Text style={{ color: colors.primary, fontWeight: 'bold' }}>+ Group Set</Text>
            </TouchableOpacity>
          </View>
          {!!course.groupSets?.length && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 10 }}>
              {course.groupSets.map(groupSet => (
                <TouchableOpacity
                  key={groupSet.id}
                  onPress={() => setSelectedGroupSetId(groupSet.id)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: selectedGroupSetId === groupSet.id }}
                  style={{ paddingHorizontal: 10, paddingVertical: 7, marginRight: 6, marginBottom: 6, borderRadius: 14, borderWidth: 1, borderColor: selectedGroupSetId === groupSet.id ? colors.primary : colors.border }}
                >
                  <Text style={{ color: selectedGroupSetId === groupSet.id ? colors.primary : colors.text }}>{groupSet.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          {!selectedGroupSetId && <Text style={{ color: colors.textSecondary, marginBottom: 10 }}>Create a group set, then type or reuse group names for each student.</Text>}
          {(course.staff || []).filter(u => u.role === 'student').map(student => (
            <View key={student.id} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10, justifyContent: 'space-between' }}>
              <Text style={{ color: colors.text, flex: 1 }}>{student.name}</Text>
              <TextInput 
                accessibilityLabel={`Group assignment for ${student.name}`}
                style={[styles.input, { flex: 1, backgroundColor: colors.card, color: colors.text, borderColor: colors.border, paddingVertical: 4 }]}
                placeholder="Group name (blank = unassigned)"
                placeholderTextColor={colors.textSecondary}
                value={groupDrafts[selectedGroupSetId]?.[student.id] ?? ''}
                editable={Boolean(selectedGroupSetId) && savingRoleFor !== `${selectedGroupSetId}:${student.id}`}
                maxLength={500}
                onChangeText={value => {
                  const assignmentKey = `${selectedGroupSetId}:${student.id}`;
                  setGroupDrafts(previous => {
                    const next = {
                      ...previous,
                      [selectedGroupSetId]: { ...(previous[selectedGroupSetId] || {}), [student.id]: value },
                    };
                    groupDraftsRef.current = next;
                    return next;
                  });
                  setDirtyGroupAssignments(previous => new Set(previous).add(assignmentKey));
                }}
                onEndEditing={() => void handleGroupSave(selectedGroupSetId, student.id)}
              />
            </View>
          ))}
          {(course.staff || []).filter(u => u.role === 'student').length === 0 && (
            <Text style={{ color: colors.textSecondary, fontStyle: 'italic' }}>No students in roster.</Text>
          )}
        </View>
      )}
      
      {/* Course Configuration */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, marginBottom: 10 }}>
        <Text style={{ color: colors.text, fontWeight: 'bold', fontSize: 16 }}>Course Configuration</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={isSavingConfig ? 'Saving course configuration' : isEditConfig ? 'Save course configuration' : 'Edit course configuration'} accessibilityState={{ disabled: isSavingConfig, busy: isSavingConfig }} style={{ minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' }} disabled={isSavingConfig} onPress={() => {
          if (!isEditConfig) {
            setCourseConfigError(null);
            setIsEditConfig(true);
            return;
          }
          void saveCourseConfiguration();
        }}>
          <Text style={{ color: colors.primary, fontSize: 14 }}>{isSavingConfig ? 'Saving…' : isEditConfig ? 'Save' : 'Edit'}</Text>
        </TouchableOpacity>
      </View>
      {courseConfigError && <Text accessibilityRole="alert" style={{ color: colors.error, marginBottom: 8 }}>{courseConfigError}</Text>}

      {isEditConfig ? (
        <View style={{ marginBottom: 8 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8, alignItems: 'center' }}>
            <Text style={{ color: colors.textSecondary, flex: 1 }}>Course Title (Required)</Text>
            <TextInput 
              accessibilityLabel="Course title"
              style={[styles.input, { flex: 1, paddingVertical: 4, backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
	              value={courseTitle}
	              onChangeText={setCourseTitle}
	              maxLength={500}
            />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8, alignItems: 'center' }}>
            <Text style={{ color: colors.textSecondary, flex: 1 }}>Course Description</Text>
            <TextInput 
              accessibilityLabel="Course description"
              style={[styles.input, { flex: 1, paddingVertical: 4, backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
	              value={courseDescription}
	              onChangeText={setCourseDescription}
	              maxLength={250_000}
            />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8, alignItems: 'center' }}>
            <Text style={{ color: colors.textSecondary, flex: 1 }}>Term Start</Text>
            <TextInput
              accessibilityLabel="Course term start date"
              style={[styles.input, { flex: 1, paddingVertical: 4, backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
              value={termStartInput}
              onChangeText={setTermStartInput}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.textSecondary}
              maxLength={10}
            />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8, alignItems: 'center' }}>
            <Text style={{ color: colors.textSecondary, flex: 1 }}>Term End</Text>
            <TextInput
              accessibilityLabel="Course term end date"
              style={[styles.input, { flex: 1, paddingVertical: 4, backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
              value={termEndInput}
              onChangeText={setTermEndInput}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.textSecondary}
              maxLength={10}
            />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8, alignItems: 'center' }}>
            <Text style={{ color: colors.textSecondary, flex: 1 }}>Visibility Timer (hours)</Text>
            <TextInput
              accessibilityLabel="Course visibility timer in hours"
              style={[styles.input, { flex: 1, paddingVertical: 4, backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
              value={visibilityTimerInput}
              onChangeText={setVisibilityTimerInput}
              keyboardType="number-pad"
            />
          </View>
        </View>
      ) : (
        <View style={{ marginBottom: 8 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8, alignItems: 'center' }}>
            <Text style={{ color: colors.textSecondary, flex: 1 }}>Course Title</Text>
            <Text style={{ color: colors.textSecondary, flex: 1, textAlign: 'right' }}>{courseTitle}</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8, alignItems: 'center' }}>
            <Text style={{ color: colors.textSecondary, flex: 1 }}>Course Description</Text>
            <Text style={{ color: colors.textSecondary, flex: 1, textAlign: 'right' }} numberOfLines={1}>{courseDescription}</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8, alignItems: 'center' }}>
            <Text style={{ color: colors.textSecondary, flex: 1 }}>Term</Text>
            <Text style={{ color: colors.textSecondary, flex: 1, textAlign: 'right' }}>{termStartInput} – {termEndInput}</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8, alignItems: 'center' }}>
            <Text style={{ color: colors.textSecondary, flex: 1 }}>Visibility Timer</Text>
            <Text style={{ color: colors.textSecondary, flex: 1, textAlign: 'right' }}>{visibilityTimerInput} hours</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8, alignItems: 'center' }}>
            <Text style={{ color: colors.textSecondary, flex: 1 }}>Presentation Mode</Text>
            <Text style={{ color: colors.textSecondary, flex: 1, textAlign: 'right', textTransform: 'capitalize' }}>{course.presentationMode}</Text>
          </View>
        </View>
      )}
      
      {/* Grading Weights */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 20, marginBottom: 10 }}>
        <Text style={{ color: colors.text, fontWeight: 'bold', fontSize: 14 }}>Grading Weights</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={isSavingWeights ? 'Saving grading weights' : isEditWeights ? 'Save grading weights' : 'Edit grading weights'} accessibilityState={{ disabled: isSavingWeights, busy: isSavingWeights }} style={{ minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' }} disabled={isSavingWeights} onPress={() => {
          if (!isEditWeights) {
            setWeightError(null);
            setIsEditWeights(true);
            return;
          }
          void saveGradingWeights();
        }}>
          <Text style={{ color: colors.primary, fontSize: 14 }}>{isSavingWeights ? 'Saving…' : isEditWeights ? 'Save' : 'Edit'}</Text>
        </TouchableOpacity>
      </View>
      {weightError && <Text accessibilityRole="alert" style={{ color: colors.error, marginBottom: 8 }}>{weightError}</Text>}

      {weights.map((item, idx) => (
        <View key={item.id} style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8, alignItems: 'center' }}>
          {isEditWeights ? (
            <>
              <TouchableOpacity onPress={() => { const n = [...weights]; n.splice(idx, 1); setWeights(n); }} style={{ marginRight: 5 }} accessibilityRole="button" accessibilityLabel={`Delete grading category ${item.key || idx + 1}`}>
                <Ionicons name="close-circle" size={20} color="#FF5252" />
              </TouchableOpacity>
              <TextInput 
                accessibilityLabel={`Grading category ${idx + 1} name`}
                style={[styles.input, { flex: 1, marginRight: 5, paddingVertical: 4, backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
	                value={item.key}
	                onChangeText={(val) => setWeights(current => current.map(entry => entry.id === item.id ? { ...entry, key: val } : entry))}
	                maxLength={500}
              />
              <TextInput 
                style={[styles.input, { flex: 1, marginLeft: 5, paddingVertical: 4, backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
                value={item.value}
	                onChangeText={(val) => setWeights(current => current.map(entry => entry.id === item.id ? { ...entry, value: val } : entry))}
	                maxLength={20}
                keyboardType="decimal-pad"
                accessibilityLabel={`${item.key || `Category ${idx + 1}`} grading weight`}
              />
              <Text style={{ color: colors.text, marginLeft: 5 }}>%</Text>
            </>
          ) : (
            <>
              <Text style={{ color: colors.textSecondary, flex: 1 }}>{item.key}</Text>
              <Text style={{ color: colors.textSecondary, flex: 1, textAlign: 'right' }}>{item.value}</Text>
            </>
          )}
        </View>
      ))}
      {isEditWeights && (
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Add grading category" style={{ alignSelf: 'flex-start', marginTop: 5, minHeight: 44, justifyContent: 'center' }} onPress={() => setWeights([...weights, { id: createEntityId('weight'), key: `Category ${weights.length + 1}`, value: '0' }])}>
          <Text style={{ color: colors.primary }}>+ Add Category</Text>
        </TouchableOpacity>
      )}
      {isEditWeights && (
        <Text style={{ color: colors.textSecondary, textAlign: 'right', marginTop: 8 }}>
          Total: {weights.reduce((sum, entry) => sum + (Number(entry.value.trim().replace(/%$/, '')) || 0), 0)}%
        </Text>
      )}
    </BaseModal>
  );
};

export const StudentInfoModal = ({ visible, onClose, course, onOpenSettings }: { visible: boolean, onClose: () => void, course: Course, onOpenSettings?: () => void }) => {
  const colors = useThemeColors();
  const currentUserRole = useCourseRole(course.id) ?? 'student';
  const isReady = useModalLoader(visible);
  const canManageCourse = hasCoursePermission(currentUserRole, 'manageCourse');
  const courseItemCount = useLMSStore(state => state.contentItems.filter(item => item.courseId === course.id && !item.deletedAt).length);
  const participantCount = course.staff.filter(member => member.role === 'student').length;

  return (
    <BaseModal visible={visible} onClose={onClose} title={`Course Info: ${course.title}`} isLoading={!isReady}>
      <CourseInformationView course={course} courseItemCount={courseItemCount} participantCount={participantCount} />
      {canManageCourse && onOpenSettings && (
        <TouchableOpacity onPress={onOpenSettings} style={[styles.primaryBtn, { backgroundColor: colors.primary, marginTop: 16 }]} accessibilityRole="button">
          <Text style={[styles.primaryBtnText, { color: colors.buttonText }]}>Open course settings</Text>
        </TouchableOpacity>
      )}
    </BaseModal>
  );
};

export const ContactInfoModal = ({ visible, onClose, course }: { visible: boolean, onClose: () => void, course: Course }) => {
  const colors = useThemeColors();
  const currentUserRole = useCourseRole(course.id) ?? 'student';
  const isReady = useModalLoader(visible);
  const isStaff = currentUserRole !== 'student';

  return (
    <BaseModal visible={visible} onClose={onClose} title="Staff Contact" isLoading={!isReady}>
      {isStaff && <Text style={{ color: colors.textSecondary, marginBottom: 15 }}>Staff directory entries are managed by the institution identity system.</Text>}
      {(course.staff || []).filter(member => ['teacher', 'ta', 'it', 'admin'].includes(member.role)).map(s => (
        <View key={s.id} style={{ marginBottom: 15, padding: 15, backgroundColor: colors.background, borderRadius: 8, borderWidth: 1, borderColor: colors.border }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ color: colors.text, fontWeight: 'bold', fontSize: 16 }}>{s.name} ({s.role.toUpperCase()})</Text>
          </View>
          <Text style={{ color: s.email ? colors.primary : colors.textSecondary, marginTop: 5 }}>{s.email || 'Email not disclosed'}</Text>
        </View>
      ))}
    </BaseModal>
  );
};

const CourseActionTab = ({ icon, label, onPress, isTop, isBottom, colors, expanded, setHovered }: any) => {
  return (
    <Pressable
      onPress={onPress}
      {...({ onHoverIn: () => setHovered(true), onHoverOut: () => setHovered(false) } as any)}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        {
          backgroundColor: colors.card,
          paddingVertical: 12,
          paddingHorizontal: expanded ? 16 : 12,
          borderTopLeftRadius: isTop ? 12 : 0,
          borderBottomLeftRadius: isBottom ? 12 : 0,
          borderLeftWidth: 1,
          borderTopWidth: isTop ? 1 : 0,
          borderBottomWidth: isBottom ? 1 : 0,
          borderColor: colors.border,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
        },
        pressed && { opacity: 0.8 }
      ]}
    >
      <Ionicons name={icon as any} size={20} color={colors.primary} />
      {expanded && <Text style={{ color: colors.primary, marginLeft: 8, fontWeight: 'bold' }}>{label}</Text>}
    </Pressable>
  );
};

const CourseDueStatus = ({ dueAt }: { dueAt: number }) => {
  const [currentTime, setCurrentTime] = useState<number | null>(null);

  useEffect(() => {
    const initialTimer = setTimeout(() => setCurrentTime(Date.now()), 0);
    const interval = setInterval(() => setCurrentTime(Date.now()), 60_000);
    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, []);

  if (currentTime === null) return null;
  const daysAway = Math.ceil((dueAt - currentTime) / (1000 * 60 * 60 * 24));
  const dueColor = daysAway <= 1 ? '#FF5252' : daysAway < 7 ? '#FFC107' : '#4CAF50';
  const absoluteDays = Math.abs(daysAway);
  const dueText = daysAway < 0
    ? `${absoluteDays} ${absoluteDays === 1 ? 'day' : 'days'} overdue`
    : daysAway === 0
      ? 'due today'
      : `due in ${daysAway} ${daysAway === 1 ? 'day' : 'days'}`;

  return (
    <View style={styles.statusBadge}>
      <Ionicons name="time" size={14} color={dueColor} style={{ marginRight: 6 }} />
      <Text style={{ color: dueColor, fontSize: 12, fontWeight: 'bold' }}>Course content {dueText}</Text>
    </View>
  );
};

export const CourseCard = ({ course, onActionPress }: { course: Course, onActionPress?: (action: string, course: Course) => void }) => {
  const colors = useThemeColors();
  const currentUserId = useLMSStore(state => state.currentUserId);
  const { adminCourseLayoutMode: layoutMode } = useSettingsStore();
  const [actionHovered, setActionHovered] = useState(false);

  const courseRole = course.staff.find(user => user.id === currentUserId)?.role;
  const actions = useMemo(() => {
    return getCourseCardActionDescriptors(courseRole).map(action => ({
      ...action,
      onPress: action.destination === 'roster'
        ? () => router.push({ pathname: '/admin/course/[id]/roster', params: { id: course.id } })
        : () => onActionPress?.(action.id, course),
    }));
  }, [courseRole, course, onActionPress]);

  return (
    <View style={[styles.courseCard, { backgroundColor: colors.card, borderColor: colors.border, flexDirection: layoutMode === 'compact' ? 'row' : 'column', zIndex: actionHovered ? 10 : 1 }]}>
      <TouchableOpacity 
        style={{ flex: 1 }} 
        onPress={() => router.push({ pathname: '/admin/course/[id]', params: { id: course.id } })}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={`Course: ${course.title}`}
        accessibilityHint="Opens the course dashboard"
      >
        <LinearGradient colors={[colors.primary + '20', colors.background]} style={[styles.cardHeader, layoutMode === 'compact' && { height: '100%', justifyContent: 'center' }]}>
          <Text style={[styles.courseTitle, { color: colors.text, fontSize: layoutMode === 'compact' ? 18 : 22 }]}>{course.title}</Text>
          {layoutMode !== 'compact' && (
            <Text style={[styles.courseDesc, { color: colors.textSecondary }]} numberOfLines={2}>{course.description || ''}</Text>
          )}
          
          <View style={{ marginTop: 12, gap: 6, alignItems: 'flex-start' }}>
            {course.hasUpdates && (
              <View style={[styles.statusBadge]}>
                <Ionicons name="sparkles" size={14} color="#4FC3F7" style={{ marginRight: 6 }} />
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: 'bold' }}>There is an update to course content</Text>
              </View>
            )}
            
            {course.nextDueDate && <CourseDueStatus dueAt={course.nextDueDate} />}
          </View>
        </LinearGradient>
      </TouchableOpacity>
        
      {layoutMode !== 'compact' && (
        <View style={[styles.actionBar, { borderTopColor: colors.border }]}>
          {actions.map((act, idx) => (
            <TouchableOpacity key={idx} style={styles.actionBtn} onPress={act.onPress} accessibilityRole="button" accessibilityLabel={act.label}>
              <Ionicons name={act.icon as any} size={18} color={colors.primary} />
              <Text style={[styles.actionBtnText, { color: colors.primary }]}>{act.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {layoutMode === 'compact' && (
        <View style={{ justifyContent: 'center', backgroundColor: colors.background }}>
          {actions.map((act, idx) => (
            <CourseActionTab 
              key={idx} 
              icon={act.icon} 
              label={act.label} 
              onPress={act.onPress} 
              isTop={idx === 0} 
              isBottom={idx === actions.length - 1} 
              colors={colors}
              expanded={actionHovered}
              setHovered={setActionHovered}
            />
          ))}
        </View>
      )}

    </View>
  );
};

const styles = StyleSheet.create({
  // Announcements
  announcementContainer: {
    alignSelf: 'center',
    marginTop: 12,
    borderRadius: 16,
    padding: 15,
    elevation: 8,
    ...(Platform.OS === 'web'
      ? { boxShadow: '0 4px 10px rgba(0,0,0,0.3)' }
      : { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10 }),
    flexDirection: 'column',
    justifyContent: 'space-between',
  },
  announcementContent: { flex: 1, marginBottom: 10 },
  announcementTitle: { fontSize: 16, fontWeight: 'bold', marginBottom: 5 },
  announcementText: { fontSize: 14, opacity: 0.9 },
  announcementActions: { flexDirection: 'row', justifyContent: 'flex-end', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.3)', paddingTop: 10 },
  announcementBtn: { marginLeft: 8, minWidth: 64, minHeight: 44, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  announcementBtnText: { fontSize: 14 },
  
  // Analytics
  analyticsStats: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  statBox: { flex: 1, padding: 15, borderRadius: 12, alignItems: 'center', marginHorizontal: 5 },
  statValue: { fontSize: 24, fontWeight: 'bold', marginBottom: 5 },
  statLabel: { fontSize: 12, textAlign: 'center' },
  
  // Forms & Inputs
  input: { borderWidth: 1, borderRadius: 8, padding: 12, fontSize: 16 },
  primaryBtn: { paddingHorizontal: 20, justifyContent: 'center', alignItems: 'center', borderRadius: 8 },
  primaryBtnText: { fontWeight: 'bold', fontSize: 16 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(150,150,150,0.2)' },
  
  // Course Cards
  courseCard: { borderRadius: 16, borderWidth: 1, marginBottom: 20, overflow: 'hidden' },
  cardHeader: { padding: 20 },
  courseTitle: { fontSize: 22, fontWeight: 'bold', marginBottom: 8 },
  courseDesc: { fontSize: 14, lineHeight: 20 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.7)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  actionBar: { flexDirection: 'row', borderTopWidth: 1, padding: 10, flexWrap: 'wrap' },
  actionBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, margin: 4, backgroundColor: 'rgba(150,150,150,0.1)' },
  actionBtnText: { marginLeft: 6, fontWeight: '600', fontSize: 14 }
});
