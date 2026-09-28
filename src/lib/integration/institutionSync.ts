/**
 * @fileoverview src/lib/integration/institutionSync.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import { StudentSubmission } from '../../types/lms';
import {
  demoContentItems,
  demoCourses,
  demoMessages,
  demoThreads,
  demoUsers,
} from '../repositories/memory/demoData';
import {
  NormalizedInstitutionSync,
  ValidationIssue,
  mergeNormalizedInstitutionSync,
  validateInstitutionSync,
} from '../schema/CourseSchema';
import { cloneSubmission, demoSubmissions } from '../repositories/sqlite/SubmissionRepositoryImpl';

export interface InstitutionSnapshotCache {
  load(principalId: string): Promise<unknown | null>;
  save(principalId: string, payload: unknown): Promise<void>;
  clear(principalId: string): Promise<void>;
}

let snapshotCache: InstitutionSnapshotCache | null = null;
const snapshotWarnings = new Map<string, string>();

/**
 * Offline storage is opt-in because institution snapshots can contain PII and
 * grades. Native deployments should inject an encrypted, access-controlled cache.
 */
export const configureInstitutionSnapshotCache = (cache: InstitutionSnapshotCache | null) => {
  snapshotCache = cache;
  snapshotWarnings.clear();
};

const rememberSnapshotWarning = (principalId: string, message: string) => {
  snapshotWarnings.set(principalId, message);
};

/** Returns and clears the latest non-fatal cache warning for this principal. */
export const consumeInstitutionSnapshotWarning = (principalId: string) => {
  const warning = snapshotWarnings.get(principalId) ?? null;
  snapshotWarnings.delete(principalId);
  return warning;
};

export interface InstitutionImportReport {
  syncId: string;
  mode: 'snapshot' | 'upsert';
  warnings: ValidationIssue[];
  counts: {
    users: number;
    courses: number;
    contentItems: number;
    threads: number;
    messages: number;
    submissions: number;
  };
}

const replace = <T>(target: T[], incoming: T[]) => target.splice(0, target.length, ...incoming);

let lastLocallyImportedSnapshot: NormalizedInstitutionSync | null = null;

export const applyInstitutionSync = (data: NormalizedInstitutionSync): InstitutionImportReport => {
  if (data.mode !== 'snapshot') {
    throw new Error('Incremental institution data must be reconciled with its base snapshot before it can replace local repositories.');
  }
  const courses = data.courses.map(entry => entry.course);
  const contentItems = data.courses.flatMap(entry => entry.items);
  replace(demoUsers, data.users);
  replace(demoCourses, courses);
  replace(demoContentItems, contentItems);
  replace(demoThreads, data.threads || []);
  replace(demoMessages, data.messages || []);
  replace(demoSubmissions, (data.submissions || []).map(cloneSubmission));

  return {
    syncId: data.syncId,
    mode: data.mode,
    warnings: [],
    counts: {
      users: data.users.length,
      courses: courses.length,
      contentItems: contentItems.length,
      threads: data.threads?.length || 0,
      messages: data.messages?.length || 0,
      submissions: data.submissions?.length || 0,
    },
  };
};

export async function importInstitutionJSON(input: unknown): Promise<{
  report: InstitutionImportReport;
  data: NormalizedInstitutionSync;
  submissions: StudentSubmission[];
}> {
  const requestedMode = input && typeof input === 'object' && !Array.isArray(input) && (input as { mode?: unknown }).mode === 'upsert'
    ? 'upsert'
    : 'snapshot';
  if (requestedMode === 'upsert' && !lastLocallyImportedSnapshot) {
    throw new Error('A client-side cursor upsert requires a previously imported full snapshot. Import the snapshot first, or use the authenticated synchronization gateway.');
  }
  const result = validateInstitutionSync(input, requestedMode === 'upsert' ? lastLocallyImportedSnapshot ?? undefined : undefined);
  if (!result.success) {
    const error = new Error('Institution JSON failed validation.') as Error & { issues?: ValidationIssue[] };
    error.issues = result.issues;
    throw error;
  }
  const effectiveData = requestedMode === 'upsert' && lastLocallyImportedSnapshot
    ? mergeNormalizedInstitutionSync(lastLocallyImportedSnapshot, result.data)
    : result.data;
  const report = applyInstitutionSync(effectiveData);
  report.mode = requestedMode;
  report.warnings = result.issues.filter(entry => entry.severity === 'warning');
  lastLocallyImportedSnapshot = { ...effectiveData, mode: 'snapshot' };
  return { report, data: lastLocallyImportedSnapshot, submissions: lastLocallyImportedSnapshot.submissions || [] };
}

export async function restoreInstitutionJSON(principalId: string): Promise<NormalizedInstitutionSync | null> {
  if (!snapshotCache) return null;
  let input: unknown | null;
  try {
    input = await snapshotCache.load(principalId);
  } catch {
    rememberSnapshotWarning(principalId, 'The encrypted offline snapshot could not be read. The LMS will use the institution connection.');
    return null;
  }
  if (!input) return null;
  const result = validateInstitutionSync(input);
  if (!result.success) {
    try {
      await snapshotCache.clear(principalId);
      rememberSnapshotWarning(principalId, 'An invalid offline snapshot was rejected and erased. The LMS will use the institution connection.');
    } catch {
      rememberSnapshotWarning(principalId, 'An invalid offline snapshot was rejected, but the encrypted cache could not be erased. Contact your institution administrator.');
    }
    return null;
  }
  return result.data;
}

/**
 * Persists only a validated, complete snapshot. Cache failures are deliberately
 * non-fatal to an otherwise successful institution request, but are surfaced to
 * the UI instead of disappearing silently.
 */
export async function cacheInstitutionJSON(
  principalId: string,
  data: NormalizedInstitutionSync,
): Promise<void> {
  if (!snapshotCache) return;
  const snapshot = { ...data, mode: 'snapshot' as const };
  const result = validateInstitutionSync(snapshot);
  if (!result.success) {
    rememberSnapshotWarning(principalId, 'The latest institution response could not be cached because it was not a complete valid snapshot.');
    return;
  }
  try {
    await snapshotCache.save(principalId, result.data);
  } catch {
    rememberSnapshotWarning(principalId, 'The LMS loaded successfully, but its encrypted offline snapshot could not be updated.');
  }
}

/** Clears principal-bound offline data without preventing local sign-out. */
export async function clearInstitutionJSON(principalId: string): Promise<void> {
  if (!snapshotCache) return;
  try {
    await snapshotCache.clear(principalId);
    snapshotWarnings.delete(principalId);
  } catch {
    rememberSnapshotWarning(principalId, 'Signed out, but the encrypted offline snapshot could not be erased. Contact your institution administrator.');
  }
}
