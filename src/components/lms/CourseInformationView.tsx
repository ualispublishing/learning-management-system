import React from 'react';
import { Text, View } from 'react-native';
import type { Course } from '../../types/lms';
import { getSavedSyllabusDetails, type SavedSyllabusDetails } from '../../lib/ai/savedSyllabusDetails';
import { useThemeColors } from '../../lib/useThemeColors';
import { AIGenerationAttribution } from './AIGenerationAttribution';

function InformationGroup({ title, values }: { title: string; values: string[] }) {
  const colors = useThemeColors();
  if (!values.length) return null;
  return <View style={{ marginTop: 16 }}>
    <Text style={{ color: colors.text, fontWeight: 'bold', fontSize: 16 }}>{title}</Text>
    {values.map((value, index) => <Text key={index} style={{ color: colors.textSecondary, marginTop: 6, lineHeight: 22 }}>{value}</Text>)}
  </View>;
}

export function SyllabusAdditionalFields({ details }: { details: SavedSyllabusDetails }) {
  return <>
    <InformationGroup title="Course code" values={details.courseCode ? [details.courseCode] : []} />
    <InformationGroup title="Course duration" values={details.courseDuration ? [details.courseDuration] : []} />
    <InformationGroup title="Intended audience" values={details.intendedAudience ? [details.intendedAudience] : []} />
    <InformationGroup title="Meeting times" values={details.meetingTimes} />
    <InformationGroup title="Learning objectives" values={details.learningObjectives} />
  </>;
}

/** The Course Info modal and demo render the same view from the same course mapping. */
export function CourseInformationView({ course, courseItemCount, participantCount }: {
  course: Pick<Course, 'title' | 'description' | 'termStart' | 'termEnd' | 'gradingWeights' | 'metadata'>;
  courseItemCount?: number;
  participantCount?: number;
}) {
  const colors = useThemeColors();
  const details = getSavedSyllabusDetails(course);
  const date = (value: number) => value && Number.isFinite(value) ? new Date(value).toISOString().slice(0, 10) : 'Not supplied';
  return <View>
    <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 21, fontWeight: 'bold', marginBottom: 12 }}>{course.title}</Text>
    <Text style={{ color: colors.textSecondary, lineHeight: 23 }}>{course.description}</Text>
    {courseItemCount !== undefined && <InformationGroup title="Course items" values={[String(courseItemCount)]} />}
    {participantCount !== undefined && <InformationGroup title="Participants" values={[String(participantCount)]} />}
    <InformationGroup title="Term dates" values={[`${date(course.termStart)} – ${date(course.termEnd)}`]} />
    <InformationGroup title="Grading breakdown" values={Object.entries(course.gradingWeights).length ? Object.entries(course.gradingWeights).map(([name, value]) => `${name}: ${value}%`) : ['Not configured. Review the source grading policy before applying weights.']} />
    {details && <>
      <InformationGroup title="Instructors" values={details.instructorNames} />
      <SyllabusAdditionalFields details={details} />
      <InformationGroup title="Required materials" values={details.requiredMaterials} />
      <InformationGroup title={`Course outline · ${details.schedule.length} session topics`} values={details.schedule.map(entry => `${entry.date ? `${entry.date} · ` : ''}${entry.topic}`)} />
      <InformationGroup title="Policies" values={details.policies.map(policy => `${policy.name}: ${policy.text}`)} />
      <AIGenerationAttribution provenance={details.provenance} sourceName={details.sourceAsset?.name || details.sourceFileName} />
    </>}
  </View>;
}
