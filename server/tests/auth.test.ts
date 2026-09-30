import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CustomFetch } from 'openid-client';
import { createAuthHandler } from '../auth.ts';
import { readAuthConfig, type AuthConfig } from '../config.ts';
import { createIdentityProvider } from '../oidc.ts';
import { AuthStore } from '../store.ts';
import { createAuthServer } from '../http.ts';

const config: AuthConfig = { origin: 'https://lms.example', issuer: 'https://identity.example/realm', clientId: 'lms', clientSecret: 'test-only-client-value', databasePath: '/private/auth.sqlite', port: 4190 };
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const wrongKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = (claims: Record<string, unknown>, wrongSignature = false) => {
  const payload = `${b64({ alg: 'RS256', kid: 'test-key', typ: 'JWT' })}.${b64(claims)}`;
  return `${payload}.${sign('RSA-SHA256', Buffer.from(payload), wrongSignature ? wrongKeys.privateKey : keys.privateKey).toString('base64url')}`;
};
const cookieValue = (result: Response, name: string) => result.headers.getSetCookie().find(value => value.startsWith(`${name}=`))?.split(';')[0] ?? '';
const sessionCookie = (result: Response) => cookieValue(result, '__Host-lms_session');
const loginCookie = (result: Response) => cookieValue(result, '__Host-lms_login');
const post = (path: string, cookies = '', origin: string | null = config.origin) => new Request(`${config.origin}/lms/v1/auth/${path}`, {
  method: 'POST', headers: { ...(origin ? { origin } : {}), cookie: cookies },
});
const sessionRequest = (cookies = '') => new Request(`${config.origin}/lms/v1/auth/session`, { headers: { cookie: cookies } });

async function fixture(database = ':memory:', identityConfig = config) {
  let now = Date.now();
  let authorization: URL;
  const override = { claims: {} as Record<string, unknown>, wrongSignature: false, hold: null as Promise<void> | null, exchanges: 0 };
  const exchanging = Promise.withResolvers<void>();
  // Real openid-client handles discovery, state/nonce/PKCE checks and RSA JWT
  // verification. Only HTTP transport to a synthetic identity provider is replaced.
  const transport: CustomFetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/.well-known/openid-configuration')) return Response.json({
      issuer: identityConfig.issuer, authorization_endpoint: `${identityConfig.issuer}/authorize`,
      token_endpoint: `${identityConfig.issuer}/token`, jwks_uri: `${identityConfig.issuer}/jwks`,
      response_types_supported: ['code'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'],
      code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['client_secret_post'],
    });
    if (url.pathname.endsWith('/jwks')) return Response.json({ keys: [{ ...keys.publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' }] });
    if (url.pathname.endsWith('/token')) {
      override.exchanges++; exchanging.resolve();
      if (override.hold) await override.hold;
      const body = new URLSearchParams(String(init.body));
      assert.equal(body.get('grant_type'), 'authorization_code');
      assert.equal(body.get('client_secret'), identityConfig.clientSecret);
      assert.equal(body.get('redirect_uri'), `${identityConfig.origin}/lms/v1/auth/callback`);
      assert.equal(createHash('sha256').update(body.get('code_verifier')!).digest('base64url'), authorization.searchParams.get('code_challenge'));
      return Response.json({
        token_type: 'Bearer', access_token: 'synthetic-provider-access', refresh_token: 'synthetic-provider-refresh', expires_in: 300,
        id_token: jwt({ iss: identityConfig.issuer, aud: identityConfig.clientId, sub: 'subject-123', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300, nonce: authorization.searchParams.get('nonce'), ...override.claims }, override.wrongSignature),
      });
    }
    throw new Error('Unexpected provider request');
  };
  const provider = await createIdentityProvider(identityConfig, transport);
  const store = new AuthStore(database);
  store.provision(identityConfig.issuer, 'subject-123', { id: 'learner-1', name: 'Approved Learner', globalRole: 'user' });
  const handler = createAuthHandler({ origin: identityConfig.origin, provider, store, now: () => now });
  const start = async () => {
    const result = await handler(post('login'));
    assert.equal(result.status, 303);
    authorization = new URL(result.headers.get('location')!);
    assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(authorization.searchParams.get('scope'), 'openid');
    assert.equal(authorization.searchParams.get('response_type'), 'code');
    const callback = new URL(`${identityConfig.origin}/lms/v1/auth/callback`);
    callback.searchParams.set('state', authorization.searchParams.get('state')!);
    callback.searchParams.set('code', 'single-use-code');
    return { result, callback, cookie: loginCookie(result) };
  };
  return { provider, store, handler, start, override, exchanging, time: () => now, advance: (ms: number) => { now += ms; } };
}

test('OIDC login verifies identity, returns an opaque hardened cookie, and exposes only mapped LMS identity', async () => {
  const f = await fixture();
  try {
    f.override.claims = { name: 'Unapproved name', email: 'admin@example.edu', roles: ['admin'], globalRole: 'admin' };
    assert.equal((await f.handler(sessionRequest())).status, 401);
    const login = await f.start();
    const callback = await f.handler(new Request(login.callback, { headers: { cookie: login.cookie } }));
    assert.equal(callback.status, 303);
    assert.equal(callback.headers.get('location'), `${config.origin}/lms/v1/auth/session`);
    const cookie = callback.headers.getSetCookie().find(value => value.startsWith('__Host-lms_session='))!;
    for (const flag of ['Secure', 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=28800']) assert.ok(cookie.includes(flag));
    const result = await f.handler(sessionRequest(sessionCookie(callback)));
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.equal(result.headers.get('access-control-allow-origin'), null);
    assert.deepEqual(await result.json(), { user: { id: 'learner-1', name: 'Approved Learner', globalRole: 'user' }, expiresAt: f.time() + 8 * 60 * 60 * 1000 });
    assert.equal(f.override.exchanges, 1);
    assert.equal((await f.handler(new Request(login.callback, { headers: { cookie: login.cookie } }))).status, 400);
    assert.equal(f.override.exchanges, 1, 'Replay must not contact the token endpoint');
  } finally { f.store.close(); }
});

for (const [label, claims, badSignature] of [
  ['wrong issuer', { iss: 'https://attacker.example' }, false],
  ['wrong audience', { aud: 'other-application' }, false],
  ['expired token', { exp: 1 }, false],
  ['wrong nonce', { nonce: 'not-the-request-nonce' }, false],
  ['bad signature', {}, true],
] as const) {
  test(`OIDC rejects ${label} and never establishes an application session`, async () => {
    const f = await fixture();
    try {
      f.override.claims = claims; f.override.wrongSignature = badSignature;
      const login = await f.start();
      const result = await f.handler(new Request(login.callback, { headers: { cookie: login.cookie } }));
      assert.equal(result.status, 400);
      assert.equal(sessionCookie(result), '');
      assert.deepEqual(await result.json(), { error: 'sign_in_failed' });
    } finally { f.store.close(); }
  });
}

test('wrong/missing browser binding, changed/duplicate state and expired login are rejected before exchange', async () => {
  const f = await fixture();
  try {
    const login = await f.start();
    assert.equal((await f.handler(new Request(login.callback))).status, 400);
    assert.equal((await f.handler(new Request(login.callback, { headers: { cookie: '__Host-lms_login=' + 'z'.repeat(43) } }))).status, 400);
    const wrongState = new URL(login.callback); wrongState.searchParams.set('state', 'z'.repeat(43));
    assert.equal((await f.handler(new Request(wrongState, { headers: { cookie: login.cookie } }))).status, 400);
    const duplicate = new URL(login.callback); duplicate.searchParams.append('state', duplicate.searchParams.get('state')!);
    assert.equal((await f.handler(new Request(duplicate, { headers: { cookie: login.cookie } }))).status, 400);
    assert.equal((await f.handler(new Request(login.callback, { headers: { cookie: `${login.cookie}; ${login.cookie}` } }))).status, 400);
    f.advance(10 * 60 * 1000);
    assert.equal((await f.handler(new Request(login.callback, { headers: { cookie: login.cookie } }))).status, 400);
    assert.equal(f.override.exchanges, 0);
  } finally { f.store.close(); }
});

test('unmapped subjects cannot gain access through matching email or provider role claims', async () => {
  const f = await fixture();
  try {
    f.override.claims = { sub: 'unmapped', email: 'learner@example.edu', globalRole: 'admin' };
    const login = await f.start();
    const result = await f.handler(new Request(login.callback, { headers: { cookie: login.cookie } }));
    assert.equal(result.status, 403);
    assert.equal(sessionCookie(result), '');
  } finally { f.store.close(); }
});

test('logout is idempotent, revokes the persisted session, and requires the configured Origin', async () => {
  const f = await fixture();
  try {
    const login = await f.start();
    const callback = await f.handler(new Request(login.callback, { headers: { cookie: login.cookie } }));
    const credential = sessionCookie(callback);
    for (const origin of [null, 'https://attacker.example', 'null']) {
      assert.equal((await f.handler(post('logout', credential, origin))).status, 403);
      assert.equal((await f.handler(post('login', '', origin))).status, 403);
    }
    assert.equal((await f.handler(new Request(`${config.origin}/lms/v1/auth/logout`, { headers: { cookie: credential } }))).status, 404);
    assert.equal((await f.handler(sessionRequest(credential))).status, 200);
    const loggedOut = await f.handler(post('logout', credential));
    assert.equal(loggedOut.status, 200);
    assert.ok(loggedOut.headers.getSetCookie().every(value => value.includes('Max-Age=0')));
    assert.equal((await f.handler(sessionRequest(credential))).status, 401);
    assert.equal((await f.handler(post('logout', credential))).status, 200);
  } finally { f.store.close(); }
});

test('logout cancels an in-flight exchange and a callback completed before its response arrived', async () => {
  const f = await fixture();
  try {
    const hold = Promise.withResolvers<void>(); f.override.hold = hold.promise;
    const login = await f.start();
    const pending = f.handler(new Request(login.callback, { headers: { cookie: login.cookie } }));
    await f.exchanging.promise;
    assert.equal((await f.handler(post('logout', login.cookie))).status, 200);
    hold.resolve();
    assert.equal((await pending).status, 403);
    f.override.hold = null;
    const retry = await f.start();
    const completed = await f.handler(new Request(retry.callback, { headers: { cookie: retry.cookie } }));
    assert.equal(completed.status, 303);
    await f.handler(post('logout', retry.cookie));
    assert.equal((await f.handler(sessionRequest(sessionCookie(completed)))).status, 401);
  } finally { f.store.close(); }
});

test('session expires absolutely; disabling an account revokes current and future sign-ins', async () => {
  const f = await fixture();
  try {
    let login = await f.start();
    let result = await f.handler(new Request(login.callback, { headers: { cookie: login.cookie } }));
    f.advance(8 * 60 * 60 * 1000);
    assert.equal((await f.handler(sessionRequest(sessionCookie(result)))).status, 401);
    login = await f.start(); result = await f.handler(new Request(login.callback, { headers: { cookie: login.cookie } }));
    assert.equal(result.status, 303);
    f.store.disable('learner-1');
    assert.equal((await f.handler(sessionRequest(sessionCookie(result)))).status, 401);
    login = await f.start();
    assert.equal((await f.handler(new Request(login.callback, { headers: { cookie: login.cookie } }))).status, 403);
  } finally { f.store.close(); }
});

test('persistent sessions survive restart, while logged-out sessions remain revoked and credentials stay hashed', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'lms-auth-test-'));
  const database = join(directory, 'auth.sqlite');
  const f = await fixture(database);
  try {
    const login = await f.start();
    const result = await f.handler(new Request(login.callback, { headers: { cookie: login.cookie } }));
    const credential = sessionCookie(result).split('=')[1];
    assert.ok(credential);
    f.store.close();
    const restarted = new AuthStore(database);
    try {
      assert.equal(restarted.session(credential, f.time())?.user.id, 'learner-1');
      restarted.logout(credential, null);
    } finally { restarted.close(); }
    const again = new AuthStore(database);
    try { assert.equal(again.session(credential, f.time()), null); } finally { again.close(); }
    const bytes = readFileSync(database);
    assert.equal(bytes.includes(Buffer.from(credential)), false);
    assert.equal(bytes.includes(Buffer.from('synthetic-provider-access')), false);
    assert.equal(bytes.includes(Buffer.from(config.clientSecret)), false);
    assert.equal(statSync(database).mode & 0o777, 0o600);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('bounded sign-in rate, fixed redirects, private responses, and no demo/data endpoints', async () => {
  const f = await fixture();
  try {
    const page = await f.handler(new Request(`${config.origin}/lms/v1/auth`));
    assert.ok(page.headers.get('content-security-policy')?.includes(f.provider.authorizationOrigin));
    assert.equal((await f.handler(post('login?returnTo=https://attacker.example'))).status, 404);
    for (let i = 0; i < 10; i++) assert.equal((await f.handler(post('login'))).status, 303);
    assert.equal((await f.handler(post('login'))).status, 429);
    f.advance(60_000);
    assert.equal((await f.handler(post('login'))).status, 303);
    assert.equal((await f.handler(new Request('https://attacker.example/lms/v1/auth/session'))).status, 400);
    assert.equal((await f.handler(new Request(`${config.origin}/lms/v1/snapshot`))).status, 404);
    assert.equal((await f.handler(new Request(`${config.origin}/lms/v1/auth/session`, { method: 'OPTIONS' }))).status, 405);
  } finally { f.store.close(); }
});

test('provider errors are redacted and their login transaction cannot be retried', async () => {
  const f = await fixture();
  try {
    const login = await f.start();
    login.callback.searchParams.delete('code');
    login.callback.searchParams.set('error', 'access_denied');
    login.callback.searchParams.set('error_description', 'private-provider-details');
    const result = await f.handler(new Request(login.callback, { headers: { cookie: login.cookie } }));
    assert.equal(result.status, 400);
    assert.equal((await result.text()).includes('private-provider-details'), false);
    assert.equal((await f.handler(new Request(login.callback, { headers: { cookie: login.cookie } }))).status, 400);
  } finally { f.store.close(); }
});

test('server configuration rejects insecure/missing values and preserves exact root issuer identity', () => {
  const env = { LMS_AUTH_PUBLIC_ORIGIN: config.origin, LMS_AUTH_ISSUER: 'https://identity.example', LMS_AUTH_CLIENT_ID: config.clientId, LMS_AUTH_CLIENT_SECRET: config.clientSecret, LMS_AUTH_DATABASE_PATH: config.databasePath };
  assert.equal(readAuthConfig(env).issuer, env.LMS_AUTH_ISSUER);
  assert.throws(() => readAuthConfig({}));
  for (const [key, value] of [
    ['LMS_AUTH_PUBLIC_ORIGIN', 'http://localhost'], ['LMS_AUTH_PUBLIC_ORIGIN', `${config.origin}/app`],
    ['LMS_AUTH_ISSUER', 'https://user:password@identity.example'], ['LMS_AUTH_ISSUER', `${config.issuer}?tenant=one`],
    ['LMS_AUTH_DATABASE_PATH', ':memory:'], ['LMS_AUTH_PORT', '0'], ['LMS_AUTH_CLIENT_SECRET', ''],
  ]) assert.throws(() => readAuthConfig({ ...env, [key]: value }));
});

test('a root issuer without a trailing slash completes OIDC sign-in', async () => {
  const f = await fixture(':memory:', { ...config, issuer: 'https://identity.example' });
  try {
    const login = await f.start();
    const result = await f.handler(new Request(login.callback, { headers: { cookie: login.cookie } }));
    assert.equal(result.status, 303);
    assert.equal((await f.handler(sessionRequest(sessionCookie(result)))).status, 200);
  } finally { f.store.close(); }
});

test('loopback HTTP boundary rejects unsupported methods/bodies and ignores forged Host/forwarding headers', async () => {
  const f = await fixture();
  const server = createAuthServer(config.origin, f.handler);
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const port = (server.address() as AddressInfo).port;
    const request = (method: string, path: string, body = '') => new Promise<{ status: number; cookies: string[]; location?: string }>((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port, method, path, headers: {
        host: 'attacker.example', 'x-forwarded-host': 'attacker.example', 'x-forwarded-for': '192.0.2.5',
        origin: config.origin, 'content-length': Buffer.byteLength(body),
      } }, res => {
        res.resume(); res.on('end', () => resolve({ status: res.statusCode!, cookies: res.headers['set-cookie'] ?? [], location: res.headers.location }));
      });
      req.on('error', reject); req.end(body);
    });
    assert.equal((await request('TRACE', '/lms/v1/auth/session')).status, 405);
    assert.equal((await request('POST', '/lms/v1/auth/login', 'password=must-not-be-accepted')).status, 413);
    assert.equal((await request('GET', '/lms/v1/auth/session')).status, 401);
    const login = await request('POST', '/lms/v1/auth/login');
    assert.equal(login.status, 303);
    assert.equal(new URL(login.location!).searchParams.get('redirect_uri'), `${config.origin}/lms/v1/auth/callback`);
    assert.equal(login.cookies.length, 2, 'Multiple Set-Cookie headers must survive the Node HTTP bridge');
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    f.store.close();
  }
});
