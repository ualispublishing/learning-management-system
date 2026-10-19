/** Conservative limits for the optional, single-installation text AI gateway. */
export const MAX_AI_REQUEST_BYTES = 2_064_000;
export const MAX_AI_ARTIFACT_BYTES = 8 * 1024 * 1024;
export const MAX_AI_STORAGE_BYTES = 64 * 1024 * 1024;
export const MAX_AI_RESPONSE_BYTES = 2_000_000;
export const AI_HISTORY_PAGE_SIZE = 20;
export const AI_RECOVERY_PATH = /^\/lms\/v1\/ai\/requests\/([A-Za-z0-9][A-Za-z0-9._:-]{0,127})\/recover$/;
export interface AIJobPolicy { retentionHours: number; dailyRequestLimit: number }
export type AIJobStatus = 'processing' | 'succeeded' | 'uncertain';
export interface AIJob {
  id: string; requestId: string; courseId: string; task: 'syllabus' | 'flashcards'; status: AIJobStatus;
  result?: Record<string, unknown>; reviewNotices: string[]; createdAt: number; expiresAt: number;
}
