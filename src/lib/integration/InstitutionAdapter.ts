/**
 * @fileoverview Institution HTTP adapter and learner-state transport.
 *
 * Reviewer notes:
 * - Enforces HTTPS outside local development, bounded payload sizes, bounded
 *   response reads, and safe sync cursor handling.
 * - Mutation writes use idempotency keys and ETag checks so institutional
 *   backends can reject stale or replayed changes safely.
 * - Non-local rejection messages are redacted before surfacing to the client.
 */
import { createEntityId } from '../id';
import { utf8ByteLength } from '../utf8';
import { readBoundedResponseText, readRemoteErrorDetail } from './httpResponse';
import { normalizeChatMessagePageRequest } from '../chat/pagination';
import type { ChatMessagePageRequest } from '../repositories/interfaces';
import {
  createLearningStateRecord,
  LearningActivityEvent,
  LearningStateKind,
  LearningStatePayloads,
  LearningStateRecord,
  LearningStateScope,
  LearningStateService,
  normalizeLearningStateRecord,
  normalizeLearningStateScope,
} from '../learningState';

export interface SyncCursor {
  cursor?: string;
  etag?: string;
}

export interface PushMutation {
  id: string;
  entity: 'course' | 'content' | 'content-progress' | 'submission' | 'thread' | 'message' | 'user';
  operation: 'create' | 'update' | 'delete';
  entityId: string;
  occurredAt: number;
  payload: Record<string, unknown>;
}

export interface PushResult {
  acceptedIds: string[];
  rejected: { id: string; code: string; message: string }[];
  nextCursor?: string;
  /** New entity-set ETag after an acknowledged mutation. Required when If-Match was used. */
  nextEtag?: string;
}

export interface InstitutionAdapter {
  pullSnapshot(cursor?: SyncCursor): Promise<unknown>;
  pushMutations(mutations: PushMutation[], cursor?: SyncCursor): Promise<PushResult>;
  /** Optional bounded chat-history/search endpoint used instead of snapshot-resident history. */
  loadMessagePage?(threadId: string, request?: ChatMessagePageRequest): Promise<unknown>;
}

export class InstitutionAdapterError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
    readonly retriable = false,
  ) {
    super(message);
    this.name = 'InstitutionAdapterError';
  }
}

export interface HttpInstitutionAdapterOptions {
  baseUrl: string;
  getAccessToken: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxRequestBytes?: number;
  tenantId?: string;
}

const trimBaseUrl = (url: string) => url.replace(/\/+$/, '');

const isDevelopmentBuild = () => typeof __DEV__ !== 'undefined'
  ? __DEV__
  : process.env.NODE_ENV !== 'production';

const validateBaseUrl = (value: string): { url: string; localDevelopment: boolean } => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new InstitutionAdapterError('Institution API URL is invalid.', 'invalid_base_url');
  }
  const localDevelopment = isDevelopmentBuild() && ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(localDevelopment && url.protocol === 'http:')) {
    throw new InstitutionAdapterError('Institution API must use HTTPS outside local development.', 'insecure_base_url');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new InstitutionAdapterError('Institution API URL cannot contain credentials, a query, or a fragment.', 'invalid_base_url');
  }
  return { url: trimBaseUrl(url.toString()), localDevelopment };
};

const boundedInteger = (value: number | undefined, fallback: number, field: string, maximum: number): number => {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) {
    throw new InstitutionAdapterError(`${field} must be a positive whole number no greater than ${maximum.toLocaleString()}.`, 'invalid_configuration');
  }
  return resolved;
};

const normalizeSyncToken = (value: unknown, field: string): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new InstitutionAdapterError(`${field} is invalid.`, 'invalid_sync_cursor');
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > 2_048 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new InstitutionAdapterError(`${field} is invalid.`, 'invalid_sync_cursor');
  }
  return normalized;
};

const normalizeSyncCursor = (cursor: SyncCursor): SyncCursor => ({
  cursor: normalizeSyncToken(cursor.cursor, 'Institution sync cursor'),
  etag: normalizeSyncToken(cursor.etag, 'Institution sync ETag'),
});

/**
 * Generic REST/JSON transport. Institutions adapt their backend to two stable
 * endpoints rather than giving the client direct database credentials.
 */
export class HttpInstitutionAdapter implements InstitutionAdapter, LearningStateService {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly maxRequestBytes: number;
  private readonly localDevelopment: boolean;
  private readonly tenantId?: string;

  constructor(private readonly options: HttpInstitutionAdapterOptions) {
    const validatedUrl = validateBaseUrl(options.baseUrl);
    this.baseUrl = validatedUrl.url;
    this.localDevelopment = validatedUrl.localDevelopment;
    this.fetchImpl = options.fetchImpl || fetch;
    this.timeoutMs = boundedInteger(options.timeoutMs, 20_000, 'Institution API timeout', 5 * 60_000);
    this.maxResponseBytes = boundedInteger(options.maxResponseBytes, 10 * 1024 * 1024, 'Institution response limit', 100 * 1024 * 1024);
    this.maxRequestBytes = boundedInteger(options.maxRequestBytes, 10 * 1024 * 1024, 'Institution request limit', 100 * 1024 * 1024);
    if (options.tenantId !== undefined) {
      const tenantId = options.tenantId.trim();
      if (!tenantId || tenantId.length > 256 || /[\u0000-\u001f\u007f]/.test(tenantId)) {
        throw new InstitutionAdapterError('Institution tenant identifier is invalid.', 'invalid_configuration');
      }
      this.tenantId = tenantId;
    }
  }

  async pullSnapshot(cursor: SyncCursor = {}): Promise<unknown> {
    const normalizedCursor = normalizeSyncCursor(cursor);
    const query = normalizedCursor.cursor ? `?cursor=${encodeURIComponent(normalizedCursor.cursor)}` : '';
    const response = await this.requestWithMetadata(`/lms/v1/snapshot${query}`, {
      method: 'GET',
      headers: normalizedCursor.etag ? { 'If-None-Match': normalizedCursor.etag } : undefined,
    });
    if (!response.etag || !response.body || typeof response.body !== 'object' || Array.isArray(response.body)) return response.body;
    const body = response.body as Record<string, unknown>;
    if (body.etag !== undefined && body.etag !== response.etag) {
      throw new InstitutionAdapterError('Institution snapshot ETag header does not match its JSON envelope.', 'etag_mismatch');
    }
    return { ...body, etag: response.etag };
  }

  async pushMutations(mutations: PushMutation[], cursor: SyncCursor = {}): Promise<PushResult> {
    const normalizedCursor = normalizeSyncCursor(cursor);
    if (!mutations.length) return { acceptedIds: [], rejected: [], nextCursor: normalizedCursor.cursor, nextEtag: normalizedCursor.etag };
    const body = JSON.stringify({ schemaVersion: '1.0', cursor: normalizedCursor.cursor, atomic: true, mutations });
    if (utf8ByteLength(body) > this.maxRequestBytes) {
      throw new InstitutionAdapterError('Institution mutation request exceeds the configured size limit.', 'request_too_large', 413);
    }
    const response = await this.requestWithMetadata('/lms/v1/mutations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': createEntityId('batch'),
        ...(normalizedCursor.etag ? { 'If-Match': normalizedCursor.etag } : {}),
      },
      body,
    });
    if (!response.body || typeof response.body !== 'object' || Array.isArray(response.body)) return response.body as PushResult;
    let result = response.body as PushResult;
    if (!this.localDevelopment && Array.isArray(result.rejected)) {
      result = {
        ...result,
        rejected: result.rejected.map(rejection => (
          rejection
          && typeof rejection === 'object'
          && typeof rejection.message === 'string'
            ? { ...rejection, message: 'The institution rejected this change.' }
            : rejection
        )),
      };
    }
    const bodyEtag = normalizeSyncToken(result.nextEtag, 'Institution mutation next ETag');
    if (bodyEtag && response.etag && bodyEtag !== response.etag) {
      throw new InstitutionAdapterError('Institution mutation ETag header does not match its JSON acknowledgement.', 'etag_mismatch');
    }
    const nextEtag = response.etag ?? bodyEtag;
    if (normalizedCursor.etag && !nextEtag) {
      throw new InstitutionAdapterError('Institution mutation response did not provide the next ETag after an If-Match write.', 'missing_next_etag');
    }
    if (normalizedCursor.etag && nextEtag === normalizedCursor.etag) {
      throw new InstitutionAdapterError('Institution mutation response did not advance the ETag after an acknowledged write.', 'stale_next_etag');
    }
    return { ...result, nextEtag };
  }

  async loadMessagePage(threadId: string, request: ChatMessagePageRequest = {}): Promise<unknown> {
    const normalizedThreadId = threadId.trim();
    if (!normalizedThreadId || normalizedThreadId.length > 256) {
      throw new InstitutionAdapterError('Conversation identifier is invalid.', 'invalid_chat_request');
    }
    const normalized = normalizeChatMessagePageRequest(request);
    const query = new URLSearchParams({ limit: String(normalized.limit) });
    if (normalized.cursor) query.set('cursor', normalized.cursor);
    if (normalized.query) query.set('query', normalized.query);
    return this.request(`/lms/v1/chat/threads/${encodeURIComponent(normalizedThreadId)}/messages?${query.toString()}`, {
      method: 'GET',
    });
  }

  async load<K extends LearningStateKind>(scope: LearningStateScope, kind: K): Promise<LearningStateRecord<K> | null> {
    const normalized = normalizeLearningStateScope(scope);
    const query = new URLSearchParams({ kind });
    if (normalized.courseId) query.set('courseId', normalized.courseId);
    if (normalized.contentItemId) query.set('contentItemId', normalized.contentItemId);
    if (normalized.threadId) query.set('threadId', normalized.threadId);
    if (normalized.deckId) query.set('deckId', normalized.deckId);
    const result = await this.request(`/lms/v1/learner-state?${query.toString()}`, { method: 'GET' });
    if (result === null) return null;
    return normalizeLearningStateRecord(result, normalized, kind);
  }

  async save<K extends LearningStateKind>(scope: LearningStateScope, kind: K, payload: LearningStatePayloads[K], writeId = createEntityId('learning-state')): Promise<LearningStateRecord<K>> {
    const record = createLearningStateRecord(scope, kind, payload, writeId);
    const body = JSON.stringify(record);
    if (utf8ByteLength(body) > this.maxRequestBytes) {
      throw new InstitutionAdapterError('Learning-state request exceeds the configured size limit.', 'request_too_large', 413);
    }
    const result = await this.request('/lms/v1/learner-state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': record.writeId },
      body,
    });
    return normalizeLearningStateRecord(result, record.scope, kind);
  }

  async remove(scope: LearningStateScope, kind: LearningStateKind): Promise<void> {
    const normalized = normalizeLearningStateScope(scope);
    const body = JSON.stringify({ schemaVersion: 1, scope: normalized, kind });
    await this.request('/lms/v1/learner-state', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': createEntityId('learning-state-delete') },
      body,
    });
  }

  async recordActivity(event: LearningActivityEvent): Promise<void> {
    const body = JSON.stringify(event);
    if (utf8ByteLength(body) > this.maxRequestBytes) {
      throw new InstitutionAdapterError('Learning-activity request exceeds the configured size limit.', 'request_too_large', 413);
    }
    await this.request('/lms/v1/learning-activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': event.eventId },
      body,
    });
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    return (await this.requestWithMetadata(path, init)).body;
  }

  private async requestWithMetadata(path: string, init: RequestInit): Promise<{ body: unknown; etag?: string }> {
    const token = (await this.options.getAccessToken())?.trim();
    if (!token) throw new InstitutionAdapterError('Authentication is required to synchronize institutional data.', 'authentication_required', 401);
    if (token.length > 8_192 || /[\u0000-\u001f\u007f]/.test(token)) {
      throw new InstitutionAdapterError('The institution access token is invalid.', 'invalid_access_token', 401);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        // Never forward an authenticated institutional request body through a
        // redirect. The API origin must be explicit and stable.
        redirect: 'error',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          'X-LMS-Schema-Version': '1.0',
          ...(this.tenantId ? { 'X-Institution-Id': this.tenantId } : {}),
          ...init.headers,
        },
      });
      const responseEtag = normalizeSyncToken(response.headers.get('ETag') ?? undefined, 'Institution response ETag');
      if (response.status === 304) return { body: { notModified: true }, etag: responseEtag };
      const body = await readBoundedResponseText(response, this.maxResponseBytes, () =>
        new InstitutionAdapterError('Institution response exceeds the configured size limit.', 'response_too_large', 413));
      if (response.ok && !this.localDevelopment && !/^application\/(?:[a-z0-9.+-]*\+)?json\b/i.test(response.headers.get('Content-Type') || '')) {
        throw new InstitutionAdapterError('Institution API returned an unexpected content type.', 'unexpected_content_type', response.status);
      }
      let parsed: unknown = null;
      if (body) {
        try {
          parsed = JSON.parse(body);
        } catch {
          throw new InstitutionAdapterError('Institution API returned malformed JSON.', 'malformed_json', response.status, response.status >= 500);
        }
      }
      if (!response.ok) {
        const detail = readRemoteErrorDetail(parsed, this.localDevelopment);
        const serverMessage = this.localDevelopment && detail.message
          ? detail.message
          : `Institution API request failed with status ${response.status}${detail.code ? ` (${detail.code})` : ''}.`;
        throw new InstitutionAdapterError(serverMessage, 'http_error', response.status, response.status === 429 || response.status >= 500);
      }
      return { body: parsed, etag: responseEtag };
    } catch (error) {
      if (error instanceof InstitutionAdapterError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new InstitutionAdapterError('Institution API request timed out.', 'timeout', undefined, true);
      }
      throw new InstitutionAdapterError(
        this.localDevelopment && error instanceof Error ? error.message : 'Institution API request could not be completed.',
        'network_error',
        undefined,
        true,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
