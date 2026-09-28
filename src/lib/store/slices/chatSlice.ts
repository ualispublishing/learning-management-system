/**
 * @fileoverview src/lib/store/slices/chatSlice.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import { StateCreator } from 'zustand';
import { ChatMessage, ChatThread, ContentItem, Course, CourseRole, CourseUser } from '../../../types/lms';
import { repoFactory } from '../../repositories/factory';
import { capturePrincipalGeneration, isPrincipalGenerationCurrent } from '../principalGeneration';
import { isSafeHttpsUrl } from '../../safeUrl';
import type { ChatMessagePage, NewChatMessage } from '../../repositories/interfaces';
import {
  formatLinkedAnnouncementMessage,
  getAnnouncementMessagePresentation,
  selectCourseAnnouncementThread,
  selectCourseAnnouncementThreads,
} from '../../chat/announcements';
import { hasCoursePermission } from '../../authorization/coursePermissions';
import { getLearningStateService } from '../../learningState';

export interface ContentAnnouncementSyncInput {
  courseId: string;
  contentItemId: string;
  title: string;
  content?: string;
  active: boolean;
  actorId: string;
  actorName: string;
  actorRole: CourseRole;
}

export interface AnnouncementReconciliationIssue {
  id: string;
  courseId: string;
  contentItemId: string;
  messageId?: string;
  direction: 'chat-to-content' | 'content-to-chat';
  operation: 'update' | 'withdraw';
  attemptedAt: number;
  error: string;
  reconciliationActorId?: string;
  contentSync?: ContentAnnouncementSyncInput;
}

export interface ChatMessagePaginationState {
  initialized: boolean;
  hasMore: boolean;
  nextCursor?: string;
  isLoading: boolean;
  isLoadingOlder: boolean;
}

export interface ChatSlice {
  dismissedAnnouncements: string[];
  dismissAnnouncement: (id: string) => void;

  threads: ChatThread[];
  directThreads: ChatThread[];
  directoryUsers: CourseUser[];
  messages: Record<string, ChatMessage[]>;
  messagePagination: Record<string, ChatMessagePaginationState>;
  chatError: string | null;
  chatErrorSource: string | null;
  announcementReconciliationIssues: Record<string, AnnouncementReconciliationIssue>;

  fetchDirectoryUsers: (userId: string) => Promise<void>;
  fetchThreads: (courseId: string, userId?: string) => Promise<void>;
  fetchDirectThreads: (userId: string) => Promise<void>;
  fetchMessages: (threadId: string, userId: string) => Promise<void>;
  fetchOlderMessages: (threadId: string, userId: string) => Promise<void>;
  searchChatMessages: (threadId: string, userId: string, query: string, cursor?: string) => Promise<ChatMessagePage>;
  sendMessage: (message: NewChatMessage) => Promise<ChatMessage>;
  editChatMessage: (messageId: string, userId: string, text: string, expectedRevision: number, mentionedUserIds?: string[]) => Promise<ChatMessage>;
  deleteChatMessage: (messageId: string, userId: string, expectedRevision: number) => Promise<ChatMessage>;
  syncContentAnnouncementToChat: (input: ContentAnnouncementSyncInput) => Promise<void>;
  retryAnnouncementReconciliation: (issueId: string) => Promise<void>;
  reportChatMessage: (messageId: string, userId: string, reason: string) => Promise<void>;
  createThread: (thread: Omit<ChatThread, 'id' | 'createdAt'>) => Promise<void>;
  createDirectThread: (currentUserId: string, otherUserId: string, otherUserName: string) => Promise<ChatThread>;
  markThreadRead: (threadId: string, userId: string) => Promise<void>;
  subscribeToMessages: (threadId: string, userId: string) => () => void;
  clearChatError: () => void;
}

const errorMessage = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;
const CHAT_ROLES = new Set(['teacher', 'ta', 'it', 'student', 'admin']);
const messagePreview = (message: Pick<ChatMessage, 'text' | 'mediaName'>) =>
  (message.text.trim() || message.mediaName?.trim() || 'Attachment').slice(0, 500);
const sortThreadsByActivity = (threads: ChatThread[]) => [...threads].sort((left, right) =>
  (right.updatedAt ?? right.createdAt) - (left.updatedAt ?? left.createdAt) || left.id.localeCompare(right.id));
const refreshThreadMessageSummary = (threads: ChatThread[], threadId: string, messages: ChatMessage[]): ChatThread[] => {
  const latest = [...messages].filter(message => !message.deletedAt).sort((left, right) => right.timestamp - left.timestamp || right.id.localeCompare(left.id))[0];
  return sortThreadsByActivity(threads.map(thread => thread.id === threadId ? {
    ...thread,
    lastMessageAt: latest?.timestamp,
    lastMessagePreview: latest ? messagePreview(latest) : undefined,
  } : thread));
};
const messageLoadEpochs = new Map<string, number>();
const inFlightMessageLoads = new Map<string, Promise<void>>();
const inFlightAnnouncementReconciliations = new Map<string, Promise<boolean>>();
const announcementReconciliationQueues = new Map<string, Promise<void>>();

type AnnouncementBridgeRootState = ChatSlice & {
  contentItems: ContentItem[];
  currentUserId: string | null;
  courses?: Course[];
};
type AnnouncementBridgeSet = (
  updater: (state: AnnouncementBridgeRootState) => Partial<AnnouncementBridgeRootState>,
) => void;

const chatToContentIssueId = (messageId: string) => `chat-to-content:${messageId}`;
const contentToChatIssueId = (contentItemId: string) => `content-to-chat:${contentItemId}`;
const contentRevision = (message: ChatMessage): number => message.revision ?? 1;

const authoritativeStoredMessage = (
  candidate: ChatMessage,
  root: AnnouncementBridgeRootState,
): ChatMessage | undefined => {
  const stored = root.messages[candidate.threadId]?.find(message => message.id === candidate.id);
  if (!stored
    || stored.threadId !== candidate.threadId
    || stored.senderId !== candidate.senderId
    || stored.timestamp !== candidate.timestamp
    || contentRevision(stored) < contentRevision(candidate)) return undefined;
  return stored;
};

const authorizedLinkedAnnouncementSource = (
  message: ChatMessage,
  root: AnnouncementBridgeRootState,
): { course: Course; item: ContentItem } | undefined => {
  if (!message.contentItemId) return undefined;
  const thread = root.threads.find(candidate => candidate.id === message.threadId);
  const course = thread?.courseId ? root.courses?.find(candidate => candidate.id === thread.courseId) : undefined;
  const item = root.contentItems.find(candidate => candidate.id === message.contentItemId);
  const sourceMembership = course?.staff.find(member => member.id === message.senderId);
  if (!thread?.isAnnouncement
    || !course
    || !item
    || item.courseId !== course.id
    || !sourceMembership
    || !hasCoursePermission(sourceMembership.role, 'postStaffChat')) return undefined;
  return { course, item };
};

const hasLoadedLinkedAnnouncementContext = (
  message: ChatMessage,
  root: AnnouncementBridgeRootState,
): boolean => {
  if (!message.contentItemId) return true;
  const thread = root.threads.find(candidate => candidate.id === message.threadId);
  const course = thread?.courseId ? root.courses?.find(candidate => candidate.id === thread.courseId) : undefined;
  const item = root.contentItems.find(candidate => candidate.id === message.contentItemId);
  return Boolean(thread && course && item);
};

const clearReconciliationIssue = (
  issueId: string,
  set: Parameters<StateCreator<ChatSlice, [], [], ChatSlice>>[0],
) => {
  (set as unknown as AnnouncementBridgeSet)(state => {
    const nextIssues = { ...state.announcementReconciliationIssues };
    delete nextIssues[issueId];
    return {
      announcementReconciliationIssues: nextIssues,
      ...(state.chatErrorSource === `announcement-reconcile:${issueId}`
        ? { chatError: null, chatErrorSource: null }
        : {}),
    };
  });
};

const performLinkedChatMessageToContentReconciliation = async (
  message: ChatMessage,
  generation: number,
  get: () => ChatSlice,
  set: Parameters<StateCreator<ChatSlice, [], [], ChatSlice>>[0],
  reconciliationActorId?: string,
): Promise<boolean> => {
  if (!isPrincipalGenerationCurrent(generation)) return false;
  const initialRoot = get() as AnnouncementBridgeRootState;
  const authoritativeMessage = authoritativeStoredMessage(message, initialRoot);
  const contentItemId = authoritativeMessage?.contentItemId?.trim() || message.contentItemId?.trim();
  if (!contentItemId) return true;
  const root = initialRoot;
  const item = root.contentItems.find(candidate => candidate.id === contentItemId);
  const thread = [...root.threads, ...root.directThreads].find(candidate => candidate.id === (authoritativeMessage?.threadId || message.threadId));
  const courseId = thread?.courseId || item?.courseId || '';
  const issueId = chatToContentIssueId(message.id);
  try {
    if (!authoritativeMessage) throw new Error('The authoritative merged message revision is not loaded for reconciliation.');
    if (!item) throw new Error('The linked course content is not loaded for this account.');
    if (!thread?.isAnnouncement || !thread.courseId || item.courseId !== thread.courseId) {
      throw new Error('The linked message and course content do not share an authorized announcement course.');
    }
    const course = root.courses?.find(candidate => candidate.id === thread.courseId);
    const authorizedIdentity = reconciliationActorId
      ? course?.staff.find(member => member.id === reconciliationActorId && root.currentUserId === reconciliationActorId)
      : course?.staff.find(member => member.id === authoritativeMessage.senderId);
    const requiredPermission = reconciliationActorId ? 'manageContent' : 'postStaffChat';
    if (!authorizedIdentity || !hasCoursePermission(authorizedIdentity.role, requiredPermission)) {
      throw new Error(reconciliationActorId
        ? 'The account applying this Chat change is no longer authorized to manage linked course content.'
        : 'The source identity is not currently authorized to post official course announcements.');
    }
    if (!authoritativeMessage.deletedAt && (item.deletedAt !== undefined || item.metadata?.lmsAnnouncementActive === false)) {
      throw new Error('The linked course content was withdrawn or converted away from an announcement.');
    }
    const presentation = authoritativeMessage.deletedAt === undefined
      ? getAnnouncementMessagePresentation(authoritativeMessage)
      : undefined;
    const lastSyncedRevision = typeof item.metadata?.lmsAnnouncementChatRevision === 'number'
      ? item.metadata.lmsAnnouncementChatRevision
      : 0;
    // Never apply an equal or older message revision over course content that
    // already records that revision. This also preserves a concurrent
    // course-content edit until its forward Chat CAS completes.
    if (lastSyncedRevision >= contentRevision(authoritativeMessage)) {
      clearReconciliationIssue(issueId, set);
      return true;
    }
    const syncTime = Date.now();
    const metadata = {
      ...(item.metadata || {}),
      lmsAnnouncementActive: authoritativeMessage.deletedAt === undefined,
      lmsAnnouncementChatMessageId: authoritativeMessage.id,
      lmsAnnouncementChatRevision: contentRevision(authoritativeMessage),
      lmsAnnouncementLastSyncedAt: syncTime,
      ...(authoritativeMessage.deletedAt !== undefined
        ? { lmsAnnouncementWithdrawnAt: authoritativeMessage.deletedAt }
        : {
            lmsContentType: 'announcement',
            lmsAnnouncementLastEditedAt: authoritativeMessage.editedAt ?? authoritativeMessage.timestamp,
            lmsAnnouncementWithdrawnAt: undefined,
          }),
    };
    const updates: Partial<ContentItem> = presentation
      ? { title: presentation.title, description: presentation.content, metadata }
      : {
          // A direct Chat withdrawal moves an active linked notice into the
          // same recoverable state as deleting it from Course Content. If the
          // item was already converted to ordinary content, only the Chat
          // tombstone metadata is synchronized and that ordinary item remains.
          ...(item.metadata?.lmsAnnouncementActive !== false
            ? { deletedAt: item.deletedAt ?? authoritativeMessage.deletedAt }
            : {}),
          metadata,
        };
    await repoFactory.content.updateContentItem(contentItemId, updates);
    if (!isPrincipalGenerationCurrent(generation)) return false;
    (set as unknown as AnnouncementBridgeSet)(state => {
      const nextIssues = { ...state.announcementReconciliationIssues };
      delete nextIssues[issueId];
      return {
        contentItems: state.contentItems.map(candidate => candidate.id === contentItemId
          ? { ...candidate, ...updates, id: contentItemId }
          : candidate),
        announcementReconciliationIssues: nextIssues,
        ...(state.chatErrorSource === `announcement-reconcile:${issueId}`
          ? { chatError: null, chatErrorSource: null }
          : {}),
      };
    });
    return true;
  } catch (error) {
    if (!isPrincipalGenerationCurrent(generation)) return false;
    const detail = errorMessage(error, 'The linked course content could not be synchronized.');
    (set as unknown as AnnouncementBridgeSet)(state => ({
      announcementReconciliationIssues: {
        ...state.announcementReconciliationIssues,
        [issueId]: {
          id: issueId,
          courseId,
          contentItemId,
          messageId: authoritativeMessage?.id || message.id,
          direction: 'chat-to-content',
          operation: (authoritativeMessage || message).deletedAt === undefined ? 'update' : 'withdraw',
          attemptedAt: Date.now(),
          error: detail,
          reconciliationActorId,
        },
      },
      chatError: `The Chat change was saved, but its linked course content is not synchronized yet. ${detail}`,
      chatErrorSource: `announcement-reconcile:${issueId}`,
    }));
    return false;
  }
};

const reconcileLinkedChatMessageToContent = (
  message: ChatMessage,
  generation: number,
  get: () => ChatSlice,
  set: Parameters<StateCreator<ChatSlice, [], [], ChatSlice>>[0],
  reconciliationActorId?: string,
): Promise<boolean> => {
  const key = `${generation}:${message.id}:${contentRevision(message)}:${message.deletedAt ?? 0}:${reconciliationActorId || 'source'}`;
  const existing = inFlightAnnouncementReconciliations.get(key);
  if (existing) return existing;
  const queueKey = `${generation}:${message.contentItemId || message.id}`;
  const previous = announcementReconciliationQueues.get(queueKey) || Promise.resolve();
  const operation = previous
    .catch(() => undefined)
    .then(() => performLinkedChatMessageToContentReconciliation(message, generation, get, set, reconciliationActorId));
  const queueTail = operation.then(() => undefined, () => undefined);
  announcementReconciliationQueues.set(queueKey, queueTail);
  inFlightAnnouncementReconciliations.set(key, operation);
  void operation.finally(() => {
    if (inFlightAnnouncementReconciliations.get(key) === operation) inFlightAnnouncementReconciliations.delete(key);
    if (announcementReconciliationQueues.get(queueKey) === queueTail) announcementReconciliationQueues.delete(queueKey);
  });
  return operation;
};

const reconcileLoadedAnnouncementForCurrentPrincipal = async (
  message: ChatMessage,
  generation: number,
  get: () => ChatSlice,
  set: Parameters<StateCreator<ChatSlice, [], [], ChatSlice>>[0],
): Promise<void> => {
  const root = get() as AnnouncementBridgeRootState;
  const authoritativeMessage = authoritativeStoredMessage(message, root);
  if (!authoritativeMessage?.contentItemId || !root.currentUserId) return;
  const thread = root.threads.find(candidate => candidate.id === authoritativeMessage.threadId);
  const course = thread?.courseId ? root.courses?.find(candidate => candidate.id === thread.courseId) : undefined;
  const membership = course?.staff.find(member => member.id === root.currentUserId);
  if (!thread?.isAnnouncement || !course || !membership || !hasCoursePermission(membership.role, 'manageContent')) return;
  const authorizedSource = authorizedLinkedAnnouncementSource(authoritativeMessage, root);
  if (!authorizedSource) {
    set({
      chatError: 'A linked announcement event was not used to update Course Content because its source identity is not currently authorized for official announcements.',
      chatErrorSource: `announcement-source:${course.id}:${authoritativeMessage.id}`,
    });
    return;
  }
  const { item } = authorizedSource;
  set(state => state.chatErrorSource === `announcement-source:${course.id}:${authoritativeMessage.id}`
    ? { chatError: null, chatErrorSource: null }
    : {});
  if (!authoritativeMessage.deletedAt && (item.deletedAt !== undefined || item.metadata?.lmsAnnouncementActive === false)) {
    try {
      await get().syncContentAnnouncementToChat({
        courseId: item.courseId,
        contentItemId: item.id,
        title: item.title,
        content: item.description,
        active: false,
        actorId: root.currentUserId,
        actorName: membership.name,
        actorRole: membership.role,
      });
    } catch {
      // The action records an explicit course-to-Chat retry issue.
    }
    return;
  }
  if (authoritativeMessage.editedAt || authoritativeMessage.deletedAt) {
    await reconcileLinkedChatMessageToContent(authoritativeMessage, generation, get, set);
  }
};

export type RealtimeChatValidation =
  | { success: true; messages: ChatMessage[] }
  | { success: false; error: string };

const redactDeletedMessage = (message: ChatMessage): ChatMessage => message.deletedAt === undefined ? message : {
  ...message,
  text: '',
  mediaUrl: undefined,
  mediaType: undefined,
  mediaName: undefined,
  mentionedUserIds: undefined,
  announcementTitle: undefined,
};

/** Runtime boundary for WebSocket/SSE events, which do not pass through snapshot validation. */
export const validateRealtimeChatMessages = (threadId: string, incoming: unknown): RealtimeChatValidation => {
  if (!Array.isArray(incoming)) return { success: false, error: 'The real-time chat service returned a non-array message batch.' };
  if (incoming.length > 1_000) return { success: false, error: 'The real-time chat service returned more than 1,000 messages in one batch.' };
  const messages: ChatMessage[] = [];
  const messageIds = new Set<string>();
  const allowedFields = new Set(['id', 'revision', 'threadId', 'senderId', 'senderName', 'role', 'text', 'timestamp', 'readBy', 'readByUserIds', 'mediaUrl', 'mediaType', 'mediaName', 'replyToMessageId', 'mentionedUserIds', 'announcementId', 'announcementTitle', 'announcementSeverity', 'contentItemId', 'editedAt', 'deletedAt']);
  for (let index = 0; index < incoming.length; index += 1) {
    const candidate = incoming[index];
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return { success: false, error: `Real-time message ${index + 1} is not a JSON object.` };
    }
    const raw = candidate as Record<string, unknown>;
    const unsupportedField = Object.keys(raw).find(field => !allowedFields.has(field));
    if (unsupportedField) return { success: false, error: `Real-time message ${index + 1} contains unsupported field "${unsupportedField}".` };
    if (raw.threadId !== threadId) return { success: false, error: 'The real-time chat service sent a message for a different conversation.' };
    if (typeof raw.id !== 'string' || !raw.id.trim() || raw.id.length > 256 || typeof raw.senderId !== 'string' || !raw.senderId.trim() || raw.senderId.length > 256) {
      return { success: false, error: `Real-time message ${index + 1} is missing its identifier or sender.` };
    }
    if (messageIds.has(raw.id.trim())) return { success: false, error: `Real-time message ${index + 1} duplicates message id "${raw.id.trim()}".` };
    messageIds.add(raw.id.trim());
    if (typeof raw.senderName !== 'string' || !raw.senderName.trim() || raw.senderName.length > 500 || typeof raw.role !== 'string' || !CHAT_ROLES.has(raw.role)) {
      return { success: false, error: `Real-time message ${index + 1} has invalid sender metadata.` };
    }
    if (typeof raw.text !== 'string' || raw.text.length > 20_000) {
      return { success: false, error: `Real-time message ${index + 1} has invalid text.` };
    }
    if (typeof raw.timestamp !== 'number' || !Number.isFinite(raw.timestamp) || raw.timestamp < 0) {
      return { success: false, error: `Real-time message ${index + 1} has an invalid timestamp.` };
    }
    const revision = raw.revision === undefined ? 1 : raw.revision;
    if (!Number.isSafeInteger(revision) || (revision as number) < 1 || ((raw.editedAt !== undefined || raw.deletedAt !== undefined) && (revision as number) < 2)) {
      return { success: false, error: `Real-time message ${index + 1} has an invalid content revision.` };
    }
    if (typeof raw.readBy !== 'number' || !Number.isInteger(raw.readBy) || raw.readBy < 0) {
      return { success: false, error: `Real-time message ${index + 1} has an invalid read count.` };
    }
    if (raw.readByUserIds !== undefined && (!Array.isArray(raw.readByUserIds) || raw.readByUserIds.some(id => typeof id !== 'string' || !id.trim() || id.length > 256))) {
      return { success: false, error: `Real-time message ${index + 1} has invalid read receipts.` };
    }
    const readByUserIds = Array.isArray(raw.readByUserIds) ? Array.from(new Set(raw.readByUserIds as string[])) : undefined;
    if (readByUserIds && raw.readBy !== readByUserIds.length) return { success: false, error: `Real-time message ${index + 1} has a read count that does not match its receipts.` };
    if (raw.mediaUrl !== undefined) {
      if (!isSafeHttpsUrl(raw.mediaUrl) || (raw.mediaType !== 'image' && raw.mediaType !== 'document')) {
        return { success: false, error: `Real-time message ${index + 1} has an unsafe or incomplete attachment.` };
      }
    } else if (raw.mediaType !== undefined || raw.mediaName !== undefined) {
      return { success: false, error: `Real-time message ${index + 1} has attachment metadata without an attachment.` };
    }
    if (!raw.text.trim() && raw.mediaUrl === undefined && raw.deletedAt === undefined) {
      return { success: false, error: `Real-time message ${index + 1} is empty.` };
    }
    if (raw.mediaName !== undefined && (typeof raw.mediaName !== 'string' || raw.mediaName.length > 1_024)) {
      return { success: false, error: `Real-time message ${index + 1} has an invalid attachment name.` };
    }
    if (raw.replyToMessageId !== undefined && (typeof raw.replyToMessageId !== 'string' || !raw.replyToMessageId.trim() || raw.replyToMessageId.length > 256)) {
      return { success: false, error: `Real-time message ${index + 1} has an invalid reply target.` };
    }
    if (raw.mentionedUserIds !== undefined && (!Array.isArray(raw.mentionedUserIds) || raw.mentionedUserIds.some(id => typeof id !== 'string' || !id.trim() || id.length > 256))) {
      return { success: false, error: `Real-time message ${index + 1} has invalid mentions.` };
    }
    const mentionedUserIds = Array.isArray(raw.mentionedUserIds) ? Array.from(new Set(raw.mentionedUserIds as string[])) : undefined;
    for (const field of ['announcementId', 'contentItemId'] as const) {
      if (raw[field] !== undefined && (typeof raw[field] !== 'string' || !raw[field].trim() || raw[field].length > 256 || /[\u0000-\u001f\u007f]/.test(raw[field]))) {
        return { success: false, error: `Real-time message ${index + 1} has an invalid ${field}.` };
      }
    }
    if (raw.announcementTitle !== undefined && (typeof raw.announcementTitle !== 'string' || !raw.announcementTitle.trim() || raw.announcementTitle.length > 500)) {
      return { success: false, error: `Real-time message ${index + 1} has an invalid announcement title.` };
    }
    if (raw.announcementSeverity !== undefined && raw.announcementSeverity !== 'info' && raw.announcementSeverity !== 'alert') {
      return { success: false, error: `Real-time message ${index + 1} has an invalid announcement severity.` };
    }
    for (const field of ['editedAt', 'deletedAt'] as const) {
      if (raw[field] !== undefined && (typeof raw[field] !== 'number' || !Number.isFinite(raw[field]) || raw[field] < raw.timestamp)) {
        return { success: false, error: `Real-time message ${index + 1} has an invalid ${field}.` };
      }
    }
    if (typeof raw.deletedAt === 'number' && typeof raw.editedAt === 'number' && raw.deletedAt < raw.editedAt) {
      return { success: false, error: `Real-time message ${index + 1} has a deletion time before its latest edit.` };
    }
    messages.push({
      ...(raw as unknown as ChatMessage),
      id: raw.id.trim(),
      revision: revision as number,
      senderId: raw.senderId.trim(),
      senderName: raw.senderName.trim(),
      text: raw.text.trim(),
      readByUserIds,
      mentionedUserIds,
      announcementId: typeof raw.announcementId === 'string' ? raw.announcementId.trim() : undefined,
      announcementTitle: typeof raw.announcementTitle === 'string' ? raw.announcementTitle.trim() : undefined,
      announcementSeverity: raw.announcementSeverity === 'info' || raw.announcementSeverity === 'alert' ? raw.announcementSeverity : undefined,
      contentItemId: typeof raw.contentItemId === 'string' ? raw.contentItemId.trim() : undefined,
    });
  }
  return { success: true, messages };
};

export const mergeChatMessages = (current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] => {
  const merged = new Map(current.map(message => [message.id, redactDeletedMessage(message)]));
  incoming.forEach(message => {
    const existing = merged.get(message.id);
    if (!existing) {
      merged.set(message.id, redactDeletedMessage(message));
      return;
    }
    if (existing.threadId !== message.threadId || existing.senderId !== message.senderId || existing.timestamp !== message.timestamp) {
      return;
    }
    const existingRevision = existing.revision ?? 1;
    const incomingRevision = message.revision ?? 1;
    // Read receipts may arrive without a content revision. Content and
    // tombstone fields only move on a strictly newer compare-and-swap revision.
    const content = existing.deletedAt !== undefined && message.deletedAt === undefined
      ? existing
      : incomingRevision > existingRevision ? message : existing;
    const readByUserIds = existing.readByUserIds || message.readByUserIds
      ? Array.from(new Set([...(existing.readByUserIds || []), ...(message.readByUserIds || [])]))
      : undefined;
    const editedAt = existing.editedAt !== undefined || content.editedAt !== undefined
      ? Math.max(existing.editedAt ?? 0, content.editedAt ?? 0)
      : undefined;
    const deletedAt = existing.deletedAt !== undefined || content.deletedAt !== undefined
      ? Math.max(existing.deletedAt ?? 0, content.deletedAt ?? 0)
      : undefined;
    merged.set(message.id, redactDeletedMessage({
      ...content,
      revision: Math.max(existingRevision, incomingRevision),
      editedAt,
      deletedAt,
      readByUserIds,
      readBy: Math.max(existing.readBy, message.readBy, readByUserIds?.length ?? 0),
    }));
  });
  return Array.from(merged.values())
    .sort((left, right) => left.timestamp - right.timestamp || left.id.localeCompare(right.id));
};

export const createChatSlice: StateCreator<ChatSlice, [], [], ChatSlice> = (set, get) => ({
  dismissedAnnouncements: [],
  dismissAnnouncement: (id) => {
    const root = get() as AnnouncementBridgeRootState;
    const nextIds = root.dismissedAnnouncements.includes(id)
      ? root.dismissedAnnouncements
      : [...root.dismissedAnnouncements, id];
    set({ dismissedAnnouncements: nextIds });
    if (!root.currentUserId) return;
    const principalId = root.currentUserId;
    const generation = capturePrincipalGeneration();
    void getLearningStateService().save(
      { principalId },
      'announcement-dismissals',
      { ids: nextIds },
    ).catch(error => {
      const current = get() as AnnouncementBridgeRootState;
      if (isPrincipalGenerationCurrent(generation) && current.currentUserId === principalId) {
        set({
          chatError: errorMessage(error, 'Announcement dismissal could not be saved.'),
          chatErrorSource: 'announcement-dismissal',
        });
      }
    });
  },

  threads: [],
  directThreads: [],
  directoryUsers: [],
  messages: {},
  messagePagination: {},
  chatError: null,
  chatErrorSource: null,
  announcementReconciliationIssues: {},
  clearChatError: () => set({ chatError: null, chatErrorSource: null }),

  fetchDirectoryUsers: async (userId) => {
    const generation = capturePrincipalGeneration();
    try {
      const directoryUsers = await repoFactory.chat.getDirectoryUsers(userId);
      if (isPrincipalGenerationCurrent(generation)) set(state => ({ directoryUsers, ...(state.chatErrorSource === 'directory' ? { chatError: null, chatErrorSource: null } : {}) }));
    } catch (error) {
      if (isPrincipalGenerationCurrent(generation)) set({ chatError: errorMessage(error, 'Unable to load the direct-message directory.'), chatErrorSource: 'directory' });
      throw error;
    }
  },

  fetchThreads: async (courseId, userId) => {
    const generation = capturePrincipalGeneration();
    try {
      const threads = await repoFactory.chat.getThreads(courseId, userId);
      if (isPrincipalGenerationCurrent(generation)) set(state => ({
        threads: [...state.threads.filter(thread => thread.courseId !== courseId), ...threads],
        ...(state.chatErrorSource === `threads:${courseId}` ? { chatError: null, chatErrorSource: null } : {}),
      }));
    } catch (error) {
      if (isPrincipalGenerationCurrent(generation)) set({ chatError: errorMessage(error, 'Unable to load conversations.'), chatErrorSource: `threads:${courseId}` });
      throw error;
    }
  },

  fetchDirectThreads: async (userId) => {
    const generation = capturePrincipalGeneration();
    try {
      const directThreads = await repoFactory.chat.getDirectThreads(userId);
      if (isPrincipalGenerationCurrent(generation)) set(state => ({ directThreads: sortThreadsByActivity(directThreads), ...(state.chatErrorSource === 'direct-threads' ? { chatError: null, chatErrorSource: null } : {}) }));
    } catch (error) {
      if (isPrincipalGenerationCurrent(generation)) set({ chatError: errorMessage(error, 'Unable to load direct messages.'), chatErrorSource: 'direct-threads' });
      throw error;
    }
  },

  fetchMessages: async (threadId, userId) => {
    const generation = capturePrincipalGeneration();
    const loadKey = `${generation}:${threadId}:initial`;
    const existingLoad = inFlightMessageLoads.get(loadKey);
    if (existingLoad) return existingLoad;
    const epoch = (messageLoadEpochs.get(threadId) ?? 0) + 1;
    messageLoadEpochs.set(threadId, epoch);
    set(state => ({
      messagePagination: {
        ...state.messagePagination,
        [threadId]: {
          initialized: state.messagePagination[threadId]?.initialized ?? false,
          hasMore: state.messagePagination[threadId]?.hasMore ?? false,
          nextCursor: state.messagePagination[threadId]?.nextCursor,
          isLoading: true,
          isLoadingOlder: false,
        },
      },
    }));
    const operation = (async () => {
      try {
        const page = await repoFactory.chat.getMessages(threadId, userId, { limit: 50 });
        if (page.hasMore && !page.nextCursor) throw new Error('Message history reported older messages without a continuation cursor.');
        if (isPrincipalGenerationCurrent(generation) && messageLoadEpochs.get(threadId) === epoch) {
          set(state => ({
            // A real-time event may arrive while the page request is in flight.
            // Existing state is merged last so that event cannot be erased by an
            // older snapshot response.
            messages: { ...state.messages, [threadId]: mergeChatMessages(page.messages, state.messages[threadId] || []) },
            messagePagination: {
              ...state.messagePagination,
              [threadId]: { initialized: true, hasMore: page.hasMore, nextCursor: page.nextCursor, isLoading: false, isLoadingOlder: false },
            },
            ...(state.chatErrorSource === `messages:${threadId}` ? { chatError: null, chatErrorSource: null } : {}),
          }));
          for (const message of page.messages) {
            await reconcileLoadedAnnouncementForCurrentPrincipal(message, generation, get, set);
          }
        }
      } catch (error) {
        if (isPrincipalGenerationCurrent(generation) && messageLoadEpochs.get(threadId) === epoch) set(state => ({
          chatError: errorMessage(error, 'Unable to load messages.'),
          chatErrorSource: `messages:${threadId}`,
          messagePagination: {
            ...state.messagePagination,
            [threadId]: {
              initialized: state.messagePagination[threadId]?.initialized ?? false,
              hasMore: state.messagePagination[threadId]?.hasMore ?? false,
              nextCursor: state.messagePagination[threadId]?.nextCursor,
              isLoading: false,
              isLoadingOlder: false,
            },
          },
        }));
        throw error;
      }
    })();
    inFlightMessageLoads.set(loadKey, operation);
    try {
      await operation;
    } finally {
      if (inFlightMessageLoads.get(loadKey) === operation) inFlightMessageLoads.delete(loadKey);
    }
  },

  fetchOlderMessages: async (threadId, userId) => {
    const current = get().messagePagination[threadId];
    if (!current?.initialized) return get().fetchMessages(threadId, userId);
    if (!current.hasMore || !current.nextCursor || current.isLoading || current.isLoadingOlder) return;
    const generation = capturePrincipalGeneration();
    const epoch = messageLoadEpochs.get(threadId) ?? 0;
    const cursor = current.nextCursor;
    const loadKey = `${generation}:${threadId}:older:${cursor}`;
    const existingLoad = inFlightMessageLoads.get(loadKey);
    if (existingLoad) return existingLoad;
    set(state => ({
      messagePagination: {
        ...state.messagePagination,
        [threadId]: { ...state.messagePagination[threadId], isLoadingOlder: true },
      },
    }));
    const operation = (async () => {
      try {
        const page = await repoFactory.chat.getMessages(threadId, userId, { cursor, limit: 50 });
        if (page.hasMore && (!page.nextCursor || page.nextCursor === cursor)) {
          throw new Error('Message history returned a non-advancing continuation cursor.');
        }
        if (isPrincipalGenerationCurrent(generation) && messageLoadEpochs.get(threadId) === epoch) {
          set(state => ({
            messages: { ...state.messages, [threadId]: mergeChatMessages(state.messages[threadId] || [], page.messages) },
            messagePagination: {
              ...state.messagePagination,
              [threadId]: { initialized: true, hasMore: page.hasMore, nextCursor: page.nextCursor, isLoading: false, isLoadingOlder: false },
            },
            ...(state.chatErrorSource === `messages:${threadId}` ? { chatError: null, chatErrorSource: null } : {}),
          }));
          for (const message of page.messages) {
            await reconcileLoadedAnnouncementForCurrentPrincipal(message, generation, get, set);
          }
        }
      } catch (error) {
        if (isPrincipalGenerationCurrent(generation) && messageLoadEpochs.get(threadId) === epoch) set(state => ({
          chatError: errorMessage(error, 'Unable to load older messages.'),
          chatErrorSource: `messages:${threadId}`,
          messagePagination: {
            ...state.messagePagination,
            [threadId]: { ...state.messagePagination[threadId], isLoadingOlder: false },
          },
        }));
        throw error;
      }
    })();
    inFlightMessageLoads.set(loadKey, operation);
    try {
      await operation;
    } finally {
      if (inFlightMessageLoads.get(loadKey) === operation) inFlightMessageLoads.delete(loadKey);
    }
  },

  searchChatMessages: async (threadId, userId, query, cursor) => {
    const generation = capturePrincipalGeneration();
    try {
      const page = await repoFactory.chat.getMessages(threadId, userId, { query, cursor, limit: 50 });
      if (!isPrincipalGenerationCurrent(generation)) throw new Error('The active account changed while chat search was running.');
      if (page.hasMore && (!page.nextCursor || page.nextCursor === cursor)) throw new Error('Chat search returned a non-advancing continuation cursor.');
      set(state => state.chatErrorSource === `search:${threadId}` ? { chatError: null, chatErrorSource: null } : {});
      return page;
    } catch (error) {
      if (isPrincipalGenerationCurrent(generation)) set({ chatError: errorMessage(error, 'Unable to search this conversation.'), chatErrorSource: `search:${threadId}` });
      throw error;
    }
  },

  sendMessage: async (message) => {
    const generation = capturePrincipalGeneration();
    try {
      const newMessage = await repoFactory.chat.sendMessage(message);
      if (isPrincipalGenerationCurrent(generation)) set(state => ({
        messages: {
          ...state.messages,
          // A real-time subscription can deliver the authoritative message
          // before sendMessage resolves, so acknowledgement must be idempotent.
          [newMessage.threadId]: mergeChatMessages(state.messages[newMessage.threadId] || [], [newMessage]),
        },
        directThreads: sortThreadsByActivity(state.directThreads.map(thread => thread.id === newMessage.threadId ? {
          ...thread,
          updatedAt: Math.max(thread.updatedAt ?? 0, newMessage.timestamp),
          lastMessageAt: newMessage.timestamp,
          lastMessagePreview: messagePreview(newMessage),
          unreadCount: 0,
        } : thread)),
        threads: sortThreadsByActivity(state.threads.map(thread => thread.id === newMessage.threadId ? {
          ...thread,
          updatedAt: Math.max(thread.updatedAt ?? 0, newMessage.timestamp),
          lastMessageAt: newMessage.timestamp,
          lastMessagePreview: messagePreview(newMessage),
          unreadCount: 0,
        } : thread)),
        ...(state.chatErrorSource === `send:${newMessage.threadId}` ? { chatError: null, chatErrorSource: null } : {}),
      }));
      return newMessage;
    } catch (error) {
      if (isPrincipalGenerationCurrent(generation)) set({ chatError: errorMessage(error, 'Message could not be sent.'), chatErrorSource: `send:${message.threadId}` });
      throw error;
    }
  },

  editChatMessage: async (messageId, userId, text, expectedRevision, mentionedUserIds) => {
    const generation = capturePrincipalGeneration();
    try {
      const root = get() as AnnouncementBridgeRootState;
      const existing = Object.values(root.messages).flat().find(message => message.id === messageId);
      if (existing?.contentItemId) {
        const linkedItem = root.contentItems.find(item => item.id === existing.contentItemId);
        const linkedThread = root.threads.find(thread => thread.id === existing.threadId);
        if (linkedItem && (linkedItem.deletedAt !== undefined || linkedItem.metadata?.lmsAnnouncementActive === false)) {
          throw new Error('This official announcement was withdrawn or converted in Course Content and can no longer be edited in Chat.');
        }
        if (linkedItem && (!linkedThread?.isAnnouncement || linkedThread.courseId !== linkedItem.courseId)) {
          throw new Error('The official announcement link no longer matches this authorized course.');
        }
      }
      const updated = await repoFactory.chat.editMessage(messageId, userId, text, expectedRevision, mentionedUserIds);
      if (isPrincipalGenerationCurrent(generation)) set(state => {
        const threadMessages = mergeChatMessages(state.messages[updated.threadId] || [], [updated]);
        return {
          messages: { ...state.messages, [updated.threadId]: threadMessages },
          directThreads: refreshThreadMessageSummary(state.directThreads, updated.threadId, threadMessages),
          threads: refreshThreadMessageSummary(state.threads, updated.threadId, threadMessages),
          ...(state.chatErrorSource === `edit:${messageId}` ? { chatError: null, chatErrorSource: null } : {}),
        };
      });
      await reconcileLinkedChatMessageToContent(updated, generation, get, set, userId);
      return updated;
    } catch (error) {
      if (isPrincipalGenerationCurrent(generation)) set({ chatError: errorMessage(error, 'Message could not be edited.'), chatErrorSource: `edit:${messageId}` });
      throw error;
    }
  },

  deleteChatMessage: async (messageId, userId, expectedRevision) => {
    const generation = capturePrincipalGeneration();
    try {
      const deleted = await repoFactory.chat.deleteMessage(messageId, userId, expectedRevision);
      if (isPrincipalGenerationCurrent(generation)) set(state => {
        const threadMessages = mergeChatMessages(state.messages[deleted.threadId] || [], [deleted]);
        return {
          messages: { ...state.messages, [deleted.threadId]: threadMessages },
          directThreads: refreshThreadMessageSummary(state.directThreads, deleted.threadId, threadMessages),
          threads: refreshThreadMessageSummary(state.threads, deleted.threadId, threadMessages),
          ...(state.chatErrorSource === `delete:${messageId}` ? { chatError: null, chatErrorSource: null } : {}),
        };
      });
      await reconcileLinkedChatMessageToContent(deleted, generation, get, set, userId);
      return deleted;
    } catch (error) {
      if (isPrincipalGenerationCurrent(generation)) set({ chatError: errorMessage(error, 'Message could not be deleted.'), chatErrorSource: `delete:${messageId}` });
      throw error;
    }
  },

  syncContentAnnouncementToChat: async (input) => {
    const generation = capturePrincipalGeneration();
    const issueId = contentToChatIssueId(input.contentItemId);
    try {
      const root = get() as AnnouncementBridgeRootState;
      if (!input.actorId || root.currentUserId !== input.actorId) {
        throw new Error('The active account changed before the announcement could be synchronized.');
      }
      const item = root.contentItems.find(candidate => candidate.id === input.contentItemId);
      if (!item || item.courseId !== input.courseId) throw new Error('The linked course content is not available for this account.');
      if (input.active && item.metadata?.lmsAnnouncementRequiresNewIdentity === true) {
        throw new Error('This restored item cannot reuse its permanently tombstoned Chat identity. Create a new Announcement item instead.');
      }
      if (input.active && (item.deletedAt !== undefined || item.metadata?.lmsAnnouncementActive === false)) {
        throw new Error('Withdrawn or converted course content cannot be republished from a stale request.');
      }
      if (!input.active && item.deletedAt === undefined && item.metadata?.lmsAnnouncementActive !== false) {
        throw new Error('Active course content cannot be withdrawn from Chat by a stale request.');
      }
      const thread = selectCourseAnnouncementThread(input.courseId, root.threads);
      if (!thread) throw new Error('This course has no authorized announcement conversation.');
      const text = formatLinkedAnnouncementMessage(input.title, input.content);
      const resolveCanonicalMessage = () => get().sendMessage({
          threadId: thread.id,
          senderId: input.actorId,
          senderName: input.actorName,
          role: input.actorRole,
          text,
          readBy: 0,
          announcementId: input.contentItemId,
          announcementTitle: input.title.trim(),
          announcementSeverity: 'info',
          contentItemId: input.contentItemId,
        });
      if (input.active) {
        const delivered = await resolveCanonicalMessage();
        if (delivered.deletedAt) {
          throw new Error('The canonical linked Chat announcement is withdrawn and cannot be resurrected. Duplicate the course content to publish a new notice.');
        }
        if (delivered.text !== text) {
          await get().editChatMessage(delivered.id, input.actorId, text, delivered.revision ?? 1);
        }
      } else {
        const latestRoot = get() as AnnouncementBridgeRootState;
        const linkedMessages = selectCourseAnnouncementThreads(input.courseId, latestRoot.threads)
          .flatMap(candidate => latestRoot.messages[candidate.id] || [])
          .filter(message => message.contentItemId === input.contentItemId || message.announcementId === input.contentItemId);
        const canonical = linkedMessages.length === 0 ? await resolveCanonicalMessage() : undefined;
        const withdrawalTargets = new Map(
          [...linkedMessages, ...(canonical ? [canonical] : [])].map(message => [message.id, message]),
        );
        for (const target of withdrawalTargets.values()) {
          if (!target.deletedAt) {
            await get().deleteChatMessage(target.id, input.actorId, target.revision ?? 1);
          }
        }
      }
      if (!isPrincipalGenerationCurrent(generation)) return;
      (set as unknown as AnnouncementBridgeSet)(state => {
        const nextIssues = { ...state.announcementReconciliationIssues };
        delete nextIssues[issueId];
        return {
          announcementReconciliationIssues: nextIssues,
          ...(state.chatErrorSource === `announcement-reconcile:${issueId}`
            ? { chatError: null, chatErrorSource: null }
            : {}),
        };
      });
    } catch (error) {
      if (!isPrincipalGenerationCurrent(generation)) throw error;
      const detail = errorMessage(error, 'The Chat announcement could not be synchronized.');
      (set as unknown as AnnouncementBridgeSet)(state => ({
        announcementReconciliationIssues: {
          ...state.announcementReconciliationIssues,
          [issueId]: {
            id: issueId,
            courseId: input.courseId,
            contentItemId: input.contentItemId,
            direction: 'content-to-chat',
            operation: input.active ? 'update' : 'withdraw',
            attemptedAt: Date.now(),
            error: detail,
            contentSync: input,
          },
        },
        chatError: `The course-content change was saved, but Chat is not synchronized yet. ${detail}`,
        chatErrorSource: `announcement-reconcile:${issueId}`,
      }));
      throw error;
    }
  },

  retryAnnouncementReconciliation: async (issueId) => {
    const generation = capturePrincipalGeneration();
    const root = get() as AnnouncementBridgeRootState;
    const issue = root.announcementReconciliationIssues[issueId];
    if (!issue) return;
    if (issue.direction === 'chat-to-content') {
      const message = Object.values(root.messages).flat().find(candidate => candidate.id === issue.messageId);
      if (!message) {
        const detail = 'Reload the authorized announcement conversation before retrying this reconciliation.';
        (set as unknown as AnnouncementBridgeSet)(state => ({
          announcementReconciliationIssues: {
            ...state.announcementReconciliationIssues,
            [issueId]: { ...issue, attemptedAt: Date.now(), error: detail },
          },
          chatError: detail,
          chatErrorSource: `announcement-reconcile:${issueId}`,
        }));
        throw new Error(detail);
      }
      const synchronized = await reconcileLinkedChatMessageToContent(message, generation, get, set, issue.reconciliationActorId);
      if (!synchronized) throw new Error('The linked course content is still not synchronized.');
      return;
    }
    const currentItem = root.contentItems.find(candidate => candidate.id === issue.contentItemId);
    const priorInput = issue.contentSync;
    if (!currentItem || !priorInput) throw new Error('The pending announcement reconciliation no longer has a valid course-content source.');
    if (root.currentUserId !== priorInput.actorId) throw new Error('Return to the account that made this course-content change before retrying it.');
    const itemIsActive = currentItem.deletedAt === undefined && currentItem.metadata?.lmsAnnouncementActive !== false;
    if (itemIsActive !== priorInput.active) {
      (set as unknown as AnnouncementBridgeSet)(state => {
        const nextIssues = { ...state.announcementReconciliationIssues };
        delete nextIssues[issueId];
        return {
          announcementReconciliationIssues: nextIssues,
          ...(state.chatErrorSource === `announcement-reconcile:${issueId}`
            ? { chatError: null, chatErrorSource: null }
            : {}),
        };
      });
      return;
    }
    await get().syncContentAnnouncementToChat({
      ...priorInput,
      title: currentItem.title,
      content: currentItem.description,
    });
  },

  reportChatMessage: async (messageId, userId, reason) => {
    const generation = capturePrincipalGeneration();
    try {
      await repoFactory.chat.reportMessage(messageId, userId, reason);
      if (isPrincipalGenerationCurrent(generation)) set(state => state.chatErrorSource === `report:${messageId}` ? { chatError: null, chatErrorSource: null } : {});
    } catch (error) {
      if (isPrincipalGenerationCurrent(generation)) set({ chatError: errorMessage(error, 'Message report could not be submitted.'), chatErrorSource: `report:${messageId}` });
      throw error;
    }
  },

  createThread: async (thread) => {
    const generation = capturePrincipalGeneration();
    try {
      const newThread = await repoFactory.chat.createThread(thread);
      if (isPrincipalGenerationCurrent(generation)) set(state => ({
        threads: sortThreadsByActivity([...state.threads.filter(existing => existing.id !== newThread.id), newThread]),
        ...(state.chatErrorSource === 'create-thread' ? { chatError: null, chatErrorSource: null } : {}),
      }));
    } catch (error) {
      if (isPrincipalGenerationCurrent(generation)) set({ chatError: errorMessage(error, 'Conversation could not be created.'), chatErrorSource: 'create-thread' });
      throw error;
    }
  },

  createDirectThread: async (currentUserId, otherUserId, otherUserName) => {
    const generation = capturePrincipalGeneration();
    try {
      const thread = await repoFactory.chat.createThread({
        title: otherUserName,
        isAnnouncement: false,
        scope: 'direct',
        participantIds: [currentUserId, otherUserId],
        createdBy: currentUserId,
      });
      if (isPrincipalGenerationCurrent(generation)) set(state => ({
        directThreads: sortThreadsByActivity([...state.directThreads.filter(existing => existing.id !== thread.id), thread]),
        ...(state.chatErrorSource === 'create-direct-thread' ? { chatError: null, chatErrorSource: null } : {}),
      }));
      return thread;
    } catch (error) {
      if (isPrincipalGenerationCurrent(generation)) set({ chatError: errorMessage(error, 'Direct conversation could not be created.'), chatErrorSource: 'create-direct-thread' });
      throw error;
    }
  },

  markThreadRead: async (threadId, userId) => {
    const generation = capturePrincipalGeneration();
    try {
      await repoFactory.chat.markThreadRead(threadId, userId);
      if (isPrincipalGenerationCurrent(generation)) set(state => ({
        messages: {
          ...state.messages,
          [threadId]: (state.messages[threadId] || []).map(message => {
            if (message.deletedAt) return message;
            const readByUserIds = Array.from(new Set([...(message.readByUserIds || []), userId]));
            return { ...message, readByUserIds, readBy: readByUserIds.length };
          }),
        },
        directThreads: state.directThreads.map(thread => thread.id === threadId ? { ...thread, unreadCount: 0 } : thread),
        threads: state.threads.map(thread => thread.id === threadId ? { ...thread, unreadCount: 0 } : thread),
        ...(state.chatErrorSource === `read:${threadId}` ? { chatError: null, chatErrorSource: null } : {}),
      }));
    } catch (error) {
      if (isPrincipalGenerationCurrent(generation)) set({ chatError: errorMessage(error, 'Unable to update message status.'), chatErrorSource: `read:${threadId}` });
      throw error;
    }
  },

  subscribeToMessages: (threadId, userId) => {
    const generation = capturePrincipalGeneration();
    try {
      return repoFactory.chat.subscribeToMessages(
      threadId,
      userId,
      incoming => {
        if (!isPrincipalGenerationCurrent(generation)) return;
        const result = validateRealtimeChatMessages(threadId, incoming);
        if (!result.success) {
          set({ chatError: result.error, chatErrorSource: `realtime:${threadId}` });
          return;
        }
        const rootBeforeMerge = get() as AnnouncementBridgeRootState;
        // Course-role transitions can attach a staff subscription before the
        // refreshed content snapshot arrives. Keep linked events fail-closed,
        // but let the next repository emission retry once their context exists.
        const readyMessages = result.messages.filter(message =>
          hasLoadedLinkedAnnouncementContext(message, rootBeforeMerge));
        const unauthorizedLinkedEvent = readyMessages.find(message =>
          message.contentItemId && !authorizedLinkedAnnouncementSource(message, rootBeforeMerge));
        if (unauthorizedLinkedEvent) {
          const courseId = rootBeforeMerge.threads.find(thread => thread.id === unauthorizedLinkedEvent.threadId)?.courseId;
          set({
            chatError: 'A linked announcement event was rejected because its source identity, course content, or announcement conversation is not currently authorized.',
            chatErrorSource: courseId
              ? `announcement-source:${courseId}:${unauthorizedLinkedEvent.id}`
              : `realtime:${threadId}`,
          });
          return;
        }
        if (!readyMessages.length) return;
        set(state => {
          const currentMessages = state.messages[threadId] || [];
          const existingById = new Map(currentMessages.map(message => [message.id, message]));
          const unreadDelta = readyMessages.filter(message => !message.deletedAt && !existingById.has(message.id)
            && message.senderId !== userId
            && !message.readByUserIds?.includes(userId)).length;
          const removedUnreadDelta = readyMessages.filter(message => {
            if (!message.deletedAt) return false;
            const existing = existingById.get(message.id);
            return Boolean(existing && !existing.deletedAt && existing.senderId !== userId && !existing.readByUserIds?.includes(userId));
          }).length;
          const threadMessages = mergeChatMessages(currentMessages, readyMessages);
          const directThreads = state.directThreads.map(thread => thread.id === threadId ? {
            ...thread,
            unreadCount: Math.max(0, (thread.unreadCount ?? 0) + unreadDelta - removedUnreadDelta),
          } : thread);
          const courseThreads = state.threads.map(thread => thread.id === threadId ? {
            ...thread,
            unreadCount: Math.max(0, (thread.unreadCount ?? 0) + unreadDelta - removedUnreadDelta),
          } : thread);
          return {
            messages: {
              ...state.messages,
              [threadId]: threadMessages,
            },
            directThreads: refreshThreadMessageSummary(directThreads, threadId, threadMessages),
            threads: refreshThreadMessageSummary(courseThreads, threadId, threadMessages),
            ...(state.chatErrorSource === `realtime:${threadId}` ? { chatError: null, chatErrorSource: null } : {}),
          };
        });
        readyMessages.forEach(message => {
          void reconcileLoadedAnnouncementForCurrentPrincipal(message, generation, get, set);
        });
      },
      error => {
        if (isPrincipalGenerationCurrent(generation)) set({ chatError: error.message || 'The real-time chat connection failed.', chatErrorSource: `realtime:${threadId}` });
      },
      );
    } catch (error) {
      if (isPrincipalGenerationCurrent(generation)) set({ chatError: errorMessage(error, 'The real-time chat connection failed.'), chatErrorSource: `realtime:${threadId}` });
      return () => undefined;
    }
  },
});
