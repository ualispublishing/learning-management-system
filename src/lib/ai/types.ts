/**
 * @fileoverview src/lib/ai/types.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
export interface AIDocumentAsset {
  uri: string;
  name: string;
  mimeType?: string;
  size?: number;
  /** Browser File/Blob bytes supplied by Expo pickers for multipart upload. */
  file?: Blob;
  /** Optional hint; the service still verifies extension and MIME type. */
  kind?: 'document' | 'captions' | 'audio' | 'video';
}

export interface AIGenerationInput {
  /** Stable course scope for server authorization; a title never grants access. */
  courseId?: string;
  sourceText?: string;
  document?: AIDocumentAsset;
  courseTitle?: string;
  locale?: string;
  requestedCardCount?: number;
}

export interface GeneratedFlashcard {
  id: string;
  front: string;
  back: string;
  sourceExcerpt: string;
  sourceLocation?: string;
  confidence: number;
  tags?: string[];
  reviewerEdited?: boolean;
  reviewerVerified?: boolean;
  provenance?: AIProvenance;
}

export interface AIProvenance {
  promptVersion: string;
  evidenceVerified: true;
  /** SHA-256 of the complete canonical source envelope processed by the AI service. */
  sourceSha256: string;
  /** SHA-256 of the exact uploaded file bytes, required whenever a document was supplied. */
  documentSha256?: string;
  requestId?: string;
  model?: string;
  /** Historical authoring, attached by the prepared server after checking the source/result record. */
  preparedGeneration?: PreparedAIGeneration;
  /** Bounded extraction notices supplied by the gateway, never by generated task JSON. */
  sourceReviewNotices?: string[];
}

export interface PreparedAIGeneration {
  authoringTool: string;
  preparedOn: string;
  model: string | null;
  reasoningEffort?: string;
  contextMode?: 'isolated-agent';
  enrichmentNote?: string;
  recordSha256: string;
}

export interface SyllabusEvidence {
  field: string;
  sourceExcerpt: string;
  sourceLocation?: string;
}

export interface SyllabusExtraction {
  courseCode?: string;
  courseDuration?: string;
  intendedAudience?: string;
  learningObjectives?: string[];
  meetingTimes?: string[];
  title?: string;
  description?: string;
  termStart?: string;
  termEnd?: string;
  gradingWeights?: Record<string, number>;
  instructorNames?: string[];
  schedule?: { date?: string; topic: string }[];
  requiredMaterials?: string[];
  policies?: { name: string; text: string }[];
  evidence: SyllabusEvidence[];
  warnings: string[];
  provenance?: AIProvenance;
}

export interface AIService {
  /** Declared by the integration, never inferred from the selected vendor/model. */
  sourceProfile?: 'text-v1';
  generateFlashcards(input: AIGenerationInput): Promise<GeneratedFlashcard[]>;
  extractSyllabus(input: AIGenerationInput): Promise<SyllabusExtraction>;
  /** Explicit opt-in for authenticated, source-matched recovery after a reload. */
  requestHistory?: AIRequestHistory;
}

export interface AIRequestHistoryItem {
  id: string;
  requestId: string;
  courseId: string;
  task: 'flashcards' | 'syllabus';
  status: 'processing' | 'succeeded' | 'uncertain';
  createdAt: number;
  expiresAt: number;
  fileName: string | null;
  hasPastedText: boolean;
  locale: string;
  requestedCardCount: number;
}
export interface AIRequestHistoryPage { items: AIRequestHistoryItem[]; nextCursor: string | null }
export interface AIRequestHistory {
  list(task: AIRequestHistoryItem['task'], courseId: string, cursor?: string): Promise<AIRequestHistoryPage>;
  /** Must never invoke generation, including on missing/expired requests. */
  recover(task: AIRequestHistoryItem['task'], input: AIGenerationInput, requestId: string): Promise<unknown>;
}
