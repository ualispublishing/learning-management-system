import type { Course } from '../../types/lms';
import type { SyllabusExtraction } from './types';

type CourseFields = Pick<Course, 'title' | 'description' | 'termStart' | 'termEnd' | 'gradingWeights'>;

/** Shared by the reviewed course import and the isolated demo preview. No writes or approvals. */
export function mapSyllabusToCourse(extraction: SyllabusExtraction, course: CourseFields) {
  return {
    courseFields: {
      title: extraction.title || course.title,
      description: extraction.description || course.description,
      termStart: extraction.termStart ? Date.parse(`${extraction.termStart}T00:00:00Z`) : course.termStart,
      termEnd: extraction.termEnd ? Date.parse(`${extraction.termEnd}T23:59:59Z`) : course.termEnd,
      gradingWeights: extraction.gradingWeights || course.gradingWeights,
    },
    syllabusDetails: {
      courseCode: extraction.courseCode,
      courseDuration: extraction.courseDuration,
      intendedAudience: extraction.intendedAudience,
      learningObjectives: extraction.learningObjectives,
      meetingTimes: extraction.meetingTimes,
      instructorNames: extraction.instructorNames,
      schedule: extraction.schedule,
      requiredMaterials: extraction.requiredMaterials,
      policies: extraction.policies,
      evidence: extraction.evidence,
      warnings: extraction.warnings,
      provenance: extraction.provenance,
    },
  };
}
