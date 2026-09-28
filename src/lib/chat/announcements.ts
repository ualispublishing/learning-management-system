/**
 * @fileoverview src/lib/chat/announcements.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import type { ChatMessage, ChatThread, ContentItem, Course, CourseAnnouncement, CourseRole } from '../../types/lms';

export interface CoursePopupAnnouncement {
  /** Course-scoped key used by the dismissal store. */
  dismissalId: string;
  /** Includes legacy raw IDs so an already-dismissed legacy item stays dismissed. */
  dismissalAliases: string[];
  title: string;
  content: string;
  type: 'info' | 'alert';
  /** Original publication time retained for audit and display. */
  createdAt: number;
  /** Recency used for ordering; an authoritative edit may be newer than publication. */
  activityAt: number;
  source: 'legacy' | 'chat';
  threadId?: string;
  threadTitle?: string;
  messageId?: string;
  contentItemId?: string;
}

export interface CourseAnnouncementChatRoute {
  pathname: '/chat';
  params: {
    courseId: string;
    chatId?: string;
    chatName?: string;
    messageId?: string;
  };
}

interface PopupCandidate extends CoursePopupAnnouncement {
  stableKeys: string[];
  fingerprint: string;
}

export type CourseAnnouncementActivitySource = 'course-record' | 'chat' | 'linked-content';
export type CourseAnnouncementActivityStatus = 'legacy-only' | 'published' | 'edited' | 'synced';

export interface CourseAnnouncementActivityEntry extends CoursePopupAnnouncement {
  activitySource: CourseAnnouncementActivitySource;
  activityStatus: CourseAnnouncementActivityStatus;
}

const boundedTrim = (value: string | undefined, limit: number): string | undefined => {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, limit) : undefined;
};

const normalizeForDedupe = (value: string): string => value
  .normalize('NFKC')
  .trim()
  .replace(/\s+/g, ' ')
  .toLocaleLowerCase();

const stripAnnouncementMarker = (value: string): string => value.replace(/^📢\s*/u, '').trim();

export const formatLinkedAnnouncementMessage = (title: string, content?: string): string => {
  const normalizedTitle = title.trim();
  const normalizedContent = content?.trim();
  return `📢 ${normalizedTitle}${normalizedContent ? `\n\n${normalizedContent}` : ''}`;
};

/**
 * A Chat tombstone is permanent under the current canonical message identity.
 * Restoring its course item therefore produces ordinary editable content, not
 * a live announcement that falsely appears synchronized or can be resurrected.
 */
export const restoreWithdrawnAnnouncementAsContent = (
  item: ContentItem,
  restoredAt: number,
): Partial<ContentItem> => ({
  deletedAt: undefined,
  metadata: {
    ...(item.metadata || {}),
    lmsContentType: 'title_link',
    lmsAnnouncementActive: false,
    lmsAnnouncementRestoredAsContentAt: restoredAt,
    lmsAnnouncementRequiresNewIdentity: true,
  },
});

/**
 * Selects every announcement conversation from an already-authorized thread
 * result. Authorization remains the repository's responsibility; callers must
 * never pass an unscoped institution-wide thread collection to this helper.
 */
export const selectCourseAnnouncementThreads = (courseId: string, threads: ChatThread[]): ChatThread[] =>
  threads
    .filter(thread => thread.courseId === courseId && thread.isAnnouncement)
    .sort((left, right) =>
      Number(right.kind === 'announcements') - Number(left.kind === 'announcements')
      || Number(Boolean(right.isPinned)) - Number(Boolean(left.isPinned))
      || left.createdAt - right.createdAt
      || left.id.localeCompare(right.id));

/** Stable target for admin-to-chat delivery when legacy data has duplicates. */
export const selectCourseAnnouncementThread = (courseId: string, threads: ChatThread[]): ChatThread | undefined =>
  selectCourseAnnouncementThreads(courseId, threads)[0];

/** Exact route payload shared by learner popups and staff activity actions. */
export const buildCourseAnnouncementChatRoute = (
  courseId: string,
  announcement: Pick<CoursePopupAnnouncement, 'threadTitle' | 'messageId'>,
  thread?: Pick<ChatThread, 'id' | 'title'>,
): CourseAnnouncementChatRoute => ({
  pathname: '/chat',
  params: thread
    ? {
        courseId,
        chatId: thread.id,
        chatName: announcement.threadTitle || thread.title,
        ...(announcement.messageId ? { messageId: announcement.messageId } : {}),
      }
    : { courseId },
});

/** Course administration announcement activity is intentionally staff-only. */
export const canViewCourseAnnouncementActivity = (role: CourseRole | null | undefined): boolean =>
  role === 'teacher' || role === 'ta' || role === 'it' || role === 'admin';

export const getAnnouncementMessagePresentation = (message: ChatMessage): { title: string; content: string } => {
  const text = message.text.trim();
  const lines = text.split(/\r?\n/);
  const firstLine = stripAnnouncementMarker(lines[0] || '');
  const remainingText = lines.slice(1).join('\n').trim();
  const explicitTitle = boundedTrim(message.announcementTitle, 500);
  const markerTitle = text.startsWith('📢') && firstLine ? firstLine.slice(0, 500) : undefined;
  // The visible marker is editable under message CAS. Prefer it so an official
  // admin edit is reflected immediately even when provenance metadata retains
  // the original title for migration compatibility.
  const title = markerTitle || explicitTitle || `Announcement from ${message.senderName}`.slice(0, 500);
  const firstLineMatchesTitle = normalizeForDedupe(firstLine) === normalizeForDedupe(title);
  const content = remainingText && (firstLineMatchesTitle || text.startsWith('📢'))
    ? remainingText
    : text || message.mediaName?.trim() || 'Attachment';
  return { title, content };
};

const fingerprintFor = (title: string, content: string): string =>
  `${normalizeForDedupe(title)}\u0000${normalizeForDedupe(content)}`;

/**
 * Merges the legacy course announcement array with messages already loaded for
 * every announcement thread. Stable metadata handles retries and migrations;
 * a cross-source text fingerprint catches legacy records that predate that
 * metadata without collapsing two intentional chat posts with identical text.
 */
export const deriveCoursePopupAnnouncements = (
  courseId: string,
  legacyAnnouncements: CourseAnnouncement[],
  threads: ChatThread[],
  messagesByThread: Record<string, ChatMessage[]>,
): CoursePopupAnnouncement[] => {
  const announcementThreads = threads.filter(thread => thread.courseId === courseId && thread.isAnnouncement);
  const deletedLegacyIds = new Set(announcementThreads.flatMap(thread =>
    (messagesByThread[thread.id] || []).flatMap(message => message.deletedAt === undefined
      ? []
      : [message.announcementId, message.contentItemId].flatMap(value => {
          const normalized = boundedTrim(value, 256);
          return normalized ? [normalized] : [];
        })),
  ));
  const candidates: PopupCandidate[] = legacyAnnouncements
    .filter(announcement => !deletedLegacyIds.has(announcement.id))
    .map(announcement => {
      const stableKey = `announcement:${announcement.id}`;
      return {
        dismissalId: `${courseId}:${stableKey}`,
        dismissalAliases: [`${courseId}:${stableKey}`, announcement.id],
        stableKeys: [stableKey],
        fingerprint: fingerprintFor(announcement.title, announcement.content),
        title: announcement.title,
        content: announcement.content,
        type: announcement.type,
        createdAt: announcement.createdAt,
        activityAt: announcement.createdAt,
        source: 'legacy',
      };
    });

  announcementThreads.forEach(thread => {
    (messagesByThread[thread.id] || []).forEach(message => {
        if (message.deletedAt) return;
        const { title, content } = getAnnouncementMessagePresentation(message);
        const announcementId = boundedTrim(message.announcementId, 256);
        const contentItemId = boundedTrim(message.contentItemId, 256);
        const stableKeys = [
          ...(announcementId ? [`announcement:${announcementId}`] : []),
          ...(contentItemId ? [`content:${contentItemId}`] : []),
          `message:${message.id}`,
        ];
        candidates.push({
          dismissalId: `${courseId}:${stableKeys[0]}`,
          dismissalAliases: stableKeys.map(key => `${courseId}:${key}`),
          stableKeys,
          fingerprint: fingerprintFor(title, content),
          title,
          content,
          type: message.announcementSeverity === 'alert' ? 'alert' : 'info',
          createdAt: message.timestamp,
          activityAt: Math.max(message.timestamp, message.editedAt ?? message.timestamp),
          source: 'chat',
          threadId: thread.id,
          threadTitle: thread.title,
          messageId: message.id,
          contentItemId,
        });
      });
    });

  candidates.sort((left, right) =>
    right.activityAt - left.activityAt
    || right.createdAt - left.createdAt
    || (left.source === right.source ? 0 : left.source === 'chat' ? -1 : 1)
    || left.dismissalId.localeCompare(right.dismissalId));

  const merged: PopupCandidate[] = [];
  const stableKeyOwners = new Map<string, number>();
  const fingerprintOwners = new Map<string, number[]>();
  candidates.forEach(candidate => {
    let duplicateIndex = candidate.stableKeys
      .map(key => stableKeyOwners.get(key))
      .find((index): index is number => index !== undefined);
    if (duplicateIndex === undefined) {
      duplicateIndex = fingerprintOwners.get(candidate.fingerprint)
        ?.find(index => merged[index].source !== candidate.source);
    }
    if (duplicateIndex !== undefined) {
      const existing = merged[duplicateIndex];
      existing.dismissalAliases = Array.from(new Set([...existing.dismissalAliases, ...candidate.dismissalAliases]));
      // A linked, revisioned Chat edit is authoritative presentation state.
      // A migrated legacy record can carry a later synthetic creation time,
      // but it must not overwrite the title/body that staff deliberately
      // corrected under Chat compare-and-swap semantics.
      if (existing.source === 'legacy' && candidate.source === 'chat' && candidate.activityAt > candidate.createdAt) {
        Object.assign(existing, {
          title: candidate.title,
          content: candidate.content,
          type: candidate.type,
          createdAt: candidate.createdAt,
          activityAt: candidate.activityAt,
          source: candidate.source,
          threadId: candidate.threadId,
          threadTitle: candidate.threadTitle,
          messageId: candidate.messageId,
          contentItemId: candidate.contentItemId,
        });
      }
      // Keep the newest presentation fields, but retain an exact chat target
      // when the duplicate legacy record happened to carry a later timestamp.
      if (!existing.messageId && candidate.messageId) {
        existing.threadId = candidate.threadId;
        existing.threadTitle = candidate.threadTitle;
        existing.messageId = candidate.messageId;
        existing.contentItemId ||= candidate.contentItemId;
      }
      candidate.stableKeys.forEach(key => stableKeyOwners.set(key, duplicateIndex!));
      return;
    }
    const index = merged.length;
    merged.push(candidate);
    candidate.stableKeys.forEach(key => stableKeyOwners.set(key, index));
    fingerprintOwners.set(candidate.fingerprint, [...(fingerprintOwners.get(candidate.fingerprint) || []), index]);
  });

  return merged.map(({ stableKeys: _stableKeys, fingerprint: _fingerprint, ...announcement }) => announcement);
};

/**
 * Staff administration view of the same announcement bridge used by learner
 * popups. Tombstones and inactive linked content are removed before activity
 * labels are derived, so this surface cannot resurrect a withdrawn notice.
 */
export const selectCourseAnnouncementActivity = (
  courseId: string,
  legacyAnnouncements: CourseAnnouncement[],
  authorizedThreads: ChatThread[],
  messagesByThread: Record<string, ChatMessage[]>,
  hiddenContentItemIds: string[] = [],
): CourseAnnouncementActivityEntry[] => {
  const hiddenContent = new Set(hiddenContentItemIds);
  return deriveCoursePopupAnnouncements(courseId, legacyAnnouncements, authorizedThreads, messagesByThread)
    .filter(announcement => !announcement.contentItemId || !hiddenContent.has(announcement.contentItemId))
    .map(announcement => {
      const message = announcement.messageId && announcement.threadId
        ? (messagesByThread[announcement.threadId] || []).find(candidate => candidate.id === announcement.messageId)
        : undefined;
      const activitySource: CourseAnnouncementActivitySource = announcement.contentItemId
        ? 'linked-content'
        : announcement.messageId
          ? 'chat'
          : 'course-record';
      const activityStatus: CourseAnnouncementActivityStatus = announcement.contentItemId && announcement.messageId
        ? 'synced'
        : message?.editedAt !== undefined
          ? 'edited'
          : announcement.messageId
            ? 'published'
            : 'legacy-only';
      return { ...announcement, activitySource, activityStatus };
    });
};

/** Elects one popup across all mounted course bridges so notices never stack. */
export const selectNewestVisibleCoursePopupAnnouncement = (
  courses: (Pick<Course, 'id' | 'status' | 'announcements'> & Partial<Pick<Course, 'termEnd'>>)[],
  threads: ChatThread[],
  messagesByThread: Record<string, ChatMessage[]>,
  dismissedIds: string[],
  hiddenContentItemIds: string[] = [],
  now: number = Date.now(),
): { courseId: string; announcement: CoursePopupAnnouncement } | undefined => courses
  .filter(course => course.status === 'active' && (course.termEnd === undefined || now < course.termEnd))
  .flatMap(course => deriveCoursePopupAnnouncements(
    course.id,
    course.announcements || [],
    threads,
    messagesByThread,
  ).map(announcement => ({ courseId: course.id, announcement })))
  .filter(({ announcement }) => !announcement.contentItemId || !hiddenContentItemIds.includes(announcement.contentItemId))
  .filter(({ announcement }) => !announcement.dismissalAliases.some(alias => dismissedIds.includes(alias)))
  .sort((left, right) => right.announcement.activityAt - left.announcement.activityAt
    || right.announcement.createdAt - left.announcement.createdAt
    || left.courseId.localeCompare(right.courseId))[0];
