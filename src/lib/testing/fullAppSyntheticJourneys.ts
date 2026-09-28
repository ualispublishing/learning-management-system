/**
 * @fileoverview src/lib/testing/fullAppSyntheticJourneys.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import institutionFixture from '../../../docs/institution-sync.example.json';
import type { Card, Deck, DepthLayer, Note } from '../../types';
import { CardState } from '../../types';
import type { ChatMessage, ChatThread, ContentItem, Course, CourseRole, QuizQuestion } from '../../types/lms';
import {
  attachAIProcessingAttestation,
  beginAIRequestSession,
  completeAIRequestSession,
  createAIProcessingAttestation,
  createAIRequestSessionState,
  resetAIRequestSession,
  runAttestedAIRequest,
} from '../ai/processingConsent';
import { getAssignableCourseRoles } from '../authorization/courseRoleManagement';
import {
  buildCourseAnnouncementChatRoute,
  restoreWithdrawnAnnouncementAsContent,
} from '../chat/announcements';
import { getCourseCardActionDescriptors } from '../courseCardActions';
import {
  buildCoursePresentationBuckets,
} from '../coursePresentationBuckets';
import {
  getCourseSitePresentationMode,
  isRenderableCustomCoursePresentationItem,
} from '../coursePresentation';
import { parseFlashcardCSV, serializeFlashcardCSV } from '../db/csv';
import {
  filterBrowsableCards,
  filterDeckLibrary,
  moveBrowsableCard,
  rollbackBrowsableCardOrder,
  runExclusiveFlashcardAction,
  type BrowsableCardItem,
} from '../flashcardLibrary';
import { createInstitutionRepositoryFactory } from '../integration/InstitutionRepositoryFactory';
import type { PushMutation } from '../integration/InstitutionAdapter';
import { EXTERNAL_SITE_SANDBOX } from '../externalSiteSecurity';
import { clampAppContentWidth, resolveAppCanvasMaxWidth } from '../appCanvasWidth';
import { configureRepositoryFactory, repoFactory } from '../repositories/factory';
import type { RepositoryFactory } from '../repositories/interfaces';
import { demoContentItems, demoCourses } from '../repositories/memory/demoData';
import { advancePrincipalGeneration } from '../store/principalGeneration';
import { useLMSStore } from '../store/useLMSStore';
import { normalizeStudyRoute } from '../studyRoute';
import { staticWidgetDocument } from '../staticWidget';
import {
  assertSyntheticJourneyCoverage,
  assertSyntheticJourneySummary,
  inspectSyntheticJourneyCoverage,
  SyntheticJourneyRecorder,
  syntheticObservation,
  type SyntheticJourneyCoverage,
  type SyntheticJourneyEvent,
  type SyntheticJourneyLifecycleEvent,
  type SyntheticJourneyPlanContract,
  type SyntheticJourneySink,
  type SyntheticJourneySummary,
} from './syntheticJourneyTelemetry';

const COURSE_ID = 'course-chem-101';
const SYNTHETIC_STUDENT_ID = 'student-200';
const ROLES: CourseRole[] = ['student', 'ta', 'teacher', 'it', 'admin'];

const ACTORS: Record<CourseRole, { id: string; name: string; email?: string; role: CourseRole }> = {
  student: { id: SYNTHETIC_STUDENT_ID, name: 'Sam Student', role: 'student' },
  ta: { id: 'ta-300', name: 'Taylor Assistant', email: 'taylor.ta@example.edu', role: 'ta' },
  teacher: { id: 'teacher-100', name: 'Ada Teacher', email: 'ada.teacher@example.edu', role: 'teacher' },
  it: { id: 'it-400', name: 'Riley IT', email: 'riley.it@example.edu', role: 'it' },
  admin: { id: 'admin-500', name: 'Avery Administrator', email: 'avery.admin@example.edu', role: 'admin' },
};

const EXPECTED_COURSE_ACTIONS: Record<CourseRole, string[]> = {
  student: ['info', 'syllabus', 'student_grades', 'contact'],
  ta: ['info', 'syllabus', 'grading', 'analytics', 'roster', 'contact'],
  teacher: ['info', 'syllabus', 'grading', 'settings', 'analytics', 'roster', 'contact'],
  it: ['info', 'syllabus', 'settings', 'roster', 'contact'],
  admin: ['info', 'syllabus', 'grading', 'settings', 'analytics', 'roster', 'contact'],
};

const ROLE_STEPS = ['load', 'content-action', 'course-action', 'topic-action', 'roster-action', 'cleanup'] as const;
const PRESENTATION_STEPS = ['timeline-model', 'sequential-model', 'linked-site', 'static-widget', 'responsive-canvas'] as const;
const ANNOUNCEMENT_STEPS = [
  'load',
  'create-content',
  'publish-chat',
  'exact-navigation',
  'admin-edit',
  'chat-edit',
  'withdraw',
  'retry-reconciliation',
] as const;
const FLASHCARD_STEPS = ['library-filter', 'card-filter', 'reorder-rollback', 'csv-roundtrip', 'duplicate-activation', 'route-contract'] as const;
const AI_STEPS = ['deny-without-consent', 'attested-request', 'duplicate-start', 'stale-completion', 'publish-provenance'] as const;

export const FULL_APP_SYNTHETIC_LIMITATIONS = [
  'real-click-to-paint-and-core-web-vitals',
  'pixel-layout-iframe-scroll-and-provider-framing',
  'keyboard-focus-order-and-screen-reader-speech',
  'native-permission-sheets-media-and-notification-delivery',
  'physical-device-interruption-backgrounding-and-memory-pressure',
  'human-comprehension-hesitation-abandonment-and-satisfaction',
] as const;

interface FixtureEnrollment {
  userId: string;
  courseRole: CourseRole;
  secondaryRoles?: string[];
}

interface FixtureCourseEntry {
  course: Course;
  enrollments: FixtureEnrollment[];
  items: ContentItem[];
}

interface FixtureSnapshot {
  users: { id: string; name: string; email?: string; role: CourseRole }[];
  courses: FixtureCourseEntry[];
  threads: ChatThread[];
  messages: ChatMessage[];
  submissions: unknown[];
  generatedAt: number;
}

interface RoleHarness {
  actor: (typeof ACTORS)[CourseRole];
  factory: RepositoryFactory;
  pushes: PushMutation[];
}

export interface FullAppSyntheticJourneyOptions {
  iterations?: number;
  runId?: string;
  now?: () => number;
  sink?: SyntheticJourneySink;
  lifecycleSink?: (event: SyntheticJourneyLifecycleEvent) => void;
}

export interface FullAppSyntheticJourneyResult {
  summary: SyntheticJourneySummary;
  coverage: SyntheticJourneyCoverage;
  events: readonly SyntheticJourneyEvent[];
  contracts: readonly SyntheticJourneyPlanContract[];
  limitations: readonly string[];
}

const newContent = (id: string): ContentItem => ({
  id,
  courseId: COURSE_ID,
  category: 'material',
  title: 'Synthetic content item',
  description: 'Synthetic repository journey content.',
  presentationSlot: 'current',
  createdAt: Date.now(),
});

const cloneFixtureForRole = (role: CourseRole): FixtureSnapshot => {
  const source = structuredClone(institutionFixture) as unknown as FixtureSnapshot;
  const now = Date.now();
  const entry = source.courses[0];
  entry.course.status = 'active';
  entry.course.termStart = now - 86_400_000;
  entry.course.termEnd = now + 180 * 86_400_000;
  entry.course.announcements.forEach((announcement, index) => {
    announcement.createdAt = now - (index + 3) * 60_000;
  });
  entry.items.forEach((item, index) => {
    item.createdAt = now - (index + 10) * 60_000;
    item.questions?.forEach((question: QuizQuestion) => {
      delete question.correctAnswer;
      if (question.customConfig) delete question.customConfig.testCases;
    });
  });
  source.submissions = [];
  source.generatedAt = now;

  for (const actor of Object.values(ACTORS)) {
    if (!source.users.some(user => user.id === actor.id)) source.users.push({ ...actor });
    if (!entry.enrollments.some(enrollment => enrollment.userId === actor.id)) {
      entry.enrollments.push({ userId: actor.id, courseRole: actor.role });
    }
  }

  source.threads.forEach((thread, index) => {
    thread.createdAt = now - (index + 20) * 60_000;
    if (thread.courseId) {
      thread.opensAt = now - 60_000;
      thread.closesAt = now + 120 * 86_400_000;
    }
  });
  source.threads.push({
    id: 'thread-general-synthetic',
    courseId: COURSE_ID,
    title: 'Synthetic general forum',
    description: 'Synthetic journey conversation.',
    guidelines: 'Use synthetic data only.',
    kind: 'discussion',
    isAnnouncement: false,
    isPinned: false,
    allowStudentPosts: true,
    allowReplies: true,
    allowAttachments: true,
    allowMentions: true,
    scope: 'course',
    createdBy: ACTORS.teacher.id,
    createdAt: now - 50_000,
  });
  source.messages.forEach((message, index) => {
    message.timestamp = now - (index + 5) * 60_000;
  });
  source.messages.push({
    id: 'message-general-synthetic',
    revision: 1,
    threadId: 'thread-general-synthetic',
    senderId: ACTORS.teacher.id,
    senderName: ACTORS.teacher.name,
    role: 'teacher',
    text: 'Synthetic welcome message.',
    timestamp: now - 20_000,
    readBy: 1,
    readByUserIds: [ACTORS.teacher.id],
  });

  const principal = ACTORS[role];
  source.threads = source.threads.filter(thread => {
    if (thread.scope === 'direct') return thread.participantIds?.includes(principal.id) === true;
    if (thread.scope !== 'group') return true;
    return ['ta', 'teacher', 'admin'].includes(principal.role)
      || thread.participantIds?.includes(principal.id) === true;
  });
  const authorizedThreadIds = new Set(source.threads.map(thread => thread.id));
  source.messages = source.messages.filter(message => authorizedThreadIds.has(message.threadId));
  return source;
};

const hydrateRoleHarness = async (role: CourseRole): Promise<RoleHarness> => {
  const source = cloneFixtureForRole(role);
  const pushes: PushMutation[] = [];
  const actor = ACTORS[role];
  const factory = createInstitutionRepositoryFactory({
    initialSnapshot: source,
    adapter: {
      async pullSnapshot() { return structuredClone(source); },
      async pushMutations(mutations) {
        pushes.push(...structuredClone(mutations));
        return { acceptedIds: mutations.map(mutation => mutation.id), rejected: [] };
      },
    },
    getSessionUser: async () => ({
      id: actor.id,
      name: actor.name,
      email: actor.email,
      globalRole: actor.role === 'admin' ? 'admin' : 'user',
    }),
  });

  configureRepositoryFactory(factory);
  advancePrincipalGeneration();
  const courses = await factory.courses.getCoursesForUser(actor.id);
  const contentItems = (await Promise.all(courses.map(course => factory.content.getContentItems(course.id)))).flat();
  const threads = (await Promise.all(courses.map(course => factory.chat.getThreads(course.id, actor.id)))).flat();
  const directThreads = await factory.chat.getDirectThreads(actor.id);
  const directoryUsers = await factory.chat.getDirectoryUsers(actor.id);
  const messages: Record<string, ChatMessage[]> = {};
  for (const thread of [...threads, ...directThreads]) {
    messages[thread.id] = (await factory.chat.getMessages(thread.id, actor.id, { limit: 100 })).messages;
  }
  useLMSStore.setState({
    currentUserId: actor.id,
    currentUserName: actor.name,
    currentUserEmail: actor.email ?? null,
    currentUserRole: actor.role,
    currentUserGlobalRole: actor.role === 'admin' ? 'admin' : 'user',
    initializedPrincipalId: actor.id,
    courses,
    contentItems,
    submissions: [],
    threads,
    directThreads,
    directoryUsers,
    messages,
    messagePagination: {},
    dismissedAnnouncements: [],
    courseMutationError: null,
    contentMutationError: null,
    chatError: null,
    chatErrorSource: null,
    announcementReconciliationIssues: {},
  });
  return { actor, factory, pushes };
};

const resetSyntheticStore = (): void => {
  useLMSStore.setState({
    currentUserId: null,
    currentUserName: null,
    currentUserEmail: null,
    currentUserRole: 'student',
    currentUserGlobalRole: 'user',
    initializedPrincipalId: null,
    courses: [],
    contentItems: [],
    submissions: [],
    threads: [],
    directThreads: [],
    directoryUsers: [],
    messages: {},
    messagePagination: {},
    dismissedAnnouncements: [],
    announcementReconciliationIssues: {},
  });
};

const recordDenied = async (
  action: () => Promise<unknown>,
  transportCount: () => number,
  stateFingerprint: () => string,
) => {
  const beforeTransport = transportCount();
  const beforeState = stateFingerprint();
  let denied = false;
  let recognizedDenial = false;
  try {
    await action();
  } catch (error) {
    denied = true;
    recognizedDenial = error instanceof Error
      && /permission|authorized|cannot grant|course role|course staff/i.test(error.message);
  }
  const transportCalls = transportCount() - beforeTransport;
  return syntheticObservation(denied ? 'denied' : 'success', undefined, {
    denial_recognized: recognizedDenial,
    transport_blocked: transportCalls === 0,
    protected_state_unchanged: stateFingerprint() === beforeState,
  }, { transport_calls: transportCalls });
};

const roleExpected = (role: CourseRole, action: 'content' | 'course' | 'topic' | 'roster'): boolean => {
  if (action === 'content' || action === 'topic') return role === 'ta' || role === 'teacher' || role === 'admin';
  return role === 'teacher' || role === 'it' || role === 'admin';
};

const runRoleJourneys = async (
  recorder: SyntheticJourneyRecorder,
  runId: string,
  iterations: number,
): Promise<void> => {
  for (const role of ROLES) {
    for (let iteration = 1; iteration <= iterations; iteration += 1) {
      const journeyId = `role.${role}.boundaries`;
      let harness: RoleHarness | undefined;
      await recorder.step({
        runId, journeyId, stepId: 'load', iteration, area: 'identity', role,
        completionBoundary: 'state_converged', budgetMs: 1_000,
      }, async () => {
        harness = await hydrateRoleHarness(role);
        const state = useLMSStore.getState();
        return syntheticObservation('success', undefined, {
          principal_bound: state.currentUserId === harness.actor.id,
          greeting_identity_authoritative: state.currentUserName === harness.actor.name,
          role_bound: state.currentUserRole === role,
          course_actions_exact: JSON.stringify(getCourseCardActionDescriptors(role).map(action => action.id))
            === JSON.stringify(EXPECTED_COURSE_ACTIONS[role]),
          course_loaded: state.courses.some(course => course.id === COURSE_ID),
        }, {
          courses_loaded: state.courses.length,
          threads_loaded: state.threads.length + state.directThreads.length,
          messages_loaded: Object.values(state.messages).flat().length,
        });
      });

      const contentId = `synthetic-content-${role}-${iteration}`;
      await recorder.step({
        runId, journeyId, stepId: 'content-action', iteration, area: 'courses', role,
        completionBoundary: 'repository_acknowledged', expectedOutcome: roleExpected(role, 'content') ? 'success' : 'denied', budgetMs: 1_000,
      }, async () => {
        if (!harness) throw new Error('Role harness is unavailable.');
        const beforeTransport = harness.pushes.length;
        if (!roleExpected(role, 'content')) {
          return recordDenied(
            () => useLMSStore.getState().addContentItem(newContent(contentId)),
            () => harness!.pushes.length,
            () => JSON.stringify(useLMSStore.getState().contentItems.map(item => item.id)),
          );
        }
        await useLMSStore.getState().addContentItem(newContent(contentId));
        const transportCalls = harness.pushes.length - beforeTransport;
        return syntheticObservation('success', undefined, {
          state_converged: useLMSStore.getState().contentItems.some(item => item.id === contentId),
          exactly_one_transport_mutation: transportCalls === 1,
        }, { transport_calls: transportCalls });
      });

      await recorder.step({
        runId, journeyId, stepId: 'course-action', iteration, area: 'courses', role,
        completionBoundary: 'repository_acknowledged', expectedOutcome: roleExpected(role, 'course') ? 'success' : 'denied', budgetMs: 1_000,
      }, async () => {
        if (!harness) throw new Error('Role harness is unavailable.');
        const description = `Synthetic ${role} course update ${iteration}`;
        const beforeTransport = harness.pushes.length;
        if (!roleExpected(role, 'course')) {
          return recordDenied(
            () => useLMSStore.getState().updateCourse(COURSE_ID, { description }),
            () => harness!.pushes.length,
            () => useLMSStore.getState().courses.find(course => course.id === COURSE_ID)?.description ?? '',
          );
        }
        await useLMSStore.getState().updateCourse(COURSE_ID, { description });
        const transportCalls = harness.pushes.length - beforeTransport;
        return syntheticObservation('success', undefined, {
          state_converged: useLMSStore.getState().courses.find(course => course.id === COURSE_ID)?.description === description,
          exactly_one_transport_mutation: transportCalls === 1,
        }, { transport_calls: transportCalls });
      });

      await recorder.step({
        runId, journeyId, stepId: 'topic-action', iteration, area: 'chat', role,
        completionBoundary: 'repository_acknowledged', expectedOutcome: roleExpected(role, 'topic') ? 'success' : 'denied', budgetMs: 1_000,
      }, async () => {
        if (!harness) throw new Error('Role harness is unavailable.');
        const title = `Synthetic ${role} topic ${iteration}`;
        const action = () => useLMSStore.getState().createThread({
          courseId: COURSE_ID,
          title,
          kind: 'discussion',
          isAnnouncement: false,
          isPinned: true,
          allowStudentPosts: true,
          allowReplies: true,
          allowAttachments: false,
          allowMentions: true,
          scope: 'course',
          createdBy: harness!.actor.id,
        });
        const beforeTransport = harness.pushes.length;
        if (!roleExpected(role, 'topic')) {
          return recordDenied(
            action,
            () => harness!.pushes.length,
            () => JSON.stringify(useLMSStore.getState().threads.map(thread => thread.id)),
          );
        }
        await action();
        const transportCalls = harness.pushes.length - beforeTransport;
        return syntheticObservation('success', undefined, {
          state_converged: useLMSStore.getState().threads.some(thread => thread.title === title),
          exactly_one_transport_mutation: transportCalls === 1,
        }, { transport_calls: transportCalls });
      });

      await recorder.step({
        runId, journeyId, stepId: 'roster-action', iteration, area: 'roster', role,
        completionBoundary: 'repository_acknowledged', expectedOutcome: roleExpected(role, 'roster') ? 'success' : 'denied', budgetMs: 1_000,
      }, async () => {
        if (!harness) throw new Error('Role harness is unavailable.');
        const nextRole: CourseRole = role === 'it' ? 'it' : role === 'admin' ? 'admin' : 'ta';
        const beforeTransport = harness.pushes.length;
        if (!roleExpected(role, 'roster')) {
          return recordDenied(
            () => useLMSStore.getState().updateCourseUser(COURSE_ID, SYNTHETIC_STUDENT_ID, { role: nextRole }),
            () => harness!.pushes.length,
            () => useLMSStore.getState().courses.find(course => course.id === COURSE_ID)?.staff
              .find(member => member.id === SYNTHETIC_STUDENT_ID)?.role ?? '',
          );
        }
        const assignable = getAssignableCourseRoles(role, 'student');
        await useLMSStore.getState().updateCourseUser(COURSE_ID, SYNTHETIC_STUDENT_ID, { role: nextRole });
        const transportCalls = harness.pushes.length - beforeTransport;
        return syntheticObservation('success', undefined, {
          requested_role_assignable: assignable.includes(nextRole),
          state_converged: useLMSStore.getState().courses.find(course => course.id === COURSE_ID)?.staff
            .find(member => member.id === SYNTHETIC_STUDENT_ID)?.role === nextRole,
          exactly_one_transport_mutation: transportCalls === 1,
        }, { transport_calls: transportCalls });
      });

      await recorder.step({
        runId, journeyId, stepId: 'cleanup', iteration, area: 'identity', role,
        completionBoundary: 'state_converged', budgetMs: 50,
      }, () => {
        const noPendingReconciliation = Object.keys(useLMSStore.getState().announcementReconciliationIssues).length === 0;
        resetSyntheticStore();
        return syntheticObservation('success', undefined, {
          no_pending_reconciliation: noPendingReconciliation,
          principal_cleared: useLMSStore.getState().currentUserId === null,
          principal_records_cleared: useLMSStore.getState().courses.length === 0
            && Object.keys(useLMSStore.getState().messages).length === 0,
        });
      });
    }
  }
};

const runPresentationJourneys = async (
  recorder: SyntheticJourneyRecorder,
  runId: string,
  iterations: number,
): Promise<void> => {
  const journeyId = 'course.presentation-matrix';
  for (let iteration = 1; iteration <= iterations; iteration += 1) {
    await recorder.step({
      runId, journeyId, stepId: 'timeline-model', iteration, area: 'courses', role: 'student',
      completionBoundary: 'state_converged', budgetMs: 50,
    }, () => {
      const course = demoCourses.find(candidate => candidate.id === 'c1');
      const content = demoContentItems.filter(item => item.courseId === 'c1');
      const buckets = course ? buildCoursePresentationBuckets(content, course.presentationMode, Date.now()) : [];
      return syntheticObservation('success', undefined, {
        course_present: Boolean(course),
        all_timeline_buckets_present: ['past', 'current', 'future'].every(id => buckets.some(bucket => bucket.id === id)),
        no_deleted_content: buckets.flatMap(bucket => bucket.items).every(item => item.deletedAt === undefined),
      }, { pages_built: buckets.length, items_built: buckets.flatMap(bucket => bucket.items).length });
    });

    await recorder.step({
      runId, journeyId, stepId: 'sequential-model', iteration, area: 'courses', role: 'student',
      completionBoundary: 'state_converged', budgetMs: 50,
    }, () => {
      const course = demoCourses.find(candidate => candidate.id === 'c2');
      const content = demoContentItems.filter(item => item.courseId === 'c2');
      const buckets = course ? buildCoursePresentationBuckets(content, course.presentationMode, Date.now()) : [];
      const visibleIds = new Set(buckets.flatMap(bucket => bucket.items.map(item => item.id)));
      const lockedModuleChildIds = new Set(content
        .filter(item => item.presentationSlot === 'block-header' && item.availableDate && Date.parse(item.availableDate) > Date.now())
        .flatMap(module => content.filter(item => item.groupIcon && item.groupIcon === module.groupIcon).map(item => item.id)));
      return syntheticObservation('success', undefined, {
        course_present: Boolean(course),
        module_pages_built: buckets.length > 0,
        locked_children_hidden: [...lockedModuleChildIds].every(id => !visibleIds.has(id)),
      }, { pages_built: buckets.length, items_built: visibleIds.size });
    });

    await recorder.step({
      runId, journeyId, stepId: 'linked-site', iteration, area: 'courses', role: 'student',
      completionBoundary: 'navigation_target_built', budgetMs: 50,
    }, () => {
      const item = demoContentItems.find(candidate => candidate.courseId === 'c3');
      return syntheticObservation('success', undefined, {
        custom_item_renderable: Boolean(item && isRenderableCustomCoursePresentationItem(item)),
        embedded_mode_selected: Boolean(item && getCourseSitePresentationMode(item) === 'embedded'),
        opaque_sandbox_origin: !EXTERNAL_SITE_SANDBOX.includes('allow-same-origin'),
        scripts_without_same_origin: EXTERNAL_SITE_SANDBOX.includes('allow-scripts'),
      });
    });

    await recorder.step({
      runId, journeyId, stepId: 'static-widget', iteration, area: 'courses', role: 'student',
      completionBoundary: 'state_converged', budgetMs: 50,
    }, () => {
      const item = demoContentItems.find(candidate => candidate.courseId === 'c4');
      const document = staticWidgetDocument(
        '<h1>Safe synthetic widget</h1><script>unsafe()</script><a href="https://example.edu">remote</a>',
        '.panel{background:url(https://example.edu/pixel)}',
        'Synthetic widget',
      );
      return syntheticObservation('success', undefined, {
        custom_item_renderable: Boolean(item && isRenderableCustomCoursePresentationItem(item)),
        script_removed: !document.includes('unsafe()'),
        remote_navigation_removed: !document.includes('href="https://'),
        css_fetch_removed: !document.includes('url(https://'),
        main_landmark_present: document.includes('<main>'),
        reduced_motion_present: document.includes('prefers-reduced-motion'),
      });
    });

    await recorder.step({
      runId, journeyId, stepId: 'responsive-canvas', iteration, area: 'courses', role: 'student',
      completionBoundary: 'state_converged', budgetMs: 50,
    }, () => syntheticObservation('success', undefined, {
      wide_web_resizable: resolveAppCanvasMaxWidth(true, 1_440, 1_024) === 1_024,
      narrow_web_fluid: resolveAppCanvasMaxWidth(true, 899, 899) === undefined,
      native_fluid: resolveAppCanvasMaxWidth(false, 1_440, 1_024) === undefined,
      lower_bound_clamped: clampAppContentWidth(1, 1_280) === 768,
      upper_bound_clamped: clampAppContentWidth(2_000, 1_280) === 1_280,
    }));
  }
};

const runAnnouncementJourneys = async (
  recorder: SyntheticJourneyRecorder,
  runId: string,
  iterations: number,
): Promise<void> => {
  const journeyId = 'cross-app.announcement-roundtrip';
  for (let iteration = 1; iteration <= iterations; iteration += 1) {
    let harness: RoleHarness | undefined;
    const contentId = `synthetic-announcement-${iteration}`;
    await recorder.step({
      runId, journeyId, stepId: 'load', iteration, area: 'cross-app', role: 'teacher',
      completionBoundary: 'state_converged', budgetMs: 1_000,
    }, async () => {
      harness = await hydrateRoleHarness('teacher');
      return syntheticObservation('success', undefined, {
        teacher_loaded: useLMSStore.getState().currentUserRole === 'teacher',
        announcement_thread_present: useLMSStore.getState().threads.some(thread => thread.isAnnouncement),
      });
    });

    const announcement: ContentItem = {
      ...newContent(contentId),
      category: 'admin',
      title: 'Synthetic announcement',
      description: 'Synthetic announcement details.',
      metadata: { lmsContentType: 'announcement', lmsAnnouncementActive: true },
    };
    await recorder.step({
      runId, journeyId, stepId: 'create-content', iteration, area: 'admin', role: 'teacher',
      completionBoundary: 'repository_acknowledged', budgetMs: 1_000,
    }, async () => {
      if (!harness) throw new Error('Announcement harness is unavailable.');
      const beforeTransport = harness.pushes.length;
      await useLMSStore.getState().addContentItem(announcement);
      const transportCalls = harness.pushes.length - beforeTransport;
      return syntheticObservation('success', undefined, {
        content_committed: useLMSStore.getState().contentItems.some(item => item.id === contentId),
        exactly_one_transport_mutation: transportCalls === 1,
      }, { transport_calls: transportCalls });
    });

    await recorder.step({
      runId, journeyId, stepId: 'publish-chat', iteration, area: 'cross-app', role: 'teacher',
      completionBoundary: 'state_converged', budgetMs: 1_000,
    }, async () => {
      if (!harness) throw new Error('Announcement harness is unavailable.');
      const beforeTransport = harness.pushes.length;
      await useLMSStore.getState().syncContentAnnouncementToChat({
        courseId: COURSE_ID,
        contentItemId: contentId,
        title: announcement.title,
        content: announcement.description,
        active: true,
        actorId: harness.actor.id,
        actorName: harness.actor.name,
        actorRole: 'teacher',
      });
      const matches = Object.values(useLMSStore.getState().messages).flat()
        .filter(message => message.contentItemId === contentId && !message.deletedAt);
      return syntheticObservation('success', undefined, {
        canonical_id_stable: matches[0]?.id === contentId,
        exactly_one_message: matches.length === 1,
        reconciliation_clear: Object.keys(useLMSStore.getState().announcementReconciliationIssues).length === 0,
      }, { transport_calls: harness.pushes.length - beforeTransport, canonical_entities: matches.length });
    });

    await recorder.step({
      runId, journeyId, stepId: 'exact-navigation', iteration, area: 'navigation', role: 'student',
      completionBoundary: 'navigation_target_built', budgetMs: 50,
    }, () => {
      const message = Object.values(useLMSStore.getState().messages).flat().find(candidate => candidate.id === contentId);
      const thread = useLMSStore.getState().threads.find(candidate => candidate.id === message?.threadId);
      const route = message && thread
        ? buildCourseAnnouncementChatRoute(COURSE_ID, { threadTitle: thread.title, messageId: message.id }, thread)
        : null;
      return syntheticObservation('success', undefined, {
        route_built: Boolean(route),
        exact_course_target: route?.params.courseId === COURSE_ID,
        exact_thread_target: route?.params.chatId === thread?.id,
        exact_message_target: route?.params.messageId === contentId,
      });
    });

    await recorder.step({
      runId, journeyId, stepId: 'admin-edit', iteration, area: 'cross-app', role: 'teacher',
      completionBoundary: 'state_converged', budgetMs: 1_000,
    }, async () => {
      if (!harness) throw new Error('Announcement harness is unavailable.');
      await useLMSStore.getState().updateContentItem(contentId, {
        title: 'Synthetic admin correction',
        description: 'Synthetic corrected details.',
      });
      await useLMSStore.getState().syncContentAnnouncementToChat({
        courseId: COURSE_ID,
        contentItemId: contentId,
        title: 'Synthetic admin correction',
        content: 'Synthetic corrected details.',
        active: true,
        actorId: harness.actor.id,
        actorName: harness.actor.name,
        actorRole: 'teacher',
      });
      const messages = Object.values(useLMSStore.getState().messages).flat().filter(message => message.contentItemId === contentId);
      return syntheticObservation('success', undefined, {
        exactly_one_message: messages.length === 1,
        revision_advanced: (messages[0]?.revision ?? 0) === 2,
        chat_state_corrected: messages[0]?.text.includes('Synthetic admin correction') === true,
      }, { canonical_entities: messages.length });
    });

    await recorder.step({
      runId, journeyId, stepId: 'chat-edit', iteration, area: 'cross-app', role: 'teacher',
      completionBoundary: 'state_converged', budgetMs: 1_000,
    }, async () => {
      if (!harness) throw new Error('Announcement harness is unavailable.');
      const message = Object.values(useLMSStore.getState().messages).flat().find(candidate => candidate.id === contentId);
      if (!message) throw new Error('Canonical announcement message is unavailable.');
      const edited = await useLMSStore.getState().editChatMessage(
        message.id,
        harness.actor.id,
        '📢 Synthetic Chat correction\n\nSynthetic Chat details.',
        message.revision ?? 1,
      );
      const item = useLMSStore.getState().contentItems.find(candidate => candidate.id === contentId);
      return syntheticObservation('success', undefined, {
        content_title_converged: item?.title === 'Synthetic Chat correction',
        content_body_converged: item?.description === 'Synthetic Chat details.',
        revision_converged: item?.metadata?.lmsAnnouncementChatRevision === edited.revision,
      });
    });

    await recorder.step({
      runId, journeyId, stepId: 'withdraw', iteration, area: 'cross-app', role: 'teacher',
      completionBoundary: 'state_converged', budgetMs: 1_000,
    }, async () => {
      if (!harness) throw new Error('Announcement harness is unavailable.');
      const message = Object.values(useLMSStore.getState().messages).flat().find(candidate => candidate.id === contentId);
      if (!message) throw new Error('Canonical announcement message is unavailable.');
      const deleted = await useLMSStore.getState().deleteChatMessage(message.id, harness.actor.id, message.revision ?? 1);
      const item = useLMSStore.getState().contentItems.find(candidate => candidate.id === contentId);
      const restored = item ? { ...item, ...restoreWithdrawnAnnouncementAsContent(item, Date.now()) } : undefined;
      return syntheticObservation('success', undefined, {
        chat_tombstoned: Boolean(deleted.deletedAt && deleted.text === ''),
        content_withdrawn: Boolean(item?.deletedAt && item.metadata?.lmsAnnouncementActive === false),
        restore_requires_new_identity: restored?.metadata?.lmsAnnouncementRequiresNewIdentity === true,
        restore_not_active_announcement: restored?.metadata?.lmsAnnouncementActive === false,
      });
    });

    await recorder.step({
      runId, journeyId, stepId: 'retry-reconciliation', iteration, area: 'cross-app', role: 'teacher',
      completionBoundary: 'state_converged', expectedOutcome: 'recovered', budgetMs: 1_000,
    }, async () => {
      if (!harness) throw new Error('Announcement harness is unavailable.');
      const retryItem: ContentItem = {
        ...newContent(`synthetic-announcement-retry-${iteration}`),
        category: 'admin',
        title: 'Synthetic retry announcement',
        description: 'Synthetic retry details.',
        metadata: { lmsContentType: 'announcement', lmsAnnouncementActive: true },
      };
      await useLMSStore.getState().addContentItem(retryItem);
      let failOnce = true;
      configureRepositoryFactory({
        ...harness.factory,
        chat: {
          ...harness.factory.chat,
          async sendMessage(input) {
            if (failOnce && input.contentItemId === retryItem.id) {
              failOnce = false;
              throw new Error('Synthetic acknowledgement outage.');
            }
            return harness!.factory.chat.sendMessage(input);
          },
        },
      });
      let failureVisible = false;
      try {
        await useLMSStore.getState().syncContentAnnouncementToChat({
          courseId: COURSE_ID,
          contentItemId: retryItem.id,
          title: retryItem.title,
          content: retryItem.description,
          active: true,
          actorId: harness.actor.id,
          actorName: harness.actor.name,
          actorRole: 'teacher',
        });
      } catch {
        failureVisible = true;
      }
      const issue = Object.values(useLMSStore.getState().announcementReconciliationIssues)
        .find(candidate => candidate.contentItemId === retryItem.id);
      if (issue) await useLMSStore.getState().retryAnnouncementReconciliation(issue.id);
      configureRepositoryFactory(harness.factory);
      const messages = Object.values(useLMSStore.getState().messages).flat()
        .filter(message => message.contentItemId === retryItem.id && !message.deletedAt);
      return syntheticObservation('recovered', undefined, {
        initial_failure_visible: failureVisible,
        retry_issue_created: Boolean(issue),
        retry_converged: Boolean(issue && !useLMSStore.getState().announcementReconciliationIssues[issue.id]),
        exactly_one_message: messages.length === 1,
      }, { retry_attempts: 1, canonical_entities: messages.length });
    });
    resetSyntheticStore();
  }
};

const flashcardItems = (): BrowsableCardItem[] => {
  const baseCard: Card = {
    id: 'card-alpha', note_id: 'note-alpha', deck_id: 'deck-main', template_id: 'template-main', position: 0,
    difficulty: 0, stability: 0, retrievability: 0, state: CardState.New, last_knob_value: 0,
    current_max_layer: 1, total_layers: 1, due: 1, reps: 0, lapses: 0, learning_steps: 0,
    last_review: 0, created_at: 1,
  };
  const note = (id: string, front: string): Note => ({
    id, note_type_id: 'note-type', field_values: { front }, created_at: 1, updated_at: 1,
  });
  const layer = (id: string, cardId: string, content: string): DepthLayer => ({
    id, card_id: cardId, layer_number: 1, content, source: 'synthetic', is_unlocked: true,
  });
  return [
    {
      card: { ...baseCard, tags: ['science'] },
      note: note('note-alpha', 'Alpha prompt'),
      layers: [layer('layer-alpha', 'card-alpha', 'Alpha answer')],
    },
    {
      card: { ...baseCard, id: 'card-beta', note_id: 'note-beta', position: 1, tags: ['exam'] },
      note: note('note-beta', 'Beta prompt'),
      layers: [layer('layer-beta', 'card-beta', 'Beta answer')],
    },
  ];
};

const runFlashcardJourneys = async (
  recorder: SyntheticJourneyRecorder,
  runId: string,
  iterations: number,
): Promise<void> => {
  const journeyId = 'flashcards.library-study-contracts';
  const decks: Deck[] = [
    { id: 'tutorial', user_id: 'synthetic', name: 'Tutorial', description: '', settings: { isTutorial: true }, position: 0, completed_once: false, created_at: 1 },
    { id: 'deck-main', user_id: 'synthetic', name: 'Main Deck', description: '', settings: {}, position: 1, completed_once: false, created_at: 1 },
  ];
  for (let iteration = 1; iteration <= iterations; iteration += 1) {
    const items = flashcardItems();
    await recorder.step({
      runId, journeyId, stepId: 'library-filter', iteration, area: 'flashcards', role: 'student',
      completionBoundary: 'handler_resolved', budgetMs: 50,
    }, () => {
      const visible = filterDeckLibrary(decks, 'MAIN');
      return syntheticObservation('success', undefined, {
        search_case_insensitive: visible.length === 1 && visible[0].id === 'deck-main',
        tutorial_hidden: !filterDeckLibrary(decks, '').some(deck => deck.id === 'tutorial'),
      }, { visible_decks: visible.length });
    });

    await recorder.step({
      runId, journeyId, stepId: 'card-filter', iteration, area: 'flashcards', role: 'student',
      completionBoundary: 'handler_resolved', budgetMs: 50,
    }, () => syntheticObservation('success', undefined, {
      answer_search_matches: filterBrowsableCards(items, 'BETA ANSWER', null)[0]?.card.id === 'card-beta',
      tag_filter_matches: filterBrowsableCards(items, '', 'science')[0]?.card.id === 'card-alpha',
      missing_query_empty: filterBrowsableCards(items, 'missing', null).length === 0,
    }));

    await recorder.step({
      runId, journeyId, stepId: 'reorder-rollback', iteration, area: 'flashcards', role: 'student',
      completionBoundary: 'state_converged', budgetMs: 50,
    }, () => {
      const moved = moveBrowsableCard(items, 'card-beta', -1);
      const arrival = { ...items[0], card: { ...items[0].card, id: 'card-arrival' } };
      const rolledBack = moved ? rollbackBrowsableCardOrder(items, [...moved, arrival]) : [];
      return syntheticObservation('success', undefined, {
        reorder_applied: moved?.[0].card.id === 'card-beta',
        rollback_restored_prior_order: rolledBack[0]?.card.id === 'card-alpha' && rolledBack[1]?.card.id === 'card-beta',
        concurrent_arrival_retained: rolledBack[2]?.card.id === 'card-arrival',
      }, { visible_cards: rolledBack.length });
    });

    await recorder.step({
      runId, journeyId, stepId: 'csv-roundtrip', iteration, area: 'flashcards', role: 'student',
      completionBoundary: 'handler_resolved', budgetMs: 50,
    }, () => {
      const rows = [{ front: '=Synthetic prompt', layers: ['Synthetic, answer', 'Synthetic depth'] }];
      const encoded = serializeFlashcardCSV(rows);
      const decoded = parseFlashcardCSV(encoded);
      return syntheticObservation('success', undefined, {
        roundtrip_exact: JSON.stringify(decoded) === JSON.stringify(rows),
        spreadsheet_formula_neutralized: encoded.includes("'=Synthetic prompt"),
      }, { csv_rows: decoded.length, csv_bytes: new TextEncoder().encode(encoded).byteLength });
    });

    await recorder.step({
      runId, journeyId, stepId: 'duplicate-activation', iteration, area: 'flashcards', role: 'student',
      completionBoundary: 'handler_resolved', expectedOutcome: 'no_op', budgetMs: 50,
    }, async () => {
      const lock = { current: false };
      let release!: () => void;
      const pending = new Promise<void>(resolve => { release = resolve; });
      let mutations = 0;
      const first = runExclusiveFlashcardAction(lock, async () => {
        mutations += 1;
        await pending;
        return 'complete';
      });
      const duplicate = await runExclusiveFlashcardAction(lock, async () => {
        mutations += 1;
        return 'duplicate';
      });
      release();
      const firstResult = await first;
      return syntheticObservation('no_op', undefined, {
        duplicate_suppressed: duplicate.started === false,
        first_action_completed: firstResult.started === true,
        exactly_one_mutation: mutations === 1,
        lock_released: lock.current === false,
      }, { transport_calls: mutations });
    });

    await recorder.step({
      runId, journeyId, stepId: 'route-contract', iteration, area: 'navigation', role: 'student',
      completionBoundary: 'navigation_target_built', budgetMs: 50,
    }, () => {
      const valid = normalizeStudyRoute({ deckId: 'deck-main', target: '25', mode: 'quiz', startPos: '2', group: 'all' });
      const ambiguous = normalizeStudyRoute({ deckId: ['deck-main', 'other'], target: '25', mode: 'quiz', startPos: '2', group: 'all' });
      const unsafe = normalizeStudyRoute({ deckId: 'deck-main', target: '25', mode: 'mutate', startPos: '2', group: 'all' });
      return syntheticObservation('success', undefined, {
        valid_route_normalized: valid.success && valid.mode === 'quiz' && valid.startPos === '2',
        repeated_parameters_rejected: !ambiguous.success,
        state_changing_fallback_rejected: !unsafe.success,
      });
    });
  }
};

const runAIJourneys = async (
  recorder: SyntheticJourneyRecorder,
  runId: string,
  iterations: number,
): Promise<void> => {
  const journeyId = 'ai.consent-review-publish';
  for (let iteration = 1; iteration <= iterations; iteration += 1) {
    let providerCalls = 0;
    await recorder.step({
      runId, journeyId, stepId: 'deny-without-consent', iteration, area: 'ai', role: 'teacher',
      completionBoundary: 'handler_resolved', expectedOutcome: 'denied', budgetMs: 50,
    }, async () => {
      let denied = false;
      try {
        await runAttestedAIRequest(null, async () => {
          providerCalls += 1;
          return 'unexpected';
        });
      } catch {
        denied = true;
      }
      return syntheticObservation(denied ? 'denied' : 'success', undefined, {
        provider_not_called: providerCalls === 0,
        denial_visible: denied,
      }, { transport_calls: providerCalls });
    });

    const attestation = createAIProcessingAttestation(new Date('2026-08-29T12:00:00.000Z'));
    await recorder.step({
      runId, journeyId, stepId: 'attested-request', iteration, area: 'ai', role: 'teacher',
      completionBoundary: 'repository_acknowledged', budgetMs: 50,
    }, async () => {
      const result = await runAttestedAIRequest(attestation, async () => {
        providerCalls += 1;
        return { cards: 2 };
      });
      return syntheticObservation('success', undefined, {
        provider_called_after_consent: providerCalls === 1,
        bounded_result_received: result.cards === 2,
      }, { transport_calls: providerCalls, generated_items: result.cards });
    });

    const session = createAIRequestSessionState();
    await recorder.step({
      runId, journeyId, stepId: 'duplicate-start', iteration, area: 'ai', role: 'teacher',
      completionBoundary: 'handler_resolved', expectedOutcome: 'no_op', budgetMs: 50,
    }, () => {
      const first = beginAIRequestSession(session);
      const duplicate = beginAIRequestSession(session);
      return syntheticObservation('no_op', undefined, {
        first_started: first !== null,
        duplicate_suppressed: duplicate === null,
        one_in_flight_session: session.inFlight === first,
      });
    });

    await recorder.step({
      runId, journeyId, stepId: 'stale-completion', iteration, area: 'ai', role: 'teacher',
      completionBoundary: 'state_converged', expectedOutcome: 'no_op', budgetMs: 50,
    }, () => {
      const staleSession = session.inFlight;
      resetAIRequestSession(session);
      const staleCommitted = staleSession === null ? true : completeAIRequestSession(session, staleSession);
      return syntheticObservation('no_op', undefined, {
        stale_completion_suppressed: staleCommitted === false,
        in_flight_cleared: session.inFlight === null,
      });
    });

    await recorder.step({
      runId, journeyId, stepId: 'publish-provenance', iteration, area: 'ai', role: 'teacher',
      completionBoundary: 'state_converged', budgetMs: 50,
    }, () => {
      const metadata = attachAIProcessingAttestation({ reviewerApproved: true }, attestation);
      return syntheticObservation('success', undefined, {
        reviewer_approval_retained: metadata.reviewerApproved === true,
        source_rights_retained: metadata.sourceRightsAttested === true,
        attestation_timestamp_retained: metadata.sourceRightsAttestedAt === attestation.sourceRightsAttestedAt,
      });
    });
  }
};

const buildContracts = (iterations: number): SyntheticJourneyPlanContract[] => [
  ...ROLES.map(role => ({ journeyId: `role.${role}.boundaries`, requiredStepIds: ROLE_STEPS, iterations })),
  { journeyId: 'course.presentation-matrix', requiredStepIds: PRESENTATION_STEPS, iterations },
  { journeyId: 'cross-app.announcement-roundtrip', requiredStepIds: ANNOUNCEMENT_STEPS, iterations },
  { journeyId: 'flashcards.library-study-contracts', requiredStepIds: FLASHCARD_STEPS, iterations },
  { journeyId: 'ai.consent-review-publish', requiredStepIds: AI_STEPS, iterations },
];

export const runFullAppSyntheticJourneys = async (
  options: FullAppSyntheticJourneyOptions = {},
): Promise<FullAppSyntheticJourneyResult> => {
  const iterations = options.iterations ?? 30;
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 100) {
    throw new Error('Synthetic journey iterations must be an integer from 1 to 100.');
  }
  const runId = options.runId ?? 'full-app-synthetic';
  const recorder = new SyntheticJourneyRecorder({
    now: options.now,
    sink: options.sink,
    lifecycleSink: options.lifecycleSink,
  });
  const originalFactory = repoFactory;
  try {
    await runRoleJourneys(recorder, runId, iterations);
    await runPresentationJourneys(recorder, runId, iterations);
    await runAnnouncementJourneys(recorder, runId, iterations);
    await runFlashcardJourneys(recorder, runId, iterations);
    await runAIJourneys(recorder, runId, iterations);
  } finally {
    resetSyntheticStore();
    configureRepositoryFactory(originalFactory);
  }
  const contracts = buildContracts(iterations);
  return {
    summary: recorder.summary(),
    coverage: inspectSyntheticJourneyCoverage(recorder.events, contracts),
    events: recorder.events,
    contracts,
    limitations: FULL_APP_SYNTHETIC_LIMITATIONS,
  };
};

export const assertFullAppSyntheticJourneyResult = (result: FullAppSyntheticJourneyResult): void => {
  assertSyntheticJourneyCoverage(result.coverage);
  assertSyntheticJourneySummary(result.summary);
};
