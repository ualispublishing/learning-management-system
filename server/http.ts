import { createServer } from 'node:http';
import type { createAuthHandler } from './auth.ts';

export function createAuthServer(origin: string, handle: ReturnType<typeof createAuthHandler>) {
  const server = createServer({ maxHeaderSize: 16_384, requestTimeout: 15_000, headersTimeout: 10_000 }, (incoming, outgoing) => {
    if (incoming.method !== 'GET' && incoming.method !== 'POST') {
      outgoing.writeHead(405); outgoing.end(); incoming.resume(); return;
    }
    if (!incoming.url?.startsWith('/') || incoming.url.startsWith('//') || incoming.url.length > 8192) {
      outgoing.writeHead(400); outgoing.end(); return;
    }
    // Authentication endpoints accept no submitted credentials/body. The edge
    // should also enforce request size and rate limits before this listener.
    if (incoming.headers['transfer-encoding'] || Number(incoming.headers['content-length'] ?? '0') > 0) {
      outgoing.writeHead(413); outgoing.end(); incoming.resume(); return;
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(incoming.headers)) {
      if (Array.isArray(value)) value.forEach(item => headers.append(key, item));
      else if (value !== undefined) headers.set(key, value);
    }
    // Never trust Host or forwarding headers to choose the callback origin or
    // rate-limit identity. The listener is loopback-only behind a TLS proxy.
    let request: Request;
    try { request = new Request(new URL(incoming.url, origin), { method: incoming.method, headers }); }
    catch { outgoing.writeHead(400); outgoing.end(); return; }
    void handle(request, incoming.socket.remoteAddress).then(async result => {
      outgoing.writeHead(result.status, {
        ...Object.fromEntries(result.headers.entries()), 'set-cookie': result.headers.getSetCookie(),
      });
      outgoing.end(await result.text());
    }).catch(() => { outgoing.writeHead(503); outgoing.end(); });
  });
  return server;
}
