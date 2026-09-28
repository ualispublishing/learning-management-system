import assert from 'node:assert/strict';
import test from 'node:test';
import { DemoLiveSessionRepository } from '../src/lib/repositories/memory/LiveSessionRepositoryImpl';
import { mergeChatMessages } from '../src/lib/store/slices/chatSlice';
import { ChatMessage } from '../src/types/lms';
import { initNewCard, reviewCard } from '../src/lib/srs/engine';
import { validatePopQuizState } from '../src/lib/liveSessions/validation';
import { demoSubmissions } from '../src/lib/repositories/sqlite/SubmissionRepositoryImpl';
import { DemoChatRepository } from '../src/lib/repositories/sqlite/ChatRepositoryImpl';

const LIVE_QUIZ_ID = 'item_live_pop_quiz';
const LIVE_QUIZ_QUESTION_ID = 'q_live_python_1';
const LIVE_POLL_ID = 'item_live_poll_week1';
const LIVE_POLL_QUESTION_ID = 'q_live_poll_week1';

test('live session transport publishes host state and accumulates answers per student and question', async () => {
  const repository = new DemoLiveSessionRepository();
  const observed: (string | null)[] = [];
  const unsubscribe = repository.subscribeToSession(LIVE_QUIZ_ID, state => observed.push(state?.status ?? null));
  const openedAt = Date.now();
  await repository.publishSession(LIVE_QUIZ_ID, {
    courseworkId: LIVE_QUIZ_ID,
    sessionId: 'live-run-1',
    startedAt: openedAt,
    revision: 1,
    status: 'active',
    currentQuestionId: LIVE_QUIZ_QUESTION_ID,
    questionOpenedAt: openedAt,
    questionClosesAt: null,
    completedQuestionIds: [],
    answers: {},
  });
  await repository.submitAnswer(LIVE_QUIZ_ID, 'u3', LIVE_QUIZ_QUESTION_ID, 'def');
  const session = await repository.getSession(LIVE_QUIZ_ID);
  assert.equal(session?.answers.u3[LIVE_QUIZ_QUESTION_ID], 'def');
  assert.deepEqual(observed, [null, 'active', 'active']);
  await repository.finalizeSession(LIVE_QUIZ_ID, 'live-run-1');
  for (let index = demoSubmissions.length - 1; index >= 0; index -= 1) {
    if (demoSubmissions[index].liveSessionId === 'live-run-1') demoSubmissions.splice(index, 1);
  }
  assert.equal(await repository.getSession(LIVE_QUIZ_ID), null);
  assert.deepEqual(observed, [null, 'active', 'active', null]);
  unsubscribe();
});

test('live session rejects stale answers after the host changes questions', async () => {
  const repository = new DemoLiveSessionRepository();
  await repository.publishSession(LIVE_QUIZ_ID, {
    courseworkId: LIVE_QUIZ_ID, sessionId: 'live-run-2', startedAt: Date.now(), revision: 1, status: 'waiting', currentQuestionId: LIVE_QUIZ_QUESTION_ID, questionOpenedAt: null, questionClosesAt: null, completedQuestionIds: [], answers: {},
  });
  await assert.rejects(() => repository.submitAnswer(LIVE_QUIZ_ID, 'u3', 'old-question', 'late'), /no longer accepting/);
  await repository.finalizeSession(LIVE_QUIZ_ID, 'live-run-2');
});

test('live host revisions reject stale devices and never let host payloads replace answers', async () => {
  const repository = new DemoLiveSessionRepository();
  const sessionId = 'live-host-revision-test';
  const startedAt = Date.now();
  await repository.publishSession(LIVE_QUIZ_ID, {
    courseworkId: LIVE_QUIZ_ID, sessionId, startedAt, revision: 1, status: 'waiting', currentQuestionId: null,
    questionOpenedAt: null, questionClosesAt: null, completedQuestionIds: [], answers: {},
  });
  await assert.rejects(() => repository.publishSession(LIVE_QUIZ_ID, {
    courseworkId: LIVE_QUIZ_ID, sessionId, startedAt, revision: 3, status: 'waiting', currentQuestionId: null,
    questionOpenedAt: null, questionClosesAt: null, completedQuestionIds: [], answers: {},
  }), /revision conflict: expected revision 2/);
  await repository.publishSession(LIVE_QUIZ_ID, {
    courseworkId: LIVE_QUIZ_ID, sessionId, startedAt, revision: 2, status: 'active', currentQuestionId: LIVE_QUIZ_QUESTION_ID,
    questionOpenedAt: startedAt, questionClosesAt: null, completedQuestionIds: [],
    answers: { u3: { [LIVE_QUIZ_QUESTION_ID]: 'def' } },
  });
  assert.deepEqual((await repository.getSession(LIVE_QUIZ_ID))?.answers, {});
  await repository.finalizeSession(LIVE_QUIZ_ID, sessionId);
});

test('live session rejects malformed, cross-course, unknown-question, and expired state', async () => {
  const question = { id: 'q-1', label: '1', content: 'Choose one', answerType: 'multiple_choice' as const, options: ['A', 'B'] };
  const active = {
    courseworkId: 'quiz-live', sessionId: 'live-run-3', startedAt: 100, revision: 1, status: 'active' as const, currentQuestionId: 'q-1', questionOpenedAt: 100,
    questionClosesAt: 200, completedQuestionIds: [], answers: { 'student-1': { 'q-1': 'A' } },
  };
  assert.equal(validatePopQuizState(active, { expectedCourseworkId: 'quiz-live', questions: [question] })?.currentQuestionId, 'q-1');
  assert.throws(() => validatePopQuizState({ ...active, courseworkId: 'other' }, { expectedCourseworkId: 'quiz-live', questions: [question] }), /different coursework/);
  assert.throws(() => validatePopQuizState({ ...active, currentQuestionId: 'missing' }, { expectedCourseworkId: 'quiz-live', questions: [question] }), /outside this coursework/);
  assert.throws(() => validatePopQuizState({ ...active, questionOpenedAt: null }, { expectedCourseworkId: 'quiz-live', questions: [question] }), /requires a current question and start time/);

  const repository = new DemoLiveSessionRepository();
  await repository.publishSession(LIVE_QUIZ_ID, {
    ...active,
    courseworkId: LIVE_QUIZ_ID,
    currentQuestionId: LIVE_QUIZ_QUESTION_ID,
    answers: {},
  });
  await assert.rejects(() => repository.submitAnswer(LIVE_QUIZ_ID, 'u3', LIVE_QUIZ_QUESTION_ID, 'def'), /timer has expired/);
  await repository.finalizeSession(LIVE_QUIZ_ID, 'live-run-3');
});

test('live finalization is durable, graded, and idempotent without duplicating attempts', async () => {
  const repository = new DemoLiveSessionRepository();
  const sessionId = 'live-archive-graded-test';
  const startedAt = Date.now();
  const priorCount = demoSubmissions.length;
  try {
    await repository.publishSession(LIVE_QUIZ_ID, {
      courseworkId: LIVE_QUIZ_ID,
      sessionId,
      startedAt,
      revision: 1,
      status: 'active',
      currentQuestionId: LIVE_QUIZ_QUESTION_ID,
      questionOpenedAt: startedAt,
      questionClosesAt: null,
      completedQuestionIds: [],
      answers: {},
    });
    await repository.submitAnswer(LIVE_QUIZ_ID, 'u3', LIVE_QUIZ_QUESTION_ID, 'def');
    const archived = await repository.finalizeSession(LIVE_QUIZ_ID, sessionId);
    assert.equal(archived.length, 1);
    assert.equal(archived[0].liveSessionId, sessionId);
    assert.equal(archived[0].attemptNumber, 1);
    assert.equal(archived[0].responses[0].answer, 'def');
    assert.equal(archived[0].responses[0].score, 5);
    assert.equal(archived[0].totalScore, 5);
    assert.equal(await repository.getSession(LIVE_QUIZ_ID), null);

    const retry = await repository.finalizeSession(LIVE_QUIZ_ID, sessionId);
    assert.equal(retry[0].id, archived[0].id);
    assert.equal(demoSubmissions.filter(submission => submission.liveSessionId === sessionId).length, 1);
    assert.equal(demoSubmissions.length, priorCount + 1);
  } finally {
    for (let index = demoSubmissions.length - 1; index >= 0; index -= 1) {
      if (demoSubmissions[index].liveSessionId === sessionId) demoSubmissions.splice(index, 1);
    }
  }
});

test('ungraded live polls archive answers without manufacturing score metadata', async () => {
  const repository = new DemoLiveSessionRepository();
  const sessionId = 'live-archive-poll-test';
  const startedAt = Date.now();
  try {
    await repository.publishSession(LIVE_POLL_ID, {
      courseworkId: LIVE_POLL_ID,
      sessionId,
      startedAt,
      revision: 1,
      status: 'active',
      currentQuestionId: LIVE_POLL_QUESTION_ID,
      questionOpenedAt: startedAt,
      questionClosesAt: null,
      completedQuestionIds: [],
      answers: {},
    });
    await repository.submitAnswer(LIVE_POLL_ID, 'u4', LIVE_POLL_QUESTION_ID, 3);
    const [archived] = await repository.finalizeSession(LIVE_POLL_ID, sessionId);
    assert.equal(archived.liveSessionId, sessionId);
    assert.equal(archived.responses[0].answer, 3);
    assert.equal(archived.responses[0].score, undefined);
    assert.equal(archived.responses[0].isCorrect, undefined);
    assert.equal(archived.totalScore, undefined);
  } finally {
    for (let index = demoSubmissions.length - 1; index >= 0; index -= 1) {
      if (demoSubmissions[index].liveSessionId === sessionId) demoSubmissions.splice(index, 1);
    }
  }
});

test('chat reconciliation is idempotent when a subscription beats the send acknowledgement', () => {
  const message: ChatMessage = {
    id: 'message-1',
    threadId: 'thread-1',
    senderId: 'user-1',
    senderName: 'User One',
    role: 'student',
    text: 'Hello',
    timestamp: 100,
    readBy: 1,
  };
  const reconciled = mergeChatMessages([message], [{ ...message, readBy: 2 }]);
  assert.equal(reconciled.length, 1);
  assert.equal(reconciled[0].readBy, 2);
});

test('demo chat authorizes private history reads and returns bounded inbox summaries', async () => {
  const repository = new DemoChatRepository();
  await assert.rejects(() => repository.getMessages('dm_u1_u2', 'u3'), /not accessible/);
  const directThreads = await repository.getDirectThreads('u3');
  const peerThread = directThreads.find(thread => thread.id === 'dm_u3_u4');
  assert.ok(peerThread);
  assert.equal(Number.isInteger(peerThread.unreadCount), true);
  assert.ok((peerThread.lastMessagePreview?.length ?? 0) <= 500);
  assert.ok((peerThread.lastMessageAt ?? 0) > 0);
});

test('FSRS review persists learning-step state and normalized retrievability', () => {
  const card = initNewCard({ id: 'card-1', note_id: 'note-1', deck_id: 'deck-1', template_id: 'default' });
  const { updatedCard } = reviewCard(card, 70, Date.UTC(2026, 6, 19));
  assert.equal(Number.isInteger(updatedCard.learning_steps), true);
  assert.ok(updatedCard.retrievability >= 0 && updatedCard.retrievability <= 1);
  assert.ok(updatedCard.due >= Date.UTC(2026, 6, 19));
});
