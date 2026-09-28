/**
 * @fileoverview src/app/admin/course/[id]/index.tsx.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, Platform, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useThemeColors } from '../../../../lib/useThemeColors';
import { useLMSStore } from '../../../../lib/store/useLMSStore';
import { ContentManager } from '../../../../components/lms/ContentManager';
import { StudentFeed } from '../../../../components/lms/StudentFeed';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NestableScrollContainer } from 'react-native-draggable-flatlist';
import { PresentationMode } from '../../../../types/lms';
import { hasCoursePermission } from '../../../../lib/authorization/coursePermissions';
import { isCoursePastAt } from '../../../../lib/courseLifecycle';
import { CourseSetupReviewPanel } from '../../../../components/lms/CourseSetupReviewPanel';
import { CourseAnnouncementActivityPanel } from '../../../../components/lms/CourseAnnouncementActivityPanel';
import { getLearningStateService } from '../../../../lib/learningState';
import { getSingleEmbeddedSitePresentationItem } from '../../../../lib/coursePresentation';
import { isContentLockedAt } from '../../../../lib/contentAvailability';

export default function AdminCourseDetail() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const router = useRouter();
  const colors = useThemeColors();
  const { width: windowWidth } = useWindowDimensions();
  const currentUserId = useLMSStore(state => state.currentUserId);
  const courses = useLMSStore(state => state.courses);
  const contentItems = useLMSStore(state => state.contentItems);
  const course = courses.find(c => c.id === id);
  const courseItems = useMemo(
    () => contentItems.filter(item => item.courseId === id),
    [contentItems, id],
  );
  const membership = course?.staff.find(user => user.id === currentUserId);
  const effectiveRole = membership?.role;
  const canEdit = hasCoursePermission(effectiveRole, 'manageContent');
  const canConfigure = hasCoursePermission(effectiveRole, 'manageCourse');
  const [viewMode, setViewMode] = useState<'vertical' | 'horizontal'>('vertical');
  const [viewStateError, setViewStateError] = useState<string | null>(null);
  const [layoutModalVisible, setLayoutModalVisible] = useState(false);
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const [isSavingLayout, setIsSavingLayout] = useState(false);
  const [teacherMode, setTeacherMode] = useState<'edit' | 'preview'>('edit');
  const [now, setNow] = useState(() => Date.now());
  const supportsLayoutControls = Platform.OS === 'web' && windowWidth >= 768;
  const isPastCourse = course ? isCoursePastAt(course, now) : false;
  const singleEmbeddedSiteItem = useMemo(
    () => course?.presentationMode === 'custom' ? getSingleEmbeddedSitePresentationItem(courseItems) : null,
    [course?.presentationMode, courseItems],
  );
  const isSingleEmbeddedSiteCourse = Boolean(singleEmbeddedSiteItem && !isContentLockedAt(singleEmbeddedSiteItem, now));
  const isPresentationView = !canEdit || teacherMode === 'preview';
  const showViewModeToggle = supportsLayoutControls && isPresentationView && !isSingleEmbeddedSiteCourse;
  const effectiveViewMode = supportsLayoutControls && !isSingleEmbeddedSiteCourse ? viewMode : 'vertical';
  const returnToCourses = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/admin');
  };

  /* Scope changes intentionally reset stale UI before the async preference hydrate. */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setViewMode('vertical');
    setViewStateError(null);
    if (!currentUserId || !id) return () => { cancelled = true; };
    void getLearningStateService().load(
      { principalId: currentUserId, courseId: id },
      'course-layout',
    ).then(record => {
      if (!cancelled && record) setViewMode(record.payload.viewMode);
    }).catch(error => {
      if (!cancelled) setViewStateError(error instanceof Error ? error.message : 'Saved course layout could not be restored.');
    });
    return () => { cancelled = true; };
  }, [currentUserId, id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const chooseViewMode = (nextViewMode: 'vertical' | 'horizontal') => {
    setViewMode(nextViewMode);
    setViewStateError(null);
    if (!currentUserId || !id) return;
    void getLearningStateService().save(
      { principalId: currentUserId, courseId: id },
      'course-layout',
      { viewMode: nextViewMode },
    ).catch(error => setViewStateError(error instanceof Error ? error.message : 'Course layout preference could not be saved.'));
  };

  if (!course || !effectiveRole) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={{ color: colors.text }}>{course ? 'You are not enrolled in this course.' : 'Course not found'}</Text>
        <TouchableOpacity onPress={returnToCourses} style={{ marginTop: 20 }} accessibilityRole="button" accessibilityLabel="Back to courses">
          <Text style={{ color: colors.primary }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Top Navigation Bar / Mode Switcher (Teachers Only) */}
      {canEdit && (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 10, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <View accessibilityRole="tablist" accessibilityLabel="Course authoring mode" style={{ flexDirection: 'row', backgroundColor: colors.background, borderRadius: 20, padding: 4, borderWidth: 1, borderColor: colors.border }}>
            <TouchableOpacity 
              style={[styles.modeTab, teacherMode === 'edit' && { backgroundColor: colors.primary }]}
              onPress={() => setTeacherMode('edit')}
              accessibilityRole="tab"
              accessibilityLabel="Edit Mode"
              accessibilityState={{ selected: teacherMode === 'edit' }}
            >
              <Ionicons name="create-outline" size={16} color={teacherMode === 'edit' ? colors.buttonText : colors.textSecondary} />
              <Text style={{ marginLeft: 5, color: teacherMode === 'edit' ? colors.buttonText : colors.textSecondary, fontWeight: 'bold' }}>Edit Mode</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.modeTab, teacherMode === 'preview' && { backgroundColor: colors.primary }]}
              onPress={() => setTeacherMode('preview')}
              accessibilityRole="tab"
              accessibilityLabel="Student Preview"
              accessibilityState={{ selected: teacherMode === 'preview' }}
            >
              <Ionicons name="eye-outline" size={16} color={teacherMode === 'preview' ? colors.buttonText : colors.textSecondary} />
              <Text style={{ marginLeft: 5, color: teacherMode === 'preview' ? colors.buttonText : colors.textSecondary, fontWeight: 'bold' }}>Student Preview</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Learner presentations use a compact app bar so content owns the viewport. */}
      {isPresentationView ? (
        <View style={[styles.presentationHeader, { backgroundColor: colors.card, borderBottomColor: colors.border }]}> 
          <TouchableOpacity
            style={styles.presentationHeaderAction}
            onPress={returnToCourses}
            accessibilityRole="button"
            accessibilityLabel="Back to courses"
          >
            <Ionicons name="arrow-back" size={22} color={colors.text} />
          </TouchableOpacity>
          <View style={{ flex: 1, minWidth: 0, marginHorizontal: 10 }}>
            <Text accessibilityRole="header" numberOfLines={1} style={[styles.presentationTitle, { color: colors.text }]}>{course.title}</Text>
            <Text numberOfLines={1} style={[styles.presentationMeta, { color: colors.textSecondary }]}>
              {isSingleEmbeddedSiteCourse ? 'Site course · page fills the learning area' : `${course.presentationMode} presentation`}
            </Text>
          </View>
          {showViewModeToggle ? <View accessibilityRole="tablist" accessibilityLabel="Student course layout" style={[styles.toggleContainer, { backgroundColor: colors.background, borderColor: colors.border }]}> 
            <TouchableOpacity
              style={[styles.toggleBtn, viewMode === 'vertical' && { backgroundColor: colors.primary }]}
                onPress={() => chooseViewMode('vertical')}
              accessibilityRole="tab"
              accessibilityLabel="Vertical View Mode"
              accessibilityState={{ selected: viewMode === 'vertical' }}
            >
              <Text style={{ color: viewMode === 'vertical' ? colors.buttonText : colors.primary }}>Vertical</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toggleBtn, viewMode === 'horizontal' && { backgroundColor: colors.primary }]}
                onPress={() => chooseViewMode('horizontal')}
              accessibilityRole="tab"
              accessibilityLabel="Horizontal View Mode"
              accessibilityState={{ selected: viewMode === 'horizontal' }}
            >
              <Text style={{ color: viewMode === 'horizontal' ? colors.buttonText : colors.primary }}>Horizontal</Text>
            </TouchableOpacity>
          </View> : null}
          {canConfigure ? (
            <TouchableOpacity
              style={[styles.presentationHeaderAction, { marginLeft: 8 }]}
              onPress={() => setLayoutModalVisible(true)}
              accessibilityRole="button"
              accessibilityLabel="Edit Course Layout"
              accessibilityHint="Opens a modal to change the presentation format of the course content."
            >
              <Ionicons name="settings-outline" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          ) : null}
        </View>
      ) : (
        <LinearGradient colors={[colors.primary + '40', colors.background]} style={styles.header}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <TouchableOpacity
              style={styles.backBtn}
              onPress={returnToCourses}
              accessibilityRole="button"
              accessibilityLabel="Back to courses"
            >
              <Ionicons name="arrow-back" size={24} color={colors.text} />
            </TouchableOpacity>
            {canConfigure ? (
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', padding: 5 }}
                onPress={() => setLayoutModalVisible(true)}
                accessibilityRole="button"
                accessibilityLabel="Edit Course Layout"
                accessibilityHint="Opens a modal to change the presentation format of the course content."
              >
                <Ionicons name="settings-outline" size={16} color={colors.textSecondary} />
                <Text style={{ color: colors.textSecondary, marginLeft: 5, fontSize: 12 }}>Edit Course Layout</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.text, marginTop: 15 }]}>{course.title}</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{course.description}</Text>
          <Text style={[styles.meta, { color: colors.textSecondary }]}>Term: {new Date(course.termStart).toLocaleDateString()} - {new Date(course.termEnd).toLocaleDateString()}</Text>
        </LinearGradient>
      )}
      {!!viewStateError && isPresentationView && (
        <Text accessibilityRole="alert" style={{ color: colors.error, fontSize: 12, paddingHorizontal: 16, paddingVertical: 6 }}>
          {viewStateError}
        </Text>
      )}

      {canEdit && teacherMode === 'edit' ? (
        <>
          <CourseSetupReviewPanel course={course} items={courseItems} role={effectiveRole} now={now} />
          <CourseAnnouncementActivityPanel course={course} role={effectiveRole} />
        </>
      ) : null}

      {/* Main Content Area */}
      {canEdit && teacherMode === 'edit' ? (
        <GestureHandlerRootView style={{ flex: 1 }}>
          {Platform.OS === 'web' ? (
            <ScrollView keyboardShouldPersistTaps="handled" style={styles.content} contentContainerStyle={{ paddingBottom: 100 }}>
              <ContentManager courseId={course.id} />
            </ScrollView>
          ) : (
            <NestableScrollContainer style={styles.content} contentContainerStyle={{ paddingBottom: 100 }}>
              <ContentManager courseId={course.id} />
            </NestableScrollContainer>
          )}
        </GestureHandlerRootView>
      ) : (
        <View style={[styles.content, (effectiveViewMode === 'horizontal' || course.presentationMode === 'custom') && { padding: 0, flex: 1 }]}> 
          {isPastCourse && (
            <Text accessibilityRole="alert" style={{ color: colors.textSecondary, paddingHorizontal: 20, paddingTop: 12 }}>
              Archived course: content remains available for review, but learner attempts are read-only.
            </Text>
          )}
          <StudentFeed
            courseId={course.id}
            viewMode={effectiveViewMode}
            presentationMode={course.presentationMode}
            previewMode={effectiveRole !== 'student' || isPastCourse}
          />
        </View>
      )}

      {/* Edit Layout Modal */}
      <Modal visible={layoutModalVisible} transparent animationType="fade" onRequestClose={() => {
        if (isSavingLayout) return;
        setLayoutModalVisible(false);
        setLayoutError(null);
      }}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={{ color: colors.text, fontSize: 20, fontWeight: 'bold', marginBottom: 15 }}>Course Layout Mode</Text>
            <Text style={{ color: colors.textSecondary, marginBottom: 20 }}>
              Determine how the Student Feed displays your course content.
            </Text>
            {!!layoutError && <Text accessibilityRole="alert" style={{ color: colors.error, marginBottom: 12 }}>{layoutError}</Text>}

            <View accessibilityRole="radiogroup" accessibilityLabel="Course presentation mode">
              {([ 
                { id: 'timeline', label: 'Past / Current / Future (Timeline)', desc: 'Presents items dynamically based on their presentation slot.' },
                { id: 'sequential', label: 'Simple Sequential', desc: 'Presents items strictly in order of grouping/upload date.' },
                { id: 'custom', label: 'Custom Format', desc: 'Presents hosted learning workspaces, sandboxed HTML/CSS panels, or a full-viewport approved HTTPS course site.' }
              ] satisfies { id: PresentationMode; label: string; desc: string }[]).map(mode => (
                <TouchableOpacity 
                  key={mode.id}
                  style={{ padding: 15, borderWidth: 1, borderColor: course.presentationMode === mode.id ? colors.primary : colors.border, borderRadius: 12, marginBottom: 10, backgroundColor: course.presentationMode === mode.id ? colors.primary + '10' : 'transparent' }}
                  disabled={isSavingLayout}
                  onPress={async () => {
                    setIsSavingLayout(true);
                    setLayoutError(null);
                    try {
                      await useLMSStore.getState().updateCourse(course.id, { presentationMode: mode.id });
                      setLayoutModalVisible(false);
                    } catch (error) {
                      setLayoutError(error instanceof Error ? error.message : 'The course layout could not be saved.');
                    } finally {
                      setIsSavingLayout(false);
                    }
                  }}
                  accessibilityRole="radio"
                  accessibilityLabel={mode.label}
                  accessibilityState={{ checked: course.presentationMode === mode.id, disabled: isSavingLayout, busy: isSavingLayout }}
                  accessibilityHint={mode.desc}
                >
                  <Text style={{ color: course.presentationMode === mode.id ? colors.primary : colors.text, fontWeight: 'bold' }}>{mode.label}</Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 5 }}>{mode.desc}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity 
              style={{ padding: 15, alignItems: 'center', marginTop: 10 }} 
              disabled={isSavingLayout}
              onPress={() => { setLayoutModalVisible(false); setLayoutError(null); }}
              accessibilityRole="button"
              accessibilityLabel="Cancel Layout Edit"
              accessibilityState={{ disabled: isSavingLayout }}
            >
              <Text style={{ color: colors.textSecondary }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  modeTab: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, paddingVertical: 8, borderRadius: 16 },
  presentationHeader: { minHeight: 62, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center' },
  presentationHeaderAction: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  presentationTitle: { fontSize: 16, fontWeight: '800' },
  presentationMeta: { fontSize: 11, marginTop: 2, textTransform: 'capitalize' },
  header: { padding: 20, paddingTop: 30, paddingBottom: 30 },
  backBtn: { marginBottom: 15 },
  title: { fontSize: 28, fontWeight: 'bold' },
  subtitle: { fontSize: 16, marginTop: 5 },
  meta: { fontSize: 12, marginTop: 10 },
  toggleContainer: { flexDirection: 'row', borderRadius: 20, borderWidth: 1, overflow: 'hidden' },
  toggleBtn: { paddingHorizontal: 15, paddingVertical: 8 },
  content: { flex: 1, padding: 20 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent: { width: '100%', maxWidth: 500, padding: 25, borderRadius: 16, borderWidth: 1 },
});
