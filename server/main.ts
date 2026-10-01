import { createAuthServer } from './http.ts';
import { readAuthConfig, readGatewayConfig } from './config.ts';
import { AuthStore } from './store.ts';
import { createIdentityProvider } from './oidc.ts';
import { createAuthHandler } from './auth.ts';
import { createGatewayHandler } from './gateway.ts';
import { GatewayStore } from './gateway-store.ts';

async function main() {
  process.umask(0o077);
  const config = readAuthConfig(process.env);
  const institution = readGatewayConfig(process.env);
  const provider = await createIdentityProvider(config);
  const store = new AuthStore(config.databasePath);
  const auth = createAuthHandler({ origin: config.origin, provider, store });
  const gateway = institution ? new GatewayStore(config.databasePath, institution) : undefined;
  const learning = gateway ? createGatewayHandler({ origin: config.origin, auth: store, gateway }) : undefined;
  const server = createAuthServer(config.origin, (request, address) => {
    const path = new URL(request.url).pathname;
    return learning && (path === '/lms/v1/snapshot' || path === '/lms/v1/mutations') ? learning(request) : auth(request, address);
  });
  server.listen(config.port, '127.0.0.1', () => console.log(`LMS reference service listening on loopback port ${config.port}. HTTPS proxy required. Gateway ${gateway ? 'enabled' : 'disabled'}.`));
  const shutdown = () => server.close(() => { gateway?.close(); store.close(); process.exit(0); });
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
}

void main().catch(() => {
  console.error('Authentication service could not start. Check private server configuration, identity discovery, and database access.');
  process.exitCode = 1;
});
