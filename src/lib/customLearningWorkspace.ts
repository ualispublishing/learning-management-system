/**
 * @fileoverview src/lib/customLearningWorkspace.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
export const CUSTOM_LEARNING_WORKSPACE_KIND = 'code-lab-v1' as const;

export type LearningMilestoneStatus = 'complete' | 'current' | 'up-next';

export interface CustomLearningWorkspace {
  kind: typeof CUSTOM_LEARNING_WORKSPACE_KIND;
  eyebrow: string;
  title: string;
  summary: string;
  language: string;
  challenge: {
    title: string;
    prompt: string;
    starterCode: string;
    expectedTokens: string[];
    hint: string;
  };
  snippet: {
    title: string;
    code: string;
    note: string;
  };
  visualization: {
    title: string;
    description: string;
    labels: string[];
    values: number[];
  };
  milestones: {
    label: string;
    status: LearningMilestoneStatus;
  }[];
}

const MAX_PAYLOAD_CHARACTERS = 64_000;
const MAX_CODE_CHARACTERS = 8_000;
const UNSAFE_DISPLAY_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const readBoundedString = (
  value: unknown,
  maximum: number,
  options: { multiline?: boolean } = {},
): string | null => {
  if (typeof value !== 'string' || value.length > maximum) return null;
  const withoutControls = value.replace(UNSAFE_DISPLAY_CONTROLS, '');
  const normalized = options.multiline
    ? withoutControls.replace(/\r\n?/g, '\n').trim()
    : withoutControls.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return normalized || null;
};

/**
 * Projects an institution-authored JSON payload into one reviewed, host-owned
 * learning experience. Unknown keys are ignored and every rendered value is
 * type/size bounded. No payload field is interpreted as HTML, CSS, a URL, or
 * executable code.
 */
export const parseCustomLearningWorkspace = (description?: string): CustomLearningWorkspace | null => {
  if (!description || description.length > MAX_PAYLOAD_CHARACTERS || !description.trim().startsWith('{')) return null;

  try {
    const payload: unknown = JSON.parse(description);
    if (!isRecord(payload) || payload.isCustomWidget !== true || !isRecord(payload.workspace)) return null;
    const workspace = payload.workspace;
    if (workspace.kind !== CUSTOM_LEARNING_WORKSPACE_KIND) return null;
    if (!isRecord(workspace.challenge) || !isRecord(workspace.snippet) || !isRecord(workspace.visualization)) return null;

    const eyebrow = readBoundedString(workspace.eyebrow, 120);
    const title = readBoundedString(workspace.title, 160);
    const summary = readBoundedString(workspace.summary, 600);
    const language = readBoundedString(workspace.language, 40);
    const challengeTitle = readBoundedString(workspace.challenge.title, 160);
    const challengePrompt = readBoundedString(workspace.challenge.prompt, 1_500, { multiline: true });
    const starterCode = readBoundedString(workspace.challenge.starterCode, MAX_CODE_CHARACTERS, { multiline: true });
    const hint = readBoundedString(workspace.challenge.hint, 500, { multiline: true });
    const snippetTitle = readBoundedString(workspace.snippet.title, 160);
    const snippetCode = readBoundedString(workspace.snippet.code, MAX_CODE_CHARACTERS, { multiline: true });
    const snippetNote = readBoundedString(workspace.snippet.note, 500, { multiline: true });
    const visualizationTitle = readBoundedString(workspace.visualization.title, 160);
    const visualizationDescription = readBoundedString(workspace.visualization.description, 500, { multiline: true });

    if (
      !eyebrow || !title || !summary || !language
      || !challengeTitle || !challengePrompt || !starterCode || !hint
      || !snippetTitle || !snippetCode || !snippetNote
      || !visualizationTitle || !visualizationDescription
    ) return null;

    const expectedTokens = Array.isArray(workspace.challenge.expectedTokens)
      ? workspace.challenge.expectedTokens.map(value => readBoundedString(value, 80, { multiline: true }))
      : [];
    if (
      expectedTokens.length < 1
      || expectedTokens.length > 8
      || expectedTokens.some(value => value === null)
    ) return null;

    const labels = Array.isArray(workspace.visualization.labels)
      ? workspace.visualization.labels.map(value => readBoundedString(value, 40))
      : [];
    const values = Array.isArray(workspace.visualization.values) ? workspace.visualization.values : [];
    if (
      labels.length < 3
      || labels.length > 8
      || labels.some(value => value === null)
      || values.length !== labels.length
      || values.some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100)
    ) return null;

    const milestones = Array.isArray(workspace.milestones) ? workspace.milestones : [];
    if (milestones.length < 2 || milestones.length > 6) return null;
    const parsedMilestones = milestones.map(entry => {
      if (!isRecord(entry)) return null;
      const label = readBoundedString(entry.label, 100);
      const status = entry.status;
      if (!label || (status !== 'complete' && status !== 'current' && status !== 'up-next')) return null;
      return { label, status };
    });
    if (parsedMilestones.some(value => value === null)) return null;

    return {
      kind: CUSTOM_LEARNING_WORKSPACE_KIND,
      eyebrow,
      title,
      summary,
      language,
      challenge: {
        title: challengeTitle,
        prompt: challengePrompt,
        starterCode,
        expectedTokens: expectedTokens as string[],
        hint,
      },
      snippet: {
        title: snippetTitle,
        code: snippetCode,
        note: snippetNote,
      },
      visualization: {
        title: visualizationTitle,
        description: visualizationDescription,
        labels: labels as string[],
        values: values as number[],
      },
      milestones: parsedMilestones as CustomLearningWorkspace['milestones'],
    };
  } catch {
    return null;
  }
};

export interface WorkspaceSolutionResult {
  passed: boolean;
  missingTokens: string[];
  message: string;
}

/** Static source checks only: learner code is deliberately never evaluated. */
export const evaluateWorkspaceSolution = (
  workspace: CustomLearningWorkspace,
  source: string,
): WorkspaceSolutionResult => {
  if (source.length > MAX_CODE_CHARACTERS) {
    return {
      passed: false,
      missingTokens: [],
      message: `Keep the solution under ${MAX_CODE_CHARACTERS.toLocaleString()} characters. Nothing was executed.`,
    };
  }
  const normalizedSource = source.replace(/\r\n?/g, '\n');
  const missingTokens = workspace.challenge.expectedTokens.filter(token => !normalizedSource.includes(token));
  return missingTokens.length
    ? {
      passed: false,
      missingTokens,
      message: `Static check needs ${missingTokens.length} more required pattern${missingTokens.length === 1 ? '' : 's'}. Nothing was executed.`,
    }
    : {
      passed: true,
      missingTokens: [],
      message: 'All required patterns are present. Nothing was executed or sent over the network.',
    };
};
