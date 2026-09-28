/**
 * @fileoverview Repository contracts for institution-backed LMS data.
 *
 * Reviewer notes:
 * - UI and store layers depend on these interfaces rather than a concrete
 *   database or network client.
 * - Repository implementations own authorization, server timestamps, revision
 *   advancement, idempotency, and principal scoping.
 */
import { Course, CourseRole, CourseUser, ContentItem, ContentProgress, ChatThread, ChatMessage, StudentSubmission, PopQuizState } from '../../types/lms';

export interface User {
  id: string;
  name: string;
  /** Optional because an institution subject identifier, not email, is authoritative. */
  email?: string;
  globalRole: 'admin' | 'user';
}

export interface AuthRepository {
  /** Email is used by demo/account-selection flows; production SSO may omit it. */
  login(email?: string): Promise<{ user: User, defaultRole: CourseRole }>;
  logout(): Promise<void>;
  getCurrentUser(): Promise<User | null>;
}

export interface CourseRepository {
  getCoursesForUser(userId: string): Promise<Course[]>;
  getCourseDetails(courseId: string): Promise<Course | null>;
  getUserRoleForCourse(userId: string, courseId: string): Promise<CourseRole>;
  updateCourse(courseId: string, updates: Partial<Course>): Promise<void>;
  /** Resolves a stable institution user ID first, or a disclosed email as a convenience. */
  addStudentByIdentifier(courseId: string, identifier: string): Promise<CourseUser>;
  updateCourseUser(courseId: string, userId: string, updates: Partial<CourseUser>): Promise<void>;
}

export interface ContentRepository {
  getContentItems(courseId: string): Promise<ContentItem[]>;
  createContentItem(item: ContentItem): Promise<ContentItem>;
  createContentItems(items: ContentItem[]): Promise<ContentItem[]>;
  updateContentItem(itemId: string, updates: Partial<ContentItem>): Promise<void>;
  updateContentItems(changes: { itemId: string; updates: Partial<ContentItem> }[]): Promise<void>;
  /** Atomically changes content grouping labels and every affected item. */
  updateContentGrouping(courseId: string, labels: string[], changes: { itemId: string; updates: Partial<ContentItem> }[]): Promise<void>;
  deleteContentItem(itemId: string, deletedAt: number): Promise<void>;
  restoreContentItem(itemId: string): Promise<void>;
}

export interface SubmissionRepository {
  getSubmissionsForCourses(courseIds: string[]): Promise<StudentSubmission[]>;
  /** Returns the authoritative/sanitized record committed to the repository. */
  upsertSubmission(submission: StudentSubmission): Promise<StudentSubmission>;
}

export interface ContentProgressRepository {
  /** Returns only the authenticated principal's records for authorized courses. */
  getProgressForCourses(courseIds: string[], userId: string): Promise<ContentProgress[]>;
  /** The repository owns timestamps, identity, and revision advancement. */
  markViewed(contentItemId: string, userId: string): Promise<ContentProgress>;
  setCompleted(contentItemId: string, userId: string, completed: boolean): Promise<ContentProgress>;
}

export interface GradebookRepository {
  createExternalGrade(item: ContentItem, submissions: StudentSubmission[]): Promise<void>;
}

export interface ChatMessagePageRequest {
  /** Opaque continuation returned by the previous page. */
  cursor?: string;
  /** Defaults to 50 and may not exceed 100. */
  limit?: number;
  /** Optional server-side search across the authorized conversation. */
  query?: string;
}

export interface ChatMessagePage {
  /** Chronological messages for this page. */
  messages: ChatMessage[];
  hasMore: boolean;
  nextCursor?: string;
}

/** Client-authored fields for a new message. Revision and audit timestamps are repository-owned. */
export type NewChatMessage = Omit<ChatMessage, 'id' | 'timestamp' | 'revision' | 'editedAt' | 'deletedAt'> & {
  /** Stable per-compose attempt; repositories use it as an idempotent create ID. */
  clientMessageId?: string;
};

export interface ChatRepository {
  /** Principal-scoped users the institution permits this user to discover for direct messaging. */
  getDirectoryUsers(userId: string): Promise<CourseUser[]>;
  getThreads(courseId: string, userId?: string): Promise<ChatThread[]>;
  getDirectThreads(userId: string): Promise<ChatThread[]>;
  getMessages(threadId: string, userId: string, request?: ChatMessagePageRequest): Promise<ChatMessagePage>;
  sendMessage(message: NewChatMessage): Promise<ChatMessage>;
  editMessage(messageId: string, userId: string, text: string, expectedRevision: number, mentionedUserIds?: string[]): Promise<ChatMessage>;
  deleteMessage(messageId: string, userId: string, expectedRevision: number): Promise<ChatMessage>;
  reportMessage(messageId: string, userId: string, reason: string): Promise<void>;
  createThread(thread: Omit<ChatThread, 'id' | 'createdAt'>): Promise<ChatThread>;
  markThreadRead(threadId: string, userId: string): Promise<void>;
  subscribeToMessages(threadId: string, userId: string, onMessages: (messages: ChatMessage[]) => void, onError?: (error: Error) => void): () => void;
}

export interface LiveSessionRepository {
  getSession(courseworkId: string): Promise<PopQuizState | null>;
  /** Creates revision 1 or atomically advances the current run by exactly one. */
  publishSession(courseworkId: string, state: PopQuizState): Promise<void>;
  submitAnswer(courseworkId: string, studentId: string, questionId: string, answer: unknown): Promise<void>;
  /**
   * Atomically closes the active run, durably archives its answers as
   * submissions carrying the supplied liveSessionId, and returns the
   * authoritative archived records. Must be idempotent for courseworkId +
   * sessionId so a response lost after commit can be retried safely.
   */
  finalizeSession?(courseworkId: string, sessionId: string): Promise<StudentSubmission[]>;
  subscribeToSession(courseworkId: string, onState: (state: PopQuizState | null) => void, onError?: (error: Error) => void): () => void;
}

export interface RepositoryFactory {
  auth: AuthRepository;
  courses: CourseRepository;
  content: ContentRepository;
  progress: ContentProgressRepository;
  submissions: SubmissionRepository;
  gradebook: GradebookRepository;
  chat: ChatRepository;
  liveSessions: LiveSessionRepository;
}
