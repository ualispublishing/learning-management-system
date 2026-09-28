/**
 * @fileoverview src/components/lms/shared/BaseContentManager.tsx.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Modal } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useThemeColors } from '../../../lib/useThemeColors';
import { userAlert as Alert } from '../../../lib/userAlert';
import { useLMSStore } from '../../../lib/store/useLMSStore';
import { useCourseMembership, useCourseRole } from '../../../lib/store/selectors';
import { ContentItem, ContentCategory } from '../../../types/lms';
import { AssessmentBuilder } from '../AssessmentBuilder';
import { PopQuizHost } from '../PopQuizHost';
import { AssessmentGrader } from '../AssessmentGrader';
import { DatePicker } from '../DatePicker';
import { FlashcardReviewModal } from '../FlashcardReviewModal';
import { UnifiedContentCreator, ContentType, AddFormData } from './UnifiedContentCreator';
import { createEntityId } from '../../../lib/id';
import { assertAssetMatchesAIProvenance, getAssetService, StoredAsset } from '../../../lib/integration/assetService';
import { attachAIProcessingAttestation, FLASHCARD_PROMPT_VERSION } from '../../../lib/ai';
import { buildSequentialModuleScheduleChanges } from '../../../lib/coursePresentationBuckets';
import { restoreWithdrawnAnnouncementAsContent } from '../../../lib/chat/announcements';
import { getCourseVideoAlternatives, getCourseVideoAsset, isCourseVideoMimeType } from '../../../lib/coursePresentation';
import { areVideoCaptionTracksBoundToAsset, buildCourseVideoAlternatives } from '../../../lib/videoAlternatives';

const currentTimestamp = () => Date.now();
const DEFAULT_GROUP_LABELS = ['🔴', '🟦', '⭐️', 'Section 1', 'Pre-Midterm', 'First Release'];
const CONTENT_TYPES: ContentType[] = ['title_link', 'announcement', 'quiz', 'custom', 'pop_quiz', 'poll'];
const AI_SOURCE_EXTENSION = /\.(pdf|docx|pptx|txt|md|rtf|vtt|srt|mp3|m4a|wav|mp4|mov|webm)$/i;
const aiSourceKind = (fileName?: string, mimeType?: string): 'document' | 'captions' | 'audio' | 'video' => {
  const extension = fileName?.toLocaleLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (extension === 'vtt' || extension === 'srt') return 'captions';
  if (extension === 'mp3' || extension === 'm4a' || extension === 'wav' || (extension === 'webm' && mimeType?.toLocaleLowerCase().startsWith('audio/'))) return 'audio';
  if (extension === 'mp4' || extension === 'mov' || extension === 'webm') return 'video';
  return 'document';
};

const getFlashcardSourceText = (form: Partial<AddFormData>, type: ContentType | null): string | undefined => {
  if (!form.contentToCards) return undefined;
  const source = type === 'custom'
    ? [form.customHtml, form.customCss].filter(Boolean).join('\n\n')
    : form.description;
  return source?.trim() || undefined;
};

const inferContentType = (item: ContentItem): ContentType => {
  const configured = item.metadata?.lmsContentType;
  if (typeof configured === 'string' && CONTENT_TYPES.includes(configured as ContentType)) return configured as ContentType;
  if (item.isPoll) return 'poll';
  if (item.isPopQuiz) return 'pop_quiz';
  if (item.questions?.length) return 'quiz';
  if (item.description?.trim().startsWith('{')) {
    try {
      const payload: unknown = JSON.parse(item.description);
      if (payload && typeof payload === 'object' && !Array.isArray(payload) && ('html' in payload || 'css' in payload)) return 'custom';
    } catch {
      // Invalid custom JSON is handled explicitly when the editor opens.
    }
  }
  return 'title_link';
};

const isLinkedAnnouncementContent = (item: ContentItem): boolean =>
  item.metadata?.lmsAnnouncementRequiresNewIdentity !== true
  && (inferContentType(item) === 'announcement'
    || typeof item.metadata?.lmsAnnouncementChatMessageId === 'string');
const isWithdrawnAnnouncementRestore = (item: ContentItem): boolean =>
  isLinkedAnnouncementContent(item) || item.metadata?.lmsAnnouncementRequiresNewIdentity === true;

export interface BaseContentManagerChildProps {
  courseId: string;
  courseContent: ContentItem[];
  deletedContent: ContentItem[];
  groupLabels: string[];
  mutationBusy: boolean;
  
  openAddModal: (category: ContentCategory, blockId?: string) => void;
  openEditModal: (item: ContentItem) => void;
  
  deleteItemConfirm: (itemId: string) => void;
  cyclePresentationSlot: (item: ContentItem) => void;
  toggleGroupSelection: (item: ContentItem, activeGroupIcon: string) => void;
  
  openAssessmentBuilder: (item: ContentItem) => void;
  openAssessmentGrader: (item: ContentItem) => void;
  openPopQuizHost: (item: ContentItem) => void;
  
  openRecentlyDeleted: () => void;
  openManageGroups: () => void;
  openManageLabels: () => void;
  openEditGroup: (label: string) => void;
  openScheduleBlock: (blockId: string, currentDate: string) => void;
}

export interface BaseContentManagerProps {
  courseId: string;
  renderContent: (props: BaseContentManagerChildProps) => React.ReactNode;
}

export const BaseContentManager = ({ courseId, renderContent }: BaseContentManagerProps) => {
  const colors = useThemeColors();
  const contentItems = useLMSStore(state => state.contentItems);
  
  const updateContentGroup = useLMSStore(state => state.updateContentGroup);
  const deleteContentItem = useLMSStore(state => state.deleteContentItem);
  const restoreContentItem = useLMSStore(state => state.restoreContentItem);
  const addContentItem = useLMSStore(state => state.addContentItem);
  const addContentItems = useLMSStore(state => state.addContentItems);
  const updateContentItem = useLMSStore(state => state.updateContentItem);
  const updateContentItems = useLMSStore(state => state.updateContentItems);
  const updateContentGrouping = useLMSStore(state => state.updateContentGrouping);
  const contentMutationError = useLMSStore(state => state.contentMutationError);
  const clearContentMutationError = useLMSStore(state => state.clearContentMutationError);
  const courseMutationError = useLMSStore(state => state.courseMutationError);
  const clearCourseMutationError = useLMSStore(state => state.clearCourseMutationError);
  
  const syncContentAnnouncementToChat = useLMSStore(state => state.syncContentAnnouncementToChat);
  const currentUserId = useLMSStore(state => state.currentUserId);
  const courseMembership = useCourseMembership(courseId);
  const currentUserRole = useCourseRole(courseId) ?? 'student';
  const course = useLMSStore(state => state.courses.find(candidate => candidate.id === courseId));
  const courseTitle = course?.title;
  const [now, setNow] = useState(currentTimestamp);

  useEffect(() => {
    const timer = setInterval(() => setNow(currentTimestamp()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const courseContentAll = contentItems.filter(i => i.courseId === courseId);
  const courseContent = courseContentAll.filter(i => !i.deletedAt);
  const deletedContentAll = courseContentAll.filter(i => !!i.deletedAt && (now - i.deletedAt < 86400000));
  const deletedBlockGroups = new Set(deletedContentAll
    .filter(item => item.presentationSlot === 'block-header' && item.groupIcon)
    .map(item => item.groupIcon!));
  const deletedContent = deletedContentAll.filter(item => item.presentationSlot === 'block-header' || !item.groupIcon || !deletedBlockGroups.has(item.groupIcon));
  const configuredGroupLabels = Array.isArray(course?.metadata?.lmsGroupLabels)
    ? course.metadata.lmsGroupLabels.filter((label): label is string => typeof label === 'string' && Boolean(label.trim())).map(label => label.trim())
    : DEFAULT_GROUP_LABELS;
  const assignedGroupLabels = courseContent
    .map(item => item.groupIcon)
    .filter((label): label is string => typeof label === 'string' && Boolean(label) && !label.startsWith('group:'));
  const groupLabels = Array.from(new Set([...configuredGroupLabels, ...assignedGroupLabels]));

  // Modals state
  const [editGroupIcon, setEditGroupIcon] = useState<string | null>(null);
  const [editGroupForm, setEditGroupForm] = useState<{ presentationSlot: 'past'|'current'|'future'|'scheduled', availableDate: string }>({ presentationSlot: 'current', availableDate: '' });
  const [manageLabelsVisible, setManageLabelsVisible] = useState(false);
  const [manageGroupsVisible, setManageGroupsVisible] = useState(false);
  const [manageGroupSelected, setManageGroupSelected] = useState<string | null>(null);
  const [manageGroupForm, setManageGroupForm] = useState<{ presentationSlot: 'past'|'current'|'future'|'scheduled'|'block-header', availableDate: string, displayDate: string }>({ presentationSlot: 'current', availableDate: '', displayDate: '' });
  
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);
  const [recentlyDeletedVisible, setRecentlyDeletedVisible] = useState(false);
  const [isDeletingItem, setIsDeletingItem] = useState(false);
  const [restoringItemId, setRestoringItemId] = useState<string | null>(null);
  
  const [builderItem, setBuilderItem] = useState<ContentItem | null>(null);
  const [builderItemIsNew, setBuilderItemIsNew] = useState(false);
  const [graderItem, setGraderItem] = useState<ContentItem | null>(null);
  const [hostItem, setHostItem] = useState<ContentItem | null>(null);

  // Add Content Modal state
  const [addCategory, setAddCategory] = useState<ContentCategory | null>(null);
  const [addType, setAddType] = useState<ContentType | null>(null);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [addForm, setAddForm] = useState<Partial<AddFormData>>({
    title: '', description: '', url: '', fileName: '', fileUri: '', fileMimeType: '', displayDate: '', availableDate: '', isGraded: true, gradingCategory: Object.keys(course?.gradingWeights || {})[0] || '', isPopQuiz: false, isGroup: false, groupSetId: '',
    customLanguage: 'html', customHtml: '', customCss: '',
    generateFlashcards: false, contentToCards: true, mediaToCards: false, flashcardCount: 30,
    videoCaptionTracks: [], videoTranscriptText: '', videoTranscriptUrl: '', videoTranscriptLabel: '',
  });
  
  const [flashcardReviewVisible, setFlashcardReviewVisible] = useState(false);
  const assetUploadCache = useRef(new Map<string, Promise<StoredAsset>>());
  const [contentGroupOperationBusy, setContentGroupOperationBusy] = useState(false);
  const contentGroupOperationRef = useRef(false);
  const [groupLabelDrafts, setGroupLabelDrafts] = useState<Record<string, string>>({});

  const runContentGroupOperation = async (operation: () => Promise<void>): Promise<boolean> => {
    if (contentGroupOperationRef.current) {
      Alert.alert('Update in progress', 'Wait for the current course-group update to finish before making another change.');
      return false;
    }
    contentGroupOperationRef.current = true;
    setContentGroupOperationBusy(true);
    try {
      await operation();
      return true;
    } catch {
      // The persistent repository error banner remains visible after the modal closes.
      return false;
    } finally {
      contentGroupOperationRef.current = false;
      setContentGroupOperationBusy(false);
    }
  };

  // Scheduling Block State (for Sequential)
  const [scheduleBlockId, setScheduleBlockId] = useState<string | null>(null);
  const [scheduleDate, setScheduleDate] = useState('');

  const toggleGroupSelection = (item: ContentItem, activeGroupIcon: string) => {
    if (item.groupIcon === activeGroupIcon) {
      void runContentGroupOperation(() => updateContentGroup([item.id], { groupIcon: undefined }));
    } else {
      void runContentGroupOperation(() => updateContentGroup([item.id], { groupIcon: activeGroupIcon }));
    }
  };

  const cyclePresentationSlot = (item: ContentItem) => {
    if (item.presentationSlot === 'scheduled') {
      void runContentGroupOperation(() => updateContentGroup([item.id], { presentationSlot: 'past', availableDate: undefined }));
      return;
    }
    const slots: ('past' | 'current' | 'future')[] = ['past', 'current', 'future'];
    const currentSlot = item.presentationSlot as 'past' | 'current' | 'future';
    const nextIdx = (slots.indexOf(currentSlot) + 1) % slots.length;
    void runContentGroupOperation(() => updateContentGroup([item.id], { presentationSlot: slots[nextIdx], availableDate: undefined }));
  };

  const resolveContentAsset = async (form: Partial<AddFormData>): Promise<{ url?: string; asset?: StoredAsset }> => {
    if (!form.fileUri) return { url: form.url || undefined };
    const signature = JSON.stringify([courseId, form.fileUri, form.fileName, form.fileMimeType, form.fileSize]);
    let upload = assetUploadCache.current.get(signature);
    if (!upload) {
      if (assetUploadCache.current.size >= 20) {
        const oldest = assetUploadCache.current.keys().next().value;
        if (oldest) assetUploadCache.current.delete(oldest);
      }
      upload = getAssetService().upload({
        uri: form.fileUri,
        name: form.fileName || 'course-material',
        mimeType: form.fileMimeType || undefined,
        size: form.fileSize,
        file: form.file,
      }, { courseId, purpose: 'course-content', idempotencyKey: createEntityId('course-asset') });
      assetUploadCache.current.set(signature, upload);
    }
    try {
      const asset = await upload;
      return { url: asset.url, asset };
    } catch (error) {
      if (assetUploadCache.current.get(signature) === upload) assetUploadCache.current.delete(signature);
      throw error;
    }
  };

  const deliverContentAnnouncement = async (
    item: ContentItem,
    title: string,
    description?: string,
    active = true,
  ): Promise<void> => {
    const deliver = async (): Promise<void> => {
      try {
        await syncContentAnnouncementToChat({
          courseId,
          contentItemId: item.id,
          title,
          content: description,
          active,
          actorId: currentUserId || '',
          actorName: courseMembership?.name || 'Course Staff',
          actorRole: currentUserRole,
        });
      } catch (error) {
        Alert.alert(
          active ? 'Announcement delivery failed' : 'Announcement withdrawal pending',
          `The content item was saved, but its Chat announcement is not synchronized. ${error instanceof Error ? error.message : ''}`.trim(),
          [
            { text: 'Retry later', style: 'cancel' },
            { text: 'Retry now', onPress: () => { void deliver(); } },
          ],
        );
      }
    };
    await deliver();
  };

  const handleSaveItem = async (skipFlashcards = false, passedType?: ContentType, passedForm?: AddFormData) => {
    const currentType = passedType || (addType as ContentType | null);
    const currentForm = passedForm || addForm;
    if (!addCategory || !currentType || !currentForm.title) return;
    const editingItem = editingItemId ? courseContent.find(item => item.id === editingItemId) : undefined;
    if (currentType === 'announcement' && editingItem?.metadata?.lmsAnnouncementRequiresNewIdentity === true) {
      Alert.alert(
        'Create a new announcement',
        'This item was restored from a withdrawn announcement. Its original Chat message is permanently tombstoned, so publish a new Announcement item to receive a new canonical identity.',
      );
      return;
    }
    if (currentForm.isGroup && !course?.groupSets?.some(groupSet => groupSet.id === currentForm.groupSetId)) {
      Alert.alert('Group set required', 'Select a valid course group set before saving group coursework.');
      return;
    }
    const isAssessmentType = currentType === 'quiz' || currentType === 'pop_quiz' || currentType === 'poll';
    const shouldGrade = addCategory === 'coursework' && currentType !== 'poll' && currentForm.isGraded === true;
    const shouldUseLiveMode = currentType !== 'poll' && currentForm.isPopQuiz === true;
    
    if (currentForm.generateFlashcards && !skipFlashcards) {
      const sourceText = getFlashcardSourceText(currentForm, currentType);
      const hasDocument = currentForm.mediaToCards === true && Boolean(currentForm.fileUri);
      if (!sourceText && !hasDocument) {
        throw new Error('Select File to Cards or enter source content before generating flashcards.');
      }
      if (currentForm.mediaToCards && !currentForm.fileUri) {
        throw new Error('Select a supported document, note, caption, audio, or video file before enabling File to Cards.');
      }
      if (hasDocument && !AI_SOURCE_EXTENSION.test(currentForm.fileName || '')) {
        throw new Error('File to Cards supports PDF, DOCX, PPTX, TXT, Markdown, RTF, VTT/SRT captions, MP3/M4A/WAV audio, and MP4/MOV/WebM video.');
      }
      setFlashcardReviewVisible(true);
      return;
    }

    const videoAlternatives = buildCourseVideoAlternatives({
      captionTracks: currentForm.videoCaptionTracks,
      transcriptText: currentForm.videoTranscriptText,
      transcriptUrl: currentForm.videoTranscriptUrl,
      transcriptLabel: currentForm.videoTranscriptLabel,
    });

    let resolvedContent: { url?: string; asset?: StoredAsset };
    try {
      resolvedContent = await resolveContentAsset(currentForm);
    } catch (error) {
      Alert.alert('Upload failed', error instanceof Error ? error.message : 'Course material could not be uploaded.');
      return;
    }
    const resultingVideoAsset = resolvedContent.asset
      ? (isCourseVideoMimeType(resolvedContent.asset.mimeType) ? resolvedContent.asset : null)
      : editingItem ? getCourseVideoAsset(editingItem) : null;
    if (videoAlternatives && !resultingVideoAsset) {
      throw new Error('Captions and transcripts can only be saved with an uploaded institution-hosted video.');
    }
    if (videoAlternatives && !areVideoCaptionTracksBoundToAsset(videoAlternatives, resultingVideoAsset?.url)) {
      throw new Error('Caption files must use the same HTTPS origin as the uploaded video asset.');
    }
    
    let finalDescription = currentForm.description || '';
    if (currentType === 'custom') {
      finalDescription = JSON.stringify({
        html: currentForm.customHtml,
        css: currentForm.customCss,
        isCustomWidget: true,
      });
    }

    let blockInfo: { groupIcon?: string, availableDate?: string } = {};
    if (activeBlockId) {
      const blocks = courseContent.filter(i => i.category === 'admin' && i.presentationSlot === 'block-header');
      const block = blocks.find(b => b.id === activeBlockId);
      if (block) {
        blockInfo.groupIcon = block.groupIcon;
        blockInfo.availableDate = block.availableDate;
      }
    }
    
    if (editingItemId) {
      try {
        const existingItem = courseContent.find(item => item.id === editingItemId);
        await updateContentItem(editingItemId, {
          title: currentForm.title,
          description: finalDescription,
          contentUrl: resolvedContent.url,
          ...(resolvedContent.asset ? {
            metadata: {
              ...(courseContent.find(item => item.id === editingItemId)?.metadata || {}),
              asset: resolvedContent.asset,
              lmsContentType: currentType,
              lmsAnnouncementActive: currentType === 'announcement',
            },
          } : { metadata: {
            ...(courseContent.find(item => item.id === editingItemId)?.metadata || {}),
            lmsContentType: currentType,
            lmsAnnouncementActive: currentType === 'announcement',
          } }),
          displayDate: currentForm.displayDate || undefined,
          availableDate: currentForm.availableDate || undefined,
          presentationSlot: currentForm.availableDate
            ? 'scheduled'
            : existingItem?.presentationSlot === 'scheduled' ? 'current' : existingItem?.presentationSlot,
          isGraded: shouldGrade,
          gradingCategory: shouldGrade ? currentForm.gradingCategory || undefined : undefined,
          isPopQuiz: shouldUseLiveMode,
          workType: shouldUseLiveMode || currentType === 'poll' ? 'individual' : currentForm.isGroup ? 'group' : 'individual',
          groupSetId: shouldUseLiveMode || currentType === 'poll' ? undefined : currentForm.isGroup ? currentForm.groupSetId : undefined,
          videoAlternatives,
        });
        if (currentType === 'announcement' && existingItem) {
          await deliverContentAnnouncement(
            { ...existingItem, title: currentForm.title, description: currentForm.description || '' },
            currentForm.title,
            currentForm.description,
          );
        } else if (existingItem && isLinkedAnnouncementContent(existingItem)) {
          await deliverContentAnnouncement(existingItem, existingItem.title, existingItem.description, false);
        }
      } catch (error) {
        throw error;
      }
    } else {
      const newItem: ContentItem = {
        id: createEntityId('content'),
        courseId,
        category: addCategory,
        title: currentForm.title,
        description: finalDescription,
        contentUrl: resolvedContent.url,
        displayDate: currentForm.displayDate || undefined,
        availableDate: currentForm.availableDate || blockInfo.availableDate,
        workType: shouldUseLiveMode || currentType === 'poll' ? 'individual' : currentForm.isGroup ? 'group' : 'individual',
        groupSetId: shouldUseLiveMode || currentType === 'poll' ? undefined : currentForm.isGroup ? currentForm.groupSetId : undefined,
        presentationSlot: currentForm.availableDate || blockInfo.availableDate ? 'scheduled' : 'current',
        createdAt: currentTimestamp(),
        isGraded: shouldGrade,
        gradingCategory: shouldGrade ? currentForm.gradingCategory || Object.keys(course?.gradingWeights || {})[0] : undefined,
        isPopQuiz: shouldUseLiveMode,
        isPoll: currentType === 'poll',
        videoAlternatives,
        groupIcon: blockInfo.groupIcon,
        questions: isAssessmentType ? [] : undefined,
        quizConfig: isAssessmentType
          ? { questionsPerPage: 'all', maxAttempts: 1, allowRevisit: true, enforceTimer: false }
          : undefined,
        metadata: {
          ...(resolvedContent.asset ? { asset: resolvedContent.asset } : {}),
          lmsContentType: currentType,
          lmsAnnouncementActive: currentType === 'announcement',
        },
      };
      if (isAssessmentType) {
        setBuilderItem(newItem);
        setBuilderItemIsNew(true);
      } else {
        try {
          await addContentItem(newItem);
        } catch (error) {
          throw error;
        }
      }
      
      if (currentType === 'announcement') {
        await deliverContentAnnouncement(newItem, currentForm.title, currentForm.description);
      }
    }
    
    setAddCategory(null);
    setAddType(null);
    setAddForm({ 
      title: '', description: '', url: '', fileName: '', fileUri: '', fileMimeType: '', displayDate: '', availableDate: '', isGraded: true, gradingCategory: Object.keys(course?.gradingWeights || {})[0] || '', isPopQuiz: false, isGroup: false, groupSetId: '',
      customLanguage: 'html', customHtml: '', customCss: '',
      generateFlashcards: false, contentToCards: true, mediaToCards: false, flashcardCount: 30,
      videoCaptionTracks: [], videoTranscriptText: '', videoTranscriptUrl: '', videoTranscriptLabel: '',
    });
    setEditingItemId(null);
    setActiveBlockId(null);
  };

  const handleScheduleBlock = async () => {
    if (!scheduleBlockId) return;
    const changes = buildSequentialModuleScheduleChanges(courseContent, scheduleBlockId, scheduleDate);
    if (!changes.length) return;
    const saved = await runContentGroupOperation(() => updateContentItems(changes));
    if (saved) {
      setScheduleBlockId(null);
      setScheduleDate('');
    }
  };

  const openAddModal = (category: ContentCategory, blockId?: string) => {
    setAddCategory(category);
    if (blockId) setActiveBlockId(blockId);
  };

  const openEditModal = (item: ContentItem) => {
    const contentType = isLinkedAnnouncementContent(item) ? 'announcement' : inferContentType(item);
    const videoAlternatives = getCourseVideoAlternatives(item);
    let parsedHtml = ''; let parsedCss = '';
    if (contentType === 'custom') {
      try {
        const parsed: unknown = JSON.parse(item.description || '{}');
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
        if ('html' in parsed && typeof parsed.html === 'string') parsedHtml = parsed.html;
        if ('css' in parsed && typeof parsed.css === 'string') parsedCss = parsed.css;
      } catch {
        Alert.alert('Custom content is malformed', 'This item contains invalid JSON. Correct it through the institution data source before editing so the original content is not overwritten.');
        return;
      }
    }
    
    setEditingItemId(item.id); 
    setAddForm({
      title: item.title,
      description: item.description || '',
      url: item.contentUrl || '',
      fileName: '',
      fileUri: '',
      fileMimeType: '',
      displayDate: item.displayDate || '',
      availableDate: item.availableDate || '',
      isGraded: item.isGraded === true,
      gradingCategory: item.gradingCategory || '',
      isPopQuiz: item.isPopQuiz === true,
      isGroup: item.workType === 'group',
      groupSetId: item.groupSetId || '',
      customLanguage: 'html', customHtml: parsedHtml, customCss: parsedCss,
      generateFlashcards: false, contentToCards: true, mediaToCards: false, flashcardCount: 30,
      videoCaptionTracks: videoAlternatives?.captionTracks?.map(track => ({ ...track })) || [],
      videoTranscriptText: videoAlternatives?.transcript?.text || '',
      videoTranscriptUrl: videoAlternatives?.transcript?.url || '',
      videoTranscriptLabel: videoAlternatives?.transcript?.label || '',
    }); 
    setAddCategory(item.category); 
    setAddType(contentType);
  };

  const deleteItemConfirm = (itemId: string) => {
    setItemToDelete(itemId);
  };

  const handleDeleteItem = async () => {
    if (!itemToDelete || isDeletingItem) return;
    const item = courseContentAll.find(candidate => candidate.id === itemToDelete);
    if (!item) {
      setItemToDelete(null);
      return;
    }
    const moduleItemIds = item.presentationSlot === 'block-header' && item.groupIcon
      ? courseContentAll.filter(candidate => candidate.id === item.id || candidate.groupIcon === item.groupIcon).map(candidate => candidate.id)
      : [];
    setIsDeletingItem(true);
    try {
      if (moduleItemIds.length > 1) {
        await updateContentGroup(moduleItemIds, { deletedAt: currentTimestamp() });
      } else {
        await deleteContentItem(itemToDelete);
      }
      setItemToDelete(null);
      const deletedIds = new Set(moduleItemIds.length > 1 ? moduleItemIds : [item.id]);
      const deletedAnnouncements = courseContentAll.filter(candidate => deletedIds.has(candidate.id) && isLinkedAnnouncementContent(candidate));
      for (const announcement of deletedAnnouncements) {
        await deliverContentAnnouncement(announcement, announcement.title, announcement.description, false);
      }
    } catch {
      // Keep the confirmation open and expose the repository error.
    } finally {
      setIsDeletingItem(false);
    }
  };

  const restoreDeletedItem = async (item: ContentItem) => {
    if (restoringItemId) return;
    setRestoringItemId(item.id);
    try {
      if (item.presentationSlot === 'block-header' && item.groupIcon) {
        const moduleItems = courseContentAll
          .filter(candidate => candidate.id === item.id || candidate.groupIcon === item.groupIcon);
        const restoredAt = currentTimestamp();
        await updateContentItems(moduleItems.map(candidate => ({
          itemId: candidate.id,
          updates: isLinkedAnnouncementContent(candidate)
            ? restoreWithdrawnAnnouncementAsContent(candidate, restoredAt)
            : { deletedAt: undefined },
        })));
        if (moduleItems.some(isWithdrawnAnnouncementRestore)) {
          Alert.alert(
            'Module restored with announcement drafts',
            'Withdrawn announcements were restored as ordinary course content. Their Chat tombstones remain permanent; create new Announcement items when you are ready to republish them.',
          );
        }
      } else if (isLinkedAnnouncementContent(item)) {
        const { deletedAt: _restoredDeletedAt, ...ordinaryContentUpdates } = restoreWithdrawnAnnouncementAsContent(item, currentTimestamp());
        // Convert while the item is still deleted, then use the repository's
        // dedicated restore operation so retention/authorization checks are
        // not bypassed. A failed second step leaves the item safely deleted.
        await updateContentItem(item.id, ordinaryContentUpdates);
        await restoreContentItem(item.id);
        Alert.alert(
          'Restored as course content',
          'The prior Chat announcement remains permanently withdrawn. This item is now ordinary course content; create a new Announcement item to publish it again with a new identity.',
        );
      } else if (item.metadata?.lmsAnnouncementRequiresNewIdentity === true) {
        await restoreContentItem(item.id);
        Alert.alert(
          'Restored as course content',
          'The prior Chat announcement remains permanently withdrawn. This item is ordinary course content; create a new Announcement item to publish it again with a new identity.',
        );
      } else {
        await restoreContentItem(item.id);
      }
    } catch {
      // The persistent mutation banner exposes the repository error.
    } finally {
      setRestoringItemId(null);
    }
  };

  const openEditGroup = (label: string) => {
    const firstItem = courseContent.find(item => item.groupIcon === label);
    setEditGroupForm({
      presentationSlot: firstItem?.presentationSlot === 'scheduled' ? 'scheduled' : (firstItem?.presentationSlot as 'past'|'current'|'future' | undefined) || 'current',
      availableDate: firstItem?.availableDate || '',
    });
    setEditGroupIcon(label);
  };

  const saveEditedGroup = async () => {
    if (!editGroupIcon) return;
    const itemIds = courseContent.filter(item => item.groupIcon === editGroupIcon).map(item => item.id);
    if (!itemIds.length) {
      Alert.alert('Nothing to update', 'This label has no assigned content items.');
      return;
    }
    if (editGroupForm.presentationSlot === 'scheduled' && !editGroupForm.availableDate) {
      Alert.alert('Release date required', 'Select an available date before scheduling this content group.');
      return;
    }
    const saved = await runContentGroupOperation(() => updateContentGroup(itemIds, {
        presentationSlot: editGroupForm.presentationSlot,
        availableDate: editGroupForm.presentationSlot === 'scheduled' ? editGroupForm.availableDate || undefined : undefined,
      }));
    if (saved) setEditGroupIcon(null);
  };

  const saveManagedGroup = async () => {
    if (!manageGroupSelected) return;
    const itemIds = courseContent.filter(item => item.groupIcon === manageGroupSelected).map(item => item.id);
    if (!itemIds.length) {
      Alert.alert('Nothing to update', 'This label has no assigned content items.');
      return;
    }
    if (manageGroupForm.presentationSlot === 'scheduled' && !manageGroupForm.availableDate) {
      Alert.alert('Release date required', 'Select an available date before scheduling this content group.');
      return;
    }
    const saved = await runContentGroupOperation(() => updateContentGroup(itemIds, {
        presentationSlot: manageGroupForm.presentationSlot,
        availableDate: manageGroupForm.presentationSlot === 'scheduled' ? manageGroupForm.availableDate || undefined : undefined,
        displayDate: manageGroupForm.displayDate || undefined,
      }));
    if (saved) {
      Alert.alert('Group updated', `Saved ${itemIds.length} item${itemIds.length === 1 ? '' : 's'} in ${manageGroupSelected}.`);
      setManageGroupSelected(null);
    }
  };

  const persistGroupLabels = async (labels: string[], changes: { itemId: string; updates: Partial<ContentItem> }[] = []) => {
    if (!course) throw new Error('Course was not found.');
    const normalized = Array.from(new Set(labels.map(label => label.trim()).filter(Boolean)));
    await updateContentGrouping(courseId, normalized, changes);
  };

  const renameCourseGroupLabel = async (oldLabel: string, newLabel: string): Promise<boolean> => {
    const normalized = newLabel.trim();
    if (!normalized || normalized === oldLabel) return false;
    if (groupLabels.some(label => label !== oldLabel && label.toLocaleLowerCase() === normalized.toLocaleLowerCase())) {
      Alert.alert('Duplicate group label', `“${normalized}” already exists in this course.`);
      return false;
    }
    const affectedIds = courseContent.filter(item => item.groupIcon === oldLabel).map(item => item.id);
    const saved = await runContentGroupOperation(() => persistGroupLabels(
        groupLabels.map(label => label === oldLabel ? normalized : label),
        affectedIds.map(itemId => ({ itemId, updates: { groupIcon: normalized } })),
      ));
    if (saved) setGroupLabelDrafts(previous => {
      const next = { ...previous };
      delete next[oldLabel];
      return next;
    });
    return saved;
  };

  const removeCourseGroupLabel = async (label: string) => {
    if (courseContent.some(item => item.groupIcon === label)) {
      Alert.alert('Group label is in use', 'Remove or reassign the content items in this group before deleting its label.');
      return;
    }
    await runContentGroupOperation(() => persistGroupLabels(groupLabels.filter(candidate => candidate !== label)));
  };

  const addCourseGroupLabel = async () => {
    let suffix = groupLabels.length + 1;
    let label = `Group ${suffix}`;
    while (groupLabels.includes(label)) {
      suffix += 1;
      label = `Group ${suffix}`;
    }
    await runContentGroupOperation(() => persistGroupLabels([...groupLabels, label]));
  };

  const childProps: BaseContentManagerChildProps = {
    courseId,
    courseContent,
    deletedContent,
    groupLabels,
    mutationBusy: contentGroupOperationBusy,
    openAddModal,
    openEditModal,
    deleteItemConfirm,
    cyclePresentationSlot,
    toggleGroupSelection,
    openAssessmentBuilder: item => { setBuilderItem(item); setBuilderItemIsNew(false); },
    openAssessmentGrader: setGraderItem,
    openPopQuizHost: setHostItem,
    openRecentlyDeleted: () => setRecentlyDeletedVisible(true),
    openManageGroups: () => setManageGroupsVisible(true),
    openManageLabels: () => setManageLabelsVisible(true),
    openEditGroup,
    openScheduleBlock: (blockId, currentDate) => {
      setScheduleBlockId(blockId);
      setScheduleDate(currentDate);
    },
  };

  return (
    <>
      {!!(contentMutationError || courseMutationError) && (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Dismiss content error"
          onPress={() => { clearContentMutationError(); clearCourseMutationError(); }}
          style={{ margin: 15, marginBottom: 0, padding: 12, borderRadius: 8, backgroundColor: colors.error }}
        >
          <Text accessibilityRole="alert" style={{ color: colors.onError, fontWeight: '600' }}>{contentMutationError || courseMutationError} Tap to dismiss.</Text>
        </TouchableOpacity>
      )}
      {/* The callbacks in childProps read operation refs only after a user event;
          renderContent receives the callbacks but does not invoke them here. */}
      {/* eslint-disable-next-line react-hooks/refs */}
      {renderContent(childProps)}

      {/* Add Content Modal */}
      {addCategory && (
        <UnifiedContentCreator 
          visible={!!addCategory} 
          category={addCategory} 
          courseId={courseId} 
          isEditing={!!editingItemId}
          initialType={addType} 
          initialData={addForm} 
          gradingCategories={Object.keys(course?.gradingWeights || {})}
          groupSets={course?.groupSets || []}
          allowFlashcardGeneration={!editingItemId}
          onClose={() => { 
            setAddCategory(null); 
            setAddType(null); 
            setEditingItemId(null);
            setActiveBlockId(null);
            setAddForm({ 
              title: '', description: '', url: '', fileName: '', fileUri: '', fileMimeType: '', displayDate: '', availableDate: '', isGraded: true, gradingCategory: Object.keys(course?.gradingWeights || {})[0] || '', isPopQuiz: false, isGroup: false, groupSetId: '',
              customLanguage: 'html', customHtml: '', customCss: '',
              generateFlashcards: false, contentToCards: true, mediaToCards: false, flashcardCount: 30,
              videoCaptionTracks: [], videoTranscriptText: '', videoTranscriptUrl: '', videoTranscriptLabel: '',
            }); 
          }} 
          onSave={async (type, data) => { setAddType(type); setAddForm(data); await handleSaveItem(false, type, data); }} 
        />
      )}

      {/* Delete Confirmation Modal */}
      <Modal visible={!!itemToDelete} transparent animationType="fade" onRequestClose={() => {
        if (!isDeletingItem) setItemToDelete(null);
      }}>
        <View style={styles.modalOverlay}>
          <View accessibilityViewIsModal style={[styles.modalContent, { backgroundColor: colors.card, borderColor: colors.border }]}> 
            <Text accessibilityRole="header" style={{ fontSize: 20, fontWeight: 'bold', marginBottom: 15, color: '#D32F2F' }}>Confirm Deletion</Text>
            <Text style={{ color: colors.textSecondary, marginBottom: 20 }}>
              {(() => {
                const item = courseContentAll.find(candidate => candidate.id === itemToDelete);
                const moduleCount = item?.presentationSlot === 'block-header' && item.groupIcon
                  ? courseContentAll.filter(candidate => candidate.id === item.id || candidate.groupIcon === item.groupIcon).length
                  : 0;
                return moduleCount > 1
                  ? `This module and all ${moduleCount - 1} child item${moduleCount === 2 ? '' : 's'} will move to Recently Deleted as one recoverable unit for 24 hours.`
                  : 'This item will move to Recently Deleted and can be restored within 24 hours.';
              })()}
            </Text>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
               <TouchableOpacity disabled={isDeletingItem} style={[styles.modalBtn, { backgroundColor: colors.border, flex: 1, marginRight: 5, opacity: isDeletingItem ? 0.5 : 1 }]} onPress={() => setItemToDelete(null)} accessibilityRole="button" accessibilityLabel="Cancel deletion" accessibilityState={{ disabled: isDeletingItem }}>
                 <Text style={{ color: colors.text, textAlign: 'center' }}>Cancel</Text>
               </TouchableOpacity>
               <TouchableOpacity 
                 style={[styles.modalBtn, { backgroundColor: '#FF5252', flex: 1, marginLeft: 5 }]} 
                 disabled={isDeletingItem}
                 onPress={() => void handleDeleteItem()}
                 accessibilityRole="button"
                 accessibilityLabel="Confirm content deletion"
                 accessibilityState={{ disabled: isDeletingItem, busy: isDeletingItem }}
               >
                 <Text style={{ color: '#fff', textAlign: 'center', fontWeight: 'bold' }}>{isDeletingItem ? 'Deleting…' : 'Delete'}</Text>
               </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Recently Deleted Modal */}
      <Modal visible={recentlyDeletedVisible} transparent animationType="slide" onRequestClose={() => {
        if (!restoringItemId) setRecentlyDeletedVisible(false);
      }}>
        <View style={styles.modalOverlay}>
          <View accessibilityViewIsModal style={[styles.modalContent, { backgroundColor: colors.background, borderColor: colors.border, marginTop: 100, height: '100%', borderRadius: 24 }]}> 
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 24, fontWeight: 'bold' }}>Recently Deleted</Text>
              <TouchableOpacity disabled={restoringItemId !== null} onPress={() => setRecentlyDeletedVisible(false)} accessibilityRole="button" accessibilityLabel="Close recently deleted" accessibilityState={{ disabled: restoringItemId !== null }}>
                <Ionicons name="close-circle" size={28} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <Text style={{ color: colors.textSecondary, marginBottom: 15 }}>Items stop being recoverable here after 24 hours. Your institution’s retention policy still applies.</Text>
            
            <ScrollView keyboardShouldPersistTaps="handled">
              {deletedContent.length === 0 ? (
                <Text style={{ color: colors.textSecondary, fontStyle: 'italic', textAlign: 'center', marginTop: 20 }}>No recently deleted items.</Text>
              ) : (
                deletedContent.map(item => {
                  const restoresAnnouncementAsContent = isWithdrawnAnnouncementRestore(item);
                  return (
                  <View key={item.id} style={{ padding: 15, borderWidth: 1, borderColor: colors.border, borderRadius: 12, marginBottom: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontWeight: 'bold' }}>{item.title}</Text>
                      <Text style={{ color: colors.textSecondary, fontSize: 12 }}>Deleted: {new Date(item.deletedAt || 0).toLocaleString()}</Text>
                      {restoresAnnouncementAsContent ? (
                        <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 4 }}>
                          Restores as ordinary content. The withdrawn Chat message stays tombstoned.
                        </Text>
                      ) : null}
                    </View>
                    <TouchableOpacity 
                      disabled={restoringItemId !== null}
                      style={{ paddingHorizontal: 15, paddingVertical: 8, backgroundColor: colors.primary + '20', borderRadius: 8, opacity: restoringItemId && restoringItemId !== item.id ? 0.5 : 1 }}
                      onPress={() => void restoreDeletedItem(item)}
                      accessibilityRole="button"
                      accessibilityLabel={`${item.presentationSlot === 'block-header' ? 'Restore module' : restoresAnnouncementAsContent ? 'Restore as course content' : 'Restore'} ${item.title}`}
                      accessibilityState={{ disabled: restoringItemId !== null, busy: restoringItemId === item.id }}
                    >
                      <Text style={{ color: colors.primary, fontWeight: 'bold' }}>{restoringItemId === item.id ? 'Restoring…' : item.presentationSlot === 'block-header' ? 'Restore module' : restoresAnnouncementAsContent ? 'Restore as content' : 'Restore'}</Text>
                    </TouchableOpacity>
                  </View>
                  );
                })
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Assessment Builder Module */}
      {!!builderItem && (
        <AssessmentBuilder item={builderItem} isNew={builderItemIsNew} onClose={() => { setBuilderItem(null); setBuilderItemIsNew(false); }} />
      )}

      {/* Flashcard Review Modal */}
      <FlashcardReviewModal 
        visible={flashcardReviewVisible}
        onClose={() => setFlashcardReviewVisible(false)}
        sourceText={getFlashcardSourceText(addForm, addType)}
        sourceDocument={addForm.mediaToCards && addForm.fileUri ? {
          uri: addForm.fileUri,
          name: addForm.fileName || 'course-material',
          mimeType: addForm.fileMimeType || undefined,
          size: addForm.fileSize,
          file: addForm.file,
          kind: aiSourceKind(addForm.fileName, addForm.fileMimeType),
        } : undefined}
        courseTitle={courseTitle}
        requestedCardCount={addForm.flashcardCount || 30}
        onApprove={async (cards, sourceAttestation) => {
          if (!addCategory || !addType || !addForm.title || editingItemId) {
            throw new Error('AI flashcard bundles can only be created from a new, titled course material item.');
          }
          const resolvedContent = await resolveContentAsset(addForm);
          if (addForm.mediaToCards) {
            if (!resolvedContent.asset) throw new Error('The reviewed document was not durably uploaded with the course material.');
            assertAssetMatchesAIProvenance(resolvedContent.asset, cards[0]?.provenance);
          }
          const block = activeBlockId
            ? courseContent.find(item => item.id === activeBlockId && item.presentationSlot === 'block-header')
            : undefined;
          const inheritedAvailableDate = addForm.availableDate || block?.availableDate;
          const videoAlternatives = buildCourseVideoAlternatives({
            captionTracks: addForm.videoCaptionTracks,
            transcriptText: addForm.videoTranscriptText,
            transcriptUrl: addForm.videoTranscriptUrl,
            transcriptLabel: addForm.videoTranscriptLabel,
          });
          if (videoAlternatives && !isCourseVideoMimeType(resolvedContent.asset?.mimeType)) {
            throw new Error('Captions and transcripts can only be saved with an uploaded institution-hosted video.');
          }
          if (videoAlternatives && !areVideoCaptionTracksBoundToAsset(videoAlternatives, resolvedContent.asset?.url)) {
            throw new Error('Caption files must use the same HTTPS origin as the uploaded video asset.');
          }
          const sourceItem: ContentItem = {
            id: createEntityId('content'),
            courseId,
            category: addCategory,
            title: addForm.title,
            description: addForm.description || '',
            contentUrl: resolvedContent.url,
            displayDate: addForm.displayDate || undefined,
            availableDate: addForm.availableDate || block?.availableDate,
            workType: addForm.isGroup ? 'group' : 'individual',
            groupSetId: addForm.isGroup ? addForm.groupSetId : undefined,
            presentationSlot: inheritedAvailableDate ? 'scheduled' : 'current',
            createdAt: currentTimestamp(),
            isGraded: false,
            gradingCategory: undefined,
            isPopQuiz: false,
            videoAlternatives,
            groupIcon: block?.groupIcon,
            metadata: { ...(resolvedContent.asset ? { asset: resolvedContent.asset } : {}), lmsContentType: addType },
          };
          const studyItem: ContentItem = {
            id: createEntityId('review-set'),
            courseId,
            category: 'material',
            title: `${addForm.title} - Auto-Generated Flashcards`,
            description: 'AI-generated review cards. Each card was reviewed before publishing.',
            displayDate: addForm.displayDate || undefined,
            availableDate: inheritedAvailableDate,
            presentationSlot: inheritedAvailableDate ? 'scheduled' : 'current',
            createdAt: currentTimestamp(),
            isGraded: false,
            isPopQuiz: false,
            groupIcon: block?.groupIcon || '💡',
            metadata: {
              ai: attachAIProcessingAttestation({
                task: 'flashcards',
                promptVersion: FLASHCARD_PROMPT_VERSION,
                sourceContentItemId: sourceItem.id,
                sourceFileName: addForm.fileName || undefined,
                sourceKind: addForm.fileName ? aiSourceKind(addForm.fileName, addForm.fileMimeType) : 'text',
                provenance: cards[0]?.provenance,
                humanReviewedAt: new Date().toISOString(),
              }, sourceAttestation),
            },
            studyCards: cards.map(card => ({
              id: card.id,
              front: card.front,
              back: card.back,
              tags: card.tags,
              sourceExcerpt: card.sourceExcerpt,
              sourceLocation: card.sourceLocation,
              confidence: card.confidence,
              reviewerEdited: card.reviewerEdited === true,
              reviewerVerified: card.reviewerVerified === true,
            })),
          };
          await addContentItems([sourceItem, studyItem]);
          setFlashcardReviewVisible(false);
          setAddCategory(null);
          setAddType(null);
          setAddForm({
            title: '', description: '', url: '', fileName: '', fileUri: '', fileMimeType: '', displayDate: '', availableDate: '', isGraded: true, gradingCategory: Object.keys(course?.gradingWeights || {})[0] || '', isPopQuiz: false, isGroup: false, groupSetId: '',
            customLanguage: 'html', customHtml: '', customCss: '',
            generateFlashcards: false, contentToCards: true, mediaToCards: false, flashcardCount: 30,
            videoCaptionTracks: [], videoTranscriptText: '', videoTranscriptUrl: '', videoTranscriptLabel: '',
          });
          setActiveBlockId(null);
        }}
      />

      {/* Assessment Grader Module */}
      {!!graderItem && (
        <AssessmentGrader item={graderItem} onClose={() => setGraderItem(null)} />
      )}
      
      {/* PopQuiz Host Module */}
      {!!hostItem && (
        <PopQuizHost item={hostItem} onClose={() => setHostItem(null)} />
      )}

      {/* Edit Group Modal */}
      <Modal visible={!!editGroupIcon} transparent animationType="fade" onRequestClose={() => {
        if (!contentGroupOperationRef.current) setEditGroupIcon(null);
      }}>
        <View style={styles.modalOverlay}>
          <View accessibilityViewIsModal pointerEvents={contentGroupOperationBusy ? 'none' : 'auto'} style={[styles.modalContent, { backgroundColor: colors.card, borderColor: colors.border, opacity: contentGroupOperationBusy ? 0.75 : 1 }]}> 
            <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 20, fontWeight: 'bold', marginBottom: 5 }}>
              {'Edit Group “'}{editGroupIcon}{'”'}
            </Text>
            <Text style={{ color: colors.textSecondary, marginBottom: 20, fontSize: 12 }}>
              Editing {courseContent.filter(i => i.groupIcon === editGroupIcon).length} items simultaneously.
            </Text>
            
            <Text style={{ color: colors.text, fontWeight: 'bold', marginBottom: 5 }}>Presentation Slot</Text>
            <View accessibilityRole="radiogroup" accessibilityLabel="Content group presentation slot" style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 15 }}>
              {(['past', 'current', 'future', 'scheduled'] as const).map(slot => (
                <TouchableOpacity 
                  key={slot}
                  style={{ flexGrow: 1, flexBasis: '45%', padding: 8, margin: 2, borderWidth: 1, borderColor: colors.border, alignItems: 'center', backgroundColor: colors.background }}
                  onPress={() => setEditGroupForm(form => ({ ...form, presentationSlot: slot }))}
                  accessibilityRole="radio"
                  accessibilityLabel={slot}
                  accessibilityState={{ checked: editGroupForm.presentationSlot === slot }}
                >
                  <Text style={{ color: editGroupForm.presentationSlot === slot ? colors.primary : colors.text, textTransform: 'capitalize', fontSize: 12, fontWeight: editGroupForm.presentationSlot === slot ? 'bold' : 'normal' }}>{slot}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {editGroupForm.presentationSlot === 'scheduled' && (
              <>
                <Text style={{ color: colors.text, fontWeight: 'bold', marginBottom: 5 }}>Release Date</Text>
                <View style={{ marginBottom: 20, zIndex: 100 }}>
                  <DatePicker courseId={courseId} value={editGroupForm.availableDate} onChange={value => setEditGroupForm(form => ({ ...form, availableDate: value }))} accessibilityLabel="Content group release date and time" />
                </View>
              </>
            )}
            
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }}>
               <TouchableOpacity style={[styles.modalBtn, { backgroundColor: colors.border, flex: 1, marginRight: 5 }]} onPress={() => setEditGroupIcon(null)} accessibilityRole="button" accessibilityLabel="Close group editor">
                 <Text style={{ color: colors.text, textAlign: 'center' }}>Close</Text>
               </TouchableOpacity>
               <TouchableOpacity disabled={contentGroupOperationBusy} style={[styles.modalBtn, { backgroundColor: colors.primary, flex: 1, marginLeft: 5 }]} onPress={() => void saveEditedGroup()} accessibilityRole="button" accessibilityLabel="Save content group changes" accessibilityState={{ disabled: contentGroupOperationBusy, busy: contentGroupOperationBusy }}>
                 <Text style={{ color: colors.buttonText, textAlign: 'center', fontWeight: 'bold' }}>{contentGroupOperationBusy ? 'Saving…' : 'Save Changes'}</Text>
               </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Manage Custom Labels Modal */}
      <Modal visible={manageLabelsVisible} transparent animationType="fade" onRequestClose={() => {
        if (!contentGroupOperationRef.current) setManageLabelsVisible(false);
      }}>
        <View style={styles.modalOverlay}>
          <View accessibilityViewIsModal pointerEvents={contentGroupOperationBusy ? 'none' : 'auto'} style={[styles.modalContent, { backgroundColor: colors.card, borderColor: colors.border, maxHeight: '80%', opacity: contentGroupOperationBusy ? 0.75 : 1 }]}> 
            <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 20, fontWeight: 'bold', marginBottom: 15 }}>Custom Group Labels</Text>
            
            <ScrollView keyboardShouldPersistTaps="handled" style={{ marginBottom: 20, maxHeight: 300 }}>
              {groupLabels.map(label => (
                <View key={label} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                  <TextInput
                    style={[styles.input, { flex: 1, borderColor: colors.border, color: colors.text, backgroundColor: colors.background }]}
                    value={groupLabelDrafts[label] ?? label}
                    onChangeText={value => setGroupLabelDrafts(previous => ({ ...previous, [label]: value }))}
                    onEndEditing={(e) => {
                      const val = e.nativeEvent.text.trim();
                      if (val && val !== label) {
                        void renameCourseGroupLabel(label, val).then(saved => {
                          if (!saved) setGroupLabelDrafts(previous => ({ ...previous, [label]: label }));
                        });
                      } else {
                        setGroupLabelDrafts(previous => ({ ...previous, [label]: label }));
                      }
                    }}
                    maxLength={120}
                    accessibilityLabel={`Group label ${label}`}
                  />
                  <TouchableOpacity 
                    style={{ marginLeft: 10, padding: 10 }}
                    onPress={() => {
                      void removeCourseGroupLabel(label);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete group label ${label}`}
                  >
                    <Ionicons name="trash" size={20} color="#FF5252" />
                  </TouchableOpacity>
                </View>
              ))}
              <TouchableOpacity 
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 10, borderWidth: 1, borderColor: colors.primary, borderStyle: 'dashed', borderRadius: 8, marginTop: 10 }}
                disabled={groupLabels.length >= 200}
                onPress={() => void addCourseGroupLabel()}
                accessibilityState={{ disabled: groupLabels.length >= 200 }}
                accessibilityRole="button"
                accessibilityLabel="Add group label"
              >
                <Ionicons name="add" size={18} color={groupLabels.length >= 200 ? colors.textSecondary : colors.primary} />
                <Text style={{ color: groupLabels.length >= 200 ? colors.textSecondary : colors.primary, marginLeft: 5 }}>{groupLabels.length >= 200 ? '200-label limit reached' : 'Add Row'}</Text>
              </TouchableOpacity>
            </ScrollView>

            <TouchableOpacity disabled={contentGroupOperationBusy} style={[styles.modalBtn, { backgroundColor: colors.primary }]} onPress={() => { if (!contentGroupOperationRef.current) setManageLabelsVisible(false); }} accessibilityRole="button" accessibilityLabel="Close custom group labels" accessibilityState={{ disabled: contentGroupOperationBusy }}>
              <Text style={{ color: colors.buttonText, textAlign: 'center', fontWeight: 'bold' }}>{contentGroupOperationBusy ? 'Saving…' : 'Done'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Manage Groups Modal */}
      <Modal visible={manageGroupsVisible} transparent animationType="fade" onRequestClose={() => {
        if (!contentGroupOperationRef.current) setManageGroupsVisible(false);
      }}>
        <View style={styles.modalOverlay}>
          <View accessibilityViewIsModal pointerEvents={contentGroupOperationBusy ? 'none' : 'auto'} style={[styles.modalContent, { backgroundColor: colors.background, borderColor: colors.border, maxHeight: '80%', opacity: contentGroupOperationBusy ? 0.75 : 1 }]}> 
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
              <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 18, fontWeight: 'bold' }}>Manage Groups</Text>
              <TouchableOpacity onPress={() => setManageGroupsVisible(false)} accessibilityRole="button" accessibilityLabel="Close group manager">
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            
            <ScrollView keyboardShouldPersistTaps="handled">
              {manageGroupSelected ? (
                <View>
                  <TouchableOpacity onPress={() => setManageGroupSelected(null)} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20 }} accessibilityRole="button" accessibilityLabel="Back to groups">
                    <Ionicons name="arrow-back" size={20} color={colors.primary} />
                    <Text style={{ color: colors.primary, fontWeight: 'bold', marginLeft: 5 }}>Back to Groups</Text>
                  </TouchableOpacity>
                  
                  <Text style={{ color: colors.text, fontSize: 20, fontWeight: 'bold', marginBottom: 20 }}>Edit Group: {manageGroupSelected}</Text>
                  
                  <Text style={{ color: colors.text, fontWeight: 'bold', marginBottom: 10 }}>Presentation Slot</Text>
                  <View accessibilityRole="radiogroup" accessibilityLabel="Managed group presentation slot" style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 20 }}>
                    {(['past', 'current', 'future', 'scheduled'] as const).map(slot => (
                      <TouchableOpacity 
                        key={slot}
                        style={{ flexGrow: 1, flexBasis: '45%', padding: 10, borderWidth: 1, borderColor: manageGroupForm.presentationSlot === slot ? colors.primary : colors.border, backgroundColor: manageGroupForm.presentationSlot === slot ? colors.primary + '20' : colors.card, alignItems: 'center', borderRadius: 8, margin: 2 }}
                        onPress={() => setManageGroupForm({ ...manageGroupForm, presentationSlot: slot })}
                        accessibilityRole="radio"
                        accessibilityLabel={slot}
                        accessibilityState={{ checked: manageGroupForm.presentationSlot === slot }}
                      >
                        <Text style={{ color: manageGroupForm.presentationSlot === slot ? colors.primary : colors.textSecondary, fontWeight: 'bold', fontSize: 12, textTransform: 'capitalize' }}>{slot}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {manageGroupForm.presentationSlot === 'scheduled' && (
                    <>
                      <Text style={{ color: colors.text, fontWeight: 'bold', marginBottom: 10 }}>Date Available</Text>
                      <View style={{ marginBottom: 20, zIndex: 100 }}>
                        <DatePicker 
                          courseId={courseId} 
                          value={manageGroupForm.availableDate} 
                          onChange={(val) => setManageGroupForm({...manageGroupForm, availableDate: val})} 
                          accessibilityLabel="Managed group available date and time"
                        />
                      </View>
                      
                      <Text style={{ color: colors.text, fontWeight: 'bold', marginBottom: 10 }}>Date Due</Text>
                      <View style={{ marginBottom: 30, zIndex: 90 }}>
                        <DatePicker 
                          courseId={courseId} 
                          value={manageGroupForm.displayDate} 
                          onChange={(val) => setManageGroupForm({...manageGroupForm, displayDate: val})} 
                          accessibilityLabel="Managed group due date and time"
                        />
                      </View>
                    </>
                  )}

                  <TouchableOpacity 
                    disabled={contentGroupOperationBusy}
                    style={[styles.modalBtn, { backgroundColor: colors.primary }]} 
                    onPress={() => void saveManagedGroup()}
                    accessibilityRole="button"
                    accessibilityLabel="Save managed group settings"
                    accessibilityState={{ disabled: contentGroupOperationBusy, busy: contentGroupOperationBusy }}
                  >
                    <Text style={{ color: colors.buttonText, textAlign: 'center', fontWeight: 'bold' }}>{contentGroupOperationBusy ? 'Saving…' : 'Save Group Settings'}</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View>
                  {groupLabels.map(label => {
                    const itemCount = courseContent.filter(i => i.groupIcon === label).length;
                    return (
                      <TouchableOpacity 
                        key={label}
                        style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 15, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 8, marginBottom: 10 }}
                        onPress={() => {
                          setManageGroupSelected(label);
                          const firstItem = courseContent.find(i => i.groupIcon === label);
                          setManageGroupForm({
                            presentationSlot: firstItem?.presentationSlot || 'current',
                            availableDate: firstItem?.availableDate || '',
                            displayDate: firstItem?.displayDate || '',
                          });
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`Manage group ${label}, ${itemCount} item${itemCount === 1 ? '' : 's'}`}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          <Text style={{ color: colors.text, fontSize: 18, fontWeight: 'bold' }}>{label}</Text>
                          <View style={{ backgroundColor: colors.border, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, marginLeft: 10 }}>
                            <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: 'bold' }}>{itemCount} items</Text>
                          </View>
                        </View>
                        <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Schedule Block Modal */}
      <Modal visible={!!scheduleBlockId} transparent animationType="fade" onRequestClose={() => {
        if (!contentGroupOperationRef.current) setScheduleBlockId(null);
      }}>
        <View style={styles.modalOverlay}>
          <View accessibilityViewIsModal pointerEvents={contentGroupOperationBusy ? 'none' : 'auto'} style={[styles.modalContent, { backgroundColor: colors.card, borderColor: colors.border, opacity: contentGroupOperationBusy ? 0.75 : 1 }]}> 
            <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 18, fontWeight: 'bold', marginBottom: 15 }}>Schedule Module</Text>
            <Text style={{ color: colors.textSecondary, marginBottom: 10 }}>Set an available date for this entire block and its items, or clear the date to make the module available immediately.</Text>
            
            <View style={{ marginBottom: 20, zIndex: 100 }}>
              <DatePicker 
                courseId={courseId} 
                value={scheduleDate} 
                onChange={setScheduleDate} 
                accessibilityLabel="Module available date and time"
              />
            </View>

            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 20 }}>
              <TouchableOpacity disabled={contentGroupOperationBusy} style={{ padding: 10, marginRight: 10 }} onPress={() => setScheduleBlockId(null)} accessibilityRole="button" accessibilityLabel="Cancel module scheduling" accessibilityState={{ disabled: contentGroupOperationBusy }}>
                <Text style={{ color: colors.textSecondary }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity disabled={contentGroupOperationBusy} style={{ padding: 10, backgroundColor: colors.primary, borderRadius: 8 }} onPress={() => void handleScheduleBlock()} accessibilityRole="button" accessibilityLabel="Save module availability" accessibilityState={{ disabled: contentGroupOperationBusy, busy: contentGroupOperationBusy }}>
                <Text style={{ color: colors.buttonText, fontWeight: 'bold' }}>{contentGroupOperationBusy ? 'Saving…' : 'Save Availability'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent: { width: '100%', maxWidth: 400, padding: 25, borderRadius: 16, borderWidth: 1 },
  modalBtn: { padding: 12, borderRadius: 8, marginTop: 10 },
  input: { borderWidth: 1, padding: 12, borderRadius: 8 }
});
