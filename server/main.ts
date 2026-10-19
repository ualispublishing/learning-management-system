import { createAuthServer } from './http.ts';
import { readAIConfig, readAuthConfig, readGatewayConfig } from './config.ts';
import { AuthStore } from './store.ts';
import { createIdentityProvider } from './oidc.ts';
import { createAuthHandler } from './auth.ts';
import { createGatewayHandler } from './gateway.ts';
import { GatewayStore } from './gateway-store.ts';
import { createAIGateway } from './ai.ts';
import { createOpenAIResponsesProvider } from '../src/lib/ai/openaiProvider.server.ts';

async function main() {
  process.umask(0o077);
  const config = readAuthConfig(process.env);
  const institution = readGatewayConfig(process.env);
  const aiConfig = readAIConfig(process.env);
  if (aiConfig && !institution) throw new Error('AI requires the institutional gateway.');
  const provider = await createIdentityProvider(config);
  const store = new AuthStore(config.databasePath);
  const auth = createAuthHandler({ origin: config.origin, provider, store });
  const gateway = institution ? new GatewayStore(config.databasePath, institution) : undefined;
  const learning = gateway ? createGatewayHandler({ origin: config.origin, auth: store, gateway }) : undefined;
  const ai = aiConfig && gateway ? createAIGateway({ origin: config.origin, auth: store, gateway,
    provider: createOpenAIResponsesProvider({ model: aiConfig.model, reasoningEffort: aiConfig.reasoningEffort, maxOutputTokens: aiConfig.maxOutputTokens, getApiKey: async () => aiConfig.apiKey }), policy: aiConfig.policy }) : undefined;
  // Disabling new generation must not disable cleanup of previously retained sources.
  if (gateway) { gateway.recoverAIRequests(); gateway.pruneAI(Date.now()); }
  const retentionTimer = gateway ? setInterval(() => { try { gateway.pruneAI(Date.now()); } catch { console.error('AI retention cleanup failed; operator attention required.'); } }, 60_000) : undefined;
  retentionTimer?.unref();
  const server = createAuthServer(config.origin, (request, address) => {
    const path = new URL(request.url).pathname;
    if (ai && path.startsWith('/lms/v1/ai/')) return ai.handle(request);
    return learning && (path === '/lms/v1/snapshot' || path === '/lms/v1/mutations') ? learning(request) : auth(request, address);
  }, { aiPreflight: ai?.preflight });
  server.listen(config.port, '127.0.0.1', () => console.log(`LMS reference service listening on loopback port ${config.port}. HTTPS proxy required. Gateway ${gateway ? 'enabled' : 'disabled'}.`));
  const shutdown = () => { clearInterval(retentionTimer); server.close(() => { gateway?.close(); store.close(); process.exit(0); }); };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
}

void main().catch(() => {
  console.error('Authentication service could not start. Check private server configuration, identity discovery, and database access.');
  process.exitCode = 1;
});
