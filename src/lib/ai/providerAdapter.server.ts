/** Server-only vendor boundary. Never bundle API credentials into the app. */
import { createHash } from 'node:crypto';
import { FLASHCARD_PROMPT_VERSION, FLASHCARD_RESPONSE_SCHEMA, FLASHCARD_SYSTEM_PROMPT, SYLLABUS_PROMPT_VERSION, SYLLABUS_RESPONSE_SCHEMA, SYLLABUS_SYSTEM_PROMPT } from './prompts.ts';
import { readSourceReviewNotices, validateCards, validateInstitutionSyllabusResult } from './responseValidation.ts';
import type { AIGenerationInput } from './types.ts';

export type AITask = 'syllabus' | 'flashcards';
export interface ExtractedAISource {
  text: string;
  segments: { location: string; text: string }[];
  documentSha256?: string;
}
export interface AIProviderRequest {
  task: AITask;
  promptVersion: string;
  systemPrompt: string;
  responseSchema: object;
  source: ExtractedAISource;
  courseTitle?: string;
  locale: string;
  requestedCardCount: number;
  signal: AbortSignal;
  /** Only trusted adapter code reports API-envelope metadata, never generated JSON. */
  reportMetadata?: (metadata: AIProviderMetadata) => void;
}
export interface AIProviderMetadata {
  model: string;
  responseId: string;
  httpRequestId?: string;
  reasoningEffort?: string;
  requestSha256: string;
  inputTokens?: number;
  outputTokens?: number;
}
export interface AIProviderReceipt extends AIProviderMetadata {
  providerId: string;
  requestId: string;
  task: AITask;
  promptVersion: string;
  sourceSha256: string;
  documentSha256?: string;
  outputSha256: string;
}
export interface AIProvider {
  id: string;
  /** Return task JSON only. Provenance and human approval belong to the gateway. */
  generate(request: AIProviderRequest): Promise<unknown>;
}
export const sha256 = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Enforce cancellation even when an injected transport or credential store ignores it. */
async function untilAborted<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try { return await Promise.race([work(), aborted]); }
  finally { signal.removeEventListener('abort', onAbort); }
}

/** SDKs, hosted APIs, local models and async jobs can all implement AIProvider. */
export function createHttpJsonAIProvider(options: {
  id: string;
  endpoint: string;
  headers?: (signal: AbortSignal) => Promise<Record<string, string>>;
  encode: (request: AIProviderRequest) => unknown;
  decode: (response: unknown, request: AIProviderRequest, headers: Headers, requestSha256: string) => unknown;
  fetchImpl?: typeof fetch;
  allowLoopback?: boolean;
}): AIProvider {
  if (typeof window !== 'undefined') throw new Error('AI API adapters must run on the server.');
  const endpoint = new URL(options.endpoint);
  const local = options.allowLoopback === true && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
  if ((endpoint.protocol !== 'https:' && !(local && endpoint.protocol === 'http:')) || endpoint.username || endpoint.password || endpoint.hash) throw new Error('Configure an HTTPS provider endpoint without embedded credentials.');
  return { id: options.id, async generate(request) {
    const signal = request.signal;
    let headers: Record<string, string> | undefined;
    try { headers = await untilAborted(signal, async () => options.headers?.(signal)); }
    catch { signal.throwIfAborted(); throw new Error('AI provider credentials are unavailable.'); }
    signal.throwIfAborted();
    const body = JSON.stringify(options.encode(request));
    if (!body || Buffer.byteLength(body) > 8_000_000) throw new Error('AI provider request exceeds 8 MB.');
    let response: Response;
    try {
      response = await untilAborted(signal, async () => {
        const result = await (options.fetchImpl ?? fetch)(endpoint, {
          method: 'POST', redirect: 'error', signal,
          headers: { ...headers, 'content-type': 'application/json' }, body,
        });
        if (signal.aborted) { void result.body?.cancel().catch(() => {}); signal.throwIfAborted(); }
        return result;
      });
    } catch { signal.throwIfAborted(); throw new Error('AI provider request failed.'); }
    if (!response.ok) { void response.body?.cancel().catch(() => {}); throw new Error(`AI provider ${options.id} failed (${response.status}).`); }
    if (!/^application\/(?:[\w.+-]*\+)?json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) { void response.body?.cancel().catch(() => {}); throw new Error('AI provider must return JSON.'); }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('AI provider returned an empty response.');
    let size = 0; const chunks: Uint8Array[] = [];
    try {
      while (true) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try { chunk = await untilAborted(signal, () => reader.read()); }
        catch { signal.throwIfAborted(); throw new Error('AI provider response could not be read.'); }
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 2_000_000) throw new Error('AI provider response exceeds 2 MB.');
        chunks.push(chunk.value);
      }
    } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
    signal.throwIfAborted();
    let raw: unknown;
    try { raw = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new Error('AI provider returned invalid JSON.'); }
    return options.decode(raw, request, response.headers, sha256(body));
  } };
}

/** Shared checks are independent of vendor output format and recorded/live mode. */
export async function runAIProvider(provider: AIProvider, task: AITask, input: AIGenerationInput, source: ExtractedAISource, requestId: string, options: {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Trusted extractor metadata, separate from model-generated task JSON. */
  sourceReviewNotices?: readonly string[];
  /** Persist only after source and output validation. No credentials or source text. */
  onReceipt?: (receipt: AIProviderReceipt) => void | Promise<void>;
} = {}) {
  if (task !== 'syllabus' && task !== 'flashcards') throw new Error('Unsupported AI task.');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('AI generation input is required.');
  if (input.sourceText !== undefined && (typeof input.sourceText !== 'string' || input.sourceText.length > 500_000)) throw new Error('Invalid source text input.');
  if (typeof source?.text !== 'string' || !source.text.trim() || source.text.length > 500_000 || !Array.isArray(source.segments) || !source.segments.length || source.segments.length > 10_000) throw new Error('An extracted source with bounded locations is required.');
  let segmentCharacters = 0;
  for (const segment of source.segments) {
    if (!segment || typeof segment.location !== 'string' || !segment.location.trim() || segment.location.length > 160 || typeof segment.text !== 'string' || !segment.text.trim()) throw new Error('Invalid extracted source segment.');
    segmentCharacters += segment.text.length;
    if (segmentCharacters > 1_000_000) throw new Error('Extracted source segments exceed the character limit.');
  }
  if (source.documentSha256 !== undefined && (typeof source.documentSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(source.documentSha256))) throw new Error('Invalid source file digest.');
  if (input.document && !source.documentSha256) throw new Error('An uploaded document requires its source file digest.');
  if (typeof provider.id !== 'string' || !provider.id.trim() || provider.id.length > 160 || typeof requestId !== 'string' || !requestId.trim() || requestId.length > 160) throw new Error('Invalid provider or request identifier.');
  const requestedCardCount = input.requestedCardCount ?? 30;
  if (!Number.isInteger(requestedCardCount) || requestedCardCount < 1 || requestedCardCount > 100) throw new Error('Requested flashcard count must be a whole number from 1 to 100.');
  if (input.courseTitle !== undefined && (typeof input.courseTitle !== 'string' || input.courseTitle.length > 300)) throw new Error('Invalid course title context.');
  const locale = input.locale ?? 'en';
  if (typeof locale !== 'string' || locale.length > 100 || !locale || Intl.getCanonicalLocales(locale).length !== 1) throw new Error('Invalid AI locale.');
  const timeoutMs = options.timeoutMs ?? 120_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000) throw new Error('AI timeout must be between 1 and 600000 milliseconds.');
  // Retain the checked inputs across awaits even if a caller reuses its mutable draft.
  const stableInput = { ...input, document: input.document ? { ...input.document } : undefined };
  const stableSource = { text: source.text, documentSha256: source.documentSha256, segments: source.segments.map(segment => ({ location: segment.location, text: segment.text })) };
  const sourceReviewNotices = readSourceReviewNotices(options.sourceReviewNotices);
  const callerSignal = options.signal;
  const controller = new AbortController();
  const cancel = () => controller.abort(new DOMException('AI generation was cancelled.', 'AbortError'));
  callerSignal?.addEventListener('abort', cancel, { once: true });
  if (callerSignal?.aborted) cancel();
  const timer = setTimeout(() => controller.abort(new DOMException('AI generation timed out.', 'TimeoutError')), timeoutMs);
  try {
    return await untilAborted(controller.signal, () => generateAndValidate(provider, task, stableInput, stableSource, requestId, locale, requestedCardCount, controller.signal, sourceReviewNotices, options.onReceipt));
  } finally { clearTimeout(timer); callerSignal?.removeEventListener('abort', cancel); }
}

async function generateAndValidate(provider: AIProvider, task: AITask, input: AIGenerationInput, source: ExtractedAISource, requestId: string, locale: string, requestedCardCount: number, signal: AbortSignal, sourceReviewNotices: string[] | undefined, onReceipt?: (receipt: AIProviderReceipt) => void | Promise<void>) {
  const promptVersion = task === 'syllabus' ? SYLLABUS_PROMPT_VERSION : FLASHCARD_PROMPT_VERSION;
  let metadata: AIProviderMetadata | undefined;
  const raw = await provider.generate({ task, promptVersion, source, courseTitle: input.courseTitle, locale, requestedCardCount,
    systemPrompt: task === 'syllabus' ? SYLLABUS_SYSTEM_PROMPT : FLASHCARD_SYSTEM_PROMPT,
    responseSchema: task === 'syllabus' ? SYLLABUS_RESPONSE_SCHEMA : FLASHCARD_RESPONSE_SCHEMA, signal,
    reportMetadata: value => {
      signal.throwIfAborted();
      if (metadata) throw new Error('AI provider reported multiple response receipts.');
      for (const field of ['model', 'responseId', 'httpRequestId', 'reasoningEffort'] as const) {
        if (value[field] !== undefined && (typeof value[field] !== 'string' || !value[field]!.trim() || value[field]!.length > 160 || /[\r\n]/.test(value[field]!))) throw new Error('Invalid AI provider receipt.');
      }
      if (!value.model || !value.responseId || !/^[a-f0-9]{64}$/.test(value.requestSha256)) throw new Error('Incomplete AI provider receipt.');
      for (const count of [value.inputTokens, value.outputTokens]) if (count !== undefined && (!Number.isSafeInteger(count) || count < 0)) throw new Error('Invalid AI provider token usage.');
      metadata = { model: value.model, responseId: value.responseId, httpRequestId: value.httpRequestId, reasoningEffort: value.reasoningEffort, requestSha256: value.requestSha256, inputTokens: value.inputTokens, outputTokens: value.outputTokens };
    },
  });
  signal.throwIfAborted();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || 'provenance' in raw) throw new Error('Provider must return task data without fabricated provenance.');
  const payload = raw as Record<string, unknown>;
  const evidence = (task === 'syllabus' ? payload.evidence : payload.cards) as { sourceExcerpt?: unknown; sourceLocation?: unknown }[];
  if (!Array.isArray(evidence) || !evidence.length || evidence.length > (task === 'syllabus' ? 200 : requestedCardCount)) throw new Error('Provider returned missing or excessive source evidence.');
  for (const entry of evidence) {
    if (!entry || typeof entry.sourceExcerpt !== 'string' || !entry.sourceExcerpt.trim() || typeof entry.sourceLocation !== 'string'
      || !source.segments.some(segment => segment.location === entry.sourceLocation && segment.text.includes(entry.sourceExcerpt as string))) {
      throw new Error('A quotation or its location does not match the extracted source.');
    }
  }
  const provenance = { promptVersion, evidenceVerified: true as const, sourceSha256: sha256(source.text), documentSha256: source.documentSha256, requestId, model: metadata?.model ?? provider.id,
    ...(sourceReviewNotices ? { sourceReviewNotices } : {}),
  };
  // Validate against canonical extracted text as well as the document envelope.
  const textInput = { ...input, document: undefined, sourceText: source.text };
  if (task === 'syllabus') {
    const checked = validateInstitutionSyllabusResult({ ...payload, provenance }, textInput);
    if (checked.gradingWeights && Math.abs(Object.values(checked.gradingWeights).reduce((sum, value) => sum + value, 0) - 100) > 0.01) throw new Error('Grading weights must total 100%; ambiguous schemes must be omitted.');
    if (payload.termStart && !checked.termStart || payload.termEnd && !checked.termEnd) throw new Error('Conflicting term dates require correction.');
    validateInstitutionSyllabusResult({ ...payload, provenance }, input);
  } else {
    validateCards({ ...payload, provenance }, textInput);
    validateCards({ ...payload, provenance }, input);
  }
  const result = { ...payload, provenance };
  if (metadata && onReceipt) await onReceipt({ ...metadata, providerId: provider.id, requestId, task, promptVersion, sourceSha256: provenance.sourceSha256, documentSha256: source.documentSha256, outputSha256: sha256(JSON.stringify(result)) });
  signal.throwIfAborted();
  return result;
}
