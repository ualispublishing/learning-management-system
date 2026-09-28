/**
 * @fileoverview src/lib/chat/pagination.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import type { ChatMessage } from '../../types/lms';
import type { ChatMessagePage, ChatMessagePageRequest } from '../repositories/interfaces';

export const DEFAULT_CHAT_PAGE_SIZE = 50;
export const MAX_CHAT_PAGE_SIZE = 100;
export const MAX_CHAT_SEARCH_CHARACTERS = 200;
export const MAX_CHAT_CURSOR_CHARACTERS = 2_048;

const CURSOR_VERSION = 'chat1';

export interface NormalizedChatMessagePageRequest {
  cursor?: string;
  limit: number;
  query?: string;
}

export const normalizeChatMessagePageRequest = (
  request: ChatMessagePageRequest = {},
): NormalizedChatMessagePageRequest => {
  const limit = request.limit ?? DEFAULT_CHAT_PAGE_SIZE;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CHAT_PAGE_SIZE) {
    throw new Error(`Chat page size must be a whole number from 1 to ${MAX_CHAT_PAGE_SIZE}.`);
  }
  const cursor = request.cursor?.trim();
  if (cursor !== undefined && (!cursor || cursor.length > MAX_CHAT_CURSOR_CHARACTERS)) {
    throw new Error(`Chat cursors must contain 1–${MAX_CHAT_CURSOR_CHARACTERS.toLocaleString()} characters.`);
  }
  const query = request.query?.trim();
  if (query !== undefined && (query.length < 2 || query.length > MAX_CHAT_SEARCH_CHARACTERS)) {
    throw new Error(`Chat searches must contain 2–${MAX_CHAT_SEARCH_CHARACTERS} characters.`);
  }
  return { cursor, limit, query };
};

const encodeCursor = (message: Pick<ChatMessage, 'timestamp' | 'id'>): string =>
  `${CURSOR_VERSION}:${message.timestamp}:${encodeURIComponent(message.id)}`;

const decodeCursor = (cursor: string): { timestamp: number; id: string } => {
  const match = /^chat1:(\d+):(.+)$/.exec(cursor);
  if (!match) throw new Error('The chat history cursor is malformed or unsupported. Refresh the conversation.');
  const timestamp = Number(match[1]);
  let id: string;
  try {
    id = decodeURIComponent(match[2]);
  } catch {
    throw new Error('The chat history cursor is malformed or unsupported. Refresh the conversation.');
  }
  if (!Number.isSafeInteger(timestamp) || timestamp < 0 || !id || id.length > 256) {
    throw new Error('The chat history cursor is malformed or unsupported. Refresh the conversation.');
  }
  return { timestamp, id };
};

const compareMessageIdentity = (
  left: Pick<ChatMessage, 'timestamp' | 'id'>,
  right: Pick<ChatMessage, 'timestamp' | 'id'>,
): number => left.timestamp - right.timestamp || left.id.localeCompare(right.id);

export const paginateChatMessages = (
  source: ChatMessage[],
  request: ChatMessagePageRequest = {},
): ChatMessagePage => {
  const normalized = normalizeChatMessagePageRequest(request);
  const boundary = normalized.cursor ? decodeCursor(normalized.cursor) : undefined;
  const query = normalized.query?.toLowerCase();
  const eligible = source
    .filter(message => !message.deletedAt)
    .filter(message => !boundary || compareMessageIdentity(message, boundary) < 0)
    .filter(message => !query || [message.text, message.senderName, message.mediaName || '']
      .some(value => value.toLowerCase().includes(query)))
    .sort(compareMessageIdentity);
  const hasMore = eligible.length > normalized.limit;
  const messages = eligible.slice(-normalized.limit);
  return {
    messages,
    hasMore,
    nextCursor: hasMore && messages[0] ? encodeCursor(messages[0]) : undefined,
  };
};

export const validateChatMessagePageEnvelope = (
  value: unknown,
  requestedLimit: number,
): { messages: unknown[]; hasMore: boolean; nextCursor?: string } => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The institution chat-history endpoint returned a non-object page.');
  }
  const raw = value as Record<string, unknown>;
  const unexpected = Object.keys(raw).find(key => !['messages', 'hasMore', 'nextCursor'].includes(key));
  if (unexpected) throw new Error(`The institution chat-history page contains unsupported field "${unexpected}".`);
  if (!Array.isArray(raw.messages) || raw.messages.length > requestedLimit) {
    throw new Error(`The institution chat-history endpoint must return at most ${requestedLimit} messages.`);
  }
  if (typeof raw.hasMore !== 'boolean') throw new Error('The institution chat-history endpoint omitted its hasMore flag.');
  const nextCursor = typeof raw.nextCursor === 'string' ? raw.nextCursor.trim() : undefined;
  if (raw.nextCursor !== undefined && (typeof raw.nextCursor !== 'string' || !nextCursor || nextCursor.length > MAX_CHAT_CURSOR_CHARACTERS)) {
    throw new Error('The institution chat-history endpoint returned an invalid next cursor.');
  }
  if (raw.hasMore && !nextCursor) throw new Error('The institution chat-history endpoint reported more messages without a continuation cursor.');
  return { messages: raw.messages, hasMore: raw.hasMore, nextCursor };
};
