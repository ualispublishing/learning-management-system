import { InstitutionAIService } from './service';
import { loadPreparedSource, preparedDemoBaseUrl, type PreparedDemoSource } from './preparedDemo';
import type { SyllabusExtraction } from './types';
import type { PreparedShowcaseResult } from './preparedExports';
export type { PreparedShowcaseResult } from './preparedExports';

export interface PreparedSourcePreview { text: string; segments: { location: string; text: string }[]; documentSha256: string }

/** Uses the same multipart validation as course imports, pinned to the local replay provider. */
export async function showPreparedResult(source: PreparedDemoSource): Promise<PreparedShowcaseResult> {
  const baseUrl = preparedDemoBaseUrl();
  if (!baseUrl) throw new Error('Start the local prepared demo to view these results.');
  const document = await loadPreparedSource(source);
  try {
    const service = new InstitutionAIService({ baseUrl });
    const input = { document, requestedCardCount: 6, locale: 'en' };
    const result: PreparedShowcaseResult = source.task === 'syllabus'
      ? { task: 'syllabus', syllabus: await service.extractSyllabus(input) }
      : { task: 'flashcards', cards: await service.generateFlashcards(input) };
    const provenance = result.task === 'syllabus' ? result.syllabus.provenance : result.cards[0]?.provenance;
    if (provenance?.model !== 'prepared-demo/v1' || provenance.documentSha256 !== source.sha256) throw new Error('The result does not match this prepared source.');
    return result;
  } finally { URL.revokeObjectURL(document.uri); }
}

export function syllabusCourseMapping(value: SyllabusExtraction) {
  return [
    { label: 'Course code', destination: 'course.metadata.syllabus.courseCode', value: value.courseCode },
    { label: 'Duration', destination: 'course.metadata.syllabus.courseDuration', value: value.courseDuration },
    { label: 'Intended audience', destination: 'course.metadata.syllabus.intendedAudience', value: value.intendedAudience },
    { label: 'Learning objectives', destination: 'course.metadata.syllabus.learningObjectives', value: value.learningObjectives?.join('\n') },
    { label: 'Meeting times', destination: 'course.metadata.syllabus.meetingTimes', value: value.meetingTimes?.join('\n') },
    { label: 'Course title', destination: 'course.title', value: value.title },
    { label: 'Description', destination: 'course.description', value: value.description },
    { label: 'Instructors', destination: 'course.metadata.syllabus.instructorNames', value: value.instructorNames?.join(', ') },
    { label: 'Session topics', destination: 'course.metadata.syllabus.schedule', value: value.schedule?.map((entry, index) => `${index + 1}. ${entry.topic}${entry.date ? ` · ${entry.date}` : ''}`).join('\n') },
    { label: 'Required materials', destination: 'course.metadata.syllabus.requiredMaterials', value: value.requiredMaterials?.join('\n') },
    { label: 'Policies', destination: 'course.metadata.syllabus.policies', value: value.policies?.map(policy => `${policy.name}: ${policy.text}`).join('\n\n') },
    { label: 'Term dates', destination: 'course.termStart / course.termEnd', value: value.termStart || value.termEnd ? `${value.termStart || 'Not supplied'} – ${value.termEnd || 'Not supplied'}` : undefined },
    { label: 'Grading weights', destination: 'course.gradingWeights', value: value.gradingWeights ? Object.entries(value.gradingWeights).map(([name, weight]) => `${name}: ${weight}%`).join('\n') : undefined },
  ];
}

