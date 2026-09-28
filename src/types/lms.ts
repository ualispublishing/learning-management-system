/**
 * @fileoverview Shared LMS domain model.
 *
 * Reviewer notes:
 * - Types in this file cross UI, store, repository, import, and test layers.
 * - Keep learner-visible study content separate from assessment answer keys.
 * - Optional fields often reflect privacy-scoped institution data, not missing
 *   demo fixtures.
 */
export type CourseRole = 'teacher' | 'ta' | 'it' | 'student' | 'admin';
export type PresentationMode = 'timeline' | 'sequential' | 'custom';
export type AnswerType = 'multiple_choice' | 'text' | 'dropbox' | 'timed' | 'spectrum' | 'custom_code' | 'page_break';
export type ContentCategory = 'admin' | 'material' | 'coursework';
export type ChatThreadKind = 'discussion' | 'q-and-a' | 'announcements' | 'study-group' | 'office-hours';

export interface RubricCriterion {
  id: string;
  label: string;
  description?: string;
  maxPoints: number;
}

export interface QuizQuestion {
  id: string;
  label: string; // e.g. "Q1", "1.1"
  title?: string; // Optional specific title for the question
  content: string; // Rich text / markdown
  answerType: AnswerType;
  options?: string[]; // For multiple choice
  correctAnswer?: string | string[]; // For auto-grading
  allowMultipleCorrect?: boolean;
  gradingType?: 'points' | 'true_false';
  deduction?: number; // Penalty for incorrect
  textMatchMode?: 'exact' | 'contains'; // Exact is the safe default for auto-grading.
  rubric?: RubricCriterion[];
  customConfig?: {
    language?: string; // For code editor (e.g. javascript, python)
    initialCode?: string;
    testCases?: string; // Teacher's test cases
    min?: number; // Spectrum min
    max?: number; // Spectrum max
    minLabel?: string; // Spectrum min label
    maxLabel?: string; // Spectrum max label
    valueLabels?: Record<string, string>; // Maps numeric values to specific labels
    timerSeconds?: number; // Kahoot-style timer per question
    [key: string]: unknown;
  };
  points?: number; // Default points for the question
}

export interface QuestionResponse {
  questionId: string;
  answer: string | string[] | number | null; // The student's answer
  isCorrect?: boolean; // For auto-grading
  score?: number; // Manual or auto-graded points awarded
  teacherFeedback?: string;
  needsManualGrading?: boolean;
  isManuallyGraded?: boolean;
  rubricScores?: Record<string, number>;
  attachment?: {
    id: string;
    url: string;
    name: string;
    mimeType: string;
    size?: number;
    sha256?: string;
  };
}

/** Learner-visible study content. Unlike assessment answer keys, card backs are intentionally delivered to students. */
export interface CourseStudyCard {
  id: string;
  front: string;
  back: string;
  tags?: string[];
  sourceExcerpt?: string;
  sourceLocation?: string;
  confidence?: number;
  reviewerEdited?: boolean;
  reviewerVerified?: boolean;
}

export interface StudentSubmission {
  id: string;
  /** Stable live-run provenance used for idempotent finalization and audit. */
  liveSessionId?: string;
  studentId: string;
  studentName?: string; // For UI convenience
  groupId?: string; // For group submissions
  contentItemId: string;
  courseId: string;
  submittedAt: number;
  updatedAt?: number;
  revision?: number;
  startedAt?: number;
  attemptNumber?: number;
  timeLimitExpiresAt?: number;
  status: 'draft' | 'submitted' | 'graded' | 'discarded';
  responses: QuestionResponse[];
  totalScore?: number;
  overallFeedback?: string;
  gradedBy?: string;
  gradedAt?: number;
  gradeRevision?: number;
  gradeStatus?: 'draft' | 'released';
  isLate?: boolean;
  deletedAt?: number;
}

/**
 * Durable, principal-owned engagement with one course item. Assessment outcome
 * continues to live in StudentSubmission; this record only covers viewing and
 * explicit completion of learner-visible content.
 */
export interface ContentProgress {
  userId: string;
  courseId: string;
  contentItemId: string;
  firstViewedAt: number;
  lastViewedAt: number;
  completedAt?: number;
  revision: number;
}

/** A teacher-supplied caption resource for institution-hosted course video. */
export interface CourseVideoCaptionTrack {
  /** Authorized HTTPS WebVTT resource. The client does not infer or verify synchronization. */
  url: string;
  /** BCP 47-style language tag, for example `en` or `fr-CA`. */
  language: string;
  /** Learner-facing name, for example `English captions`. */
  label: string;
  format: 'text/vtt';
  isDefault?: boolean;
}

/** An adjacent transcript may be authored inline, linked, or both. */
export interface CourseVideoTranscript {
  text?: string;
  url?: string;
  label?: string;
}

export interface CourseVideoAlternatives {
  captionTracks?: CourseVideoCaptionTrack[];
  transcript?: CourseVideoTranscript;
}

export interface ContentItem {
  id: string;
  courseId: string;
  category: ContentCategory;
  title: string;
  description?: string;
  contentUrl?: string; // For PDFs/Links
  isPopQuiz?: boolean; // Flag for live in-class quizzes
  isPoll?: boolean; // Flag for polls (always ungraded, optionally live)
  
  // Visibility & Scheduling
  releaseDate?: number;
  lockDate?: number;
  availableDate?: string; // Canonical ISO-8601 date-time with an explicit offset.
  displayDate?: string; // Due date-time, canonicalized to ISO-8601.
  presentationSlot: 'past' | 'current' | 'future' | 'scheduled' | 'block-header';
  
  // Grouping & Highlights
  groupIcon?: string; // e.g., "🔴", "⭐️"
  isHighlighted?: boolean;
  
  // Coursework Settings
  isGraded?: boolean;
  gradingCategory?: string; // Must match a course gradingWeights key when graded.
  isParticipationOnly?: boolean;
  workType?: 'individual' | 'group';
  /** Identifies which first-class course group set owns this assignment. */
  groupSetId?: string;
  submissionTarget?: 'in-app' | 'external-link';
  externalUrl?: string;
  
  // Quiz Specifics
  questions?: QuizQuestion[];
  /** First-class flashcards; never encode learner-visible backs as assessment correctAnswer values. */
  studyCards?: CourseStudyCard[];
  /** Teacher-supplied alternatives for an institution-hosted video asset. */
  videoAlternatives?: CourseVideoAlternatives;
  quizConfig?: {
    questionsPerPage: number | 'all';
    maxAttempts: number;
    allowRevisit: boolean;
    timeLimitSeconds?: number;
    enforceTimer?: boolean; // Force submit vs visually flag
  };
  
  createdAt: number;
  deletedAt?: number;
  orderIndex?: number; // Used for custom sorting
  metadata?: Record<string, unknown>; // Namespaced institution extensions.
  
  // Interactive features
}

export interface CourseUser {
  id: string;
  name: string;
  role: CourseRole;
  /** Some roster standards and privacy-scoped directories do not disclose email. */
  email?: string;
  secondaryRoles?: string[]; // e.g. ["Section A", "Group 3"]
  metadata?: Record<string, unknown>; // JSON field for dynamic extensions
}

export interface CourseGroup {
  id: string;
  name: string;
  memberIds: string[];
}

export interface CourseGroupSet {
  id: string;
  name: string;
  groups: CourseGroup[];
}

export interface CourseAnnouncement {
  id: string;
  title: string;
  content: string;
  type: 'info' | 'alert';
  createdAt: number;
}

export interface Course {
  id: string;
  title: string;
  /** IANA zone used by authoring controls; defaults to the institution zone during JSON normalization. */
  timeZone?: string;
  status: 'active' | 'past';
  description: string;
  presentationMode: PresentationMode;
  participantsCount: number;
  materialsCount: number;
  currentGrade?: string;
  staff: CourseUser[];
  announcements: CourseAnnouncement[];
  
  // Settings
  termStart: number;
  termEnd: number;
  gradingWeights: Record<string, number>;
  visibilityTimer: number;
  /** Sections/cohorts remain separate from explicit assignment group sets. */
  groupSets?: CourseGroupSet[];

  hasUpdates?: boolean;
  nextDueDate?: number; // timestamp
  metadata?: Record<string, unknown>; // Namespaced institution extensions.
}

export interface PopQuizState {
  courseworkId: string;
  /** Stable idempotency key for this hosted run. */
  sessionId: string;
  /** Server-authoritative start for this hosted run; retained through question transitions. */
  startedAt: number;
  /** Compare-and-swap version for host-controlled question state. */
  revision: number;
  status: 'waiting' | 'active' | 'ended';
  currentQuestionId: string | null;
  /** Transport/server-authored start time for the currently active question. */
  questionOpenedAt: number | null;
  /** Absolute close time so late joiners do not receive a fresh local timer. */
  questionClosesAt: number | null;
  completedQuestionIds: string[];
  // studentId -> questionId -> answer
  answers: Record<string, Record<string, unknown>>;
}

export interface ChatThread {
  id: string;
  courseId?: string;
  title: string;
  isAnnouncement: boolean; // if true, only teachers can post
  createdAt: number;
  updatedAt?: number;
  scope?: 'course' | 'group' | 'direct';
  groupId?: string;
  groupSetId?: string;
  participantIds?: string[];
  createdBy?: string;
  isLocked?: boolean;
  /** Forum-style context shown above the live conversation. */
  description?: string;
  guidelines?: string;
  kind?: ChatThreadKind;
  /** Optional topic window. Course status remains the authoritative term lifecycle. */
  opensAt?: number;
  closesAt?: number;
  isPinned?: boolean;
  /** Defaults to true except for announcements/locked topics. Staff retain posting rights. */
  allowStudentPosts?: boolean;
  allowReplies?: boolean;
  allowAttachments?: boolean;
  allowMentions?: boolean;
  /** Principal-scoped inbox summary; never use a tenant-wide unread count. */
  unreadCount?: number;
  lastMessagePreview?: string;
  lastMessageAt?: number;
}

export interface ChatMessage {
  id: string;
  /** Content revision used for compare-and-swap edits/deletes; legacy snapshots normalize to 1. */
  revision?: number;
  threadId: string;
  senderId: string;
  senderName: string;
  role: CourseRole;
  text: string;
  timestamp: number;
  readBy: number;
  readByUserIds?: string[];
  mediaUrl?: string;
  mediaType?: 'image' | 'document';
  mediaName?: string;
  replyToMessageId?: string;
  /** Stable institution user IDs referenced by visible @Name tokens. */
  mentionedUserIds?: string[];
  /**
   * Stable provenance for a course announcement. These fields are optional so
   * legacy chat snapshots and ordinary messages remain valid.
   */
  announcementId?: string;
  announcementTitle?: string;
  announcementSeverity?: 'info' | 'alert';
  contentItemId?: string;
  editedAt?: number;
  deletedAt?: number;
}
