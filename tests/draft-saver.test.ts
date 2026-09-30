import assert from 'node:assert/strict';
import test from 'node:test';
import { DraftSaver } from '../src/lib/assessment/draftSaver';

test('a settled autosave failure retains the latest draft and exit retries it', async () => {
  let failing = true;
  const writes: string[] = [];
  const errors: unknown[] = [];
  const saver = new DraftSaver<string>(async draft => {
    writes.push(draft);
    if (failing) throw new Error('offline');
  }, error => errors.push(error));
  saver.pending = 'answer';
  assert.equal(await saver.flush(), false);
  assert.equal(saver.pending, 'answer');
  assert.equal(await saver.flush(), false);
  assert.equal(saver.pending, 'answer');
  failing = false;
  assert.equal(await saver.flush(), true);
  assert.equal(saver.pending, null);
  assert.deepEqual(writes, ['answer', 'answer', 'answer']);
  assert.equal(errors.at(-1), null);
});

test('edits during a failing write retain the newer complete draft for serialized retry', async () => {
  const deferred = Promise.withResolvers<void>();
  const writes: string[] = [];
  const saver = new DraftSaver<string>(async draft => {
    writes.push(draft);
    if (writes.length === 1) await deferred.promise;
  }, () => undefined);
  saver.pending = 'old';
  const saving = saver.flush();
  await Promise.resolve();
  saver.pending = 'intermediate';
  saver.pending = 'latest';
  assert.equal(saver.flush(), saving);
  deferred.reject(new Error('network failed'));
  assert.equal(await saving, false);
  assert.equal(saver.pending, 'latest');
  assert.equal(await saver.flush(), true);
  assert.deepEqual(writes, ['old', 'latest']);
});

test('successful slow writes drain newer edits before allowing close', async () => {
  const deferred = Promise.withResolvers<void>();
  const writes: string[] = [];
  const saver = new DraftSaver<string>(async draft => {
    writes.push(draft);
    if (writes.length === 1) await deferred.promise;
  }, () => undefined);
  saver.pending = 'first';
  const closing = saver.flush();
  await Promise.resolve();
  saver.pending = 'last';
  deferred.resolve();
  assert.equal(await closing, true);
  assert.deepEqual(writes, ['first', 'last']);
  assert.equal(saver.pending, null);
});
