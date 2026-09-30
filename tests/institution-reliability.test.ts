import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createInstitutionRepositoryFactory, configureInstitutionRepositories } from '../src/lib/integration/InstitutionRepositoryFactory';
import { configureInstitutionSnapshotCache, restoreInstitutionJSON, clearInstitutionJSON } from '../src/lib/integration/institutionSync';
import { InstitutionSession } from '../src/lib/integration/InstitutionSession';
import type { User } from '../src/lib/repositories/interfaces';
import type { SyncCursor } from '../src/lib/integration/InstitutionAdapter';

const fixture = async () => JSON.parse(await readFile(new URL('../docs/institution-sync.example.json', import.meta.url), 'utf8'));
const teacher: User = { id: 'teacher-100', name: 'Ada Teacher', globalRole: 'admin' };
const courseId = 'course-chem-101';

const setup = async () => {
  const source = await fixture();
  source.etag = '"v1"';
  let user: User | null = teacher;
  let version = 1;
  const cursors: SyncCursor[] = [];
  const options = {
    initialSnapshot: structuredClone(source),
    getSessionUser: async () => user,
    login: async () => { user = teacher; },
    logout: async () => { user = null; },
    adapter: {
      async pullSnapshot(cursor: SyncCursor = {}) {
        cursors.push(structuredClone(cursor));
        if (cursor.etag === source.etag) return { notModified: true as const, etag: source.etag };
        return structuredClone(source);
      },
      async pushMutations(mutations: import('../src/lib/integration/InstitutionAdapter').PushMutation[]) {
        for (const mutation of mutations) {
          if (mutation.entity === 'course') Object.assign(source.courses[0].course, mutation.payload, { title: 'Server canonical title' });
          if (mutation.entity === 'content' && mutation.operation === 'create') {
            const { courseId: _courseId, ...content } = mutation.payload;
            source.courses[0].items.push({ ...content, title: 'Server canonical content' });
            source.courses[0].course.materialsCount = source.courses[0].items.filter((item: { deletedAt?: number }) => item.deletedAt === undefined).length;
          }
        }
        source.etag = `"v${++version}"`;
        return { acceptedIds: mutations.map(mutation => mutation.id), rejected: [], nextEtag: source.etag };
      },
    },
  };
  return { source, cursors, options };
};

test('a mutation refresh uses no cursor, returns canonical records, and subsequent 304 retains them', async () => {
  const { source, cursors, options } = await setup();
  const factory = createInstitutionRepositoryFactory({ ...options, snapshotTtlMs: 0 });
  await factory.courses.updateCourse(courseId, { title: 'Client proposal' });
  assert.deepEqual(cursors[0], {});
  assert.equal((await factory.courses.getCourseDetails(courseId))?.title, 'Server canonical title');
  assert.equal(cursors.at(-1)?.etag, '"v2"');
  const item = { ...source.courses[0].items.find((item: { category: string }) => item.category === 'material'), courseId, id: 'canonical-new-content', title: 'Proposed content' };
  const created = await factory.content.createContentItem(item);
  assert.equal(created.title, 'Server canonical content');
});

test('snapshot reads wait for an in-flight write and cannot replace its committed state', async () => {
  const { options } = await setup();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const push = options.adapter.pushMutations;
  options.adapter.pushMutations = async mutations => { entered.resolve(); await release.promise; return push(mutations); };
  const factory = createInstitutionRepositoryFactory({ ...options, snapshotTtlMs: 0 });
  const write = factory.courses.updateCourse(courseId, { title: 'Client proposal' });
  await entered.promise;
  let readFinished = false;
  const read = factory.courses.getCourseDetails(courseId).then(value => { readFinished = true; return value; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(readFinished, false);
  release.resolve();
  await write;
  assert.equal((await read)?.title, 'Server canonical title');
});

test('304 after acknowledgement is rejected until a complete canonical response is available', async () => {
  const { options } = await setup();
  const pull = options.adapter.pullSnapshot;
  options.adapter.pullSnapshot = async () => ({ notModified: true, etag: '"v2"' });
  const factory = createInstitutionRepositoryFactory(options);
  await assert.rejects(factory.courses.updateCourse(courseId, { title: 'Client proposal' }), /complete canonical snapshot/);
  await assert.rejects(factory.courses.getCourseDetails(courseId), /complete canonical snapshot/);
  options.adapter.pullSnapshot = pull;
  assert.equal((await factory.courses.getCourseDetails(courseId))?.title, 'Server canonical title');
});

test('logout requires provider invalidation, remains locally revoked on failure, and supports explicit same-user sign-in', async () => {
  const { options } = await setup();
  const invalid = createInstitutionRepositoryFactory({ ...options, logout: async () => undefined });
  await invalid.auth.login();
  await assert.rejects(invalid.auth.logout(), /did not invalidate/);
  assert.equal(await invalid.auth.getCurrentUser(), null);
  await assert.rejects(invalid.courses.getCourseDetails(courseId), /session changed/);
  const missing = createInstitutionRepositoryFactory({ ...options, logout: undefined, login: undefined });
  await missing.auth.login();
  await assert.rejects(missing.auth.logout(), /configure app-session logout/);
  await assert.rejects(missing.auth.login(), /explicit institution sign-in/);
  assert.throws(() => configureInstitutionRepositories({ ...options, logout: undefined }), /logout callback/);
  const factory = createInstitutionRepositoryFactory(options);
  assert.equal((await factory.auth.getCurrentUser())?.id, teacher.id); // preauthenticated startup
  await factory.auth.logout();
  assert.equal(await factory.auth.getCurrentUser(), null);
  const reloaded = createInstitutionRepositoryFactory(options);
  assert.equal(await reloaded.auth.getCurrentUser(), null); // fresh factory cannot restore old provider session
  assert.equal((await factory.auth.login()).user.id, teacher.id);
  assert.ok(await factory.courses.getCourseDetails(courseId));
});

test('logout rejects an old write even after the same principal signs back in', async () => {
  const { options } = await setup();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const push = options.adapter.pushMutations;
  options.adapter.pushMutations = async mutations => { entered.resolve(); await release.promise; return push(mutations); };
  const factory = createInstitutionRepositoryFactory(options);
  await factory.auth.login();
  const oldWrite = factory.courses.updateCourse(courseId, { title: 'Old session' });
  const rejected = assert.rejects(oldWrite, /session changed/);
  await entered.promise;
  await factory.auth.logout();
  const signingIn = factory.auth.login();
  release.resolve();
  await rejected;
  assert.equal((await signingIn).user.id, teacher.id);
});

test('logout erasure follows a pending cache save and the old read cannot return data', async () => {
  const { options } = await setup();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let saved: unknown = null;
  configureInstitutionSnapshotCache({
    async load() { return saved; },
    async save(_id, payload) { entered.resolve(); await release.promise; saved = structuredClone(payload); },
    async clear() { saved = null; },
  });
  try {
    const factory = createInstitutionRepositoryFactory(options);
    const loading = factory.courses.getCourseDetails(courseId);
    const rejected = assert.rejects(loading, /session changed/);
    await entered.promise;
    const logout = factory.auth.logout();
    release.resolve();
    await Promise.all([rejected, logout]);
    assert.equal(saved, null);
    assert.equal(await restoreInstitutionJSON(teacher.id), null);
  } finally { configureInstitutionSnapshotCache(null); }
});

test('session boundary disposes subscriptions and suppresses stale callbacks after same-user login', async () => {
  const boundary = new InstitutionSession(async () => teacher);
  let incoming: (value: string) => void = () => undefined;
  let disposed = 0;
  const repository = boundary.guard({
    subscribe(callback: (value: string) => void) { incoming = callback; return () => { disposed++; }; },
  }, { subscribe: 1 });
  const received: string[] = [];
  repository.subscribe(value => received.push(value));
  incoming('before');
  boundary.revoke();
  boundary.activate(boundary.capture());
  incoming('after');
  assert.equal(disposed, 1);
  assert.deepEqual(received, ['before']);
});

test('production configuration also reads canonical state for metadata-free acknowledgements', async () => {
  const { options, cursors } = await setup();
  const push = options.adapter.pushMutations;
  const adapter = {
    ...options.adapter,
    async pushMutations(mutations: import('../src/lib/integration/InstitutionAdapter').PushMutation[]) {
      const result = await push(mutations);
      return { acceptedIds: result.acceptedIds, rejected: result.rejected };
    },
  };
  // Metadata-free gateways must omit a snapshot ETag too; otherwise CAS is invalid.
  delete options.initialSnapshot.etag;
  const factory = configureInstitutionRepositories({ ...options, adapter });
  await factory.courses.updateCourse(courseId, { title: 'Client proposal' });
  assert.deepEqual(cursors[0], {});
  assert.equal((await factory.courses.getCourseDetails(courseId))?.title, 'Server canonical title');
});

test('successful logout also revokes a sign-in that was already running at the provider', async () => {
  for (const afterPreviousLogout of [false, true]) {
    const { options } = await setup();
    let user: User | null = afterPreviousLogout ? teacher : null;
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const config = {
      ...options,
      getSessionUser: async () => user,
      login: async () => { entered.resolve(); await release.promise; user = teacher; },
      logout: async () => { user = null; },
    };
    const factory = createInstitutionRepositoryFactory(config);
    if (afterPreviousLogout) await factory.auth.logout();
    const signingIn = factory.auth.login();
    const rejected = assert.rejects(signingIn, /session changed|SSO session/);
    await entered.promise;
    let logoutCompleted = false;
    const logout = factory.auth.logout().then(() => { logoutCompleted = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(logoutCompleted, false);
    release.resolve();
    await Promise.all([rejected, logout]);
    assert.equal(user, null);
    assert.equal(await createInstitutionRepositoryFactory(config).auth.getCurrentUser(), null);
  }
});

test('a cache restore started before erasure cannot return an old snapshot after logout', async () => {
  const source = await fixture();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  configureInstitutionSnapshotCache({
    async load() { entered.resolve(); await release.promise; return source; },
    async save() {},
    async clear() {},
  });
  try {
    const restoring = restoreInstitutionJSON(teacher.id);
    await entered.promise;
    await clearInstitutionJSON(teacher.id);
    release.resolve();
    assert.equal(await restoring, null);
  } finally { configureInstitutionSnapshotCache(null); }
});

test('cancelled explicit sign-in remains revoked without repeating the provider prompt', async () => {
  const { options } = await setup();
  let attempts = 0;
  const factory = createInstitutionRepositoryFactory({ ...options, login: async () => { attempts++; } });
  await factory.auth.logout();
  await assert.rejects(factory.auth.login(), /SSO session is required/);
  assert.equal(attempts, 1);
  assert.equal(await factory.auth.getCurrentUser(), null);
  await assert.rejects(factory.courses.getCourseDetails(courseId), /session changed/);
});
