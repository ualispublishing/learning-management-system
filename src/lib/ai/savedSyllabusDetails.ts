import type { Course } from '../../types/lms';
import { isValidISODate } from './service';
import { canonicalSafeHttpsUrl } from '../safeUrl';
import { readSourceReviewNotices } from './responseValidation';

export interface SavedSyllabusDetails {
  courseCode?: string;
  courseDuration?: string;
  intendedAudience?: string;
  learningObjectives: string[];
  meetingTimes: string[];
  sourceAsset?: { name: string; url: string };
  instructorNames: string[];
  schedule: { date?: string; topic: string }[];
  requiredMaterials: string[];
  policies: { name: string; text: string }[];
  warnings: string[];
  sourceReviewNotices: string[];
  humanReviewedAt?: string;
  provenance?: unknown;
  sourceFileName?: string;
}

export const getSavedSyllabusDetails = (course: Pick<Course, 'metadata'>): SavedSyllabusDetails | null => {
  const raw = course.metadata?.syllabus;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const strings = (value: unknown, limit: number, maxLength: number) => Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim()) && entry.length <= maxLength).slice(0, limit)
    : [];
  const schedule = Array.isArray(record.schedule) ? record.schedule.flatMap(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const value = entry as Record<string, unknown>;
    if (typeof value.topic !== 'string' || !value.topic.trim() || value.topic.length > 600) return [];
    return [{ topic: value.topic, date: typeof value.date === 'string' && isValidISODate(value.date) ? value.date : undefined }];
  }).slice(0, 500) : [];
  const policies = Array.isArray(record.policies) ? record.policies.flatMap(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const value = entry as Record<string, unknown>;
    if (typeof value.name !== 'string' || typeof value.text !== 'string' || !value.name.trim() || value.name.length > 160 || !value.text.trim() || value.text.length > 4000) return [];
    return [{ name: value.name, text: value.text }];
  }).slice(0, 100) : [];
  let sourceAsset: SavedSyllabusDetails['sourceAsset'];
  if (record.sourceAsset && typeof record.sourceAsset === 'object' && !Array.isArray(record.sourceAsset)) {
    const value = record.sourceAsset as Record<string, unknown>;
    const safeUrl = typeof value.url === 'string' ? canonicalSafeHttpsUrl(value.url) : null;
    if (typeof value.name === 'string' && value.name.trim() && value.name.length <= 1_024 && safeUrl) {
      sourceAsset = { name: value.name, url: safeUrl };
    }
  }
  const scalar = (key: string, limit: number) => typeof record[key] === 'string' && record[key].trim() && record[key].length <= limit ? record[key] : undefined;
  let sourceReviewNotices: string[] = [];
  if (record.provenance && typeof record.provenance === 'object' && !Array.isArray(record.provenance)) {
    try { sourceReviewNotices = readSourceReviewNotices((record.provenance as Record<string, unknown>).sourceReviewNotices) ?? []; }
    catch { sourceReviewNotices = ['The saved source processing notes are invalid. Ask your administrator to inspect the original generation record.']; }
  }
  return {
    courseCode: scalar('courseCode', 80),
    courseDuration: scalar('courseDuration', 300),
    intendedAudience: scalar('intendedAudience', 1000),
    learningObjectives: strings(record.learningObjectives, 50, 600),
    meetingTimes: strings(record.meetingTimes, 30, 600),
    sourceAsset,
    provenance: record.provenance,
    sourceFileName: scalar('sourceFileName', 1024),
    instructorNames: strings(record.instructorNames, 30, 200),
    schedule,
    requiredMaterials: strings(record.requiredMaterials, 100, 600),
    policies,
    warnings: strings(record.warnings, 100, 600),
    sourceReviewNotices,
    humanReviewedAt: typeof record.humanReviewedAt === 'string' && Number.isFinite(Date.parse(record.humanReviewedAt)) ? record.humanReviewedAt : undefined,
  };
};
