/**
 * @fileoverview src/lib/integration/httpResponse.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import { utf8ByteLength } from '../utf8';

export interface RemoteErrorDetail {
  code?: string;
  message?: string;
}

/** Stop awaiting a transport/credential callback even if it ignores cancellation. */
export async function awaitWithAbort<T>(signal: AbortSignal | undefined, work: () => Promise<T>): Promise<T> {
  if (!signal) return work();
  signal.throwIfAborted();
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason ?? new DOMException('Request aborted.', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try { return await Promise.race([work(), aborted]); }
  finally { signal.removeEventListener('abort', onAbort); }
}

/**
 * Reads only a short, single-line error code in production. Human-authored
 * upstream messages may contain learner data or internal diagnostics, so they
 * are exposed only to an explicitly local development transport.
 */
export function readRemoteErrorDetail(payload: unknown, exposeMessage = false): RemoteErrorDetail {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  const record = payload as Record<string, unknown>;
  const rawCode = typeof record.code === 'string' ? record.code.trim() : '';
  const code = rawCode && rawCode.length <= 80 && /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(rawCode)
    ? rawCode
    : undefined;
  if (!exposeMessage || typeof record.message !== 'string') return { code };
  const rawMessage = record.message.trim();
  const message = rawMessage && rawMessage.length <= 240 && !/[\u0000-\u001f\u007f]/.test(rawMessage)
    ? rawMessage
    : undefined;
  return { code, message };
}

/**
 * Reads a response without first materializing an unbounded body in runtimes
 * that expose a WHATWG ReadableStream. React Native fetch implementations that
 * do not expose the stream still receive the same post-read byte validation.
 */
export async function readBoundedResponseText(
  response: Response,
  maxBytes: number,
  createSizeError: () => Error,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) {
    void response.body?.cancel().catch(() => undefined);
    signal.throwIfAborted();
  }
  const declaredHeader = response.headers.get('Content-Length');
  if (declaredHeader !== null) {
    const declaredBytes = Number(declaredHeader);
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
      void response.body?.cancel().catch(() => undefined);
      throw createSizeError();
    }
  }

  const body = response.body;
  if (!body?.getReader || typeof TextDecoder === 'undefined') {
    const text = await awaitWithAbort(signal, () => response.text());
    if (utf8ByteLength(text) > maxBytes) throw createSizeError();
    return text;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let bytesRead = 0;
  let complete = false;
  try {
    while (true) {
      const chunk = await awaitWithAbort(signal, () => reader.read());
      if (chunk.done) { complete = true; break; }
      bytesRead += chunk.value.byteLength;
      if (bytesRead > maxBytes) {
        throw createSizeError();
      }
      parts.push(decoder.decode(chunk.value, { stream: true }));
    }
    parts.push(decoder.decode());
    return parts.join('');
  } finally {
    if (!complete) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
