/**
 * @fileoverview src/lib/externalSiteSecurity.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
/**
 * External course sites execute in an opaque sandbox origin. In particular,
 * never combine allow-scripts with allow-same-origin: a cross-origin site can
 * redirect the frame back to the LMS origin and then escape that sandbox.
 */
export const EXTERNAL_SITE_SANDBOX = [
  'allow-forms',
  'allow-modals',
  'allow-popups',
  'allow-presentation',
  'allow-scripts',
].join(' ');

export interface ExternalSiteBridgeConfiguration {
  protocol: 'lms-embed-state-v1';
  origin: string;
  capabilities: ('resume' | 'progress')[];
  privacyNotice: string;
}

export interface ExternalSiteProgressMessage {
  type: 'lms.embed.progress.v1';
  contentItemId: string;
  messageId: string;
  progress?: number;
  positionSeconds?: number;
  resumeToken?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  !!value && typeof value === 'object' && !Array.isArray(value)
);

const boundedBridgeText = (value: unknown, maximum: number): string | null => (
  typeof value === 'string'
  && Boolean(value.trim())
  && value.length <= maximum
  && !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : null
);

/**
 * Opt-in provider contract. A generic iframe does not gain this capability:
 * the configured exact origin must match the embedded URL and explicitly
 * advertise only the supported, privacy-reviewed state fields.
 */
export const getExternalSiteBridgeConfiguration = (
  metadata: Record<string, unknown> | undefined,
  safeUrl: string,
): ExternalSiteBridgeConfiguration | null => {
  const candidate = metadata?.lmsEmbedBridge;
  if (!isRecord(candidate) || candidate.protocol !== 'lms-embed-state-v1') return null;
  const origin = boundedBridgeText(candidate.origin, 2_048);
  const privacyNotice = boundedBridgeText(candidate.privacyNotice, 1_000);
  if (!origin || !privacyNotice) return null;
  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(safeUrl).origin;
    if (new URL(origin).origin !== origin || origin !== expectedOrigin) return null;
  } catch {
    return null;
  }
  if (!Array.isArray(candidate.capabilities) || candidate.capabilities.length > 2) return null;
  const capabilities = Array.from(new Set(candidate.capabilities));
  if (capabilities.some(capability => capability !== 'resume' && capability !== 'progress')) return null;
  return {
    protocol: 'lms-embed-state-v1',
    origin,
    capabilities: capabilities as ExternalSiteBridgeConfiguration['capabilities'],
    privacyNotice,
  };
};

export const normalizeExternalSiteProgressMessage = (
  value: unknown,
  contentItemId: string,
): ExternalSiteProgressMessage | null => {
  if (!isRecord(value) || value.type !== 'lms.embed.progress.v1' || value.contentItemId !== contentItemId) return null;
  const messageId = boundedBridgeText(value.messageId, 256);
  if (!messageId) return null;
  const progress = value.progress;
  const positionSeconds = value.positionSeconds;
  const resumeToken = value.resumeToken;
  if (progress !== undefined && (typeof progress !== 'number' || !Number.isFinite(progress) || progress < 0 || progress > 1)) return null;
  if (positionSeconds !== undefined && (typeof positionSeconds !== 'number' || !Number.isFinite(positionSeconds) || positionSeconds < 0 || positionSeconds > 10_000_000)) return null;
  const normalizedToken = resumeToken === undefined ? undefined : boundedBridgeText(resumeToken, 2_048);
  if (resumeToken !== undefined && !normalizedToken) return null;
  if (progress === undefined && positionSeconds === undefined && normalizedToken === undefined) return null;
  return {
    type: 'lms.embed.progress.v1',
    contentItemId,
    messageId,
    progress: progress as number | undefined,
    positionSeconds: positionSeconds as number | undefined,
    resumeToken: normalizedToken ?? undefined,
  };
};

/** Explicit Permissions Policy delegation; every sensitive capability stays off. */
export const EXTERNAL_SITE_ALLOW = 'fullscreen';
