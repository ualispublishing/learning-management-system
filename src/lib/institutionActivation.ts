/**
 * @fileoverview src/lib/institutionActivation.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
export type ActivationOrganizationType = 'education' | 'business';
export type ActivationRegion = 'canada' | 'united-states' | 'european-union' | 'other';
export type ActivationIdentityProvider = 'oidc' | 'saml';
export type ActivationDataSource = 'oneroster' | 'existing-lms' | 'hris' | 'secure-csv';

export const INSTITUTION_ACTIVATION_STORAGE_KEY = '@lms_institution_activation_demo:v1';

export const ACTIVATION_STEPS = [
  { id: 'organization', shortLabel: 'Organization', title: 'Organization and deployment owner' },
  { id: 'identity', shortLabel: 'Identity', title: 'Connect institutional identity' },
  { id: 'data', shortLabel: 'Learning data', title: 'Choose the authoritative data source' },
  { id: 'governance', shortLabel: 'Governance', title: 'Assign launch accountability' },
  { id: 'preflight', shortLabel: 'Pilot check', title: 'Verify the pilot workspace' },
  { id: 'activate', shortLabel: 'Activate', title: 'Approve the pilot handoff' },
] as const;

export type ActivationStepId = typeof ACTIVATION_STEPS[number]['id'];

export interface InstitutionActivationDraft {
  version: 1;
  stepIndex: number;
  organizationType: ActivationOrganizationType;
  organizationName: string;
  ownerName: string;
  ownerEmail: string;
  region: ActivationRegion;
  identityProvider: ActivationIdentityProvider;
  identityDomain: string;
  dataSource: ActivationDataSource;
  pilotCohortSize: 50 | 250 | 1000;
  securityOwnerConfirmed: boolean;
  privacyOwnerConfirmed: boolean;
  accessibilityOwnerConfirmed: boolean;
  preflightCompleted: boolean;
  activated: boolean;
  updatedAt: number;
}

export const createInstitutionActivationDraft = (): InstitutionActivationDraft => ({
  version: 1,
  stepIndex: 0,
  organizationType: 'education',
  organizationName: '',
  ownerName: '',
  ownerEmail: '',
  region: 'canada',
  identityProvider: 'oidc',
  identityDomain: '',
  dataSource: 'oneroster',
  pilotCohortSize: 250,
  securityOwnerConfirmed: false,
  privacyOwnerConfirmed: false,
  accessibilityOwnerConfirmed: false,
  preflightCompleted: false,
  activated: false,
  updatedAt: 0,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const isChoice = <T extends string>(value: unknown, choices: readonly T[]): value is T =>
  typeof value === 'string' && choices.includes(value as T);

export const normalizeActivationStepIndex = (value: unknown) => {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0;
  return Math.max(0, Math.min(numeric, ACTIVATION_STEPS.length - 1));
};

export const parseInstitutionActivationDraft = (value: unknown): InstitutionActivationDraft | null => {
  if (!isRecord(value) || value.version !== 1) return null;
  const defaults = createInstitutionActivationDraft();
  const pilotCohortSize = [50, 250, 1000].includes(Number(value.pilotCohortSize))
    ? Number(value.pilotCohortSize) as 50 | 250 | 1000
    : defaults.pilotCohortSize;
  const organizationType = isChoice(value.organizationType, ['education', 'business']) ? value.organizationType : defaults.organizationType;
  const requestedDataSource = isChoice(value.dataSource, ['oneroster', 'existing-lms', 'hris', 'secure-csv']) ? value.dataSource : defaults.dataSource;
  const dataSource = organizationType === 'education' && requestedDataSource === 'hris'
    ? 'oneroster'
    : organizationType === 'business' && requestedDataSource === 'oneroster'
      ? 'hris'
      : requestedDataSource;
  return {
    ...defaults,
    stepIndex: normalizeActivationStepIndex(value.stepIndex),
    organizationType,
    organizationName: typeof value.organizationName === 'string' ? value.organizationName.slice(0, 120) : '',
    ownerName: typeof value.ownerName === 'string' ? value.ownerName.slice(0, 120) : '',
    ownerEmail: typeof value.ownerEmail === 'string' ? value.ownerEmail.slice(0, 254) : '',
    region: isChoice(value.region, ['canada', 'united-states', 'european-union', 'other']) ? value.region : defaults.region,
    identityProvider: isChoice(value.identityProvider, ['oidc', 'saml']) ? value.identityProvider : defaults.identityProvider,
    identityDomain: typeof value.identityDomain === 'string' ? value.identityDomain.slice(0, 2048) : '',
    dataSource,
    pilotCohortSize,
    securityOwnerConfirmed: value.securityOwnerConfirmed === true,
    privacyOwnerConfirmed: value.privacyOwnerConfirmed === true,
    accessibilityOwnerConfirmed: value.accessibilityOwnerConfirmed === true,
    preflightCompleted: value.preflightCompleted === true,
    activated: value.activated === true,
    updatedAt: typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt) ? Math.max(0, value.updatedAt) : 0,
  };
};

const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

const validHttpsEndpoint = (value: string) => {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:'
      && !!url.hostname
      && !url.username
      && !url.password
      && !url.hash;
  } catch {
    return false;
  }
};

export const getActivationStepError = (draft: InstitutionActivationDraft, stepIndex = draft.stepIndex): string | null => {
  const step = ACTIVATION_STEPS[normalizeActivationStepIndex(stepIndex)];
  if (step.id === 'organization') {
    if (draft.organizationName.trim().length < 2) return 'Enter the institution or business name.';
    if (draft.ownerName.trim().length < 2) return 'Enter the deployment owner’s name.';
    if (!validEmail(draft.ownerEmail)) return 'Enter a valid work email for the deployment owner.';
  }
  if (step.id === 'identity' && !validHttpsEndpoint(draft.identityDomain)) {
    return 'Enter the credential-free HTTPS issuer or metadata URL supplied by the identity team.';
  }
  if (step.id === 'governance' && !(
    draft.securityOwnerConfirmed
    && draft.privacyOwnerConfirmed
    && draft.accessibilityOwnerConfirmed
  )) {
    return 'Assign security, privacy, and accessibility owners before continuing.';
  }
  if (step.id === 'preflight' && !draft.preflightCompleted) {
    return 'Run the pilot checks before reviewing activation.';
  }
  return null;
};

export const buildTenantPreview = (organizationName: string) => {
  const base = organizationName
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42);
  return base || 'organization';
};

export const ACTIVATION_PREFLIGHT_CHECKS = [
  'Organization and deployment owner recorded',
  'Identity configuration is tenant-bound',
  'Authoritative learning-data source selected',
  'Pilot cohort is intentionally bounded',
  'Security, privacy, and accessibility owners assigned',
  'Production acceptance remains gated from this demo',
] as const;
