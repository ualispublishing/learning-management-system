/**
 * @fileoverview src/components/lms/CourseAnnouncementActivityPanel.tsx.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Text, TouchableOpacity, View } from 'react-native';
import {
  canViewCourseAnnouncementActivity,
  buildCourseAnnouncementChatRoute,
  selectCourseAnnouncementActivity,
  selectCourseAnnouncementThread,
  selectCourseAnnouncementThreads,
  type CourseAnnouncementActivityEntry,
} from '../../lib/chat/announcements';
import { accessibleForegroundColor } from '../../lib/color';
import { useLMSStore } from '../../lib/store/useLMSStore';
import { useThemeColors } from '../../lib/useThemeColors';
import type { Course, CourseRole } from '../../types/lms';

interface CourseAnnouncementActivityPanelProps {
  course: Course;
  role: CourseRole | null | undefined;
}

const sourceLabel = (entry: CourseAnnouncementActivityEntry): string => {
  if (entry.activitySource === 'linked-content') return 'Course content + Chat';
  if (entry.activitySource === 'chat') return 'Chat';
  return 'Course record';
};

const statusLabel = (entry: CourseAnnouncementActivityEntry): string => {
  if (entry.activityStatus === 'synced') return 'Synced';
  if (entry.activityStatus === 'edited') return 'Edited';
  if (entry.activityStatus === 'published') return 'Published';
  return 'Legacy only';
};

export const CourseAnnouncementActivityPanel = ({ course, role }: CourseAnnouncementActivityPanelProps) => {
  const router = useRouter();
  const colors = useThemeColors();
  const currentUserId = useLMSStore(state => state.currentUserId);
  const threads = useLMSStore(state => state.threads);
  const messages = useLMSStore(state => state.messages);
  const contentItems = useLMSStore(state => state.contentItems);
  const fetchThreads = useLMSStore(state => state.fetchThreads);
  const fetchMessages = useLMSStore(state => state.fetchMessages);
  const subscribeToMessages = useLMSStore(state => state.subscribeToMessages);
  const chatError = useLMSStore(state => state.chatError);
  const chatErrorSource = useLMSStore(state => state.chatErrorSource);
  const reconciliationIssues = useLMSStore(state => state.announcementReconciliationIssues);
  const retryAnnouncementReconciliation = useLMSStore(state => state.retryAnnouncementReconciliation);
  const [expanded, setExpanded] = useState(false);
  const [reloadRevision, setReloadRevision] = useState(0);
  const [authorizedThreadContext, setAuthorizedThreadContext] = useState<string | null>(null);
  const [loadedMessageContext, setLoadedMessageContext] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<{ context: string; message: string } | null>(null);
  const [retryingIssueId, setRetryingIssueId] = useState<string | null>(null);
  const canView = canViewCourseAnnouncementActivity(role);
  const loadContext = `${course.id}:${currentUserId || 'anonymous'}:${reloadRevision}`;

  useEffect(() => {
    let active = true;
    if (!canView || !currentUserId) return () => { active = false; };
    void fetchThreads(course.id, currentUserId).then(() => {
      if (!active) return;
      setAuthorizedThreadContext(loadContext);
      setLoadError(current => current?.context === loadContext ? null : current);
    }).catch(error => {
      if (!active) return;
      setLoadError({
        context: loadContext,
        message: error instanceof Error ? error.message : 'Course announcement conversations could not be loaded.',
      });
    });
    return () => { active = false; };
  }, [canView, course.id, currentUserId, fetchThreads, loadContext]);

  const threadsReady = authorizedThreadContext === loadContext;
  const announcementThreads = useMemo(
    () => threadsReady ? selectCourseAnnouncementThreads(course.id, threads) : [],
    [course.id, threads, threadsReady],
  );
  const announcementThreadSignature = announcementThreads.map(thread => thread.id).join('\u0000');

  useEffect(() => {
    let active = true;
    if (!canView || !currentUserId || !threadsReady || !announcementThreadSignature) return () => { active = false; };
    const threadIds = announcementThreadSignature.split('\u0000');
    const messageContext = `${loadContext}:${announcementThreadSignature}`;
    const unsubscribe = threadIds.map(threadId => subscribeToMessages(threadId, currentUserId));
    void Promise.all(threadIds.map(threadId => fetchMessages(threadId, currentUserId))).then(() => {
      if (!active) return;
      setLoadedMessageContext(messageContext);
      setLoadError(current => current?.context === messageContext ? null : current);
    }).catch(error => {
      if (!active) return;
      setLoadError({
        context: messageContext,
        message: error instanceof Error ? error.message : 'Recent announcement activity could not be loaded.',
      });
    });
    return () => {
      active = false;
      unsubscribe.forEach(stop => stop());
    };
  }, [announcementThreadSignature, canView, currentUserId, fetchMessages, loadContext, subscribeToMessages, threadsReady]);

  const hiddenContentItemIds = useMemo(() => contentItems
    .filter(item => item.courseId === course.id
      && (item.deletedAt !== undefined || item.metadata?.lmsAnnouncementActive === false))
    .map(item => item.id), [contentItems, course.id]);
  const activity = useMemo(() => selectCourseAnnouncementActivity(
    course.id,
    course.announcements || [],
    announcementThreads,
    messages,
    hiddenContentItemIds,
  ), [announcementThreads, course.announcements, course.id, hiddenContentItemIds, messages]);
  const canonicalThread = selectCourseAnnouncementThread(course.id, announcementThreads);
  const relevantRealtimeError = chatError && chatErrorSource && (
    chatErrorSource === `threads:${course.id}`
    || chatErrorSource.startsWith(`announcement-source:${course.id}:`)
    || announcementThreads.some(thread => chatErrorSource.endsWith(`:${thread.id}`))
  ) ? chatError : null;
  const messageLoadContext = announcementThreadSignature ? `${loadContext}:${announcementThreadSignature}` : null;
  const currentLoadError = loadError && (loadError.context === loadContext || loadError.context === messageLoadContext)
    ? loadError.message
    : null;
  const visibleError = currentLoadError || relevantRealtimeError;
  const courseReconciliationIssues = Object.values(reconciliationIssues)
    .filter(issue => issue.courseId === course.id)
    .sort((left, right) => right.attemptedAt - left.attemptedAt || left.id.localeCompare(right.id));

  if (!canView) return null;

  const alertColor = accessibleForegroundColor(colors.error, [colors.card]) || colors.text;
  const successColor = accessibleForegroundColor(colors.success, [colors.card]) || colors.text;
  const isLoadingThreads = Boolean(currentUserId) && !threadsReady && loadError?.context !== loadContext;
  const isLoadingMessages = Boolean(messageLoadContext)
    && loadedMessageContext !== messageLoadContext
    && loadError?.context !== messageLoadContext;
  const isLoading = isLoadingThreads || isLoadingMessages;
  const summary = isLoading && activity.length === 0
    ? 'Loading announcement activity…'
    : activity.length === 0
      ? 'No active announcements'
      : `${activity.length} active announcement${activity.length === 1 ? '' : 's'}`;

  const openInChat = (entry: CourseAnnouncementActivityEntry) => {
    const targetThread = entry.threadId
      ? announcementThreads.find(thread => thread.id === entry.threadId)
      : canonicalThread;
    if (!targetThread) return;
    router.push(buildCourseAnnouncementChatRoute(course.id, entry, targetThread));
  };

  return (
    <View
      style={{ marginHorizontal: 20, marginTop: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.card, overflow: 'hidden' }}
      accessibilityLabel="Staff announcement activity"
    >
      <TouchableOpacity
        onPress={() => setExpanded(current => !current)}
        accessibilityRole="button"
        accessibilityLabel={`${expanded ? 'Collapse' : 'Expand'} announcement activity. ${summary}`}
        accessibilityHint="Shows the staff-only unified history from course records, linked course content, and authorized announcement conversations."
        accessibilityState={{ expanded, busy: isLoading }}
        style={{ minHeight: 56, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center' }}
      >
        <Ionicons name="megaphone-outline" size={22} color={colors.primary} />
        <View style={{ flex: 1, marginHorizontal: 10 }}>
          <Text style={{ color: colors.text, fontWeight: '700' }}>Announcement activity</Text>
          <Text accessibilityLiveRegion="polite" style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>{summary}</Text>
        </View>
        {isLoading ? <ActivityIndicator color={colors.primary} accessibilityLabel="Loading announcement activity" /> : null}
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={20} color={colors.textSecondary} style={{ marginLeft: 8 }} />
      </TouchableOpacity>

      {expanded && (
        <View style={{ padding: 14, paddingTop: 0, borderTopWidth: 1, borderTopColor: colors.border }}>
          <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 10, marginBottom: 8 }}>
            Edit linked notices in Course Content or Chat. The bridge preserves exact source messages, keeps withdrawals hidden, and reports any second write that still needs reconciliation.
          </Text>
          {courseReconciliationIssues.map(issue => (
            <View key={issue.id} style={{ borderWidth: 1, borderColor: alertColor, borderRadius: 8, padding: 10, marginBottom: 8 }}>
              <Text accessibilityRole="alert" style={{ color: alertColor, fontSize: 12 }}>
                Sync pending ({issue.direction === 'chat-to-content' ? 'Chat → Course Content' : 'Course Content → Chat'}): {issue.error}
              </Text>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={`Retry announcement reconciliation for ${issue.contentItemId}`}
                accessibilityState={{ disabled: retryingIssueId !== null, busy: retryingIssueId === issue.id }}
                disabled={retryingIssueId !== null}
                onPress={() => {
                  setRetryingIssueId(issue.id);
                  void retryAnnouncementReconciliation(issue.id).catch(() => undefined).finally(() => setRetryingIssueId(null));
                }}
                style={{ alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' }}
              >
                <Text style={{ color: colors.primary, fontWeight: '700' }}>{retryingIssueId === issue.id ? 'Retrying…' : 'Retry sync'}</Text>
              </TouchableOpacity>
            </View>
          ))}
          {visibleError ? (
            <View style={{ marginBottom: 8 }}>
              <Text accessibilityRole="alert" style={{ color: alertColor, fontSize: 12 }}>
                Some live announcement activity may be unavailable. {visibleError}
              </Text>
              {currentLoadError ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Retry loading announcement activity"
                  onPress={() => setReloadRevision(current => current + 1)}
                  style={{ alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' }}
                >
                  <Text style={{ color: colors.primary, fontWeight: '700' }}>Retry</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}
          {!isLoading && announcementThreads.length === 0 ? (
            <Text accessibilityRole="alert" style={{ color: alertColor, fontSize: 12, marginBottom: 8 }}>
              No authorized announcement conversation is available. Course-record notices can still appear, but Chat delivery and exact-message links are unavailable.
            </Text>
          ) : null}
          {activity.length === 0 ? (
            <Text style={{ color: colors.textSecondary, paddingVertical: 12 }}>There is no visible announcement activity for this course.</Text>
          ) : (
            <FlatList
              data={activity}
              keyExtractor={(entry, index) => `${entry.dismissalId}:${entry.messageId || index}`}
              accessibilityRole="list"
              accessibilityLabel="Active course announcements"
              nestedScrollEnabled
              style={{ maxHeight: 320 }}
              renderItem={({ item: entry }) => {
                const targetThread = entry.threadId
                  ? announcementThreads.find(thread => thread.id === entry.threadId)
                  : canonicalThread;
                const source = sourceLabel(entry);
                const status = statusLabel(entry);
                return (
                  <View
                    style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 12 }}
                  >
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginBottom: 5 }}>
                      <Text accessibilityRole="header" style={{ color: colors.text, fontWeight: '700', flexGrow: 1, flexShrink: 1, marginRight: 8 }}>{entry.title}</Text>
                      {entry.type === 'alert' ? <Ionicons name="alert-circle" size={18} color={alertColor} accessibilityLabel="Urgent announcement" /> : null}
                    </View>
                    <Text style={{ color: colors.textSecondary, fontSize: 12 }} numberOfLines={4}>{entry.content}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
                      <Text style={{ color: colors.textSecondary, fontSize: 11, marginRight: 12 }}>Source: {source}</Text>
                      <Text style={{ color: entry.activityStatus === 'legacy-only' ? colors.textSecondary : successColor, fontSize: 11, marginRight: 12 }}>Status: {status}</Text>
                      <Text style={{ color: colors.textSecondary, fontSize: 11 }}>{entry.activityAt > entry.createdAt ? 'Updated ' : ''}{new Date(entry.activityAt).toLocaleString()}</Text>
                    </View>
                    {targetThread ? (
                      <TouchableOpacity
                        onPress={() => openInChat(entry)}
                        accessibilityRole="button"
                        accessibilityLabel={entry.messageId ? `Open exact Chat message for ${entry.title}` : `Open announcement conversation for ${entry.title}`}
                        accessibilityHint={entry.messageId ? 'Navigates to Chat and focuses the source message.' : 'This older course record does not have an exact Chat message target.'}
                        style={{ alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', marginTop: 4 }}
                      >
                        <Text style={{ color: colors.primary, fontWeight: '700' }}>{entry.messageId ? 'View exact message' : 'Open announcements'}</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                );
              }}
            />
          )}
        </View>
      )}
    </View>
  );
};
