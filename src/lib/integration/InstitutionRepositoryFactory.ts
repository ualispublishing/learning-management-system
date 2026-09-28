/**
 * @fileoverview src/lib/integration/InstitutionRepositoryFactory.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import { ChatMessage, ChatThread, ContentProgress, Course, CourseUser, PopQuizState, StudentSubmission } from '../../types/lms';
import { getAttemptEligibility } from '../assessment/engine';
import { createEntityId } from '../id';
import { validateLiveAnswer, validatePopQuizState } from '../liveSessions/validation';
import { getGroupFromSet, normalizeContentGroupLabels, userBelongsToSubmissionGroup } from '../groups/courseGroups';
import { configureRepositoryFactory } from '../repositories/factory';
import { ChatMessagePageRequest, LiveSessionRepository, RepositoryFactory, User } from '../repositories/interfaces';
import {
  formatValidationIssues,
  InstitutionIntegrationCapability,
  mergeNormalizedInstitutionSync,
  NormalizedInstitutionSync,
  validateCourseImport,
  validateDirectoryUser,
  validateInstitutionSync,
} from '../schema/CourseSchema';
import { InstitutionAdapter, PushMutation, SyncCursor } from './InstitutionAdapter';
import { COURSE_PERMISSION_ROLES, hasCoursePermission } from '../authorization/coursePermissions';
import {
  getAssignableCourseRoles,
  LAST_COURSE_MANAGER_ERROR,
  wouldRemoveLastCourseManager,
} from '../authorization/courseRoleManagement';
import { cacheInstitutionJSON } from './institutionSync';
import { normalizeChatMessagePageRequest, paginateChatMessages, validateChatMessagePageEnvelope } from '../chat/pagination';
import { canRolePostToThread, messageMentionsAreAuthorized } from '../chat/threadPolicy';
import { isSafeHttpsUrl } from '../safeUrl';
import { isContentLockedAt } from '../contentAvailability';
import { isCourseInSessionAt, isCourseOpenAt } from '../courseLifecycle';
import {
  principalDirectoryUserIds,
  projectCourseForPrincipal,
  projectDirectoryForPrincipal,
  toDiscoverableUser,
  toPrivateRosterUser,
} from '../privacy/principalDirectory';

export interface InstitutionRepositoryOptions {
  adapter: InstitutionAdapter;
  getSessionUser: () => Promise<User | null>;
  /** Starts or resumes the institution-owned OIDC/SAML sign-in flow. */
  login?: () => Promise<void>;
  logout?: () => Promise<void>;
  initialSnapshot?: unknown;
  snapshotTtlMs?: number;
  /** Optional authenticated, principal-scoped history/search endpoint for conversations too large for a sync snapshot. */
  loadMessagePage?: (threadId: string, request: Required<Pick<ChatMessagePageRequest, 'limit'>> & Omit<ChatMessagePageRequest, 'limit'>) => Promise<unknown>;
  /** Authenticated exact lookup used for enrollment without downloading a tenant directory. */
  lookupDirectoryUser?: (identifier: string) => Promise<unknown>;
  /** WebSocket/SSE bridge supplied by the institution's authenticated client. */
  subscribeToMessages?: (threadId: string, onMessages: (messages: ChatMessage[]) => void, onError?: (error: Error) => void) => () => void;
  /** Required to enable cross-device live quizzes and polls. */
  liveSessions?: LiveSessionRepository;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const clonePatch = <T extends object>(value: T): T => Object.fromEntries(
  Object.entries(value).map(([key, fieldValue]) => [key, fieldValue === undefined ? undefined : clone(fieldValue)]),
) as T;

// JSON omits `undefined`, which would silently turn a requested field clear
// into a no-op. Optional fields are explicitly sent as null on mutations.
const mutationPayload = (updates: object): Record<string, unknown> => Object.fromEntries(
  Object.entries(updates).map(([key, value]) => [key, value === undefined ? null : value]),
);

const mergeById = <T extends { id: string }>(existing: T[], incoming: T[]) =>
  Array.from(new Map([...existing, ...incoming].map(entry => [entry.id, entry])).values());
const messagePreview = (message: Pick<ChatMessage, 'text' | 'mediaName'>) =>
  (message.text.trim() || message.mediaName?.trim() || 'Attachment').slice(0, 500);

/** Learner-authored attempt evidence is immutable once staff can grade it. */
const canonicalAuditTime = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

const attemptEvidenceFingerprint = (submission: StudentSubmission): string => JSON.stringify({
  studentName: submission.studentName,
  submittedAt: canonicalAuditTime(submission.submittedAt),
  startedAt: canonicalAuditTime(submission.startedAt),
  attemptNumber: submission.attemptNumber,
  timeLimitExpiresAt: canonicalAuditTime(submission.timeLimitExpiresAt),
  isLate: submission.isLate === true,
  responses: submission.responses.map(response => ({
    questionId: response.questionId,
    answer: response.answer,
    attachment: response.attachment,
  })),
});

class InstitutionDataClient {
  private data: NormalizedInstitutionSync | null = null;
  private loadPromise: Promise<NormalizedInstitutionSync> | null = null;
  private mutationQueue: Promise<void> = Promise.resolve();
  private stateMutationQueue: Promise<void> = Promise.resolve();
  private loadedAt = 0;
  private initialSnapshotConsumed = false;
  private cursor: SyncCursor = {};
  private principalId: string | null = null;
  private loadEpoch = 0;

  constructor(private readonly options: InstitutionRepositoryOptions) {}

  /** Serializes validation, transport acknowledgement, and cache commit as one client transaction. */
  async runExclusiveMutation<T>(operation: () => Promise<T>): Promise<T> {
    const queued = this.stateMutationQueue.then(async () => {
      const result = await operation();
      await this.persistSnapshot();
      return result;
    });
    this.stateMutationQueue = queued.then(() => undefined, () => undefined);
    return queued;
  }

  private async persistSnapshot(): Promise<void> {
    if (!this.data || !this.principalId) return;
    const sessionUser = await this.options.getSessionUser();
    if (!sessionUser || sessionUser.id !== this.principalId) return;
    await cacheInstitutionJSON(sessionUser.id, this.data);
  }

  async getData(): Promise<NormalizedInstitutionSync> {
    const sessionUser = await this.options.getSessionUser();
    if (!sessionUser) throw new Error('Institution SSO session is required before loading LMS data.');
    if (this.principalId && this.principalId !== sessionUser.id) {
      this.data = null;
      this.loadedAt = 0;
      this.cursor = {};
      this.loadPromise = null;
      this.loadEpoch += 1;
    }
    this.principalId = sessionUser.id;
    const ttl = Math.max(0, this.options.snapshotTtlMs ?? 60_000);
    if (this.data && Date.now() - this.loadedAt < ttl) return this.data;
    if (!this.loadPromise) this.loadPromise = this.load(sessionUser, this.loadEpoch);
    const activeLoad = this.loadPromise;
    try {
      const data = await activeLoad;
      const latestSession = await this.options.getSessionUser();
      if (this.principalId !== sessionUser.id || latestSession?.id !== sessionUser.id) {
        throw new Error('The authenticated session changed while institution data was loading.');
      }
      return data;
    } finally {
      if (this.loadPromise === activeLoad) this.loadPromise = null;
    }
  }

  private async load(sessionUser: User, requestEpoch: number): Promise<NormalizedInstitutionSync> {
    const useInitial = !this.initialSnapshotConsumed && this.options.initialSnapshot !== undefined;
    const payload = useInitial ? this.options.initialSnapshot : await this.options.adapter.pullSnapshot(this.cursor);
    this.initialSnapshotConsumed = true;
    if (requestEpoch !== this.loadEpoch || this.principalId !== sessionUser.id) {
      throw new Error('The authenticated session changed while institution data was loading.');
    }
    if (payload && typeof payload === 'object' && 'notModified' in payload && payload.notModified === true && this.data) {
      if ('etag' in payload && typeof payload.etag === 'string') this.cursor.etag = payload.etag;
      this.loadedAt = Date.now();
      return this.data;
    }
    const isUpsert = Boolean(payload && typeof payload === 'object' && 'mode' in payload && payload.mode === 'upsert');
    const result = validateInstitutionSync(payload, isUpsert ? this.data ?? undefined : undefined);
    if (!result.success) {
      throw new Error(`Institution snapshot is invalid:\n${formatValidationIssues(result.issues)}`);
    }
    const nextData = this.data && result.data.mode === 'upsert'
      ? mergeNormalizedInstitutionSync(this.data, clone(result.data))
      : clone(result.data);
    assertPrincipalScopedSnapshot(nextData, sessionUser);
    const principalData = projectPrincipalScopedSnapshot(nextData, sessionUser);
    const latestSession = await this.options.getSessionUser();
    if (requestEpoch !== this.loadEpoch || this.principalId !== sessionUser.id || latestSession?.id !== sessionUser.id) {
      throw new Error('The authenticated session changed while institution data was loading.');
    }
    this.data = principalData;
    this.cursor = {
      cursor: result.data.cursor ?? this.cursor.cursor,
      etag: result.data.etag ?? this.cursor.etag,
    };
    this.loadedAt = Date.now();
    await cacheInstitutionJSON(sessionUser.id, this.data);
    return this.data;
  }

  private assertCapabilities(required: InstitutionIntegrationCapability | InstitutionIntegrationCapability[]): void {
    // The descriptor was added compatibly to schema 1.0. Its absence means a
    // legacy gateway implementing the complete mutation contract.
    if (this.data?.integrations === undefined) return;
    const available = new Set(this.data.integrations.flatMap(source => source.capabilities));
    const missing = (Array.isArray(required) ? required : [required]).filter(capability => !available.has(capability));
    if (missing.length) {
      throw new Error(`The connected institution architecture does not support: ${missing.join(', ')}.`);
    }
  }

  async push(
    mutation: Omit<PushMutation, 'id' | 'occurredAt'>,
    required: InstitutionIntegrationCapability | InstitutionIntegrationCapability[],
  ): Promise<void> {
    await this.pushBatch([mutation], required);
  }

  async pushBatch(
    mutations: Omit<PushMutation, 'id' | 'occurredAt'>[],
    required: InstitutionIntegrationCapability | InstitutionIntegrationCapability[],
  ): Promise<void> {
    if (!mutations.length) return;
    this.assertCapabilities(required);
    const queuedMutations: PushMutation[] = mutations.map(mutation => ({
      ...mutation,
      id: createEntityId('mutation'),
      occurredAt: Date.now(),
    }));
    const operation = this.mutationQueue.then(async () => {
      const mutationPrincipalId = this.principalId;
      const requestSession = await this.options.getSessionUser();
      if (!mutationPrincipalId || requestSession?.id !== mutationPrincipalId) {
        throw new Error('The authenticated session changed before the institution mutation was sent.');
      }
      const expectedEtag = this.cursor.etag;
      const result = await this.options.adapter.pushMutations(queuedMutations, this.cursor);
      const responseSession = await this.options.getSessionUser();
      if (this.principalId !== mutationPrincipalId || responseSession?.id !== mutationPrincipalId) {
        throw new Error('The authenticated session changed while the institution mutation was in progress.');
      }
      if (!result || !Array.isArray(result.acceptedIds) || !Array.isArray(result.rejected)) {
        throw new Error('Institution mutation endpoint returned an invalid acknowledgement.');
      }
      const requestedIds = new Set(queuedMutations.map(item => item.id));
      const unsupportedField = Object.keys(result).find(field => !['acceptedIds', 'rejected', 'nextCursor', 'nextEtag'].includes(field));
      if (unsupportedField
        || result.acceptedIds.some(id => typeof id !== 'string')
        || new Set(result.acceptedIds).size !== result.acceptedIds.length
        || result.acceptedIds.some(id => !requestedIds.has(id))
        || result.rejected.some(rejection => !rejection
          || typeof rejection.id !== 'string'
          || typeof rejection.code !== 'string'
          || typeof rejection.message !== 'string'
          || !rejection.code.trim()
          || rejection.code.length > 256
          || /[\u0000-\u001f\u007f]/.test(rejection.code)
          || !rejection.message.trim()
          || rejection.message.length > 2_000
          || /[\u0000-\u001f\u007f]/.test(rejection.message)
          || !requestedIds.has(rejection.id))
        || new Set(result.rejected.map(rejection => rejection.id)).size !== result.rejected.length
        || result.rejected.some(rejection => result.acceptedIds.includes(rejection.id))
        || (result.nextCursor !== undefined && (typeof result.nextCursor !== 'string'
          || !result.nextCursor.trim()
          || result.nextCursor.length > 2_048
          || /[\u0000-\u001f\u007f]/.test(result.nextCursor)))
        || (result.nextEtag !== undefined && (typeof result.nextEtag !== 'string'
          || !result.nextEtag.trim()
          || result.nextEtag.length > 2_048
          || /[\u0000-\u001f\u007f]/.test(result.nextEtag)))
        || (expectedEtag !== undefined && (!result.nextEtag || result.nextEtag === expectedEtag))) {
        throw new Error('Institution mutation endpoint returned a malformed or contradictory acknowledgement.');
      }
      const rejection = result.rejected.find(item => requestedIds.has(item.id));
      if (rejection) throw new Error(`${rejection.message} (${rejection.code})`);
      const unacknowledged = queuedMutations.find(item => !result.acceptedIds.includes(item.id));
      if (unacknowledged) {
        throw new Error(`Institution mutation endpoint did not acknowledge mutation "${unacknowledged.id}".`);
      }
      if (result.nextCursor) {
        this.cursor.cursor = result.nextCursor;
        if (this.data) this.data.cursor = result.nextCursor;
      }
      if (result.nextEtag) {
        this.cursor.etag = result.nextEtag;
        if (this.data) this.data.etag = result.nextEtag;
      }
    });
    this.mutationQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }
}

const getCourse = (data: NormalizedInstitutionSync, courseId: string) =>
  data.courses.find(entry => entry.course.id === courseId);

const findMembership = (data: NormalizedInstitutionSync, courseId: string | undefined, userId: string) =>
  courseId ? getCourse(data, courseId)?.course.staff.find(member => member.id === userId) : undefined;

const canAccessThread = (data: NormalizedInstitutionSync, thread: ChatThread, userId: string) => {
  if (thread.scope === 'direct') return thread.participantIds?.includes(userId) === true;
  const membership = findMembership(data, thread.courseId, userId);
  if (!membership) return false;
  if (thread.scope !== 'group') return true;
  return hasCoursePermission(membership.role, 'postStaffChat')
    || thread.participantIds?.includes(userId) === true
    || getGroupFromSet(getCourse(data, thread.courseId || '')?.course, thread.groupSetId, thread.groupId)?.memberIds.includes(userId) === true;
};

const STAFF_GRADE_ROLES = new Set<CourseUser['role']>(COURSE_PERMISSION_ROLES.grade);

const canAccessSubmission = (data: NormalizedInstitutionSync, submission: StudentSubmission, user: Pick<User, 'id'>) => {
  const membership = findMembership(data, submission.courseId, user.id);
  if (!membership) return false;
  if (STAFF_GRADE_ROLES.has(membership.role)) return true;
  const courseEntry = getCourse(data, submission.courseId);
  return submission.studentId === user.id
    || userBelongsToSubmissionGroup(
      courseEntry?.course,
      courseEntry?.items.find(item => item.id === submission.contentItemId),
      user.id,
      submission.groupId,
    );
};

/**
 * Live transports need the complete answer map for durable aggregation, but it
 * must never cross the repository boundary into an ordinary learner session.
 */
const scopeLiveStateAnswers = (
  state: PopQuizState | null,
  userId: string,
  role: CourseUser['role'],
): PopQuizState | null => {
  if (!state) return null;
  if (hasCoursePermission(role, 'hostLiveAssessment')) return clone(state);
  const ownAnswers = role === 'student' ? state.answers[userId] : undefined;
  return {
    ...clone(state),
    answers: ownAnswers ? { [userId]: clone(ownAnswers) } : {},
  };
};

const assertValidCourseState = (
  data: NormalizedInstitutionSync,
  course: NormalizedInstitutionSync['courses'][number]['course'],
  items: NormalizedInstitutionSync['courses'][number]['items'],
) => {
  const derivedCourse = {
    ...course,
    participantsCount: course.staff.filter(member => member.role === 'student').length,
    materialsCount: items.length,
  };
  const result = validateCourseImport({
    course: derivedCourse,
    enrollments: derivedCourse.staff.map(member => ({
      userId: member.id,
      courseRole: member.role,
      secondaryRoles: member.secondaryRoles,
    })),
    items,
  }, data.users, `courseMutation[${course.id}]`, { requireStableIds: true });
  if (!result.success) throw new Error(`Proposed course state is invalid:\n${formatValidationIssues(result.issues)}`);
};

const refreshCourseCounts = (entry: NormalizedInstitutionSync['courses'][number]) => {
  entry.course.participantsCount = entry.course.staff.filter(member => member.role === 'student').length;
  entry.course.materialsCount = entry.items.length;
};

const assertValidInstitutionState = (data: NormalizedInstitutionSync, operation: string) => {
  const result = validateInstitutionSync({ ...clone(data), mode: 'snapshot' });
  if (!result.success) throw new Error(`Proposed ${operation} state is invalid:\n${formatValidationIssues(result.issues)}`);
};

/** Rejects over-broad gateway responses before sensitive records enter client state. */
export const assertPrincipalScopedSnapshot = (data: NormalizedInstitutionSync, user: Pick<User, 'id'>) => {
  const unauthorizedCourse = data.courses.find(entry => !findMembership(data, entry.course.id, user.id));
  if (unauthorizedCourse) throw new Error(`Institution gateway returned course "${unauthorizedCourse.course.id}" outside the authenticated user's scope.`);
  const unauthorizedThread = (data.threads ?? []).find(thread =>
    thread.scope === 'direct'
      ? !thread.participantIds?.includes(user.id)
      : !canAccessThread(data, thread, user.id),
  );
  if (unauthorizedThread) throw new Error(`Institution gateway returned conversation "${unauthorizedThread.id}" outside the authenticated user's scope.`);
  const exposedAnswerKey = data.courses.flatMap(entry => {
    const membership = findMembership(data, entry.course.id, user.id);
    if (membership && STAFF_GRADE_ROLES.has(membership.role)) return [];
    return entry.items.flatMap(item => (item.questions ?? []).flatMap(question =>
      question.correctAnswer !== undefined || question.customConfig?.testCases !== undefined
        ? [{ courseId: entry.course.id, itemId: item.id, questionId: question.id }]
        : [],
    ));
  })[0];
  if (exposedAnswerKey) {
    throw new Error(`Institution gateway exposed an assessment answer key for question "${exposedAnswerKey.questionId}" in student-scoped course "${exposedAnswerKey.courseId}". Redact correctAnswer and grading test cases.`);
  }
  const unauthorizedSubmission = (data.submissions ?? []).find(submission => !canAccessSubmission(data, submission, user));
  if (unauthorizedSubmission) throw new Error(`Institution gateway returned submission "${unauthorizedSubmission.id}" outside the authenticated user's scope.`);
  const unauthorizedProgress = (data.contentProgress ?? []).find(record => record.userId !== user.id);
  if (unauthorizedProgress) {
    throw new Error(`Institution gateway returned content progress for another principal in course "${unauthorizedProgress.courseId}".`);
  }
  const unreleasedGrade = (data.submissions ?? []).find(submission => {
    const membership = findMembership(data, submission.courseId, user.id);
    if (!membership || STAFF_GRADE_ROLES.has(membership.role) || submission.gradeStatus === 'released') return false;
    return submission.totalScore !== undefined
      || submission.overallFeedback !== undefined
      || submission.gradedBy !== undefined
      || submission.gradedAt !== undefined
      || submission.responses.some(response => response.isCorrect !== undefined
        || response.score !== undefined
        || response.teacherFeedback !== undefined
        || response.rubricScores !== undefined);
  });
  if (unreleasedGrade) {
    throw new Error(`Institution gateway exposed unreleased grading data for submission "${unreleasedGrade.id}". Redact scores and feedback until gradeStatus is released.`);
  }
};

/**
 * Reduces a validated gateway response to the identities and roster fields the
 * authenticated principal is allowed to retain. This runs before repository
 * state or the encrypted offline cache is populated.
 */
export const projectPrincipalScopedSnapshot = (
  data: NormalizedInstitutionSync,
  user: Pick<User, 'id'>,
): NormalizedInstitutionSync => {
  const projected = clone(data);
  projected.contentProgress = (projected.contentProgress ?? []).filter(record => record.userId === user.id);
  const courses = projected.courses.map(entry => entry.course);
  const discoverableIds = principalDirectoryUserIds(
    user.id,
    courses,
    projected.threads,
    projected.messages,
    projected.submissions,
  );
  const privateRosterAuthorization = new Map<string, boolean>();
  projected.courses.forEach(entry => {
    const membership = entry.course.staff.find(member => member.id === user.id);
    const canViewPrivateRoster = hasCoursePermission(membership?.role, 'viewRoster');
    entry.course.staff.forEach(member => privateRosterAuthorization.set(
      member.id,
      (privateRosterAuthorization.get(member.id) ?? true) && canViewPrivateRoster,
    ));
  });

  projected.users = projected.users
    .filter(directoryUser => discoverableIds.has(directoryUser.id))
    .map(directoryUser => privateRosterAuthorization.get(directoryUser.id) === true
      ? toPrivateRosterUser(directoryUser)
      : toDiscoverableUser(directoryUser));
  const projectedUsers = new Map(projected.users.map(directoryUser => [directoryUser.id, directoryUser]));
  projected.courses = projected.courses.map(entry => {
    const membership = entry.course.staff.find(member => member.id === user.id);
    const canViewPrivateRoster = hasCoursePermission(membership?.role, 'viewRoster');
    const enrollments = entry.enrollments.map(enrollment => canViewPrivateRoster
      ? enrollment
      : { ...enrollment, secondaryRoles: undefined });
    const staff = enrollments.flatMap(enrollment => {
      const directoryUser = projectedUsers.get(enrollment.userId);
      if (!directoryUser) return [];
      const member = {
        ...directoryUser,
        role: enrollment.courseRole,
        secondaryRoles: enrollment.secondaryRoles,
      };
      return [canViewPrivateRoster ? member : toDiscoverableUser(member)];
    });
    return {
      ...entry,
      enrollments,
      course: { ...entry.course, staff },
    };
  });

  const validation = validateInstitutionSync({ ...projected, mode: 'snapshot' });
  if (!validation.success) {
    throw new Error(`Principal-scoped institution projection is invalid:\n${formatValidationIssues(validation.issues)}`);
  }
  return validation.data;
};

/**
 * Builds the same repository boundary used by the demo from a generic
 * institution snapshot/mutation JSON adapter. The institution remains the
 * authorization authority; client-side checks only keep inaccessible data out
 * of normal UI paths.
 */
export const createInstitutionRepositoryFactory = (options: InstitutionRepositoryOptions): RepositoryFactory => {
  const client = new InstitutionDataClient(options);
  const loadMessagePage = options.loadMessagePage
    ?? (options.adapter.loadMessagePage ? options.adapter.loadMessagePage.bind(options.adapter) : undefined);
  const requireCourseAccess = async (
    data: NormalizedInstitutionSync,
    courseId: string,
    allowedRoles?: readonly CourseUser['role'][],
  ) => {
    const user = await options.getSessionUser();
    if (!user) throw new Error('Institution SSO session is required.');
    const membership = findMembership(data, courseId, user.id);
    if (!membership) throw new Error('Course is not accessible.');
    if (allowedRoles && !allowedRoles.includes(membership.role)) {
      throw new Error('The authenticated user does not have permission for this course operation.');
    }
    return { user, membership };
  };

  const requireWritableCourse = (course: Course) => {
    if (!isCourseOpenAt(course, Date.now())) {
      throw new Error('Ended, archived, or invalid courses are read-only.');
    }
  };

  const resolveLiveCoursework = async (courseworkId: string, allowedRoles?: readonly CourseUser['role'][]) => {
    const data = await client.getData();
    const entry = data.courses.find(course => course.items.some(item => item.id === courseworkId));
    const item = entry?.items.find(candidate => candidate.id === courseworkId);
    if (!entry || !item) throw new Error('Live-session coursework was not found.');
    if (!item.isPopQuiz && !item.isPoll) throw new Error('This coursework item is not configured for live delivery.');
    if (item.workType === 'group') throw new Error('Live sessions currently require individual responses.');
    const access = await requireCourseAccess(data, entry.course.id, allowedRoles);
    return {
      data,
      entry,
      item,
      ...access,
      studentIds: new Set(entry.course.staff.filter(member => member.role === 'student').map(member => member.id)),
    };
  };

  const upstreamLiveSessions = options.liveSessions;
  const liveSessions: LiveSessionRepository = upstreamLiveSessions ? {
    async getSession(courseworkId) {
      const context = await resolveLiveCoursework(courseworkId);
      const requestUserId = context.user.id;
      const validated = validatePopQuizState(await upstreamLiveSessions.getSession(courseworkId), {
        expectedCourseworkId: courseworkId,
        questions: context.item.questions,
        participantIds: context.studentIds,
      });
      const latestContext = await resolveLiveCoursework(courseworkId);
      if (latestContext.user.id !== requestUserId) {
        throw new Error('The authenticated session changed while the live session was loading.');
      }
      return scopeLiveStateAnswers(validated, requestUserId, latestContext.membership.role);
    },
    async publishSession(courseworkId, state) {
      if (!upstreamLiveSessions.finalizeSession) {
        throw new Error('The institution live-session adapter must implement durable, idempotent finalizeSession before a session can start.');
      }
      const context = await resolveLiveCoursework(courseworkId, COURSE_PERMISSION_ROLES.hostLiveAssessment);
      if (!isCourseInSessionAt(context.entry.course, Date.now())) {
        if (context.entry.course.status === 'past') {
          throw new Error('Archived courses cannot start or advance live assessments. Finalize any existing session instead.');
        }
        throw new Error('Live assessments can only start or advance during the active course term. Finalize any existing session instead.');
      }
      if (isContentLockedAt(context.item, Date.now())) {
        throw new Error('This coursework is not currently available for a live assessment.');
      }
      const validated = validatePopQuizState(state, {
        expectedCourseworkId: courseworkId,
        questions: context.item.questions,
        participantIds: context.studentIds,
      });
      if (!validated) throw new Error('Live sessions can only be removed through durable finalization.');
      const current = validatePopQuizState(await upstreamLiveSessions.getSession(courseworkId), {
        expectedCourseworkId: courseworkId,
        questions: context.item.questions,
        participantIds: context.studentIds,
      });
      if (!current) {
        if (validated.revision !== 1 || Object.keys(validated.answers).length) {
          throw new Error('A new live session must start at revision 1 without client-supplied answers.');
        }
      } else if (validated.sessionId !== current.sessionId
        || validated.startedAt !== current.startedAt
        || validated.revision !== current.revision + 1) {
        throw new Error(`Live session revision conflict: expected revision ${current.revision + 1} for the current run.`);
      }
      await upstreamLiveSessions.publishSession(courseworkId, {
        ...validated,
        answers: current ? clone(current.answers) : {},
      });
    },
    async submitAnswer(courseworkId, studentId, questionId, answer) {
      const context = await resolveLiveCoursework(courseworkId);
      if (context.user.id !== studentId || context.membership?.role !== 'student') {
        throw new Error('Live answer identity does not match an enrolled student session.');
      }
      if (!isCourseInSessionAt(context.entry.course, Date.now())) {
        if (context.entry.course.status === 'past') {
          throw new Error('Archived courses cannot accept live assessment answers.');
        }
        throw new Error('Live assessment answers are accepted only during the active course term.');
      }
      if (isContentLockedAt(context.item, Date.now())) {
        throw new Error('This coursework is not currently accepting live assessment answers.');
      }
      const question = context.item.questions?.find(candidate => candidate.id === questionId);
      if (!question || question.answerType === 'page_break') throw new Error('Live question was not found.');
      validateLiveAnswer(question, answer);
      const state = validatePopQuizState(await upstreamLiveSessions.getSession(courseworkId), {
        expectedCourseworkId: courseworkId,
        questions: context.item.questions,
        participantIds: context.studentIds,
      });
      if (!state || state.status !== 'active' || state.currentQuestionId !== questionId) {
        throw new Error('This live question is no longer accepting answers.');
      }
      if (state.questionClosesAt !== null && Date.now() >= state.questionClosesAt) {
        throw new Error('The live-question timer has expired.');
      }
      const eligibility = getAttemptEligibility(context.item, context.data.submissions ?? [], studentId);
      if (!eligibility.allowed || eligibility.resumableSubmission) {
        throw new Error(eligibility.resumableSubmission
          ? 'An existing draft must be resolved before joining this live assessment.'
          : eligibility.reason || 'This student cannot start another attempt.');
      }
      // The institution transport must repeat the identity/deadline check in
      // the same atomic operation that writes the answer.
      await upstreamLiveSessions.submitAnswer(courseworkId, studentId, questionId, answer);
    },
    async finalizeSession(courseworkId, sessionId) {
      const finalizeSession = upstreamLiveSessions.finalizeSession;
      if (!finalizeSession) {
        throw new Error('The institution live-session adapter cannot durably archive results.');
      }
      return client.runExclusiveMutation(async () => {
        const context = await resolveLiveCoursework(courseworkId, COURSE_PERMISSION_ROLES.hostLiveAssessment);
        const current = validatePopQuizState(await upstreamLiveSessions.getSession(courseworkId), {
          expectedCourseworkId: courseworkId,
          questions: context.item.questions,
          participantIds: context.studentIds,
        });
        if (current && current.sessionId !== sessionId) {
          throw new Error('The live session changed before it could be finalized.');
        }
        const archived = await finalizeSession(courseworkId, sessionId);
        if (!Array.isArray(archived)) throw new Error('The institution live-session adapter returned an invalid archive result.');
        const remaining = validatePopQuizState(await upstreamLiveSessions.getSession(courseworkId), {
          expectedCourseworkId: courseworkId,
          questions: context.item.questions,
          participantIds: context.studentIds,
        });
        if (remaining?.sessionId === sessionId) {
          throw new Error('The institution live-session adapter archived results without atomically closing the session.');
        }
        const submissionIds = new Set<string>();
        const submittedStudentIds = new Set<string>();
        const existingById = new Map((context.data.submissions ?? []).map(submission => [submission.id, submission]));
        const existingForSessionByStudent = new Map(
          (context.data.submissions ?? [])
            .filter(submission => submission.contentItemId === courseworkId && submission.liveSessionId === sessionId)
            .map(submission => [submission.studentId, submission]),
        );
        archived.forEach(submission => {
          if (!submission || typeof submission.id !== 'string' || submissionIds.has(submission.id)) {
            throw new Error('The institution live-session archive returned duplicate or invalid submission IDs.');
          }
          submissionIds.add(submission.id);
          if (submission.liveSessionId !== sessionId
            || submission.contentItemId !== courseworkId || submission.courseId !== context.entry.course.id
            || !context.studentIds.has(submission.studentId) || submission.groupId !== undefined
            || submission.status !== 'submitted' || submission.revision !== 1
            || !Number.isInteger(submission.attemptNumber) || (submission.attemptNumber ?? 0) < 1
            || (current && submission.startedAt !== current.startedAt)) {
            throw new Error('The institution live-session archive returned a submission outside this individual session.');
          }
          if (submittedStudentIds.has(submission.studentId)) {
            throw new Error('The institution live-session archive returned more than one submission for a student.');
          }
          submittedStudentIds.add(submission.studentId);
          const existingForStudent = existingForSessionByStudent.get(submission.studentId);
          if (existingForStudent && existingForStudent.id !== submission.id) {
            throw new Error('The institution live-session adapter changed a submission ID while retrying finalization.');
          }
          const eligibility = getAttemptEligibility(context.item, context.data.submissions ?? [], submission.studentId);
          if (current) {
            if (existingForStudent || !eligibility.allowed || eligibility.resumableSubmission
              || submission.attemptNumber !== eligibility.nextAttemptNumber) {
              throw new Error('The institution live-session archive conflicts with this student\'s assessment attempts.');
            }
            if (existingById.has(submission.id)) {
              throw new Error('The institution live-session archive reused an existing submission ID.');
            }
          } else if (!existingForStudent
            && (!eligibility.allowed || eligibility.resumableSubmission || submission.attemptNumber !== eligibility.nextAttemptNumber)) {
            throw new Error('The institution live-session retry conflicts with this student\'s assessment attempts.');
          }
        });
        if (current) {
          const answeredStudentIds = new Set(Object.keys(current.answers));
          if (answeredStudentIds.size !== submittedStudentIds.size
            || [...answeredStudentIds].some(studentId => !submittedStudentIds.has(studentId))) {
            throw new Error('The institution live-session archive did not return exactly one submission for every participant who answered.');
          }
        }
        const resolvedArchive = archived.map(submission => {
          const existing = existingById.get(submission.id);
          if (!existing) return clone(submission);
          if (existing.liveSessionId !== sessionId
            || existing.studentId !== submission.studentId
            || existing.contentItemId !== submission.contentItemId
            || existing.courseId !== submission.courseId
            || existing.attemptNumber !== submission.attemptNumber) {
            throw new Error('The institution live-session archive collided with an unrelated submission.');
          }
          // A retry must not roll a subsequently graded archive back to the
          // adapter's original submitted representation.
          return clone(existing);
        });
        const proposed = clone(context.data);
        proposed.submissions = [
          ...(proposed.submissions || []).filter(submission => !submissionIds.has(submission.id)),
          ...resolvedArchive,
        ];
        assertValidInstitutionState(proposed, 'live-session archive');
        context.data.submissions = proposed.submissions;
        return resolvedArchive;
      });
    },
    subscribeToSession(courseworkId, onState, onError) {
      let disposed = false;
      let unsubscribe: () => void = () => undefined;
      let incomingSequence = 0;
      const fail = (error: unknown) => {
        if (disposed) return;
        disposed = true;
        unsubscribe();
        onError?.(error instanceof Error ? error : new Error('The live session subscription failed.'));
      };
      void resolveLiveCoursework(courseworkId).then(context => {
        if (disposed) return;
        const subscriptionUserId = context.user.id;
        const upstreamUnsubscribe = upstreamLiveSessions.subscribeToSession(courseworkId, rawState => {
          const sequence = ++incomingSequence;
          void resolveLiveCoursework(courseworkId).then(latestContext => {
            if (disposed || sequence !== incomingSequence) return;
            if (latestContext.user.id !== subscriptionUserId) {
              throw new Error('The authenticated session changed while the live session subscription was active.');
            }
            const validated = validatePopQuizState(rawState, {
              expectedCourseworkId: courseworkId,
              questions: latestContext.item.questions,
              participantIds: latestContext.studentIds,
            });
            onState(scopeLiveStateAnswers(validated, subscriptionUserId, latestContext.membership.role));
          }).catch(fail);
        }, fail);
        unsubscribe = upstreamUnsubscribe;
        if (disposed) upstreamUnsubscribe();
      }).catch(fail);
      return () => {
        if (disposed) return;
        disposed = true;
        incomingSequence += 1;
        unsubscribe();
      };
    },
  } : {
    async getSession() { return null; },
    async publishSession() { throw new Error('Live sessions are not configured for this institution.'); },
    async submitAnswer() { throw new Error('Live sessions are not configured for this institution.'); },
    subscribeToSession(_courseworkId, _onState, onError) {
      queueMicrotask(() => onError?.(new Error('Live sessions are not configured for this institution.')));
      return () => undefined;
    },
  };

  return {
    auth: {
      async login(email) {
        let user = await options.getSessionUser();
        if (!user && options.login) {
          await options.login();
          user = await options.getSessionUser();
        }
        if (!user) throw new Error('Institution SSO session is required.');
        if (email?.trim() && (!user.email || user.email.toLocaleLowerCase() !== email.trim().toLocaleLowerCase())) {
          throw new Error('The requested account does not match the active institution SSO session.');
        }
        const data = await client.getData();
        const defaultRole = data.courses
          .flatMap(entry => entry.course.staff)
          .find(member => member.id === user.id)?.role ?? 'student';
        return { user: clone(user), defaultRole };
      },
      async logout() {
        await options.logout?.();
      },
      async getCurrentUser() {
        const user = await options.getSessionUser();
        return user ? clone(user) : null;
      },
    },

    courses: {
      async getCoursesForUser(userId) {
        const data = await client.getData();
        const sessionUser = await options.getSessionUser();
        if (!sessionUser || sessionUser.id !== userId) throw new Error('Course request does not match the authenticated session.');
        return clone(data.courses
          .map(entry => entry.course)
          .filter(course => course.staff.some(member => member.id === userId))
          .map(course => projectCourseForPrincipal(course, userId)));
      },
      async getCourseDetails(courseId) {
        const data = await client.getData();
        const entry = getCourse(data, courseId);
        const { user } = await requireCourseAccess(data, courseId);
        return entry ? clone(projectCourseForPrincipal(entry.course, user.id)) : null;
      },
      async getUserRoleForCourse(userId, courseId) {
        const data = await client.getData();
        const sessionUser = await options.getSessionUser();
        if (!sessionUser || sessionUser.id !== userId) throw new Error('Role request does not match the authenticated session.');
        const membership = findMembership(data, courseId, userId);
        if (!membership) throw new Error('User is not enrolled in this course.');
        return membership.role;
      },
      async updateCourse(courseId, updates) {
        return client.runExclusiveMutation(async () => {
          const data = await client.getData();
          const entry = getCourse(data, courseId);
          if (!entry) throw new Error(`Course "${courseId}" was not found.`);
          await requireCourseAccess(data, courseId, COURSE_PERMISSION_ROLES.manageCourse);
          requireWritableCourse(entry.course);
          if (updates.id && updates.id !== courseId) throw new Error('Course identifiers cannot be changed.');
          if (updates.staff !== undefined || updates.participantsCount !== undefined || updates.materialsCount !== undefined) {
            throw new Error('Derived course staff and counts must be changed through enrollment and content operations.');
          }
          const proposed = { ...entry.course, ...clonePatch(updates), id: courseId };
          assertValidCourseState(data, proposed, entry.items);
          const proposedData = clone(data);
          const proposedEntry = getCourse(proposedData, courseId)!;
          proposedEntry.course = clone(proposed);
          if (Object.prototype.hasOwnProperty.call(updates, 'groupSets')) {
            // Assignment-group membership also controls private group forum
            // access. Keep the cached snapshot and institution mutation in one
            // transaction so a moved student cannot retain stale explicit
            // access to their former group's conversation.
            proposedData.threads = proposedData.threads?.map(thread => {
              if (thread.courseId !== courseId || thread.scope !== 'group') return thread;
              const resolvedGroup = getGroupFromSet(proposed, thread.groupSetId, thread.groupId);
              const retainedStaff = (thread.participantIds ?? []).filter(userId => (
                hasCoursePermission(proposed.staff.find(member => member.id === userId)?.role, 'manageChat')
              ));
              const currentGroupMembers = (resolvedGroup?.memberIds ?? []).filter(userId => (
                proposed.staff.some(member => member.id === userId && member.role === 'student')
              ));
              const participantIds = Array.from(new Set([...retainedStaff, ...currentGroupMembers]));
              return { ...thread, participantIds: participantIds.length ? participantIds : undefined };
            });
          }
          assertValidInstitutionState(proposedData, 'course');
          await client.push({
            entity: 'course',
            operation: 'update',
            entityId: courseId,
            payload: {
              ...mutationPayload(updates),
              ...(Object.prototype.hasOwnProperty.call(updates, 'groupSets') ? { reconcileGroupConversationAccess: true } : {}),
            },
          }, 'courses.write');
          entry.course = proposed;
          data.threads = proposedData.threads;
        });
      },
      async addStudentByIdentifier(courseId, identifier) {
        return client.runExclusiveMutation(async () => {
          const data = await client.getData();
          const entry = getCourse(data, courseId);
          if (!entry) throw new Error(`Course "${courseId}" was not found.`);
          const { user: manager } = await requireCourseAccess(data, courseId, COURSE_PERMISSION_ROLES.manageCourse);
          requireWritableCourse(entry.course);
          const normalizedIdentifier = identifier.trim();
          if (!normalizedIdentifier || normalizedIdentifier.length > 320 || /[\u0000-\u001f\u007f]/.test(normalizedIdentifier)) {
            throw new Error('Enter a valid institution user ID or disclosed email address.');
          }
          const normalizedEmail = normalizedIdentifier.toLocaleLowerCase();
          let directoryUser = data.users.find(user => user.id === normalizedIdentifier)
            || data.users.find(user => user.email?.toLocaleLowerCase() === normalizedEmail);
          if (!directoryUser && options.lookupDirectoryUser) {
            let rawLookup: unknown;
            try {
              rawLookup = await options.lookupDirectoryUser(normalizedIdentifier);
            } catch {
              throw new Error('The institution directory lookup could not be completed.');
            }
            const latestSession = await options.getSessionUser();
            if (latestSession?.id !== manager.id) {
              throw new Error('The authenticated session changed while the directory lookup was in progress.');
            }
            const lookup = validateDirectoryUser(rawLookup);
            if (!lookup.success || (lookup.data.id !== normalizedIdentifier
              && lookup.data.email?.toLocaleLowerCase() !== normalizedEmail)) {
              throw new Error('The institution directory returned an invalid or mismatched user record.');
            }
            directoryUser = toPrivateRosterUser(lookup.data);
          }
          if (!directoryUser) throw new Error('No institution directory user matches that stable ID or disclosed email address.');
          if (entry.course.staff.some(member => member.id === directoryUser.id)) throw new Error('That user is already enrolled.');
          const rosterDirectoryUser = toPrivateRosterUser(directoryUser);
          const student: CourseUser = { ...rosterDirectoryUser, role: 'student', secondaryRoles: undefined };
          const validationData = clone(data);
          validationData.users = [
            ...validationData.users.filter(user => user.id !== rosterDirectoryUser.id),
            rosterDirectoryUser,
          ];
          assertValidCourseState(validationData, { ...entry.course, staff: [...entry.course.staff, student] }, entry.items);
          await client.push({
            entity: 'course',
            operation: 'update',
            entityId: courseId,
            payload: { action: 'enroll', userId: student.id, ...(student.email ? { email: student.email } : {}), role: 'student' },
          }, 'roster.write');
          data.users = [
            ...data.users.filter(user => user.id !== rosterDirectoryUser.id),
            rosterDirectoryUser,
          ];
          entry.course.staff.push(student);
          entry.enrollments.push({ userId: student.id, courseRole: 'student', secondaryRoles: undefined });
          refreshCourseCounts(entry);
          return clone(student);
        });
      },
      async updateCourseUser(courseId, userId, updates) {
        return client.runExclusiveMutation(async () => {
          const data = await client.getData();
          const entry = getCourse(data, courseId);
          const membership = entry?.course.staff.find(member => member.id === userId);
          if (!entry || !membership) throw new Error('Course enrollment was not found.');
          const { user, membership: managerMembership } = await requireCourseAccess(data, courseId, COURSE_PERMISSION_ROLES.manageCourse);
          requireWritableCourse(entry.course);
          if (updates.id && updates.id !== userId) throw new Error('User identifiers cannot be changed.');
          if (updates.name !== undefined || updates.email !== undefined) throw new Error('Institution identity fields cannot be changed through a course enrollment.');
          if (updates.role && !getAssignableCourseRoles(managerMembership.role, membership.role).includes(updates.role)) {
            throw new Error('Your course role cannot grant that participant role.');
          }
          if (updates.role && wouldRemoveLastCourseManager(entry.course.staff, user.id, userId, updates.role)) {
            throw new Error(LAST_COURSE_MANAGER_ERROR);
          }
          const nextRole = updates.role ?? membership.role;
          const proposedStaff = entry.course.staff.map(member => member.id === userId ? { ...member, ...clonePatch(updates), id: userId } : member);
          const proposedGroupSets = nextRole === 'student' ? entry.course.groupSets : entry.course.groupSets?.map(groupSet => ({
            ...groupSet,
            groups: groupSet.groups.map(group => ({ ...group, memberIds: group.memberIds.filter(memberId => memberId !== userId) })),
          }));
          const proposedCourse = { ...entry.course, staff: proposedStaff, groupSets: proposedGroupSets };
          assertValidCourseState(data, proposedCourse, entry.items);
          const proposedData = clone(data);
          const proposedEntry = getCourse(proposedData, courseId)!;
          proposedEntry.course = clone(proposedCourse);
          proposedEntry.enrollments = proposedEntry.enrollments.map(enrollment => enrollment.userId === userId ? {
            ...enrollment,
            courseRole: updates.role ?? enrollment.courseRole,
            secondaryRoles: Object.prototype.hasOwnProperty.call(updates, 'secondaryRoles') ? updates.secondaryRoles : enrollment.secondaryRoles,
          } : enrollment);
          proposedData.threads = proposedData.threads?.map(thread => {
            if (thread.courseId !== courseId || thread.scope !== 'group' || !thread.participantIds?.includes(userId)) return thread;
            const resolvedGroup = getGroupFromSet(proposedCourse, thread.groupSetId, thread.groupId);
            const retainsGroupAccess = hasCoursePermission(nextRole, 'manageChat') || resolvedGroup?.memberIds.includes(userId) === true;
            return retainsGroupAccess ? thread : { ...thread, participantIds: thread.participantIds.filter(participantId => participantId !== userId) };
          });
          refreshCourseCounts(proposedEntry);
          assertValidInstitutionState(proposedData, 'course enrollment');
          await client.push({
            entity: 'user',
            operation: 'update',
            entityId: userId,
            payload: {
              courseId,
              ...mutationPayload(updates),
              ...(updates.role && nextRole !== 'student' ? { removeFromAssignmentGroups: true } : {}),
              ...(updates.role ? { reconcileGroupConversationAccess: true } : {}),
            },
          }, 'roster.write');
          entry.course = proposedCourse;
          entry.enrollments = entry.enrollments.map(enrollment => enrollment.userId === userId ? {
            ...enrollment,
            courseRole: updates.role ?? enrollment.courseRole,
            secondaryRoles: Object.prototype.hasOwnProperty.call(updates, 'secondaryRoles') ? updates.secondaryRoles : enrollment.secondaryRoles,
          } : enrollment);
          data.threads = proposedData.threads;
          refreshCourseCounts(entry);
        });
      },
    },

    content: {
      async getContentItems(courseId) {
        const data = await client.getData();
        await requireCourseAccess(data, courseId);
        return clone(getCourse(data, courseId)?.items ?? []);
      },
      async createContentItem(item) {
        return client.runExclusiveMutation(async () => {
        const data = await client.getData();
        const entry = getCourse(data, item.courseId);
        if (!entry) throw new Error(`Course "${item.courseId}" was not found.`);
        await requireCourseAccess(data, item.courseId, COURSE_PERMISSION_ROLES.manageContent);
        requireWritableCourse(entry.course);
        if (data.courses.some(course => course.items.some(existing => existing.id === item.id))) throw new Error(`Content item "${item.id}" already exists.`);
        assertValidCourseState(data, entry.course, [...entry.items, item]);
        await client.push({ entity: 'content', operation: 'create', entityId: item.id, payload: { ...item } }, 'content.write');
        entry.items.push(clone(item));
        refreshCourseCounts(entry);
        return clone(item);
        });
      },
      async createContentItems(items) {
        return client.runExclusiveMutation(async () => {
        if (!items.length) return [];
        const data = await client.getData();
        const incomingIds = new Set<string>();
        const proposedItemsByCourse = new Map<string, typeof items>();
        for (const item of items) {
          const entry = getCourse(data, item.courseId);
          if (!entry) throw new Error(`Course "${item.courseId}" was not found.`);
          await requireCourseAccess(data, item.courseId, COURSE_PERMISSION_ROLES.manageContent);
          requireWritableCourse(entry.course);
          if (incomingIds.has(item.id) || data.courses.some(course => course.items.some(existing => existing.id === item.id))) {
            throw new Error(`Content item "${item.id}" already exists.`);
          }
          incomingIds.add(item.id);
          const proposed = proposedItemsByCourse.get(item.courseId) ?? [...entry.items];
          proposed.push(item);
          proposedItemsByCourse.set(item.courseId, proposed);
        }
        proposedItemsByCourse.forEach((proposed, courseId) => {
          const entry = getCourse(data, courseId);
          if (entry) assertValidCourseState(data, entry.course, proposed);
        });
        await client.pushBatch(items.map(item => ({
          entity: 'content' as const,
          operation: 'create' as const,
          entityId: item.id,
          payload: { ...item },
        })), 'content.write');
        items.forEach(item => getCourse(data, item.courseId)?.items.push(clone(item)));
        proposedItemsByCourse.forEach((_proposed, courseId) => {
          const entry = getCourse(data, courseId);
          if (entry) refreshCourseCounts(entry);
        });
        return clone(items);
        });
      },
      async updateContentItem(itemId, updates) {
        return client.runExclusiveMutation(async () => {
        const data = await client.getData();
        const item = data.courses.flatMap(entry => entry.items).find(candidate => candidate.id === itemId);
        if (!item) throw new Error(`Content item "${itemId}" was not found.`);
        await requireCourseAccess(data, item.courseId, COURSE_PERMISSION_ROLES.manageContent);
        requireWritableCourse(getCourse(data, item.courseId)!.course);
        if (updates.id && updates.id !== itemId) throw new Error('Content identifiers cannot be changed.');
        if (updates.courseId && updates.courseId !== item.courseId) throw new Error('Content cannot be moved between courses by an update.');
        const entry = getCourse(data, item.courseId)!;
        const proposed = { ...item, ...clonePatch(updates), id: itemId };
        assertValidCourseState(data, entry.course, entry.items.map(candidate => candidate.id === itemId ? proposed : candidate));
        const proposedData = clone(data);
        const proposedEntry = getCourse(proposedData, item.courseId)!;
        proposedEntry.items = proposedEntry.items.map(candidate => candidate.id === itemId ? clone(proposed) : candidate);
        assertValidInstitutionState(proposedData, 'content');
        await client.push({ entity: 'content', operation: 'update', entityId: itemId, payload: mutationPayload(updates) }, 'content.write');
        Object.assign(item, proposed);
        });
      },
      async updateContentItems(changes) {
        return client.runExclusiveMutation(async () => {
        if (!changes.length) return;
        const data = await client.getData();
        const items = data.courses.flatMap(entry => entry.items);
        const proposedById = new Map(items.map(item => [item.id, clone(item)]));
        const changedIds = new Set<string>();
        for (const change of changes) {
          if (changedIds.has(change.itemId)) throw new Error(`Content item "${change.itemId}" is repeated in the batch.`);
          changedIds.add(change.itemId);
          const item = items.find(candidate => candidate.id === change.itemId);
          if (!item) throw new Error(`Content item "${change.itemId}" was not found.`);
          await requireCourseAccess(data, item.courseId, COURSE_PERMISSION_ROLES.manageContent);
          requireWritableCourse(getCourse(data, item.courseId)!.course);
          if (change.updates.id && change.updates.id !== change.itemId) throw new Error('Content identifiers cannot be changed.');
          if (change.updates.courseId && change.updates.courseId !== item.courseId) throw new Error('Content cannot be moved between courses by an update.');
          proposedById.set(change.itemId, { ...item, ...clonePatch(change.updates), id: change.itemId });
        }
        data.courses.forEach(entry => assertValidCourseState(
          data,
          entry.course,
          entry.items.map(item => proposedById.get(item.id) || item),
        ));
        const proposedData = clone(data);
        proposedData.courses.forEach(entry => {
          entry.items = entry.items.map(item => clone(proposedById.get(item.id) || item));
        });
        assertValidInstitutionState(proposedData, 'content batch');
        await client.pushBatch(changes.map(change => ({
          entity: 'content' as const,
          operation: 'update' as const,
          entityId: change.itemId,
          payload: mutationPayload(change.updates),
        })), 'content.write');
        changes.forEach(change => {
          const item = items.find(candidate => candidate.id === change.itemId);
          if (item) Object.assign(item, clonePatch(change.updates), { id: change.itemId });
        });
        });
      },
      async updateContentGrouping(courseId, labels, changes) {
        return client.runExclusiveMutation(async () => {
          const data = await client.getData();
          const entry = getCourse(data, courseId);
          if (!entry) throw new Error(`Course "${courseId}" was not found.`);
          await requireCourseAccess(data, courseId, COURSE_PERMISSION_ROLES.manageContent);
          requireWritableCourse(entry.course);
          const normalizedLabels = normalizeContentGroupLabels(labels);
          const proposedById = new Map(entry.items.map(item => [item.id, clone(item)]));
          const changedIds = new Set<string>();
          for (const change of changes) {
            if (changedIds.has(change.itemId)) throw new Error(`Content item "${change.itemId}" is repeated in the grouping update.`);
            changedIds.add(change.itemId);
            const item = entry.items.find(candidate => candidate.id === change.itemId);
            if (!item) throw new Error(`Content item "${change.itemId}" was not found in course "${courseId}".`);
            if (change.updates.id && change.updates.id !== change.itemId) throw new Error('Content identifiers cannot be changed.');
            if (change.updates.courseId && change.updates.courseId !== courseId) throw new Error('Content cannot be moved between courses by a grouping update.');
            proposedById.set(change.itemId, { ...item, ...clonePatch(change.updates), id: change.itemId });
          }
          const metadata = { ...(entry.course.metadata || {}), lmsGroupLabels: normalizedLabels };
          const proposedCourse = { ...entry.course, metadata };
          const proposedItems = entry.items.map(item => proposedById.get(item.id) || item);
          assertValidCourseState(data, proposedCourse, proposedItems);
          const proposedData = clone(data);
          const proposedEntry = getCourse(proposedData, courseId)!;
          proposedEntry.course = clone(proposedCourse);
          proposedEntry.items = proposedItems.map(clone);
          assertValidInstitutionState(proposedData, 'content grouping');
          await client.pushBatch([
            {
              entity: 'course' as const,
              operation: 'update' as const,
              entityId: courseId,
              payload: { metadata },
            },
            ...changes.map(change => ({
              entity: 'content' as const,
              operation: 'update' as const,
              entityId: change.itemId,
              payload: mutationPayload(change.updates),
            })),
          ], ['courses.write', 'content.write']);
          entry.course = proposedCourse;
          entry.items = proposedItems.map(clone);
        });
      },
      async deleteContentItem(itemId, deletedAt) {
        return client.runExclusiveMutation(async () => {
        const data = await client.getData();
        const item = data.courses.flatMap(entry => entry.items).find(candidate => candidate.id === itemId);
        if (!item) throw new Error(`Content item "${itemId}" was not found.`);
        await requireCourseAccess(data, item.courseId, COURSE_PERMISSION_ROLES.manageContent);
        requireWritableCourse(getCourse(data, item.courseId)!.course);
        await client.push({ entity: 'content', operation: 'update', entityId: itemId, payload: { deletedAt } }, 'content.write');
        item.deletedAt = deletedAt;
        });
      },
      async restoreContentItem(itemId) {
        return client.runExclusiveMutation(async () => {
        const data = await client.getData();
        const item = data.courses.flatMap(entry => entry.items).find(candidate => candidate.id === itemId);
        if (!item) throw new Error(`Content item "${itemId}" was not found.`);
        await requireCourseAccess(data, item.courseId, COURSE_PERMISSION_ROLES.manageContent);
        requireWritableCourse(getCourse(data, item.courseId)!.course);
        await client.push({ entity: 'content', operation: 'update', entityId: itemId, payload: { deletedAt: null } }, 'content.write');
        item.deletedAt = undefined;
        });
      },
    },

    progress: {
      async getProgressForCourses(courseIds, userId) {
        const data = await client.getData();
        const sessionUser = await options.getSessionUser();
        if (!sessionUser || sessionUser.id !== userId) throw new Error('Content progress request does not match the authenticated session.');
        for (const courseId of courseIds) await requireCourseAccess(data, courseId);
        const allowed = new Set(courseIds);
        return clone((data.contentProgress ?? []).filter(record => record.userId === userId && allowed.has(record.courseId)));
      },
      async markViewed(contentItemId, userId) {
        return client.runExclusiveMutation(async () => {
          const data = await client.getData();
          const sessionUser = await options.getSessionUser();
          if (!sessionUser || sessionUser.id !== userId) throw new Error('Content progress identity does not match the authenticated session.');
          const entry = data.courses.find(course => course.items.some(item => item.id === contentItemId));
          const item = entry?.items.find(candidate => candidate.id === contentItemId);
          if (!entry || !item || item.deletedAt !== undefined) throw new Error('Course content was not found.');
          const { membership } = await requireCourseAccess(data, entry.course.id);
          if (membership.role !== 'student') throw new Error('Course progress is recorded only for learner sessions.');
          const existing = (data.contentProgress ?? []).find(record => record.userId === userId && record.contentItemId === contentItemId);
          const now = Date.now();
          const next: ContentProgress = existing ? {
            ...existing,
            lastViewedAt: Math.max(now, existing.lastViewedAt),
            revision: existing.revision + 1,
          } : {
            userId,
            courseId: entry.course.id,
            contentItemId,
            firstViewedAt: now,
            lastViewedAt: now,
            revision: 1,
          };
          await client.push({
            entity: 'content-progress',
            operation: existing ? 'update' : 'create',
            entityId: contentItemId,
            payload: { courseId: entry.course.id, action: 'view', expectedRevision: existing?.revision ?? 0 },
          }, 'content-progress.write');
          data.contentProgress = [...(data.contentProgress ?? []).filter(record => record.userId !== userId || record.contentItemId !== contentItemId), next];
          return clone(next);
        });
      },
      async setCompleted(contentItemId, userId, completed) {
        return client.runExclusiveMutation(async () => {
          const data = await client.getData();
          const sessionUser = await options.getSessionUser();
          if (!sessionUser || sessionUser.id !== userId) throw new Error('Content progress identity does not match the authenticated session.');
          const entry = data.courses.find(course => course.items.some(item => item.id === contentItemId));
          const item = entry?.items.find(candidate => candidate.id === contentItemId);
          if (!entry || !item || item.deletedAt !== undefined) throw new Error('Course content was not found.');
          const { membership } = await requireCourseAccess(data, entry.course.id);
          if (membership.role !== 'student') throw new Error('Course progress is recorded only for learner sessions.');
          const existing = (data.contentProgress ?? []).find(record => record.userId === userId && record.contentItemId === contentItemId);
          const now = Date.now();
          const next: ContentProgress = existing ? {
            ...existing,
            lastViewedAt: Math.max(now, existing.lastViewedAt),
            completedAt: completed ? Math.max(now, existing.completedAt ?? 0) : undefined,
            revision: existing.revision + 1,
          } : {
            userId,
            courseId: entry.course.id,
            contentItemId,
            firstViewedAt: now,
            lastViewedAt: now,
            completedAt: completed ? now : undefined,
            revision: 1,
          };
          await client.push({
            entity: 'content-progress',
            operation: existing ? 'update' : 'create',
            entityId: contentItemId,
            payload: { courseId: entry.course.id, action: completed ? 'complete' : 'reopen', expectedRevision: existing?.revision ?? 0 },
          }, 'content-progress.write');
          data.contentProgress = [...(data.contentProgress ?? []).filter(record => record.userId !== userId || record.contentItemId !== contentItemId), next];
          return clone(next);
        });
      },
    },

    submissions: {
      async getSubmissionsForCourses(courseIds) {
        const data = await client.getData();
        const sessionUser = await options.getSessionUser();
        if (!sessionUser) throw new Error('Institution SSO session is required.');
        for (const courseId of courseIds) await requireCourseAccess(data, courseId);
        const allowed = new Set(courseIds);
        return clone((data.submissions ?? []).filter(submission => allowed.has(submission.courseId) && canAccessSubmission(data, submission, sessionUser)));
      },
      async upsertSubmission(submission) {
        return client.runExclusiveMutation(async () => {
        const data = await client.getData();
        const existingSubmissions = data.submissions ?? [];
        const index = existingSubmissions.findIndex(existing => existing.id === submission.id);
        const existing = index >= 0 ? existingSubmissions[index] : undefined;
        const { user, membership } = await requireCourseAccess(data, submission.courseId);
        const canGrade = STAFF_GRADE_ROLES.has(membership.role);
        const courseEntry = getCourse(data, submission.courseId);
        const item = courseEntry?.items.find(candidate => candidate.id === submission.contentItemId);
        if (!item) throw new Error('Submission content item was not found in this course.');
        const ownsSubmission = submission.studentId === user.id
          || userBelongsToSubmissionGroup(getCourse(data, submission.courseId)?.course, item, user.id, submission.groupId);
        const expectedRevision = (existing?.revision ?? 0) + 1;
        if (submission.revision !== expectedRevision) {
          throw new Error(`Submission revision conflict: expected revision ${expectedRevision}. Reload the attempt before saving again.`);
        }
        if (submission.updatedAt === undefined || !Number.isFinite(submission.updatedAt)) {
          throw new Error('Submission updatedAt must be present. The gateway must replace client time with its authoritative server timestamp.');
        }
        if (existing && (
          existing.studentId !== submission.studentId
          || existing.courseId !== submission.courseId
          || existing.contentItemId !== submission.contentItemId
          || existing.groupId !== submission.groupId
          || existing.liveSessionId !== submission.liveSessionId
          || (existing.attemptNumber ?? 1) !== (submission.attemptNumber ?? 1)
          || existing.startedAt !== submission.startedAt
          || existing.timeLimitExpiresAt !== submission.timeLimitExpiresAt
        )) throw new Error('Submission ownership and assessment identifiers cannot be changed.');
        if (!existing && submission.liveSessionId) {
          throw new Error('Live assessment submissions can only be created by atomic live-session finalization.');
        }
        if (!existing && (canGrade || !ownsSubmission || !['draft', 'submitted'].includes(submission.status))) {
          throw new Error('New attempts must be created by their learner or group in draft or submitted state.');
        }
        if (!canGrade) {
          if (membership.role !== 'student') {
            throw new Error('Only a student course enrollment can create or update learner attempts.');
          }
          if (!courseEntry || !isCourseInSessionAt(courseEntry.course, Date.now())) {
            if (courseEntry?.course.status === 'past') {
              throw new Error('Archived courses are read-only and cannot accept learner attempts.');
            }
            throw new Error('Learner attempts are accepted only during the active course term.');
          }
          if (isContentLockedAt(item, Date.now())) {
            throw new Error('This coursework is not currently available for learner attempts.');
          }
          if (!existing || existing.status === 'draft') {
            const eligibility = getAttemptEligibility(item, existingSubmissions, user.id, submission.groupId);
            if (!eligibility.allowed) throw new Error(eligibility.reason || 'This assessment cannot accept another attempt.');
            if (existing && eligibility.resumableSubmission?.id !== existing.id) {
              throw new Error('A different saved draft must be resumed before this attempt can be changed.');
            }
            if (!existing && eligibility.resumableSubmission) {
              throw new Error('Resume the existing saved draft before starting another attempt.');
            }
            if ((submission.attemptNumber ?? 1) !== eligibility.nextAttemptNumber) {
              throw new Error(`Attempt number conflict: expected attempt ${eligibility.nextAttemptNumber}.`);
            }
          }
        }
        const containsGradeMutation = submission.status === 'graded'
          || submission.gradeStatus === 'released'
          || Boolean(submission.gradedBy || submission.gradedAt || submission.overallFeedback);
        if (!canGrade && (!ownsSubmission || containsGradeMutation || existing?.status === 'graded')) {
          throw new Error('The authenticated user cannot update this submission or its grade.');
        }
        if (existing && !canGrade && (
          existing.status !== 'draft' || !['draft', 'submitted'].includes(submission.status)
        )) {
          throw new Error('Learners can only edit a draft attempt or submit it once. Submitted attempts are immutable.');
        }
        if (existing && canGrade) {
          if (attemptEvidenceFingerprint(existing) !== attemptEvidenceFingerprint(submission)) {
            throw new Error('Graders cannot alter learner answers, attachments, or attempt audit evidence.');
          }
          const allowedTransition = (existing.status === 'draft' && submission.status === 'discarded')
            || (existing.status === 'submitted' && ['graded', 'discarded'].includes(submission.status))
            || (existing.status === 'graded' && ['graded', 'discarded'].includes(submission.status))
            || (existing.status === 'discarded' && submission.status === 'submitted');
          if (!allowedTransition) throw new Error(`Submission status cannot transition from ${existing.status} to ${submission.status}.`);
          if (existing.status === 'discarded' && submission.status === 'submitted'
            && (!existing.deletedAt || Date.now() - existing.deletedAt > 24 * 60 * 60 * 1_000)) {
            throw new Error('The 24-hour submission recovery window has expired.');
          }
        }
        if (canGrade && submission.status === 'graded') {
          if (!existing || !['submitted', 'graded'].includes(existing.status)) throw new Error('Only a submitted attempt can be graded.');
          if (submission.gradedBy !== user.id) throw new Error('gradedBy must match the authenticated grader.');
        }
        const transportSubmission = clonePatch(submission);
        if (!canGrade) {
          delete transportSubmission.totalScore;
          delete transportSubmission.overallFeedback;
          delete transportSubmission.gradedBy;
          delete transportSubmission.gradedAt;
          delete transportSubmission.gradeRevision;
          delete transportSubmission.gradeStatus;
          delete transportSubmission.isLate;
          transportSubmission.responses = transportSubmission.responses.map(response => {
            const answerOnly = { ...response };
            delete answerOnly.isCorrect;
            delete answerOnly.score;
            delete answerOnly.teacherFeedback;
            delete answerOnly.needsManualGrading;
            delete answerOnly.isManuallyGraded;
            delete answerOnly.rubricScores;
            return answerOnly;
          });
        }
        const proposedData = clone(data);
        proposedData.submissions ??= [];
        const proposedSubmission: StudentSubmission = existing
          ? { ...clone(existing), ...transportSubmission, responses: clone(transportSubmission.responses) }
          : clone(transportSubmission);
        if (!canGrade && !existing) {
          delete proposedSubmission.totalScore;
          delete proposedSubmission.overallFeedback;
          delete proposedSubmission.gradedBy;
          delete proposedSubmission.gradedAt;
          delete proposedSubmission.gradeRevision;
          delete proposedSubmission.gradeStatus;
          delete proposedSubmission.isLate;
          proposedSubmission.responses = clone(transportSubmission.responses);
        }
        const gradeFingerprint = (candidate: StudentSubmission | undefined) => JSON.stringify(candidate ? {
          totalScore: candidate.totalScore,
          overallFeedback: candidate.overallFeedback,
          gradedBy: candidate.gradedBy,
          gradedAt: candidate.gradedAt,
          gradeStatus: candidate.gradeStatus,
          responses: candidate.responses.map(response => ({
            questionId: response.questionId,
            isCorrect: response.isCorrect,
            score: response.score,
            teacherFeedback: response.teacherFeedback,
            needsManualGrading: response.needsManualGrading === true ? true : undefined,
            isManuallyGraded: response.isManuallyGraded === true ? true : undefined,
            rubricScores: response.rubricScores,
          })),
        } : null);
        const gradeChanged = Boolean(existing && gradeFingerprint(existing) !== gradeFingerprint(proposedSubmission));
        const expectedGradeRevision = (existing?.gradeRevision ?? 0) + (gradeChanged ? 1 : 0);
        if ((proposedSubmission.gradeRevision ?? 0) !== expectedGradeRevision) {
          throw new Error(`Grade revision conflict: expected grade revision ${expectedGradeRevision}. Reload the grade before saving again.`);
        }
        if (gradeChanged && !canGrade) throw new Error('Only authorized course staff can change grading data.');
        if (index < 0) proposedData.submissions.push(proposedSubmission);
        else proposedData.submissions[index] = proposedSubmission;
        assertValidInstitutionState(proposedData, 'submission');
        await client.push({
          entity: 'submission',
          operation: index < 0 ? 'create' : 'update',
          entityId: submission.id,
          payload: {
            ...mutationPayload(transportSubmission),
            expectedRevision: expectedRevision - 1,
            expectedGradeRevision: existing?.gradeRevision ?? 0,
          },
        }, canGrade ? 'grades.write' : 'submissions.write');
        data.submissions ??= [];
        if (index < 0) data.submissions.push(clone(proposedSubmission));
        else data.submissions[index] = clone(proposedSubmission);
        return clone(proposedSubmission);
        });
      },
    },

    gradebook: {
      async createExternalGrade(item, submissions) {
        return client.runExclusiveMutation(async () => {
        const data = await client.getData();
        const entry = getCourse(data, item.courseId);
        if (!entry) throw new Error(`Course "${item.courseId}" was not found.`);
          await requireCourseAccess(data, item.courseId, COURSE_PERMISSION_ROLES.grade);
          requireWritableCourse(entry.course);
          if (data.courses.some(course => course.items.some(existing => existing.id === item.id))) throw new Error(`Content item "${item.id}" already exists.`);
          assertValidCourseState(data, entry.course, [...entry.items, item]);
          if (item.workType !== 'group' && submissions.some(submission => !entry.course.staff.some(member => member.id === submission.studentId && member.role === 'student'))) {
            throw new Error('Every external grade owner must be enrolled as a student in this course.');
          }
          const proposedData = clone(data);
        const proposedEntry = getCourse(proposedData, item.courseId);
        if (!proposedEntry) throw new Error(`Course "${item.courseId}" was not found.`);
        proposedEntry.items.push(clone(item));
        refreshCourseCounts(proposedEntry);
        proposedData.submissions ??= [];
        proposedData.submissions.push(...clone(submissions));
        assertValidInstitutionState(proposedData, 'external grade');
        const invalidPlaceholder = submissions.find(submission => submission.status !== 'submitted'
          || submission.revision !== 1
          || (submission.gradeRevision ?? 0) !== 0
          || submission.attemptNumber !== 1
          || (submission.totalScore !== undefined && submission.totalScore !== 0)
          || submission.gradedBy !== undefined
          || submission.gradedAt !== undefined
          || submission.overallFeedback !== undefined
          || submission.gradeStatus === 'released'
          || submission.responses.some(response => (response.score !== undefined && response.score !== 0)
            || response.isCorrect !== undefined
            || response.teacherFeedback !== undefined
            || response.rubricScores !== undefined));
        if (invalidPlaceholder) {
          throw new Error(`External grade entry "${invalidPlaceholder.id}" must start as an ungraded revision-1 placeholder.`);
        }
        const expectedEntityIds = item.workType === 'group'
          ? entry.course.groupSets
            ?.find(groupSet => groupSet.id === item.groupSetId)?.groups
            .filter(group => group.memberIds.some(memberId => entry.course.staff.some(member => member.id === memberId && member.role === 'student')))
            .map(group => group.id) ?? []
          : entry.course.staff.filter(member => member.role === 'student').map(member => member.id);
        const suppliedEntityIds = submissions.map(submission => item.workType === 'group' ? submission.groupId : submission.studentId);
        if (suppliedEntityIds.some(entityId => !entityId)
          || new Set(suppliedEntityIds).size !== suppliedEntityIds.length
          || expectedEntityIds.length !== suppliedEntityIds.length
          || expectedEntityIds.some(entityId => !suppliedEntityIds.includes(entityId))) {
          throw new Error('External grade creation must atomically include exactly one placeholder for every enrolled student or active assignment group.');
        }
        await client.pushBatch([
          { entity: 'content', operation: 'create', entityId: item.id, payload: { ...item } },
          ...submissions.map(submission => ({
            entity: 'submission' as const,
            operation: 'create' as const,
            entityId: submission.id,
            payload: { ...submission },
          })),
        ], ['content.write', 'grades.write']);
        entry.items.push(clone(item));
        refreshCourseCounts(entry);
        data.submissions ??= [];
        data.submissions.push(...clone(submissions));
        });
      },
    },

    chat: {
      async getDirectoryUsers(userId) {
        const data = await client.getData();
        const sessionUser = await options.getSessionUser();
        if (!sessionUser || sessionUser.id !== userId) throw new Error('Directory request does not match the authenticated session.');
        return clone(projectDirectoryForPrincipal(
          data.users,
          userId,
          data.courses.map(entry => entry.course),
          data.threads,
          data.messages,
          data.submissions,
        ));
      },
      async getThreads(courseId, userId) {
        const data = await client.getData();
        const sessionUser = await options.getSessionUser();
        if (!sessionUser || (userId && userId !== sessionUser.id)) throw new Error('Conversation request does not match the authenticated session.');
        await requireCourseAccess(data, courseId);
        return clone((data.threads ?? [])
          .filter(thread => thread.courseId === courseId && thread.scope !== 'direct')
          .filter(thread => canAccessThread(data, thread, sessionUser.id))
          .map(thread => {
            const threadMessages = (data.messages ?? []).filter(message => message.threadId === thread.id && !message.deletedAt);
            const lastMessage = [...threadMessages].sort((a, b) => b.timestamp - a.timestamp || b.id.localeCompare(a.id))[0];
            return {
              ...thread,
              unreadCount: thread.unreadCount ?? threadMessages.filter(message => message.senderId !== sessionUser.id && !message.readByUserIds?.includes(sessionUser.id)).length,
              lastMessagePreview: thread.lastMessagePreview ?? (lastMessage ? messagePreview(lastMessage) : undefined),
              lastMessageAt: thread.lastMessageAt ?? lastMessage?.timestamp,
            };
          }));
      },
      async getDirectThreads(userId) {
        const data = await client.getData();
        const sessionUser = await options.getSessionUser();
        if (!sessionUser || sessionUser.id !== userId) throw new Error('Direct-message request does not match the authenticated session.');
        return clone((data.threads ?? [])
          .filter(thread => thread.scope === 'direct' && canAccessThread(data, thread, sessionUser.id))
          .map(thread => {
            const threadMessages = (data.messages ?? []).filter(message => message.threadId === thread.id && !message.deletedAt);
            const lastMessage = [...threadMessages].sort((a, b) => b.timestamp - a.timestamp)[0];
            return {
              ...thread,
              unreadCount: thread.unreadCount ?? threadMessages.filter(message => message.senderId !== userId && !message.readByUserIds?.includes(userId)).length,
              lastMessagePreview: thread.lastMessagePreview ?? (lastMessage ? messagePreview(lastMessage) : undefined),
              lastMessageAt: thread.lastMessageAt ?? lastMessage?.timestamp,
            };
          }));
      },
      async getMessages(threadId, userId, request) {
        const data = await client.getData();
        const sessionUser = await options.getSessionUser();
        if (!sessionUser || sessionUser.id !== userId) throw new Error('Message request does not match the authenticated session.');
        const thread = (data.threads ?? []).find(candidate => candidate.id === threadId);
        const accessible = thread && (thread.scope === 'direct'
          ? thread.participantIds?.includes(sessionUser?.id || '')
          : Boolean(sessionUser && canAccessThread(data, thread, sessionUser.id)));
        if (!accessible) throw new Error('Conversation was not found or is not accessible.');
        const normalizedRequest = normalizeChatMessagePageRequest(request);
        if (!loadMessagePage) {
          const page = paginateChatMessages((data.messages ?? []).filter(message => message.threadId === threadId), normalizedRequest);
          return { ...page, messages: clone(page.messages) };
        }
        const response = await loadMessagePage(threadId, normalizedRequest);
        const latestSession = await options.getSessionUser();
        if (!latestSession || latestSession.id !== userId) throw new Error('The authenticated session changed while message history was loading.');
        const envelope = validateChatMessagePageEnvelope(response, normalizedRequest.limit);
        // A bounded page can legitimately refer to an older message that is not
        // resident in the snapshot or this page. Supply only an existence stub
        // for that opaque target; loaded targets still receive full cross-thread,
        // identity, and cycle validation.
        const incomingIds = new Set(envelope.messages.flatMap(candidate => {
          if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
          const id = (candidate as Record<string, unknown>).id;
          return typeof id === 'string' && id.trim() ? [id.trim()] : [];
        }));
        const validationContext = clone(data);
        validationContext.messages ??= [];
        const knownMessageIds = new Set([...(validationContext.messages ?? []).map(message => message.id), ...incomingIds]);
        envelope.messages.forEach(candidate => {
          if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return;
          const raw = candidate as Record<string, unknown>;
          const replyId = typeof raw.replyToMessageId === 'string' ? raw.replyToMessageId.trim() : '';
          const replyThreadId = typeof raw.threadId === 'string' ? raw.threadId.trim() : '';
          if (!replyId || !replyThreadId || knownMessageIds.has(replyId)) return;
          const replyThread = validationContext.threads?.find(thread => thread.id === replyThreadId);
          const course = replyThread?.courseId ? getCourse(validationContext, replyThread.courseId)?.course : undefined;
          const sessionDirectoryUser = validationContext.users.find(user => user.id === latestSession.id);
          const authorizedPlaceholderUser = replyThread?.isAnnouncement || replyThread?.isLocked
            ? course?.staff.find(member => hasCoursePermission(member.role, 'postStaffChat'))
            : sessionDirectoryUser;
          const placeholderUser = authorizedPlaceholderUser ?? sessionDirectoryUser;
          validationContext.messages!.push({
            id: replyId,
            revision: 1,
            threadId: replyThreadId,
            senderId: placeholderUser?.id ?? latestSession.id,
            senderName: placeholderUser?.name ?? latestSession.name,
            role: placeholderUser?.role ?? 'student',
            text: 'Unloaded reply target',
            timestamp: replyThread?.createdAt ?? 0,
            readBy: 0,
          });
          knownMessageIds.add(replyId);
        });
        const validation = validateInstitutionSync({
          schemaVersion: '1.0',
          syncId: 'chat-message-page',
          generatedAt: Date.now(),
          mode: 'upsert',
          institution: data.institution,
          integrations: data.integrations,
          messages: envelope.messages,
        }, validationContext);
        if (!validation.success) throw new Error(`Institution message page is invalid:\n${formatValidationIssues(validation.issues)}`);
        const pageMessages = validation.data.messages ?? [];
        if (pageMessages.some(message => message.threadId !== threadId)) {
          throw new Error('The institution chat-history endpoint returned a message for a different conversation.');
        }
        return {
          messages: clone(pageMessages),
          hasMore: envelope.hasMore,
          nextCursor: envelope.nextCursor,
        };
      },
      async sendMessage(input) {
        return client.runExclusiveMutation(async () => {
        const data = await client.getData();
        const sessionUser = await options.getSessionUser();
        if (!sessionUser || sessionUser.id !== input.senderId) throw new Error('Message sender does not match the authenticated session.');
        const thread = (data.threads ?? []).find(candidate => candidate.id === input.threadId);
        const canAccess = Boolean(thread && canAccessThread(data, thread, sessionUser.id));
        if (!thread || !canAccess) throw new Error('Conversation is not accessible.');
        const membership = findMembership(data, thread.courseId, sessionUser.id);
        const course = thread.courseId ? getCourse(data, thread.courseId)?.course : undefined;
        const directoryUser = data.users.find(user => user.id === sessionUser.id);
        if (!directoryUser) throw new Error('Message sender was not found in the authorized directory.');
        if (!canRolePostToThread(thread, course, membership?.role ?? directoryUser.role)) throw new Error('This conversation is read-only or outside its active course window.');
        if (!input.text.trim() && !input.mediaUrl) throw new Error('A message or attachment is required.');
        if (input.mediaUrl && !isSafeHttpsUrl(input.mediaUrl)) {
          throw new Error('Attachments must be uploaded to institutional storage before sending.');
        }
        if (input.text.length > 20_000) throw new Error('Messages cannot exceed 20,000 characters.');
        if (input.mediaUrl && input.mediaType !== 'image' && input.mediaType !== 'document') throw new Error('An attachment type is required.');
        if (!input.mediaUrl && (input.mediaType || input.mediaName)) throw new Error('Attachment metadata requires an uploaded attachment.');
        if ((input.mediaName?.length || 0) > 1_024) throw new Error('Attachment names cannot exceed 1,024 characters.');
        if (input.mediaUrl && thread.allowAttachments === false) throw new Error('Attachments are disabled for this conversation.');
        const replyTarget = input.replyToMessageId ? data.messages?.find(candidate => candidate.id === input.replyToMessageId) : undefined;
        if (input.replyToMessageId && (!replyTarget || replyTarget.threadId !== thread.id || replyTarget.deletedAt)) throw new Error('The reply target is not available in this conversation.');
        if (input.replyToMessageId && thread.allowReplies === false) throw new Error('Replies are disabled for this conversation.');
        const mentionedUserIds = Array.from(new Set(input.mentionedUserIds || []));
        if (!messageMentionsAreAuthorized({ text: input.text, mentionedUserIds }, thread, course, data.users)) throw new Error('One or more mentioned users are not available in this conversation.');
        const announcementId = input.announcementId?.trim();
        if (announcementId) {
          const previouslyDelivered = data.messages?.find(candidate =>
            candidate.threadId === thread.id && candidate.announcementId === announcementId,
          );
          if (previouslyDelivered) return clone(previouslyDelivered);
          if (data.messages?.some(candidate => candidate.id === announcementId)) {
            throw new Error('The announcement delivery identifier conflicts with an existing message.');
          }
        }
        const clientMessageId = input.clientMessageId?.trim();
        if (input.clientMessageId !== undefined && (!clientMessageId || clientMessageId.length > 256 || /[\u0000-\u001f\u007f]/.test(clientMessageId))) {
          throw new Error('The client message identifier is invalid.');
        }
        const stableMessageId = announcementId || clientMessageId;
        if (stableMessageId && !announcementId) {
          const previousAttempt = data.messages?.find(candidate => candidate.id === stableMessageId);
          if (previousAttempt) {
            if (previousAttempt.threadId === thread.id && previousAttempt.senderId === sessionUser.id) return clone(previousAttempt);
            throw new Error('The client message identifier conflicts with an existing message.');
          }
        }
        const { clientMessageId: _clientMessageId, ...persistedInput } = input;
        const message: ChatMessage = {
          ...persistedInput,
          id: stableMessageId || createEntityId('message'),
          revision: 1,
          timestamp: Date.now(),
          senderName: sessionUser.name,
          role: membership?.role ?? directoryUser.role,
          text: input.text.trim(),
          readByUserIds: [sessionUser.id],
          readBy: 1,
          mentionedUserIds,
          announcementId,
          announcementTitle: input.announcementTitle?.trim(),
          contentItemId: input.contentItemId?.trim(),
        };
        const proposedData = clone(data);
        proposedData.messages ??= [];
        proposedData.messages.push(clone(message));
        const proposedThread = proposedData.threads?.find(candidate => candidate.id === thread.id);
        if (proposedThread) proposedThread.updatedAt = message.timestamp;
        assertValidInstitutionState(proposedData, 'message');
        await client.push({ entity: 'message', operation: 'create', entityId: message.id, payload: { ...message } }, 'chat.write');
        data.messages = mergeById(data.messages ?? [], [clone(message)]);
        const currentThread = (data.threads ?? []).find(candidate => candidate.id === thread.id);
        if (currentThread) {
          currentThread.updatedAt = Math.max(currentThread.updatedAt ?? 0, message.timestamp);
          currentThread.lastMessageAt = message.timestamp;
          currentThread.lastMessagePreview = messagePreview(message);
          currentThread.unreadCount = 0;
        }
        return clone(message);
        });
      },
      async editMessage(messageId, userId, text, expectedRevision, mentionedUserIds) {
        return client.runExclusiveMutation(async () => {
        const data = await client.getData();
        const sessionUser = await options.getSessionUser();
        if (!sessionUser || sessionUser.id !== userId) throw new Error('Message editor does not match the authenticated session.');
        const messageIndex = (data.messages ?? []).findIndex(candidate => candidate.id === messageId);
        const existing = data.messages?.[messageIndex];
        const thread = existing ? data.threads?.find(candidate => candidate.id === existing.threadId) : undefined;
        if (!existing || !thread || !canAccessThread(data, thread, userId)) throw new Error('Message was not found or is not accessible.');
        const membership = findMembership(data, thread.courseId, userId);
        const canEditOfficialAnnouncement = Boolean(thread.isAnnouncement && existing.contentItemId && hasCoursePermission(membership?.role, 'manageContent'));
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
        const course = thread.courseId ? getCourse(data, thread.courseId)?.course : undefined;
        const directoryUser = data.users.find(user => user.id === userId);
        if (!canRolePostToThread(thread, course, membership?.role ?? directoryUser?.role)) {
          throw new Error('Messages cannot be edited while this conversation is read-only or outside its active course window.');
        }
        if (!messageMentionsAreAuthorized({ text: normalizedText, mentionedUserIds: normalizedMentions }, thread, course, data.users)) throw new Error('One or more mentioned users are not available in this conversation.');
        if (normalizedText === existing.text && JSON.stringify(normalizedMentions) === JSON.stringify(existing.mentionedUserIds || [])) return clone(existing);
        const updated: ChatMessage = {
          ...existing,
          text: normalizedText,
          mentionedUserIds: normalizedMentions,
          editedAt: Math.max(Date.now(), (existing.editedAt ?? existing.timestamp) + 1),
          revision: currentRevision + 1,
        };
        const proposedData = clone(data);
        proposedData.messages![messageIndex] = clone(updated);
        assertValidInstitutionState(proposedData, 'message edit');
        await client.push({
          entity: 'message', operation: 'update', entityId: messageId,
          payload: { action: 'edit', expectedRevision, message: updated },
        }, 'chat.write');
        data.messages![messageIndex] = clone(updated);
        return clone(updated);
        });
      },
      async deleteMessage(messageId, userId, expectedRevision) {
        return client.runExclusiveMutation(async () => {
        const data = await client.getData();
        const sessionUser = await options.getSessionUser();
        if (!sessionUser || sessionUser.id !== userId) throw new Error('Message deletion does not match the authenticated session.');
        const messageIndex = (data.messages ?? []).findIndex(candidate => candidate.id === messageId);
        const existing = data.messages?.[messageIndex];
        const thread = existing ? data.threads?.find(candidate => candidate.id === existing.threadId) : undefined;
        if (!existing || !thread || !canAccessThread(data, thread, userId)) throw new Error('Message was not found or is not accessible.');
        const membership = findMembership(data, thread.courseId, userId);
        if (existing.senderId !== userId && !hasCoursePermission(membership?.role, 'moderateChat')) {
          throw new Error('Only the sender or authorized course staff can delete this message.');
        }
        const currentRevision = existing.revision ?? 1;
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== currentRevision) {
          throw new Error(`Message revision conflict: expected revision ${currentRevision}. Refresh the conversation and try again.`);
        }
        if (existing.deletedAt) return clone(existing);
        const updated: ChatMessage = {
          ...existing,
          text: '',
          mediaUrl: undefined,
          mediaType: undefined,
          mediaName: undefined,
          mentionedUserIds: undefined,
          announcementTitle: undefined,
          deletedAt: Math.max(Date.now(), (existing.editedAt ?? existing.timestamp) + 1),
          revision: currentRevision + 1,
        };
        const proposedData = clone(data);
        proposedData.messages![messageIndex] = clone(updated);
        assertValidInstitutionState(proposedData, 'message deletion');
        await client.push({
          entity: 'message', operation: 'update', entityId: messageId,
          payload: { action: 'delete', expectedRevision, deletedAt: updated.deletedAt, revision: updated.revision },
        }, 'chat.write');
        data.messages![messageIndex] = clone(updated);
        return clone(updated);
        });
      },
      async reportMessage(messageId, userId, reason) {
        return client.runExclusiveMutation(async () => {
        const data = await client.getData();
        const sessionUser = await options.getSessionUser();
        if (!sessionUser || sessionUser.id !== userId) throw new Error('Message reporter does not match the authenticated session.');
        const message = (data.messages ?? []).find(candidate => candidate.id === messageId);
        const thread = message ? data.threads?.find(candidate => candidate.id === message.threadId) : undefined;
        if (!message || !thread || message.deletedAt || !canAccessThread(data, thread, userId)) throw new Error('Message was not found or is not accessible.');
        if (message.senderId === userId) throw new Error('You cannot report your own message.');
        const normalizedReason = reason.trim();
        if (normalizedReason.length < 10 || normalizedReason.length > 1_000) throw new Error('A report reason must contain 10–1,000 characters.');
        await client.push({
          entity: 'message', operation: 'update', entityId: messageId,
          payload: { action: 'report', reporterId: userId, reason: normalizedReason },
        }, 'chat.write');
        });
      },
      async createThread(input) {
        return client.runExclusiveMutation(async () => {
        const data = await client.getData();
        const sessionUser = await options.getSessionUser();
        if (!sessionUser || sessionUser.id !== input.createdBy) throw new Error('Conversation creator does not match the authenticated session.');
        const scope = input.scope ?? 'course';
        const participants = Array.from(new Set(input.participantIds ?? []));
        if (scope === 'direct') {
          if (input.courseId || input.groupId || input.groupSetId) throw new Error('Direct conversations cannot carry course-group fields.');
          if (input.isAnnouncement || input.isLocked || input.kind === 'announcements') throw new Error('Direct conversations cannot be announcements or locked topics.');
          if (!participants.includes(sessionUser.id) || participants.length !== 2) {
            throw new Error('A direct conversation must contain the authenticated user and exactly one other participant.');
          }
          const existing = (data.threads ?? []).find(candidate =>
            candidate.scope === 'direct'
            && candidate.participantIds?.length === 2
            && participants.every(id => candidate.participantIds?.includes(id))
          );
          if (existing) return clone(existing);
          if (participants.some(id => !data.users.some(user => user.id === id))) throw new Error('A direct-message participant was not found in the authorized directory.');
        } else if (!input.courseId || !findMembership(data, input.courseId, sessionUser.id)) {
          throw new Error('Conversation creator must be enrolled in the course.');
        }
        const membership = findMembership(data, input.courseId, sessionUser.id);
        const course = input.courseId ? getCourse(data, input.courseId)?.course : undefined;
        if (scope !== 'direct' && (!course || !isCourseOpenAt(course, Date.now()))) {
          throw new Error('Archived courses cannot receive new conversations.');
        }
        if (scope !== 'direct' && !hasCoursePermission(membership?.role, 'manageChat')) {
          throw new Error('Only authorized course staff can create course conversations.');
        }
        if (scope === 'course' && (input.groupId || input.groupSetId)) throw new Error('Course conversations cannot carry group fields.');
        let resolvedGroupSetId = input.groupSetId;
        if (scope === 'group') {
          if (!input.groupId) throw new Error('Group conversations require a group identifier.');
          const group = getGroupFromSet(course, input.groupSetId, input.groupId);
          if (!group) throw new Error('The selected course group could not be resolved.');
          resolvedGroupSetId ||= course?.groupSets?.find(groupSet => groupSet.groups.some(candidate => candidate.id === group.id))?.id;
          if (!STAFF_GRADE_ROLES.has(membership?.role || 'student') && !group.memberIds.includes(sessionUser.id)) {
            throw new Error('Conversation creator is not a member of the selected group.');
          }
          if (participants.some(userId => !course?.staff.some(member => member.id === userId)
            || (!STAFF_GRADE_ROLES.has(course.staff.find(member => member.id === userId)?.role || 'student') && !group.memberIds.includes(userId)))) {
            throw new Error('A group-conversation participant is not staff or a member of the selected group.');
          }
        } else if (participants.some(userId => !course?.staff.some(member => member.id === userId))) {
          throw new Error('A conversation participant is not enrolled in the course.');
        }
        if ((input.isAnnouncement || input.isLocked) && !STAFF_GRADE_ROLES.has(membership?.role || 'student')) {
          throw new Error('Only course staff can create announcement or locked conversations.');
        }
        if (input.title.trim().length > 500) throw new Error('Conversation titles cannot exceed 500 characters.');
        if ((input.description?.length || 0) > 4_000 || (input.guidelines?.length || 0) > 4_000) throw new Error('Conversation descriptions and guidelines cannot exceed 4,000 characters.');
        if (input.opensAt !== undefined && input.closesAt !== undefined && input.opensAt >= input.closesAt) throw new Error('Conversation close time must be after its open time.');
        const createdAt = Date.now();
        const thread: ChatThread = {
          ...input,
          id: createEntityId('thread'),
          createdAt,
          updatedAt: createdAt,
          title: input.title.trim(),
          scope,
          groupSetId: resolvedGroupSetId,
          participantIds: scope === 'direct' ? participants : input.participantIds,
          isAnnouncement: input.kind === 'announcements' ? true : input.isAnnouncement,
          allowStudentPosts: input.kind === 'announcements' ? false : input.allowStudentPosts,
        };
        if (!thread.title) throw new Error('Conversation title is required.');
        const proposedData = clone(data);
        proposedData.threads ??= [];
        proposedData.threads.push(clone(thread));
        assertValidInstitutionState(proposedData, 'conversation');
        await client.push({ entity: 'thread', operation: 'create', entityId: thread.id, payload: { ...thread } }, 'chat.write');
        data.threads = mergeById(data.threads ?? [], [clone(thread)]);
        return clone(thread);
        });
      },
      async markThreadRead(threadId, userId) {
        return client.runExclusiveMutation(async () => {
        const data = await client.getData();
        const sessionUser = await options.getSessionUser();
        if (!sessionUser || sessionUser.id !== userId) throw new Error('Read receipt does not match the authenticated session.');
        const thread = (data.threads ?? []).find(candidate => candidate.id === threadId);
        const canAccess = Boolean(thread && canAccessThread(data, thread, userId));
        if (!thread || !canAccess) throw new Error('Conversation is not accessible.');
        await client.push({ entity: 'thread', operation: 'update', entityId: threadId, payload: { action: 'mark_read', userId } }, 'chat.write');
        (data.messages ?? []).forEach(message => {
          if (message.threadId !== threadId || message.deletedAt) return;
          message.readByUserIds = Array.from(new Set([...(message.readByUserIds ?? []), userId]));
          message.readBy = message.readByUserIds.length;
        });
        thread.unreadCount = 0;
        });
      },
      subscribeToMessages(threadId, userId, onMessages, onError) {
        let disposed = false;
        let unsubscribe: () => void = () => undefined;
        let pollingHandle: ReturnType<typeof setInterval> | undefined;
        const loadAuthorizedThread = async () => {
          const data = await client.getData();
          const sessionUser = await options.getSessionUser();
          if (!sessionUser || sessionUser.id !== userId) throw new Error('Chat subscription does not match the authenticated session.');
          const thread = (data.threads ?? []).find(candidate => candidate.id === threadId);
          if (!sessionUser || !thread || !canAccessThread(data, thread, sessionUser.id)) {
            throw new Error('Conversation was not found or is not accessible.');
          }
          return data;
        };
        void loadAuthorizedThread().then(data => {
          if (disposed) return;
          if (options.subscribeToMessages) {
            unsubscribe = options.subscribeToMessages(threadId, incoming => {
              if (disposed) return;
              void loadAuthorizedThread().then(currentData => {
                if (disposed) return;
                if (!Array.isArray(incoming) || incoming.some(message => message.threadId !== threadId)) {
                  throw new Error('The chat transport returned a message batch for a different conversation.');
                }
                const encoded = JSON.stringify(incoming);
                if (encoded.length > 1_000_000) throw new Error('The chat transport message batch exceeded the 1 MB safety limit.');
                incoming.forEach(message => {
                  const existing = currentData.messages?.find(candidate => candidate.id === message.id);
                  const incomingThread = currentData.threads?.find(candidate => candidate.id === message.threadId);
                  const sender = currentData.users.find(candidate => candidate.id === message.senderId);
                  const senderMembership = findMembership(currentData, incomingThread?.courseId, message.senderId);
                  if (!existing) {
                    if (!incomingThread || !sender || !canAccessThread(currentData, incomingThread, message.senderId)) {
                      throw new Error('The chat transport returned a new message from an unauthorized sender.');
                    }
                    const authoritativeRole = senderMembership?.role ?? sender.role;
                    const course = incomingThread.courseId ? getCourse(currentData, incomingThread.courseId)?.course : undefined;
                    if (message.senderName !== sender.name || message.role !== authoritativeRole
                      || !canRolePostToThread(incomingThread, course, authoritativeRole)) {
                      throw new Error('The chat transport returned a new message with a forged senderName or sender role.');
                    }
                    return;
                  }
                  if (existing.threadId !== message.threadId
                    || existing.senderId !== message.senderId
                    || existing.senderName !== message.senderName
                    || existing.role !== message.role
                    || existing.timestamp !== message.timestamp) {
                    throw new Error('The chat transport attempted to change an existing message identity.');
                  }
                  const existingRevision = existing.revision ?? 1;
                  const incomingRevision = message.revision ?? 1;
                  const contentChanged = existing.text !== message.text
                    || existing.mediaUrl !== message.mediaUrl
                    || existing.mediaType !== message.mediaType
                    || existing.mediaName !== message.mediaName
                    || existing.announcementId !== message.announcementId
                    || existing.announcementTitle !== message.announcementTitle
                    || existing.announcementSeverity !== message.announcementSeverity
                    || existing.contentItemId !== message.contentItemId
                    || existing.editedAt !== message.editedAt
                    || existing.deletedAt !== message.deletedAt
                    || JSON.stringify(existing.mentionedUserIds ?? []) !== JSON.stringify(message.mentionedUserIds ?? []);
                  if (incomingRevision < existingRevision || (contentChanged && incomingRevision <= existingRevision)) {
                    throw new Error('The chat transport returned stale message content without advancing its revision.');
                  }
                  if (existing.deletedAt !== undefined && message.deletedAt === undefined) {
                    throw new Error('The chat transport attempted to restore a deleted message tombstone.');
                  }
                  if (existing.editedAt !== undefined && (message.editedAt === undefined || message.editedAt < existing.editedAt)) {
                    throw new Error('The chat transport attempted to roll back a message edit timestamp.');
                  }
                  if (existing.deletedAt !== undefined && message.deletedAt !== undefined && message.deletedAt < existing.deletedAt) {
                    throw new Error('The chat transport attempted to roll back a message deletion timestamp.');
                  }
                  const incomingReaders = new Set(message.readByUserIds ?? []);
                  if (message.readBy < existing.readBy || existing.readByUserIds?.some(userId => !incomingReaders.has(userId))) {
                    throw new Error('The chat transport attempted to roll back message read receipts.');
                  }
                });
                const sanitizedIncoming = incoming.map(message => message.deletedAt === undefined ? message : {
                  ...message,
                  text: '',
                  mediaUrl: undefined,
                  mediaType: undefined,
                  mediaName: undefined,
                  mentionedUserIds: undefined,
                  announcementTitle: undefined,
                });
                const unreadBefore = (currentData.messages ?? []).filter(message =>
                  message.threadId === threadId
                  && !message.deletedAt
                  && message.senderId !== userId
                  && !message.readByUserIds?.includes(userId),
                ).length;
                const proposedData = clone(currentData);
                proposedData.messages = mergeById(proposedData.messages ?? [], clone(sanitizedIncoming));
                assertValidInstitutionState(proposedData, 'real-time chat');
                currentData.messages = proposedData.messages;
                const currentThread = currentData.threads?.find(candidate => candidate.id === threadId);
                if (currentThread) {
                  const residentMessages = currentData.messages.filter(message => message.threadId === threadId && !message.deletedAt);
                  const latest = [...residentMessages].sort((left, right) => right.timestamp - left.timestamp || right.id.localeCompare(left.id))[0];
                  const unreadAfter = residentMessages.filter(message =>
                    message.senderId !== userId && !message.readByUserIds?.includes(userId),
                  ).length;
                  const currentUnread = currentThread.unreadCount ?? unreadBefore;
                  currentThread.unreadCount = Math.max(0, currentUnread + unreadAfter - unreadBefore);
                  if (latest && latest.timestamp >= (currentThread.lastMessageAt ?? 0)) {
                    currentThread.lastMessageAt = latest.timestamp;
                    currentThread.lastMessagePreview = messagePreview(latest);
                    currentThread.updatedAt = Math.max(currentThread.updatedAt ?? 0, latest.timestamp);
                  }
                }
                onMessages(clone(sanitizedIncoming));
              }).catch(error => {
                if (!disposed) onError?.(error instanceof Error ? error : new Error('The chat transport returned invalid data.'));
              });
            }, onError);
            return;
          }
          // Institutions without WebSocket/SSE support still receive bounded
          // snapshot polling instead of silently presenting permanently stale chat.
          const pollEveryMs = Math.max(5_000, options.snapshotTtlMs ?? 60_000);
          const poll = () => {
            void loadAuthorizedThread().then(nextData => {
              if (!disposed) onMessages(clone((nextData.messages ?? []).filter(message => message.threadId === threadId)));
            }).catch(error => {
              if (!disposed) onError?.(error instanceof Error ? error : new Error('The chat polling connection failed.'));
            });
          };
          onMessages(clone((data.messages ?? []).filter(message => message.threadId === threadId)));
          pollingHandle = setInterval(poll, pollEveryMs);
        }).catch(error => {
          if (!disposed) onError?.(error instanceof Error ? error : new Error('The chat subscription could not be authorized.'));
        });
        return () => {
          disposed = true;
          unsubscribe();
          if (pollingHandle !== undefined) clearInterval(pollingHandle);
        };
      },
    },
    liveSessions,
  };
};

export const configureInstitutionRepositories = (options: InstitutionRepositoryOptions) => {
  const factory = createInstitutionRepositoryFactory(options);
  configureRepositoryFactory(factory);
  return factory;
};
