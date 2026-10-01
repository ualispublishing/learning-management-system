import { AuthStore, hash } from './store.ts';
import { readCookie, SESSION_COOKIE } from './auth.ts';
import { GatewayStore } from './gateway-store.ts';
import { batch, GatewayError, requireCondition as check } from './gateway-validation.ts';

export const MAX_MUTATION_BYTES = 1024 * 1024;
export const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;
function response(status: number, body: unknown, etag?: string) {
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'Pragma': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" });
  if (etag) headers.set('ETag', etag);
  const serialized = status === 304 ? null : JSON.stringify(body);
  if (serialized && Buffer.byteLength(serialized) > MAX_SNAPSHOT_BYTES) return response(413, { error: 'snapshot_capacity_reached' });
  return new Response(serialized, { status, headers });
}
export function createGatewayHandler(options: { origin: string; auth: AuthStore; gateway: GatewayStore; now?: () => number }) {
  const { origin, auth, gateway } = options;
  check(new URL(origin).origin === origin && origin.startsWith('https://'), 'invalid_origin');
  const now = options.now ?? Date.now;
  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url);
      check(url.origin === origin && url.href.length <= 8192, 'invalid_request');
      check(url.pathname === '/lms/v1/snapshot' || url.pathname === '/lms/v1/mutations', 'not_found', 404);
      check(request.method === (url.pathname.endsWith('/snapshot') ? 'GET' : 'POST'), 'method_not_allowed', 405);
      check(!request.headers.has('authorization'), 'unsupported_authentication', 400);
      check(!request.headers.has('x-institution-id') || request.headers.get('x-institution-id') === gateway.institution.id, 'wrong_institution', 403);
      check(!request.headers.has('x-lms-schema-version') || request.headers.get('x-lms-schema-version') === '1.0', 'unsupported_contract');
      check(request.headers.get('sec-fetch-site') !== 'cross-site' && (!request.headers.has('origin') || request.headers.get('origin') === origin), 'origin_not_allowed', 403);
      const token = readCookie(request, SESSION_COOKIE);
      check(token && auth.session(token, now()), 'authentication_required', 401);
      if (request.method === 'GET') {
        check([...url.searchParams.keys()].every(key => key === 'cursor') && url.searchParams.getAll('cursor').length <= 1 && (url.searchParams.get('cursor')?.length ?? 0) <= 256, 'invalid_cursor');
        return gateway.authorized(auth, token, now(), user => {
          const snapshot = gateway.snapshot(user);
          return request.headers.get('if-none-match') === snapshot.etag ? response(304, null, snapshot.etag) : response(200, snapshot, snapshot.etag);
        });
      }
      check(!url.search && request.headers.get('origin') === origin, 'origin_not_allowed', 403);
      check(/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '') && !request.headers.has('content-encoding'), 'unsupported_media_type', 415);
      const key = request.headers.get('idempotency-key');
      check(key && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(key), 'idempotency_key_required');
      const ifMatch = request.headers.get('if-match');
      check(ifMatch && /^"[a-f0-9]{64}"$/.test(ifMatch), 'snapshot_precondition_required', 428);
      // Also bound direct handler use (the Node bridge has its own streaming bound).
      const reader = request.body?.getReader();
      const parts: Uint8Array[] = []; let length = 0;
      if (reader) try {
        while (true) {
          const chunk = await reader.read(); if (chunk.done) break;
          length += chunk.value.byteLength;
          if (length > MAX_MUTATION_BYTES) { void reader.cancel(); throw new GatewayError('request_too_large', 413); }
          parts.push(chunk.value);
        }
      } finally { reader.releaseLock(); }
      let raw: unknown;
      const body = Buffer.concat(parts).toString('utf8');
      try { raw = JSON.parse(body); } catch { throw new GatewayError('invalid_json'); }
      const parsed = batch(raw);
      return gateway.authorized(auth, token, now(), user => {
        const result = gateway.mutate(user, parsed, key, hash(JSON.stringify([ifMatch, body])), ifMatch, now());
        return response(200, result, result.nextEtag);
      });
    } catch (error) {
      return error instanceof GatewayError ? response(error.status, { error: error.message }) : response(503, { error: 'service_unavailable' });
    }
  };
}
