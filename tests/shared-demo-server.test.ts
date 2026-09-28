import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSharedDemoServer,
  DEFAULT_SHARED_DEMO_RESET_KEY,
  resetSharedDemoData,
} from '../src/lib/testing/sharedDemoServer';

const startServer = async () => {
  const server = createSharedDemoServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
};

const rpc = async (
  baseUrl: string,
  userId: string,
  service: string,
  method: string,
  args: unknown[],
) => fetch(`${baseUrl}/rpc`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-demo-user-id': userId },
  body: JSON.stringify({ service, method, args }),
});

test('shared demo server enforces identity and role boundaries while sharing mutations', async () => {
  resetSharedDemoData();
  const { server, baseUrl } = await startServer();
  try {
    const health = await fetch(`${baseUrl}/health`).then(response => response.json()) as { result: { mode: string } };
    assert.equal(health.result.mode, 'shared-demo');

    const mismatched = await rpc(baseUrl, 'u3', 'chat', 'getThreads', ['c1', 'u1']);
    assert.equal(mismatched.status, 403);

    const forbiddenContent = await rpc(baseUrl, 'u3', 'content', 'createContentItem', [{
      id: 'shared-forbidden-item', courseId: 'c1', type: 'material', title: 'Forbidden student post',
      description: '', date: Date.now(), orderIndex: 999,
    }]);
    assert.equal(forbiddenContent.status, 403);

    const messageId = `shared-message-${Date.now()}`;
    const sent = await rpc(baseUrl, 'u3', 'chat', 'sendMessage', [{
      clientMessageId: messageId,
      threadId: 'c1_general',
      senderId: 'u3',
      senderName: 'Forged name',
      role: 'admin',
      text: 'A shared student message.',
      readBy: 99,
      readByUserIds: ['u1'],
    }]);
    assert.equal(sent.status, 200);

    const teacherPage = await rpc(baseUrl, 'u1', 'chat', 'getMessages', ['c1_general', 'u1', { limit: 100 }]);
    const teacherPayload = await teacherPage.json() as { result: { messages: Array<{ id: string; senderName: string; role: string }> } };
    const sharedMessage = teacherPayload.result.messages.find(message => message.id === messageId);
    assert.deepEqual(sharedMessage && { senderName: sharedMessage.senderName, role: sharedMessage.role }, {
      senderName: 'Alice Student',
      role: 'student',
    });

    const created = await rpc(baseUrl, 'u1', 'content', 'createContentItem', [{
      id: 'shared-teacher-item', courseId: 'c1', type: 'material', title: 'Shared teacher post',
      description: 'Visible after another session refreshes.', date: Date.now(), orderIndex: 999,
    }]);
    assert.equal(created.status, 200);
    const studentItems = await rpc(baseUrl, 'u3', 'content', 'getContentItems', ['c1']);
    const studentPayload = await studentItems.json() as { result: Array<{ id: string }> };
    assert.equal(studentPayload.result.some(item => item.id === 'shared-teacher-item'), true);
  } finally {
    resetSharedDemoData();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('shared demo message stream delivers another user message and reset restores fixtures', async () => {
  resetSharedDemoData();
  const { server, baseUrl } = await startServer();
  const controller = new AbortController();
  try {
    const streamResponse = await fetch(`${baseUrl}/events/messages?threadId=c1_general&userId=u1`, {
      signal: controller.signal,
    });
    assert.equal(streamResponse.status, 200);
    assert.ok(streamResponse.body);
    const reader = streamResponse.body.getReader();
    const decoder = new TextDecoder();
    const messageId = `shared-stream-${Date.now()}`;

    const received = (async () => {
      let text = '';
      while (!text.includes(messageId)) {
        const chunk = await reader.read();
        if (chunk.done) break;
        text += decoder.decode(chunk.value, { stream: true });
      }
      return text;
    })();

    const sent = await rpc(baseUrl, 'u3', 'chat', 'sendMessage', [{
      clientMessageId: messageId,
      threadId: 'c1_general',
      senderId: 'u3',
      senderName: 'Alice Student',
      role: 'student',
      text: 'Realtime shared message.',
      readBy: 1,
      readByUserIds: ['u3'],
    }]);
    assert.equal(sent.status, 200);
    assert.match(await received, new RegExp(messageId));

    const reset = await fetch(`${baseUrl}/reset`, {
      method: 'POST',
      headers: { 'x-demo-reset-key': DEFAULT_SHARED_DEMO_RESET_KEY },
    });
    assert.equal(reset.status, 200);
    const page = await rpc(baseUrl, 'u1', 'chat', 'getMessages', ['c1_general', 'u1', { limit: 100 }]);
    const payload = await page.json() as { result: { messages: Array<{ id: string }> } };
    assert.equal(payload.result.messages.some(message => message.id === messageId), false);
  } finally {
    controller.abort();
    resetSharedDemoData();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
