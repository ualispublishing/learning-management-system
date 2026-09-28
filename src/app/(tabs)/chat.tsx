/**
 * @fileoverview src/app/(tabs)/chat.tsx.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import Ionicons from '@expo/vector-icons/Ionicons';
import { userAlert as Alert } from '../../lib/userAlert';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useThemeColors } from '../../lib/useThemeColors';
import { spacing, typography } from '../../lib/theme';
import { useLMSStore } from '../../lib/store/useLMSStore';
import { ChatMessage, ChatThread, CourseUser } from '../../types/lms';
import { getAssetService } from '../../lib/integration/assetService';
import { hasCoursePermission } from '../../lib/authorization/coursePermissions';
import { canonicalSafeHttpsUrl } from '../../lib/safeUrl';
import { mergeChatMessages } from '../../lib/store/slices/chatSlice';
import { DatePicker } from '../../components/lms/DatePicker';
import { canRolePostToThread, canUserAccessThread, getChatThreadPhase, getMentionableUsers, hasVisibleMentionToken, mentionedUserIdsInText } from '../../lib/chat/threadPolicy';
import { parseContentDateTime } from '../../lib/contentDateTime';
import { createEntityId } from '../../lib/id';
import { getCourseLifecyclePhase, isCoursePastAt } from '../../lib/courseLifecycle';
import { getLearningStateService } from '../../lib/learningState';

type ThemeColors = ReturnType<typeof useThemeColors>;
type PendingAttachment = { url: string; type: 'image' | 'document'; name: string; threadId: string; principalId: string };
type ViewState =
  | { type: 'main' }
  | { type: 'course'; courseId: string; courseName: string }
  | { type: 'chat'; threadId: string; chatName: string; parentCourseId?: string; parentCourseName?: string };

const firstParam = (value: string | string[] | undefined): string | undefined => Array.isArray(value) ? value[0] : value;
const currentTimestamp = () => Date.now();
const safeMediaUrl = (value?: string) => canonicalSafeHttpsUrl(value);
const openMediaUrl = async (value: string) => {
  try {
    await Linking.openURL(value);
  } catch (error) {
    Alert.alert('Attachment could not be opened', error instanceof Error ? error.message : 'Try again or contact your institution.');
  }
};

const SectionTitle = ({ title, colors }: { title: string; colors: ThemeColors }) => (
  <View style={styles.sectionTitleContainer}>
    <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.primary }]}>{title}</Text>
  </View>
);

const ListItem = ({
  title,
  subtitle,
  badge,
  onPress,
  colors,
}: {
  title: string;
  subtitle: string;
  badge?: string;
  onPress: () => void;
  colors: ThemeColors;
}) => (
  <Pressable
    accessibilityRole="button"
    accessibilityLabel={title}
    style={({ pressed }) => [
      styles.listItem,
      { backgroundColor: pressed ? colors.border : colors.card, borderBottomColor: colors.border },
    ]}
    onPress={onPress}
  >
    <View style={styles.listItemContent}>
      <View style={styles.listItemTitleRow}>
        <Text style={[styles.listItemTitle, { color: colors.text }]} numberOfLines={1}>{title}</Text>
        {!!badge && <Text style={[styles.badge, { backgroundColor: colors.primary, color: colors.buttonText }]}>{badge}</Text>}
      </View>
      <Text style={[styles.listItemSubtitle, { color: colors.textSecondary }]} numberOfLines={2}>{subtitle}</Text>
    </View>
    <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
  </Pressable>
);

const ChatBubble = ({
  message,
  reply,
  isOwn,
  canReply,
  canEdit,
  canDelete,
  actionsDisabled,
  onReply,
  onEdit,
  onDelete,
  onReport,
  colors,
  isFocused = false,
}: {
  message: ChatMessage;
  reply?: ChatMessage;
  isOwn: boolean;
  canReply: boolean;
  canEdit: boolean;
  canDelete: boolean;
  actionsDisabled: boolean;
  onReply: (message: ChatMessage) => void;
  onEdit: (message: ChatMessage) => void;
  onDelete: (message: ChatMessage) => void;
  onReport: (message: ChatMessage) => void;
  colors: ThemeColors;
  isFocused?: boolean;
}) => {
  const [showDetails, setShowDetails] = useState(false);
  const mediaUrl = safeMediaUrl(message.mediaUrl);
  return (
    <View
      style={[
        styles.messageWrapper,
        { alignSelf: isOwn ? 'flex-end' : 'flex-start' },
        isFocused && { borderColor: colors.primary },
        isFocused && styles.focusedMessage,
      ]}
    >
      <Text style={[styles.senderName, { color: isOwn ? colors.primary : colors.textSecondary, textAlign: isOwn ? 'right' : 'left' }]}>
        {isOwn ? 'You' : message.senderName}
      </Text>
      <View style={[
        styles.messageBody,
        {
          backgroundColor: isOwn ? colors.primary : colors.card,
          borderColor: isOwn ? colors.primary : colors.border,
        },
      ]}>
        {!!reply && (
          <View style={[styles.replyPreview, { borderLeftColor: isOwn ? colors.buttonText : colors.primary }]}>
            <Text style={{ color: isOwn ? colors.buttonText : colors.textSecondary, fontSize: typography.xs }} numberOfLines={2}>
              {reply.senderName}: {reply.text}
            </Text>
          </View>
        )}
        {!!message.text && <Text style={{ color: isOwn ? colors.buttonText : colors.text, fontSize: typography.base, lineHeight: 22 }}>{message.text}</Text>}
        {message.mediaType === 'image' && mediaUrl ? (
          <Pressable onPress={() => void openMediaUrl(mediaUrl)} accessibilityRole="button" accessibilityLabel="Open attached image">
            <Image source={{ uri: mediaUrl }} style={styles.messageImage} resizeMode="cover" />
            <Text style={{ color: isOwn ? colors.buttonText : colors.primary, marginTop: spacing[1], fontSize: typography.xs }}>
              {message.mediaName || 'Attached image'}
            </Text>
          </Pressable>
        ) : null}
        {message.mediaType === 'document' && mediaUrl ? (
          <Pressable style={styles.documentRow} onPress={() => void openMediaUrl(mediaUrl)} accessibilityRole="link">
            <Ionicons name="document-text" size={20} color={isOwn ? colors.buttonText : colors.primary} />
            <Text style={{ color: isOwn ? colors.buttonText : colors.primary, marginLeft: spacing[2], flex: 1 }} numberOfLines={1}>
              {message.mediaName || 'Attached document'}
            </Text>
          </Pressable>
        ) : null}
      </View>
      <Pressable
        onPress={() => setShowDetails(value => !value)}
        accessibilityRole="button"
        accessibilityLabel={`${showDetails ? 'Hide' : 'Show'} details and actions for message from ${message.senderName}`}
        accessibilityState={{ expanded: showDetails }}
        style={{ alignSelf: isOwn ? 'flex-end' : 'flex-start', paddingVertical: spacing[1], paddingHorizontal: spacing[1] }}
      >
        <Text style={{ fontSize: typography.xs, color: colors.textSecondary }}>{showDetails ? 'Hide details' : 'Details'}</Text>
      </Pressable>
      {showDetails && (
        <View style={{ marginTop: spacing[1], flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', alignSelf: isOwn ? 'flex-end' : 'flex-start' }}>
          <Text style={{ fontSize: typography.xs, color: colors.textSecondary }}>
            {new Date(message.timestamp).toLocaleString()}{message.editedAt ? ' · Edited' : ''} · Read by {message.readBy}
          </Text>
          {canReply ? <Pressable disabled={actionsDisabled} onPress={() => onReply(message)} accessibilityRole="button" accessibilityLabel={`Reply to ${message.senderName}`} accessibilityState={{ disabled: actionsDisabled }} style={{ marginLeft: spacing[2], padding: spacing[1], opacity: actionsDisabled ? 0.5 : 1 }}>
            <Text style={{ fontSize: typography.xs, color: colors.primary, fontWeight: '700' }}>Reply</Text>
          </Pressable> : null}
          {canEdit ? <Pressable disabled={actionsDisabled} onPress={() => onEdit(message)} accessibilityRole="button" accessibilityLabel="Edit message" accessibilityState={{ disabled: actionsDisabled }} style={{ marginLeft: spacing[2], padding: spacing[1], opacity: actionsDisabled ? 0.5 : 1 }}>
            <Text style={{ fontSize: typography.xs, color: colors.primary, fontWeight: '700' }}>Edit</Text>
          </Pressable> : null}
          {canDelete ? <Pressable disabled={actionsDisabled} onPress={() => onDelete(message)} accessibilityRole="button" accessibilityLabel="Delete message" accessibilityState={{ disabled: actionsDisabled }} style={{ marginLeft: spacing[2], padding: spacing[1], opacity: actionsDisabled ? 0.5 : 1 }}>
            <Text style={{ fontSize: typography.xs, color: colors.error, fontWeight: '700' }}>Delete</Text>
          </Pressable> : null}
          {!isOwn ? <Pressable disabled={actionsDisabled} onPress={() => onReport(message)} accessibilityRole="button" accessibilityLabel={`Report message from ${message.senderName}`} accessibilityState={{ disabled: actionsDisabled }} style={{ marginLeft: spacing[2], padding: spacing[1], opacity: actionsDisabled ? 0.5 : 1 }}>
            <Text style={{ fontSize: typography.xs, color: colors.error, fontWeight: '700' }}>Report</Text>
          </Pressable> : null}
        </View>
      )}
    </View>
  );
};

export default function ChatScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ courseId?: string; chatId?: string; chatName?: string; messageId?: string }>();
  const initialCourseId = firstParam(params.courseId);
  const initialThreadId = firstParam(params.chatId);
  const initialThreadName = firstParam(params.chatName);
  const initialMessageId = firstParam(params.messageId);

  const courses = useLMSStore(state => state.courses);
  const threads = useLMSStore(state => state.threads);
  const directThreads = useLMSStore(state => state.directThreads);
  const directoryUsers = useLMSStore(state => state.directoryUsers);
  const messages = useLMSStore(state => state.messages);
  const messagePagination = useLMSStore(state => state.messagePagination);
  const fetchThreads = useLMSStore(state => state.fetchThreads);
  const fetchDirectThreads = useLMSStore(state => state.fetchDirectThreads);
  const fetchDirectoryUsers = useLMSStore(state => state.fetchDirectoryUsers);
  const fetchMessages = useLMSStore(state => state.fetchMessages);
  const fetchOlderMessages = useLMSStore(state => state.fetchOlderMessages);
  const searchChatMessages = useLMSStore(state => state.searchChatMessages);
  const sendMessage = useLMSStore(state => state.sendMessage);
  const editChatMessage = useLMSStore(state => state.editChatMessage);
  const deleteChatMessage = useLMSStore(state => state.deleteChatMessage);
  const reportChatMessage = useLMSStore(state => state.reportChatMessage);
  const createThread = useLMSStore(state => state.createThread);
  const createDirectThread = useLMSStore(state => state.createDirectThread);
  const markThreadRead = useLMSStore(state => state.markThreadRead);
  const subscribeToMessages = useLMSStore(state => state.subscribeToMessages);
  const currentUserId = useLMSStore(state => state.currentUserId);
  const chatError = useLMSStore(state => state.chatError);
  const chatErrorSource = useLMSStore(state => state.chatErrorSource);
  const clearChatError = useLMSStore(state => state.clearChatError);

  const allUsers = useMemo(() => {
    const users = new Map<string, CourseUser>();
    courses.forEach(course => course.staff.forEach(user => users.set(user.id, user)));
    directoryUsers.forEach(user => users.set(user.id, user));
    return Array.from(users.values());
  }, [courses, directoryUsers]);
  const currentUser = allUsers.find(user => user.id === currentUserId);

  const [view, setView] = useState<ViewState>(() => {
    if (initialThreadId) return { type: 'chat', threadId: initialThreadId, chatName: initialThreadName || 'Conversation', parentCourseId: initialCourseId };
    if (initialCourseId) return { type: 'course', courseId: initialCourseId, courseName: courses.find(course => course.id === initialCourseId)?.title || 'Course' };
    return { type: 'main' };
  });
  const [inputText, setInputText] = useState('');
  const [selectedMentionUserIds, setSelectedMentionUserIds] = useState<string[]>([]);
  const [isSending, setIsSending] = useState(false);
  const sendOperationRef = useRef(false);
  const pendingSendRef = useRef<{ fingerprint: string; id: string } | null>(null);
  const draftClientIdRef = useRef<{ context: string; id: string } | null>(null);
  const restoredReplyIdRef = useRef<string | undefined>(undefined);
  const [draftStateReadyContext, setDraftStateReadyContext] = useState<string | null>(null);
  const [draftStateError, setDraftStateError] = useState<string | null>(null);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const attachmentOperationRef = useRef(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [pendingAttachment, setPendingAttachment] = useState<PendingAttachment | null>(null);
  const [composeDirectVisible, setComposeDirectVisible] = useState(false);
  const [newTopicVisible, setNewTopicVisible] = useState(false);
  const [newTopicTitle, setNewTopicTitle] = useState('');
  const [newTopicDescription, setNewTopicDescription] = useState('');
  const [newTopicGuidelines, setNewTopicGuidelines] = useState('');
  const [newTopicKind, setNewTopicKind] = useState<NonNullable<ChatThread['kind']>>('discussion');
  const [newTopicOpensAt, setNewTopicOpensAt] = useState('');
  const [newTopicClosesAt, setNewTopicClosesAt] = useState('');
  const [newTopicPinned, setNewTopicPinned] = useState(false);
  const [newTopicAllowStudentPosts, setNewTopicAllowStudentPosts] = useState(true);
  const [newTopicAllowReplies, setNewTopicAllowReplies] = useState(true);
  const [newTopicAllowAttachments, setNewTopicAllowAttachments] = useState(true);
  const [newTopicAllowMentions, setNewTopicAllowMentions] = useState(true);
  const [newTopicGroupKey, setNewTopicGroupKey] = useState('');
  const [isCreatingTopic, setIsCreatingTopic] = useState(false);
  const [topicError, setTopicError] = useState<string | null>(null);
  const createTopicOperationRef = useRef(false);
  const [creatingDirectUserId, setCreatingDirectUserId] = useState<string | null>(null);
  const directThreadOperationRef = useRef(false);
  const [replyToMessage, setReplyToMessage] = useState<ChatMessage | null>(null);
  const messageScrollRef = useRef<ScrollView>(null);
  const shouldScrollToEndRef = useRef(!initialMessageId);
  const isNearMessageEndRef = useRef(true);
  const messagePositionsRef = useRef(new Map<string, number>());
  const pendingFocusedMessageIdRef = useRef<string | undefined>(initialMessageId);
  const [focusedMessageId, setFocusedMessageId] = useState<string | undefined>(initialMessageId);
  const [messageSearchQuery, setMessageSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ChatMessage[]>([]);
  const [searchNextCursor, setSearchNextCursor] = useState<string | undefined>();
  const [searchHasMore, setSearchHasMore] = useState(false);
  const [isSearchingMessages, setIsSearchingMessages] = useState(false);
  const searchRevisionRef = useRef(0);
  const searchLoadMoreRef = useRef(false);
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);
  const [editMessageText, setEditMessageText] = useState('');
  const [reportingMessage, setReportingMessage] = useState<ChatMessage | null>(null);
  const [reportReason, setReportReason] = useState('');
  const [messageOperationId, setMessageOperationId] = useState<string | null>(null);
  const [threadInfoVisible, setThreadInfoVisible] = useState(false);
  const [chatNow, setChatNow] = useState(currentTimestamp);
  const messageOperationRef = useRef<string | null>(null);
  const liveChatContext = useRef<{ threadId?: string; principalId?: string }>({});
  useEffect(() => {
    liveChatContext.current = {
      threadId: view.type === 'chat' ? view.threadId : undefined,
      principalId: currentUserId || undefined,
    };
  }, [currentUserId, view]);

  useEffect(() => {
    const timer = setInterval(() => setChatNow(currentTimestamp()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const activeThreadId = view.type === 'chat' ? view.threadId : undefined;
  const activeMessageCount = activeThreadId ? (messages[activeThreadId] || []).length : 0;
  const draftContext = activeThreadId && currentUserId ? `${currentUserId}:${activeThreadId}` : null;

  useEffect(() => {
    let cancelled = false;
    pendingSendRef.current = null;
    draftClientIdRef.current = null;
    restoredReplyIdRef.current = undefined;
    const clearDraft = () => {
      setInputText('');
      setSelectedMentionUserIds([]);
      setReplyToMessage(null);
      setDraftStateError(null);
    };
    if (!activeThreadId || !currentUserId || !draftContext) {
      void Promise.resolve().then(() => {
        if (!cancelled) {
          clearDraft();
          setDraftStateReadyContext(null);
        }
      });
      return () => { cancelled = true; };
    }
    void getLearningStateService().load(
      { principalId: currentUserId, threadId: activeThreadId },
      'chat-draft',
    ).then(record => {
      if (cancelled) return;
      if (record) {
        setInputText(record.payload.text);
        setSelectedMentionUserIds(record.payload.mentionedUserIds);
        restoredReplyIdRef.current = record.payload.replyToMessageId;
        const fingerprint = JSON.stringify([
          activeThreadId,
          currentUserId,
          record.payload.text.trim(),
          undefined,
          undefined,
          undefined,
          record.payload.replyToMessageId,
          record.payload.mentionedUserIds,
        ]);
        pendingSendRef.current = { fingerprint, id: record.payload.clientMessageId };
        draftClientIdRef.current = { context: draftContext, id: record.payload.clientMessageId };
      } else clearDraft();
      setDraftStateError(null);
      setDraftStateReadyContext(draftContext);
    }).catch(error => {
      if (cancelled) return;
      setDraftStateError(error instanceof Error ? error.message : 'Saved message draft could not be restored.');
      setDraftStateReadyContext(draftContext);
    });
    return () => { cancelled = true; };
  }, [activeThreadId, currentUserId, draftContext]);

  useEffect(() => {
    const replyId = restoredReplyIdRef.current;
    if (!activeThreadId || !replyId || replyToMessage) return;
    const restoredReply = (messages[activeThreadId] || []).find(message => message.id === replyId);
    if (restoredReply) setReplyToMessage(restoredReply);
  }, [activeMessageCount, activeThreadId, messages, replyToMessage]);

  useEffect(() => {
    if (!activeThreadId || !currentUserId || !draftContext || draftStateReadyContext !== draftContext) return;
    const scope = { principalId: currentUserId, threadId: activeThreadId };
    const timer = setTimeout(() => {
      if (!inputText && !replyToMessage) {
        draftClientIdRef.current = null;
        void getLearningStateService().remove(scope, 'chat-draft')
          .then(() => setDraftStateError(null))
          .catch(error => setDraftStateError(error instanceof Error ? error.message : 'Message draft could not be cleared.'));
        return;
      }
      if (draftClientIdRef.current?.context !== draftContext) {
        draftClientIdRef.current = { context: draftContext, id: createEntityId('chat-message') };
      }
      void getLearningStateService().save(scope, 'chat-draft', {
        text: inputText,
        replyToMessageId: replyToMessage?.id,
        mentionedUserIds: selectedMentionUserIds,
        clientMessageId: draftClientIdRef.current.id,
      }).then(() => setDraftStateError(null)).catch(error => {
        setDraftStateError(error instanceof Error ? error.message : 'Message draft could not be saved.');
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [activeThreadId, currentUserId, draftContext, draftStateReadyContext, inputText, replyToMessage, selectedMentionUserIds]);
  useEffect(() => {
    if (!activeThreadId || messageSearchQuery.trim()) return;
    if (isNearMessageEndRef.current) shouldScrollToEndRef.current = true;
  }, [activeMessageCount, activeThreadId, messageSearchQuery]);
  useEffect(() => {
    if (!activeThreadId || !currentUserId || activeMessageCount === 0) return;
    void markThreadRead(activeThreadId, currentUserId).catch(() => undefined);
  }, [activeMessageCount, activeThreadId, currentUserId, markThreadRead]);

  useEffect(() => {
    const timer = setTimeout(() => {
      searchRevisionRef.current += 1;
      searchLoadMoreRef.current = false;
      setSearchResults([]);
      setSearchNextCursor(undefined);
      setSearchHasMore(false);
      setIsSearchingMessages(false);
      setMessageSearchQuery('');
      setEditingMessage(null);
      setEditMessageText('');
      setReportingMessage(null);
      setReportReason('');
      messagePositionsRef.current.clear();
      shouldScrollToEndRef.current = !pendingFocusedMessageIdRef.current;
      isNearMessageEndRef.current = true;
    }, 0);
    return () => clearTimeout(timer);
  }, [activeThreadId, currentUserId]);

  useEffect(() => {
    const query = messageSearchQuery.trim();
    if (!activeThreadId || !currentUserId || query.length < 2) return;
    const revision = searchRevisionRef.current;
    const timer = setTimeout(() => {
      if (searchRevisionRef.current !== revision) return;
      setIsSearchingMessages(true);
      void searchChatMessages(activeThreadId, currentUserId, query).then(page => {
        if (searchRevisionRef.current !== revision) return;
        setSearchResults(page.messages.filter(message => !message.deletedAt));
        setSearchNextCursor(page.nextCursor);
        setSearchHasMore(page.hasMore);
        messageScrollRef.current?.scrollTo({ y: 0, animated: false });
      }).catch(() => undefined).finally(() => {
        if (searchRevisionRef.current === revision) setIsSearchingMessages(false);
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [activeThreadId, currentUserId, messageSearchQuery, searchChatMessages]);

  const handleMessageSearchChange = (value: string) => {
    searchRevisionRef.current += 1;
    searchLoadMoreRef.current = false;
    setMessageSearchQuery(value);
    setSearchResults([]);
    setSearchNextCursor(undefined);
    setSearchHasMore(false);
    setIsSearchingMessages(false);
    if (!value.trim()) shouldScrollToEndRef.current = true;
  };
  const activePendingAttachment = pendingAttachment
    && view.type === 'chat'
    && pendingAttachment.threadId === view.threadId
    && pendingAttachment.principalId === currentUserId
    ? pendingAttachment
    : null;

  const routeSignature = `${initialCourseId || ''}:${initialThreadId || ''}:${initialThreadName || ''}:${initialMessageId || ''}`;
  useEffect(() => {
    if (!initialCourseId && !initialThreadId) return;
    const handle = setTimeout(() => {
      setPendingAttachment(null);
      pendingFocusedMessageIdRef.current = initialMessageId;
      setFocusedMessageId(initialMessageId);
      shouldScrollToEndRef.current = !initialMessageId;
      if (initialThreadId) {
        setView({
          type: 'chat',
          threadId: initialThreadId,
          chatName: initialThreadName || 'Conversation',
          parentCourseId: initialCourseId,
          parentCourseName: courses.find(course => course.id === initialCourseId)?.title,
        });
      } else if (initialCourseId) {
        setView({ type: 'course', courseId: initialCourseId, courseName: courses.find(course => course.id === initialCourseId)?.title || 'Course' });
      }
    }, 0);
    return () => clearTimeout(handle);
  }, [routeSignature, courses, initialCourseId, initialThreadId, initialThreadName, initialMessageId]);

  useEffect(() => {
    if (currentUserId) {
      void fetchDirectoryUsers(currentUserId).catch(() => undefined);
      void fetchDirectThreads(currentUserId).catch(() => undefined);
    }
  }, [currentUserId, fetchDirectThreads, fetchDirectoryUsers]);

  useEffect(() => {
    if (view.type === 'course' && currentUserId) {
      void fetchThreads(view.courseId, currentUserId).catch(() => undefined);
    } else if (view.type === 'chat' && currentUserId) {
      if (view.parentCourseId) void fetchThreads(view.parentCourseId, currentUserId || undefined).catch(() => undefined);
      void fetchMessages(view.threadId, currentUserId)
        .then(() => markThreadRead(view.threadId, currentUserId))
        .catch(() => undefined);
    }
  }, [currentUserId, fetchMessages, fetchThreads, markThreadRead, view]);

  useEffect(() => {
    if (view.type !== 'chat' || !currentUserId) return;
    return subscribeToMessages(view.threadId, currentUserId);
  }, [currentUserId, subscribeToMessages, view]);

  const currentThread = view.type === 'chat'
    ? [...threads, ...directThreads].find(thread => thread.id === view.threadId)
    : undefined;
  const membership = currentThread?.courseId
    ? courses.find(course => course.id === currentThread.courseId)?.staff.find(user => user.id === currentUserId)
    : undefined;
  const senderRole = membership?.role ?? currentUser?.role ?? 'student';
  const activeCourse = currentThread?.courseId ? courses.find(course => course.id === currentThread.courseId) : undefined;
  const hasThreadMembership = currentThread
    ? canUserAccessThread(currentThread, activeCourse, currentUserId, senderRole)
    : false;
  const threadPhase = currentThread ? getChatThreadPhase(currentThread, activeCourse, chatNow) : 'closed';
  const canPost = !!currentThread && hasThreadMembership && canRolePostToThread(currentThread, activeCourse, senderRole, chatNow);
  const mentionableUsers = currentThread ? getMentionableUsers(currentThread, activeCourse, allUsers) : [];
  const mentionMatch = currentThread?.allowMentions === false ? null : inputText.match(/(?:^|\s)@([^@\n]{0,80})$/);
  const mentionQuery = mentionMatch?.[1]?.trim().toLocaleLowerCase() || '';
  const mentionSuggestions = mentionMatch
    ? mentionableUsers.filter(user => user.id !== currentUserId && (!mentionQuery || user.name.toLocaleLowerCase().includes(mentionQuery))).slice(0, 8)
    : [];
  const currentThreadDisplayName = currentThread?.scope === 'direct'
    ? allUsers.find(user => user.id !== currentUserId && currentThread.participantIds?.includes(user.id))?.name || currentThread.title
    : currentThread?.title || 'Conversation';

  const clearDeepLinkRoute = () => {
    if (initialCourseId || initialThreadId || initialThreadName || initialMessageId) {
      router.replace('/chat');
    }
  };

  const openThread = (thread: ChatThread, parentCourse?: { id: string; title: string }) => {
    const otherParticipant = thread.scope === 'direct'
      ? allUsers.find(user => user.id !== currentUserId && thread.participantIds?.includes(user.id))
      : undefined;
    setInputText('');
    setPendingAttachment(null);
    setSelectedMentionUserIds([]);
    pendingSendRef.current = null;
    pendingFocusedMessageIdRef.current = undefined;
    setFocusedMessageId(undefined);
    clearDeepLinkRoute();
    setView({
      type: 'chat',
      threadId: thread.id,
      chatName: otherParticipant?.name || thread.title,
      parentCourseId: parentCourse?.id,
      parentCourseName: parentCourse?.title,
    });
    setReplyToMessage(null);
  };

  const scrollToFocusedMessage = (messageId: string): boolean => {
    const y = messagePositionsRef.current.get(messageId);
    if (y === undefined) return false;
    pendingFocusedMessageIdRef.current = undefined;
    shouldScrollToEndRef.current = false;
    isNearMessageEndRef.current = false;
    messageScrollRef.current?.scrollTo({ y: Math.max(0, y - spacing[3]), animated: false });
    return true;
  };

  const handleSend = async (attachment: PendingAttachment | null = activePendingAttachment): Promise<boolean> => {
    const mediaUrl = attachment?.url;
    const mediaType = attachment?.type;
    const mediaName = attachment?.name;
    if (view.type !== 'chat' || !canPost || sendOperationRef.current || (!inputText.trim() && !mediaUrl)) return false;
    if (attachment && (attachment.threadId !== view.threadId || attachment.principalId !== currentUserId
      || liveChatContext.current.threadId !== view.threadId || liveChatContext.current.principalId !== currentUserId)) {
      setAttachmentError('The active account or conversation changed before the attachment could be sent. Return to the original conversation to retry it.');
      return false;
    }
    sendOperationRef.current = true;
    setIsSending(true);
    clearChatError();
    const mentionableById = new Map(mentionableUsers.map(user => [user.id, user]));
    const selectedVisibleMentionIds = selectedMentionUserIds.filter(userId => {
      const user = mentionableById.get(userId);
      return Boolean(user && hasVisibleMentionToken(inputText, user.name));
    });
    const mentionedUserIds = Array.from(new Set([
      ...mentionedUserIdsInText(inputText, mentionableUsers),
      ...selectedVisibleMentionIds,
    ]));
    const sendFingerprint = JSON.stringify([
      view.threadId,
      currentUserId,
      inputText.trim(),
      mediaUrl,
      mediaType,
      mediaName,
      replyToMessage?.id,
      mentionedUserIds,
    ]);
    if (pendingSendRef.current?.fingerprint !== sendFingerprint) {
      const draftId = !pendingSendRef.current && draftClientIdRef.current?.context === draftContext
        ? draftClientIdRef.current.id
        : createEntityId('chat-message');
      pendingSendRef.current = { fingerprint: sendFingerprint, id: draftId };
    }
    try {
      await sendMessage({
        threadId: view.threadId,
        senderId: currentUserId || '',
        senderName: currentUser?.name || 'Unknown user',
        role: senderRole,
        text: inputText,
        readBy: 1,
        readByUserIds: currentUserId ? [currentUserId] : [],
        mediaUrl,
        mediaType,
        mediaName,
        replyToMessageId: replyToMessage?.id,
        mentionedUserIds,
        clientMessageId: pendingSendRef.current.id,
      });
      pendingSendRef.current = null;
      draftClientIdRef.current = null;
      restoredReplyIdRef.current = undefined;
      if (currentUserId) {
        void getLearningStateService().remove(
          { principalId: currentUserId, threadId: view.threadId },
          'chat-draft',
        ).catch(() => undefined);
      }
      setInputText('');
      setSelectedMentionUserIds([]);
      setReplyToMessage(null);
      setPendingAttachment(null);
      shouldScrollToEndRef.current = true;
      isNearMessageEndRef.current = true;
      setTimeout(() => messageScrollRef.current?.scrollToEnd({ animated: true }), 0);
      return true;
    } catch {
      // The store exposes the transport error in the visible chat banner.
      return false;
    } finally {
      sendOperationRef.current = false;
      setIsSending(false);
    }
  };

  const handleLoadOlderMessages = async () => {
    if (view.type !== 'chat' || !currentUserId) return;
    shouldScrollToEndRef.current = false;
    isNearMessageEndRef.current = false;
    await fetchOlderMessages(view.threadId, currentUserId).catch(() => undefined);
  };

  const handleLoadMoreSearchResults = async () => {
    if (view.type !== 'chat' || !currentUserId || searchLoadMoreRef.current || !searchHasMore || !searchNextCursor) return;
    const query = messageSearchQuery.trim();
    if (query.length < 2) return;
    const revision = searchRevisionRef.current;
    const cursor = searchNextCursor;
    searchLoadMoreRef.current = true;
    setIsSearchingMessages(true);
    try {
      const page = await searchChatMessages(view.threadId, currentUserId, query, cursor);
      if (searchRevisionRef.current !== revision) return;
      setSearchResults(current => {
        const merged = new Map(current.map(message => [message.id, message]));
        page.messages.filter(message => !message.deletedAt).forEach(message => merged.set(message.id, message));
        return Array.from(merged.values()).sort((left, right) => left.timestamp - right.timestamp || left.id.localeCompare(right.id));
      });
      setSearchNextCursor(page.nextCursor);
      setSearchHasMore(page.hasMore);
    } catch {
      // The store exposes the search failure in the visible chat banner.
    } finally {
      if (searchRevisionRef.current === revision) setIsSearchingMessages(false);
      searchLoadMoreRef.current = false;
    }
  };

  const requestCloseMessageEditor = () => {
    if (!editingMessage || messageOperationRef.current) return;
    const close = () => { setEditingMessage(null); setEditMessageText(''); };
    if (editMessageText === editingMessage.text) {
      close();
      return;
    }
    Alert.alert('Discard message edit?', 'Your unsaved message changes will be lost.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: close },
    ]);
  };

  const handleSaveMessageEdit = async () => {
    if (!editingMessage || !currentUserId || messageOperationRef.current) return;
    if (editingMessage.threadId !== liveChatContext.current.threadId || currentUserId !== liveChatContext.current.principalId) {
      setAttachmentError('The active account or conversation changed. Reopen the message before editing it.');
      return;
    }
    if (!editMessageText.trim() && !editingMessage.mediaUrl) {
      setAttachmentError('A message or attachment is required.');
      return;
    }
    const operationId = `edit:${editingMessage.id}`;
    messageOperationRef.current = operationId;
    setMessageOperationId(operationId);
    clearChatError();
    try {
      const updated = await editChatMessage(
        editingMessage.id,
        currentUserId,
        editMessageText,
        editingMessage.revision ?? 1,
        mentionedUserIdsInText(editMessageText, mentionableUsers),
      );
      setSearchResults(current => current.map(message => message.id === updated.id ? updated : message));
      setEditingMessage(null);
      setEditMessageText('');
    } catch {
      // The store exposes the revision/transport failure in the chat banner.
    } finally {
      messageOperationRef.current = null;
      setMessageOperationId(null);
    }
  };

  const handleDeleteMessage = (message: ChatMessage) => {
    if (!currentUserId || messageOperationRef.current) return;
    Alert.alert('Delete message?', 'The message will be removed from the conversation. This action remains auditable by the institution.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => {
        if (messageOperationRef.current) return;
        const operationId = `delete:${message.id}`;
        messageOperationRef.current = operationId;
        setMessageOperationId(operationId);
        clearChatError();
        void deleteChatMessage(message.id, currentUserId, message.revision ?? 1).then(() => {
          setSearchResults(current => current.filter(candidate => candidate.id !== message.id));
          if (replyToMessage?.id === message.id) setReplyToMessage(null);
        }).catch(() => undefined).finally(() => {
          messageOperationRef.current = null;
          setMessageOperationId(null);
        });
      } },
    ]);
  };

  const requestCloseMessageReport = () => {
    if (!reportingMessage || messageOperationRef.current) return;
    const close = () => { setReportingMessage(null); setReportReason(''); };
    if (!reportReason.trim()) {
      close();
      return;
    }
    Alert.alert('Discard report?', 'The report has not been submitted.', [
      { text: 'Keep writing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: close },
    ]);
  };

  const handleSubmitMessageReport = async () => {
    if (!reportingMessage || !currentUserId || messageOperationRef.current) return;
    const reason = reportReason.trim();
    if (reason.length < 10) {
      setAttachmentError('Describe the concern using at least 10 characters.');
      return;
    }
    const operationId = `report:${reportingMessage.id}`;
    messageOperationRef.current = operationId;
    setMessageOperationId(operationId);
    clearChatError();
    try {
      await reportChatMessage(reportingMessage.id, currentUserId, reason);
      setReportingMessage(null);
      setReportReason('');
      Alert.alert('Report submitted', 'The institution moderation team can now review this message.');
    } catch {
      // The store exposes the transport failure in the chat banner.
    } finally {
      messageOperationRef.current = null;
      setMessageOperationId(null);
    }
  };

  const handlePickImage = async () => {
    if (attachmentOperationRef.current) return;
    attachmentOperationRef.current = true;
    setIsUploadingAttachment(true);
    setAttachmentError(null);
    if (view.type !== 'chat' || !currentUserId || !currentThread) {
      attachmentOperationRef.current = false;
      setIsUploadingAttachment(false);
      setAttachmentError('Open an accessible conversation before attaching a file.');
      return;
    }
    const uploadThreadId = view.threadId;
    const uploadPrincipalId = currentUserId;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 0.85 });
      const asset = !result.canceled ? result.assets[0] : undefined;
      if (!asset) return;
      const stored = await getAssetService().upload({
        uri: asset.uri,
        name: asset.fileName || 'image',
        mimeType: asset.mimeType,
        size: asset.fileSize,
        file: asset.file,
      }, { courseId: currentThread?.courseId, threadId: currentThread?.id, purpose: 'chat-attachment' });
      const attachment: PendingAttachment = { url: stored.url, type: 'image', name: stored.name, threadId: uploadThreadId, principalId: uploadPrincipalId };
      if (liveChatContext.current.threadId !== uploadThreadId || liveChatContext.current.principalId !== uploadPrincipalId) {
        setAttachmentError('The upload finished after the account or conversation changed. Reattach it in the intended conversation.');
        return;
      }
      setPendingAttachment(attachment);
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : 'Image upload failed.');
    } finally {
      attachmentOperationRef.current = false;
      setIsUploadingAttachment(false);
    }
  };

  const handlePickDocument = async () => {
    if (attachmentOperationRef.current) return;
    attachmentOperationRef.current = true;
    setIsUploadingAttachment(true);
    setAttachmentError(null);
    if (view.type !== 'chat' || !currentUserId || !currentThread) {
      attachmentOperationRef.current = false;
      setIsUploadingAttachment(false);
      setAttachmentError('Open an accessible conversation before attaching a file.');
      return;
    }
    const uploadThreadId = view.threadId;
    const uploadPrincipalId = currentUserId;
    try {
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
      const asset = !result.canceled ? result.assets[0] : undefined;
      if (!asset) return;
      const stored = await getAssetService().upload({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType, size: asset.size, file: asset.file }, { courseId: currentThread?.courseId, threadId: currentThread?.id, purpose: 'chat-attachment' });
      const attachment: PendingAttachment = { url: stored.url, type: 'document', name: stored.name, threadId: uploadThreadId, principalId: uploadPrincipalId };
      if (liveChatContext.current.threadId !== uploadThreadId || liveChatContext.current.principalId !== uploadPrincipalId) {
        setAttachmentError('The upload finished after the account or conversation changed. Reattach it in the intended conversation.');
        return;
      }
      setPendingAttachment(attachment);
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : 'Document upload failed.');
    } finally {
      attachmentOperationRef.current = false;
      setIsUploadingAttachment(false);
    }
  };

  const renderHeader = (title: string, onBack: () => void, action?: React.ReactNode) => (
    <View style={[styles.header, { borderBottomColor: colors.border, backgroundColor: colors.card }]}>
      <Pressable onPress={onBack} style={styles.headerSide} accessibilityRole="button" accessibilityLabel="Back">
        <Ionicons name="arrow-back" size={24} color={colors.primary} />
      </Pressable>
      <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>{title}</Text>
      <View style={[styles.headerSide, { alignItems: 'flex-end' }]}>{action}</View>
    </View>
  );

  const errorBanner = chatError || attachmentError || draftStateError ? (
    <Pressable
      onPress={() => { clearChatError(); setAttachmentError(null); setDraftStateError(null); }}
      style={[styles.errorBanner, { backgroundColor: colors.error }]}
      accessibilityRole="button"
      accessibilityLabel={`${chatError || attachmentError || draftStateError} Dismiss error`}
    >
      <Text accessibilityRole="alert" style={{ color: colors.onError, flex: 1 }}>{chatError || attachmentError || draftStateError}</Text>
      <Ionicons name="close" size={18} color={colors.onError} />
    </Pressable>
  ) : null;

  if (view.type === 'chat') {
    const storedMessages = messages[view.threadId] || [];
    const currentMessages = storedMessages.filter(message => !message.deletedAt);
    const normalizedSearchQuery = messageSearchQuery.trim();
    const searchActive = normalizedSearchQuery.length >= 2;
    const searchResultIds = new Set(searchResults.map(message => message.id));
    const lowerSearchQuery = normalizedSearchQuery.toLocaleLowerCase();
    const liveSearchMessages = storedMessages.filter(message => searchResultIds.has(message.id) || (!message.deletedAt
      && [message.text, message.senderName, message.mediaName || ''].some(value => value.toLocaleLowerCase().includes(lowerSearchQuery))));
    const reconciledSearchResults = searchActive
      ? mergeChatMessages(searchResults, liveSearchMessages).filter(message => !message.deletedAt
        && [message.text, message.senderName, message.mediaName || ''].some(value => value.toLocaleLowerCase().includes(lowerSearchQuery)))
      : [];
    const displayMessages = searchActive ? reconciledSearchResults : currentMessages;
    const byId = new Map([...storedMessages, ...displayMessages]
      .filter(message => !message.deletedAt)
      .map(message => [message.id, message]));
    const pageState = messagePagination[view.threadId];
    const canModerateMessages = Boolean(currentThread?.courseId && hasCoursePermission(membership?.role, 'moderateChat'));
    if (currentThread && !hasThreadMembership) {
      return (
        <View style={[styles.container, styles.unavailableContainer, { backgroundColor: colors.background }]}> 
          <Text accessibilityRole="alert" style={{ color: colors.error, textAlign: 'center' }}>Your role or group assignment no longer permits access to this conversation.</Text>
          <Pressable accessibilityRole="button" onPress={() => setView({ type: 'main' })} style={[styles.unavailableButton, { backgroundColor: colors.primary }]}> 
            <Text style={{ color: colors.buttonText, fontWeight: '700' }}>Back to messages</Text>
          </Pressable>
        </View>
      );
    }
    const conversationUnavailable = !currentThread
      && !pageState?.isLoading
      && chatErrorSource === `messages:${view.threadId}`;
    if (conversationUnavailable) {
      return (
        <View style={[styles.container, styles.unavailableContainer, { backgroundColor: colors.background }]}> 
          <Text accessibilityRole="alert" style={{ color: colors.error, textAlign: 'center' }}>This conversation is unavailable or outside your access.</Text>
          {!!chatError && <Text style={{ color: colors.textSecondary, textAlign: 'center', marginTop: spacing[2] }}>{chatError}</Text>}
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              clearChatError();
              setView(view.parentCourseId && courses.some(course => course.id === view.parentCourseId)
                ? { type: 'course', courseId: view.parentCourseId, courseName: view.parentCourseName || 'Course' }
                : { type: 'main' });
            }}
            style={[styles.unavailableButton, { backgroundColor: colors.primary }]}
          >
            <Text style={{ color: colors.buttonText, fontWeight: '700' }}>Back to messages</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}> 
        {renderHeader(currentThreadDisplayName, () => {
          setPendingAttachment(null);
          clearDeepLinkRoute();
          setView(view.parentCourseId
            ? { type: 'course', courseId: view.parentCourseId, courseName: view.parentCourseName || courses.find(course => course.id === view.parentCourseId)?.title || 'Course' }
            : { type: 'main' });
        }, currentThread?.scope !== 'direct' ? (
          <Pressable onPress={() => setThreadInfoVisible(true)} accessibilityRole="button" accessibilityLabel="Conversation information">
            <Ionicons name="information-circle-outline" size={25} color={colors.primary} />
          </Pressable>
        ) : undefined)}
        {errorBanner}
        {!!currentThread && currentThread.scope !== 'direct' && (
          <Pressable onPress={() => setThreadInfoVisible(true)} accessibilityRole="button" style={[styles.threadSummary, { backgroundColor: colors.card, borderBottomColor: colors.border }]}> 
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontWeight: '700' }} numberOfLines={1}>{currentThread.description || `${(currentThread.kind || 'discussion').replace('-', ' ')} topic`}</Text>
              <Text style={{ color: threadPhase === 'active' ? colors.primary : colors.textSecondary, fontSize: typography.xs, marginTop: 3 }}>
                {threadPhase === 'active'
                  ? 'Active'
                  : threadPhase === 'scheduled'
                    ? `Opens ${new Date(Math.max(activeCourse?.termStart || 0, currentThread.opensAt || 0)).toLocaleString()}`
                    : 'Read-only'} · {currentThread.allowStudentPosts === false ? 'Staff posts' : 'Everyone can post'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          </Pressable>
        )}
        <View style={[styles.messageSearchContainer, { backgroundColor: colors.card, borderBottomColor: colors.border }]}> 
          <Ionicons name="search" size={18} color={colors.textSecondary} />
          <TextInput
            accessibilityLabel="Search this conversation"
            style={[styles.messageSearchInput, { color: colors.text }]}
            placeholder="Search messages, people, or attachments"
            placeholderTextColor={colors.textSecondary}
            value={messageSearchQuery}
            onChangeText={handleMessageSearchChange}
            maxLength={200}
            returnKeyType="search"
          />
          {isSearchingMessages ? <ActivityIndicator size="small" color={colors.primary} /> : null}
          {!!messageSearchQuery && !isSearchingMessages ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Clear message search" onPress={() => handleMessageSearchChange('')} style={styles.searchClearButton}>
              <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
            </Pressable>
          ) : null}
        </View>
        <ScrollView
          ref={messageScrollRef}
          keyboardShouldPersistTaps="handled"
          style={styles.messagesContainer}
          contentContainerStyle={styles.messagesContent}
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          scrollEventThrottle={100}
          onScroll={(event) => {
            const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
            isNearMessageEndRef.current = layoutMeasurement.height + contentOffset.y >= contentSize.height - 80;
          }}
          onContentSizeChange={() => {
            const pendingMessageId = pendingFocusedMessageIdRef.current;
            if (pendingMessageId && scrollToFocusedMessage(pendingMessageId)) return;
            if (!shouldScrollToEndRef.current || searchActive) return;
            shouldScrollToEndRef.current = false;
            messageScrollRef.current?.scrollToEnd({ animated: false });
          }}
        >
          {searchActive && searchHasMore ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Load more search results" accessibilityState={{ disabled: isSearchingMessages, busy: isSearchingMessages }} disabled={isSearchingMessages} onPress={() => void handleLoadMoreSearchResults()} style={[styles.loadOlderButton, { borderColor: colors.border, opacity: isSearchingMessages ? 0.6 : 1 }]}> 
              {isSearchingMessages ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={{ color: colors.primary, fontWeight: '700' }}>Load more results</Text>}
            </Pressable>
          ) : !searchActive && pageState?.hasMore ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Load older messages" accessibilityState={{ disabled: pageState.isLoadingOlder, busy: pageState.isLoadingOlder }} disabled={pageState.isLoadingOlder} onPress={() => void handleLoadOlderMessages()} style={[styles.loadOlderButton, { borderColor: colors.border, opacity: pageState.isLoadingOlder ? 0.6 : 1 }]}> 
              {pageState.isLoadingOlder ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={{ color: colors.primary, fontWeight: '700' }}>Load older messages</Text>}
            </Pressable>
          ) : null}
          {!searchActive && pageState?.isLoading && currentMessages.length === 0 ? (
            <View style={styles.historyStatus}><ActivityIndicator color={colors.primary} /><Text style={{ color: colors.textSecondary, marginLeft: spacing[2] }}>Loading messages…</Text></View>
          ) : normalizedSearchQuery.length === 1 ? (
            <Text style={{ color: colors.textSecondary, textAlign: 'center', marginTop: spacing[8] }}>Enter at least two characters to search.</Text>
          ) : displayMessages.length === 0 && !isSearchingMessages ? (
            <Text style={{ color: colors.textSecondary, textAlign: 'center', marginTop: spacing[8] }}>{searchActive ? 'No matching messages were found.' : 'No messages yet. Start the conversation.'}</Text>
          ) : displayMessages.map(message => (
            <View
              key={message.id}
              collapsable={false}
              onLayout={(event) => {
                messagePositionsRef.current.set(message.id, event.nativeEvent.layout.y);
                if (pendingFocusedMessageIdRef.current === message.id) scrollToFocusedMessage(message.id);
              }}
            >
              <ChatBubble
                message={message}
                reply={message.replyToMessageId ? byId.get(message.replyToMessageId) : undefined}
                isOwn={message.senderId === currentUserId}
                canReply={canPost && currentThread?.allowReplies !== false}
                canEdit={canPost && (
                  message.senderId === currentUserId
                  || Boolean(currentThread?.isAnnouncement && message.contentItemId && hasCoursePermission(membership?.role, 'manageContent'))
                )}
                canDelete={message.senderId === currentUserId || canModerateMessages}
                actionsDisabled={messageOperationId !== null}
                onReply={setReplyToMessage}
                onEdit={(target) => { setEditingMessage(target); setEditMessageText(target.text); setAttachmentError(null); }}
                onDelete={handleDeleteMessage}
                onReport={(target) => { setReportingMessage(target); setReportReason(''); setAttachmentError(null); }}
                colors={colors}
                isFocused={message.id === focusedMessageId}
              />
            </View>
          ))}
        </ScrollView>
        {canPost ? (
          <View style={[styles.inputContainer, { backgroundColor: colors.card, borderTopColor: colors.border }]}> 
            {!!replyToMessage && (
              <View style={[styles.replyComposer, { borderColor: colors.border, backgroundColor: colors.background }]}> 
                <Text style={{ color: colors.textSecondary, flex: 1 }} numberOfLines={1}>Replying to {replyToMessage.senderName}: {replyToMessage.text || replyToMessage.mediaName || 'Attachment'}</Text>
                <Pressable onPress={() => setReplyToMessage(null)} accessibilityRole="button" accessibilityLabel="Cancel reply"><Ionicons name="close" size={18} color={colors.textSecondary} /></Pressable>
              </View>
            )}
            {!!activePendingAttachment && (
              <View style={[styles.replyComposer, { borderColor: colors.border, backgroundColor: colors.background }]}> 
                <Ionicons name={activePendingAttachment.type === 'image' ? 'image-outline' : 'document-outline'} size={18} color={colors.primary} />
                <Text style={{ color: colors.textSecondary, flex: 1, marginLeft: spacing[2] }} numberOfLines={1}>Ready to send: {activePendingAttachment.name}</Text>
                <Pressable disabled={isSending} onPress={() => setPendingAttachment(null)} accessibilityRole="button" accessibilityLabel="Remove pending attachment" accessibilityState={{ disabled: isSending }}><Ionicons name="close" size={18} color={colors.textSecondary} /></Pressable>
              </View>
            )}
            {!!mentionSuggestions.length && (
              <View style={[styles.mentionSuggestions, { backgroundColor: colors.background, borderColor: colors.border }]}> 
                <Text style={{ color: colors.textSecondary, fontSize: typography.xs, marginBottom: spacing[1] }}>Mention a course participant</Text>
                <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false}>
                  {mentionSuggestions.map(user => (
                    <Pressable
                      key={user.id}
                      onPress={() => {
                        const tokenStart = mentionMatch?.index ?? inputText.length;
                        const leadingSpace = mentionMatch?.[0].startsWith(' ') ? ' ' : '';
                        setInputText(`${inputText.slice(0, tokenStart)}${leadingSpace}@${user.name} `);
                        setSelectedMentionUserIds(current => current.includes(user.id) ? current : [...current, user.id]);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`Mention ${user.name}`}
                      style={[styles.mentionChip, { borderColor: colors.primary }]}
                    >
                      <Text style={{ color: colors.primary, fontWeight: '700' }}>@{user.name}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            )}
            {currentThread?.allowAttachments !== false && (
              <>
                <Pressable disabled={isUploadingAttachment || isSending || !!activePendingAttachment} onPress={handlePickImage} style={[styles.attachmentButton, { opacity: isUploadingAttachment || isSending || activePendingAttachment ? 0.5 : 1 }]} accessibilityRole="button" accessibilityLabel="Attach image" accessibilityState={{ disabled: isUploadingAttachment || isSending || !!activePendingAttachment }}>
                  <Ionicons name="image-outline" size={22} color={colors.primary} />
                </Pressable>
                <Pressable disabled={isUploadingAttachment || isSending || !!activePendingAttachment} onPress={handlePickDocument} style={[styles.attachmentButton, { opacity: isUploadingAttachment || isSending || activePendingAttachment ? 0.5 : 1 }]} accessibilityRole="button" accessibilityLabel="Attach document" accessibilityState={{ disabled: isUploadingAttachment || isSending || !!activePendingAttachment }}>
                  <Ionicons name="document-attach-outline" size={22} color={colors.primary} />
                </Pressable>
              </>
            )}
            <TextInput
              accessibilityLabel="Message"
              style={[styles.input, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
              placeholder="Type a message…"
              placeholderTextColor={colors.textSecondary}
              value={inputText}
              onChangeText={(value) => {
                setInputText(value);
                setSelectedMentionUserIds(current => current.filter(userId => {
                  const user = mentionableUsers.find(candidate => candidate.id === userId);
                  return Boolean(user && hasVisibleMentionToken(value, user.name));
                }));
              }}
              multiline
              maxLength={20_000}
              onSubmitEditing={() => void handleSend()}
            />
            <Pressable
              style={[styles.sendButton, { backgroundColor: (inputText.trim() || activePendingAttachment) && !isSending ? colors.primary : colors.border }]}
              onPress={() => void handleSend()}
              disabled={(!inputText.trim() && !activePendingAttachment) || isSending}
              accessibilityRole="button"
              accessibilityLabel="Send message"
              accessibilityState={{ disabled: (!inputText.trim() && !activePendingAttachment) || isSending, busy: isSending }}
            >
              {isSending ? <ActivityIndicator size="small" color={colors.buttonText} /> : <Ionicons name="send" size={18} color={colors.buttonText} />}
            </Pressable>
          </View>
        ) : (
          <View style={[styles.readOnlyBanner, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
            <Ionicons name="lock-closed" size={16} color={colors.textSecondary} />
            <Text style={{ color: colors.textSecondary, marginLeft: spacing[2] }}>
              {!currentThread ? 'Loading conversation permissions…' : threadPhase === 'scheduled' ? 'This conversation is not open yet.' : threadPhase === 'closed' ? 'This conversation is archived and read-only.' : 'Only course staff can post here.'}
            </Text>
          </View>
        )}
        <Modal visible={threadInfoVisible} transparent animationType="fade" onRequestClose={() => setThreadInfoVisible(false)}>
          <View style={styles.modalOverlay}>
            <View style={[styles.composeModal, { backgroundColor: colors.card, borderColor: colors.border, maxHeight: '80%' }]}> 
              <View style={styles.composeHeader}>
                <Text style={[styles.modalTitle, { color: colors.text, marginBottom: 0 }]}>Conversation information</Text>
                <Pressable onPress={() => setThreadInfoVisible(false)} accessibilityRole="button" accessibilityLabel="Close conversation information"><Ionicons name="close" size={24} color={colors.textSecondary} /></Pressable>
              </View>
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingTop: spacing[3] }}>
                <Text style={{ color: colors.text, fontSize: typography.lg, fontWeight: '800' }}>{currentThread?.title}</Text>
                <Text style={{ color: colors.primary, textTransform: 'capitalize', marginTop: spacing[1] }}>{(currentThread?.kind || 'discussion').replace('-', ' ')}</Text>
                {!!currentThread?.description && <Text style={{ color: colors.text, marginTop: spacing[4], lineHeight: 22 }}>{currentThread.description}</Text>}
                {!!currentThread?.guidelines && (
                  <View style={[styles.infoSection, { borderColor: colors.border }]}> 
                    <Text style={{ color: colors.text, fontWeight: '800', marginBottom: spacing[2] }}>Participation guidelines</Text>
                    <Text style={{ color: colors.textSecondary, lineHeight: 21 }}>{currentThread.guidelines}</Text>
                  </View>
                )}
                <View style={[styles.infoSection, { borderColor: colors.border }]}> 
                  <Text style={{ color: colors.text, fontWeight: '800', marginBottom: spacing[2] }}>Availability & permissions</Text>
                  <Text style={{ color: colors.textSecondary }}>Status: {threadPhase === 'active' ? 'Active' : threadPhase === 'scheduled' ? 'Scheduled' : 'Read-only'}</Text>
                  {!!currentThread?.opensAt && <Text style={{ color: colors.textSecondary, marginTop: 4 }}>Opens: {new Date(currentThread.opensAt).toLocaleString()}</Text>}
                  {!!currentThread?.closesAt && <Text style={{ color: colors.textSecondary, marginTop: 4 }}>Closes: {new Date(currentThread.closesAt).toLocaleString()}</Text>}
                  {!!activeCourse && <Text style={{ color: colors.textSecondary, marginTop: 4 }}>Course term: {new Date(activeCourse.termStart).toLocaleDateString()} – {new Date(activeCourse.termEnd).toLocaleDateString()}</Text>}
                  <Text style={{ color: colors.textSecondary, marginTop: 8 }}>{currentThread?.allowStudentPosts === false ? 'Only staff can post.' : 'Students and staff can post.'}</Text>
                  <Text style={{ color: colors.textSecondary, marginTop: 4 }}>Replies {currentThread?.allowReplies === false ? 'disabled' : 'enabled'} · Attachments {currentThread?.allowAttachments === false ? 'disabled' : 'enabled'} · Mentions {currentThread?.allowMentions === false ? 'disabled' : 'enabled'}</Text>
                </View>
              </ScrollView>
            </View>
          </View>
        </Modal>
        <Modal visible={editingMessage !== null} transparent animationType="fade" onRequestClose={requestCloseMessageEditor}>
          <View style={styles.modalOverlay}>
            <View pointerEvents={messageOperationId ? 'none' : 'auto'} style={[styles.composeModal, { backgroundColor: colors.card, borderColor: colors.border, opacity: messageOperationId ? 0.75 : 1 }]}> 
              <View style={styles.composeHeader}>
                <Text style={[styles.modalTitle, { color: colors.text, marginBottom: 0 }]}>Edit message</Text>
                <Pressable disabled={messageOperationId !== null} onPress={requestCloseMessageEditor} accessibilityRole="button" accessibilityLabel="Close message editor" accessibilityState={{ disabled: messageOperationId !== null }}>
                  <Ionicons name="close" size={24} color={colors.textSecondary} />
                </Pressable>
              </View>
              <TextInput
                accessibilityLabel="Edited message text"
                style={[styles.messageEditInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
                value={editMessageText}
                onChangeText={setEditMessageText}
                multiline
                maxLength={20_000}
                autoFocus
              />
              {chatError && chatErrorSource?.startsWith('edit:') ? <Text accessibilityRole="alert" style={{ color: colors.error, marginTop: spacing[2] }}>{chatError}</Text> : null}
              <View style={styles.modalActions}>
                <Pressable disabled={messageOperationId !== null} onPress={requestCloseMessageEditor} accessibilityRole="button" accessibilityLabel="Cancel message edit" accessibilityState={{ disabled: messageOperationId !== null }} style={styles.modalAction}>
                  <Text style={{ color: colors.textSecondary }}>Cancel</Text>
                </Pressable>
                <Pressable
                  disabled={messageOperationId !== null || editMessageText === editingMessage?.text || (!editMessageText.trim() && !editingMessage?.mediaUrl)}
                  onPress={() => void handleSaveMessageEdit()}
                  accessibilityRole="button"
                  accessibilityLabel="Save edited message"
                  accessibilityState={{ disabled: messageOperationId !== null || editMessageText === editingMessage?.text || (!editMessageText.trim() && !editingMessage?.mediaUrl) }}
                  style={[styles.modalAction, { backgroundColor: colors.primary, opacity: messageOperationId !== null || editMessageText === editingMessage?.text || (!editMessageText.trim() && !editingMessage?.mediaUrl) ? 0.5 : 1 }]}
                >
                  {messageOperationId?.startsWith('edit:') ? <ActivityIndicator size="small" color={colors.buttonText} /> : <Text style={{ color: colors.buttonText, fontWeight: '700' }}>Save</Text>}
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
        <Modal visible={reportingMessage !== null} transparent animationType="fade" onRequestClose={requestCloseMessageReport}>
          <View style={styles.modalOverlay}>
            <View pointerEvents={messageOperationId ? 'none' : 'auto'} style={[styles.composeModal, { backgroundColor: colors.card, borderColor: colors.border, opacity: messageOperationId ? 0.75 : 1 }]}> 
              <View style={styles.composeHeader}>
                <Text style={[styles.modalTitle, { color: colors.text, marginBottom: 0 }]}>Report message</Text>
                <Pressable disabled={messageOperationId !== null} onPress={requestCloseMessageReport} accessibilityRole="button" accessibilityLabel="Close message report" accessibilityState={{ disabled: messageOperationId !== null }}>
                  <Ionicons name="close" size={24} color={colors.textSecondary} />
                </Pressable>
              </View>
              <Text style={{ color: colors.textSecondary, marginBottom: spacing[3] }}>Explain the concern for your institution’s moderation team. The original message ID and reporter identity are retained by the server.</Text>
              <TextInput
                accessibilityLabel="Message report reason"
                style={[styles.messageEditInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
                value={reportReason}
                onChangeText={setReportReason}
                placeholder="Describe harassment, unsafe content, spam, or another policy concern"
                placeholderTextColor={colors.textSecondary}
                multiline
                maxLength={1_000}
                autoFocus
              />
              <Text style={{ color: reportReason.trim().length >= 10 ? colors.textSecondary : colors.error, fontSize: typography.xs, marginTop: spacing[1] }}>{reportReason.trim().length}/1,000 · minimum 10</Text>
              {chatError && chatErrorSource?.startsWith('report:') ? <Text accessibilityRole="alert" style={{ color: colors.error, marginTop: spacing[2] }}>{chatError}</Text> : null}
              <View style={styles.modalActions}>
                <Pressable disabled={messageOperationId !== null} onPress={requestCloseMessageReport} accessibilityRole="button" accessibilityLabel="Cancel message report" accessibilityState={{ disabled: messageOperationId !== null }} style={styles.modalAction}>
                  <Text style={{ color: colors.textSecondary }}>Cancel</Text>
                </Pressable>
                <Pressable
                  disabled={messageOperationId !== null || reportReason.trim().length < 10}
                  onPress={() => void handleSubmitMessageReport()}
                  accessibilityRole="button"
                  accessibilityLabel="Submit message report"
                  accessibilityState={{ disabled: messageOperationId !== null || reportReason.trim().length < 10 }}
                  style={[styles.modalAction, { backgroundColor: colors.error, opacity: messageOperationId !== null || reportReason.trim().length < 10 ? 0.5 : 1 }]}
                >
                  {messageOperationId?.startsWith('report:') ? <ActivityIndicator size="small" color={colors.onError} /> : <Text style={{ color: colors.onError, fontWeight: '700' }}>Submit report</Text>}
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  if (view.type === 'course') {
    const course = courses.find(candidate => candidate.id === view.courseId);
    const courseThreads = threads
      .filter(thread => thread.courseId === view.courseId && canUserAccessThread(
        thread,
        course,
        currentUserId,
        course?.staff.find(user => user.id === currentUserId)?.role,
      ))
      .sort((left, right) => Number(right.isPinned) - Number(left.isPinned) || (right.updatedAt ?? right.createdAt) - (left.updatedAt ?? left.createdAt));
    const membership = course?.staff.find(user => user.id === currentUserId);
    const canSeeEveryGroup = hasCoursePermission(membership?.role, 'postStaffChat');
    const canManageChat = hasCoursePermission(membership?.role, 'manageChat')
      && course?.status === 'active'
      && chatNow < course.termEnd;
    const groupTargets = (course?.groupSets || []).flatMap(groupSet => groupSet.groups
      .filter(group => canSeeEveryGroup || group.memberIds.includes(currentUserId || ''))
      .map(group => ({ key: `${groupSet.id}:${group.id}`, groupSetId: groupSet.id, groupId: group.id, label: `${groupSet.name} · ${group.name}` })));
    if (!course || !membership) {
      return (
        <View style={[styles.container, styles.unavailableContainer, { backgroundColor: colors.background }]}> 
          <Text accessibilityRole="alert" style={{ color: colors.error, textAlign: 'center' }}>
            {course ? 'You are not enrolled in this course.' : 'This course conversation is unavailable.'}
          </Text>
          <Pressable accessibilityRole="button" onPress={() => setView({ type: 'main' })} style={[styles.unavailableButton, { backgroundColor: colors.primary }]}> 
            <Text style={{ color: colors.buttonText, fontWeight: '700' }}>Back to messages</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {renderHeader(
          course.title,
          () => {
            clearDeepLinkRoute();
            setView({ type: 'main' });
          },
          canManageChat ? (
            <Pressable onPress={() => { setNewTopicGroupKey(''); setTopicError(null); setNewTopicVisible(true); }} accessibilityRole="button" accessibilityLabel="New course topic">
              <Ionicons name="add-circle-outline" size={25} color={colors.primary} />
            </Pressable>
          ) : undefined,
        )}
        {errorBanner}
        <ScrollView keyboardShouldPersistTaps="handled" style={styles.listContainer}>
          <SectionTitle title="Topics & groups" colors={colors} />
          {courseThreads.map(thread => (
            <ListItem
              key={thread.id}
              title={thread.title}
              subtitle={`${thread.isPinned ? 'Pinned · ' : ''}${thread.isAnnouncement ? 'Staff announcements' : thread.scope === 'group' ? `Private group · ${thread.groupId}` : (thread.kind || 'discussion').replace('-', ' ')}${thread.description ? ` · ${thread.description}` : ''}`}
              badge={getChatThreadPhase(thread, course, chatNow) === 'active' ? 'Active' : 'Read-only'}
              onPress={() => openThread(thread, course ? { id: course.id, title: course.title } : undefined)}
              colors={colors}
            />
          ))}
          {courseThreads.length === 0 && <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No conversations are available for this course.</Text>}
        </ScrollView>
        <Modal visible={newTopicVisible && canManageChat} transparent animationType="fade" onRequestClose={() => { if (!createTopicOperationRef.current) setNewTopicVisible(false); }}>
          <View style={styles.modalOverlay}>
            <View style={[styles.composeModal, { backgroundColor: colors.card, borderColor: colors.border, maxHeight: '92%' }]}> 
              <View style={styles.composeHeader}>
                <Text style={[styles.modalTitle, { color: colors.text, marginBottom: 0 }]}>New course conversation</Text>
                <Pressable disabled={isCreatingTopic} onPress={() => setNewTopicVisible(false)} accessibilityRole="button" accessibilityLabel="Close new conversation" accessibilityState={{ disabled: isCreatingTopic, busy: isCreatingTopic }}><Ionicons name="close" size={24} color={colors.textSecondary} /></Pressable>
              </View>
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingTop: spacing[3] }}>
                <Text style={[styles.fieldLabel, { color: colors.text }]}>Format</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                  {([
                    ['discussion', 'Discussion'],
                    ['q-and-a', 'Q&A'],
                    ['announcements', 'Announcements'],
                    ['study-group', 'Study group'],
                    ['office-hours', 'Office hours'],
                  ] as const).map(([kind, label]) => {
                    const selected = newTopicKind === kind;
                    return (
                      <Pressable key={kind} onPress={() => { setNewTopicKind(kind); if (kind === 'announcements') setNewTopicAllowStudentPosts(false); }} accessibilityRole="radio" accessibilityState={{ checked: selected }} style={[styles.audienceChip, { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? `${colors.primary}20` : colors.background }]}> 
                        <Text style={{ color: selected ? colors.primary : colors.text }}>{label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={[styles.fieldLabel, { color: colors.text }]}>Title *</Text>
                <TextInput accessibilityLabel="Topic title" style={[styles.topicInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]} value={newTopicTitle} onChangeText={setNewTopicTitle} placeholder="e.g. Week 4 questions" placeholderTextColor={colors.textSecondary} maxLength={500} autoFocus />
                <Text style={[styles.fieldLabel, { color: colors.text }]}>Purpose / prompt</Text>
                <TextInput accessibilityLabel="Topic purpose" style={[styles.topicInput, styles.longTopicInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]} value={newTopicDescription} onChangeText={setNewTopicDescription} placeholder="What should participants discuss or ask here?" placeholderTextColor={colors.textSecondary} maxLength={4_000} multiline />
                <Text style={[styles.fieldLabel, { color: colors.text }]}>Participation guidelines</Text>
                <TextInput accessibilityLabel="Participation guidelines" style={[styles.topicInput, styles.longTopicInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]} value={newTopicGuidelines} onChangeText={setNewTopicGuidelines} placeholder="Etiquette, response expectations, and boundaries" placeholderTextColor={colors.textSecondary} maxLength={4_000} multiline />
                {!!groupTargets.length && (
                  <View style={{ marginTop: spacing[3] }}>
                    <Text style={{ color: colors.text, fontWeight: '700', marginBottom: spacing[2] }}>Audience</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                      {[{ key: '', label: 'Course-wide' }, ...groupTargets].map(target => {
                        const selected = newTopicGroupKey === target.key;
                        return (
                          <Pressable key={target.key || 'course'} onPress={() => setNewTopicGroupKey(target.key)} accessibilityRole="radio" accessibilityState={{ checked: selected }} style={[styles.audienceChip, { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? `${colors.primary}20` : colors.background }]}> 
                            <Text style={{ color: selected ? colors.primary : colors.text }}>{target.label}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                )}
                <Text style={[styles.fieldLabel, { color: colors.text }]}>Opens (optional)</Text>
                <DatePicker courseId={view.courseId} value={newTopicOpensAt} onChange={setNewTopicOpensAt} />
                <Text style={[styles.fieldLabel, { color: colors.text }]}>Closes (optional)</Text>
                <DatePicker courseId={view.courseId} value={newTopicClosesAt} onChange={setNewTopicClosesAt} />
                <View style={[styles.policyBox, { backgroundColor: colors.background, borderColor: colors.border }]}> 
                  {([
                    ['Pin to top', newTopicPinned, setNewTopicPinned],
                    ['Students can post', newTopicKind === 'announcements' ? false : newTopicAllowStudentPosts, setNewTopicAllowStudentPosts],
                    ['Allow replies', newTopicAllowReplies, setNewTopicAllowReplies],
                    ['Allow attachments', newTopicAllowAttachments, setNewTopicAllowAttachments],
                    ['Allow @mentions', newTopicAllowMentions, setNewTopicAllowMentions],
                  ] as const).map(([label, value, setter]) => (
                    <View key={label} style={styles.policyRow}>
                      <Text style={{ color: colors.text, flex: 1 }}>{label}</Text>
                      <Switch accessibilityLabel={label} accessibilityState={{ disabled: label === 'Students can post' && newTopicKind === 'announcements' }} disabled={label === 'Students can post' && newTopicKind === 'announcements'} value={value} onValueChange={setter} />
                    </View>
                  ))}
                </View>
                {(chatError || topicError) && <Text accessibilityRole="alert" style={{ color: colors.error, marginTop: spacing[2] }}>{topicError || chatError}</Text>}
              </ScrollView>
              <View style={styles.modalActions}>
                <Pressable accessibilityRole="button" accessibilityLabel="Cancel new conversation" accessibilityState={{ disabled: isCreatingTopic }} disabled={isCreatingTopic} onPress={() => { setNewTopicVisible(false); setNewTopicTitle(''); setTopicError(null); }} style={[styles.modalAction, { opacity: isCreatingTopic ? 0.5 : 1 }]}> 
                  <Text style={{ color: colors.textSecondary }}>Cancel</Text>
                </Pressable>
                <Pressable
                  disabled={!newTopicTitle.trim() || !currentUserId || isCreatingTopic}
                  style={[styles.modalAction, { backgroundColor: newTopicTitle.trim() ? colors.primary : colors.border }]}
                  accessibilityRole="button"
                  accessibilityLabel={isCreatingTopic ? 'Creating conversation' : 'Create conversation'}
                  accessibilityState={{ disabled: !newTopicTitle.trim() || !currentUserId || isCreatingTopic, busy: isCreatingTopic }}
                  onPress={() => {
                    if (!currentUserId || createTopicOperationRef.current) return;
                    const groupTarget = groupTargets.find(target => target.key === newTopicGroupKey);
                    const topicCourseTimeZone = courses.find(course => course.id === view.courseId)?.timeZone;
                    const opensAt = newTopicOpensAt ? parseContentDateTime(newTopicOpensAt, topicCourseTimeZone) : undefined;
                    const closesAt = newTopicClosesAt ? parseContentDateTime(newTopicClosesAt, topicCourseTimeZone) : undefined;
                    if ((newTopicOpensAt && opensAt === undefined) || (newTopicClosesAt && closesAt === undefined)) {
                      setTopicError('Enter valid conversation open and close times.');
                      return;
                    }
                    if (opensAt !== undefined && closesAt !== undefined && opensAt >= closesAt) {
                      setTopicError('The conversation close time must be after its open time.');
                      return;
                    }
                    createTopicOperationRef.current = true;
                    setIsCreatingTopic(true);
                    setTopicError(null);
                    void createThread({
                      courseId: view.courseId,
                      title: newTopicTitle.trim(),
                      description: newTopicDescription.trim() || undefined,
                      guidelines: newTopicGuidelines.trim() || undefined,
                      kind: newTopicKind,
                      isAnnouncement: newTopicKind === 'announcements',
                      isPinned: newTopicPinned,
                      opensAt,
                      closesAt,
                      allowStudentPosts: newTopicKind === 'announcements' ? false : newTopicAllowStudentPosts,
                      allowReplies: newTopicAllowReplies,
                      allowAttachments: newTopicAllowAttachments,
                      allowMentions: newTopicAllowMentions,
                      scope: groupTarget ? 'group' : 'course',
                      groupSetId: groupTarget?.groupSetId,
                      groupId: groupTarget?.groupId,
                      createdBy: currentUserId,
                    }).then(() => {
                      setNewTopicVisible(false);
                      setNewTopicTitle('');
                      setNewTopicDescription('');
                      setNewTopicGuidelines('');
                      setNewTopicKind('discussion');
                      setNewTopicOpensAt('');
                      setNewTopicClosesAt('');
                      setNewTopicPinned(false);
                      setNewTopicAllowStudentPosts(true);
                      setNewTopicAllowReplies(true);
                      setNewTopicAllowAttachments(true);
                      setNewTopicAllowMentions(true);
                      setNewTopicGroupKey('');
                      return fetchThreads(view.courseId, currentUserId);
                    }).catch(() => undefined).finally(() => {
                      createTopicOperationRef.current = false;
                      setIsCreatingTopic(false);
                    });
                  }}
                >
                  <Text style={{ color: newTopicTitle.trim() ? colors.buttonText : colors.textSecondary, fontWeight: '700' }}>{isCreatingTopic ? 'Creating…' : 'Create'}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  const conversationUsers = allUsers.filter(user => user.id !== currentUserId);
  const upcomingCourses = courses.filter(course => getCourseLifecyclePhase(course, chatNow) === 'future');
  const currentCourses = courses.filter(course => getCourseLifecyclePhase(course, chatNow) === 'active');
  const courseHistory = courses.filter(course => isCoursePastAt(course, chatNow));
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.mainHeader, { borderBottomColor: colors.border, backgroundColor: colors.card }]}> 
        <Text accessibilityRole="header" style={[styles.mainHeaderTitle, { color: colors.text }]}>Messages</Text>
        <Pressable onPress={() => setComposeDirectVisible(true)} accessibilityRole="button" accessibilityLabel="New direct message">
          <Ionicons name="create-outline" size={24} color={colors.primary} />
        </Pressable>
      </View>
      {errorBanner}
      <ScrollView keyboardShouldPersistTaps="handled" style={styles.listContainer}>
        <SectionTitle title="Direct messages" colors={colors} />
        {directThreads.map(thread => {
          const otherUser = allUsers.find(user => user.id !== currentUserId && thread.participantIds?.includes(user.id));
          const threadMessages = messages[thread.id] || [];
          const loadedUnread = threadMessages.filter(message => !message.deletedAt && message.senderId !== currentUserId && !message.readByUserIds?.includes(currentUserId || '')).length;
          const unread = thread.unreadCount ?? loadedUnread;
          const fallbackSubtitle = otherUser ? `${otherUser.role.toUpperCase()} · Private conversation` : 'Private conversation';
          return (
            <ListItem
              key={thread.id}
              title={otherUser?.name || thread.title}
              subtitle={thread.lastMessagePreview || fallbackSubtitle}
              badge={unread ? String(unread) : undefined}
              onPress={() => openThread(thread)}
              colors={colors}
            />
          );
        })}
        {directThreads.length === 0 && <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No direct conversations yet.</Text>}

        <SectionTitle title="Active courses" colors={colors} />
        {currentCourses.map(course => (
          <ListItem key={course.id} title={course.title} subtitle={course.description} onPress={() => setView({ type: 'course', courseId: course.id, courseName: course.title })} colors={colors} />
        ))}
        {currentCourses.length === 0 && <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No current course conversations.</Text>}

        {upcomingCourses.length > 0 && <SectionTitle title="Upcoming courses" colors={colors} />}
        {upcomingCourses.map(course => (
          <ListItem key={course.id} title={course.title} subtitle={`Starts ${new Date(course.termStart).toLocaleDateString()} · ${course.description}`} onPress={() => setView({ type: 'course', courseId: course.id, courseName: course.title })} colors={colors} />
        ))}

        <SectionTitle title="Course history" colors={colors} />
        {courseHistory.map(course => (
          <ListItem key={course.id} title={course.title} subtitle={course.description} onPress={() => setView({ type: 'course', courseId: course.id, courseName: course.title })} colors={colors} />
        ))}
        {courseHistory.length === 0 && <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No archived course conversations.</Text>}
      </ScrollView>

      <Modal visible={composeDirectVisible} transparent animationType="fade" onRequestClose={() => { if (!directThreadOperationRef.current) setComposeDirectVisible(false); }}>
        <View style={styles.modalOverlay}>
          <View style={[styles.composeModal, { backgroundColor: colors.card, borderColor: colors.border, maxHeight: '75%' }]}>
            <View style={styles.composeHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>New direct message</Text>
              <Pressable disabled={creatingDirectUserId !== null} onPress={() => { if (!directThreadOperationRef.current) setComposeDirectVisible(false); }} accessibilityRole="button" accessibilityLabel="Close" accessibilityState={{ disabled: creatingDirectUserId !== null }}>
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </Pressable>
            </View>
            {chatError && <Text accessibilityRole="alert" style={{ color: colors.error, marginBottom: spacing[2] }}>{chatError}</Text>}
            <ScrollView keyboardShouldPersistTaps="handled">
              {conversationUsers.map(user => (
                <ListItem
                  key={user.id}
                  title={user.name}
                  subtitle={user.role.toUpperCase()}
                  colors={colors}
                  onPress={() => {
                    if (!currentUserId || directThreadOperationRef.current) return;
                    directThreadOperationRef.current = true;
                    setCreatingDirectUserId(user.id);
                    void createDirectThread(currentUserId, user.id, user.name).then(thread => {
                      setComposeDirectVisible(false);
                      openThread(thread);
                    }).catch(() => undefined).finally(() => {
                      directThreadOperationRef.current = false;
                      setCreatingDirectUserId(null);
                    });
                  }}
                />
              ))}
              {conversationUsers.length === 0 && <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No participants are available to message.</Text>}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, width: '100%' },
  mainHeader: { padding: spacing[4], borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  mainHeaderTitle: { fontSize: typography['2xl'], fontWeight: '800' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing[3], borderBottomWidth: 1 },
  headerSide: { width: 44, minHeight: 44, justifyContent: 'center' },
  headerTitle: { fontSize: typography.lg, fontWeight: '700', flex: 1, textAlign: 'center' },
  listContainer: { flex: 1, width: '100%' },
  sectionTitleContainer: { paddingHorizontal: spacing[4], paddingTop: spacing[6], paddingBottom: spacing[2] },
  sectionTitle: { fontSize: typography.sm, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  listItem: { flexDirection: 'row', alignItems: 'center', padding: spacing[4], borderBottomWidth: StyleSheet.hairlineWidth, minHeight: 72 },
  listItemContent: { flex: 1, marginRight: spacing[2] },
  listItemTitleRow: { flexDirection: 'row', alignItems: 'center' },
  listItemTitle: { fontSize: typography.base, fontWeight: '600', marginBottom: spacing[1], flexShrink: 1 },
  listItemSubtitle: { fontSize: typography.sm, lineHeight: 18 },
  badge: { minWidth: 20, height: 20, borderRadius: 10, textAlign: 'center', overflow: 'hidden', marginLeft: spacing[2], paddingHorizontal: spacing[1], fontSize: typography.xs, lineHeight: 20, fontWeight: '800' },
  emptyText: { paddingHorizontal: spacing[4], paddingVertical: spacing[3], fontStyle: 'italic' },
  messagesContainer: { flex: 1, width: '100%' },
  messagesContent: { padding: spacing[4], paddingBottom: spacing[8] },
  messageSearchContainer: { minHeight: 48, paddingHorizontal: spacing[3], flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  threadSummary: { minHeight: 58, paddingHorizontal: spacing[4], paddingVertical: spacing[2], flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  messageSearchInput: { flex: 1, minHeight: 44, paddingHorizontal: spacing[2], fontSize: typography.sm },
  searchClearButton: { minWidth: 36, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  loadOlderButton: { minHeight: 44, borderWidth: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: spacing[4], paddingHorizontal: spacing[4] },
  historyStatus: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  messageEditInput: { minHeight: 120, maxHeight: 280, borderWidth: 1, borderRadius: 10, padding: spacing[3], textAlignVertical: 'top', fontSize: typography.base },
  messageWrapper: { marginBottom: spacing[4], maxWidth: '82%' },
  focusedMessage: { borderWidth: 2, borderRadius: 20, padding: spacing[2] },
  senderName: { fontSize: typography.xs, fontWeight: '700', marginBottom: spacing[1] },
  messageBody: { padding: spacing[3], borderWidth: 1, borderRadius: 16 },
  replyPreview: { borderLeftWidth: 3, paddingLeft: spacing[2], marginBottom: spacing[2], opacity: 0.85 },
  messageImage: { width: 220, height: 150, borderRadius: 10, marginTop: spacing[2] },
  documentRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing[2], minHeight: 36 },
  inputContainer: { flexDirection: 'row', flexWrap: 'wrap', padding: spacing[3], paddingBottom: Platform.OS === 'ios' ? spacing[6] : spacing[3], borderTopWidth: 1, alignItems: 'flex-end' },
  replyComposer: { width: '100%', flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 8, paddingHorizontal: spacing[3], paddingVertical: spacing[2], marginBottom: spacing[2] },
  mentionSuggestions: { width: '100%', borderWidth: 1, borderRadius: 10, padding: spacing[2], marginBottom: spacing[2] },
  mentionChip: { borderWidth: 1, borderRadius: 16, paddingHorizontal: spacing[3], paddingVertical: spacing[2], marginRight: spacing[2] },
  attachmentButton: { width: 36, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, minHeight: 44, maxHeight: 120, borderWidth: 1, borderRadius: 22, paddingHorizontal: spacing[4], paddingVertical: spacing[2], marginHorizontal: spacing[2], fontSize: typography.base },
  sendButton: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  readOnlyBanner: { flexDirection: 'row', padding: spacing[4], borderTopWidth: 1, alignItems: 'center', justifyContent: 'center' },
  errorBanner: { flexDirection: 'row', paddingHorizontal: spacing[4], paddingVertical: spacing[2], alignItems: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: spacing[4] },
  composeModal: { width: '100%', maxWidth: 520, borderRadius: 16, borderWidth: 1, overflow: 'hidden', padding: spacing[4] },
  composeHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing[3] },
  modalTitle: { fontSize: typography.xl, fontWeight: '800', marginBottom: spacing[3] },
  topicInput: { borderWidth: 1, borderRadius: 10, padding: spacing[3], fontSize: typography.base },
  longTopicInput: { minHeight: 84, textAlignVertical: 'top' },
  fieldLabel: { fontWeight: '700', marginBottom: spacing[2], marginTop: spacing[3] },
  policyBox: { borderWidth: 1, borderRadius: 12, paddingHorizontal: spacing[3], marginTop: spacing[4] },
  policyRow: { minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  infoSection: { borderTopWidth: 1, paddingTop: spacing[3], marginTop: spacing[4] },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: spacing[4] },
  modalAction: { minWidth: 88, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 10, marginLeft: spacing[2], paddingHorizontal: spacing[3] },
  audienceChip: { borderWidth: 1, borderRadius: 16, paddingHorizontal: spacing[3], paddingVertical: spacing[2], marginRight: spacing[2], marginBottom: spacing[2] },
  unavailableContainer: { alignItems: 'center', justifyContent: 'center', padding: spacing[6] },
  unavailableButton: { minHeight: 44, justifyContent: 'center', borderRadius: 10, paddingHorizontal: spacing[5], marginTop: spacing[4] },
});
