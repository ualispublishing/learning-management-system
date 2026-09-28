import assert from 'node:assert/strict';
import test from 'node:test';
import {
  configureLearningStateService,
  LEARNING_STATE_RETENTION_MS,
  LearningActivityEvent,
  LearningStateKeyValueStorage,
  learningStateStorageKey,
  LocalLearningStateService,
  recordConsentedLearningActivity,
} from '../src/lib/learningState';

class MemoryStorage implements LearningStateKeyValueStorage {
  readonly values = new Map<string, string>();

  async getItem(key: string) { return this.values.get(key) ?? null; }
  async setItem(key: string, value: string) { this.values.set(key, value); }
  async removeItem(key: string) { this.values.delete(key); }
}

class ActivityService extends LocalLearningStateService {
  readonly events: LearningActivityEvent[] = [];

  async recordActivity(event: LearningActivityEvent) {
    this.events.push(event);
  }
}

test('resume state is isolated by principal, course, content, and kind', async () => {
  const service = new LocalLearningStateService(new MemoryStorage(), () => 1_000);
  const scope = { principalId: 'student-a', courseId: 'course-1', contentItemId: 'quiz-1' };

  await service.save(scope, 'assessment-navigation', { pageIndex: 3 }, 'write-1');
  assert.equal((await service.load(scope, 'assessment-navigation'))?.payload.pageIndex, 3);
  assert.equal(await service.load({ ...scope, principalId: 'student-b' }, 'assessment-navigation'), null);
  assert.equal(await service.load({ ...scope, contentItemId: 'quiz-2' }, 'assessment-navigation'), null);
  assert.equal(await service.load({ principalId: 'student-a', courseId: 'course-1' }, 'course-page'), null);
});

test('expired or corrupt local resume state is erased instead of applied', async () => {
  const storage = new MemoryStorage();
  let now = 5_000;
  const service = new LocalLearningStateService(storage, () => now);
  const scope = { principalId: 'student-a', courseId: 'course-1' };
  await service.save(scope, 'course-page', { pageId: 'current', verticalOffset: 120, maximizedWidgetId: null });

  now += LEARNING_STATE_RETENTION_MS['course-page'] + 1;
  assert.equal(await service.load(scope, 'course-page'), null);
  assert.equal(storage.values.size, 0);

  const key = learningStateStorageKey(scope, 'course-page');
  storage.values.set(key, '{not json');
  await assert.rejects(() => service.load(scope, 'course-page'), /corrupt/i);
  assert.equal(storage.values.has(key), false);
});

test('resume payload validation rejects missing scope, oversized drafts, and invalid progress', async () => {
  const service = new LocalLearningStateService(new MemoryStorage(), () => 1_000);
  await assert.rejects(
    () => service.save({ principalId: 'student-a' }, 'course-page', { pageId: 'current' }),
    /requires a course scope/i,
  );
  await assert.rejects(
    () => service.save(
      { principalId: 'student-a', threadId: 'thread-1' },
      'chat-draft',
      { text: 'x'.repeat(20_001), mentionedUserIds: [], clientMessageId: 'message-1' },
    ),
    /draft is invalid/i,
  );
  await assert.rejects(
    () => service.save(
      { principalId: 'student-a', courseId: 'course-1', contentItemId: 'site-1' },
      'external-site',
      { loadedAt: 1_000, progress: 1.1 },
    ),
    /progress is invalid/i,
  );
});

test('analytics remains off without affirmative consent and uses event IDs when enabled', async () => {
  const service = new ActivityService(new MemoryStorage(), () => 1_000);
  const scope = { principalId: 'student-a', courseId: 'course-1', contentItemId: 'site-1' };

  configureLearningStateService(service, async () => ({ granted: false, noticeVersion: 'privacy-v1' }));
  assert.equal(await recordConsentedLearningActivity({ type: 'external-site-loaded', scope, occurredAt: 1_000 }), false);
  assert.equal(service.events.length, 0);

  configureLearningStateService(service, async () => ({ granted: true, noticeVersion: 'privacy-v1' }));
  assert.equal(await recordConsentedLearningActivity({ type: 'external-site-loaded', scope, occurredAt: 1_000 }), true);
  assert.equal(service.events.length, 1);
  assert.match(service.events[0].eventId, /^activity_/);
  assert.equal(service.events[0].consentNoticeVersion, 'privacy-v1');
  assert.deepEqual(service.events[0].scope, scope);
});
