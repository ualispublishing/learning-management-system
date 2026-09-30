import * as oidc from 'openid-client';
import type { AuthConfig } from './config.ts';

export interface IdentityProvider {
  authorizationOrigin: string;
  start(): Promise<{ url: string; state: string; verifier: string; nonce: string }>;
  complete(callback: URL, expected: { state: string; verifier: string; nonce: string }): Promise<{ issuer: string; subject: string }>;
}

/** Provider tokens never become LMS cookies, client credentials, or role claims. */
export async function createIdentityProvider(config: AuthConfig, transport?: oidc.CustomFetch): Promise<IdentityProvider> {
  const client = await oidc.discovery(new URL(config.issuer), config.clientId, config.clientSecret, undefined, {
    ...(transport ? { [oidc.customFetch]: transport } : {}), timeout: 10, execute: [oidc.enableNonRepudiationChecks],
  });
  const metadata = client.serverMetadata();
  for (const endpoint of [metadata.authorization_endpoint, metadata.token_endpoint, metadata.jwks_uri]) {
    if (!endpoint) throw new Error('The identity provider is missing required endpoints.');
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('Identity provider endpoints must use credential-free HTTPS.');
  }
  const redirectUri = `${config.origin}/lms/v1/auth/callback`;
  return {
    authorizationOrigin: new URL(metadata.authorization_endpoint!).origin,
    async start() {
      const verifier = oidc.randomPKCECodeVerifier();
      const state = oidc.randomState();
      const nonce = oidc.randomNonce();
      const url = oidc.buildAuthorizationUrl(client, {
        redirect_uri: redirectUri, response_type: 'code', scope: 'openid',
        state, nonce, code_challenge: await oidc.calculatePKCECodeChallenge(verifier), code_challenge_method: 'S256',
      });
      return { url: url.href, state, verifier, nonce };
    },
    async complete(callback, expected) {
      if (callback.origin + callback.pathname !== redirectUri) throw new Error('Unexpected authentication callback.');
      const tokens = await oidc.authorizationCodeGrant(client, callback, {
        expectedState: expected.state, expectedNonce: expected.nonce, pkceCodeVerifier: expected.verifier, idTokenExpected: true,
      });
      const claims = tokens.claims();
      if (!claims || claims.iss !== config.issuer || !claims.sub || claims.sub.length > 2048) throw new Error('Invalid identity claims.');
      return { issuer: claims.iss, subject: claims.sub };
    },
  };
}
