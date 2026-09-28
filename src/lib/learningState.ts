/**
 * @fileoverview src/lib/learningState.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createEntityId } from './id';

export type LearningStateKind =
  | 'announcement-dismissals'
  | 'course-layout'
  | 'course-page'
  | 'external-site'
  | 'media-playback'
  | 'static-widget'
  | 'course-study-set'
  | 'assessment-navigation'
  | 'chat-draft'
  | 'study-session';

export interface LearningStateScope {
  principalId: string;
  courseId?: string;
  contentItemId?: string;
  threadId?: string;
  deckId?: string;
}

export interface LearningStatePayloads {
  'announcement-dismissals': { ids: string[] };
  'course-layout': { viewMode: 'vertical' | 'horizontal' };
  'course-page': { pageId?: string; verticalOffset?: number; maximizedWidgetId?: string | null };
  'external-site': { loadedAt: number; progress?: number; positionSeconds?: number; resumeToken?: string };
  'media-playback': { positionSeconds: number; durationSeconds?: number; completed?: boolean };
  'static-widget': { expanded: boolean };
  'course-study-set': { cardId?: string; revealed: boolean; masteredIds: string[] };
  'assessment-navigation': { pageIndex: number };
  'chat-draft': { text: string; replyToMessageId?: string; mentionedUserIds: string[]; clientMessageId: string };
  'study-session': { cardId?: string; revealed: boolean; depthIndex: number };
}

export interface LearningStateRecord<K extends LearningStateKind = LearningStateKind> {
  schemaVersion: 1;
  scope: LearningStateScope;
  kind: K;
  payload: LearningStatePayloads[K];
  updatedAt: number;
  expiresAt: number;
  /** Stable for one logical write so a lost acknowledgement can be retried safely. */
  writeId: string;
}

export type LearningActivityType =
  | 'course-page-viewed'
  | 'content-opened'
  | 'external-site-loaded'
  | 'provider-progress-reported'
  | 'media-progress-saved'
  | 'assessment-resumed'
  | 'study-set-resumed';

export interface LearningActivityEvent {
  schemaVersion: 1;
  eventId: string;
  type: LearningActivityType;
  scope: LearningStateScope;
  occurredAt: number;
  consentNoticeVersion: string;
  source?: 'lms-ui' | 'provider-bridge';
  progress?: number;
  positionSeconds?: number;
}

export interface LearningActivityConsent {
  granted: boolean;
  noticeVersion: string;
}

export interface LearningStateService {
  load<K extends LearningStateKind>(scope: LearningStateScope, kind: K): Promise<LearningStateRecord<K> | null>;
  save<K extends LearningStateKind>(scope: LearningStateScope, kind: K, payload: LearningStatePayloads[K], writeId?: string): Promise<LearningStateRecord<K>>;
  remove(scope: LearningStateScope, kind: LearningStateKind): Promise<void>;
  /** Optional analytics channel. Operational resume-state writes never imply analytics consent. */
  recordActivity?(event: LearningActivityEvent): Promise<void>;
}

export interface LearningStateKeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export const LEARNING_STATE_RETENTION_MS: Record<LearningStateKind, number> = {
  'announcement-dismissals': 180 * 24 * 60 * 60 * 1_000,
  'course-layout': 180 * 24 * 60 * 60 * 1_000,
  'course-page': 30 * 24 * 60 * 60 * 1_000,
  'external-site': 30 * 24 * 60 * 60 * 1_000,
  'media-playback': 30 * 24 * 60 * 60 * 1_000,
  'static-widget': 30 * 24 * 60 * 60 * 1_000,
  'course-study-set': 30 * 24 * 60 * 60 * 1_000,
  'assessment-navigation': 30 * 24 * 60 * 60 * 1_000,
  'chat-draft': 7 * 24 * 60 * 60 * 1_000,
  'study-session': 7 * 24 * 60 * 60 * 1_000,
};

const MAX_STATE_BYTES = 64 * 1_024;
const MAX_ID_LENGTH = 256;
const MAX_CHAT_DRAFT_LENGTH = 20_000;
const MAX_RESUME_TOKEN_LENGTH = 2_048;
const MAX_LIST_LENGTH = 500;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  !!value && typeof value === 'object' && !Array.isArray(value)
);

const boundedId = (value: unknown, label: string, required = false): string | undefined => {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_ID_LENGTH || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
};

const boundedNumber = (value: unknown, label: string, minimum: number, maximum: number, integer = false): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isInteger(value))) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
};

const boundedIds = (value: unknown, label: string): string[] => {
  if (!Array.isArray(value) || value.length > MAX_LIST_LENGTH) throw new Error(`${label} is invalid.`);
  const ids = value.map(entry => boundedId(entry, label, true)!);
  return Array.from(new Set(ids));
};

export const normalizeLearningStateScope = (scope: LearningStateScope): LearningStateScope => {
  if (!isRecord(scope)) throw new Error('Learning-state scope is invalid.');
  const principalId = boundedId(scope.principalId, 'Learning-state principal', true)!;
  const courseId = boundedId(scope.courseId, 'Learning-state course');
  const contentItemId = boundedId(scope.contentItemId, 'Learning-state content item');
  const threadId = boundedId(scope.threadId, 'Learning-state conversation');
  const deckId = boundedId(scope.deckId, 'Learning-state deck');
  return {
    principalId,
    ...(courseId ? { courseId } : {}),
    ...(contentItemId ? { contentItemId } : {}),
    ...(threadId ? { threadId } : {}),
    ...(deckId ? { deckId } : {}),
  };
};

const requireScope = (scope: LearningStateScope, kind: LearningStateKind) => {
  if (['course-layout', 'course-page'].includes(kind) && !scope.courseId) {
    throw new Error(`${kind} state requires a course scope.`);
  }
  if (['external-site', 'media-playback', 'static-widget', 'course-study-set', 'assessment-navigation'].includes(kind)
    && (!scope.courseId || !scope.contentItemId)) {
    throw new Error(`${kind} state requires course and content-item scope.`);
  }
  if (kind === 'chat-draft' && !scope.threadId) throw new Error('Chat-draft state requires a conversation scope.');
  if (kind === 'study-session' && !scope.deckId) throw new Error('Study-session state requires a deck scope.');
};

export const normalizeLearningStatePayload = <K extends LearningStateKind>(kind: K, value: unknown): LearningStatePayloads[K] => {
  if (!isRecord(value)) throw new Error(`Saved ${kind} state is invalid.`);
  let payload: LearningStatePayloads[LearningStateKind];
  switch (kind) {
    case 'announcement-dismissals':
      payload = { ids: boundedIds(value.ids, 'Announcement dismissal identifiers') };
      break;
    case 'course-layout':
      if (value.viewMode !== 'vertical' && value.viewMode !== 'horizontal') throw new Error('Saved course layout is invalid.');
      payload = { viewMode: value.viewMode };
      break;
    case 'course-page':
      payload = {
        pageId: boundedId(value.pageId, 'Saved course page'),
        verticalOffset: value.verticalOffset === undefined ? undefined : boundedNumber(value.verticalOffset, 'Saved course scroll offset', 0, 10_000_000),
        maximizedWidgetId: value.maximizedWidgetId === null ? null : boundedId(value.maximizedWidgetId, 'Saved expanded widget'),
      };
      break;
    case 'external-site':
      payload = {
        loadedAt: boundedNumber(value.loadedAt, 'External-site load time', 1, Number.MAX_SAFE_INTEGER),
        progress: value.progress === undefined ? undefined : boundedNumber(value.progress, 'External-site progress', 0, 1),
        positionSeconds: value.positionSeconds === undefined ? undefined : boundedNumber(value.positionSeconds, 'External-site position', 0, 10_000_000),
        resumeToken: value.resumeToken === undefined ? undefined : (() => {
          if (typeof value.resumeToken !== 'string' || !value.resumeToken.trim() || value.resumeToken.length > MAX_RESUME_TOKEN_LENGTH || /[\u0000-\u001f\u007f]/.test(value.resumeToken)) {
            throw new Error('External-site resume token is invalid.');
          }
          return value.resumeToken;
        })(),
      };
      break;
    case 'media-playback':
      payload = {
        positionSeconds: boundedNumber(value.positionSeconds, 'Saved media position', 0, 10_000_000),
        durationSeconds: value.durationSeconds === undefined ? undefined : boundedNumber(value.durationSeconds, 'Saved media duration', 0, 10_000_000),
        completed: value.completed === undefined ? undefined : value.completed === true,
      };
      break;
    case 'static-widget':
      if (typeof value.expanded !== 'boolean') throw new Error('Saved widget state is invalid.');
      payload = { expanded: value.expanded };
      break;
    case 'course-study-set':
      if (typeof value.revealed !== 'boolean') throw new Error('Saved study-set state is invalid.');
      payload = {
        cardId: boundedId(value.cardId, 'Saved study card'),
        revealed: value.revealed,
        masteredIds: boundedIds(value.masteredIds, 'Saved mastered-card identifiers'),
      };
      break;
    case 'assessment-navigation':
      payload = { pageIndex: boundedNumber(value.pageIndex, 'Saved assessment page', 0, 10_000, true) };
      break;
    case 'chat-draft':
      if (typeof value.text !== 'string' || value.text.length > MAX_CHAT_DRAFT_LENGTH) throw new Error('Saved chat draft is invalid.');
      payload = {
        text: value.text,
        replyToMessageId: boundedId(value.replyToMessageId, 'Saved reply target'),
        mentionedUserIds: boundedIds(value.mentionedUserIds, 'Saved mention identifiers'),
        clientMessageId: boundedId(value.clientMessageId, 'Saved chat idempotency key', true)!,
      };
      break;
    case 'study-session':
      if (typeof value.revealed !== 'boolean') throw new Error('Saved study-session state is invalid.');
      payload = {
        cardId: boundedId(value.cardId, 'Saved study-session card'),
        revealed: value.revealed,
        depthIndex: boundedNumber(value.depthIndex, 'Saved study-session page', -1, 10_000, true),
      };
      break;
    default:
      throw new Error('Learning-state kind is unsupported.');
  }
  const serialized = JSON.stringify(payload);
  if (serialized.length > MAX_STATE_BYTES) throw new Error('Saved learning state exceeds the 64 KB safety limit.');
  return payload as LearningStatePayloads[K];
};

export const normalizeLearningStateRecord = <K extends LearningStateKind>(value: unknown, expectedScope: LearningStateScope, expectedKind: K): LearningStateRecord<K> => {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.kind !== expectedKind) throw new Error('Saved learning state has an unsupported format.');
  const scope = normalizeLearningStateScope(value.scope as LearningStateScope);
  const expected = normalizeLearningStateScope(expectedScope);
  if (JSON.stringify(scope) !== JSON.stringify(expected)) throw new Error('Saved learning state belongs to a different scope.');
  requireScope(scope, expectedKind);
  const updatedAt = boundedNumber(value.updatedAt, 'Saved learning-state update time', 1, Number.MAX_SAFE_INTEGER);
  const expiresAt = boundedNumber(value.expiresAt, 'Saved learning-state expiry', updatedAt, Number.MAX_SAFE_INTEGER);
  const writeId = boundedId(value.writeId, 'Saved learning-state write identifier', true)!;
  return {
    schemaVersion: 1,
    scope,
    kind: expectedKind,
    payload: normalizeLearningStatePayload(expectedKind, value.payload),
    updatedAt,
    expiresAt,
    writeId,
  };
};

export const learningStateStorageKey = (scope: LearningStateScope, kind: LearningStateKind): string => {
  const normalized = normalizeLearningStateScope(scope);
  requireScope(normalized, kind);
  const parts = [kind, normalized.principalId, normalized.courseId, normalized.contentItemId, normalized.threadId, normalized.deckId]
    .map(value => encodeURIComponent(value ?? '-'));
  return `@lms_learning_state:v1:${parts.join(':')}`;
};

export const createLearningStateRecord = <K extends LearningStateKind>(
  scope: LearningStateScope,
  kind: K,
  payload: LearningStatePayloads[K],
  writeId = createEntityId('learning-state'),
  updatedAt = Date.now(),
): LearningStateRecord<K> => {
  const normalizedScope = normalizeLearningStateScope(scope);
  requireScope(normalizedScope, kind);
  const normalizedTime = boundedNumber(updatedAt, 'Learning-state update time', 1, Number.MAX_SAFE_INTEGER);
  const record: LearningStateRecord<K> = {
    schemaVersion: 1,
    scope: normalizedScope,
    kind,
    payload: normalizeLearningStatePayload(kind, payload),
    updatedAt: normalizedTime,
    expiresAt: normalizedTime + LEARNING_STATE_RETENTION_MS[kind],
    writeId: boundedId(writeId, 'Learning-state write identifier', true)!,
  };
  if (JSON.stringify(record).length > MAX_STATE_BYTES) throw new Error('Saved learning state exceeds the 64 KB safety limit.');
  return record;
};

export class LocalLearningStateService implements LearningStateService {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly storage: LearningStateKeyValueStorage = AsyncStorage,
    private readonly now: () => number = Date.now,
  ) {}

  async load<K extends LearningStateKind>(scope: LearningStateScope, kind: K): Promise<LearningStateRecord<K> | null> {
    await this.writeQueue.catch(() => undefined);
    const key = learningStateStorageKey(scope, kind);
    const serialized = await this.storage.getItem(key);
    if (!serialized) return null;
    if (serialized.length > MAX_STATE_BYTES) {
      await this.storage.removeItem(key);
      throw new Error('Saved learning state exceeded its storage limit and was erased.');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(serialized);
    } catch {
      await this.storage.removeItem(key);
      throw new Error('Saved learning state was corrupt and was erased.');
    }
    let record: LearningStateRecord<K>;
    try {
      record = normalizeLearningStateRecord(parsed, scope, kind);
    } catch (error) {
      await this.storage.removeItem(key);
      throw error;
    }
    if (record.expiresAt <= this.now()) {
      await this.storage.removeItem(key);
      return null;
    }
    return record;
  }

  async save<K extends LearningStateKind>(scope: LearningStateScope, kind: K, payload: LearningStatePayloads[K], writeId = createEntityId('learning-state')): Promise<LearningStateRecord<K>> {
    const record = createLearningStateRecord(scope, kind, payload, writeId, this.now());
    const serialized = JSON.stringify(record);
    const key = learningStateStorageKey(record.scope, kind);
    const operation = this.writeQueue.catch(() => undefined).then(() => this.storage.setItem(key, serialized));
    this.writeQueue = operation;
    await operation;
    return record;
  }

  async remove(scope: LearningStateScope, kind: LearningStateKind): Promise<void> {
    const key = learningStateStorageKey(scope, kind);
    const operation = this.writeQueue.catch(() => undefined).then(() => this.storage.removeItem(key));
    this.writeQueue = operation;
    await operation;
  }
}

const isDevelopmentBuild = typeof __DEV__ !== 'undefined'
  ? __DEV__
  : process.env.NODE_ENV !== 'production';

const unconfiguredProductionService: LearningStateService = {
  async load() { throw new Error('Institution learning-state storage is not configured.'); },
  async save() { throw new Error('Institution learning-state storage is not configured.'); },
  async remove() { throw new Error('Institution learning-state storage is not configured.'); },
};

let learningStateService: LearningStateService = isDevelopmentBuild
  ? new LocalLearningStateService()
  : unconfiguredProductionService;
let activityConsentProvider: ((scope: LearningStateScope) => Promise<LearningActivityConsent>) | null = null;

export const getLearningStateService = () => learningStateService;

export const configureLearningStateService = (
  service: LearningStateService,
  consentProvider?: (scope: LearningStateScope) => Promise<LearningActivityConsent>,
) => {
  if (!service?.load || !service?.save || !service?.remove) throw new Error('A complete learning-state service is required.');
  learningStateService = service;
  activityConsentProvider = consentProvider ?? null;
};

export const recordConsentedLearningActivity = async (
  input: Omit<LearningActivityEvent, 'schemaVersion' | 'eventId' | 'consentNoticeVersion'>,
): Promise<boolean> => {
  if (!learningStateService.recordActivity || !activityConsentProvider) return false;
  const scope = normalizeLearningStateScope(input.scope);
  const consent = await activityConsentProvider(scope);
  if (!consent.granted || !consent.noticeVersion.trim() || consent.noticeVersion.length > 256) return false;
  const event: LearningActivityEvent = {
    ...input,
    schemaVersion: 1,
    eventId: createEntityId('activity'),
    scope,
    consentNoticeVersion: consent.noticeVersion,
  };
  boundedNumber(event.occurredAt, 'Learning activity time', 1, Number.MAX_SAFE_INTEGER);
  if (event.progress !== undefined) boundedNumber(event.progress, 'Learning activity progress', 0, 1);
  if (event.positionSeconds !== undefined) boundedNumber(event.positionSeconds, 'Learning activity position', 0, 10_000_000);
  await learningStateService.recordActivity(event);
  return true;
};
