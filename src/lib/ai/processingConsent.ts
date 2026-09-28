/**
 * @fileoverview src/lib/ai/processingConsent.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
export interface AIProcessingAttestation {
  sourceRightsAttested: true;
  sourceRightsAttestedAt: string;
}

export interface AIRequestSessionState {
  revision: number;
  inFlight: number | null;
}

export const createAIProcessingAttestation = (now: Date = new Date()): AIProcessingAttestation => {
  if (!Number.isFinite(now.getTime())) {
    throw new Error('AI processing acknowledgement requires a valid timestamp.');
  }
  return {
    sourceRightsAttested: true,
    sourceRightsAttestedAt: now.toISOString(),
  };
};

export const isAIProcessingAttestation = (value: unknown): value is AIProcessingAttestation => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const parsedTimestamp = typeof record.sourceRightsAttestedAt === 'string'
    ? Date.parse(record.sourceRightsAttestedAt)
    : Number.NaN;
  return record.sourceRightsAttested === true
    && typeof record.sourceRightsAttestedAt === 'string'
    && Number.isFinite(parsedTimestamp)
    && new Date(parsedTimestamp).toISOString() === record.sourceRightsAttestedAt;
};

export const runAttestedAIRequest = async <Result>(
  attestation: unknown,
  request: () => Promise<Result>,
): Promise<Result> => {
  if (!isAIProcessingAttestation(attestation)) {
    throw new Error('Confirm source rights and AI processing before generation.');
  }
  return request();
};

export const attachAIProcessingAttestation = <Metadata extends Record<string, unknown>>(
  metadata: Metadata,
  attestation: unknown,
): Metadata & AIProcessingAttestation => {
  if (!isAIProcessingAttestation(attestation)) {
    throw new Error('A valid AI processing acknowledgement is required before publishing generated content.');
  }
  return {
    ...metadata,
    sourceRightsAttested: true,
    sourceRightsAttestedAt: attestation.sourceRightsAttestedAt,
  };
};

export const createAIRequestSessionState = (): AIRequestSessionState => ({
  revision: 0,
  inFlight: null,
});

export const resetAIRequestSession = (state: AIRequestSessionState): void => {
  state.revision += 1;
  state.inFlight = null;
};

export const beginAIRequestSession = (state: AIRequestSessionState): number | null => {
  if (state.inFlight !== null) return null;
  state.revision += 1;
  state.inFlight = state.revision;
  return state.inFlight;
};

export const isCurrentAIRequestSession = (state: AIRequestSessionState, session: number): boolean => (
  state.revision === session
);

export const completeAIRequestSession = (state: AIRequestSessionState, session: number): boolean => {
  const isCurrent = isCurrentAIRequestSession(state, session);
  if (state.inFlight === session) state.inFlight = null;
  return isCurrent;
};
