/**
 * @fileoverview src/components/lms/StudentFeed.tsx.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import React, { useMemo, useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Pressable, Linking, Platform, useWindowDimensions, Modal } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEvent } from 'expo';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useThemeColors } from '../../lib/useThemeColors';
import { canonicalSafeHttpsUrl } from '../../lib/safeUrl';
import { userAlert as Alert } from '../../lib/userAlert';
import { useLMSStore } from '../../lib/store/useLMSStore';
import { ContentItem, CourseVideoAlternatives } from '../../types/lms';
import { AssessmentPlayer } from './AssessmentPlayer';
import { PopQuizParticipant } from './PopQuizParticipant';
import { CourseFlashcardPlayer } from './CourseFlashcardPlayer';
import { isGradeReleasedToStudent } from '../../lib/assessment/engine';
import { getGroupForUser, getGroupsForItem } from '../../lib/groups/courseGroups';
import { isContentLockedAt } from '../../lib/contentAvailability';
import { StaticWidgetFrame } from './StaticWidgetFrame';
import { useSettingsStore } from '../../lib/store/useSettingsStore';
import { ExternalSiteFrame } from './ExternalSiteFrame';
import { CoursePresentationAsset, getCourseSitePresentationMode, getCourseVideoAlternatives, getCourseVideoAsset, getSingleEmbeddedSitePresentationItem, isCourseHlsAsset } from '../../lib/coursePresentation';
import { buildCoursePresentationBuckets, CourseContentBucket } from '../../lib/coursePresentationBuckets';
import { parseCustomLearningWorkspace } from '../../lib/customLearningWorkspace';
import { CustomLearningWorkspace } from './CustomLearningWorkspace';
import { getLearningStateService } from '../../lib/learningState';

interface StudentFeedProps {
  courseId: string;
  viewMode: 'vertical' | 'horizontal';
  presentationMode: 'timeline' | 'sequential' | 'custom';
  /** Staff-only visual preview. Never creates attempts, submissions, group answers, or live-session answers. */
  previewMode?: boolean;
}

interface CustomPayload {
  isCustomWidget?: boolean;
  layout?: string;
  subtitle?: string;
  html?: string;
  css?: string;
  items?: { label?: string; url?: string }[];
}

const parseCustomPayload = (description?: string): CustomPayload | null => {
  if (!description?.trim().startsWith('{')) return null;
  try {
    const value: unknown = JSON.parse(description);
    return value && typeof value === 'object' && !Array.isArray(value) ? value as CustomPayload : null;
  } catch {
    return null;
  }
};

const safeHttpsUrl = (value?: string): string | null => canonicalSafeHttpsUrl(value);

const openExternalUrl = async (value?: string) => {
  const url = safeHttpsUrl(value);
  if (!url) {
    Alert.alert('Link unavailable', 'Only valid HTTPS links can be opened.');
    return;
  }
  try {
    await Linking.openURL(url);
  } catch (error) {
    Alert.alert('Link could not be opened', error instanceof Error ? error.message : 'Try again or contact course staff.');
  }
};

const currentTimestamp = () => Date.now();

type WebActivationEvent = {
  key?: string;
  nativeEvent?: { key?: string };
  preventDefault?: () => void;
};

const activateFromKeyboard = (event: WebActivationEvent, action: () => void) => {
  const key = event.key ?? event.nativeEvent?.key;
  if (key !== 'Enter' && key !== ' ') return;
  event.preventDefault?.();
  action();
};

const NativeCourseVideoSurface = ({ asset, title }: { asset: CoursePresentationAsset; title: string }) => {
  const colors = useThemeColors();
  const player = useVideoPlayer({ uri: asset.url, contentType: isCourseHlsAsset(asset) ? 'hls' : 'auto' }, instance => {
    instance.loop = false;
    instance.pause();
  });
  const statusEvent = useEvent(player, 'statusChange', { status: player.status });
  const playbackError = statusEvent.status === 'error'
    ? 'This video could not be played in the course page.'
    : null;
  return (
    <>
      <VideoView
        player={player}
        nativeControls
        contentFit="contain"
        fullscreenOptions={{ enable: true }}
        buttonOptions={{ showSubtitles: undefined }}
        playsInline
        style={styles.video}
        accessible
        accessibilityLabel={`Course video: ${title}`}
      />
      {!!playbackError && (
        <View style={[styles.videoError, { backgroundColor: colors.card }]}> 
          <Text accessibilityRole="alert" style={{ color: colors.error, flex: 1 }}>{playbackError}</Text>
          <TouchableOpacity accessibilityRole="link" onPress={() => void openExternalUrl(asset.url)}>
            <Text style={{ color: colors.primary, fontWeight: '700' }}>Open video</Text>
          </TouchableOpacity>
        </View>
      )}
    </>
  );
};

const CourseVideoPlayer = ({
  asset,
  title,
  alternatives,
  previewMode,
}: {
  asset: CoursePresentationAsset;
  title: string;
  alternatives: CourseVideoAlternatives | null;
  previewMode: boolean;
}) => {
  const colors = useThemeColors();
  const captionTracks = alternatives?.captionTracks || [];
  const transcript = alternatives?.transcript;
  const webVideo = Platform.OS === 'web'
    ? React.createElement('video', {
        controls: true,
        preload: 'metadata',
        playsInline: true,
        crossOrigin: 'anonymous',
        'aria-label': `Course video: ${title}`,
        style: { width: '100%', aspectRatio: 16 / 9, minHeight: 220, backgroundColor: '#000' },
      }, [
        React.createElement('source', { key: 'source', src: asset.url, type: asset.mimeType }),
        ...captionTracks.map((track, index) => React.createElement('track', {
          key: `${track.url}-${index}`,
          kind: 'captions',
          src: track.url,
          srcLang: track.language,
          label: track.label,
          default: track.isDefault === true,
        })),
      ])
    : null;

  return (
    <View style={[styles.videoShell, { borderColor: colors.border, backgroundColor: '#000' }]}> 
      {webVideo || <NativeCourseVideoSurface asset={asset} title={title} />}
      {(captionTracks.length > 0 || transcript || previewMode) && (
        <View
          style={[styles.videoAlternatives, { backgroundColor: colors.card, borderTopColor: colors.border }]}
          accessibilityLabel={`Accessible media alternatives for ${title}`}
        >
          <Text accessibilityRole="header" style={[styles.videoAlternativesTitle, { color: colors.text }]}>Captions and transcript</Text>
          {captionTracks.map((track, index) => (
            <TouchableOpacity
              key={`${track.url}-${index}`}
              accessibilityRole="link"
              accessibilityLabel={`Open ${track.label}, ${track.language}, WebVTT caption file`}
              accessibilityHint="Opens the teacher-supplied caption file in your device browser."
              onPress={() => void openExternalUrl(track.url)}
              style={styles.videoAlternativeLink}
            >
              <Ionicons name="text-outline" size={18} color={colors.primary} />
              <Text style={{ color: colors.primary, fontWeight: '700', flex: 1 }}>{track.label} ({track.language}) · WebVTT</Text>
            </TouchableOpacity>
          ))}
          {Platform.OS !== 'web' && captionTracks.length > 0 && (
            <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 4 }}>
              External WebVTT files open separately on this device. When captions are embedded in the video or HLS stream, use the player’s Subtitles control for synchronized playback.
            </Text>
          )}
          {!!transcript && (
            <View style={{ marginTop: captionTracks.length ? 12 : 0 }}>
              <Text accessibilityRole="header" style={{ color: colors.text, fontWeight: '700' }}>{transcript.label || 'Transcript'}</Text>
              {!!transcript.text && (
                <Text selectable style={[styles.videoTranscriptText, { color: colors.text }]}>{transcript.text}</Text>
              )}
              {!!transcript.url && (
                <TouchableOpacity
                  accessibilityRole="link"
                  accessibilityLabel={`Open ${transcript.label || 'video transcript'}`}
                  accessibilityHint="Opens the teacher-supplied transcript in your device browser."
                  onPress={() => void openExternalUrl(transcript.url)}
                  style={styles.videoAlternativeLink}
                >
                  <Ionicons name="open-outline" size={18} color={colors.primary} />
                  <Text style={{ color: colors.primary, fontWeight: '700' }}>Open transcript</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
          {previewMode && (!captionTracks.length || !transcript) && (
            <Text accessibilityRole="alert" style={{ color: colors.error, marginTop: 10 }}>
              Staff preview: {!captionTracks.length && !transcript ? 'captions and a transcript are missing' : !captionTracks.length ? 'captions are missing' : 'a transcript is missing'}. Complete and human-review the media alternatives before release.
            </Text>
          )}
        </View>
      )}
    </View>
  );
};

export const StudentFeed = ({ courseId, viewMode, presentationMode, previewMode = false }: StudentFeedProps) => {
  const baseColors = useThemeColors();
  const isDarkIDE = presentationMode === 'custom';
  const colors = isDarkIDE ? {
    background: '#1e1e1e',
    card: '#252526',
    border: '#333333',
    text: '#d4d4d4',
    textSecondary: '#b3b3b3',
    primary: '#569cd6',
    buttonText: '#000000',
    error: '#f44336'
  } : baseColors;

  const [containerWidth, setContainerWidth] = useState(0);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const appContentWidth = useSettingsStore(state => state.appContentWidth);
  const reducedMotion = useSettingsStore(state => state.reducedMotion);
  // React Native Web does not reliably dispatch onLayout for a flex child
  // whose horizontal ScrollView is initially absent. Use the persisted app
  // canvas width immediately, then prefer a measured width when available.
  const horizontalPageWidth = containerWidth || Math.min(windowWidth, appContentWidth);
  const responsiveContentWidth = containerWidth || Math.min(windowWidth, appContentWidth);
  const contentItems = useLMSStore(state => state.contentItems);
  const pagerInstanceId = React.useId().replace(/:/g, '');
  const horizontalScrollId = useMemo(
    () => `lms-course-pager-${encodeURIComponent(courseId)}-${pagerInstanceId}`,
    [courseId, pagerInstanceId],
  );
  const [now, setNow] = useState(currentTimestamp);
  const scrollViewRef = useRef<ScrollView>(null);
  const verticalScrollViewRef = useRef<ScrollView>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const currentPageRef = useRef(0);
  const [activeAssessment, setActiveAssessment] = useState<ContentItem | null>(null);
  const [activeStudySet, setActiveStudySet] = useState<ContentItem | null>(null);
  const [activeWorkspaceItem, setActiveWorkspaceItem] = useState<ContentItem | null>(null);
  // undefined means the learner has not chosen a layout yet, so the first
  // widget starts expanded. null is an intentional "all minimized" choice.
  const [maximizedWidgetId, setMaximizedWidgetId] = useState<string | null | undefined>(undefined);
  const [coursePageStateReady, setCoursePageStateReady] = useState(false);
  const [coursePageStateError, setCoursePageStateError] = useState<string | null>(null);
  const [verticalSaveRevision, setVerticalSaveRevision] = useState(0);
  const verticalOffsets = useRef<{ [key: string]: number }>({});
  const verticalOffsetRef = useRef(0);
  const pendingVerticalOffsetRef = useRef<number | null>(null);
  const hasScrolledVertical = useRef(false);

  /* Course changes intentionally clear the previous course's page state before hydration. */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    currentPageRef.current = currentPage;
  }, [currentPage]);

  const scrollToHorizontalPage = React.useCallback((page: number, animated: boolean) => {
    const left = page * horizontalPageWidth;
    const shouldAnimate = animated && !reducedMotion;
    scrollViewRef.current?.scrollTo({ x: left, animated: shouldAnimate });
    if (Platform.OS !== 'web') return;

    // RN Web's paging ScrollView can update React state while ignoring a
    // programmatic `scrollTo({ x })` after mount. Apply the same move to its
    // actual scroll node so arrows and dots never drift out of sync.
    const applyScroll = () => {
      const scrollNode = typeof document === 'undefined' ? null : document.getElementById(horizontalScrollId);
      if (!scrollNode) return;
      if (typeof scrollNode.scroll === 'function') {
        scrollNode.scroll({ left, top: 0, behavior: shouldAnimate ? 'smooth' : 'auto' });
      } else {
        scrollNode.scrollLeft = left;
      }
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(applyScroll);
    else applyScroll();
  }, [horizontalPageWidth, horizontalScrollId, reducedMotion]);

  const { courses, currentUserId, submissions } = useLMSStore();
  const course = courses.find(c => c.id === courseId);
  const [groupJoinItem, setGroupJoinItem] = useState<ContentItem | null>(null);
  const availableGroupNames = groupJoinItem ? getGroupsForItem(course, groupJoinItem).map(group => group.name) : [];

  const staticWidgetIds = useMemo(() => contentItems
    .filter(item => {
      const payload = parseCustomPayload(item.description);
      return item.courseId === courseId
        && !item.deletedAt
        && payload?.isCustomWidget
        && !parseCustomLearningWorkspace(item.description)
        && Boolean(payload.html?.trim() || payload.css?.trim());
    })
    .sort((left, right) => (left.orderIndex ?? left.createdAt) - (right.orderIndex ?? right.createdAt) || left.id.localeCompare(right.id))
    .map(item => item.id), [contentItems, courseId]);
  const effectiveMaximizedWidgetId = maximizedWidgetId === undefined
    ? staticWidgetIds[0] ?? null
    : maximizedWidgetId === null ? null
      : staticWidgetIds.includes(maximizedWidgetId) ? maximizedWidgetId : staticWidgetIds[0] ?? null;

  useEffect(() => {
    const timer = setInterval(() => setNow(currentTimestamp()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // Both vertical sections and the horizontal pager consume this exact page
  // model, so every teacher presentation mode has the same learner content.
  const buckets = useMemo(() => buildCoursePresentationBuckets(
    contentItems.filter(item => item.courseId === courseId),
    presentationMode,
    now,
  ), [contentItems, courseId, presentationMode, now]);
  const bucketIds = useMemo(() => buckets.map(bucket => bucket.id).join('\u0000'), [buckets]);
  const currentBucketId = buckets[currentPage]?.id;
  const singleEmbeddedSiteItem = useMemo(() => presentationMode === 'custom'
    ? getSingleEmbeddedSitePresentationItem(contentItems.filter(item => item.courseId === courseId))
    : null, [contentItems, courseId, presentationMode]);
  const activeWorkspace = useMemo(
    () => parseCustomLearningWorkspace(activeWorkspaceItem?.description),
    [activeWorkspaceItem],
  );

  useEffect(() => {
    const availableBucketIds = bucketIds ? bucketIds.split('\u0000') : [];
    hasScrolledVertical.current = false;
    verticalOffsetRef.current = 0;
    pendingVerticalOffsetRef.current = null;
    setActiveWorkspaceItem(null);
    setMaximizedWidgetId(undefined);
    setCoursePageStateError(null);
    setCoursePageStateReady(false);

    const fallbackPage = Math.max(0, Math.min(availableBucketIds.length - 1, presentationMode === 'timeline' ? 1 : 0));
    currentPageRef.current = fallbackPage;
    setCurrentPage(fallbackPage);
    if (previewMode || !currentUserId || !availableBucketIds.length) {
      setCoursePageStateReady(true);
      return;
    }

    let cancelled = false;
    void getLearningStateService().load(
      { principalId: currentUserId, courseId },
      'course-page',
    ).then(record => {
      if (cancelled) return;
      if (record) {
        const restoredPage = record.payload.pageId
          ? availableBucketIds.indexOf(record.payload.pageId)
          : -1;
        const nextPage = restoredPage >= 0 ? restoredPage : fallbackPage;
        currentPageRef.current = nextPage;
        setCurrentPage(nextPage);
        setMaximizedWidgetId(record.payload.maximizedWidgetId);
        if (record.payload.verticalOffset !== undefined) {
          verticalOffsetRef.current = record.payload.verticalOffset;
          pendingVerticalOffsetRef.current = record.payload.verticalOffset;
          hasScrolledVertical.current = true;
        }
      }
      setCoursePageStateReady(true);
    }).catch(error => {
      if (cancelled) return;
      setCoursePageStateError(error instanceof Error ? error.message : 'Saved course position could not be restored.');
      setCoursePageStateReady(true);
    });
    return () => { cancelled = true; };
  }, [bucketIds, courseId, currentUserId, presentationMode, previewMode]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!buckets.length) return;
    const targetPage = Math.max(0, Math.min(currentPageRef.current, buckets.length - 1));
    if (targetPage !== currentPageRef.current) {
      currentPageRef.current = targetPage;
      setCurrentPage(targetPage);
    }
    if (viewMode === 'horizontal' && horizontalPageWidth > 0) {
      scrollToHorizontalPage(targetPage, false);
    }
  }, [buckets.length, horizontalPageWidth, scrollToHorizontalPage, viewMode]);

  useEffect(() => {
    if (!coursePageStateReady || previewMode || !currentUserId || !currentBucketId) return;
    const timer = setTimeout(() => {
      void getLearningStateService().save(
        { principalId: currentUserId, courseId },
        'course-page',
        {
          pageId: currentBucketId,
          verticalOffset: viewMode === 'vertical' ? verticalOffsetRef.current : undefined,
          maximizedWidgetId: effectiveMaximizedWidgetId,
        },
      ).then(() => setCoursePageStateError(null)).catch(error => {
        setCoursePageStateError(error instanceof Error ? error.message : 'Course position could not be saved.');
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [courseId, coursePageStateReady, currentBucketId, currentUserId, effectiveMaximizedWidgetId, previewMode, verticalSaveRevision, viewMode]);

  useEffect(() => {
    if (!coursePageStateReady || viewMode !== 'vertical' || pendingVerticalOffsetRef.current === null) return;
    const offset = pendingVerticalOffsetRef.current;
    pendingVerticalOffsetRef.current = null;
    const timer = setTimeout(() => verticalScrollViewRef.current?.scrollTo({ y: offset, animated: false }), 0);
    return () => clearTimeout(timer);
  }, [coursePageStateReady, viewMode]);

  const isItemLocked = (item: ContentItem) => {
    return isContentLockedAt(item, now);
  };

  const renderCard = (item: ContentItem) => {
    const locked = isItemLocked(item);
    const customPayload = parseCustomPayload(item.description);
    const learningWorkspace = parseCustomLearningWorkspace(item.description);
    const videoAsset = getCourseVideoAsset(item);
    const videoAlternatives = getCourseVideoAlternatives(item);

    if (locked) {
      return (
        <View key={item.id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }, presentationMode === 'sequential' && styles.saasCard]}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={[styles.iconBox, { backgroundColor: colors.border }]}><Ionicons name="lock-closed" size={22} color={colors.textSecondary} /></View>
            <View style={{ flex: 1, marginLeft: 15 }}>
              <Text style={{ color: colors.text, fontSize: 18, fontWeight: 'bold' }}>{item.title}</Text>
              <Text style={{ color: colors.textSecondary, marginTop: 5 }}>This item is not available yet. Its contents remain hidden until the institution release time.</Text>
            </View>
          </View>
        </View>
      );
    }

    if (learningWorkspace && isDarkIDE) {
      const completedMilestones = learningWorkspace.milestones.filter(milestone => milestone.status === 'complete').length;
      return (
        <View key={item.id} style={styles.workspaceLaunchCard}>
          <View style={[styles.workspaceGlow, { pointerEvents: 'none' }]} />
          <View style={styles.workspaceLaunchHeader}>
            <View style={styles.workspaceModuleBadge}>
              <Ionicons name="sparkles" size={14} color="#07111F" />
              <Text style={styles.workspaceModuleBadgeText}>{learningWorkspace.eyebrow}</Text>
            </View>
            <View style={styles.workspaceSecurityBadge}>
              <Ionicons name="shield-checkmark" size={15} color="#5BE7B4" />
              <Text style={styles.workspaceSecurityBadgeText}>Hosted safely</Text>
            </View>
          </View>
          <Text accessibilityRole="header" style={styles.workspaceLaunchTitle}>{learningWorkspace.title}</Text>
          <Text style={styles.workspaceLaunchSummary}>{learningWorkspace.summary}</Text>

          <View style={styles.workspaceCapabilityRow}>
            {[
              ['code-slash-outline', 'Code problem'],
              ['bar-chart-outline', 'Generated visual'],
              ['analytics-outline', 'Live progress'],
            ].map(([icon, label]) => (
              <View key={label} style={styles.workspaceCapability}>
                <Ionicons name={icon as React.ComponentProps<typeof Ionicons>['name']} size={16} color="#62D9FF" />
                <Text style={styles.workspaceCapabilityText}>{label}</Text>
              </View>
            ))}
          </View>

          <View style={styles.workspaceCodePreview}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <Text style={styles.workspaceCodeLabel}>{learningWorkspace.challenge.title}</Text>
              <Text style={styles.workspaceLanguage}>{learningWorkspace.language}</Text>
            </View>
            <Text selectable numberOfLines={6} style={styles.workspaceCodeText}>{learningWorkspace.challenge.starterCode}</Text>
          </View>

          <View style={styles.workspaceLaunchFooter}>
            <View style={{ flex: 1, minWidth: 180, marginRight: 14 }}>
              <Text style={styles.workspaceProgressLabel}>{completedMilestones} of {learningWorkspace.milestones.length} milestones complete</Text>
              <View style={styles.workspaceProgressTrack}>
                <View style={[styles.workspaceProgressFill, { width: `${Math.round((completedMilestones / learningWorkspace.milestones.length) * 100)}%` }]} />
              </View>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={`Open learning workspace ${learningWorkspace.title}`}
              accessibilityHint="Opens an in-app dashboard with a code lab and accessible visualization."
              onPress={() => setActiveWorkspaceItem(item)}
              style={styles.workspaceLaunchButton}
            >
              <Text style={styles.workspaceLaunchButtonText}>Open workspace</Text>
              <Ionicons name="arrow-forward" size={17} color="#07111F" />
            </TouchableOpacity>
          </View>
          <Text style={styles.workspaceSafetyNote}>Learner code is checked as text only—never executed, uploaded, or placed in the HTML sandbox.</Text>
        </View>
      );
    }

    if (customPayload?.isCustomWidget && isDarkIDE) {
      const isMaximized = effectiveMaximizedWidgetId === item.id;
      return (
        <View key={item.id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, padding: 0, overflow: 'hidden' }]}> 
          <View style={{ padding: 15, borderBottomWidth: isMaximized ? 1 : 0, borderColor: colors.border, backgroundColor: colors.background, flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={{ color: colors.text, fontWeight: 'bold', fontFamily: 'monospace' }}>{item.title}</Text>
              <Text style={{ color: colors.textSecondary, fontSize: 11, marginTop: 4 }}>Static sandbox preview · scripts, forms, network requests, and popups are disabled</Text>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={`${isMaximized ? 'Minimize' : 'Maximize'} widget ${item.title}`}
              accessibilityState={{ expanded: isMaximized }}
              onPress={() => setMaximizedWidgetId(isMaximized ? null : item.id)}
              style={[styles.widgetControl, { borderColor: colors.border }]}
            >
              <Ionicons name={isMaximized ? 'contract-outline' : 'expand-outline'} size={19} color={colors.primary} />
            </TouchableOpacity>
          </View>
          {isMaximized && <StaticWidgetFrame html={customPayload.html || ''} css={customPayload.css || ''} title={item.title} />}
        </View>
      );
    }

    if (isDarkIDE && item.contentUrl && safeHttpsUrl(item.contentUrl) && getCourseSitePresentationMode(item) === 'embedded') {
      return (
        <View key={item.id} style={styles.embeddedCourseSite}>
          <ExternalSiteFrame
            url={item.contentUrl}
            title={item.title}
            demoPortalId={item.metadata?.lmsDemoPortal === 'programming-course-v1' ? 'programming-course-v1' : undefined}
            principalId={currentUserId || undefined}
            courseId={courseId}
            contentItemId={item.id}
            previewMode={previewMode}
            minimumHeight={Math.max(560, windowHeight - 150)}
          />
        </View>
      );
    }

    if (customPayload?.layout === 'accordion') {
      return (
        <View key={item.id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }, presentationMode === 'sequential' && styles.saasCard]}>
          <Text style={{ color: colors.text, fontWeight: 'bold', fontSize: 18 }}>{item.title}</Text>
          <Text style={{ color: colors.textSecondary, marginTop: 5 }}>{customPayload.subtitle || 'Resources'}</Text>
          <View style={{ marginTop: 15, paddingTop: 15, borderTopWidth: 1, borderColor: colors.border }}>
            {(customPayload.items || []).map((child, index) => {
              const url = safeHttpsUrl(child.url);
              return (
                <TouchableOpacity key={`${child.label || 'resource'}-${index}`} disabled={!url} onPress={() => void openExternalUrl(url || undefined)} style={{ paddingVertical: 10, flexDirection: 'row', alignItems: 'center', opacity: url ? 1 : 0.55 }} accessibilityRole="link" accessibilityLabel={`Open ${child.label || 'untitled resource'}`} accessibilityState={{ disabled: !url }}>
                  <Ionicons name="link" size={16} color={colors.primary} style={{ marginRight: 10 }} />
                  <Text style={{ color: colors.primary }}>{child.label || 'Untitled resource'}{!url ? ' (invalid link)' : ''}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      );
    }

    if (item.studyCards?.length) {
      return (
        <View key={item.id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }, presentationMode === 'sequential' && styles.saasCard]}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
            <View style={[styles.iconBox, { backgroundColor: `${colors.primary}20` }]}><Ionicons name="albums" size={24} color={colors.primary} /></View>
            <View style={{ flex: 1, marginLeft: 15 }}>
              <Text style={{ color: colors.text, fontSize: 18, fontWeight: 'bold' }}>{item.title}</Text>
              {!!item.description && <Text style={{ color: colors.textSecondary, marginTop: 5 }}>{item.description}</Text>}
              <Text style={{ color: colors.textSecondary, marginTop: 8 }}>{item.studyCards.length} learner-visible flashcard{item.studyCards.length === 1 ? '' : 's'}</Text>
            </View>
          </View>
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: colors.primary }]} onPress={() => setActiveStudySet(item)} accessibilityRole="button" accessibilityLabel={`Study flashcards: ${item.title}`}>
            <Text style={{ color: colors.buttonText, fontWeight: 'bold' }}>Study Flashcards</Text>
          </TouchableOpacity>
        </View>
      );
    }

    // Assessment Block
    if (item.category === 'coursework' && item.questions) {
      return (
        <View key={item.id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }, presentationMode === 'sequential' && styles.saasCard]}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
            <View style={[styles.iconBox, { backgroundColor: colors.primary + '20' }]}>
              <Ionicons name="create" size={24} color={colors.primary} />
            </View>
            <View style={{ flex: 1, marginLeft: 15 }}>
              <Text style={{ color: colors.text, fontSize: 18, fontWeight: 'bold', fontFamily: isDarkIDE ? 'monospace' : undefined }}>{item.title}</Text>
              {!!item.description && <Text style={{ color: colors.textSecondary, marginTop: 5, fontFamily: isDarkIDE ? 'monospace' : undefined }}>{item.description}</Text>}
              {!!item.displayDate && <Text style={{ color: colors.primary, marginTop: 5, fontWeight: 'bold', fontSize: 12, fontFamily: isDarkIDE ? 'monospace' : undefined }}>{item.displayDate}</Text>}
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}>
                <Ionicons name="list" size={14} color={colors.textSecondary} />
                <Text style={{ color: colors.textSecondary, fontSize: 12, marginLeft: 5, fontFamily: isDarkIDE ? 'monospace' : undefined }}>{item.questions.length} Questions</Text>
              </View>
            </View>
          </View>
          {(() => {
            const currentGroupId = getGroupForUser(course, item, currentUserId)?.id;
            const relevantSubmissions = submissions
              .filter(submission => submission.contentItemId === item.id && submission.status !== 'discarded')
              .filter(submission => item.workType === 'group' && currentGroupId
                ? submission.groupId === currentGroupId
                : submission.studentId === currentUserId)
              .sort((left, right) => right.submittedAt - left.submittedAt);
            const existingSub = relevantSubmissions.find(submission => submission.status === 'draft') || relevantSubmissions[0];
            const gradeReleased = isGradeReleasedToStudent(existingSub);
            const btnText = previewMode
              ? 'Preview Assessment'
              : gradeReleased
              ? 'View Results'
              : existingSub?.status === 'submitted'
                ? 'View Submission'
                : existingSub?.status === 'draft'
                  ? 'Resume Assessment'
                  : 'Start Assessment';

            return !locked ? (
              item.submissionTarget === 'external-link' ? (
                <View style={[styles.actionBtn, { backgroundColor: colors.border, flexDirection: 'row', justifyContent: 'center' }]}>
                  <Ionicons name="checkmark-circle" size={16} color={colors.textSecondary} style={{ marginRight: 5 }} />
                  <Text style={{ color: colors.textSecondary, fontWeight: 'bold' }}>Graded Externally</Text>
                </View>
              ) : !previewMode && item.workType === 'group' && !currentGroupId ? (
                <TouchableOpacity 
                  style={[styles.actionBtn, { backgroundColor: colors.primary }]} 
                  onPress={() => setGroupJoinItem(item)}
                  accessibilityRole="button"
                  accessibilityLabel={`Join Group for ${item.title}`}
                >
                  <Text style={{ color: colors.buttonText, fontWeight: 'bold' }}>Join Group to Start</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity 
                  style={[styles.actionBtn, { backgroundColor: gradeReleased ? '#4CAF50' : colors.primary }]}
                  onPress={() => setActiveAssessment(item)}
                  accessibilityRole="button"
                  accessibilityLabel={`${btnText}: ${item.title}`}
                  accessibilityHint={`Opens the ${item.title} quiz player.`}
                >
                  <Text style={{ color: gradeReleased ? '#000000' : colors.buttonText, fontWeight: 'bold' }}>{btnText}</Text>
                </TouchableOpacity>
              )
            ) : (
              <View style={[styles.actionBtn, { backgroundColor: colors.border, flexDirection: 'row', justifyContent: 'center' }]}>
                <Ionicons name="lock-closed" size={16} color={colors.textSecondary} style={{ marginRight: 5 }} />
                <Text style={{ color: colors.textSecondary, fontWeight: 'bold' }}>Locked</Text>
              </View>
            );
          })()}
        </View>
      );
    }

    // Standard Content Block
    return (
      <View key={item.id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }, presentationMode === 'sequential' && styles.saasCard]}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
          <View style={[styles.iconBox, { backgroundColor: colors.border }]}>
            <Ionicons name={item.category === 'admin' ? "megaphone" : "document-text"} size={24} color={colors.text} />
          </View>
          <View style={{ flex: 1, marginLeft: 15 }}>
            <Text style={{ color: colors.text, fontSize: 18, fontWeight: 'bold', fontFamily: isDarkIDE ? 'monospace' : undefined }}>{item.title}</Text>
            {!!item.description && (
              customPayload?.html ? (
                <View style={{ marginTop: 10 }}><StaticWidgetFrame html={customPayload.html || ''} css={customPayload.css || ''} title={`${item.title} content`} minimumHeight={180} /></View>
              ) : (
                <Text style={{ color: colors.textSecondary, marginTop: 5, fontFamily: isDarkIDE ? 'monospace' : undefined }}>{item.description}</Text>
              )
            )}
            {!!item.displayDate && <Text style={{ color: colors.primary, marginTop: 5, fontWeight: 'bold', fontSize: 12, fontFamily: isDarkIDE ? 'monospace' : undefined }}>{item.displayDate}</Text>}
          </View>
        </View>
        {!!videoAsset && <CourseVideoPlayer asset={videoAsset} title={item.title} alternatives={videoAlternatives} previewMode={previewMode} />}
        {!!item.contentUrl && (
          videoAsset ? null : !locked && safeHttpsUrl(item.contentUrl) ? (
            <TouchableOpacity 
              style={[styles.actionBtn, { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.primary }]} 
              onPress={() => void openExternalUrl(item.contentUrl)}
              accessibilityRole="link"
              accessibilityLabel={`Open Link: ${item.title}`}
              accessibilityHint="Opens the content link in your device's browser."
            >
              <Text style={{ color: colors.primary, fontWeight: 'bold' }}>Open Link</Text>
            </TouchableOpacity>
          ) : locked ? (
            <View style={[styles.actionBtn, { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', justifyContent: 'center' }]}> 
              <Ionicons name="lock-closed" size={16} color={colors.textSecondary} style={{ marginRight: 5 }} />
              <Text style={{ color: colors.textSecondary, fontWeight: 'bold' }}>Locked</Text>
            </View>
          ) : (
            <View style={[styles.actionBtn, { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.error }]}> 
              <Text style={{ color: colors.error, fontWeight: 'bold' }}>Unsafe or invalid link blocked</Text>
            </View>
          )
        )}
      </View>
    );
  };

  const renderBucketContent = (bucket: CourseContentBucket) => {
    return (
      <View style={styles.bucketContainer}>
        {presentationMode !== 'custom' && (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 15 }}>
            <Text style={{ color: colors.text, fontSize: 22, fontWeight: 'bold' }} accessibilityRole="header">{bucket.label}</Text>
            <View style={[styles.badge, { backgroundColor: colors.primary + '20' }]}>
              <Text style={{ color: colors.primary, fontWeight: 'bold', fontSize: 12 }}>{bucket.items.length}</Text>
            </View>
          </View>
        )}
        
        {bucket.items.length === 0 ? (
          <View style={[styles.emptyState, { borderColor: colors.border, backgroundColor: colors.card }]}>
            <Ionicons name="folder-open-outline" size={32} color={colors.textSecondary} />
            <Text style={{ color: colors.textSecondary, marginTop: 10, fontFamily: isDarkIDE ? 'monospace' : undefined }}>No items available.</Text>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: presentationMode === 'custom' ? 0 : -10 }}>
            {bucket.items.map(item => (
              <View key={item.id} style={presentationMode === 'sequential' && viewMode === 'vertical'
                ? { width: responsiveContentWidth > 800 ? '50%' : '100%', padding: 10 }
                : { width: '100%', padding: presentationMode === 'custom' ? 0 : 10 }}>
                {renderCard(item)}
              </View>
            ))}
          </View>
        )}
      </View>
    );
  };

  const renderBucket = (bucket: CourseContentBucket, bucketIndex: number) => {
    if (viewMode === 'horizontal') {
      const isActive = currentPage === bucketIndex;
      return (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          key={bucket.id}
          nativeID={`${horizontalScrollId}-panel-${bucketIndex}`}
          {...(Platform.OS === 'web'
            ? ({ 'aria-hidden': !isActive } as object)
            : { accessibilityElementsHidden: !isActive, importantForAccessibility: isActive ? 'auto' as const : 'no-hide-descendants' as const })}
          accessibilityLabel={`${bucket.label}, page ${bucketIndex + 1} of ${buckets.length}`}
          style={{ width: horizontalPageWidth, height: '100%', flexGrow: 0, flexShrink: 0 }}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 50 }}
        >
          <View style={{ width: horizontalPageWidth, paddingHorizontal: presentationMode === 'custom' ? 0 : 20 }}>
            {renderBucketContent(bucket)}
          </View>
        </ScrollView>
      );
    }
    return (
      <View key={bucket.id}>
        {renderBucketContent(bucket)}
      </View>
    );
  };

  const renderPagination = () => (
    <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginVertical: 10 }}>
      <Pressable
        disabled={buckets.length <= 1} 
        onPress={() => {
          const next = currentPage === 0 ? buckets.length - 1 : currentPage - 1;
          setCurrentPage(next);
          scrollToHorizontalPage(next, true);
        }}
        {...(Platform.OS === 'web' ? ({
          onKeyDown: (event: WebActivationEvent) => activateFromKeyboard(event, () => {
            const next = currentPage === 0 ? buckets.length - 1 : currentPage - 1;
            setCurrentPage(next);
            scrollToHorizontalPage(next, true);
          }),
        } as object) : {})}
        style={{ padding: 10, opacity: buckets.length <= 1 ? 0.3 : 1 }}
        accessibilityRole="button"
        accessibilityLabel="Previous category"
        accessibilityState={{ disabled: buckets.length <= 1 }}
      >
        <Ionicons name="chevron-back" size={24} color={colors.primary} />
      </Pressable>
      
      <View accessibilityRole="tablist" accessibilityLabel="Course content pages" style={{ flexDirection: 'row', marginHorizontal: 15, alignItems: 'center' }}>
        {buckets.map((b, idx) => (
          <Pressable
            key={b.id} 
            onPress={() => {
              setCurrentPage(idx);
              scrollToHorizontalPage(idx, true);
            }}
            {...(Platform.OS === 'web' ? ({
              'aria-selected': currentPage === idx,
              tabIndex: currentPage === idx ? 0 : -1,
              onKeyDown: (event: WebActivationEvent) => activateFromKeyboard(event, () => {
                setCurrentPage(idx);
                scrollToHorizontalPage(idx, true);
              }),
            } as object) : {})}
            style={styles.pagerTarget}
            accessibilityRole="tab"
            accessibilityLabel={`Go to ${b.label}`}
            accessibilityState={{ selected: currentPage === idx }}
          >
            <View style={[styles.pagerDot, { backgroundColor: currentPage === idx ? colors.primary : colors.border, width: currentPage === idx ? 12 : 8, height: currentPage === idx ? 12 : 8 }]} />
          </Pressable>
        ))}
      </View>

      <Pressable
        disabled={buckets.length <= 1} 
        onPress={() => {
          const next = currentPage === buckets.length - 1 ? 0 : currentPage + 1;
          setCurrentPage(next);
          scrollToHorizontalPage(next, true);
        }}
        {...(Platform.OS === 'web' ? ({
          onKeyDown: (event: WebActivationEvent) => activateFromKeyboard(event, () => {
            const next = currentPage === buckets.length - 1 ? 0 : currentPage + 1;
            setCurrentPage(next);
            scrollToHorizontalPage(next, true);
          }),
        } as object) : {})}
        style={{ padding: 10, opacity: buckets.length <= 1 ? 0.3 : 1 }}
        accessibilityRole="button"
        accessibilityLabel="Next category"
        accessibilityState={{ disabled: buckets.length <= 1 }}
      >
        <Ionicons name="chevron-forward" size={24} color={colors.primary} />
      </Pressable>
    </View>
  );

  const workspaceModal = activeWorkspaceItem && activeWorkspace ? (
    <CustomLearningWorkspace
      moduleTitle={activeWorkspaceItem.title}
      workspace={activeWorkspace}
      onClose={() => setActiveWorkspaceItem(null)}
    />
  ) : null;

  if (presentationMode === 'custom' && !buckets.length) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
        <Text style={{ color: colors.text, fontFamily: 'monospace', textAlign: 'center' }}>No custom course content has been published yet.</Text>
      </View>
    );
  }

  if (singleEmbeddedSiteItem && !isItemLocked(singleEmbeddedSiteItem)) {
    return (
      <View style={[styles.singleSiteCourse, { backgroundColor: colors.background }]}> 
        <ExternalSiteFrame
          url={singleEmbeddedSiteItem.contentUrl || ''}
          title={singleEmbeddedSiteItem.title}
          demoPortalId={singleEmbeddedSiteItem.metadata?.lmsDemoPortal === 'programming-course-v1' ? 'programming-course-v1' : undefined}
          principalId={currentUserId || undefined}
          courseId={courseId}
          contentItemId={singleEmbeddedSiteItem.id}
          previewMode={previewMode}
          fillViewport
        />
      </View>
    );
  }

  if (viewMode === 'horizontal') {
    return (
      <View 
        style={{ flex: 1, width: '100%', minHeight: 0 }}
        onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
      >
        {!!coursePageStateError && (
          <Text accessibilityRole="alert" style={{ color: colors.error, fontSize: 12, paddingHorizontal: 16, paddingTop: 8 }}>
            {coursePageStateError}
          </Text>
        )}
        {horizontalPageWidth > 0 && (
          <ScrollView keyboardShouldPersistTaps="handled" 
            nativeID={horizontalScrollId}
            ref={scrollViewRef}
            style={{ flex: 1, minHeight: 1 }}
            horizontal 
            pagingEnabled 
            contentContainerStyle={{ alignItems: 'stretch' }}
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16}
            onMomentumScrollEnd={(e) => {
              const page = Math.max(0, Math.min(buckets.length - 1, Math.round(e.nativeEvent.contentOffset.x / horizontalPageWidth)));
              setCurrentPage(page);
            }}
            onContentSizeChange={() => scrollToHorizontalPage(currentPage, false)}
          >
            {buckets.map(renderBucket)}
          </ScrollView>
        )}
        {renderPagination()}
        <Text accessibilityLiveRegion="polite" style={styles.screenReaderStatus}>
          {`${buckets[currentPage]?.label || 'Course content'}, page ${currentPage + 1} of ${buckets.length}`}
        </Text>
        {!!activeAssessment && (
          activeAssessment.isPopQuiz && !previewMode ? (
            <PopQuizParticipant item={activeAssessment} onClose={() => setActiveAssessment(null)} />
          ) : (
            <AssessmentPlayer item={activeAssessment} previewMode={previewMode} onClose={() => setActiveAssessment(null)} />
          )
        )}
        {!!activeStudySet && <CourseFlashcardPlayer item={activeStudySet} previewMode={previewMode} onClose={() => setActiveStudySet(null)} />}
        {workspaceModal}
        {!!groupJoinItem && (
          <Modal visible transparent animationType="fade" onRequestClose={() => setGroupJoinItem(null)}>
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' }}>
              <View accessibilityViewIsModal style={{ backgroundColor: colors.card, padding: 20, borderRadius: 16, width: 400, maxWidth: '90%', borderColor: colors.border, borderWidth: 1 }}>
                <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 18, fontWeight: 'bold', marginBottom: 10 }}>Group Assignment Required</Text>
                <Text style={{ color: colors.textSecondary, marginBottom: 20 }}>Course staff must assign you to a group before you can start this assessment.</Text>
                
                {availableGroupNames.length > 0 && (
                  <View style={{ marginBottom: 20 }}>
                    <Text style={{ color: colors.text, fontWeight: 'bold', marginBottom: 10 }}>Available course groups:</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                      {availableGroupNames.map(role => (
                        <View key={role} style={{ paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.background, borderRadius: 8, borderWidth: 1, borderColor: colors.border }}>
                          <Text style={{ color: colors.textSecondary, fontWeight: 'bold' }}>{role}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}

                {availableGroupNames.length === 0 && <Text style={{ color: colors.textSecondary, marginBottom: 15 }}>No groups are available. Ask course staff to create and assign a group.</Text>}

                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close group assignment notice" onPress={() => setGroupJoinItem(null)} style={{ padding: 12, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: colors.textSecondary }}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>
        )}
      </View>
    );
  }

  // Vertical View
  return (
    <View
      style={{ flex: 1, backgroundColor: isDarkIDE ? colors.background : undefined }}
      onLayout={event => setContainerWidth(event.nativeEvent.layout.width)}
    >
      {!!coursePageStateError && (
        <Text accessibilityRole="alert" style={{ color: colors.error, fontSize: 12, paddingHorizontal: 16, paddingTop: 8 }}>
          {coursePageStateError}
        </Text>
      )}
      <ScrollView
        keyboardShouldPersistTaps="handled"
        ref={verticalScrollViewRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={200}
        onScroll={event => {
          const offset = Math.max(0, event.nativeEvent.contentOffset.y);
          verticalOffsetRef.current = offset;
          let visiblePage = 0;
          buckets.forEach((bucket, index) => {
            if ((verticalOffsets.current[bucket.id] ?? Number.POSITIVE_INFINITY) <= offset + 96) visiblePage = index;
          });
          if (visiblePage !== currentPageRef.current) {
            currentPageRef.current = visiblePage;
            setCurrentPage(visiblePage);
          }
        }}
        onScrollEndDrag={() => setVerticalSaveRevision(revision => revision + 1)}
        onMomentumScrollEnd={() => setVerticalSaveRevision(revision => revision + 1)}
      >
        {buckets.map((bucket, idx) => (
          <View 
            key={bucket.id} 
            style={idx > 0 && { marginTop: 30 }}
            onLayout={(e) => {
              verticalOffsets.current[bucket.id] = e.nativeEvent.layout.y;
              if (presentationMode === 'timeline' && bucket.id === 'current' && !hasScrolledVertical.current && !reducedMotion) {
                verticalScrollViewRef.current?.scrollTo({ y: e.nativeEvent.layout.y, animated: true });
                hasScrolledVertical.current = true;
              }
            }}
          >
            {renderBucketContent(bucket)}
          </View>
        ))}
        
        {!!activeAssessment && (
          activeAssessment.isPopQuiz && !previewMode ? (
            <PopQuizParticipant item={activeAssessment} onClose={() => setActiveAssessment(null)} />
          ) : (
            <AssessmentPlayer item={activeAssessment} previewMode={previewMode} onClose={() => setActiveAssessment(null)} />
          )
        )}
        {!!activeStudySet && <CourseFlashcardPlayer item={activeStudySet} previewMode={previewMode} onClose={() => setActiveStudySet(null)} />}
        {workspaceModal}
        {!!groupJoinItem && (
          <Modal visible transparent animationType="fade" onRequestClose={() => setGroupJoinItem(null)}>
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' }}>
              <View accessibilityViewIsModal style={{ backgroundColor: colors.card, padding: 20, borderRadius: 16, width: 400, maxWidth: '90%', borderColor: colors.border, borderWidth: 1 }}>
                <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 18, fontWeight: 'bold', marginBottom: 10 }}>Group Assignment Required</Text>
                <Text style={{ color: colors.textSecondary, marginBottom: 20 }}>Course staff must assign you to a group before you can start this assessment.</Text>
                
                {availableGroupNames.length > 0 && (
                  <View style={{ marginBottom: 20 }}>
                    <Text style={{ color: colors.text, fontWeight: 'bold', marginBottom: 10 }}>Available course groups:</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                      {availableGroupNames.map(role => (
                        <View key={role} style={{ paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.background, borderRadius: 8, borderWidth: 1, borderColor: colors.border }}>
                          <Text style={{ color: colors.textSecondary, fontWeight: 'bold' }}>{role}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}

                {availableGroupNames.length === 0 && <Text style={{ color: colors.textSecondary, marginBottom: 15 }}>No groups are available. Ask course staff to create and assign a group.</Text>}

                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close group assignment notice" onPress={() => setGroupJoinItem(null)} style={{ padding: 12, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: colors.textSecondary }}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  bucketContainer: { marginBottom: 20 },
  badge: { marginLeft: 10, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 12 },
  card: { padding: 20, borderRadius: 16, borderWidth: 1, marginBottom: 15 },
  saasCard: {
    borderWidth: 0,
    elevation: 8,
    marginBottom: 0,
    height: '100%',
    ...(Platform.OS === 'web'
      ? { boxShadow: '0 6px 16px rgba(86,156,214,0.15)' }
      : { shadowColor: '#569cd6', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.15, shadowRadius: 16 }),
  },
  iconBox: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  actionBtn: { marginTop: 15, padding: 12, borderRadius: 8, alignItems: 'center' },
  emptyState: { padding: 40, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderStyle: 'dashed', borderRadius: 16 },
  pagerDot: { width: 8, height: 8, borderRadius: 4, marginHorizontal: 4 },
  pagerTarget: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  screenReaderStatus: { position: 'absolute', left: -10_000, width: 1, height: 1, overflow: 'hidden' },
  widgetControl: { width: 40, height: 40, borderWidth: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  embeddedCourseSite: { width: '100%', minHeight: 520 },
  singleSiteCourse: { flex: 1, width: '100%', minHeight: 0 },
  workspaceLaunchCard: {
    margin: 16,
    padding: 26,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#2A526C',
    borderRadius: 22,
    backgroundColor: '#0B1B2A',
    ...(Platform.OS === 'web'
      ? { boxShadow: '0 24px 60px rgba(0,0,0,.28)' }
      : { shadowColor: '#000', shadowOffset: { width: 0, height: 16 }, shadowOpacity: 0.28, shadowRadius: 30, elevation: 12 }),
  },
  workspaceGlow: { position: 'absolute', width: 260, height: 260, borderRadius: 130, right: -90, top: -110, backgroundColor: 'rgba(98,217,255,.10)' },
  workspaceLaunchHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  workspaceModuleBadge: { minHeight: 30, maxWidth: '75%', paddingHorizontal: 10, borderRadius: 15, backgroundColor: '#62D9FF', flexDirection: 'row', alignItems: 'center' },
  workspaceModuleBadgeText: { color: '#07111F', fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.7, marginLeft: 6, flexShrink: 1 },
  workspaceSecurityBadge: { minHeight: 30, paddingHorizontal: 10, borderWidth: 1, borderColor: '#245E51', borderRadius: 15, backgroundColor: '#0B2C29', flexDirection: 'row', alignItems: 'center' },
  workspaceSecurityBadgeText: { color: '#5BE7B4', fontSize: 11, fontWeight: '800', marginLeft: 5 },
  workspaceLaunchTitle: { color: '#F5F8FC', fontSize: 34, lineHeight: 40, fontWeight: '900', maxWidth: 820, marginTop: 22 },
  workspaceLaunchSummary: { color: '#A7BAD0', fontSize: 16, lineHeight: 24, maxWidth: 840, marginTop: 10 },
  workspaceCapabilityRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 18 },
  workspaceCapability: { minHeight: 38, paddingHorizontal: 11, borderWidth: 1, borderColor: '#24435E', borderRadius: 11, backgroundColor: '#102536', flexDirection: 'row', alignItems: 'center' },
  workspaceCapabilityText: { color: '#D8E7F5', fontSize: 12, fontWeight: '700', marginLeft: 7 },
  workspaceCodePreview: { marginTop: 22, padding: 17, borderWidth: 1, borderColor: '#203B55', borderRadius: 15, backgroundColor: '#050D17' },
  workspaceCodeLabel: { color: '#F5F8FC', fontWeight: '800', flex: 1, marginRight: 10 },
  workspaceLanguage: { color: '#62D9FF', fontFamily: 'monospace', fontSize: 11, fontWeight: '800' },
  workspaceCodeText: { color: '#CBE1F3', fontFamily: 'monospace', fontSize: 13, lineHeight: 20 },
  workspaceLaunchFooter: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 14, marginTop: 22 },
  workspaceProgressLabel: { color: '#A7BAD0', fontSize: 12, marginBottom: 7 },
  workspaceProgressTrack: { height: 7, borderRadius: 4, overflow: 'hidden', backgroundColor: '#28415D' },
  workspaceProgressFill: { height: '100%', borderRadius: 4, backgroundColor: '#5BE7B4' },
  workspaceLaunchButton: { minHeight: 46, paddingHorizontal: 17, borderRadius: 12, backgroundColor: '#62D9FF', flexDirection: 'row', alignItems: 'center', gap: 8 },
  workspaceLaunchButtonText: { color: '#07111F', fontWeight: '900' },
  workspaceSafetyNote: { color: '#7F96AD', fontSize: 11, lineHeight: 17, marginTop: 16 },
  videoShell: { width: '100%', marginTop: 16, borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  video: { width: '100%', aspectRatio: 16 / 9, minHeight: 220, backgroundColor: '#000' },
  videoError: { minHeight: 50, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
  videoAlternatives: { padding: 14, borderTopWidth: 1 },
  videoAlternativesTitle: { fontSize: 16, fontWeight: 'bold', marginBottom: 10 },
  videoAlternativeLink: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  videoTranscriptText: { marginTop: 8, lineHeight: 22 },
});
