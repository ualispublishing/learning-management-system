/**
 * @fileoverview src/components/lms/PollResults.tsx.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import React, { useMemo } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { hasAssessmentAnswer } from '../../lib/assessment/engine';
import { hasCoursePermission } from '../../lib/authorization/coursePermissions';
import { useCourseRole } from '../../lib/store/selectors';
import { useLMSStore } from '../../lib/store/useLMSStore';
import { useThemeColors } from '../../lib/useThemeColors';
import { ContentItem, QuizQuestion, StudentSubmission } from '../../types/lms';

const sessionTimestamp = (submissions: StudentSubmission[]) =>
  Math.max(0, ...submissions.map(submission => submission.submittedAt));

const answerValues = (answer: unknown): string[] => Array.isArray(answer)
  ? answer.map(String)
  : [String(answer)];

const orderedDistributionValues = (question: QuizQuestion, counts: Map<string, number>) => {
  if (question.answerType === 'multiple_choice') {
    const configured = question.options || [];
    return [...configured, ...[...counts.keys()].filter(value => !configured.includes(value)).sort()];
  }
  if (question.answerType === 'spectrum') {
    const min = Number(question.customConfig?.min ?? 1);
    const max = Number(question.customConfig?.max ?? 5);
    return Array.from({ length: max - min + 1 }, (_, index) => String(min + index));
  }
  return [...counts.keys()].sort((left, right) => left.localeCompare(right));
};

export const PollResults = ({ item, onClose }: { item: ContentItem; onClose: () => void }) => {
  const colors = useThemeColors();
  const courseRole = useCourseRole(item.courseId);
  const canView = hasCoursePermission(courseRole, 'viewGradeAnalytics');
  const submissions = useLMSStore(state => state.submissions);
  const course = useLMSStore(state => state.courses.find(candidate => candidate.id === item.courseId));
  const enrolledStudents = course?.staff.filter(member => member.role === 'student').length ?? 0;
  const sessions = useMemo(() => {
    const grouped = new Map<string, StudentSubmission[]>();
    submissions
      .filter(submission => submission.contentItemId === item.id && ['submitted', 'graded'].includes(submission.status))
      .forEach(submission => {
        const key = submission.liveSessionId || 'legacy-or-non-live';
        grouped.set(key, [...(grouped.get(key) || []), submission]);
      });
    return [...grouped.entries()]
      .map(([id, records]) => ({ id, records: records.sort((a, b) => a.studentId.localeCompare(b.studentId)) }))
      .sort((a, b) => sessionTimestamp(b.records) - sessionTimestamp(a.records));
  }, [item.id, submissions]);
  const questions = (item.questions || []).filter(question => question.answerType !== 'page_break');

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.container, { backgroundColor: colors.background }]}> 
        <View style={[styles.header, { backgroundColor: colors.card, borderColor: colors.border }]}> 
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontSize: 20, fontWeight: 'bold' }}>Poll Results</Text>
            <Text style={{ color: colors.textSecondary, marginTop: 3 }}>{item.title}</Text>
          </View>
          <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Close poll results">
            <Ionicons name="close" size={26} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {!canView ? (
          <View style={styles.empty}>
            <Ionicons name="lock-closed" size={36} color={colors.textSecondary} />
            <Text style={{ color: colors.error, textAlign: 'center', marginTop: 12 }}>You do not have permission to view poll results.</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.content}>
            {sessions.length === 0 && (
              <View style={styles.empty}>
                <Text style={{ color: colors.text, fontWeight: 'bold', fontSize: 18 }}>No archived responses yet</Text>
                <Text style={{ color: colors.textSecondary, textAlign: 'center', marginTop: 6 }}>Host and end a live poll to create a durable result set.</Text>
              </View>
            )}
            {sessions.map(session => (
              <View key={session.id} style={[styles.sessionCard, { backgroundColor: colors.card, borderColor: colors.border }]}> 
                <Text style={{ color: colors.text, fontWeight: 'bold', fontSize: 18 }}>
                  {session.id === 'legacy-or-non-live' ? 'Non-live responses' : new Date(sessionTimestamp(session.records)).toLocaleString()}
                </Text>
                <Text style={{ color: colors.textSecondary, marginTop: 4, marginBottom: 16 }}>
                  {session.records.length} of {enrolledStudents} currently enrolled students responded
                </Text>

                {questions.map(question => {
                  const answered = session.records.flatMap(submission => {
                    const response = submission.responses.find(candidate => candidate.questionId === question.id);
                    return response && hasAssessmentAnswer(response.answer) ? [{ submission, answer: response.answer }] : [];
                  });
                  const isText = question.answerType === 'text' || question.answerType === 'timed';
                  const counts = new Map<string, number>();
                  answered.forEach(({ answer }) => answerValues(answer).forEach(value => counts.set(value, (counts.get(value) || 0) + 1)));
                  return (
                    <View key={question.id} style={[styles.question, { borderColor: colors.border }]}> 
                      <Text style={{ color: colors.text, fontWeight: 'bold' }}>{question.label}. {question.content}</Text>
                      <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 4 }}>{answered.length} responses</Text>
                      {answered.length === 0 ? (
                        <Text style={{ color: colors.textSecondary, marginTop: 10 }}>No answers.</Text>
                      ) : isText ? answered.map(({ submission, answer }) => (
                        <View key={submission.id} style={[styles.textAnswer, { backgroundColor: colors.background }]}> 
                          <Text style={{ color: colors.text }}>{String(answer)}</Text>
                          <Text style={{ color: colors.textSecondary, fontSize: 11, marginTop: 4 }}>{submission.studentName || submission.studentId}</Text>
                        </View>
                      )) : orderedDistributionValues(question, counts).map(value => {
                        const count = counts.get(value) || 0;
                        const percent = answered.length ? Math.round((count / answered.length) * 100) : 0;
                        return (
                          <View key={value} style={styles.resultRow}>
                            <Text style={{ color: colors.text, flex: 1 }}>{value}</Text>
                            <Text style={{ color: colors.textSecondary }}>{count} · {percent}%</Text>
                          </View>
                        );
                      })}
                    </View>
                  );
                })}
              </View>
            ))}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', padding: 20, borderBottomWidth: 1 },
  content: { padding: 20 },
  empty: { flex: 1, minHeight: 240, alignItems: 'center', justifyContent: 'center', padding: 30 },
  sessionCard: { borderWidth: 1, borderRadius: 14, padding: 18, marginBottom: 18 },
  question: { borderTopWidth: 1, paddingTop: 14, marginTop: 10, marginBottom: 8 },
  resultRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7 },
  textAnswer: { borderRadius: 8, padding: 10, marginTop: 8 },
});
