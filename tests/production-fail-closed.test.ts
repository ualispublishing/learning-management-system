import assert from 'node:assert/strict';
import test from 'node:test';

test('a production runtime cannot read demo institution data before authenticated adapters are configured', async () => {
  Object.assign(globalThis, { __DEV__: false });
  const { isRepositoryFactoryConfigured, repoFactory } = await import('../src/lib/repositories/factory');
  assert.equal(isRepositoryFactoryConfigured(), false);
  await assert.rejects(
    () => repoFactory.auth.getCurrentUser(),
    /Institution repositories are not configured/,
  );
  await assert.rejects(
    () => repoFactory.courses.getCoursesForUser('u1'),
    /Institution repositories are not configured/,
  );
  await assert.rejects(
    () => repoFactory.chat.getDirectThreads('u1'),
    /Institution repositories are not configured/,
  );
});
