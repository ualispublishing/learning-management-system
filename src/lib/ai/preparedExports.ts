import { SYLLABUS_RESPONSE_SCHEMA } from './prompts';
import type { AIProvenance, GeneratedFlashcard, SyllabusExtraction } from './types';
import { mapSyllabusToCourse } from './syllabusCourseMapping';
import { preparedGenerationAttribution, type PreparedDemoGeneration } from './preparedDemo';

export type PreparedShowcaseResult = { task: 'syllabus'; syllabus: SyllabusExtraction } | { task: 'flashcards'; cards: GeneratedFlashcard[] };
export type PreparedExportFormat = 'result' | 'syllabus' | 'course' | 'schema';

// Portable drafts retain source attestation, without transient request/card IDs.
function portableProvenance(value?: AIProvenance) {
  if (!value) return undefined;
  return { promptVersion: value.promptVersion, evidenceVerified: value.evidenceVerified, sourceSha256: value.sourceSha256, documentSha256: value.documentSha256, model: value.model, preparedGeneration: value.preparedGeneration };
}

export function preparedExport(result: PreparedShowcaseResult, format: PreparedExportFormat, generation?: PreparedDemoGeneration) {
  const syllabus = result.task === 'syllabus' ? { ...result.syllabus, provenance: portableProvenance(result.syllabus.provenance) } : undefined;
  if (format !== 'result' && !syllabus) throw new Error('Syllabus exports require a syllabus result.');
  if (format === 'schema') return { name: 'syllabus-extraction.schema.json', type: 'application/schema+json; charset=utf-8', text: JSON.stringify(SYLLABUS_RESPONSE_SCHEMA, null, 2) };
  if (format === 'syllabus' && syllabus) return { name: 'updated-syllabus-draft.md', type: 'text/markdown; charset=utf-8', text: syllabusDraftMarkdown(syllabus, generation) };
  const attribution = 'Adapted from MIT OpenCourseWare, 6.0001, Fall 2016, Ana Bell, Eric Grimson and John Guttag. CC BY-NC-SA 4.0. No MIT endorsement. Commercial permission is not included.';
  const common = { mode: 'prepared-demo', humanReview: 'pending', generation, generationNote: preparedGenerationAttribution(generation), attribution };
  if (format === 'course' && syllabus) {
    const mapped = mapSyllabusToCourse(syllabus, { title: 'Untitled example course', description: '', termStart: 0, termEnd: 0, gradingWeights: {} });
    return { name: 'course-import-preview.json', type: 'application/json; charset=utf-8', text: JSON.stringify({ ...common, ...mapped, courseFields: { ...mapped.courseFields, termStart: syllabus.termStart ? mapped.courseFields.termStart : undefined, termEnd: syllabus.termEnd ? mapped.courseFields.termEnd : undefined, gradingWeights: syllabus.gradingWeights }, omittedFields: 'Keep existing course values; configure missing values after instructor review.' }, null, 2) };
  }
  const value = syllabus ? { task: 'syllabus', syllabus } : { task: 'flashcards', cards: result.task === 'flashcards' ? result.cards.map(card => ({ front: card.front, back: card.back, sourceExcerpt: card.sourceExcerpt, sourceLocation: card.sourceLocation, confidence: card.confidence, tags: card.tags, reviewerVerified: false, provenance: portableProvenance(card.provenance) })) : [] };
  return { name: `${result.task}-result.json`, type: 'application/json; charset=utf-8', text: JSON.stringify({ ...common, ...value }, null, 2) };
}

export function syllabusDraftMarkdown(value: SyllabusExtraction, generation?: PreparedDemoGeneration): string {
  return [
    `# ${value.title || 'Course syllabus'}`, '**Prepared demo draft — instructor review required.**',
    value.description || '',
    ...(value.courseCode ? ['## Course code', value.courseCode] : []),
    ...(value.courseDuration ? ['## Course duration', value.courseDuration] : []),
    ...(value.intendedAudience ? ['## Intended audience', value.intendedAudience] : []),
    ...(value.meetingTimes?.length ? ['## Meeting times', ...value.meetingTimes.map(entry => `- ${entry}`)] : []),
    ...(value.learningObjectives?.length ? ['## Learning objectives', ...value.learningObjectives.map(entry => `- ${entry}`)] : []),
    '## Instructors', ...(value.instructorNames || []).map(name => `- ${name}`),
    '## Session schedule', ...(value.schedule || []).map((entry, index) => `${index + 1}. ${entry.topic}${entry.date ? ` (${entry.date})` : ' — date to be confirmed'}`),
    '## Required materials', ...(value.requiredMaterials || []).map(material => `- ${material}`),
    '## Policies', ...(value.policies || []).map(policy => `### ${policy.name}\n\n${policy.text}`),
    '## Items requiring review', ...value.warnings.map(warning => `- ${warning}`),
    '## Source evidence', ...value.evidence.map(item => `- **${item.field}** — ${item.sourceLocation || 'Source'}\n  > ${item.sourceExcerpt}`),
    '## Generation', preparedGenerationAttribution(generation),
    '## Attribution', 'Adapted from MIT OpenCourseWare, 6.0001, Fall 2016, by Ana Bell, Eric Grimson and John Guttag. CC BY-NC-SA 4.0. No MIT endorsement. Commercial permission is not included.',
    'https://ocw.mit.edu/courses/6-0001-introduction-to-computer-science-and-programming-in-python-fall-2016/', '',
  ].join('\n\n');
}
