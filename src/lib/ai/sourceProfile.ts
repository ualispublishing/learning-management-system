import type { AIGenerationInput, AIService } from './types';

type Task = 'flashcards' | 'syllabus';
export const TEXT_AI_SOURCE_BYTES = 2_000_000;
const documents = ['txt', 'md'];
const captions = ['vtt', 'srt'];

/** Conservative client bound leaves multipart overhead below the gateway limit. */
export function assertAISourceProfile(input: AIGenerationInput, task: Task, profile: AIService['sourceProfile']) {
  if (profile === undefined) return;
  if (profile !== 'text-v1') throw new Error('The AI source profile is not supported. Contact your institution administrator.');
  const file = input.document;
  if (file) {
    const extension = file.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
    if (!extension || ![...documents, ...(task === 'flashcards' ? captions : [])].includes(extension)) {
      throw new Error(task === 'flashcards'
        ? 'This AI service accepts TXT, Markdown, VTT or SRT files. Export document text or provide a transcript/caption file before generating cards.'
        : 'This AI service accepts TXT or Markdown syllabi. Export your syllabus as text before analysis.');
    }
  }
  const size = file?.file?.size ?? file?.size;
  if (file && (size === undefined || !Number.isSafeInteger(size) || size <= 0)) throw new Error('Select a nonempty source file with a known size.');
  // Multipart text fields normalize line breaks to CRLF on the wire.
  const text = (input.sourceText?.trim() ?? '').replace(/\r\n|\r|\n/g, '\r\n');
  if (text.length > 500_000) throw new Error('This AI service accepts at most 500,000 characters of pasted text.');
  if ((size ?? 0) + new TextEncoder().encode(text).byteLength > TEXT_AI_SOURCE_BYTES) throw new Error('This AI service accepts at most 2 MB (2,000,000 bytes) of source files and pasted text combined. Choose a smaller source.');
}

export function sourceProfileDescription(task: Task, profile: AIService['sourceProfile'], prepared: boolean): string {
  if (profile === 'text-v1') return task === 'flashcards'
    ? 'Connected AI service: TXT and Markdown notes, VTT/SRT captions, or pasted text. Limit: 2 MB combined; pasted text up to 500,000 characters. Use a transcript for audio or video.'
    : 'Connected AI service: TXT or Markdown syllabus, up to 2 MB. Export PDF, Word or PowerPoint text before importing.';
  if (prepared) return 'Prepared demo: use the bundled source files for their saved results. Other files do not have pre-generated responses.';
  return 'Accepted file formats and limits depend on your institution’s AI service. Confirm its supported formats before submitting material.';
}

export function sourceProfilePickerTypes(task: Task, profile: AIService['sourceProfile']): string[] {
  if (profile === 'text-v1') return ['text/plain', 'text/markdown', ...(task === 'flashcards' ? ['text/vtt', 'application/x-subrip'] : [])];
  return ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'text/plain', 'text/markdown', 'application/rtf', 'text/rtf'];
}
