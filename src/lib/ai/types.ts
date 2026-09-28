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
}

export interface SyllabusEvidence {
  field: string;
  sourceExcerpt: string;
  sourceLocation?: string;
}

export interface SyllabusExtraction {
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
  generateFlashcards(input: AIGenerationInput): Promise<GeneratedFlashcard[]>;
  extractSyllabus(input: AIGenerationInput): Promise<SyllabusExtraction>;
}
