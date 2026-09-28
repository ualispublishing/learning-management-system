/**
 * @fileoverview Composed LMS application store.
 *
 * Reviewer notes:
 * - Combines auth, course, content, and chat slices into the state consumed by
 *   route and LMS components.
 * - Principal switching is security-sensitive: account changes must clear
 *   scoped data before loading or restoring another user's snapshot.
 * - Institution import and shared-demo refreshes flow through this store so UI
 *   callers do not bypass repository or authorization boundaries.
 */
import { create } from 'zustand';
import { AuthSlice, createAuthSlice } from './slices/authSlice';
import { CourseSlice, createCourseSlice } from './slices/courseSlice';
import { ContentSlice, createContentSlice } from './slices/contentSlice';
import { ChatSlice, createChatSlice } from './slices/chatSlice';
import { repoFactory } from '../repositories/factory';
import { isSharedDemoMode } from '../repositories/remote/SharedDemoRepositoryFactory';
import {
  clearInstitutionJSON,
  cacheInstitutionJSON,
  consumeInstitutionSnapshotWarning,
  importInstitutionJSON,
  InstitutionImportReport,
  restoreInstitutionJSON,
} from '../integration/institutionSync';
import { assertPrincipalScopedSnapshot, projectPrincipalScopedSnapshot } from '../integration/InstitutionRepositoryFactory';
import { ChatMessage, ChatThread, ContentItem, CourseUser } from '../../types/lms';
import { getGroupFromSet, normalizeContentGroupLabels, userBelongsToSubmissionGroup } from '../groups/courseGroups';
import { hasCoursePermission } from '../authorization/coursePermissions';
import { advancePrincipalGeneration, capturePrincipalGeneration, isPrincipalGenerationCurrent } from './principalGeneration';
import { institutionFlashcardPrincipal, setFlashcardPrincipal } from '../db/principal';
import { projectDirectoryForPrincipal } from '../privacy/principalDirectory';
import { getLearningStateService } from '../learningState';

export interface LMSState extends AuthSlice, CourseSlice, ContentSlice, ChatSlice {
  // Any generic UI state
  lastSelectedDatePerCourse: Record<string, string>;
  setLastSelectedDate: (courseId: string, date: string) => void;
  initializeMocks: () => Promise<void>; // Backwards-compatible demo initialization entry point.
  refreshSharedDemoState: () => Promise<void>;
  importInstitutionPayload: (payload: unknown) => Promise<InstitutionImportReport>;
  institutionImportError: string | null;
  clearInstitutionImportError: () => void;
  lastInstitutionImport: InstitutionImportReport | null;
  initializedPrincipalId: string | null;
  institutionDataSource: 'network' | 'offline-cache' | null;
  institutionDataWarning: string | null;
  clearInstitutionDataWarning: () => void;
  updateContentGrouping: (courseId: string, labels: string[], changes: { itemId: string; updates: Partial<ContentItem> }[]) => Promise<void>;
}

let initializationEpoch = 0;
const isDevelopmentBuild = typeof __DEV__ !== 'undefined' && __DEV__;

const selectFlashcardPrincipal = (institutionUserId?: string | null) => {
  // Authenticated demo account switching must exercise the same shared-device
  // isolation as production. Only the signed-out/standalone flashcard surface
  // uses the device-local principal.
  setFlashcardPrincipal(institutionUserId
    ? institutionFlashcardPrincipal(institutionUserId)
    : null);
};

const clearedPrincipalData = () => ({
  courses: [],
  contentItems: [],
  submissions: [],
  threads: [],
  directThreads: [],
  directoryUsers: [],
  messages: {},
  messagePagination: {},
  popQuizState: null,
  dismissedAnnouncements: [],
  courseMutationError: null,
  contentMutationError: null,
  liveSessionError: null,
  chatError: null,
  chatErrorSource: null,
  announcementReconciliationIssues: {},
  institutionImportError: null,
  lastInstitutionImport: null,
  lastSelectedDatePerCourse: {},
  institutionDataSource: null as 'network' | 'offline-cache' | null,
  institutionDataWarning: null as string | null,
});

export const useLMSStore = create<LMSState>()((...a) => ({
  ...createAuthSlice(...a),
  ...createCourseSlice(...a),
  ...createContentSlice(...a),
  ...createChatSlice(...a),

  lastSelectedDatePerCourse: {},
  setLastSelectedDate: (courseId, date) => a[0]((state) => ({
    lastSelectedDatePerCourse: { ...state.lastSelectedDatePerCourse, [courseId]: date }
  })),

  institutionImportError: null,
  clearInstitutionImportError: () => a[0]({ institutionImportError: null }),
  lastInstitutionImport: null,
  initializedPrincipalId: null,
  institutionDataSource: null,
  institutionDataWarning: null,
  clearInstitutionDataWarning: () => a[0]({ institutionDataWarning: null }),

  updateContentGrouping: async (courseId, labels, changes) => {
    try {
      const normalizedLabels = normalizeContentGroupLabels(labels);
      await repoFactory.content.updateContentGrouping(courseId, normalizedLabels, changes);
      const changesById = new Map(changes.map(change => [change.itemId, change.updates]));
      a[0](state => ({
        courses: state.courses.map(course => course.id === courseId ? {
          ...course,
          metadata: { ...(course.metadata || {}), lmsGroupLabels: normalizedLabels },
        } : course),
        contentItems: state.contentItems.map(item => {
          const updates = changesById.get(item.id);
          return updates ? { ...item, ...updates, id: item.id } : item;
        }),
        contentMutationError: null,
        courseMutationError: null,
      }));
    } catch (error) {
      a[0]({ contentMutationError: error instanceof Error ? error.message : 'Content grouping could not be saved atomically.' });
      throw error;
    }
  },

  login: async (email) => {
    const requestEpoch = ++initializationEpoch;
    advancePrincipalGeneration();
    selectFlashcardPrincipal(null);
    const priorPrincipalId = a[1]().currentUserId;
    a[0]({
      ...clearedPrincipalData(),
      currentUserId: null,
      currentUserName: null,
      currentUserEmail: null,
      currentUserRole: 'student',
      currentUserGlobalRole: 'user',
      initializedPrincipalId: null,
    });
    try {
      const { user, defaultRole } = await repoFactory.auth.login(email);
      const authoritativeUser = await repoFactory.auth.getCurrentUser();
      if (requestEpoch !== initializationEpoch || authoritativeUser?.id !== user.id) {
        throw new Error('The authenticated session changed while sign-in was in progress.');
      }
      selectFlashcardPrincipal(authoritativeUser.id);
      if (priorPrincipalId && priorPrincipalId !== user.id) await clearInstitutionJSON(priorPrincipalId);
      const cacheWarning = priorPrincipalId ? consumeInstitutionSnapshotWarning(priorPrincipalId) : null;
      if (requestEpoch !== initializationEpoch) {
        throw new Error('The authenticated session changed while sign-in was in progress.');
      }
      a[0]({
        currentUserRole: defaultRole,
        currentUserGlobalRole: authoritativeUser.globalRole,
        currentUserId: authoritativeUser.id,
        currentUserName: authoritativeUser.name,
        currentUserEmail: authoritativeUser.email ?? null,
        institutionDataWarning: cacheWarning,
      });
    } catch (error) {
      // A newer login/logout owns the current session and state. A stale
      // completion must not log that newer principal out or clear its cache.
      if (requestEpoch !== initializationEpoch) {
        throw new Error('The authenticated session changed while sign-in was in progress.');
      }
      let logoutFailed = false;
      try {
        await repoFactory.auth.logout();
      } catch {
        logoutFailed = true;
      }
      if (priorPrincipalId) await clearInstitutionJSON(priorPrincipalId);
      const cacheWarning = priorPrincipalId ? consumeInstitutionSnapshotWarning(priorPrincipalId) : null;
      if (cacheWarning) a[0]({ institutionDataWarning: cacheWarning });
      if (logoutFailed) {
        const loginMessage = error instanceof Error ? error.message : 'Account sign-in failed.';
        throw new Error(`${loginMessage} The previous server session could not be closed; close the app and contact your institution administrator.`);
      }
      throw error;
    }
  },

  logout: async () => {
    const requestEpoch = ++initializationEpoch;
    advancePrincipalGeneration();
    selectFlashcardPrincipal(null);
    const principalId = a[1]().currentUserId;
    // Remove principal-scoped data before waiting for a remote SSO logout.
    a[0]({
      ...clearedPrincipalData(),
      currentUserId: null,
      currentUserName: null,
      currentUserEmail: null,
      currentUserRole: 'student',
      currentUserGlobalRole: 'user',
      initializedPrincipalId: null,
    });
    let logoutError: unknown;
    try {
      await repoFactory.auth.logout();
    } catch (error) {
      logoutError = error;
    }
    if (principalId) await clearInstitutionJSON(principalId);
    const cacheWarning = principalId ? consumeInstitutionSnapshotWarning(principalId) : null;
    if (requestEpoch === initializationEpoch && cacheWarning) a[0]({ institutionDataWarning: cacheWarning });
    if (logoutError) throw logoutError;
  },

  initializeMocks: async () => {
    const requestEpoch = ++initializationEpoch;
    const sessionUser = await repoFactory.auth.getCurrentUser();
    const activeUserId = sessionUser?.id || (isDevelopmentBuild && !isSharedDemoMode ? a[1]().currentUserId : null);
    if (!activeUserId) {
      selectFlashcardPrincipal(null);
      if (requestEpoch !== initializationEpoch) return;
      a[0]({
        ...clearedPrincipalData(), currentUserId: null, currentUserName: null, currentUserEmail: null,
        currentUserRole: 'student', currentUserGlobalRole: 'user',
        initializedPrincipalId: null,
      });
      return;
    }
    selectFlashcardPrincipal(activeUserId);
    const dismissedAnnouncementsPromise = getLearningStateService()
      .load({ principalId: activeUserId }, 'announcement-dismissals')
      .catch(() => null);
    if (a[1]().currentUserId && a[1]().currentUserId !== activeUserId) advancePrincipalGeneration();
    if (a[1]().initializedPrincipalId !== activeUserId) {
      // Never allow principal-scoped course, grade, or conversation state to
      // survive an account switch while the next repository snapshot loads.
      // Clearing currentUserId also forces principal-scoped screen effects to
      // refetch after the authoritative snapshot commits; otherwise a chat
      // fetch can race this reset and leave the new account with an empty view.
      a[0]({
        ...clearedPrincipalData(),
        currentUserId: null,
        currentUserName: null,
        currentUserEmail: null,
        currentUserRole: 'student',
        currentUserGlobalRole: 'user',
        initializedPrincipalId: null,
      });
    }
    let restored = await restoreInstitutionJSON(activeUserId);
    let restoreWarning = consumeInstitutionSnapshotWarning(activeUserId);
    if (restored) {
      try {
        assertPrincipalScopedSnapshot(restored, { id: activeUserId });
        restored = projectPrincipalScopedSnapshot(restored, { id: activeUserId });
        await cacheInstitutionJSON(activeUserId, restored);
        restoreWarning = consumeInstitutionSnapshotWarning(activeUserId) ?? restoreWarning;
      } catch {
        await clearInstitutionJSON(activeUserId);
        consumeInstitutionSnapshotWarning(activeUserId);
        restored = null;
        restoreWarning = 'An offline snapshot outside the signed-in user’s authorization scope was rejected and erased.';
      }
    }

    let courses;
    let contentItems;
    let submissions;
    let threads: ChatThread[] = [];
    let directThreads: ChatThread[] = [];
    let directoryUsers: CourseUser[] = [];
    let messages: Record<string, ChatMessage[]> = {};
    let institutionDataSource: 'network' | 'offline-cache' = 'network';
    let institutionDataWarning = restoreWarning;
    try {
      courses = await repoFactory.courses.getCoursesForUser(activeUserId);
      const allItems = await Promise.all(courses.map(course => repoFactory.content.getContentItems(course.id)));
      contentItems = allItems.flat();
      submissions = await repoFactory.submissions.getSubmissionsForCourses(courses.map(course => course.id));
      institutionDataWarning = consumeInstitutionSnapshotWarning(activeUserId) ?? institutionDataWarning;
    } catch (networkError) {
      if (!restored) throw networkError;
      institutionDataSource = 'offline-cache';
      courses = restored.courses.map(entry => entry.course);
      contentItems = restored.courses.flatMap(entry => entry.items);
      submissions = restored.submissions ?? [];
      threads = (restored.threads ?? []).filter(thread => thread.scope !== 'direct');
      directThreads = (restored.threads ?? []).filter(thread => thread.scope === 'direct');
      directoryUsers = projectDirectoryForPrincipal(
        restored.users,
        activeUserId,
        courses,
        restored.threads,
        restored.messages,
        restored.submissions,
      );
      messages = (restored.messages ?? []).reduce<Record<string, ChatMessage[]>>((byThread, message) => {
        if (message.deletedAt) return byThread;
        (byThread[message.threadId] ??= []).push(message);
        return byThread;
      }, {});
      Object.values(messages).forEach(threadMessages => threadMessages.sort((left, right) => left.timestamp - right.timestamp));
      const reason = isDevelopmentBuild && networkError instanceof Error
        ? networkError.message
        : 'The institution connection is unavailable.';
      institutionDataWarning = `Offline mode: showing the last encrypted institution snapshot, which may be stale. Changes are unavailable until reconnection. (${reason})`;
    }

    const [latestSession, dismissalRecord] = await Promise.all([
      repoFactory.auth.getCurrentUser(),
      dismissedAnnouncementsPromise,
    ]);
    if (requestEpoch !== initializationEpoch || latestSession?.id !== activeUserId) return;
    const defaultRole = courses.flatMap(course => course.staff).find(member => member.id === activeUserId)?.role ?? 'student';
    // Garbage collect discarded drafts only after the documented 24-hour recovery window.
    const now = Date.now();
    const cleanSubmissions = submissions.filter(sub => {
      if (sub.status === 'discarded' && sub.deletedAt && sub.deletedAt < now - 24 * 60 * 60 * 1000) {
        return false;
      }
      return true;
    });

    a[0]({
      courses,
      contentItems,
      submissions: cleanSubmissions,
      threads,
      directThreads,
      directoryUsers,
      messages,
      dismissedAnnouncements: dismissalRecord?.payload.ids ?? [],
      currentUserId: activeUserId,
      currentUserName: latestSession.name,
      currentUserEmail: latestSession.email ?? null,
      currentUserRole: defaultRole,
      currentUserGlobalRole: latestSession.globalRole,
      initializedPrincipalId: activeUserId,
      institutionDataSource,
      institutionDataWarning,
    });
  },

  refreshSharedDemoState: async () => {
    const generation = capturePrincipalGeneration();
    const activeUserId = a[1]().currentUserId;
    if (!activeUserId) return;
    try {
      const courses = await repoFactory.courses.getCoursesForUser(activeUserId);
      const [contentLists, submissions, directoryUsers, directThreads, threadLists] = await Promise.all([
        Promise.all(courses.map(course => repoFactory.content.getContentItems(course.id))),
        repoFactory.submissions.getSubmissionsForCourses(courses.map(course => course.id)),
        repoFactory.chat.getDirectoryUsers(activeUserId),
        repoFactory.chat.getDirectThreads(activeUserId),
        Promise.all(courses.map(course => repoFactory.chat.getThreads(course.id, activeUserId))),
      ]);
      if (!isPrincipalGenerationCurrent(generation) || a[1]().currentUserId !== activeUserId) return;
      a[0]({
        courses,
        contentItems: contentLists.flat(),
        submissions,
        directoryUsers,
        directThreads,
        threads: Array.from(new Map(threadLists.flat().map(thread => [thread.id, thread])).values()),
        courseMutationError: null,
        contentMutationError: null,
      });
    } catch (error) {
      if (!isPrincipalGenerationCurrent(generation) || a[1]().currentUserId !== activeUserId) return;
      a[0]({ institutionDataWarning: error instanceof Error
        ? `Shared demo refresh failed: ${error.message}`
        : 'Shared demo refresh failed.' });
    }
  },

  importInstitutionPayload: async (payload) => {
    try {
      if (!isDevelopmentBuild) throw new Error('Client-side institution JSON import is disabled in production. Use the authenticated synchronization gateway.');
      const activeUserId = a[1]().currentUserId;
      const { report, data, submissions } = await importInstitutionJSON(payload);
      const visibleCourses = data.courses
        .map(entry => entry.course)
        .filter(course => !activeUserId || course.staff.some(user => user.id === activeUserId));
      const visibleCourseIds = new Set(visibleCourses.map(course => course.id));
      const importedItems = data.courses
        .filter(entry => visibleCourseIds.has(entry.course.id))
        .flatMap(entry => entry.items);
      const mergeById = <T extends { id: string }>(existing: T[], incoming: T[]) =>
        Array.from(new Map([...existing, ...incoming].map(entry => [entry.id, entry])).values());
      const visibleCourseList = data.mode === 'snapshot'
        ? visibleCourses
        : mergeById(a[1]().courses, visibleCourses);
      const visibleContentItems = data.mode === 'snapshot'
        ? importedItems
        : mergeById(a[1]().contentItems, importedItems);
      const visibleSubmissions = submissions.filter(submission => {
        if (!activeUserId || !visibleCourseIds.has(submission.courseId)) return false;
        const course = visibleCourses.find(candidate => candidate.id === submission.courseId);
        const membership = course?.staff.find(member => member.id === activeUserId);
        if (!membership) return false;
        if (hasCoursePermission(membership.role, 'grade')) return true;
        return submission.studentId === activeUserId
          || userBelongsToSubmissionGroup(
            course,
            importedItems.find(item => item.id === submission.contentItemId),
            activeUserId,
            submission.groupId,
          );
      });
      const nextSubmissions = data.mode === 'snapshot'
        ? visibleSubmissions
        : mergeById(a[1]().submissions, visibleSubmissions);
      const importedThreads = data.threads || [];
      const courseThreads = importedThreads.filter(thread => {
        if (thread.scope === 'direct' || !activeUserId || !thread.courseId || !visibleCourseIds.has(thread.courseId)) return false;
        if (thread.scope !== 'group') return true;
        const course = visibleCourses.find(candidate => candidate.id === thread.courseId);
        const membership = course?.staff.find(member => member.id === activeUserId);
        return Boolean(membership && (
          hasCoursePermission(membership.role, 'postStaffChat')
          || thread.participantIds?.includes(activeUserId)
          || getGroupFromSet(course, thread.groupSetId, thread.groupId)?.memberIds.includes(activeUserId)
        ));
      });
      const directThreads = importedThreads.filter(thread => thread.scope === 'direct' && (!activeUserId || thread.participantIds?.includes(activeUserId)));
      a[0]({
        courses: visibleCourseList,
        contentItems: visibleContentItems,
        submissions: nextSubmissions,
        threads: data.mode === 'snapshot' ? courseThreads : mergeById(a[1]().threads, courseThreads),
        directThreads: data.mode === 'snapshot' ? directThreads : mergeById(a[1]().directThreads, directThreads),
        messages: {},
        messagePagination: {},
        institutionImportError: null,
        lastInstitutionImport: report,
      });
      return report;
    } catch (error) {
      a[0]({ institutionImportError: error instanceof Error ? error.message : 'Institution data import failed.' });
      throw error;
    }
  }
}));
