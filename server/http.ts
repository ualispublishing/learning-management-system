import { createServer } from 'node:http';
import { MAX_MUTATION_BYTES } from './gateway.ts';
import { AI_RECOVERY_PATH, MAX_AI_REQUEST_BYTES } from './ai-policy.ts';

type Handler = (request: Request, remoteAddress?: string) => Promise<Response>;
export function createAuthServer(origin: string, handle: Handler, options: { aiPreflight?: (request: Request) => Response | undefined } = {}) {
  let activeAI = 0;
  const server = createServer({ maxHeaderSize: 16_384, requestTimeout: 15_000, headersTimeout: 10_000 }, (incoming, outgoing) => {
    const reject = (status: number) => {
      outgoing.writeHead(status, { 'Cache-Control': 'no-store', 'Connection': 'close' });
      outgoing.end(); incoming.resume();
    };
    if (incoming.method !== 'GET' && incoming.method !== 'POST') { reject(405); return; }
    if (!incoming.url?.startsWith('/') || incoming.url.startsWith('//') || incoming.url.length > 8192) { reject(400); return; }
    const aiUpload = Boolean(options.aiPreflight) && incoming.method === 'POST' && (incoming.url === '/lms/v1/ai/generate' || AI_RECOVERY_PATH.test(incoming.url));
    const maxBytes = incoming.method === 'POST' && incoming.url === '/lms/v1/mutations' ? MAX_MUTATION_BYTES : aiUpload ? MAX_AI_REQUEST_BYTES : 0;
    const acceptsBody = maxBytes > 0;
    if (incoming.headers['content-encoding'] || Number(incoming.headers['content-length'] ?? '0') > maxBytes || (!acceptsBody && incoming.headers['transfer-encoding'])) { reject(413); return; }
    const headers = new Headers();
    for (const [key, value] of Object.entries(incoming.headers)) {
      if (Array.isArray(value)) value.forEach(item => headers.append(key, item));
      else if (value !== undefined) headers.set(key, value);
    }
    void (async () => {
      if (aiUpload) {
        const denied = options.aiPreflight!(new Request(new URL(incoming.url!, origin), { method: 'POST', headers }));
        if (denied) { outgoing.writeHead(denied.status, { ...Object.fromEntries(denied.headers), Connection: 'close' }); outgoing.end(await denied.text()); incoming.resume(); return; }
        if (activeAI >= 2) { reject(429); return; }
        activeAI++;
      }
      const controller = new AbortController();
      const abort = () => { if (!outgoing.writableEnded) controller.abort(); };
      outgoing.once('close', abort);
      try {
        const parts: Buffer[] = []; let length = 0;
        for await (const chunk of incoming) {
          length += chunk.length;
          if (length > maxBytes) { reject(413); return; }
          parts.push(chunk);
        }
        // Never trust Host/forwarding headers to choose the public origin or peer.
        let request: Request;
        try { request = new Request(new URL(incoming.url!, origin), { method: incoming.method, headers, signal: controller.signal, ...(acceptsBody ? { body: Buffer.concat(parts) } : {}) }); }
        catch { reject(400); return; }
        const result = await handle(request, incoming.socket.remoteAddress);
        outgoing.writeHead(result.status, {
          ...Object.fromEntries(result.headers.entries()), 'set-cookie': result.headers.getSetCookie(),
        });
        outgoing.end(await result.text());
      } finally { outgoing.removeListener('close', abort); if (aiUpload) activeAI--; }
    })().catch(() => { if (!outgoing.headersSent) reject(503); else outgoing.destroy(); });
  });
  return server;
}
