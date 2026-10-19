/**
 * @fileoverview src/lib/integration/assetService.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import { AIDocumentAsset, AIProvenance } from '../ai/types';
import { isPreparedAIDemo, preparedDemoAssetService } from '../ai/preparedDemo';
import { createEntityId } from '../id';
import { awaitWithAbort, readBoundedResponseText, readRemoteErrorDetail } from './httpResponse';
import { canonicalSafeHttpsUrl } from '../safeUrl';
import { appendMultipartAsset, isPickerOwnedAssetUri, validateMultipartAssetBytes } from './multipartAsset';

export interface StoredAsset {
  id: string;
  url: string;
  name: string;
  mimeType: string;
  size?: number;
  sha256?: string;
}

export interface AssetUploadContext {
  courseId?: string;
  threadId?: string;
  purpose: 'course-content' | 'chat-attachment' | 'assessment-submission';
  /** Stable key for a retryable logical upload. Reuse it until the workflow completes or is discarded. */
  idempotencyKey?: string;
}

export interface AssetService {
  upload(asset: AIDocumentAsset, context: AssetUploadContext): Promise<StoredAsset>;
}

export class AssetServiceError extends Error {}

export type HttpAssetServiceConfig = {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  maxBytes?: number;
} & (
  | { authentication?: 'bearer'; getAccessToken: () => Promise<string | null> }
  | { authentication: 'same-origin-cookie'; getAccessToken?: never }
);

export const assertAssetMatchesAIProvenance = (asset: StoredAsset, provenance?: AIProvenance): void => {
  if (!provenance?.documentSha256) {
    throw new AssetServiceError('AI provenance is missing the uploaded document digest. Regenerate from the source document.');
  }
  if (!asset.sha256 || !/^[a-f0-9]{64}$/i.test(asset.sha256)) {
    throw new AssetServiceError('Institutional storage did not attest to the uploaded document digest.');
  }
  if (asset.sha256.toLocaleLowerCase() !== provenance.documentSha256.toLocaleLowerCase()) {
    throw new AssetServiceError('The published document no longer matches the source processed by AI. Select the document again and regenerate.');
  }
};

export class HttpAssetService implements AssetService {
  private readonly localDevelopment: boolean;
  private readonly baseUrl: string;
  private readonly maxBytes: number;
  private readonly options: HttpAssetServiceConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpAssetServiceConfig) {
    this.options = { ...options };
    if (options.authentication !== undefined && options.authentication !== 'bearer' && options.authentication !== 'same-origin-cookie') {
      throw new AssetServiceError('Unsupported asset authentication mode.');
    }
    let url: URL;
    try {
      url = new URL(options.baseUrl);
    } catch {
      throw new AssetServiceError('Asset storage URL is invalid.');
    }
    const developmentBuild = typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production';
    this.localDevelopment = developmentBuild && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && options.authentication !== 'same-origin-cookie';
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && this.localDevelopment)) {
      throw new AssetServiceError('Asset storage must use HTTPS outside local development.');
    }
    if (url.username || url.password || url.search || url.hash) {
      throw new AssetServiceError('Asset storage URL cannot contain credentials, a query, or a fragment.');
    }
    this.baseUrl = url.toString().replace(/\/+$/, '');
    this.validateCookieOrigin();
    if (options.authentication !== 'same-origin-cookie' && typeof options.getAccessToken !== 'function') {
      throw new AssetServiceError('Asset storage requires an authenticated access-token provider.');
    }
    const maxBytes = options.maxBytes ?? 50 * 1024 * 1024;
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 500 * 1024 * 1024) {
      throw new AssetServiceError('Asset size limit must be a positive whole number no greater than 500 MB.');
    }
    this.maxBytes = maxBytes;
    this.fetchImpl = (options.fetchImpl || fetch).bind(globalThis);
  }

  private validateCookieOrigin(): void {
    if (this.options.authentication !== 'same-origin-cookie') return;
    if (typeof window === 'undefined' || window.location?.origin !== this.baseUrl || !this.baseUrl.startsWith('https://') || this.options.getAccessToken !== undefined) {
      throw new AssetServiceError('Asset cookie sessions require the exact HTTPS browser origin and no token callback.');
    }
  }

  private async authentication(signal: AbortSignal) {
    this.validateCookieOrigin();
    const cookie = this.options.authentication === 'same-origin-cookie';
    const value = cookie ? null : await awaitWithAbort(signal, () => this.options.getAccessToken!());
    this.validateCookieOrigin(); signal.throwIfAborted();
    if (!cookie && (typeof value !== 'string' || !value.trim())) throw new AssetServiceError('Authenticated institutional asset storage is not configured.');
    const token = value?.trim();
    if (token && (token.length > 8_192 || /[\u0000-\u001f\u007f]/.test(token))) throw new AssetServiceError('The asset service access token is invalid.');
    return {
      credentials: cookie ? 'same-origin' as const : 'omit' as const,
      ...(cookie ? { mode: 'same-origin' as const } : {}),
      headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    };
  }

  private async fetchResponse(url: string, init: RequestInit & { signal: AbortSignal }): Promise<Response> {
    let received: Response | undefined;
    try {
      const response = await awaitWithAbort(init.signal, async () => {
        received = await this.fetchImpl(url, init);
        // A custom transport may deliver its body after the caller has timed out.
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

  async upload(asset: AIDocumentAsset, context: AssetUploadContext): Promise<StoredAsset> {
    // Preserve the validated source and destination across asynchronous authentication.
    asset = { ...asset };
    context = { ...context };
    const maxBytes = this.maxBytes;
    if (!asset.uri || !asset.name) throw new AssetServiceError('The selected file is invalid.');
    if (!isPickerOwnedAssetUri(asset.uri)) throw new AssetServiceError('The selected file URI is not supported.');
    if (asset.name.length > 255 || /[\\/\u0000-\u001f\u007f]/.test(asset.name)) throw new AssetServiceError('The selected file name is invalid.');
    if (asset.mimeType && (asset.mimeType.length > 160 || /[\r\n]/.test(asset.mimeType))) throw new AssetServiceError('The selected file MIME type is invalid.');
    if (asset.size !== undefined && (!Number.isFinite(asset.size) || asset.size < 0 || asset.size > maxBytes)) throw new AssetServiceError(`The selected file must be smaller than ${Math.floor(maxBytes / 1024 / 1024)} MB.`);
    try {
      validateMultipartAssetBytes(asset, maxBytes);
    } catch (error) {
      throw new AssetServiceError(error instanceof Error ? error.message : 'The selected browser file is invalid.');
    }
    if (!['course-content', 'chat-attachment', 'assessment-submission'].includes(context.purpose)) {
      throw new AssetServiceError('The asset upload purpose is invalid.');
    }
    if ((context.purpose === 'course-content' || context.purpose === 'assessment-submission') && !context.courseId) {
      throw new AssetServiceError('A course identifier is required for this upload.');
    }
    if (context.purpose === 'chat-attachment' && !context.threadId) {
      throw new AssetServiceError('A conversation identifier is required for a chat attachment.');
    }
    for (const [label, value] of [['course', context.courseId], ['conversation', context.threadId]] as const) {
      if (value !== undefined && (!value.trim() || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value))) {
        throw new AssetServiceError(`The ${label} identifier is invalid.`);
      }
    }
    if (context.idempotencyKey !== undefined && (
      typeof context.idempotencyKey !== 'string'
      || !context.idempotencyKey.trim()
      || context.idempotencyKey.length > 1_024
      || /[\u0000-\u001f\u007f]/.test(context.idempotencyKey)
    )) {
      throw new AssetServiceError('The asset upload idempotency key is invalid.');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    try {
      const authentication = await this.authentication(controller.signal);
      const form = new FormData();
      if (context.courseId) form.append('courseId', context.courseId);
      if (context.threadId) form.append('threadId', context.threadId);
      form.append('purpose', context.purpose);
      appendMultipartAsset(form, 'asset', asset);
      this.validateCookieOrigin(); controller.signal.throwIfAborted();
      const response = await this.fetchResponse(`${this.baseUrl}/lms/v1/assets`, {
        ...authentication,
        method: 'POST',
        // A redirected multipart request could disclose learner files or
        // assessment content to an origin other than the configured service.
        redirect: 'error',
        cache: 'no-store',
        headers: {
          ...authentication.headers,
          'Idempotency-Key': context.idempotencyKey?.trim() || createEntityId('asset-upload'),
        },
        body: form,
        signal: controller.signal,
      });
      const text = await readBoundedResponseText(response, 1_000_000, () =>
        new AssetServiceError('Asset service response exceeded the 1 MB limit.'), controller.signal);
      if (!response.ok) {
        let payload: unknown;
        try {
          payload = JSON.parse(text) as unknown;
        } catch {
          // Do not expose arbitrary upstream HTML or debug output.
        }
        const detail = readRemoteErrorDetail(payload, this.localDevelopment);
        const suffix = this.localDevelopment && detail.message
          ? `: ${detail.message}${detail.code ? ` (${detail.code})` : ''}`
          : detail.code ? ` (${detail.code})` : '';
        throw new AssetServiceError(`Asset upload failed (${response.status})${suffix}`);
      }
      if (!this.localDevelopment && !/^application\/(?:[a-z0-9.+-]*\+)?json\b/i.test(response.headers.get('Content-Type') || '')) {
        throw new AssetServiceError('Asset service returned an unexpected content type.');
      }
      let raw: unknown;
      try { raw = JSON.parse(text); } catch { throw new AssetServiceError('Asset service returned malformed JSON.'); }
      if (!raw || typeof raw !== 'object') throw new AssetServiceError('Asset service returned an invalid response.');
      const record = raw as Record<string, unknown>;
      const allowedFields = new Set(['id', 'url', 'name', 'mimeType', 'size', 'sha256']);
      const unsupportedField = Object.keys(record).find(field => !allowedFields.has(field));
      if (unsupportedField) throw new AssetServiceError(`Asset service returned unsupported field "${unsupportedField}".`);
      const url = canonicalSafeHttpsUrl(record.url);
      if (!url) {
        throw new AssetServiceError('Asset service must return an authorized HTTPS URL.');
      }
      const returnedId = typeof record.id === 'string' ? record.id.trim() : '';
      if (!returnedId || returnedId.length > 256 || /[\u0000-\u001f\u007f]/.test(returnedId)) {
        throw new AssetServiceError('Asset service did not return a valid asset ID.');
      }
      const returnedName = typeof record.name === 'string' && record.name.trim() ? record.name.trim() : asset.name;
      if (returnedName.length > 255 || /[\\/\u0000-\u001f\u007f]/.test(returnedName)) throw new AssetServiceError('Asset service returned an invalid file name.');
      const returnedMimeType = typeof record.mimeType === 'string' && record.mimeType.trim() ? record.mimeType.trim() : asset.mimeType || 'application/octet-stream';
      if (returnedMimeType.length > 160 || /[\r\n]/.test(returnedMimeType)) throw new AssetServiceError('Asset service returned an invalid MIME type.');
      if (record.size !== undefined && (typeof record.size !== 'number' || !Number.isInteger(record.size) || record.size < 0)) {
        throw new AssetServiceError('Asset service returned an invalid file size.');
      }
      const returnedSize = typeof record.size === 'number' ? record.size : asset.size;
      if (returnedSize !== undefined && returnedSize > maxBytes) throw new AssetServiceError('Asset service reported a file larger than the configured limit.');
      const sha256 = typeof record.sha256 === 'string' ? record.sha256.toLocaleLowerCase() : '';
      if (!/^[a-f0-9]{64}$/.test(sha256)) throw new AssetServiceError('Asset service did not return a valid SHA-256 digest.');
      return {
        id: returnedId,
        url,
        name: returnedName,
        mimeType: returnedMimeType,
        size: returnedSize,
        sha256,
      };
    } catch (error) {
      if (controller.signal.aborted || error instanceof Error && error.name === 'AbortError') throw new AssetServiceError('Asset upload timed out.');
      if (error instanceof AssetServiceError) throw error;
      throw new AssetServiceError(
        this.localDevelopment && error instanceof Error ? error.message : 'Asset upload could not be completed.',
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

let configuredAssetService: AssetService | null = null;

export const configureAssetService = (service: AssetService | null) => {
  configuredAssetService = service;
};

export const getAssetService = (): AssetService => {
  if (!configuredAssetService && isPreparedAIDemo()) return preparedDemoAssetService;
  if (!configuredAssetService) throw new AssetServiceError('Institutional asset storage is not configured. Inject an AssetService before enabling uploads.');
  return configuredAssetService;
};
