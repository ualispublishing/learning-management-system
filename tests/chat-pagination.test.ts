import test from 'node:test';
import assert from 'node:assert/strict';
import type { ChatMessage } from '../src/types/lms';
import {
  MAX_CHAT_PAGE_SIZE,
  normalizeChatMessagePageRequest,
  paginateChatMessages,
  validateChatMessagePageEnvelope,
} from '../src/lib/chat/pagination';
import { mergeChatMessages, validateRealtimeChatMessages } from '../src/lib/store/slices/chatSlice';
import { DemoChatRepository, demoMessageReports } from '../src/lib/repositories/sqlite/ChatRepositoryImpl';
import { demoMessages } from '../src/lib/repositories/memory/demoData';

const message = (index: number, overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: `message-${String(index).padStart(3, '0')}`,
  revision: 1,
  threadId: 'thread-1',
  senderId: index % 2 ? 'student-1' : 'teacher-1',
  senderName: index % 2 ? 'Student One' : 'Teacher One',
  role: index % 2 ? 'student' : 'teacher',
  text: `Message ${index}`,
  timestamp: 1_000 + index,
  readBy: 1,
  readByUserIds: [index % 2 ? 'student-1' : 'teacher-1'],
  ...overrides,
});

test('chat pagination returns bounded chronological pages without gaps or duplicates', () => {
  const source = Array.from({ length: 125 }, (_, index) => message(index));
  const first = paginateChatMessages(source);
  assert.equal(first.messages.length, 50);
  assert.equal(first.messages[0].id, 'message-075');
  assert.equal(first.messages[49].id, 'message-124');
  assert.equal(first.hasMore, true);
  assert.ok(first.nextCursor);

  const second = paginateChatMessages(source, { cursor: first.nextCursor });
  const third = paginateChatMessages(source, { cursor: second.nextCursor });
  assert.deepEqual(
    [...third.messages, ...second.messages, ...first.messages].map(entry => entry.id),
    source.map(entry => entry.id),
  );
  assert.equal(third.hasMore, false);
  assert.equal(third.nextCursor, undefined);
});

test('chat pagination remains stable when messages share a timestamp and supports authorized search fields', () => {
  const source = [
    message(1, { id: 'same-a', timestamp: 5_000, text: 'ordinary' }),
    message(2, { id: 'same-b', timestamp: 5_000, text: 'needle in text' }),
    message(3, { id: 'same-c', timestamp: 5_000, mediaName: 'needle.pdf' }),
    message(4, { id: 'same-d', timestamp: 5_000, senderName: 'Needle Person' }),
  ];
  const first = paginateChatMessages(source, { limit: 2 });
  const second = paginateChatMessages(source, { limit: 2, cursor: first.nextCursor });
  assert.deepEqual([...second.messages, ...first.messages].map(entry => entry.id), ['same-a', 'same-b', 'same-c', 'same-d']);
  assert.deepEqual(paginateChatMessages(source, { query: 'needle' }).messages.map(entry => entry.id), ['same-b', 'same-c', 'same-d']);
});

test('chat page boundaries reject unsafe limits, queries, cursors, and malformed provider envelopes', () => {
  assert.throws(() => normalizeChatMessagePageRequest({ limit: MAX_CHAT_PAGE_SIZE + 1 }), /page size/i);
  assert.throws(() => normalizeChatMessagePageRequest({ query: 'x' }), /2–200/);
  assert.throws(() => paginateChatMessages([message(1)], { cursor: 'tampered' }), /cursor/i);
  assert.throws(() => validateChatMessagePageEnvelope({ messages: [], hasMore: true }, 50), /continuation cursor/i);
  assert.throws(() => validateChatMessagePageEnvelope({ messages: [], hasMore: false, extra: true }, 50), /unsupported field/i);
});

test('message reconciliation preserves monotonic revisions, tombstones, and read receipts', () => {
  const original = message(1, { readBy: 1, readByUserIds: ['student-1'] });
  const sameRevisionTamper = { ...original, text: 'Tampered without CAS', deletedAt: original.timestamp + 1 };
  const afterTamper = mergeChatMessages([original], [sameRevisionTamper]);
  assert.equal(afterTamper[0].text, original.text);
  assert.equal(afterTamper[0].deletedAt, undefined);

  const edited = { ...original, revision: 2, text: 'Edited', editedAt: original.timestamp + 1, readBy: 1, readByUserIds: ['teacher-1'] };
  const reconciled = mergeChatMessages([original], [edited]);
  assert.equal(reconciled[0].text, 'Edited');
  assert.equal(reconciled[0].revision, 2);
  assert.deepEqual(reconciled[0].readByUserIds?.sort(), ['student-1', 'teacher-1']);

  const deleted = { ...edited, revision: 3, deletedAt: original.timestamp + 2 };
  const withTombstone = mergeChatMessages(reconciled, [deleted]);
  const afterStaleReplay = mergeChatMessages(withTombstone, [original]);
  assert.equal(afterStaleReplay[0].deletedAt, deleted.deletedAt);
  assert.equal(afterStaleReplay[0].revision, 3);
  assert.equal(afterStaleReplay[0].text, '');
  const afterAttemptedRestore = mergeChatMessages(afterStaleReplay, [{ ...original, revision: 4, text: 'Restore attempt' }]);
  assert.equal(afterAttemptedRestore[0].deletedAt, deleted.deletedAt);
  assert.equal(afterAttemptedRestore[0].text, '');
});

test('real-time edited and deleted messages require an advanced content revision', () => {
  const invalid = validateRealtimeChatMessages('thread-1', [{ ...message(1), editedAt: 2_000, revision: 1 }]);
  assert.equal(invalid.success, false);
  const valid = validateRealtimeChatMessages('thread-1', [{ ...message(1), editedAt: 2_000, revision: 2 }]);
  assert.equal(valid.success, true);
  const redactedTombstone = validateRealtimeChatMessages('thread-1', [{ ...message(1), text: '', deletedAt: 2_000, revision: 2 }]);
  assert.equal(redactedTombstone.success, true);
});

test('demo chat supports revision-safe author edits, staff deletion, reports, search, and pagination', async () => {
  const repository = new DemoChatRepository();
  const createdIds: string[] = [];
  const initialReportCount = demoMessageReports.length;
  try {
    const direct = await repository.sendMessage({
      threadId: 'dm_u3_u4', senderId: 'u3', senderName: 'ignored', role: 'student', text: 'Original direct message', readBy: 1, readByUserIds: ['u3'],
    });
    createdIds.push(direct.id);
    await assert.rejects(() => repository.editMessage(direct.id, 'u4', 'Forged edit', 1), /original sender/);
    const edited = await repository.editMessage(direct.id, 'u3', 'Searchable revised message', 1);
    assert.equal(edited.revision, 2);
    await assert.rejects(() => repository.editMessage(direct.id, 'u3', 'Stale edit', 1), /revision conflict/);
    const search = await repository.getMessages('dm_u3_u4', 'u4', { query: 'searchable', limit: 10 });
    assert.ok(search.messages.some(entry => entry.id === direct.id));
    await repository.reportMessage(direct.id, 'u4', 'This message requires a moderation review.');
    await repository.reportMessage(direct.id, 'u4', 'This duplicate report is idempotent.');
    assert.equal(demoMessageReports.length, initialReportCount + 1);
    await assert.rejects(() => repository.deleteMessage(direct.id, 'u4', 2), /sender or authorized course staff/);

    const courseMessage = await repository.sendMessage({
      threadId: 'c1_general', senderId: 'u3', senderName: 'ignored', role: 'student', text: 'Course moderation fixture', readBy: 1, readByUserIds: ['u3'],
    });
    createdIds.push(courseMessage.id);
    const removed = await repository.deleteMessage(courseMessage.id, 'u1', 1);
    assert.equal(removed.deletedAt !== undefined, true);
    assert.equal(removed.revision, 2);
    assert.equal(removed.text, '');
    assert.equal(removed.mediaUrl, undefined);
    assert.equal(removed.mediaName, undefined);
    assert.equal(removed.mentionedUserIds, undefined);
    assert.equal((await repository.getMessages('c1_general', 'u1', { query: 'moderation fixture' })).messages.some(entry => entry.id === courseMessage.id), false);
  } finally {
    for (let index = demoMessages.length - 1; index >= 0; index -= 1) {
      if (createdIds.includes(demoMessages[index].id)) demoMessages.splice(index, 1);
    }
    demoMessageReports.splice(initialReportCount);
  }
});
