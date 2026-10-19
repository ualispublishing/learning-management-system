import { AIResponseError, readServerProvenance, readSourceReviewNotices } from './responseValidation';
import type { AIGenerationInput, AIRequestHistory, AIRequestHistoryPage } from './types';

export type AIRequestTask = 'flashcards' | 'syllabus';

/** A failed submission retains only this review's source snapshot and read-only recovery. */
export class AIRequestError extends AIResponseError {
  readonly requestId: string;
  readonly task: AIRequestTask;
  readonly courseId?: string;
  readonly canCheckSavedResult: boolean;
  #input: AIGenerationInput;
  #check?: () => Promise<unknown>;

  constructor(message: string, requestId: string, task: AIRequestTask, input: AIGenerationInput, check?: () => Promise<unknown>) {
    super(message);
    this.requestId = requestId; this.task = task; this.courseId = input.courseId;
    this.#input = { ...input, document: input.document ? { ...input.document } : undefined };
    this.#check = check; this.canCheckSavedResult = Boolean(check);
  }
  matches(task: AIRequestTask, input: AIGenerationInput): boolean {
    if (this.task !== task || ['courseId', 'courseTitle', 'sourceText', 'requestedCardCount', 'locale'].some(key => this.#input[key as keyof AIGenerationInput] !== input[key as keyof AIGenerationInput])) return false;
    const previous = this.#input.document, current = input.document;
    if (!previous || !current) return previous === current;
    return previous.uri === current.uri && previous.name === current.name && previous.mimeType === current.mimeType
      && previous.size === current.size && previous.kind === current.kind && previous.file === current.file;
  }
  async checkSavedResult(): Promise<unknown> {
    if (!this.#check) throw new AIResponseError('This institution has not configured saved-result recovery.');
    return this.#check();
  }
}

/** Snapshot the reselected source; each check verifies it again without generation. */
export function savedAIRequest(history: AIRequestHistory, task: AIRequestTask, input: AIGenerationInput, requestId: string): AIRequestError {
  const source = { ...input, document: input.document ? { ...input.document } : undefined };
  const handle = (message: string): AIRequestError => new AIRequestError(message, requestId, task, source, async () => {
    try {
      const result = await history.recover(task, source, requestId);
      if (readServerProvenance(result, task, true, Boolean(source.document))?.requestId !== requestId) throw new AIResponseError('The saved draft does not belong to the selected request.');
      return result;
    }
    catch (error) { throw handle(error instanceof AIResponseError ? error.message : 'The saved result could not be recovered. No new generation was requested.'); }
  });
  return handle('Recovering a saved request.');
}

export function readAIHistoryPage(value: unknown, task: AIRequestTask, courseId: string): AIRequestHistoryPage {
  const invalid = () => { throw new AIResponseError('The saved request history returned an invalid or mismatched page.'); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const page = value as Record<string, unknown>;
  if (Object.keys(page).some(key => !['items', 'nextCursor'].includes(key)) || !Array.isArray(page.items) || page.items.length > 20) return invalid();
  const ids = new Set<string>(), requests = new Set<string>();
  for (const item of page.items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return invalid();
    const row = item as Record<string, unknown>;
    if (Object.keys(row).some(key => !['id', 'requestId', 'courseId', 'task', 'status', 'createdAt', 'expiresAt', 'fileName', 'hasPastedText', 'locale', 'requestedCardCount'].includes(key))
      || typeof row.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(row.id) || ids.has(row.id)
      || typeof row.requestId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(row.requestId) || requests.has(row.requestId)
      || row.courseId !== courseId || row.task !== task || !['processing', 'succeeded', 'uncertain'].includes(String(row.status))
      || typeof row.createdAt !== 'number' || !Number.isSafeInteger(row.createdAt) || row.createdAt <= 0
      || typeof row.expiresAt !== 'number' || !Number.isSafeInteger(row.expiresAt) || row.expiresAt <= row.createdAt
      || !(row.fileName === null || typeof row.fileName === 'string' && row.fileName.length > 0 && row.fileName.length <= 255 && !/[\\/\0]/.test(row.fileName))
      || typeof row.hasPastedText !== 'boolean' || row.fileName === null && !row.hasPastedText
      || typeof row.locale !== 'string' || row.locale.length > 100
      || typeof row.requestedCardCount !== 'number' || !Number.isInteger(row.requestedCardCount) || row.requestedCardCount < 1 || row.requestedCardCount > 100) return invalid();
    try { if (Intl.getCanonicalLocales(row.locale).length !== 1) return invalid(); } catch { return invalid(); }
    ids.add(row.id); requests.add(row.requestId);
  }
  if (page.nextCursor !== null && (page.items.length !== 20 || page.nextCursor !== page.items.at(-1)?.id)) return invalid();
  return page as unknown as AIRequestHistoryPage;
}

/** Strict status-v1 parsing; no status ever authorizes another generation call. */
export function readRecoveredAIResult(value: unknown, task: AIRequestTask, input: AIGenerationInput, requestId: string): unknown {
  const invalid = () => { throw new AIResponseError('The saved AI request returned an invalid or mismatched record.'); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const record = value as Record<string, unknown>;
  const keys = ['id', 'requestId', 'courseId', 'task', 'status', 'result', 'reviewNotices', 'createdAt', 'expiresAt'];
  if (Object.keys(record).some(key => !keys.includes(key)) || typeof record.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(record.id)
    || record.requestId !== requestId || record.courseId !== input.courseId || record.task !== task
    || !['processing', 'uncertain', 'succeeded'].includes(String(record.status))
    || typeof record.createdAt !== 'number' || !Number.isSafeInteger(record.createdAt) || record.createdAt <= 0
    || typeof record.expiresAt !== 'number' || !Number.isSafeInteger(record.expiresAt) || record.expiresAt <= record.createdAt
    || !Array.isArray(record.reviewNotices)) return invalid();
  const notices = readSourceReviewNotices(record.reviewNotices);
  if (record.status !== 'succeeded') {
    if (record.result !== undefined) return invalid();
    throw new AIResponseError(record.status === 'processing'
      ? 'Generation is still in progress. Check the saved result again shortly.'
      : 'The provider outcome is uncertain. Ask your administrator to reconcile this request before starting another generation.');
  }
  const provenance = readServerProvenance(record.result, task, true, Boolean(input.document));
  if (provenance?.requestId !== requestId || JSON.stringify(provenance.sourceReviewNotices) !== JSON.stringify(notices)) return invalid();
  return record.result;
}
