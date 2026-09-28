/**
 * @fileoverview src/components/lms/shared/UnifiedContentCreator.tsx.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Modal, Switch } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as DocumentPicker from 'expo-document-picker';
import { useThemeColors } from '../../../lib/useThemeColors';
import { userAlert as Alert } from '../../../lib/userAlert';
import { ContentCategory, CourseGroupSet, CourseVideoCaptionTrack } from '../../../types/lms';
import { DatePicker } from '../DatePicker';
import { canonicalSafeHttpsUrl } from '../../../lib/safeUrl';
import {
  MAX_VIDEO_ALTERNATIVE_LABEL_CHARACTERS,
  MAX_VIDEO_CAPTION_TRACKS,
  MAX_VIDEO_TRANSCRIPT_CHARACTERS,
} from '../../../lib/videoAlternatives';

export type ContentType = 'title_link' | 'announcement' | 'quiz' | 'custom' | 'pop_quiz' | 'poll';

export interface AddFormData {
  title: string;
  description: string;
  url: string;
  fileName: string;
  fileUri: string;
  fileMimeType: string;
  fileSize?: number;
  file?: Blob;
  displayDate: string;
  availableDate: string;
  isGraded: boolean;
  gradingCategory: string;
  isPopQuiz: boolean;
  isGroup: boolean;
  groupSetId: string;
  customLanguage: 'html' | 'css';
  customHtml: string;
  customCss: string;
  generateFlashcards: boolean;
  contentToCards: boolean;
  mediaToCards: boolean;
  flashcardCount: number;
  videoCaptionTracks: CourseVideoCaptionTrack[];
  videoTranscriptText: string;
  videoTranscriptUrl: string;
  videoTranscriptLabel: string;
}

interface UnifiedContentCreatorProps {
  visible: boolean;
  category: ContentCategory | null;
  courseId: string;
  isEditing?: boolean;
  initialType?: ContentType | null;
  initialData?: Partial<AddFormData>;
  gradingCategories?: string[];
  groupSets?: CourseGroupSet[];
  onClose: () => void;
  onSave: (type: ContentType, data: AddFormData) => Promise<void>;
  allowFlashcardGeneration?: boolean;
}

const defaultForm: AddFormData = {
  title: '', description: '', url: '', fileName: '', fileUri: '', fileMimeType: '', displayDate: '', availableDate: '', isGraded: true, gradingCategory: '', isPopQuiz: false, isGroup: false, groupSetId: '',
  customLanguage: 'html', customHtml: '', customCss: '',
  generateFlashcards: false, contentToCards: true, mediaToCards: false, flashcardCount: 30,
  videoCaptionTracks: [], videoTranscriptText: '', videoTranscriptUrl: '', videoTranscriptLabel: '',
};

export const UnifiedContentCreator: React.FC<UnifiedContentCreatorProps> = ({
  visible, category, courseId, isEditing = false, initialType, initialData, gradingCategories = [], groupSets = [], onClose, onSave, allowFlashcardGeneration = true
}) => {
  const colors = useThemeColors();
  const [initialTypeValue] = useState<ContentType | null>(initialType || null);
  const [initialFormValue] = useState<AddFormData>(() => ({
    ...defaultForm,
    gradingCategory: gradingCategories[0] || '',
    ...initialData,
  }));
  const [addType, setAddType] = useState<ContentType | null>(initialTypeValue);
  const [addForm, setAddForm] = useState<AddFormData>(initialFormValue);
  const [showDates, setShowDates] = useState(!!initialData?.displayDate || !!initialData?.availableDate);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveInFlightRef = useRef(false);

  const updateCaptionTrack = (index: number, updates: Partial<CourseVideoCaptionTrack>) => {
    setAddForm(previous => ({
      ...previous,
      videoCaptionTracks: previous.videoCaptionTracks.map((track, trackIndex) => trackIndex === index ? { ...track, ...updates } : track),
    }));
  };

  const setDefaultCaptionTrack = (index: number, selected: boolean) => {
    setAddForm(previous => ({
      ...previous,
      videoCaptionTracks: previous.videoCaptionTracks.map((track, trackIndex) => ({
        ...track,
        isDefault: selected && trackIndex === index ? true : undefined,
      })),
    }));
  };

  const requestClose = () => {
    if (saveInFlightRef.current) return;
    const hasChanges = addType !== initialTypeValue || JSON.stringify(addForm) !== JSON.stringify(initialFormValue);
    if (!hasChanges) {
      onClose();
      return;
    }
    Alert.alert('Discard course content draft?', 'Your unsaved content and configuration changes will be lost.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: onClose },
    ]);
  };

  const selectDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) throw new Error('The selected file could not be read.');
      setAddForm(previous => ({
        ...previous,
        fileName: asset.name,
        fileUri: asset.uri,
        fileMimeType: asset.mimeType || 'application/octet-stream',
        fileSize: asset.size,
        file: asset.file,
        url: asset.uri,
      }));
    } catch (error) {
      Alert.alert('Upload failed', error instanceof Error ? error.message : 'The file picker could not be opened.');
    }
  };

  if (!category) return null;

  const getAddOptions = () => {
    switch (category) {
      case 'admin': return [
        { id: 'title_link', icon: 'link', label: 'Content' },
        { id: 'announcement', icon: 'megaphone', label: 'Announcement' },
        { id: 'custom', icon: 'code-slash', label: 'Custom Code Block' }
      ];
      case 'material': return [
        { id: 'title_link', icon: 'document-attach', label: 'Content' },
        { id: 'custom', icon: 'code-slash', label: 'Custom Code Block' }
      ];
      case 'coursework': return [
        { id: 'quiz', icon: 'create', label: 'Assessment Builder' },
        { id: 'pop_quiz', icon: 'flash', label: 'Pop-Quiz Builder (In-Class)' },
        { id: 'poll', icon: 'podium', label: 'Poll Builder' },
        { id: 'custom', icon: 'code-slash', label: 'Custom Code Block' }
      ];
      default: return [];
    }
  };

  const handleSave = async () => {
    if (!addType || !addForm.title.trim() || saveInFlightRef.current) return;
    if (category === 'coursework' && addForm.isGraded && gradingCategories.length && !gradingCategories.includes(addForm.gradingCategory)) {
      setSaveError('Select a valid grading category before creating this assessment.');
      return;
    }
    if (category === 'coursework' && addForm.isGroup && !groupSets.some(groupSet => groupSet.id === addForm.groupSetId)) {
      setSaveError('Select a valid course group set before creating group coursework.');
      return;
    }
    const safeUrl = addForm.fileUri || !addForm.url.trim() ? addForm.url : canonicalSafeHttpsUrl(addForm.url.trim());
    if (safeUrl === null) {
      setSaveError('External content links must be valid HTTPS URLs without embedded credentials.');
      return;
    }
    saveInFlightRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      const form = { ...addForm, title: addForm.title.trim(), url: safeUrl };
      await onSave(addType, form);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Content could not be saved.');
    } finally {
      saveInFlightRef.current = false;
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={requestClose}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, { backgroundColor: colors.background, borderColor: colors.border, marginTop: 100, height: '100%', borderRadius: 24 }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <Text style={{ color: colors.text, fontSize: 24, fontWeight: 'bold', textTransform: 'capitalize' }}>
              {isEditing ? 'Edit course content' : `Add to ${category}`}
            </Text>
            <TouchableOpacity disabled={saving} onPress={requestClose} accessibilityRole="button" accessibilityLabel="Close course content editor" accessibilityState={{ disabled: saving }} style={{ opacity: saving ? 0.5 : 1 }}>
              <Ionicons name="close-circle" size={28} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {!addType ? (
            <View>
              <Text style={{ color: colors.textSecondary, marginBottom: 15 }}>Select Content Type:</Text>
              {getAddOptions().map(opt => (
                <TouchableOpacity 
                  key={opt.id} 
                  style={{ flexDirection: 'row', alignItems: 'center', padding: 20, backgroundColor: colors.card, borderRadius: 12, marginBottom: 15, borderWidth: 1, borderColor: colors.border }}
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${opt.label}`}
                  onPress={() => {
                    setAddType(opt.id as ContentType);
                    if (opt.id === 'pop_quiz') {
                      setAddForm({ ...addForm, isPopQuiz: true, isGraded: false });
                    } else if (opt.id === 'quiz') {
                      setAddForm({ ...addForm, isPopQuiz: false, isGraded: true, gradingCategory: addForm.gradingCategory || gradingCategories[0] || '' });
                    } else {
                      setAddForm({ ...addForm, isPopQuiz: false, isGraded: false });
                    }
                  }}
                >
                  <Ionicons name={opt.icon as any} size={24} color={colors.primary} style={{ marginRight: 15 }} />
                  <Text style={{ color: colors.text, fontSize: 18, fontWeight: 'bold' }}>{opt.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            <ScrollView pointerEvents={saving ? 'none' : 'auto'} keyboardShouldPersistTaps="handled">
              <TouchableOpacity onPress={() => setAddType(null)} accessibilityRole="button" accessibilityLabel="Back to content type selection" style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20 }}>
                <Ionicons name="arrow-back" size={20} color={colors.primary} />
                <Text style={{ color: colors.primary, marginLeft: 5 }}>Back to selection</Text>
              </TouchableOpacity>

              <Text style={{ color: colors.text, fontWeight: 'bold', marginBottom: 5 }}>Title</Text>
              <TextInput 
                accessibilityLabel="Content title"
                style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.card }]}
                placeholder="e.g. Week 1 Syllabus"
                placeholderTextColor={colors.textSecondary}
                value={addForm.title}
                onChangeText={(val) => setAddForm({...addForm, title: val})}
                maxLength={500}
              />

              {addType === 'custom' ? (
                <View style={{ marginTop: 15 }}>
                  <Text style={{ color: colors.text, fontWeight: 'bold', marginBottom: 5 }}>Custom Code Block</Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 10 }}>Build static components with sandboxed HTML and CSS. JavaScript is disabled for learner safety.</Text>
                  
                  <View style={{ flexDirection: 'row', marginBottom: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 8, overflow: 'hidden' }}>
                    {(['html', 'css'] as const).map(lang => (
                      <TouchableOpacity
                        key={lang}
                        style={{ flex: 1, padding: 10, alignItems: 'center', backgroundColor: addForm.customLanguage === lang ? colors.primary + '20' : colors.card, borderBottomWidth: 2, borderBottomColor: addForm.customLanguage === lang ? colors.primary : 'transparent' }}
                        onPress={() => setAddForm({ ...addForm, customLanguage: lang })}
                        accessibilityRole="tab"
                        accessibilityLabel={`${lang.toUpperCase()} editor`}
                        accessibilityState={{ selected: addForm.customLanguage === lang }}
                      >
                        <Text style={{ color: addForm.customLanguage === lang ? colors.primary : colors.textSecondary, fontWeight: 'bold', textTransform: 'uppercase' }}>{lang}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <TextInput
                    accessibilityLabel={`${addForm.customLanguage.toUpperCase()} source code`}
                    style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.card, padding: 12, fontFamily: 'monospace', height: 250, textAlignVertical: 'top' }]}
                    value={
                      addForm.customLanguage === 'html' ? addForm.customHtml :
                      addForm.customCss
                    }
                    onChangeText={(text) => {
                      if (addForm.customLanguage === 'html') setAddForm({ ...addForm, customHtml: text });
                      else setAddForm({ ...addForm, customCss: text });
                    }}
                    multiline
                    maxLength={120_000}
                    placeholder={`Write ${addForm.customLanguage} code here...`}
                    placeholderTextColor={colors.textSecondary}
                  />
                  
                  <Text style={{ color: colors.text, fontWeight: 'bold', marginBottom: 5, marginTop: 20 }}>Upload Assets (Optional)</Text>
                  <TouchableOpacity 
                    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 20, borderWidth: 1, borderColor: colors.primary, borderStyle: 'dashed', borderRadius: 8, backgroundColor: colors.primary + '10' }}
                    onPress={() => void selectDocument()}
                    accessibilityRole="button"
                    accessibilityLabel="Select a custom content asset"
                  >
                    <Ionicons name="cloud-upload-outline" size={24} color={colors.primary} />
                    <Text style={{ color: colors.primary, marginLeft: 10, fontWeight: 'bold' }}>Drag and Drop Files / Images</Text>
                  </TouchableOpacity>
                  {!!addForm.fileName && addType === 'custom' && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', padding: 10, marginTop: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 8, backgroundColor: colors.card, justifyContent: 'space-between' }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Ionicons name="document-text" size={20} color={colors.textSecondary} />
                        <Text style={{ color: colors.text, marginLeft: 10, fontWeight: 'bold', fontSize: 12 }}>{addForm.fileName}</Text>
                      </View>
                      <TouchableOpacity onPress={() => setAddForm({ ...addForm, fileName: '', fileUri: '', fileMimeType: '', fileSize: undefined, file: undefined, url: '' })} accessibilityRole="button" accessibilityLabel="Remove selected asset">
                        <Ionicons name="close-circle" size={18} color="#FF5252" />
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              ) : (
                <>
                  <Text style={{ color: colors.text, fontWeight: 'bold', marginBottom: 5, marginTop: 15 }}>Description (Optional)</Text>
                  <TextInput 
                    accessibilityLabel="Content description"
                    style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.card, height: 80, textAlignVertical: 'top' }]}
                    placeholder="Brief description..."
                    placeholderTextColor={colors.textSecondary}
                    multiline
                    value={addForm.description}
                    onChangeText={(val) => setAddForm({...addForm, description: val})}
                    maxLength={250_000}
                  />

                  {(addType === 'quiz' || addType === 'pop_quiz' || addType === 'poll') && (
                    <View style={{ marginTop: 20, padding: 20, backgroundColor: colors.primary + '10', borderRadius: 12, borderWidth: 1, borderColor: colors.primary }}>
                      <Text style={{ color: colors.primary, fontWeight: 'bold', fontSize: 16, marginBottom: 15 }}>Builder Settings</Text>
                      
                      {addType !== 'poll' && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 15 }}>
                          <View>
                            <Text style={{ color: colors.text, fontWeight: 'bold' }}>Graded Assessment</Text>
                            <Text style={{ color: colors.textSecondary, fontSize: 12 }}>Will count towards final grade</Text>
                          </View>
                          <Switch 
                            accessibilityLabel="Graded assessment"
                            value={addForm.isGraded} 
                            onValueChange={(val: boolean) => setAddForm({
                              ...addForm,
                              isGraded: val,
                              gradingCategory: val ? addForm.gradingCategory || gradingCategories[0] || '' : addForm.gradingCategory,
                            })} 
                          />
                        </View>
                      )}

                      {addType !== 'poll' && addForm.isGraded && gradingCategories.length > 0 && (
                        <View style={{ marginBottom: 15 }}>
                          <Text style={{ color: colors.text, fontWeight: 'bold', marginBottom: 8 }}>Grading Category *</Text>
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                            {gradingCategories.map(gradingCategory => {
                              const selected = addForm.gradingCategory === gradingCategory;
                              return (
                                <TouchableOpacity
                                  key={gradingCategory}
                                  onPress={() => setAddForm({ ...addForm, gradingCategory })}
                                  accessibilityRole="radio"
                                  accessibilityState={{ checked: selected }}
                                  style={{ paddingHorizontal: 12, paddingVertical: 8, marginRight: 8, marginBottom: 8, borderRadius: 16, borderWidth: 1, borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? `${colors.primary}20` : colors.card }}
                                >
                                  <Text style={{ color: selected ? colors.primary : colors.text }}>{gradingCategory}</Text>
                                </TouchableOpacity>
                              );
                            })}
                          </View>
                        </View>
                      )}
                      
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <View>
                          <Text style={{ color: colors.text, fontWeight: 'bold' }}>In-Class (Live) Mode</Text>
                          <Text style={{ color: colors.textSecondary, fontSize: 12 }}>Toggle off for standard offline access</Text>
                        </View>
                        <Switch 
                          accessibilityLabel="In-class live mode"
                          accessibilityState={{ disabled: addType === 'poll' }}
                          value={addForm.isPopQuiz} 
                          disabled={addType === 'poll'}
                          onValueChange={(val: boolean) => setAddForm({
                            ...addForm,
                            isPopQuiz: val,
                            isGroup: val ? false : addForm.isGroup,
                            groupSetId: val ? '' : addForm.groupSetId,
                          })} 
                        />
                      </View>

                      {addType !== 'poll' && !addForm.isPopQuiz && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 15 }}>
                          <View>
                            <Text style={{ color: colors.text, fontWeight: 'bold' }}>Group Submission</Text>
                            <Text style={{ color: colors.textSecondary, fontSize: 12 }}>One submission applies to the whole group</Text>
                          </View>
                          <Switch 
                            accessibilityLabel="Group submission"
                            value={addForm.isGroup} 
                            onValueChange={(val: boolean) => setAddForm({
                              ...addForm,
                              isGroup: val,
                              groupSetId: val ? addForm.groupSetId || groupSets[0]?.id || '' : '',
                            })} 
                          />
                        </View>
                      )}
                      {addType !== 'poll' && !addForm.isPopQuiz && addForm.isGroup && (
                        <View style={{ marginTop: 12 }}>
                          <Text style={{ color: colors.text, fontWeight: 'bold', marginBottom: 8 }}>Course Group Set *</Text>
                          {groupSets.length ? (
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                              {groupSets.map(groupSet => {
                                const selected = addForm.groupSetId === groupSet.id;
                                return (
                                  <TouchableOpacity
                                    key={groupSet.id}
                                    onPress={() => setAddForm({ ...addForm, groupSetId: groupSet.id })}
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
                            <Text style={{ color: colors.error }}>Create a course group set before enabling group submissions.</Text>
                          )}
                        </View>
                      )}
                    </View>
                  )}

                  {addType === 'title_link' && (
                    <>
                      <Text style={{ color: colors.text, fontWeight: 'bold', marginBottom: 5, marginTop: 15 }}>External URL (Optional)</Text>
                      <TextInput 
                        accessibilityLabel="External URL"
                        style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.card, marginBottom: 15 }]}
                        placeholder="https://..."
                        placeholderTextColor={colors.textSecondary}
                        value={addForm.url}
                        onChangeText={(val) => setAddForm({...addForm, url: val})}
                        autoCapitalize="none"
                        autoCorrect={false}
                        keyboardType="url"
                        maxLength={8_192}
                      />
                      
                      <Text style={{ color: colors.text, fontWeight: 'bold', marginBottom: 5 }}>Upload Media (Optional)</Text>
                      {addForm.fileName ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 15, borderWidth: 1, borderColor: colors.border, borderRadius: 8, backgroundColor: colors.card, justifyContent: 'space-between' }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Ionicons name="document-text" size={24} color={colors.textSecondary} />
                            <Text style={{ color: colors.text, marginLeft: 10, fontWeight: 'bold' }}>{addForm.fileName}</Text>
                          </View>
                          <TouchableOpacity onPress={() => setAddForm({ ...addForm, fileName: '', fileUri: '', fileMimeType: '', fileSize: undefined, file: undefined, url: '' })} accessibilityRole="button" accessibilityLabel="Remove selected media">
                            <Ionicons name="close-circle" size={20} color="#FF5252" />
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <TouchableOpacity 
                          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 15, borderWidth: 1, borderColor: colors.primary, borderStyle: 'dashed', borderRadius: 8, backgroundColor: colors.primary + '10' }}
                          onPress={() => void selectDocument()}
                          accessibilityRole="button"
                          accessibilityLabel="Select course material file"
                        >
                          <Ionicons name="cloud-upload-outline" size={24} color={colors.primary} />
                          <Text style={{ color: colors.primary, marginLeft: 10, fontWeight: 'bold' }}>Upload PDF, PPT, Video, etc.</Text>
                        </TouchableOpacity>
                      )}

                      <View style={{ marginTop: 20, padding: 16, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.card }}>
                        <Text accessibilityRole="header" style={{ color: colors.text, fontWeight: 'bold', fontSize: 16 }}>Video accessibility alternatives</Text>
                        <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 5 }}>
                          For uploaded videos, add reviewed WebVTT captions from the same HTTPS origin as the video and an adjacent transcript. Supplying a file does not verify its accuracy or synchronization; complete the human accessibility review before release.
                        </Text>
                        <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 5 }}>
                          Web uses the WebVTT track directly. For synchronized native captions, publish embedded video or HLS subtitle tracks and verify the Subtitles control on physical iOS and Android devices.
                        </Text>

                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, marginBottom: 8 }}>
                          <Text style={{ color: colors.text, fontWeight: 'bold' }}>Caption tracks ({addForm.videoCaptionTracks.length}/{MAX_VIDEO_CAPTION_TRACKS})</Text>
                          <TouchableOpacity
                            accessibilityRole="button"
                            accessibilityLabel="Add video caption track"
                            accessibilityState={{ disabled: addForm.videoCaptionTracks.length >= MAX_VIDEO_CAPTION_TRACKS }}
                            disabled={addForm.videoCaptionTracks.length >= MAX_VIDEO_CAPTION_TRACKS}
                            onPress={() => setAddForm(previous => ({
                              ...previous,
                              videoCaptionTracks: [...previous.videoCaptionTracks, {
                                url: '',
                                language: '',
                                label: '',
                                format: 'text/vtt',
                                isDefault: previous.videoCaptionTracks.length === 0 ? true : undefined,
                              }],
                            }))}
                            style={{ opacity: addForm.videoCaptionTracks.length >= MAX_VIDEO_CAPTION_TRACKS ? 0.5 : 1, padding: 8 }}
                          >
                            <Text style={{ color: colors.primary, fontWeight: 'bold' }}>+ Add captions</Text>
                          </TouchableOpacity>
                        </View>

                        {addForm.videoCaptionTracks.map((track, index) => (
                          <View key={`caption-${index}`} style={{ marginBottom: 14, padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 8, backgroundColor: colors.background }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                              <Text style={{ color: colors.text, fontWeight: 'bold' }}>Caption track {index + 1}</Text>
                              <TouchableOpacity
                                accessibilityRole="button"
                                accessibilityLabel={`Remove caption track ${index + 1}`}
                                onPress={() => setAddForm(previous => ({ ...previous, videoCaptionTracks: previous.videoCaptionTracks.filter((_, trackIndex) => trackIndex !== index) }))}
                                style={{ padding: 8 }}
                              >
                                <Text style={{ color: colors.error, fontWeight: 'bold' }}>Remove</Text>
                              </TouchableOpacity>
                            </View>
                            <TextInput
                              accessibilityLabel={`Caption track ${index + 1} HTTPS WebVTT URL`}
                              style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.card }]}
                              placeholder="https://media.example.edu/captions.vtt"
                              placeholderTextColor={colors.textSecondary}
                              value={track.url}
                              onChangeText={url => updateCaptionTrack(index, { url })}
                              autoCapitalize="none"
                              autoCorrect={false}
                              keyboardType="url"
                              maxLength={8_192}
                            />
                            <View style={{ flexDirection: 'row', gap: 10 }}>
                              <TextInput
                                accessibilityLabel={`Caption track ${index + 1} language tag`}
                                style={[styles.input, { flex: 1, borderColor: colors.border, color: colors.text, backgroundColor: colors.card }]}
                                placeholder="en or fr-CA"
                                placeholderTextColor={colors.textSecondary}
                                value={track.language}
                                onChangeText={language => updateCaptionTrack(index, { language })}
                                autoCapitalize="none"
                                maxLength={80}
                              />
                              <TextInput
                                accessibilityLabel={`Caption track ${index + 1} label`}
                                style={[styles.input, { flex: 2, borderColor: colors.border, color: colors.text, backgroundColor: colors.card }]}
                                placeholder="English captions"
                                placeholderTextColor={colors.textSecondary}
                                value={track.label}
                                onChangeText={label => updateCaptionTrack(index, { label })}
                                maxLength={MAX_VIDEO_ALTERNATIVE_LABEL_CHARACTERS}
                              />
                            </View>
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                              <View style={{ flex: 1, paddingRight: 12 }}>
                                <Text style={{ color: colors.text }}>Default caption file</Text>
                                <Text style={{ color: colors.textSecondary, fontSize: 12 }}>Only one track may be marked default.</Text>
                              </View>
                              <Switch
                                accessibilityLabel={`Use caption track ${index + 1} as default`}
                                value={track.isDefault === true}
                                onValueChange={selected => setDefaultCaptionTrack(index, selected)}
                              />
                            </View>
                          </View>
                        ))}

                        <Text style={{ color: colors.text, fontWeight: 'bold', marginTop: 4, marginBottom: 5 }}>Adjacent transcript</Text>
                        <TextInput
                          accessibilityLabel="Video transcript text"
                          style={[styles.input, { minHeight: 150, textAlignVertical: 'top', borderColor: colors.border, color: colors.text, backgroundColor: colors.background }]}
                          placeholder="Paste the reviewed transcript here..."
                          placeholderTextColor={colors.textSecondary}
                          value={addForm.videoTranscriptText}
                          onChangeText={videoTranscriptText => setAddForm({ ...addForm, videoTranscriptText })}
                          multiline
                          maxLength={MAX_VIDEO_TRANSCRIPT_CHARACTERS}
                        />
                        <TextInput
                          accessibilityLabel="Video transcript HTTPS URL"
                          style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.background }]}
                          placeholder="Optional HTTPS transcript link"
                          placeholderTextColor={colors.textSecondary}
                          value={addForm.videoTranscriptUrl}
                          onChangeText={videoTranscriptUrl => setAddForm({ ...addForm, videoTranscriptUrl })}
                          autoCapitalize="none"
                          autoCorrect={false}
                          keyboardType="url"
                          maxLength={8_192}
                        />
                        <TextInput
                          accessibilityLabel="Video transcript label"
                          style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.background }]}
                          placeholder="Optional label, for example Full transcript"
                          placeholderTextColor={colors.textSecondary}
                          value={addForm.videoTranscriptLabel}
                          onChangeText={videoTranscriptLabel => setAddForm({ ...addForm, videoTranscriptLabel })}
                          maxLength={MAX_VIDEO_ALTERNATIVE_LABEL_CHARACTERS}
                        />
                      </View>
                    </>
                  )}
                </>
              )}

              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10, marginTop: 15, justifyContent: 'space-between' }}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={{ color: colors.text, fontWeight: 'bold' }}>Schedule & Dates</Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 12 }}>Optional for every content type, including announcements and custom panels.</Text>
                </View>
                <Switch
                  accessibilityLabel="Schedule content dates"
                  value={showDates}
                  onValueChange={value => {
                    setShowDates(value);
                    if (!value) {
                      setAddForm(previous => ({ ...previous, availableDate: '', displayDate: '' }));
                    }
                  }}
                />
              </View>

              {showDates && (
                <View style={{ backgroundColor: colors.background, padding: 15, borderRadius: 8, borderWidth: 1, borderColor: colors.border }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 15, justifyContent: 'space-between' }}>
                    <Text style={{ color: colors.text, fontWeight: 'bold' }}>Date Available</Text>
                    <DatePicker
                      courseId={courseId}
                      value={addForm.availableDate || ''}
                      onChange={(val) => setAddForm({...addForm, availableDate: val})}
                      accessibilityLabel="Content available date and time"
                    />
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={{ color: colors.text, fontWeight: 'bold' }}>Due / Display Date</Text>
                    <DatePicker
                      courseId={courseId}
                      value={addForm.displayDate || ''}
                      onChange={(val) => setAddForm({...addForm, displayDate: val})}
                      accessibilityLabel="Content due or display date and time"
                    />
                  </View>
                </View>
              )}

              {category === 'material' && allowFlashcardGeneration && (
                <View style={{ marginTop: 20, padding: 15, backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <View style={{ flex: 1, marginRight: 10 }}>
                      <Text style={{ color: colors.text, fontWeight: 'bold', fontSize: 16 }}>Generate Flashcards</Text>
                      <Text style={{ color: colors.textSecondary, fontSize: 12 }}>Generate source-grounded cards from the material description/notes, documents, captions, audio, or a short video.</Text>
                    </View>
                    <Switch 
                      accessibilityLabel="Generate a reviewed flashcard set"
                      value={addForm.generateFlashcards} 
                      onValueChange={(val) => setAddForm({...addForm, generateFlashcards: val})} 
                    />
                  </View>
                  
                  {addForm.generateFlashcards && (
                    <View style={{ marginTop: 15, paddingTop: 15, borderTopWidth: 1, borderColor: colors.border }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 15 }}>
                        <View style={{ flex: 1, paddingRight: 12 }}>
                          <Text style={{ color: colors.text }}>Description / notes to cards</Text>
                          <Text style={{ color: colors.textSecondary, fontSize: 12 }}>Uses the material description above as source text.</Text>
                        </View>
                        <Switch 
                          accessibilityLabel="Convert material description or notes to flashcards"
                          value={addForm.contentToCards} 
                          onValueChange={(val) => setAddForm({...addForm, contentToCards: val})} 
                        />
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <View style={{ flex: 1, paddingRight: 12 }}>
                          <Text style={{ color: colors.text }}>File to Cards</Text>
                          <Text style={{ color: colors.textSecondary, fontSize: 12 }}>Documents, notes, captions, audio, or video (50 MB media limit)</Text>
                        </View>
                        <Switch 
                          accessibilityLabel="Convert document to flashcards"
                          value={addForm.mediaToCards} 
                          onValueChange={(val) => setAddForm({...addForm, mediaToCards: val})} 
                        />
                      </View>
                      <Text style={{ color: colors.text, marginBottom: 6, marginTop: 15 }}>Maximum cards (1–100)</Text>
                      <TextInput
                        accessibilityLabel="Maximum generated flashcards"
                        style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.background }]}
                        value={String(addForm.flashcardCount)}
                        onChangeText={(value) => {
                          const parsed = Number(value.replace(/\D/g, ''));
                          setAddForm({ ...addForm, flashcardCount: Number.isFinite(parsed) ? Math.min(100, Math.max(1, parsed || 1)) : 30 });
                        }}
                        keyboardType="number-pad"
                        maxLength={3}
                      />
                    </View>
                  )}
                </View>
              )}
              {category === 'material' && !allowFlashcardGeneration && (
                <Text style={{ color: colors.textSecondary, marginTop: 16 }}>To create a new AI-reviewed flashcard set, add a new material item. Existing published source/card relationships are not silently replaced.</Text>
              )}

              {!!saveError && <Text accessibilityRole="alert" style={{ color: colors.error, marginTop: 16 }}>{saveError}</Text>}
              <TouchableOpacity 
                style={[styles.modalBtn, { backgroundColor: addForm.title && !saving ? colors.primary : colors.border, marginTop: 30, marginBottom: 40 }]} 
                disabled={!addForm.title || saving}
                onPress={() => void handleSave()}
                accessibilityRole="button"
                accessibilityLabel={addType === 'quiz'
                  ? 'Continue to assessment builder'
                  : isEditing ? 'Save course content changes' : 'Save and add to course'}
                accessibilityState={{ disabled: !addForm.title || saving, busy: saving }}
              >
                <Text style={{ color: addForm.title && !saving ? colors.buttonText : colors.textSecondary, textAlign: 'center', fontWeight: 'bold', fontSize: 16 }}>
                  {saving ? 'Saving…' : addType === 'quiz' ? 'Continue to Builder' : isEditing ? 'Save Changes' : 'Save & Add to Course'}
                </Text>
              </TouchableOpacity>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent: { width: '100%', maxWidth: 500, padding: 25, borderRadius: 16, borderWidth: 1 },
  modalBtn: { padding: 15, borderRadius: 8 },
  input: { borderWidth: 1, padding: 10, borderRadius: 8 }
});
