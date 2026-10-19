/**
 * @fileoverview src/lib/ai/service.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import { createEntityId } from '../id';
import { AIResponseError, readServerProvenance, validateCards, validateInstitutionFlashcardResult, validateInstitutionSyllabusResult, validateSyllabus } from './responseValidation';
import { isPreparedAIDemo, preparedDemoBaseUrl } from './preparedDemo';
import { assertAISourceProfile, sourceProfileDescription, sourceProfilePickerTypes } from './sourceProfile';
import { AIRequestError, readAIHistoryPage, readRecoveredAIResult, type AIRequestTask } from './requestRecovery';
import { appendMultipartAsset, isPickerOwnedAssetUri, validateMultipartAssetBytes } from '../integration/multipartAsset';
import { awaitWithAbort, readBoundedResponseText, readRemoteErrorDetail } from '../integration/httpResponse';
import {
  FLASHCARD_PROMPT_VERSION,
  SYLLABUS_PROMPT_VERSION,
} from './prompts';
import {
  AIDocumentAsset,
  AIGenerationInput,
  AIService,
  AIRequestHistory,
  GeneratedFlashcard,
  SyllabusExtraction,
} from './types';

export { AIResponseError, isValidISODate, readServerProvenance, validateCards, validateInstitutionFlashcardResult, validateInstitutionSyllabusResult, validateSyllabus } from './responseValidation';
export { AIRequestError } from './requestRecovery';

const MAX_TEXT_CHARACTERS = 500_000;
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
const MAX_MEDIA_BYTES = 50 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 300_000;
const MAX_RESPONSE_BYTES = 2_000_000;
const DOCUMENT_MIME_TYPES: Record<string, readonly string[]> = {
  pdf: ['application/pdf'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  pptx: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  txt: ['text/plain'],
  md: ['text/markdown', 'text/plain'],
  rtf: ['application/rtf', 'text/rtf'],
  vtt: ['text/vtt', 'text/plain'],
  srt: ['application/x-subrip', 'text/plain'],
  mp3: ['audio/mpeg'],
  m4a: ['audio/mp4', 'audio/x-m4a'],
  wav: ['audio/wav', 'audio/x-wav'],
  mp4: ['video/mp4'],
  mov: ['video/quicktime'],
  webm: ['video/webm', 'audio/webm'],
};
const MEDIA_EXTENSIONS = new Set(['mp3', 'm4a', 'wav', 'mp4', 'mov', 'webm']);

export const inferAIDocumentKind = (document: AIDocumentAsset): NonNullable<AIDocumentAsset['kind']> => {
  const extension = document.name.toLocaleLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
  const normalizedMimeType = document.mimeType?.split(';', 1)[0].trim().toLocaleLowerCase();
  return ['vtt', 'srt'].includes(extension)
    ? 'captions'
    : ['mp3', 'm4a', 'wav'].includes(extension) || (extension === 'webm' && normalizedMimeType?.startsWith('audio/'))
      ? 'audio'
      : ['mp4', 'mov', 'webm'].includes(extension) ? 'video' : 'document';
};

export class AIConfigurationError extends Error {}

type AIServiceConfig = {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  /** Opt in only when the authenticated gateway implements this recovery contract. */
  requestRecovery?: 'status-v1' | 'history-v1';
  sourceProfile?: 'text-v1';
} & (
  | { authentication?: 'bearer'; getAccessToken?: () => Promise<string | null> }
  | { authentication: 'same-origin-cookie'; getAccessToken?: never }
);

function safeBaseUrl(baseUrl: string): { url: string; localDevelopment: boolean } {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new AIConfigurationError('The AI service URL is invalid.');
  }
  const developmentBuild = typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production';
  const localDevelopment = developmentBuild && ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && localDevelopment)) {
    throw new AIConfigurationError('The AI service must use HTTPS outside local development.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new AIConfigurationError('The AI service URL cannot contain credentials, a query, or a fragment.');
  }
  return { url: url.toString().replace(/\/+$/, ''), localDevelopment };
}

function validateInput(input: AIGenerationInput, task: 'flashcards' | 'syllabus' = 'flashcards') {
  if (!input || typeof input !== 'object') throw new Error('AI generation input is required.');
  if (input.courseId !== undefined && (typeof input.courseId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.courseId))) {
    throw new Error('AI course scope must be a valid stable course identifier.');
  }
  if (input.sourceText !== undefined && typeof input.sourceText !== 'string') throw new Error('Source material must be text.');
  const text = input.sourceText?.trim() || '';
  if (!text && !input.document) throw new Error('Paste source material or select a document first.');
  if (text.length > MAX_TEXT_CHARACTERS) throw new Error('Pasted source material exceeds the 500,000 character limit.');
  if (input.document) {
    if (!input.document.name.trim() || input.document.name.length > 255 || /[\\/\0]/.test(input.document.name)) {
      throw new Error('The selected document has an invalid file name.');
    }
    if (!isPickerOwnedAssetUri(input.document.uri)) {
      throw new Error('The selected document URI is not supported.');
    }
    const extension = input.document.name.toLocaleLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
    const isMedia = MEDIA_EXTENSIONS.has(extension);
    const normalizedMimeType = input.document.mimeType?.split(';', 1)[0].trim().toLocaleLowerCase();
    const inferredKind = inferAIDocumentKind(input.document);
    if (input.document.kind && input.document.kind !== inferredKind) throw new Error('The selected source kind does not match its file extension.');
    if (task === 'syllabus' && inferredKind !== 'document') throw new Error('Syllabus extraction supports documents and text, not captions, audio, or video.');
    const maxBytes = isMedia ? MAX_MEDIA_BYTES : MAX_DOCUMENT_BYTES;
    if (input.document.size !== undefined && (!Number.isInteger(input.document.size) || input.document.size < 0 || input.document.size > maxBytes)) {
      throw new Error(`The selected source size is invalid or exceeds the ${Math.floor(maxBytes / 1024 / 1024)} MB limit.`);
    }
    validateMultipartAssetBytes(input.document, maxBytes);
    const expectedMimeTypes = DOCUMENT_MIME_TYPES[extension];
    const mimeType = normalizedMimeType;
    if (input.document.mimeType && (input.document.mimeType.length > 160 || /[\r\n]/.test(input.document.mimeType))) {
      throw new Error('The selected document MIME type is invalid.');
    }
    const mimeMatches = !mimeType || mimeType === 'application/octet-stream' || expectedMimeTypes?.includes(mimeType);
    if (!expectedMimeTypes || !mimeMatches) {
      throw new Error('Supported AI sources depend on the connected service. This file extension or MIME type is not accepted.');
    }
  }
  if (input.courseTitle !== undefined && typeof input.courseTitle !== 'string') throw new Error('Course title context must be text.');
  if (input.courseTitle && input.courseTitle.length > 300) throw new Error('Course title context exceeds 300 characters.');
  if (input.locale) {
    try {
      if (Intl.getCanonicalLocales(input.locale).length !== 1) throw new Error();
    } catch {
      throw new Error('Locale must be a valid BCP 47 language tag.');
    }
  }
  if (input.requestedCardCount !== undefined && (!Number.isInteger(input.requestedCardCount) || input.requestedCardCount < 1 || input.requestedCardCount > 100)) {
    throw new Error('Requested flashcard count must be a whole number from 1 to 100.');
  }
}

export async function generateValidatedFlashcards(input: AIGenerationInput): Promise<GeneratedFlashcard[]> {
  validateInput(input, 'flashcards');
  const service = getAIService();
  assertAISourceProfile(input, 'flashcards', service.sourceProfile);
  return validateInstitutionFlashcardResult(await service.generateFlashcards(input), input);
}

export async function extractValidatedSyllabus(input: AIGenerationInput): Promise<SyllabusExtraction> {
  validateInput(input, 'syllabus');
  const service = getAIService();
  assertAISourceProfile(input, 'syllabus', service.sourceProfile);
  return validateInstitutionSyllabusResult(await service.extractSyllabus(input), input);
}

export async function recoverValidatedFlashcards(error: AIRequestError, input: AIGenerationInput): Promise<GeneratedFlashcard[]> {
  validateInput(input, 'flashcards');
  if (!error.matches('flashcards', input)) throw new AIResponseError('This saved request belongs to a different source or course.');
  return validateInstitutionFlashcardResult(validateCards(await error.checkSavedResult(), input), input);
}

export async function recoverValidatedSyllabus(error: AIRequestError, input: AIGenerationInput): Promise<SyllabusExtraction> {
  validateInput(input, 'syllabus');
  if (!error.matches('syllabus', input)) throw new AIResponseError('This saved request belongs to a different source or course.');
  return validateInstitutionSyllabusResult(await error.checkSavedResult(), input);
}

function appendDocument(form: FormData, document: AIDocumentAsset) {
  appendMultipartAsset(form, 'document', document);
}

function generationForm(task: AIRequestTask, input: AIGenerationInput) {
  const form = new FormData();
  form.append('task', task);
  form.append('promptVersion', task === 'flashcards' ? FLASHCARD_PROMPT_VERSION : SYLLABUS_PROMPT_VERSION);
  if (input.courseId) form.append('courseId', input.courseId);
  form.append('courseTitle', input.courseTitle || '');
  form.append('locale', input.locale || 'en');
  if (task === 'flashcards') form.append('requestedCardCount', String(input.requestedCardCount ?? 30));
  if (input.sourceText?.trim()) form.append('sourceText', input.sourceText.trim());
  if (input.document) { form.append('sourceKind', inferAIDocumentKind(input.document)); appendDocument(form, input.document); }
  return form;
}

export class InstitutionAIService implements AIService {
  readonly requestHistory?: AIRequestHistory;
  readonly sourceProfile?: 'text-v1';
  private readonly fetchImpl: typeof fetch;
  private readonly localDevelopment: boolean;
  private readonly baseUrl: string;
  private readonly config: AIServiceConfig;

  constructor(config: AIServiceConfig) {
    this.config = { ...config };
    if (config.sourceProfile !== undefined && config.sourceProfile !== 'text-v1') throw new AIConfigurationError('Unsupported AI source profile.');
    this.sourceProfile = config.sourceProfile;
    if (config.authentication !== undefined && config.authentication !== 'bearer' && config.authentication !== 'same-origin-cookie') {
      throw new AIConfigurationError('Unsupported AI authentication mode.');
    }
    const validatedUrl = safeBaseUrl(config.baseUrl);
    this.localDevelopment = validatedUrl.localDevelopment && config.authentication !== 'same-origin-cookie';
    this.baseUrl = validatedUrl.url;
    if (config.requestRecovery !== undefined && (!['status-v1', 'history-v1'].includes(config.requestRecovery) || this.localDevelopment)) {
      throw new AIConfigurationError('Saved-result recovery requires an authenticated gateway with the status-v1 or history-v1 contract.');
    }
    this.validateCookieOrigin();
    if (config.authentication !== 'same-origin-cookie' && !this.localDevelopment && !config.getAccessToken) {
      throw new AIConfigurationError('Remote AI services require an authenticated access-token provider.');
    }
    // Browser fetch requires its global receiver when stored as a class method.
    this.fetchImpl = (config.fetchImpl || fetch).bind(globalThis);
    if (config.requestRecovery === 'history-v1') this.requestHistory = Object.freeze({
      list: async (task: AIRequestTask, courseId: string, cursor?: string) => {
        this.validateHistoryScope(task, courseId, cursor);
        const query = new URLSearchParams({ courseId, task, ...(cursor ? { cursor } : {}) });
        return readAIHistoryPage(await this.readSavedPayload(`/lms/v1/ai/requests?${query}`, undefined, 64_000), task, courseId);
      },
      recover: async (task: AIRequestTask, input: AIGenerationInput, requestId: string) => {
        this.validateHistoryScope(task, input.courseId, requestId);
        if (!requestId) throw new AIResponseError('Select a valid saved request.');
        validateInput(input, task);
        assertAISourceProfile(input, task, this.sourceProfile);
        const source = { ...input, document: input.document ? { ...input.document } : undefined };
        return this.checkSavedRequest(task, source, requestId, true);
      },
    });
  }

  private validateHistoryScope(task: AIRequestTask, courseId?: string, cursor?: string) {
    const validId = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
    if (!['flashcards', 'syllabus'].includes(task) || !validId(courseId) || cursor !== undefined && !validId(cursor)) throw new AIResponseError('Select a valid course and saved request.');
  }

  private validateCookieOrigin() {
    if (this.config.authentication !== 'same-origin-cookie') return;
    if (typeof window === 'undefined' || window.location?.origin !== this.baseUrl || !this.baseUrl.startsWith('https://') || this.config.getAccessToken !== undefined) {
      throw new AIConfigurationError('AI cookie sessions require the exact HTTPS browser origin and no token callback.');
    }
  }

  private async authentication(signal: AbortSignal) {
    this.validateCookieOrigin();
    const cookieAuthentication = this.config.authentication === 'same-origin-cookie';
    const token = cookieAuthentication ? undefined : (await awaitWithAbort(signal, async () => this.config.getAccessToken?.()))?.trim();
    this.validateCookieOrigin(); signal.throwIfAborted();
    if (!cookieAuthentication && !this.localDevelopment && !token) throw new AIConfigurationError('An authenticated AI session is required.');
    if (token && (token.length > 8_192 || /[\u0000-\u001f\u007f]/.test(token))) throw new AIConfigurationError('The AI service access token is invalid.');
    return { credentials: cookieAuthentication ? 'same-origin' as const : 'omit' as const, headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } };
  }

  private generationFailure(task: AIRequestTask, input: AIGenerationInput, attempt: { requestId: string; sent: boolean }, error: unknown): unknown {
    if (this.localDevelopment || !attempt.sent) return error;
    return new AIRequestError(error instanceof Error ? error.message : 'The AI request did not complete.', attempt.requestId, task, input,
      this.config.requestRecovery ? async () => {
        try { return await this.checkSavedRequest(task, input, attempt.requestId); }
        catch (failure) { throw this.generationFailure(task, input, attempt, failure); }
      } : undefined);
  }

  private async fetchResponse(url: string, init: RequestInit & { signal: AbortSignal }) {
    let received: Response | undefined;
    try {
      const response = await awaitWithAbort(init.signal, async () => {
        received = await this.fetchImpl(url, init);
        // A transport that ignores cancellation may deliver a body after timeout.
        if (init.signal.aborted) { void received.body?.cancel().catch(() => undefined); init.signal.throwIfAborted(); }
        return received;
      });
      init.signal.throwIfAborted();
      return response;
    } catch (error) {
      void received?.body?.cancel().catch(() => undefined);
      throw error;
    }
  }

  private async checkSavedRequest(task: AIRequestTask, input: AIGenerationInput, requestId: string, matchSource = false) {
    const payload = await this.readSavedPayload(`/lms/v1/ai/requests/${encodeURIComponent(requestId)}${matchSource ? '/recover' : ''}`, matchSource ? generationForm(task, input) : undefined);
    const result = readRecoveredAIResult(payload, task, input, requestId);
    if (task === 'flashcards') validateCards(result, input); else validateSyllabus(result, input);
    return result;
  }

  private async readSavedPayload(path: string, body?: FormData, maxBytes = 2_064_000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const authentication = await this.authentication(controller.signal);
      const response = await this.fetchResponse(`${this.baseUrl}${path}`, {
        ...authentication, method: body ? 'POST' : 'GET', ...(body ? { body } : {}), redirect: 'error', cache: 'no-store', signal: controller.signal,
      });
      const text = await readBoundedResponseText(response, maxBytes, () => new AIResponseError('The saved AI request exceeded its response limit.'), controller.signal);
      if (response.status === 404) throw new AIResponseError(path.includes('?') ? 'This history page has expired or is unavailable. Refresh the saved request history.' : 'No saved request is available. It may have expired or never reached the service. Starting again can create another charge.');
      if (response.status === 409 && body) throw new AIResponseError('The selected source or settings do not match this saved request. Reselect the original file or text and use its original card count and language. No new generation was requested.');
      if (response.status === 401 || response.status === 403) throw new AIResponseError('Your session or course access no longer permits recovery. Sign in again or contact your administrator.');
      if (!response.ok) throw new AIResponseError(`The saved AI request could not be checked (${response.status}).`);
      if (!/^application\/(?:[a-z0-9.+-]*\+)?json\b/i.test(response.headers.get('Content-Type') || '')) throw new AIResponseError('The saved AI request returned an unexpected content type.');
      let payload: unknown;
      try { payload = JSON.parse(text); } catch { throw new AIResponseError('The saved AI request returned malformed JSON.'); }
      return payload;
    } catch (error) {
      if (error instanceof AIResponseError || error instanceof AIConfigurationError) throw error;
      throw new AIResponseError(controller.signal.aborted ? 'Checking the saved result timed out. You can check again without starting another generation.' : 'The saved result could not be checked. No new generation was requested.');
    } finally { clearTimeout(timeout); }
  }

  private async request(task: 'flashcards' | 'syllabus', input: AIGenerationInput, attempt: { requestId: string; sent: boolean }) {
    validateInput(input, task);
    assertAISourceProfile(input, task, this.sourceProfile);
    this.validateCookieOrigin();
    if (!this.localDevelopment && !input.courseId) throw new AIConfigurationError('Select a course before using the authenticated AI service.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const authentication = await this.authentication(controller.signal);
      const form = generationForm(task, input);
      const requestId = attempt.requestId;
      attempt.sent = true;
      const response = await this.fetchResponse(`${this.baseUrl}/lms/v1/ai/generate`, {
        method: 'POST',
        // Do not replay learner source material or bearer credentials to a
        // redirect target controlled outside the configured AI origin.
        redirect: 'error',
        credentials: authentication.credentials,
        headers: {
          ...authentication.headers,
          'Idempotency-Key': requestId,
          'X-Request-Id': requestId,
        },
        body: form,
        signal: controller.signal,
      });
      const text = await readBoundedResponseText(response, MAX_RESPONSE_BYTES, () =>
        new AIResponseError('The AI service response exceeded the 2 MB limit.'), controller.signal);
      if (!response.ok) {
        let payload: unknown;
        try {
          payload = JSON.parse(text) as unknown;
        } catch {
          // Do not surface arbitrary upstream HTML or debug output.
        }
        const detail = readRemoteErrorDetail(payload, this.localDevelopment);
        const suffix = this.localDevelopment && detail.message
          ? `: ${detail.message}${detail.code ? ` (${detail.code})` : ''}`
          : detail.code ? ` (${detail.code})` : '';
        throw new AIResponseError(`AI service failed (${response.status})${suffix}`);
      }
      if (!this.localDevelopment && !/^application\/(?:[a-z0-9.+-]*\+)?json\b/i.test(response.headers.get('Content-Type') || '')) {
        throw new AIResponseError('The AI service returned an unexpected content type.');
      }
      let payload: unknown;
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        throw new AIResponseError('The AI service returned malformed JSON.');
      }
      const attestation = readServerProvenance(payload, task, !this.localDevelopment || Boolean(input.document), Boolean(input.document));
      if (!this.localDevelopment && attestation?.requestId !== requestId) {
        throw new AIResponseError('The AI service response was not bound to this request identifier.');
      }
      if (response.headers.get('X-LMS-AI-Review-Notices') === 'present' && !attestation?.sourceReviewNotices?.length) {
        throw new AIResponseError('Source processing notes are missing from the saved result. Ask your administrator to retrieve it before starting a new generation.');
      }
      return payload;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw new Error('The AI request timed out. Try a smaller document.');
      if (error instanceof AIConfigurationError || error instanceof AIResponseError) throw error;
      throw new Error(
        this.localDevelopment && error instanceof Error ? error.message : 'The AI service request could not be completed.',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async generateFlashcards(input: AIGenerationInput) {
    const source = { ...input, document: input?.document ? { ...input.document } : undefined };
    const attempt = { requestId: createEntityId('ai-request'), sent: false };
    try { return validateCards(await this.request('flashcards', source, attempt), source); }
    catch (error) { throw this.generationFailure('flashcards', source, attempt, error); }
  }

  async extractSyllabus(input: AIGenerationInput) {
    const source = { ...input, document: input?.document ? { ...input.document } : undefined };
    const attempt = { requestId: createEntityId('ai-request'), sent: false };
    try { return validateSyllabus(await this.request('syllabus', source, attempt), source); }
    catch (error) { throw this.generationFailure('syllabus', source, attempt, error); }
  }
}

let configuredService: AIService | null = null;

/** Display guidance only; server validation and authorization remain authoritative. */
export function getAISourceSupport(task: AIRequestTask) {
  let profile: AIService['sourceProfile'];
  try { profile = getAIService().sourceProfile; } catch { /* Unconfigured services must not imply format support. */ }
  return { description: sourceProfileDescription(task, profile, isPreparedAIDemo()), pickerTypes: sourceProfilePickerTypes(task, profile), profile };
}

export function assertConfiguredAISource(input: AIGenerationInput, task: AIRequestTask) {
  assertAISourceProfile(input, task, getAISourceSupport(task).profile);
}

export function configureAIService(service: AIService | null) {
  configuredService = service;
}

export function getAIService(): AIService {
  if (configuredService) return configuredService;
  const baseUrl = preparedDemoBaseUrl() || process.env.EXPO_PUBLIC_LMS_AI_BASE_URL?.trim();
  const isDevelopmentBuild = typeof __DEV__ !== 'undefined' && __DEV__;
  if (!baseUrl || !isDevelopmentBuild) {
    throw new AIConfigurationError(
      isDevelopmentBuild
        ? 'AI generation is not configured. Set EXPO_PUBLIC_LMS_AI_BASE_URL or inject an institutional AIService adapter.'
        : 'AI generation is not configured. Inject an authenticated institutional AIService adapter before using AI in production.',
    );
  }
  configuredService = new InstitutionAIService({ baseUrl });
  return configuredService;
}
