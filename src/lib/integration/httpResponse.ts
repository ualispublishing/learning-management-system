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
): Promise<string> {
  const declaredHeader = response.headers.get('Content-Length');
  if (declaredHeader !== null) {
    const declaredBytes = Number(declaredHeader);
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) throw createSizeError();
  }

  const body = response.body;
  if (!body?.getReader || typeof TextDecoder === 'undefined') {
    const text = await response.text();
    if (utf8ByteLength(text) > maxBytes) throw createSizeError();
    return text;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let bytesRead = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytesRead += chunk.value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw createSizeError();
      }
      parts.push(decoder.decode(chunk.value, { stream: true }));
    }
    parts.push(decoder.decode());
    return parts.join('');
  } finally {
    reader.releaseLock();
  }
}
