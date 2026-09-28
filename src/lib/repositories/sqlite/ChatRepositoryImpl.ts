/**
 * @fileoverview src/lib/repositories/sqlite/ChatRepositoryImpl.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import { ChatRepository } from '../interfaces';
import { ChatMessage, ChatThread, CourseRole, CourseUser } from '../../../types/lms';
import { createEntityId } from '../../id';
import { getGroupFromSet } from '../../groups/courseGroups';
import { demoContentItems, demoCourses, demoMessages, demoThreads, demoUsers } from '../memory/demoData';
import { paginateChatMessages } from '../../chat/pagination';
import type { ChatMessagePageRequest, NewChatMessage } from '../interfaces';
import { canRolePostToThread, messageMentionsAreAuthorized } from '../../chat/threadPolicy';
import { isSafeHttpsUrl } from '../../safeUrl';
import { projectDirectoryForPrincipal } from '../../privacy/principalDirectory';

const cloneThread = (thread: ChatThread): ChatThread => ({
  ...thread,
  participantIds: thread.participantIds ? [...thread.participantIds] : undefined,
});

const cloneMessage = (message: ChatMessage): ChatMessage => ({
  ...message,
  readByUserIds: message.readByUserIds ? [...message.readByUserIds] : undefined,
  mentionedUserIds: message.mentionedUserIds ? [...message.mentionedUserIds] : undefined,
});
const messagePreview = (message: Pick<ChatMessage, 'text' | 'mediaName'>) =>
  (message.text.trim() || message.mediaName?.trim() || 'Attachment').slice(0, 500);

const staffRoles: CourseRole[] = ['teacher', 'ta', 'admin'];
const messageListeners = new Map<string, Set<(messages: ChatMessage[]) => void>>();
export interface DemoMessageReport {
  id: string;
  messageId: string;
  reporterId: string;
  reason: string;
  createdAt: number;
}
export const demoMessageReports: DemoMessageReport[] = [];

const emitMessages = (threadId: string, messages: ChatMessage[]) => {
  messageListeners.get(threadId)?.forEach(listener => listener(messages.map(cloneMessage)));
};

const getMembership = (courseId: string | undefined, userId: string) =>
  courseId
    ? demoCourses.find(course => course.id === courseId)?.staff.find(user => user.id === userId)
    : undefined;

const canAccessThread = (thread: ChatThread, userId: string): boolean => {
  if (thread.scope === 'direct') return !!thread.participantIds?.includes(userId);
  const membership = getMembership(thread.courseId, userId);
  if (!membership) return false;
  if (thread.scope !== 'group') return true;
  return staffRoles.includes(membership.role)
    || thread.participantIds?.includes(userId) === true
    || getGroupFromSet(demoCourses.find(course => course.id === thread.courseId), thread.groupSetId, thread.groupId)?.memberIds.includes(userId) === true;
};

/** In-memory demo repository. Production deployments replace the factory adapter. */
export class DemoChatRepository implements ChatRepository {
  async getDirectoryUsers(userId: string): Promise<CourseUser[]> {
    if (!demoUsers.some(user => user.id === userId)) throw new Error('The current demo user was not found in the directory.');
    const courses = demoCourses.filter(course => course.staff.some(member => member.id === userId));
    const threads = demoThreads.filter(thread => canAccessThread(thread, userId));
    const threadIds = new Set(threads.map(thread => thread.id));
    const messages = demoMessages.filter(message => threadIds.has(message.threadId));
    return projectDirectoryForPrincipal(demoUsers, userId, courses, threads, messages);
  }

  async getThreads(courseId: string, userId?: string): Promise<ChatThread[]> {
    if (!userId) return [];
    return demoThreads
      .filter(thread => thread.courseId === courseId && thread.scope !== 'direct')
      .filter(thread => canAccessThread(thread, userId))
      .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))
      .map(thread => {
        const threadMessages = demoMessages.filter(message => message.threadId === thread.id && !message.deletedAt);
        const lastMessage = [...threadMessages].sort((a, b) => b.timestamp - a.timestamp || b.id.localeCompare(a.id))[0];
        return {
          ...cloneThread(thread),
          unreadCount: threadMessages.filter(message => message.senderId !== userId && !message.readByUserIds?.includes(userId)).length,
          lastMessagePreview: lastMessage ? messagePreview(lastMessage) : undefined,
          lastMessageAt: lastMessage?.timestamp,
        };
      });
  }

  async getDirectThreads(userId: string): Promise<ChatThread[]> {
    if (!userId) return [];
    return demoThreads
      .filter(thread => thread.scope === 'direct' && canAccessThread(thread, userId))
      .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))
      .map(thread => {
        const threadMessages = demoMessages.filter(message => message.threadId === thread.id && !message.deletedAt);
        const lastMessage = threadMessages.sort((a, b) => b.timestamp - a.timestamp)[0];
        return {
          ...cloneThread(thread),
          unreadCount: threadMessages.filter(message => message.senderId !== userId && !message.readByUserIds?.includes(userId)).length,
          lastMessagePreview: lastMessage ? messagePreview(lastMessage) : undefined,
          lastMessageAt: lastMessage?.timestamp,
        };
      });
  }

  async getMessages(threadId: string, userId: string, request?: ChatMessagePageRequest) {
    const thread = demoThreads.find(candidate => candidate.id === threadId);
    if (!thread || !canAccessThread(thread, userId)) throw new Error('Conversation was not found or is not accessible.');
    const page = paginateChatMessages(demoMessages.filter(message => message.threadId === threadId), request);
    return { ...page, messages: page.messages.map(cloneMessage) };
  }

  async sendMessage(message: NewChatMessage): Promise<ChatMessage> {
    const thread = demoThreads.find(candidate => candidate.id === message.threadId);
    if (!thread) throw new Error(`Chat thread "${message.threadId}" was not found.`);
    if (!canAccessThread(thread, message.senderId)) throw new Error('You do not have access to this conversation.');
    const membership = getMembership(thread.courseId, message.senderId);
    const course = thread.courseId ? demoCourses.find(candidate => candidate.id === thread.courseId) : undefined;
    const directoryUser = demoUsers.find(user => user.id === message.senderId);
    if (!directoryUser) throw new Error('Message sender was not found in the demo directory.');
    if (!canRolePostToThread(thread, course, membership?.role ?? directoryUser.role)) throw new Error('This conversation is read-only or outside its active course window.');
    if (!message.text.trim() && !message.mediaUrl) throw new Error('A message or attachment is required.');
    if (message.mediaUrl && !isSafeHttpsUrl(message.mediaUrl)) {
      throw new Error('Attachments must be uploaded to institutional storage before sending.');
    }
    if (message.text.length > 20_000) throw new Error('Messages cannot exceed 20,000 characters.');
    if (message.mediaUrl && message.mediaType !== 'image' && message.mediaType !== 'document') throw new Error('An attachment type is required.');
    if (!message.mediaUrl && (message.mediaType || message.mediaName)) throw new Error('Attachment metadata requires an uploaded attachment.');
    if ((message.mediaName?.length || 0) > 1_024) throw new Error('Attachment names cannot exceed 1,024 characters.');
    if (message.mediaUrl && thread.allowAttachments === false) throw new Error('Attachments are disabled for this conversation.');
    const replyTarget = message.replyToMessageId ? demoMessages.find(candidate => candidate.id === message.replyToMessageId) : undefined;
    if (message.replyToMessageId && (!replyTarget || replyTarget.threadId !== thread.id || replyTarget.deletedAt)) throw new Error('The reply target is not available in this conversation.');
    if (message.replyToMessageId && thread.allowReplies === false) throw new Error('Replies are disabled for this conversation.');
    const mentionedUserIds = Array.from(new Set(message.mentionedUserIds || []));
    if (!messageMentionsAreAuthorized({ text: message.text, mentionedUserIds }, thread, course, demoUsers)) throw new Error('One or more mentioned users are not available in this conversation.');
    const hasAnnouncementMetadata = message.announcementId !== undefined
      || message.announcementTitle !== undefined
      || message.announcementSeverity !== undefined
      || message.contentItemId !== undefined;
    if (hasAnnouncementMetadata && !thread.isAnnouncement) throw new Error('Announcement metadata is only valid in a course announcement conversation.');
    for (const [field, value] of [['announcementId', message.announcementId], ['contentItemId', message.contentItemId]] as const) {
      if (value !== undefined && (!value.trim() || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value))) {
        throw new Error(`${field} must be a valid identifier no longer than 256 characters.`);
      }
    }
    if (message.announcementTitle !== undefined && (!message.announcementTitle.trim() || message.announcementTitle.length > 500)) {
      throw new Error('Announcement titles must contain 1–500 characters.');
    }
    if (message.announcementSeverity !== undefined && message.announcementSeverity !== 'info' && message.announcementSeverity !== 'alert') {
      throw new Error('Announcement severity must be info or alert.');
    }
    if (message.contentItemId) {
      const contentItemId = message.contentItemId.trim();
      const contentItem = demoContentItems.find(candidate => candidate.id === contentItemId);
      if (!contentItem || contentItem.courseId !== thread.courseId) throw new Error('The linked announcement content item must belong to this course.');
    }

    const announcementId = message.announcementId?.trim();
    if (announcementId) {
      const previouslyDelivered = demoMessages.find(candidate =>
        candidate.threadId === thread.id && candidate.announcementId === announcementId,
      );
      if (previouslyDelivered) return cloneMessage(previouslyDelivered);
      if (demoMessages.some(candidate => candidate.id === announcementId)) {
        throw new Error('The announcement delivery identifier conflicts with an existing message.');
      }
    }
    const clientMessageId = message.clientMessageId?.trim();
    if (message.clientMessageId !== undefined && (!clientMessageId || clientMessageId.length > 256 || /[\u0000-\u001f\u007f]/.test(clientMessageId))) {
      throw new Error('The client message identifier is invalid.');
    }
    const stableMessageId = announcementId || clientMessageId;
    if (stableMessageId && !announcementId) {
      const previousAttempt = demoMessages.find(candidate => candidate.id === stableMessageId);
      if (previousAttempt) {
        if (previousAttempt.threadId === thread.id && previousAttempt.senderId === message.senderId) return cloneMessage(previousAttempt);
        throw new Error('The client message identifier conflicts with an existing message.');
      }
    }

    const timestamp = Date.now();
    const { clientMessageId: _clientMessageId, ...persistedInput } = message;
    const newMessage: ChatMessage = {
      ...persistedInput,
      revision: 1,
      senderName: directoryUser.name,
      role: membership?.role ?? directoryUser.role,
      text: message.text.trim(),
      // The bridged content ID is stable across acknowledgement-loss retries.
      id: stableMessageId || createEntityId('msg'),
      timestamp,
      readBy: 1,
      readByUserIds: [message.senderId],
      mentionedUserIds,
      announcementId,
      announcementTitle: message.announcementTitle?.trim(),
      contentItemId: message.contentItemId?.trim(),
    };
    demoMessages.push(newMessage);
    const threadIndex = demoThreads.findIndex(candidate => candidate.id === thread.id);
    demoThreads[threadIndex] = { ...thread, updatedAt: timestamp };
    emitMessages(thread.id, [newMessage]);
    return cloneMessage(newMessage);
  }

  async editMessage(messageId: string, userId: string, text: string, expectedRevision: number, mentionedUserIds?: string[]): Promise<ChatMessage> {
    const messageIndex = demoMessages.findIndex(candidate => candidate.id === messageId);
    const existing = demoMessages[messageIndex];
    const thread = existing ? demoThreads.find(candidate => candidate.id === existing.threadId) : undefined;
    if (!existing || !thread || !canAccessThread(thread, userId)) throw new Error('Message was not found or is not accessible.');
    const course = thread.courseId ? demoCourses.find(candidate => candidate.id === thread.courseId) : undefined;
    const membership = getMembership(thread.courseId, userId);
    const canEditOfficialAnnouncement = Boolean(thread.isAnnouncement && existing.contentItemId && staffRoles.includes(membership?.role || 'student'));
    if (existing.senderId !== userId && !canEditOfficialAnnouncement) throw new Error('Only the original sender can edit this message.');
    if (existing.deletedAt) throw new Error('Deleted messages cannot be edited.');
    const currentRevision = existing.revision ?? 1;
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== currentRevision) {
      throw new Error(`Message revision conflict: expected revision ${currentRevision}. Refresh the conversation and try again.`);
    }
    const normalizedText = text.trim();
    if (!normalizedText && !existing.mediaUrl) throw new Error('A message or attachment is required.');
    if (normalizedText.length > 20_000) throw new Error('Messages cannot exceed 20,000 characters.');
    const normalizedMentions = Array.from(new Set(mentionedUserIds || []));
    const directoryUser = demoUsers.find(user => user.id === userId);
    if (!canRolePostToThread(thread, course, membership?.role ?? directoryUser?.role)) {
      throw new Error('Messages cannot be edited while this conversation is read-only or outside its active course window.');
    }
    if (!messageMentionsAreAuthorized({ text: normalizedText, mentionedUserIds: normalizedMentions }, thread, course, demoUsers)) throw new Error('One or more mentioned users are not available in this conversation.');
    if (normalizedText === existing.text && JSON.stringify(normalizedMentions) === JSON.stringify(existing.mentionedUserIds || [])) return cloneMessage(existing);
    const editedAt = Math.max(Date.now(), (existing.editedAt ?? existing.timestamp) + 1);
    const updated: ChatMessage = { ...existing, text: normalizedText, mentionedUserIds: normalizedMentions, editedAt, revision: currentRevision + 1 };
    demoMessages[messageIndex] = updated;
    emitMessages(thread.id, [updated]);
    return cloneMessage(updated);
  }

  async deleteMessage(messageId: string, userId: string, expectedRevision: number): Promise<ChatMessage> {
    const messageIndex = demoMessages.findIndex(candidate => candidate.id === messageId);
    const existing = demoMessages[messageIndex];
    const thread = existing ? demoThreads.find(candidate => candidate.id === existing.threadId) : undefined;
    if (!existing || !thread || !canAccessThread(thread, userId)) throw new Error('Message was not found or is not accessible.');
    const membership = getMembership(thread.courseId, userId);
    if (existing.senderId !== userId && !staffRoles.includes(membership?.role || 'student')) {
      throw new Error('Only the sender or authorized course staff can delete this message.');
    }
    const currentRevision = existing.revision ?? 1;
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== currentRevision) {
      throw new Error(`Message revision conflict: expected revision ${currentRevision}. Refresh the conversation and try again.`);
    }
    if (existing.deletedAt) return cloneMessage(existing);
    const deletedAt = Math.max(Date.now(), (existing.editedAt ?? existing.timestamp) + 1);
    const updated: ChatMessage = {
      ...existing,
      text: '',
      mediaUrl: undefined,
      mediaType: undefined,
      mediaName: undefined,
      mentionedUserIds: undefined,
      announcementTitle: undefined,
      deletedAt,
      revision: currentRevision + 1,
    };
    demoMessages[messageIndex] = updated;
    emitMessages(thread.id, [updated]);
    return cloneMessage(updated);
  }

  async reportMessage(messageId: string, userId: string, reason: string): Promise<void> {
    const message = demoMessages.find(candidate => candidate.id === messageId);
    const thread = message ? demoThreads.find(candidate => candidate.id === message.threadId) : undefined;
    if (!message || !thread || !canAccessThread(thread, userId) || message.deletedAt) throw new Error('Message was not found or is not accessible.');
    if (message.senderId === userId) throw new Error('You cannot report your own message.');
    const normalizedReason = reason.trim();
    if (normalizedReason.length < 10 || normalizedReason.length > 1_000) throw new Error('A report reason must contain 10–1,000 characters.');
    if (demoMessageReports.some(report => report.messageId === messageId && report.reporterId === userId)) return;
    demoMessageReports.push({ id: createEntityId('chat-report'), messageId, reporterId: userId, reason: normalizedReason, createdAt: Date.now() });
  }

  async createThread(thread: Omit<ChatThread, 'id' | 'createdAt'>): Promise<ChatThread> {
    const title = thread.title.trim();
    if (!title) throw new Error('Conversation title is required.');
    if (!thread.createdBy) throw new Error('Conversation creator is required.');
    const creatorId = thread.createdBy;
    if (thread.scope === 'direct') {
      if (thread.courseId || thread.groupId || thread.groupSetId) throw new Error('Direct conversations cannot carry course-group fields.');
      if (thread.isAnnouncement || thread.isLocked || thread.kind === 'announcements') throw new Error('Direct conversations cannot be announcements or locked topics.');
      const participants = Array.from(new Set([...(thread.participantIds || []), creatorId]));
      if (participants.length !== 2) throw new Error('A direct conversation must contain exactly two participants.');
      if (participants.some(id => !demoUsers.some(user => user.id === id))) throw new Error('A direct-message participant was not found in the demo directory.');
      const existing = demoThreads.find(candidate => candidate.scope === 'direct' && candidate.participantIds?.length === 2 && participants.every(id => candidate.participantIds?.includes(id)));
      if (existing) return cloneThread(existing);
      thread = { ...thread, participantIds: participants };
    } else if (!thread.courseId || !getMembership(thread.courseId, creatorId)) {
      throw new Error('Conversation creator must be enrolled in the course.');
    }

    const course = thread.courseId ? demoCourses.find(candidate => candidate.id === thread.courseId) : undefined;
    if (thread.scope !== 'direct' && (!course || course.status !== 'active' || Date.now() >= course.termEnd)) {
      throw new Error('Archived courses cannot receive new conversations.');
    }

    if (thread.scope !== 'direct' && !staffRoles.includes(getMembership(thread.courseId, creatorId)?.role || 'student')) {
      throw new Error('Only authorized course staff can create course conversations.');
    }

    if (thread.scope === 'course' && (thread.groupId || thread.groupSetId)) throw new Error('Course conversations cannot carry group fields.');
    if (thread.scope === 'course' && thread.participantIds?.some(userId => !course?.staff.some(member => member.id === userId))) {
      throw new Error('A conversation participant is not enrolled in the course.');
    }
    if (thread.scope === 'group') {
      const group = getGroupFromSet(course, thread.groupSetId, thread.groupId);
      const creator = getMembership(thread.courseId, creatorId);
      if (!group) throw new Error('The selected course group could not be resolved.');
      if (!staffRoles.includes(creator?.role || 'student') && !group.memberIds.includes(creatorId)) {
        throw new Error('Conversation creator is not a member of the selected group.');
      }
      if (thread.participantIds?.some(userId => {
        const participant = course?.staff.find(member => member.id === userId);
        return !participant || (!staffRoles.includes(participant.role) && !group.memberIds.includes(userId));
      })) {
        throw new Error('A group-conversation participant is not staff or a member of the selected group.');
      }
      thread = {
        ...thread,
        groupSetId: thread.groupSetId || course?.groupSets?.find(groupSet => groupSet.groups.some(candidate => candidate.id === group.id))?.id,
      };
    }

    if (title.length > 500) throw new Error('Conversation titles cannot exceed 500 characters.');
    if ((thread.description?.length || 0) > 4_000 || (thread.guidelines?.length || 0) > 4_000) throw new Error('Conversation descriptions and guidelines cannot exceed 4,000 characters.');
    if (thread.opensAt !== undefined && thread.closesAt !== undefined && thread.opensAt >= thread.closesAt) throw new Error('Conversation close time must be after its open time.');
    if (thread.kind === 'announcements') thread = { ...thread, isAnnouncement: true, allowStudentPosts: false };

    const createdAt = Date.now();
    const newThread: ChatThread = {
      ...thread,
      title,
      id: createEntityId('thread'),
      createdAt,
      updatedAt: createdAt,
      scope: thread.scope || 'course',
    };
    demoThreads.push(newThread);
    return cloneThread(newThread);
  }

  async markThreadRead(threadId: string, userId: string): Promise<void> {
    if (!demoThreads.some(thread => thread.id === threadId && canAccessThread(thread, userId))) {
      throw new Error('Conversation was not found or is not accessible.');
    }
    demoMessages.forEach((message, index) => {
      if (message.threadId !== threadId || message.deletedAt) return;
      const readers = Array.from(new Set([...(message.readByUserIds || []), userId]));
      demoMessages[index] = { ...message, readByUserIds: readers, readBy: readers.length };
    });
  }

  subscribeToMessages(threadId: string, userId: string, onMessages: (messages: ChatMessage[]) => void): () => void {
    const thread = demoThreads.find(candidate => candidate.id === threadId);
    if (!thread || !canAccessThread(thread, userId)) throw new Error('Conversation was not found or is not accessible.');
    const listeners = messageListeners.get(threadId) ?? new Set();
    listeners.add(onMessages);
    messageListeners.set(threadId, listeners);
    return () => {
      listeners.delete(onMessages);
      if (!listeners.size) messageListeners.delete(threadId);
    };
  }
}
