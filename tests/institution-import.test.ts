import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { importInstitutionJSON } from '../src/lib/integration/institutionSync';
import {
  demoContentItems,
  demoCourses,
  demoMessages,
  demoThreads,
  demoUsers,
} from '../src/lib/repositories/memory/demoData';
import { demoSubmissions } from '../src/lib/repositories/sqlite/SubmissionRepositoryImpl';

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

test('client-side cursor imports fail closed without an imported base snapshot', async () => {
  await assert.rejects(
    () => importInstitutionJSON({ mode: 'upsert' }),
    /requires a previously imported full snapshot/,
  );
});

test('client-side institution imports keep repository submissions and tombstones synchronized', async () => {
  const original = {
    users: clone(demoUsers),
    courses: clone(demoCourses),
    contentItems: clone(demoContentItems),
    threads: clone(demoThreads),
    messages: clone(demoMessages),
    submissions: clone(demoSubmissions),
  };
  try {
    const source = JSON.parse(await readFile(new URL('../docs/institution-sync.example.json', import.meta.url), 'utf8'));
    const snapshot = await importInstitutionJSON(source);
    const submissionId = source.submissions[0].id as string;
    assert.ok(snapshot.submissions.some(submission => submission.id === submissionId));
    assert.ok(demoSubmissions.some(submission => submission.id === submissionId));

    const upsert = {
      schemaVersion: source.schemaVersion,
      syncId: 'local-upsert-2',
      generatedAt: '2026-08-05T12:00:00Z',
      mode: 'upsert',
      institution: source.institution,
      deletions: { submissions: [submissionId] },
    };
    const merged = await importInstitutionJSON(upsert);
    assert.equal(merged.report.mode, 'upsert');
    assert.equal(merged.data.mode, 'snapshot');
    assert.equal(merged.submissions.some(submission => submission.id === submissionId), false);
    assert.equal(demoSubmissions.some(submission => submission.id === submissionId), false);
  } finally {
    demoUsers.splice(0, demoUsers.length, ...original.users);
    demoCourses.splice(0, demoCourses.length, ...original.courses);
    demoContentItems.splice(0, demoContentItems.length, ...original.contentItems);
    demoThreads.splice(0, demoThreads.length, ...original.threads);
    demoMessages.splice(0, demoMessages.length, ...original.messages);
    demoSubmissions.splice(0, demoSubmissions.length, ...original.submissions);
  }
});
