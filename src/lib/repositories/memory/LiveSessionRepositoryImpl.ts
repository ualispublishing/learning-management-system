/**
 * @fileoverview src/lib/repositories/memory/LiveSessionRepositoryImpl.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import { PopQuizState } from '../../../types/lms';
import {
  buildAssessmentResponses,
  calculateSubmissionTotal,
  getAttemptEligibility,
} from '../../assessment/engine';
import { createEntityId } from '../../id';
import { validateLiveAnswer, validatePopQuizState } from '../../liveSessions/validation';
import { LiveSessionRepository } from '../interfaces';
import { demoContentItems, demoCourses } from './demoData';
import { cloneSubmission, demoSubmissions } from '../sqlite/SubmissionRepositoryImpl';

const sessions = new Map<string, PopQuizState>();
const archives = new Map<string, ReturnType<typeof cloneSubmission>[]>();
const listeners = new Map<string, Set<(state: PopQuizState | null) => void>>();
const MAX_DEMO_ARCHIVES = 500;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const archiveKey = (courseworkId: string, sessionId: string) => JSON.stringify([courseworkId, sessionId]);

const resolveLiveContext = (courseworkId: string) => {
  const item = demoContentItems.find(candidate => candidate.id === courseworkId);
  const course = item ? demoCourses.find(candidate => candidate.id === item.courseId) : undefined;
  if (!item || !course) throw new Error('The live coursework no longer exists.');
  if (!item.isPopQuiz && !item.isPoll) throw new Error('This coursework item is not configured for live delivery.');
  if (item.workType === 'group') throw new Error('Live sessions currently require individual responses.');
  const students = course.staff.filter(member => member.role === 'student');
  return { item, course, students, studentIds: new Set(students.map(student => student.id)) };
};

const rememberArchive = (key: string, submissions: ReturnType<typeof cloneSubmission>[]) => {
  archives.set(key, submissions.map(cloneSubmission));
  while (archives.size > MAX_DEMO_ARCHIVES) {
    const oldestKey = archives.keys().next().value;
    if (typeof oldestKey !== 'string') break;
    archives.delete(oldestKey);
  }
};

const emit = (courseworkId: string) => {
  const state = sessions.get(courseworkId);
  listeners.get(courseworkId)?.forEach(listener => listener(state ? clone(state) : null));
};

/** Restores the bounded same-runtime fixture between shared demo test runs. */
export const resetDemoLiveSessions = () => {
  const activeCourseworkIds = [...sessions.keys()];
  sessions.clear();
  archives.clear();
  activeCourseworkIds.forEach(courseworkId => emit(courseworkId));
};

/** Same-runtime demo transport. Production must inject its WebSocket/SSE equivalent. */
export class DemoLiveSessionRepository implements LiveSessionRepository {
  async getSession(courseworkId: string): Promise<PopQuizState | null> {
    const state = sessions.get(courseworkId);
    return state ? clone(state) : null;
  }

  async publishSession(courseworkId: string, state: PopQuizState): Promise<void> {
    const context = resolveLiveContext(courseworkId);
    const validated = validatePopQuizState(state, {
      expectedCourseworkId: courseworkId,
      questions: context.item.questions,
      participantIds: context.studentIds,
    });
    if (!validated) throw new Error('Live sessions can only be removed through durable finalization.');
    const current = sessions.get(courseworkId);
    if (!current) {
      if (validated.revision !== 1 || Object.keys(validated.answers).length) {
        throw new Error('A new live session must start at revision 1 without client-supplied answers.');
      }
      sessions.set(courseworkId, clone(validated));
    } else {
      if (current.sessionId !== validated.sessionId) throw new Error('Another live session is already active for this coursework.');
      if (validated.revision !== current.revision + 1) {
        throw new Error(`Live session revision conflict: expected revision ${current.revision + 1}.`);
      }
      // Host state transitions never own participant answers. Preserve the
      // repository's authoritative map so a stale host snapshot cannot erase
      // an answer that arrived concurrently.
      sessions.set(courseworkId, { ...clone(validated), answers: clone(current.answers) });
    }
    emit(courseworkId);
  }

  async submitAnswer(courseworkId: string, studentId: string, questionId: string, answer: unknown): Promise<void> {
    const context = resolveLiveContext(courseworkId);
    const state = validatePopQuizState(sessions.get(courseworkId) ?? null, {
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
    if (!context.studentIds.has(studentId)) throw new Error('Live answers require an enrolled student.');
    const question = context.item.questions?.find(candidate => candidate.id === questionId);
    if (!question || question.answerType === 'page_break') throw new Error('The live question was not found.');
    validateLiveAnswer(question, answer);
    const eligibility = getAttemptEligibility(context.item, demoSubmissions, studentId);
    if (!eligibility.allowed || eligibility.resumableSubmission) {
      throw new Error(eligibility.resumableSubmission
        ? 'An existing draft must be resolved before joining this live assessment.'
        : eligibility.reason || 'This student cannot start another attempt.');
    }
    state.answers[studentId] = { ...(state.answers[studentId] || {}), [questionId]: clone(answer) };
    sessions.set(courseworkId, state);
    emit(courseworkId);
  }

  async finalizeSession(courseworkId: string, sessionId: string) {
    const key = archiveKey(courseworkId, sessionId);
    const priorArchive = archives.get(key);
    if (priorArchive) return priorArchive.map(cloneSubmission);
    const state = sessions.get(courseworkId);
    const { item, students, studentIds } = resolveLiveContext(courseworkId);
    if (!state) throw new Error('The live session no longer exists.');
    if (state.sessionId !== sessionId) throw new Error('The live session changed before it could be finalized.');
    validatePopQuizState(state, { expectedCourseworkId: courseworkId, questions: item.questions, participantIds: studentIds });
    const now = Date.now();
    const answeredStudents = Object.keys(state.answers).sort();
    const archived = answeredStudents.map((studentId, index) => {
      const student = students.find(candidate => candidate.id === studentId);
      if (!student) throw new Error(`Live answer belongs to unknown student "${studentId}".`);
      const eligibility = getAttemptEligibility(item, demoSubmissions, studentId);
      if (!eligibility.allowed || eligibility.resumableSubmission) {
        throw new Error(eligibility.resumableSubmission
          ? `Student "${studentId}" has an existing draft that conflicts with this live attempt.`
          : eligibility.reason || `Student "${studentId}" cannot start another attempt.`);
      }
      const responses = buildAssessmentResponses(item, state.answers[studentId]);
      return {
        id: createEntityId(`live_${index + 1}`),
        liveSessionId: sessionId,
        studentId,
        studentName: student.name,
        contentItemId: item.id,
        courseId: item.courseId,
        startedAt: state.startedAt,
        submittedAt: now,
        updatedAt: now,
        revision: 1,
        attemptNumber: eligibility.nextAttemptNumber,
        status: 'submitted' as const,
        responses,
        ...(item.isGraded === true && item.isPoll !== true
          ? { totalScore: calculateSubmissionTotal(responses) }
          : {}),
      };
    });
    // Build every record before mutating either repository so demo finalization
    // has the same all-or-nothing behavior required from institution adapters.
    demoSubmissions.push(...archived.map(cloneSubmission));
    rememberArchive(key, archived);
    sessions.delete(courseworkId);
    emit(courseworkId);
    return archived.map(cloneSubmission);
  }

  subscribeToSession(courseworkId: string, onState: (state: PopQuizState | null) => void): () => void {
    const subscribers = listeners.get(courseworkId) ?? new Set();
    subscribers.add(onState);
    listeners.set(courseworkId, subscribers);
    const current = sessions.get(courseworkId);
    onState(current ? clone(current) : null);
    return () => {
      subscribers.delete(onState);
      if (!subscribers.size) listeners.delete(courseworkId);
    };
  }
}
