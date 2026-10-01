import { createServer } from 'node:http';
import { MAX_MUTATION_BYTES } from './gateway.ts';

type Handler = (request: Request, remoteAddress?: string) => Promise<Response>;
export function createAuthServer(origin: string, handle: Handler) {
  const server = createServer({ maxHeaderSize: 16_384, requestTimeout: 15_000, headersTimeout: 10_000 }, (incoming, outgoing) => {
    const reject = (status: number) => {
      outgoing.writeHead(status, { 'Cache-Control': 'no-store', 'Connection': 'close' });
      outgoing.end(); incoming.resume();
    };
    if (incoming.method !== 'GET' && incoming.method !== 'POST') { reject(405); return; }
    if (!incoming.url?.startsWith('/') || incoming.url.startsWith('//') || incoming.url.length > 8192) { reject(400); return; }
    // Only the mutation endpoint accepts a body. Count streamed bytes as well
    // as checking Content-Length; chunked transfer cannot bypass the bound.
    const acceptsBody = incoming.method === 'POST' && incoming.url === '/lms/v1/mutations';
    if (incoming.headers['content-encoding'] || Number(incoming.headers['content-length'] ?? '0') > (acceptsBody ? MAX_MUTATION_BYTES : 0) || (!acceptsBody && incoming.headers['transfer-encoding'])) { reject(413); return; }
    const headers = new Headers();
    for (const [key, value] of Object.entries(incoming.headers)) {
      if (Array.isArray(value)) value.forEach(item => headers.append(key, item));
      else if (value !== undefined) headers.set(key, value);
    }
    void (async () => {
      const parts: Buffer[] = []; let length = 0;
      for await (const chunk of incoming) {
        length += chunk.length;
        if (length > (acceptsBody ? MAX_MUTATION_BYTES : 0)) { reject(413); return; }
        parts.push(chunk);
      }
      // Never trust Host/forwarding headers to choose the public origin or peer.
      let request: Request;
      try { request = new Request(new URL(incoming.url!, origin), { method: incoming.method, headers, ...(acceptsBody ? { body: Buffer.concat(parts) } : {}) }); }
      catch { reject(400); return; }
      const result = await handle(request, incoming.socket.remoteAddress);
      outgoing.writeHead(result.status, {
        ...Object.fromEntries(result.headers.entries()), 'set-cookie': result.headers.getSetCookie(),
      });
      outgoing.end(await result.text());
    })().catch(() => { if (!outgoing.headersSent) reject(503); else outgoing.destroy(); });
  });
  return server;
}
