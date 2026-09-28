/**
 * @fileoverview src/components/lms/ExternalGradeCreator.tsx.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Switch } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useThemeColors } from '../../lib/useThemeColors';
import { userAlert as Alert } from '../../lib/userAlert';
import { ContentItem, QuizQuestion, StudentSubmission } from '../../types/lms';
import { useLMSStore } from '../../lib/store/useLMSStore';
import { BaseModal } from './BaseModal';
import { createEntityId } from '../../lib/id';
import { useCourseRole } from '../../lib/store/selectors';
import { hasCoursePermission } from '../../lib/authorization/coursePermissions';
import { getGroupsForItem } from '../../lib/groups/courseGroups';
import { canonicalSafeHttpsUrl } from '../../lib/safeUrl';

export const ExternalGradeCreator = ({ courseId, onClose }: { courseId: string, onClose: () => void }) => {
  const colors = useThemeColors();
  const createExternalGrade = useLMSStore(state => state.createExternalGrade);
  const course = useLMSStore(state => state.courses.find(candidate => candidate.id === courseId));
  const courseRole = useCourseRole(courseId) ?? 'student';

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [totalMark, setTotalMark] = useState('100');
  const [link, setLink] = useState('');
  
  const [advancedMode, setAdvancedMode] = useState(false);
  const [subGrades, setSubGrades] = useState<{ id: string; label: string; points: string }[]>([]);
  const [isGroupWork, setIsGroupWork] = useState(false);
  const groupSets = course?.groupSets ?? [];
  const [groupSetId, setGroupSetId] = useState(groupSets[0]?.id || '');
  const gradingCategories = Object.keys(course?.gradingWeights || {});
  const [gradingCategory, setGradingCategory] = useState(gradingCategories[0] || '');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const saveLockRef = useRef(false);

  const addSubGrade = () => {
    if (subGrades.length >= 1_000) {
      setSaveError('An external grade cannot contain more than 1,000 criteria. Split it into multiple grade columns.');
      return;
    }
    setSubGrades([...subGrades, { id: createEntityId('criterion'), label: `Criteria ${subGrades.length + 1}`, points: '10' }]);
  };

  const updateSubGrade = (id: string, field: 'label' | 'points', value: string) => {
    setSubGrades(subGrades.map(sg => sg.id === id ? { ...sg, [field]: value } : sg));
  };

  const removeSubGrade = (id: string) => {
    setSubGrades(subGrades.filter(sg => sg.id !== id));
  };

  const handleSave = async () => {
    if (saveLockRef.current || !title.trim() || !course || !hasCoursePermission(courseRole, 'grade')) return;
    setSaveError(null);

    let questions: QuizQuestion[] = [];
    
    if (advancedMode && subGrades.length > 0) {
      questions = subGrades.map((sg, idx) => ({
        id: `q_${sg.id}`,
        label: `${idx + 1}`,
        content: sg.label,
        answerType: 'text', // Doesn't matter, teacher manually grades it
        points: Number(sg.points) || 0,
        gradingType: 'points',
      }));
    } else {
      if (advancedMode) {
        setSaveError('Add at least one rubric criterion or turn off advanced grading.');
        return;
      }
      questions = [{
        id: createEntityId('question'),
        label: '1',
        content: 'Overall Grade',
        answerType: 'text',
        points: Number(totalMark) || 0,
        gradingType: 'points'
      }];
    }

    const totalPoints = questions.reduce((sum, question) => sum + (question.points || 0), 0);
    if (!Number.isFinite(totalPoints) || totalPoints <= 0 || totalPoints > 1_000_000 || questions.some(question => !Number.isFinite(question.points) || (question.points || 0) <= 0 || (question.points || 0) > 1_000_000)) {
      setSaveError('Every grading criterion must be positive, and the total cannot exceed 1,000,000 points.');
      return;
    }
    if (advancedMode) {
      const labels = subGrades.map(criterion => criterion.label.trim());
      if (labels.some(label => !label) || new Set(labels.map(label => label.toLocaleLowerCase())).size !== labels.length) {
        setSaveError('Rubric criterion labels must be non-empty and unique.');
        return;
      }
    }
    if (gradingCategories.length && !gradingCategories.includes(gradingCategory)) {
      setSaveError('Select a valid grading category.');
      return;
    }
    const externalUrl = link.trim() ? canonicalSafeHttpsUrl(link.trim()) ?? undefined : undefined;
    if (link.trim() && !externalUrl) {
      setSaveError('External grade links must be valid HTTPS URLs without embedded credentials.');
      return;
    }
    if (isGroupWork && (!groupSetId || !groupSets.some(groupSet => groupSet.id === groupSetId))) {
      setSaveError('Select a valid course group set.');
      return;
    }

    const createdAt = Date.now();
    const newItem: ContentItem = {
      id: createEntityId('external-grade'),
      courseId,
      category: 'coursework',
      title: title.trim(),
      description: description.trim(),
      contentUrl: externalUrl,
      isGraded: true,
      gradingCategory: gradingCategory || undefined,
      workType: isGroupWork ? 'group' : 'individual',
      groupSetId: isGroupWork ? groupSetId : undefined,
      submissionTarget: externalUrl ? 'external-link' : 'in-app',
      externalUrl,
      presentationSlot: 'past', // Makes it visible but not 'active'
      questions,
      createdAt,
      metadata: { externalGrade: true },
    };

    const students = course.staff.filter(member => member.role === 'student');
    const gradingEntities = isGroupWork
      ? getGroupsForItem(course, newItem).flatMap(group => {
          const student = students.find(candidate => group.memberIds.includes(candidate.id));
          return student ? [{ student, groupId: group.id, displayName: group.name }] : [];
        })
      : students.map(student => ({ student, groupId: undefined, displayName: student.name }));
    if (isGroupWork && gradingEntities.length === 0) {
      setSaveError('Assign students to groups before creating a group external grade.');
      return;
    }

    saveLockRef.current = true;
    setIsSaving(true);
    try {
      const submissions: StudentSubmission[] = gradingEntities.map(({ student, groupId, displayName }) => ({
        id: createEntityId('submission'),
        studentId: student.id,
        studentName: displayName,
        groupId,
        contentItemId: newItem.id,
        courseId,
        submittedAt: createdAt,
        attemptNumber: 1,
        status: 'submitted',
        responses: questions.map(question => ({
          questionId: question.id,
          answer: null,
          score: 0,
          needsManualGrading: true,
          isManuallyGraded: false,
        })),
        totalScore: 0,
      }));
      await createExternalGrade(newItem, submissions);
      onClose();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'External grade could not be created.');
    } finally {
      saveLockRef.current = false;
      setIsSaving(false);
    }
  };

  const calculatedTotal = subGrades.reduce((acc, curr) => acc + (Number.parseFloat(curr.points) || 0), 0);
  const requestClose = () => {
    if (isSaving) return;
    const hasDraft = Boolean(title.trim() || description.trim() || link.trim() || totalMark !== '100' || advancedMode || subGrades.length || isGroupWork);
    if (!hasDraft) {
      onClose();
      return;
    }
    Alert.alert('Discard external grade draft?', 'The grade column and rubric have not been created.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: onClose },
    ]);
  };

  if (!hasCoursePermission(courseRole, 'grade')) {
    return <BaseModal visible={true} onClose={onClose} title="Add External Grade"><Text style={{ color: colors.error }}>You do not have permission to create grades for this course.</Text></BaseModal>;
  }

  return (
    <BaseModal visible={true} onClose={requestClose} title="Add External Grade" closeDisabled={isSaving}>
      <View pointerEvents={isSaving ? 'none' : 'auto'}>
      <View style={{ marginBottom: 15 }}>
        <Text style={{ color: colors.text, fontWeight: 'bold', marginBottom: 5 }}>Assignment Title *</Text>
        <TextInput 
          accessibilityLabel="Assignment title"
          style={[styles.input, { borderColor: colors.border, color: colors.text }]} 
          value={title} 
          onChangeText={setTitle} 
          placeholder="e.g. In-Person Presentation" 
          placeholderTextColor={colors.textSecondary}
          maxLength={500}
        />
      </View>

      <View style={{ marginBottom: 15 }}>
        <Text style={{ color: colors.text, fontWeight: 'bold', marginBottom: 5 }}>Description</Text>
        <TextInput 
          accessibilityLabel="Assignment description"
          style={[styles.input, { borderColor: colors.border, color: colors.text, height: 80, textAlignVertical: 'top' }]} 
          value={description} 
          onChangeText={setDescription} 
          placeholder="Optional instructions or details..." 
          placeholderTextColor={colors.textSecondary}
          multiline
          maxLength={250_000}
        />
      </View>
      
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 15 }}>
        <Text style={{ color: colors.text, fontWeight: 'bold' }}>Group Assignment</Text>
        <Switch accessibilityLabel="Group assignment" value={isGroupWork} onValueChange={setIsGroupWork} />
      </View>

      {isGroupWork && (
        <View style={{ marginBottom: 15 }}>
          <Text style={{ color: colors.text, fontWeight: 'bold', marginBottom: 8 }}>Course Group Set *</Text>
          {groupSets.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {groupSets.map(groupSet => {
                const selected = groupSet.id === groupSetId;
                return (
                  <TouchableOpacity
                    key={groupSet.id}
                    onPress={() => setGroupSetId(groupSet.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    style={{ paddingHorizontal: 12, paddingVertical: 8, marginRight: 8, marginBottom: 8, borderRadius: 16, borderWidth: 1, borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? `${colors.primary}20` : colors.card }}
                  >
                    <Text style={{ color: selected ? colors.primary : colors.text }}>{groupSet.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : (
            <Text style={{ color: colors.error }}>Create a course group set before enabling group grading.</Text>
          )}
        </View>
      )}

      {gradingCategories.length > 0 && (
        <View style={{ marginBottom: 15 }}>
          <Text style={{ color: colors.text, fontWeight: 'bold', marginBottom: 8 }}>Grading Category *</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {gradingCategories.map(category => {
              const selected = gradingCategory === category;
              return (
                <TouchableOpacity
                  key={category}
                  onPress={() => setGradingCategory(category)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  style={{ paddingHorizontal: 12, paddingVertical: 8, marginRight: 8, marginBottom: 8, borderRadius: 16, borderWidth: 1, borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? `${colors.primary}20` : colors.card }}
                >
                  <Text style={{ color: selected ? colors.primary : colors.text }}>{category}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}

      <View style={{ marginBottom: 15 }}>
        <Text style={{ color: colors.text, fontWeight: 'bold', marginBottom: 5 }}>External Link / File URL</Text>
        <TextInput 
          accessibilityLabel="External link or file URL"
          style={[styles.input, { borderColor: colors.border, color: colors.text }]} 
          value={link} 
          onChangeText={setLink} 
          placeholder="https://..." 
          placeholderTextColor={colors.textSecondary}
          maxLength={8_192}
        />
      </View>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, marginBottom: 20 }]}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
          <View>
            <Text style={{ color: colors.text, fontWeight: 'bold' }}>Advanced Grading (Rubric)</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 12 }}>Define individual grading criteria</Text>
          </View>
          <Switch accessibilityLabel="Advanced rubric grading" value={advancedMode} onValueChange={setAdvancedMode} />
        </View>

        {!advancedMode ? (
          <View>
            <Text style={{ color: colors.text, fontWeight: 'bold', marginBottom: 5 }}>Total Max Mark / Points</Text>
            <TextInput 
              accessibilityLabel="Total maximum points"
              style={[styles.input, { borderColor: colors.border, color: colors.text, width: 100 }]} 
              value={totalMark} 
              onChangeText={setTotalMark} 
              keyboardType="decimal-pad"
              maxLength={30}
            />
          </View>
        ) : (
          <View>
            {subGrades.map((sg, index) => (
              <View key={sg.id} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                <TextInput 
                  accessibilityLabel={`Rubric criterion ${index + 1} label`}
                  style={[styles.input, { borderColor: colors.border, color: colors.text, flex: 1, marginRight: 10 }]} 
                  value={sg.label} 
                  onChangeText={(val) => updateSubGrade(sg.id, 'label', val)} 
                  placeholder={`Criteria ${index + 1}`}
                  placeholderTextColor={colors.textSecondary}
                  maxLength={500}
                />
                <TextInput 
                  accessibilityLabel={`${sg.label || `Rubric criterion ${index + 1}`} maximum points`}
                  style={[styles.input, { borderColor: colors.border, color: colors.text, width: 60, marginRight: 10, textAlign: 'center' }]} 
                  value={sg.points} 
                  onChangeText={(val) => updateSubGrade(sg.id, 'points', val)} 
                  keyboardType="decimal-pad"
                  maxLength={30}
                />
                <TouchableOpacity onPress={() => removeSubGrade(sg.id)} accessibilityRole="button" accessibilityLabel={`Delete rubric criterion ${sg.label || index + 1}`}>
                  <Ionicons name="trash" size={24} color="#FF5252" />
                </TouchableOpacity>
              </View>
            ))}
            
            <TouchableOpacity 
              disabled={subGrades.length >= 1_000}
              style={{ padding: 10, backgroundColor: colors.background, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed', marginBottom: 15 }}
              onPress={addSubGrade}
              accessibilityRole="button"
              accessibilityLabel="Add grading criterion"
              accessibilityState={{ disabled: subGrades.length >= 1_000 }}
            >
              <Text style={{ color: colors.textSecondary, fontWeight: 'bold' }}>+ Add Criteria</Text>
            </TouchableOpacity>
            
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', borderTopWidth: 1, borderColor: colors.border, paddingTop: 10 }}>
              <Text style={{ color: colors.text, fontWeight: 'bold', fontSize: 16 }}>Total Mark: {calculatedTotal}</Text>
            </View>
          </View>
        )}
      </View>

      <TouchableOpacity 
        style={[styles.btn, { backgroundColor: colors.primary, opacity: title.trim() && !isSaving ? 1 : 0.5 }]}
        onPress={() => void handleSave()}
        disabled={!title.trim() || isSaving}
        accessibilityRole="button"
        accessibilityLabel={isSaving ? 'Creating external grade' : 'Save external grade'}
        accessibilityState={{ disabled: !title.trim() || isSaving, busy: isSaving }}
      >
        <Text style={{ color: colors.buttonText, fontWeight: 'bold', fontSize: 16 }}>{isSaving ? 'Creating gradebook entries…' : 'Save External Grade'}</Text>
      </TouchableOpacity>
      {saveError && <Text accessibilityRole="alert" style={{ color: colors.error, marginBottom: 20 }}>{saveError}</Text>}
      </View>
    </BaseModal>
  );
};

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 15,
  },
  btn: {
    padding: 15,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 40
  }
});
