import { readCookie, SESSION_COOKIE } from './auth.ts';
import { AuthStore } from './store.ts';
import { GatewayStore } from './gateway-store.ts';
import { GatewayError, id, integer, requireCondition as check } from './gateway-validation.ts';
import { AI_RECOVERY_PATH, MAX_AI_REQUEST_BYTES, type AIJobPolicy } from './ai-policy.ts';
import { extractTextSource, SourceExtractionError } from '../src/lib/ai/textExtraction.server.ts';
import { runAIProvider, sha256, type AIProvider, type AIProviderReceipt, type ExtractedAISource } from '../src/lib/ai/providerAdapter.server.ts';
import { FLASHCARD_PROMPT_VERSION, SYLLABUS_PROMPT_VERSION } from '../src/lib/ai/prompts.ts';
import type { AIGenerationInput } from '../src/lib/ai/types.ts';

const endpoint = '/lms/v1/ai/generate';
const historyEndpoint = '/lms/v1/ai/requests';
const requestPath = /^\/lms\/v1\/ai\/requests\/([A-Za-z0-9][A-Za-z0-9._:-]{0,127})$/;
const fields = new Set(['task', 'promptVersion', 'courseId', 'courseTitle', 'locale', 'requestedCardCount', 'sourceText', 'document', 'sourceKind']);
function response(status: number, value: unknown, notices = false) {
  return new Response(JSON.stringify(value), { status, headers: {
    'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', Pragma: 'no-cache',
    'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    ...(notices ? { 'X-LMS-AI-Review-Notices': 'present' } : {}),
  } });
}
function errorResponse(error: unknown) {
  if (error instanceof GatewayError) return response(error.status, { error: error.message, code: error.message });
  if (error instanceof SourceExtractionError) return response(422, { error: 'source_rejected', code: `source_${error.code}` });
  return response(503, { error: 'ai_service_unavailable', code: 'ai_service_unavailable' });
}

async function readBody(request: Request): Promise<Uint8Array> {
  check(!request.headers.has('content-encoding'), 'unsupported_media_type', 415);
  const declared = request.headers.get('content-length');
  check(declared === null || /^\d+$/.test(declared) && Number(declared) <= MAX_AI_REQUEST_BYTES, 'request_too_large', 413);
  const reader = request.body?.getReader(); check(reader, 'invalid_multipart');
  let onAbort: () => void = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stopped = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new GatewayError('upload_cancelled', 408));
    request.signal.addEventListener('abort', onAbort, { once: true });
    if (request.signal.aborted) onAbort();
    timer = setTimeout(() => reject(new GatewayError('upload_timed_out', 408)), 15_000);
  });
  try {
    return await Promise.race([stopped, (async () => {
      const chunks: Uint8Array[] = []; let length = 0;
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        length += chunk.value.byteLength;
        check(length <= MAX_AI_REQUEST_BYTES, 'request_too_large', 413);
        chunks.push(chunk.value);
      }
      return Buffer.concat(chunks);
    })()]);
  } finally { clearTimeout(timer); request.signal.removeEventListener('abort', onAbort); void reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** Optional cookie-authenticated text gateway. No provider fallback or automatic retries. */
export function createAIGateway(options: { origin: string; auth: AuthStore; gateway: GatewayStore; provider: AIProvider; policy: AIJobPolicy; now?: () => number; timeoutMs?: number }) {
  const { origin, auth, gateway, provider } = options;
  const policy = { ...options.policy };
  check(new URL(origin).origin === origin && origin.startsWith('https://'), 'invalid_origin');
  integer(policy.retentionHours, 24, 720); integer(policy.dailyRequestLimit, 1, 1000);
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 120_000; integer(timeoutMs, 1, 120_000);

  const access = (request: Request) => {
    const url = new URL(request.url);
    check(url.origin === origin && url.href.length <= 8192, 'invalid_request');
    check(request.method === 'POST' && (url.pathname === endpoint || AI_RECOVERY_PATH.test(url.pathname)) || request.method === 'GET' && (requestPath.test(url.pathname) || url.pathname === historyEndpoint), 'not_found', 404);
    check(!url.search || request.method === 'GET' && url.pathname === historyEndpoint, 'invalid_request');
    check(!request.headers.has('authorization'), 'unsupported_authentication');
    check(!request.headers.has('x-institution-id') || request.headers.get('x-institution-id') === gateway.institution.id, 'wrong_institution', 403);
    check(!request.headers.has('x-lms-schema-version') || request.headers.get('x-lms-schema-version') === '1.0', 'unsupported_contract');
    check(request.headers.get('sec-fetch-site') !== 'cross-site' && (!request.headers.has('origin') || request.headers.get('origin') === origin), 'origin_not_allowed', 403);
    check(request.method !== 'POST' || request.headers.get('origin') === origin, 'origin_not_allowed', 403);
    const token = readCookie(request, SESSION_COOKIE);
    check(token && auth.session(token, now()), 'authentication_required', 401);
    return { token, url };
  };
  return {
    /** HTTP bridge checks the session before buffering any AI upload bytes. */
    preflight(request: Request): Response | undefined { try { access(request); return undefined; } catch (error) { return errorResponse(error); } },
    async handle(request: Request): Promise<Response> {
      let jobId: string | undefined;
      try {
        const { token, url } = access(request);
        if (request.method === 'GET') {
          if (url.pathname === historyEndpoint) {
            const params = url.searchParams;
            check([...params.keys()].every(name => ['courseId', 'task', 'cursor'].includes(name) && params.getAll(name).length === 1), 'invalid_history_query');
            const courseId = id(params.get('courseId'));
            const task = params.get('task'); check(task === 'flashcards' || task === 'syllabus', 'invalid_ai_task');
            const cursor = params.has('cursor') ? id(params.get('cursor')) : undefined;
            return gateway.authorized(auth, token, now(), user => response(200, gateway.listAI(user, courseId, task, cursor, now())));
          }
          const key = requestPath.exec(url.pathname)![1];
          return gateway.authorized(auth, token, now(), user => response(200, gateway.readAI(user, key, now())));
        }
        const recoveryKey = AI_RECOVERY_PATH.exec(url.pathname)?.[1];
        const key = recoveryKey ?? id(request.headers.get('idempotency-key'));
        check(recoveryKey ? !request.headers.has('idempotency-key') : request.headers.get('x-request-id') === key, 'matching_request_id_required');
        const contentType = request.headers.get('content-type') ?? '';
        check(contentType.length <= 200 && /^multipart\/form-data\s*;/i.test(contentType), 'unsupported_media_type', 415);
        const bytes = await readBody(request);
        let form: FormData;
        try {
          const parsed = await new Response(bytes as BodyInit, { headers: { 'Content-Type': contentType } }).formData();
          check(parsed instanceof FormData, 'invalid_multipart');
          form = parsed;
        }
        catch { throw new GatewayError('invalid_multipart'); }
        const seen = new Set<string>();
        for (const [name, value] of form) {
          check(fields.has(name) && !seen.has(name), 'unsupported_or_duplicate_field'); seen.add(name);
          check(name === 'document' ? value instanceof File : typeof value === 'string', 'invalid_multipart_field');
        }
        const task = form.get('task'); check(task === 'syllabus' || task === 'flashcards', 'invalid_ai_task');
        check(form.get('promptVersion') === (task === 'syllabus' ? SYLLABUS_PROMPT_VERSION : FLASHCARD_PROMPT_VERSION), 'unsupported_prompt_version');
        const courseId = id(form.get('courseId'));
        const course = gateway.authorized(auth, token, now(), user => gateway.authorizeAI(user, courseId, task));
        const contextTitle = form.get('courseTitle'); check(contextTitle === null || typeof contextTitle === 'string' && contextTitle.length <= 300, 'invalid_course_title');
        check(course.title.length <= 300, 'course_title_context_too_long');
        const locale = String(form.get('locale') ?? 'en');
        try { check(locale.length <= 100 && Intl.getCanonicalLocales(locale).length === 1, 'invalid_locale'); }
        catch { throw new GatewayError('invalid_locale'); }
        const countValue = form.get('requestedCardCount');
        check(task !== 'syllabus' || countValue === null, 'unsupported_field');
        const requestedCardCount = countValue === null ? 30 : Number(countValue);
        check(countValue === null || /^\d{1,3}$/.test(String(countValue)), 'invalid_card_count');
        integer(requestedCardCount, 1, 100);
        const sourceText = form.get('sourceText') as string | null;
        const file = form.get('document') as File | null;
        check(sourceText === null || sourceText.length <= 500_000, 'source_too_large', 413);
        check(Boolean(sourceText?.trim()) || file, 'source_required');
        check(file || !form.has('sourceKind'), 'unexpected_source_kind');
        const extractions = [];
        let sourceFile: Uint8Array | undefined;
        if (sourceText?.trim()) extractions.push(extractTextSource({ bytes: Buffer.from(sourceText), name: 'pasted.txt', signal: request.signal }));
        if (file) {
          const caption = /\.(vtt|srt)$/i.test(file.name);
          check(form.get('sourceKind') === (caption ? 'captions' : 'document'), 'source_kind_mismatch');
          check(task !== 'syllabus' || !caption, 'unsupported_syllabus_source', 422);
          sourceFile = new Uint8Array(await file.arrayBuffer());
          extractions.push(extractTextSource({ bytes: sourceFile, name: file.name, mimeType: file.type || undefined, signal: request.signal }));
        }
        const source: ExtractedAISource = {
          text: extractions.map(item => item.source.text).join('\n\n'),
          segments: extractions.flatMap((item, index) => item.source.segments.map(segment => ({ ...segment, location: extractions.length > 1 ? `${index === 0 ? 'Pasted text' : 'Document'} · ${segment.location}` : segment.location }))),
          ...(file ? { documentSha256: extractions.at(-1)!.extraction.documentSha256 } : {}),
        };
        check(source.text.length <= 500_000 && source.segments.length <= 10_000 && source.segments.reduce((sum, segment) => sum + segment.text.length, 0) <= 1_000_000, 'source_too_large', 413);
        const input: AIGenerationInput = { courseId, courseTitle: course.title, locale, requestedCardCount, ...(sourceText ? { sourceText } : {}), ...(file ? { document: { uri: 'file:///gateway-upload', name: file.name, mimeType: file.type, size: file.size } } : {}) };
        const reviewNotices = extractions.flatMap(item => item.extraction.warnings);
        const intent = { task, promptVersion: form.get('promptVersion'), courseId, locale, requestedCardCount, sourceText, documentSha256: source.documentSha256, name: file?.name, mimeType: file?.type, sourceKind: form.get('sourceKind') };
        const digest = sha256(JSON.stringify(intent));
        if (recoveryKey) return gateway.authorized(auth, token, now(), user => response(200, gateway.recoverAI(user, key, digest, now())));
        const artifact = JSON.stringify({ version: 1, task, promptVersion: intent.promptVersion, providerId: provider.id, input, source, extraction: extractions.map(item => item.extraction) });
        const reservation = gateway.authorized(auth, token, now(), user => gateway.reserveAI(user, { key, digest, courseId, task, artifact, sourceFile, reviewNotices }, policy, now()));
        if (reservation.replay) return response(200, reservation.replay, reviewNotices.length > 0);
        jobId = reservation.jobId;
        let receipt: AIProviderReceipt | undefined;
        let result: Record<string, unknown>;
        try { result = await runAIProvider(provider, task, input, source, key, { signal: request.signal, timeoutMs, sourceReviewNotices: reviewNotices, onReceipt: value => { receipt = value; } }); }
        catch { throw new GatewayError('ai_generation_incomplete', 502); }
        request.signal.throwIfAborted();
        return gateway.authorized(auth, token, now(), user => {
          gateway.completeAI(user, jobId!, result, receipt, now());
          return response(200, result, reviewNotices.length > 0);
        });
      } catch (error) {
        if (jobId) { try { gateway.failAI(jobId); } catch { /* A persisted processing record remains non-retryable after a storage failure. */ } }
        return errorResponse(error);
      }
    },
  };
}
