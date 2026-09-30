import { createAuthServer } from './http.ts';
import { readAuthConfig } from './config.ts';
import { AuthStore } from './store.ts';
import { createIdentityProvider } from './oidc.ts';
import { createAuthHandler } from './auth.ts';

async function main() {
  process.umask(0o077);
  const config = readAuthConfig(process.env);
  const provider = await createIdentityProvider(config);
  const store = new AuthStore(config.databasePath);
  const handle = createAuthHandler({ origin: config.origin, provider, store });
  const server = createAuthServer(config.origin, handle);
  server.listen(config.port, '127.0.0.1', () => console.log(`Authentication service listening on loopback port ${config.port}. HTTPS proxy required.`));
  const shutdown = () => server.close(() => { store.close(); process.exit(0); });
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
}

void main().catch(() => {
  console.error('Authentication service could not start. Check private server configuration, identity discovery, and database access.');
  process.exitCode = 1;
});
