/**
 * @fileoverview src/lib/store/slices/contentSlice.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import { StateCreator } from 'zustand';
import { ContentItem, StudentSubmission, PopQuizState } from '../../../types/lms';
import { validateLiveAnswer, validatePopQuizState } from '../../liveSessions/validation';
import { createEntityId } from '../../id';
import { repoFactory } from '../../repositories/factory';
import { capturePrincipalGeneration, isPrincipalGenerationCurrent } from '../principalGeneration';

export interface ContentSlice {
  contentItems: ContentItem[];
  submissions: StudentSubmission[];
  popQuizState: PopQuizState | null;
  contentMutationError: string | null;
  liveSessionError: string | null;
  clearContentMutationError: () => void;
  clearLiveSessionError: () => void;

  addContentItem: (item: ContentItem) => Promise<void>;
  addContentItems: (items: ContentItem[]) => Promise<void>;
  updateContentItem: (id: string, updates: Partial<ContentItem>) => Promise<void>;
  updateContentItems: (changes: { itemId: string; updates: Partial<ContentItem> }[]) => Promise<void>;
  deleteContentItem: (id: string) => Promise<void>;
  restoreContentItem: (id: string) => Promise<void>;
  updateContentGroup: (itemIds: string[], updates: Partial<ContentItem>) => Promise<void>;
  reorderContentItems: (newItems: ContentItem[]) => Promise<void>;

  addSubmission: (sub: StudentSubmission) => Promise<void>;
  updateSubmission: (id: string, updates: Partial<StudentSubmission>) => Promise<void>;
  createExternalGrade: (item: ContentItem, submissions: StudentSubmission[]) => Promise<void>;

  startPopQuiz: (courseworkId: string) => Promise<void>;
  revealPopQuizQuestion: (questionId: string) => Promise<void>;
  lockPopQuizQuestion: () => Promise<void>;
  submitPopQuizAnswer: (studentId: string, questionId: string, answer: unknown) => Promise<void>;
  endPopQuiz: () => Promise<void>;
  subscribeToPopQuiz: (courseworkId: string) => () => void;

  fetchContent: (courseId: string) => Promise<void>;
}

const messageFrom = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;
const pendingLiveAnswers = new Map<string, Promise<void>>();

export const createContentSlice: StateCreator<ContentSlice, [], [], ContentSlice> = (set, get) => ({
  contentItems: [],
  submissions: [],
  popQuizState: null,
  contentMutationError: null,
  liveSessionError: null,
  clearContentMutationError: () => set({ contentMutationError: null }),
  clearLiveSessionError: () => set({ liveSessionError: null }),

  addContentItem: async (item) => {
    const generation = capturePrincipalGeneration();
    if (get().contentItems.some(existing => existing.id === item.id)) {
      set({ contentMutationError: `Content item "${item.id}" already exists.` });
      throw new Error(`Content item "${item.id}" already exists.`);
    }
    try {
      await repoFactory.content.createContentItem(item);
      if (isPrincipalGenerationCurrent(generation)) set(state => ({ contentItems: [...state.contentItems.filter(existing => existing.id !== item.id), item], contentMutationError: null }));
    } catch (error) {
      if (isPrincipalGenerationCurrent(generation)) set({ contentMutationError: messageFrom(error, 'Content could not be created.') });
      throw error;
    }
  },

  addContentItems: async (items) => {
    const generation = capturePrincipalGeneration();
    if (!items.length) return;
    const existingItems = get().contentItems;
    const incomingIds = new Set<string>();
    for (const item of items) {
      if (incomingIds.has(item.id) || existingItems.some(existing => existing.id === item.id)) {
        const error = new Error(`Content item "${item.id}" already exists.`);
        set({ contentMutationError: error.message });
        throw error;
      }
      incomingIds.add(item.id);
    }
    try {
      await repoFactory.content.createContentItems(items);
      const ids = new Set(items.map(item => item.id));
      if (isPrincipalGenerationCurrent(generation)) set(state => ({ contentItems: [...state.contentItems.filter(item => !ids.has(item.id)), ...items], contentMutationError: null }));
    } catch (error) {
      if (isPrincipalGenerationCurrent(generation)) set({ contentMutationError: messageFrom(error, 'The content bundle could not be created atomically.') });
      throw error;
    }
  },

  updateContentItem: async (id, updates) => {
    const generation = capturePrincipalGeneration();
    if (!get().contentItems.some(item => item.id === id)) {
      set({ contentMutationError: `Content item "${id}" was not found.` });
      throw new Error(`Content item "${id}" was not found.`);
    }
    try {
      await repoFactory.content.updateContentItem(id, updates);
      if (isPrincipalGenerationCurrent(generation)) set(state => ({
        contentItems: state.contentItems.map(item => item.id === id ? { ...item, ...updates, id } : item),
        contentMutationError: null,
      }));
    } catch (error) {
      if (isPrincipalGenerationCurrent(generation)) set({ contentMutationError: messageFrom(error, 'Content changes could not be saved.') });
      throw error;
    }
  },

  updateContentItems: async (changes) => {
    const generation = capturePrincipalGeneration();
    if (!changes.length) return;
    const existingIds = new Set(get().contentItems.map(item => item.id));
    const requestedIds = new Set<string>();
    for (const change of changes) {
      if (!existingIds.has(change.itemId)) {
        const error = new Error(`Content item "${change.itemId}" was not found.`);
        set({ contentMutationError: error.message });
        throw error;
      }
      if (requestedIds.has(change.itemId)) {
        const error = new Error(`Content item "${change.itemId}" is repeated in the batch.`);
        set({ contentMutationError: error.message });
        throw error;
      }
      requestedIds.add(change.itemId);
    }
    try {
      await repoFactory.content.updateContentItems(changes);
      const updatesById = new Map(changes.map(change => [change.itemId, change.updates]));
      if (isPrincipalGenerationCurrent(generation)) set(state => ({
        contentItems: state.contentItems.map(item => {
          const updates = updatesById.get(item.id);
          return updates ? { ...item, ...updates, id: item.id } : item;
        }),
        contentMutationError: null,
      }));
    } catch (error) {
      if (isPrincipalGenerationCurrent(generation)) set({ contentMutationError: messageFrom(error, 'Content changes could not be saved atomically.') });
      throw error;
    }
  },

  deleteContentItem: async (id) => {
    const generation = capturePrincipalGeneration();
    const deletedAt = Date.now();
    try {
      await repoFactory.content.deleteContentItem(id, deletedAt);
      if (isPrincipalGenerationCurrent(generation)) set(state => ({ contentItems: state.contentItems.map(item => item.id === id ? { ...item, deletedAt } : item), contentMutationError: null }));
    } catch (error) {
      if (isPrincipalGenerationCurrent(generation)) set({ contentMutationError: messageFrom(error, 'Content could not be deleted.') });
      throw error;
    }
  },

  restoreContentItem: async (id) => {
    const generation = capturePrincipalGeneration();
    try {
      await repoFactory.content.restoreContentItem(id);
      if (isPrincipalGenerationCurrent(generation)) set(state => ({ contentItems: state.contentItems.map(item => item.id === id ? { ...item, deletedAt: undefined } : item), contentMutationError: null }));
    } catch (error) {
      if (isPrincipalGenerationCurrent(generation)) set({ contentMutationError: messageFrom(error, 'Content could not be restored.') });
      throw error;
    }
  },

  updateContentGroup: async (itemIds, updates) => {
    const generation = capturePrincipalGeneration();
    const ids = new Set(itemIds);
    try {
      await repoFactory.content.updateContentItems(itemIds.map(itemId => ({ itemId, updates })));
      if (isPrincipalGenerationCurrent(generation)) set(state => ({ contentItems: state.contentItems.map(item => ids.has(item.id) ? { ...item, ...updates } : item), contentMutationError: null }));
    } catch (error) {
      if (isPrincipalGenerationCurrent(generation)) set({ contentMutationError: messageFrom(error, 'Grouped content changes could not be saved.') });
      throw error;
    }
  },

  reorderContentItems: async (newItems) => {
    const generation = capturePrincipalGeneration();
    const reordered = newItems.map((item, orderIndex) => ({ ...item, orderIndex }));
    try {
      await repoFactory.content.updateContentItems(reordered.map(item => ({ itemId: item.id, updates: { orderIndex: item.orderIndex } })));
      const orderById = new Map(reordered.map(item => [item.id, item.orderIndex]));
      if (isPrincipalGenerationCurrent(generation)) set(state => ({
        contentItems: state.contentItems.map(item => orderById.has(item.id) ? { ...item, orderIndex: orderById.get(item.id) } : item),
        contentMutationError: null,
      }));
    } catch (error) {
      if (isPrincipalGenerationCurrent(generation)) set({ contentMutationError: messageFrom(error, 'Content order could not be saved.') });
      throw error;
    }
  },

  addSubmission: async (submission) => {
    const generation = capturePrincipalGeneration();
    const versioned = { ...submission, updatedAt: submission.updatedAt ?? Date.now(), revision: submission.revision ?? 1 };
    try {
      const saved = await repoFactory.submissions.upsertSubmission(versioned);
      if (isPrincipalGenerationCurrent(generation)) set(state => ({ submissions: [...state.submissions.filter(existing => existing.id !== submission.id), saved], contentMutationError: null }));
    } catch (error) {
      if (isPrincipalGenerationCurrent(generation)) set({ contentMutationError: messageFrom(error, 'Submission could not be saved.') });
      throw error;
    }
  },

  updateSubmission: async (id, updates) => {
    const generation = capturePrincipalGeneration();
    const existing = get().submissions.find(submission => submission.id === id);
    if (!existing) {
      set({ contentMutationError: `Submission "${id}" was not found.` });
      throw new Error(`Submission "${id}" was not found.`);
    }
    const updated = {
      ...existing,
      ...updates,
      id,
      updatedAt: Date.now(),
      revision: (existing.revision ?? 0) + 1,
    };
    try {
      const saved = await repoFactory.submissions.upsertSubmission(updated);
      if (isPrincipalGenerationCurrent(generation)) set(state => ({ submissions: state.submissions.map(submission => submission.id === id ? saved : submission), contentMutationError: null }));
    } catch (error) {
      if (isPrincipalGenerationCurrent(generation)) set({ contentMutationError: messageFrom(error, 'Submission changes could not be saved.') });
      throw error;
    }
  },

  createExternalGrade: async (item, submissions) => {
    const generation = capturePrincipalGeneration();
    const previousItems = get().contentItems;
    if (previousItems.some(existing => existing.id === item.id)) throw new Error(`Content item "${item.id}" already exists.`);
    const versionedSubmissions = submissions.map(submission => ({
      ...submission,
      updatedAt: submission.updatedAt ?? Date.now(),
      revision: submission.revision ?? 1,
    }));
    try {
      await repoFactory.gradebook.createExternalGrade(item, versionedSubmissions);
      const submissionIds = new Set(versionedSubmissions.map(submission => submission.id));
      if (isPrincipalGenerationCurrent(generation)) set(state => ({
        contentItems: [...state.contentItems.filter(existing => existing.id !== item.id), item],
        submissions: [...state.submissions.filter(existing => !submissionIds.has(existing.id)), ...versionedSubmissions],
        contentMutationError: null,
      }));
    } catch (error) {
      if (isPrincipalGenerationCurrent(generation)) set({ contentMutationError: messageFrom(error, 'External grade could not be created atomically.') });
      throw error;
    }
  },

  startPopQuiz: async (courseworkId) => {
    const generation = capturePrincipalGeneration();
    const previous = get().popQuizState;
    const item = get().contentItems.find(candidate => candidate.id === courseworkId);
    if (!item) {
      const error = new Error('Live-session coursework was not found.');
      set({ liveSessionError: error.message });
      throw error;
    }
    if (!item.isPopQuiz && !item.isPoll) {
      const error = new Error('This coursework item is not configured for live delivery.');
      set({ liveSessionError: error.message });
      throw error;
    }
    if (item.workType === 'group') {
      const error = new Error('Live sessions currently require individual responses.');
      set({ liveSessionError: error.message });
      throw error;
    }
    const next: PopQuizState = {
      courseworkId,
      sessionId: createEntityId('live'),
      startedAt: Date.now(),
      revision: 1,
      status: 'waiting',
      currentQuestionId: null,
      questionOpenedAt: null,
      questionClosesAt: null,
      completedQuestionIds: [],
      answers: {},
    };
    set({ popQuizState: next, liveSessionError: null });
    try {
      const existing = validatePopQuizState(await repoFactory.liveSessions.getSession(courseworkId), {
        expectedCourseworkId: courseworkId,
        questions: item.questions,
      });
      if (existing) {
        if (isPrincipalGenerationCurrent(generation)) set({ popQuizState: existing, liveSessionError: null });
        return;
      }
      await repoFactory.liveSessions.publishSession(courseworkId, next);
    } catch (error) {
      const message = messageFrom(error, 'Live session could not be started.');
      if (isPrincipalGenerationCurrent(generation)) set(state => state.popQuizState === next
        ? { popQuizState: previous, liveSessionError: message }
        : { liveSessionError: message });
      throw error;
    }
  },
  revealPopQuizQuestion: async (questionId) => {
    const generation = capturePrincipalGeneration();
    const previous = get().popQuizState;
    if (!previous) throw new Error('No live session is active.');
    if (previous.status === 'ended') {
      const error = new Error('This live session has ended and must be archived before another question can open.');
      set({ liveSessionError: error.message });
      throw error;
    }
    if (previous.status === 'active' && previous.currentQuestionId !== questionId) {
      const error = new Error('Lock the current live question before revealing another one.');
      set({ liveSessionError: error.message });
      throw error;
    }
    const question = get().contentItems.find(item => item.id === previous.courseworkId)?.questions?.find(candidate => candidate.id === questionId);
    if (!question || question.answerType === 'page_break' || question.answerType === 'dropbox' || question.answerType === 'custom_code') {
      const error = new Error('This question cannot be used in a live session.');
      set({ liveSessionError: error.message });
      throw error;
    }
    const openedAt = Date.now();
    const timerSeconds = typeof question.customConfig?.timerSeconds === 'number' ? question.customConfig.timerSeconds : 0;
    const next: PopQuizState = {
      ...previous,
      revision: previous.revision + 1,
      status: 'active',
      currentQuestionId: questionId,
      questionOpenedAt: openedAt,
      questionClosesAt: timerSeconds > 0 ? openedAt + timerSeconds * 1_000 : null,
      completedQuestionIds: previous.completedQuestionIds.filter(id => id !== questionId),
    };
    set({ popQuizState: next, liveSessionError: null });
    try {
      await repoFactory.liveSessions.publishSession(next.courseworkId, next);
    } catch (error) {
      const message = messageFrom(error, 'Question could not be revealed.');
      if (isPrincipalGenerationCurrent(generation)) set(state => state.popQuizState === next
        ? { popQuizState: previous, liveSessionError: message }
        : { liveSessionError: message });
      throw error;
    }
  },
  lockPopQuizQuestion: async () => {
    const generation = capturePrincipalGeneration();
    const previous = get().popQuizState;
    if (!previous) throw new Error('No live session is active.');
    if (previous.status !== 'active' || !previous.currentQuestionId) {
      const error = new Error('No live question is currently open.');
      set({ liveSessionError: error.message });
      throw error;
    }
    const activeId = previous.currentQuestionId;
    const completedQuestionIds = activeId && !previous.completedQuestionIds.includes(activeId)
      ? [...previous.completedQuestionIds, activeId]
      : previous.completedQuestionIds;
    const next: PopQuizState = {
      ...previous,
      revision: previous.revision + 1,
      status: 'waiting',
      questionOpenedAt: null,
      questionClosesAt: null,
      completedQuestionIds,
    };
    set({ popQuizState: next, liveSessionError: null });
    try {
      await repoFactory.liveSessions.publishSession(next.courseworkId, next);
    } catch (error) {
      const message = messageFrom(error, 'Question could not be locked.');
      if (isPrincipalGenerationCurrent(generation)) set(state => state.popQuizState === next
        ? { popQuizState: previous, liveSessionError: message }
        : { liveSessionError: message });
      throw error;
    }
  },
  submitPopQuizAnswer: async (studentId, questionId, answer) => {
    const generation = capturePrincipalGeneration();
    const previous = get().popQuizState;
    if (!previous || previous.status !== 'active' || previous.currentQuestionId !== questionId) {
      throw new Error('This live question is no longer accepting answers.');
    }
    if (previous.questionClosesAt !== null && Date.now() >= previous.questionClosesAt) {
      const error = new Error('The live-question timer has expired.');
      set({ liveSessionError: error.message });
      throw error;
    }
    const question = get().contentItems.find(item => item.id === previous.courseworkId)?.questions?.find(candidate => candidate.id === questionId);
    if (!question) throw new Error('The live question was not found.');
    validateLiveAnswer(question, answer);
    const pendingKey = `${previous.sessionId}:${studentId}:${questionId}`;
    const existingOperation = pendingLiveAnswers.get(pendingKey);
    if (existingOperation) return existingOperation;
    const operation = (async () => {
      set({ liveSessionError: null });
      try {
        await repoFactory.liveSessions.submitAnswer(previous.courseworkId, studentId, questionId, answer);
        // Commit only after the authoritative transport acknowledges the write.
        // Merge into the latest realtime state so another participant's answer
        // cannot be overwritten by this client's older snapshot.
        if (isPrincipalGenerationCurrent(generation)) set(state => {
          const current = state.popQuizState;
          if (!current || current.sessionId !== previous.sessionId || current.currentQuestionId !== questionId) {
            return { liveSessionError: null };
          }
          return {
            popQuizState: {
              ...current,
              answers: {
                ...current.answers,
                [studentId]: { ...(current.answers[studentId] || {}), [questionId]: answer },
              },
            },
            liveSessionError: null,
          };
        });
      } catch (error) {
        const message = messageFrom(error, 'Live answer could not be submitted.');
        if (isPrincipalGenerationCurrent(generation)) set({ liveSessionError: message });
        throw error;
      }
    })();
    pendingLiveAnswers.set(pendingKey, operation);
    try {
      await operation;
    } finally {
      if (pendingLiveAnswers.get(pendingKey) === operation) pendingLiveAnswers.delete(pendingKey);
    }
  },
  endPopQuiz: async () => {
    const generation = capturePrincipalGeneration();
    const previous = get().popQuizState;
    if (!previous) return;
    if (!repoFactory.liveSessions.finalizeSession) {
      const error = new Error('This live-session repository cannot durably archive results. Configure finalizeSession before hosting live assessments.');
      set({ liveSessionError: error.message });
      throw error;
    }
    set({ liveSessionError: null });
    try {
      const archived = await repoFactory.liveSessions.finalizeSession(previous.courseworkId, previous.sessionId);
      const archivedIds = new Set(archived.map(submission => submission.id));
      if (isPrincipalGenerationCurrent(generation)) set(state => ({
        popQuizState: state.popQuizState?.sessionId === previous.sessionId ? null : state.popQuizState,
        submissions: [...state.submissions.filter(submission => !archivedIds.has(submission.id)), ...archived],
        liveSessionError: null,
      }));
    } catch (error) {
      const message = messageFrom(error, 'Live session could not be ended.');
      if (isPrincipalGenerationCurrent(generation)) set({ liveSessionError: message });
      throw error;
    }
  },
  subscribeToPopQuiz: (courseworkId) => {
    const generation = capturePrincipalGeneration();
    let disposed = false;
    let receivedRealtimeState = false;
    const item = get().contentItems.find(candidate => candidate.id === courseworkId);
    const acceptState = (rawState: PopQuizState | null, fromRealtime: boolean) => {
      try {
        const popQuizState = validatePopQuizState(rawState, {
          expectedCourseworkId: courseworkId,
          questions: item?.questions,
        });
        if (!disposed && isPrincipalGenerationCurrent(generation)) {
          if (fromRealtime) receivedRealtimeState = true;
          set({ popQuizState, liveSessionError: null });
        }
      } catch (error) {
        if (!disposed && isPrincipalGenerationCurrent(generation)) set({ liveSessionError: messageFrom(error, 'The live session returned invalid data.') });
      }
    };
    const unsubscribe = repoFactory.liveSessions.subscribeToSession(
      courseworkId,
      popQuizState => acceptState(popQuizState, true),
      error => { if (!disposed && isPrincipalGenerationCurrent(generation)) set({ liveSessionError: messageFrom(error, 'The live session connection failed.') }); },
    );
    void repoFactory.liveSessions.getSession(courseworkId)
      .then(popQuizState => {
        if (!receivedRealtimeState) acceptState(popQuizState, false);
      })
      .catch(error => {
        if (!disposed && isPrincipalGenerationCurrent(generation)) set({ liveSessionError: messageFrom(error, 'Live session could not be loaded.') });
      });
    return () => {
      disposed = true;
      unsubscribe();
    };
  },

  fetchContent: async (courseId) => {
    const generation = capturePrincipalGeneration();
    try {
      const items = await repoFactory.content.getContentItems(courseId);
      if (isPrincipalGenerationCurrent(generation)) set(state => ({
        contentItems: [...state.contentItems.filter(item => item.courseId !== courseId), ...items],
        contentMutationError: null,
      }));
    } catch (error) {
      if (isPrincipalGenerationCurrent(generation)) set({ contentMutationError: messageFrom(error, 'Course content could not be loaded.') });
      throw error;
    }
  },
});
