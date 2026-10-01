import { randomBytes } from 'node:crypto';
import type { IdentityProvider } from './oidc.ts';
import { AuthStore } from './store.ts';

const PREFIX = '/lms/v1/auth';
export const SESSION_COOKIE = '__Host-lms_session';
const LOGIN_COOKIE = '__Host-lms_login';
const LOGIN_SECONDS = 10 * 60;
const SESSION_SECONDS = 8 * 60 * 60;
const opaque = () => randomBytes(32).toString('base64url');
const cookie = (name: string, value: string, seconds: number) => `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${seconds}`;

export function readCookie(request: Request, name: string): string | null {
  const values = (request.headers.get('cookie') ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${name}=`));
  if (values.length !== 1) return null;
  const value = values[0].slice(name.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

function response(status: number, body: object | string, cookies: string[] = [], location?: string, formDestination = ''): Response {
  const headers = new Headers({
    'Content-Type': typeof body === 'string' ? 'text/html; charset=utf-8' : 'application/json',
    'Cache-Control': 'no-store', 'Pragma': 'no-cache', 'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': `default-src 'none'; form-action 'self' ${formDestination}; frame-ancestors 'none'; base-uri 'none'`,
    'Cross-Origin-Resource-Policy': 'same-origin',
  });
  cookies.forEach(value => headers.append('Set-Cookie', value));
  if (location) headers.set('Location', location);
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
}

/** Cookie authentication boundary for a dedicated, same-origin web installation. */
export function createAuthHandler(options: { origin: string; store: AuthStore; provider: IdentityProvider; now?: () => number }) {
  const { origin, store, provider } = options;
  if (new URL(origin).origin !== origin || !origin.startsWith('https://')) throw new Error('A fixed HTTPS public origin is required.');
  if (new URL(provider.authorizationOrigin).origin !== provider.authorizationOrigin || !provider.authorizationOrigin.startsWith('https://')) throw new Error('A fixed HTTPS authorization origin is required.');
  const now = options.now ?? Date.now;
  const limits = new Map<string, { start: number; count: number }>();
  const allowLogin = (address: string) => {
    const time = now();
    for (const [key, value] of limits) if (value.start + 60_000 <= time) limits.delete(key);
    let limit = limits.get(address);
    if (!limit) {
      if (limits.size >= 10_000) return false;
      limit = { start: time, count: 0 }; limits.set(address, limit);
    }
    return ++limit.count <= 10;
  };
  const expiredCookies = () => [cookie(SESSION_COOKIE, '', 0), cookie(LOGIN_COOKIE, '', 0)];

  return async function handle(request: Request, remoteAddress = 'unknown'): Promise<Response> {
    const url = new URL(request.url);
    if (url.origin !== origin || url.href.length > 8192) return response(400, { error: 'invalid_request' });
    const path = url.pathname;
    if (!path.startsWith(`${PREFIX}/`) && path !== PREFIX) return response(404, { error: 'not_found' });
    if (request.method !== 'GET' && request.method !== 'POST') return response(405, { error: 'method_not_allowed' });
    if (request.method === 'POST' && (request.headers.get('origin') !== origin || request.headers.get('sec-fetch-site') === 'cross-site')) {
      return response(403, { error: 'origin_not_allowed' });
    }
    const sessionToken = readCookie(request, SESSION_COOKIE);
    const binding = readCookie(request, LOGIN_COOKIE);
    try {
      if (path === PREFIX && request.method === 'GET' && !url.search) {
        return response(200, '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Institution sign-in</title><h1>Institution sign-in</h1><p>Use your organization account. Access requires an approved account mapping.</p><form method="post" action="/lms/v1/auth/login"><button type="submit">Continue with institution SSO</button></form><form method="post" action="/lms/v1/auth/logout"><button type="submit">Sign out of this application</button></form><p><a href="/lms/v1/auth/session">Check application session</a></p></html>', [], undefined, provider.authorizationOrigin);
      }
      if (path === `${PREFIX}/login` && request.method === 'POST' && !url.search) {
        if (!allowLogin(remoteAddress)) return response(429, { error: 'too_many_sign_in_attempts' });
        const login = await provider.start();
        if (new URL(login.url).origin !== provider.authorizationOrigin) throw new Error('Unexpected sign-in destination.');
        const newBinding = opaque();
        store.logout(sessionToken, binding);
        store.begin({ ...login, binding: newBinding, expiresAt: now() + LOGIN_SECONDS * 1000 }, now());
        return response(303, {}, [cookie(LOGIN_COOKIE, newBinding, LOGIN_SECONDS), cookie(SESSION_COOKIE, '', 0)], login.url, provider.authorizationOrigin);
      }
      if (path === `${PREFIX}/callback` && request.method === 'GET') {
        const state = url.searchParams.get('state');
        const keys = [...url.searchParams.keys()];
        if (!binding || !state || !/^[A-Za-z0-9_-]{43}$/.test(state) || new Set(keys).size !== keys.length) {
          return response(400, { error: 'invalid_sign_in_response' });
        }
        const transaction = store.claim(state, binding, now());
        if (!transaction) return response(400, { error: 'expired_or_used_sign_in' });
        try {
          const identity = await provider.complete(url, { ...transaction, state });
          const token = opaque();
          if (!store.finish(state, binding, identity.issuer, identity.subject, token, now(), now() + SESSION_SECONDS * 1000)) {
            return response(403, { error: 'sign_in_not_authorized' }, [cookie(LOGIN_COOKIE, '', 0)]);
          }
          return response(303, {}, [cookie(SESSION_COOKIE, token, SESSION_SECONDS), cookie(LOGIN_COOKIE, '', 0)], `${origin}${PREFIX}/session`);
        } catch {
          store.cancel(state, binding);
          return response(400, { error: 'sign_in_failed' }, [cookie(LOGIN_COOKIE, '', 0)]);
        }
      }
      if (path === `${PREFIX}/session` && request.method === 'GET' && !url.search) {
        const session = sessionToken ? store.session(sessionToken, now()) : null;
        return session ? response(200, session) : response(401, { error: 'authentication_required' }, [cookie(SESSION_COOKIE, '', 0)]);
      }
      if (path === `${PREFIX}/logout` && request.method === 'POST' && !url.search) {
        store.logout(sessionToken, binding);
        return response(200, { signedOut: true }, expiredCookies());
      }
      return response(404, { error: 'not_found' });
    } catch {
      // Provider error descriptions, callback codes, cookies, and secrets must
      // never be reflected to the browser or emitted to routine logs.
      return response(503, { error: 'authentication_service_unavailable' });
    }
  };
}
