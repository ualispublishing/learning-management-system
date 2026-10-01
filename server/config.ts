import { institution, type Institution } from './gateway-validation.ts';

export interface AuthConfig {
  origin: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  databasePath: string;
  port: number;
}

/** Unset keeps the existing auth-only mode; partial configuration fails closed. */
export function readGatewayConfig(env: NodeJS.ProcessEnv): Institution | undefined {
  const keys = ['LMS_INSTITUTION_ID', 'LMS_INSTITUTION_NAME', 'LMS_INSTITUTION_TIME_ZONE'];
  if (keys.every(key => env[key] === undefined)) return undefined;
  return institution({ id: required(env, keys[0]), name: required(env, keys[1]), timeZone: required(env, keys[2]) });
}

const required = (env: NodeJS.ProcessEnv, name: string): string => {
  const value = env[name];
  if (!value || value !== value.trim() || value.length > 8192 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${name} must be configured with a non-empty, bounded value.`);
  }
  return value;
};

export function readAuthConfig(env: NodeJS.ProcessEnv): AuthConfig {
  const origin = new URL(required(env, 'LMS_AUTH_PUBLIC_ORIGIN'));
  const issuerValue = required(env, 'LMS_AUTH_ISSUER');
  const issuer = new URL(issuerValue);
  for (const url of [origin, issuer]) {
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new Error('Authentication URLs must use credential-free HTTPS without a query or fragment.');
    }
  }
  if (origin.pathname !== '/') throw new Error('LMS_AUTH_PUBLIC_ORIGIN must be an origin without a path.');
  const databasePath = required(env, 'LMS_AUTH_DATABASE_PATH');
  if (!databasePath.startsWith('/') || databasePath === '/:memory:') throw new Error('LMS_AUTH_DATABASE_PATH must be an absolute persistent file path.');
  const port = Number(env.LMS_AUTH_PORT ?? '4190');
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('LMS_AUTH_PORT must be an integer from 1024 to 65535.');
  return {
    origin: origin.origin, issuer: issuerValue,
    clientId: required(env, 'LMS_AUTH_CLIENT_ID'), clientSecret: required(env, 'LMS_AUTH_CLIENT_SECRET'),
    databasePath, port,
  };
}
