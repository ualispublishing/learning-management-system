/**
 * @fileoverview src/components/lms/CustomManager.tsx.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, useWindowDimensions } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLMSStore } from '../../lib/store/useLMSStore';
import { createEntityId } from '../../lib/id';
import { userAlert as Alert } from '../../lib/userAlert';
import { canonicalSafeHttpsUrl } from '../../lib/safeUrl';
import { CourseSitePresentationMode, isCustomCoursePresentationItem } from '../../lib/coursePresentation';
import { DatePicker } from './DatePicker';
import { parseCustomLearningWorkspace } from '../../lib/customLearningWorkspace';

interface StaticWidgetPayload {
  html: string;
  css: string;
}

const currentTimestamp = () => Date.now();

const parseStaticWidget = (description?: string): StaticWidgetPayload | null => {
  try {
    const value: unknown = JSON.parse(description || '');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const candidate = value as { html?: unknown; css?: unknown; isCustomWidget?: unknown };
    if (candidate.isCustomWidget !== true) return null;
    if (candidate.html !== undefined && typeof candidate.html !== 'string') return null;
    if (candidate.css !== undefined && typeof candidate.css !== 'string') return null;
    return { html: candidate.html || '', css: candidate.css || '' };
  } catch {
    return null;
  }
};

export const CustomManager = ({ courseId }: { courseId: string }) => {
  const { width: windowWidth } = useWindowDimensions();
  const colors = {
    background: '#1e1e1e',
    card: '#252526',
    border: '#333333',
    text: '#d4d4d4',
    textSecondary: '#b3b3b3',
    primary: '#569cd6',
    buttonText: '#000000',
    error: '#f44336'
  };

  const updateContentItem = useLMSStore(state => state.updateContentItem);
  const addContentItem = useLMSStore(state => state.addContentItem);
  const deleteContentItem = useLMSStore(state => state.deleteContentItem);
  const restoreContentItem = useLMSStore(state => state.restoreContentItem);
  const reorderContentItems = useLMSStore(state => state.reorderContentItems);
  const contentItems = useLMSStore(state => state.contentItems);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  
  const courseContent = useMemo(() => contentItems.filter(i => i.courseId === courseId), [contentItems, courseId]);
  const widgetItems = useMemo(() => courseContent.filter(item => !item.deletedAt && isCustomCoursePresentationItem(item))
    .sort((left, right) => (left.orderIndex ?? left.createdAt) - (right.orderIndex ?? right.createdAt) || left.id.localeCompare(right.id)), [courseContent]);
  const recentlyDeletedWidgets = useMemo(() => courseContent
    .filter(item => item.deletedAt && now - item.deletedAt < 86_400_000 && isCustomCoursePresentationItem(item))
    .sort((left, right) => (right.deletedAt ?? 0) - (left.deletedAt ?? 0)), [courseContent, now]);
  const initialItem = widgetItems[0] ?? null;
  const initialWorkspace = parseCustomLearningWorkspace(initialItem?.description);
  let initialWidget: StaticWidgetPayload = { html: '', css: '' };
  let initialWidgetError: string | null = null;
  if (initialItem && !initialItem.contentUrl && !initialWorkspace) {
    const parsed = parseStaticWidget(initialItem.description);
    if (parsed) initialWidget = parsed;
    else {
      initialWidgetError = 'This widget contains invalid configuration data and cannot be edited safely.';
    }
  }
  const [selectedItemId, setSelectedItemId] = useState<string | null>(initialItem?.id ?? null);
  const singleItem = widgetItems.find(item => item.id === selectedItemId) ?? null;

  // Link Editor State
  const [mode, setMode] = useState<'link' | 'code' | 'workspace'>(initialWorkspace ? 'workspace' : initialItem && !initialItem.contentUrl ? 'code' : 'link');
  const [linkTitle, setLinkTitle] = useState(initialItem?.contentUrl ? initialItem.title : '');
  const [linkUrl, setLinkUrl] = useState(initialItem?.contentUrl || '');
  const [linkPresentation, setLinkPresentation] = useState<CourseSitePresentationMode>(initialItem?.metadata?.lmsEmbedMode === 'external' ? 'external' : 'embedded');
  const [validationError, setValidationError] = useState<string | null>(initialWidgetError);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Code Editor State
  const [codeTitle, setCodeTitle] = useState(initialItem && !initialItem.contentUrl && !initialWorkspace ? initialItem.title : '');
  const [codeLang, setCodeLang] = useState<'html'|'css'>('html');
  const [htmlCode, setHtmlCode] = useState(initialWidget.html);
  const [cssCode, setCssCode] = useState(initialWidget.css);
  const [availableDate, setAvailableDate] = useState(initialItem?.availableDate || '');
  const [displayDate, setDisplayDate] = useState(initialItem?.displayDate || '');

  const isEditorDirty = () => {
    if (!singleItem) {
      return Boolean(linkTitle || linkUrl || codeTitle || htmlCode || cssCode || availableDate || displayDate);
    }
    if ((singleItem.availableDate || '') !== availableDate || (singleItem.displayDate || '') !== displayDate) return true;
    if (mode === 'workspace') return false;
    if (mode === 'link') {
      return !singleItem.contentUrl
        || singleItem.title !== linkTitle
        || singleItem.contentUrl !== linkUrl
        || (singleItem.metadata?.lmsEmbedMode === 'external' ? 'external' : 'embedded') !== linkPresentation;
    }
    const parsed = parseStaticWidget(singleItem.description);
    if (singleItem.contentUrl) return true;
    if (!parsed) return singleItem.title !== codeTitle || Boolean(htmlCode || cssCode);
    return singleItem.title !== codeTitle || parsed.html !== htmlCode || parsed.css !== cssCode;
  };

  const requestEditorTransition = (action: () => void) => {
    if (isSaving) return;
    if (!isEditorDirty()) {
      action();
      return;
    }
    Alert.alert('Discard unsaved custom-course changes?', 'The current link, code, or scheduling edits have not been saved.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: action },
    ]);
  };

  const selectWidget = (item: typeof widgetItems[number]) => {
    setSelectedItemId(item.id);
    setAvailableDate(item.availableDate || '');
    setDisplayDate(item.displayDate || '');
    setValidationError(null);
    setSaveStatus(null);
    if (item.contentUrl) {
      setMode('link');
      setLinkTitle(item.title);
      setLinkUrl(item.contentUrl);
      setLinkPresentation(item.metadata?.lmsEmbedMode === 'external' ? 'external' : 'embedded');
      return;
    }
    if (parseCustomLearningWorkspace(item.description)) {
      setMode('workspace');
      setCodeTitle('');
      setHtmlCode('');
      setCssCode('');
      return;
    }
    const parsed = parseStaticWidget(item.description);
    if (parsed) {
      setMode('code');
      setCodeTitle(item.title);
      setHtmlCode(parsed.html);
      setCssCode(parsed.css);
    } else {
      setMode('code');
      setCodeTitle(item.title);
      setHtmlCode('');
      setCssCode('');
      setValidationError('This widget contains invalid configuration data and cannot be edited safely.');
    }
  };

  const startNewWidget = () => {
    setSelectedItemId(null);
    setMode('link');
    setLinkTitle('');
    setLinkUrl('');
    setLinkPresentation('embedded');
    setCodeTitle('');
    setHtmlCode('');
    setCssCode('');
    setAvailableDate('');
    setDisplayDate('');
    setValidationError(null);
    setSaveStatus(null);
  };

  const handleSaveLink = async () => {
    if (isSaving) return;
    if (!linkTitle.trim() || !linkUrl.trim()) {
      setValidationError('A title and HTTPS URL are required.');
      return;
    }
    const canonicalUrl = canonicalSafeHttpsUrl(linkUrl.trim());
    if (!canonicalUrl) {
      setValidationError('Enter a valid HTTPS URL without embedded credentials.');
      return;
    }
    setValidationError(null);
    setSaveStatus(null);
    setIsSaving(true);
    try {
      const normalizedTitle = linkTitle.trim();
      const presentationSlot = availableDate
        ? 'scheduled'
        : singleItem?.presentationSlot === 'scheduled' ? 'current' : singleItem?.presentationSlot || 'current';
      if (singleItem) {
        const metadata = { ...(singleItem.metadata || {}) };
        delete metadata.lmsDemoPortal;
        await updateContentItem(singleItem.id, {
          title: normalizedTitle,
          description: linkPresentation === 'embedded' ? 'Embedded HTTPS course site' : 'External HTTPS course site',
          contentUrl: canonicalUrl,
          availableDate: availableDate || undefined,
          displayDate: displayDate || undefined,
          presentationSlot,
          metadata: { ...metadata, lmsContentType: 'custom', lmsCustomWidgetKind: 'link', lmsEmbedMode: linkPresentation },
        });
      } else {
        const id = createEntityId('content');
        await addContentItem({
          id,
          courseId,
          category: 'admin',
          title: normalizedTitle,
          description: linkPresentation === 'embedded' ? 'Embedded HTTPS course site' : 'External HTTPS course site',
          contentUrl: canonicalUrl,
          availableDate: availableDate || undefined,
          displayDate: displayDate || undefined,
          presentationSlot,
          createdAt: currentTimestamp(),
          metadata: { lmsContentType: 'custom', lmsCustomWidgetKind: 'link', lmsEmbedMode: linkPresentation },
        });
        setSelectedItemId(id);
      }
      setLinkTitle(normalizedTitle);
      setLinkUrl(canonicalUrl);
      setSaveStatus('Widget saved.');
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : 'Link could not be saved.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveCode = async () => {
    if (isSaving) return;
    if (!codeTitle.trim() || (!htmlCode.trim() && !cssCode.trim())) {
      setValidationError('A title and some HTML or CSS are required.');
      return;
    }
    
    const desc = JSON.stringify({
      html: htmlCode,
      css: cssCode,
      isCustomWidget: true
    });
    if (desc.length > 250_000) {
      setValidationError('The static widget exceeds the 250,000-character course-content limit. Split it into smaller widgets.');
      return;
    }
    
    setValidationError(null);
    setSaveStatus(null);
    setIsSaving(true);
    try {
      const normalizedTitle = codeTitle.trim();
      const presentationSlot = availableDate
        ? 'scheduled'
        : singleItem?.presentationSlot === 'scheduled' ? 'current' : singleItem?.presentationSlot || 'current';
      if (singleItem) {
        const metadata = { ...(singleItem.metadata || {}) };
        delete metadata.lmsDemoPortal;
        await updateContentItem(singleItem.id, {
          title: normalizedTitle,
          description: desc,
          contentUrl: undefined,
          availableDate: availableDate || undefined,
          displayDate: displayDate || undefined,
          presentationSlot,
          metadata: { ...metadata, lmsContentType: 'custom', lmsCustomWidgetKind: 'static' },
        });
      } else {
        const id = createEntityId('content');
        await addContentItem({
          id,
          courseId,
          category: 'admin',
          title: normalizedTitle,
          description: desc,
          availableDate: availableDate || undefined,
          displayDate: displayDate || undefined,
          presentationSlot,
          createdAt: currentTimestamp(),
          metadata: { lmsContentType: 'custom', lmsCustomWidgetKind: 'static' },
        });
        setSelectedItemId(id);
      }
      setCodeTitle(normalizedTitle);
      setSaveStatus('Widget saved.');
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : 'Widget could not be saved.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveWorkspaceSchedule = async () => {
    if (isSaving || !singleItem || !parseCustomLearningWorkspace(singleItem.description)) return;
    setValidationError(null);
    setSaveStatus(null);
    setIsSaving(true);
    try {
      await updateContentItem(singleItem.id, {
        availableDate: availableDate || undefined,
        displayDate: displayDate || undefined,
        presentationSlot: availableDate
          ? 'scheduled'
          : singleItem.presentationSlot === 'scheduled' ? 'current' : singleItem.presentationSlot,
      });
      setSaveStatus('Workspace schedule saved.');
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : 'Workspace schedule could not be saved.');
    } finally {
      setIsSaving(false);
    }
  };

  const confirmDeleteWidget = () => {
    if (!singleItem || isSaving) return;
    Alert.alert('Delete custom widget?', `“${singleItem.title}” will move to Recently Deleted for 24 hours.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          setIsSaving(true);
          setValidationError(null);
          void deleteContentItem(singleItem.id)
            .then(() => {
              setSelectedItemId(null);
              setLinkTitle('');
              setLinkUrl('');
              setLinkPresentation('embedded');
              setCodeTitle('');
              setHtmlCode('');
              setCssCode('');
              setAvailableDate('');
              setDisplayDate('');
              setSaveStatus('Widget moved to Recently Deleted.');
            })
            .catch(error => setValidationError(error instanceof Error ? error.message : 'Widget could not be deleted.'))
            .finally(() => setIsSaving(false));
        },
      },
    ]);
  };

  const restoreWidget = async (itemId: string) => {
    if (isSaving) return;
    setIsSaving(true);
    setValidationError(null);
    setSaveStatus(null);
    try {
      await restoreContentItem(itemId);
      setSaveStatus('Widget restored. Select it from Active Custom Widgets to continue editing.');
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : 'Widget could not be restored.');
    } finally {
      setIsSaving(false);
    }
  };

  const renderScheduleFields = () => (
    <View style={[styles.schedulePanel, { borderColor: colors.border, backgroundColor: colors.background }]}>
      <Text style={{ color: colors.text, fontWeight: 'bold', marginBottom: 4, fontFamily: 'monospace' }}>Learner availability</Text>
      <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 12 }}>Leave Date Available blank to publish immediately. Dates use the course time zone.</Text>
      <View style={styles.scheduleRow}>
        <Text style={{ color: colors.text, fontFamily: 'monospace', marginRight: 10 }}>Date Available</Text>
        <DatePicker courseId={courseId} value={availableDate} onChange={setAvailableDate} accessibilityLabel="Custom content available date and time" />
      </View>
      <View style={[styles.scheduleRow, { marginTop: 10 }]}>
        <Text style={{ color: colors.text, fontFamily: 'monospace', marginRight: 10 }}>Due / Display Date</Text>
        <DatePicker courseId={courseId} value={displayDate} onChange={setDisplayDate} accessibilityLabel="Custom content due or display date and time" />
      </View>
    </View>
  );

  const moveWidget = async (itemId: string, direction: -1 | 1) => {
    if (isSaving) return;
    const currentIndex = widgetItems.findIndex(item => item.id === itemId);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= widgetItems.length) return;
    const reordered = [...widgetItems];
    [reordered[currentIndex], reordered[targetIndex]] = [reordered[targetIndex], reordered[currentIndex]];
    setIsSaving(true);
    setValidationError(null);
    setSaveStatus(null);
    try {
      await reorderContentItems(reordered);
      setSaveStatus('Widget order saved.');
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : 'Widget order could not be saved.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={{ flexDirection: windowWidth > 800 ? 'row' : 'column', flex: 1 }}>
        {/* Editor Area */}
        <View style={{ flex: 2, padding: 20 }}>
          <Text style={{ color: colors.text, fontSize: 24, fontWeight: 'bold', marginBottom: 20, fontFamily: 'monospace' }}>
            Custom Mode Editor
          </Text>

          <View accessibilityRole="tablist" accessibilityLabel="Custom content type" style={{ flexDirection: 'row', marginBottom: 15, borderWidth: 1, borderColor: colors.border, borderRadius: 8, overflow: 'hidden' }}>
            {(['link', 'code', 'workspace'] as const).map(editorMode => (
              <TouchableOpacity
                key={editorMode}
                disabled={isSaving}
                accessibilityRole="tab"
                accessibilityState={{ selected: mode === editorMode, disabled: isSaving }}
                onPress={() => requestEditorTransition(() => { setMode(editorMode); setValidationError(null); setSaveStatus(null); })}
                style={{ flex: 1, padding: 10, alignItems: 'center', backgroundColor: mode === editorMode ? colors.primary : colors.card }}
              >
                <Text style={{ color: mode === editorMode ? '#102535' : colors.textSecondary, fontWeight: 'bold' }}>
                  {editorMode === 'link' ? 'HTTPS Link' : editorMode === 'code' ? 'Static HTML/CSS' : 'Hosted Lab'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {mode === 'link' ? (
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.textSecondary, marginBottom: 15, fontFamily: 'monospace' }}>Add an institution-approved HTTPS resource. Full course view fills the LMS content area on web; mobile opens the site full-screen in the device browser.</Text>
              
              <Text style={{ color: colors.text, fontWeight: 'bold', marginBottom: 5, fontFamily: 'monospace' }}>Widget Title</Text>
              <TextInput 
                accessibilityLabel="Link widget title"
                style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.card }]}
                placeholder="e.g. Northstar course portal"
                placeholderTextColor={colors.textSecondary}
                value={linkTitle}
                onChangeText={setLinkTitle}
                maxLength={500}
              />
              
              <Text style={{ color: colors.text, fontWeight: 'bold', marginBottom: 5, marginTop: 15, fontFamily: 'monospace' }}>HTTPS URL</Text>
              <TextInput 
                accessibilityLabel="HTTPS URL"
                style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.card }]}
                placeholder="https://courses.example.edu/..."
                placeholderTextColor={colors.textSecondary}
                value={linkUrl}
                onChangeText={setLinkUrl}
                maxLength={8_192}
              />

              <Text style={{ color: colors.text, fontWeight: 'bold', marginBottom: 8, marginTop: 15, fontFamily: 'monospace' }}>Web presentation</Text>
              <View accessibilityRole="radiogroup" style={{ flexDirection: windowWidth > 560 ? 'row' : 'column', gap: 8 }}>
                {([
                  { id: 'embedded', label: 'Full course view', description: 'Embed a full-width, scrollable sandbox with an open-separately fallback.' },
                  { id: 'external', label: 'External tab', description: 'Show a course card that opens the approved site separately.' },
                ] as const).map(option => (
                  <TouchableOpacity
                    key={option.id}
                    accessibilityRole="radio"
                    accessibilityLabel={option.label}
                    accessibilityHint={option.description}
                    accessibilityState={{ checked: linkPresentation === option.id }}
                    onPress={() => setLinkPresentation(option.id)}
                    style={{ flex: 1, minHeight: 78, padding: 12, borderWidth: 1, borderRadius: 10, borderColor: linkPresentation === option.id ? colors.primary : colors.border, backgroundColor: linkPresentation === option.id ? `${colors.primary}20` : colors.card }}
                  >
                    <Text style={{ color: linkPresentation === option.id ? colors.primary : colors.text, fontWeight: '700' }}>{option.label}</Text>
                    <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 4 }}>{option.description}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {linkPresentation === 'embedded' && (
                <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 8 }}>Some providers block framing with their security policy. Students will always have an “Open separately” fallback.</Text>
              )}
              {renderScheduleFields()}
              {validationError && <Text accessibilityRole="alert" style={{ color: colors.error, marginTop: 8 }}>{validationError}</Text>}
              {saveStatus && <Text accessibilityLiveRegion="polite" style={{ color: '#4EC9B0', marginTop: 8 }}>{saveStatus}</Text>}

              <TouchableOpacity 
                style={[styles.saveBtn, { backgroundColor: linkTitle && linkUrl ? colors.primary : colors.border }]} 
                disabled={!linkTitle || !linkUrl || isSaving}
                accessibilityRole="button"
                accessibilityState={{ disabled: !linkTitle || !linkUrl || isSaving, busy: isSaving }}
                onPress={() => void handleSaveLink()}
              >
                <Text style={{ color: linkTitle && linkUrl ? '#102535' : colors.textSecondary, fontWeight: 'bold', textAlign: 'center', fontFamily: 'monospace' }}>{isSaving ? 'Saving…' : 'Save Link Widget'}</Text>
              </TouchableOpacity>
            </View>
          ) : mode === 'workspace' ? (
            <View style={{ flex: 1 }}>
              {(() => {
                const workspace = parseCustomLearningWorkspace(singleItem?.description);
                return workspace ? (
                  <>
                    <Text style={{ color: colors.textSecondary, marginBottom: 15, fontFamily: 'monospace' }}>
                      This professor-posted module uses a reviewed LMS workspace template. Its structured content is rendered as text and host controls—never as uploaded HTML or executable code.
                    </Text>
                    <View style={[styles.workspaceSummary, { borderColor: colors.border, backgroundColor: colors.card }]}> 
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Ionicons name="shield-checkmark" size={20} color="#4EC9B0" />
                        <Text style={{ color: '#4EC9B0', fontWeight: 'bold', marginLeft: 8, fontFamily: 'monospace' }}>Hosted code-lab-v1</Text>
                      </View>
                      <Text style={{ color: colors.text, fontSize: 20, fontWeight: 'bold', marginTop: 14 }}>{workspace.title}</Text>
                      <Text style={{ color: colors.textSecondary, lineHeight: 20, marginTop: 7 }}>{workspace.summary}</Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
                        <Text style={[styles.workspaceTag, { color: colors.primary, borderColor: colors.border }]}>{workspace.language}</Text>
                        <Text style={[styles.workspaceTag, { color: colors.primary, borderColor: colors.border }]}>Static source checks</Text>
                        <Text style={[styles.workspaceTag, { color: colors.primary, borderColor: colors.border }]}>Accessible chart data</Text>
                      </View>
                    </View>
                    <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 12 }}>
                      Core lab content is supplied by the institution integration and is read-only here. Course staff can safely adjust its learner availability below.
                    </Text>
                    {renderScheduleFields()}
                    <TouchableOpacity
                      style={[styles.saveBtn, { backgroundColor: colors.primary, marginTop: 15 }]}
                      disabled={isSaving}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: isSaving, busy: isSaving }}
                      onPress={() => void handleSaveWorkspaceSchedule()}
                    >
                      <Text style={{ color: '#102535', fontWeight: 'bold', textAlign: 'center', fontFamily: 'monospace' }}>{isSaving ? 'Saving…' : 'Save Workspace Schedule'}</Text>
                    </TouchableOpacity>
                    {validationError && <Text accessibilityRole="alert" style={{ color: colors.error, marginTop: 8 }}>{validationError}</Text>}
                    {saveStatus && <Text accessibilityLiveRegion="polite" style={{ color: '#4EC9B0', marginTop: 8 }}>{saveStatus}</Text>}
                  </>
                ) : (
                  <Text accessibilityRole="alert" style={{ color: colors.textSecondary }}>
                    Select an existing hosted workspace. New workspace templates are published through the institution integration so their schema and renderer can be reviewed before learners receive them.
                  </Text>
                );
              })()}
            </View>
          ) : (
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.textSecondary, marginBottom: 15, fontFamily: 'monospace' }}>Build a static HTML/CSS information panel. Scripts, forms, navigation, and network access are blocked.</Text>
              
              <Text style={{ color: colors.text, fontWeight: 'bold', marginBottom: 5, fontFamily: 'monospace' }}>Widget Title</Text>
              <TextInput 
                accessibilityLabel="Static widget title"
                style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.card, marginBottom: 15 }]}
                placeholder="e.g. Interactive Data Vis"
                placeholderTextColor={colors.textSecondary}
                value={codeTitle}
                onChangeText={setCodeTitle}
                maxLength={500}
              />

              <View accessibilityRole="tablist" accessibilityLabel="Static widget source language" style={{ flexDirection: 'row', marginBottom: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 8, overflow: 'hidden' }}>
                {(['html', 'css'] as const).map(lang => (
                  <TouchableOpacity
                    key={lang}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: codeLang === lang }}
                    style={{ flex: 1, padding: 10, alignItems: 'center', backgroundColor: codeLang === lang ? colors.primary + '20' : colors.card, borderBottomWidth: 2, borderBottomColor: codeLang === lang ? colors.primary : 'transparent' }}
                    onPress={() => setCodeLang(lang)}
                  >
                    <Text style={{ color: codeLang === lang ? colors.primary : colors.textSecondary, fontWeight: 'bold', textTransform: 'uppercase', fontFamily: 'monospace' }}>{lang}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TextInput
                accessibilityLabel={`${codeLang.toUpperCase()} source code`}
                style={[styles.input, { flex: 1, minHeight: 400, borderColor: colors.border, color: colors.text, backgroundColor: colors.card, padding: 12, fontFamily: 'monospace', textAlignVertical: 'top' }]}
                value={
                  codeLang === 'html' ? htmlCode : cssCode
                }
                onChangeText={(text) => {
                  if (codeLang === 'html') setHtmlCode(text);
                  else setCssCode(text);
                }}
                multiline
                maxLength={250_000}
                placeholder={`Write ${codeLang} code here...`}
                placeholderTextColor={colors.textSecondary}
              />

              {renderScheduleFields()}

              <TouchableOpacity 
                style={[styles.saveBtn, { backgroundColor: codeTitle ? colors.primary : colors.border, marginTop: 15 }]} 
                disabled={!codeTitle || isSaving}
                accessibilityRole="button"
                accessibilityState={{ disabled: !codeTitle || isSaving, busy: isSaving }}
                onPress={() => void handleSaveCode()}
              >
                <Text style={{ color: codeTitle ? '#102535' : colors.textSecondary, fontWeight: 'bold', textAlign: 'center', fontFamily: 'monospace' }}>{isSaving ? 'Saving…' : 'Save Custom Widget'}</Text>
              </TouchableOpacity>
              {validationError && <Text accessibilityRole="alert" style={{ color: colors.error, marginTop: 8 }}>{validationError}</Text>}
              {saveStatus && <Text accessibilityLiveRegion="polite" style={{ color: '#4EC9B0', marginTop: 8 }}>{saveStatus}</Text>}
            </View>
          )}
        </View>

        {/* Reference Guide */}
        <View style={{ flex: 1, padding: 20, borderLeftWidth: windowWidth > 800 ? 1 : 0, borderTopWidth: windowWidth > 800 ? 0 : 1, borderColor: colors.border, backgroundColor: colors.card }}>
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: 'bold', marginBottom: 15, fontFamily: 'monospace' }}>Reference Guide</Text>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={{ color: colors.textSecondary, marginBottom: 10, fontFamily: 'monospace', fontSize: 12 }}>
              Static widget security model
            </Text>
            <View style={{ backgroundColor: colors.background, padding: 10, borderRadius: 8, marginBottom: 15 }}>
              <Text style={{ color: '#4EC9B0', fontFamily: 'monospace', fontSize: 12 }}>Allowed: semantic HTML + CSS</Text>
              <Text style={{ color: colors.textSecondary, fontFamily: 'monospace', fontSize: 12, marginTop: 5 }}>
                Disallowed: JavaScript, forms, external frames, popups, and network requests.
              </Text>
              <Text style={{ color: colors.text, fontFamily: 'monospace', fontSize: 12, marginTop: 5 }}>
                Institution data access belongs in authenticated adapters, never in course-authored content.
              </Text>
            </View>

            <Text style={{ color: colors.textSecondary, marginBottom: 10, fontFamily: 'monospace', fontSize: 12 }}>
              Active Custom Widgets
            </Text>
            <TouchableOpacity onPress={() => requestEditorTransition(startNewWidget)} style={{ marginBottom: 10, minHeight: 44, padding: 10, backgroundColor: colors.primary, borderRadius: 8, justifyContent: 'center' }} accessibilityRole="button" accessibilityLabel="Create a new custom-course widget">
              <Text style={{ color: colors.buttonText, fontWeight: 'bold', textAlign: 'center' }}>New Widget</Text>
            </TouchableOpacity>
            {widgetItems.map((item, index) => (
              <View key={item.id} style={{ flexDirection: 'row', alignItems: 'stretch', marginBottom: 6, gap: 6 }}>
                <TouchableOpacity onPress={() => requestEditorTransition(() => selectWidget(item))} style={{ flex: 1, minHeight: 44, padding: 10, backgroundColor: colors.background, borderRadius: 8, borderWidth: selectedItemId === item.id ? 2 : 1, borderColor: selectedItemId === item.id ? colors.primary : colors.border }} accessibilityRole="button" accessibilityLabel={`Edit ${item.title}`} accessibilityState={{ selected: selectedItemId === item.id }}>
                  <Text style={{ color: colors.text, fontFamily: 'monospace', fontSize: 12, fontWeight: 'bold' }}>{item.title}</Text>
                  <Text style={{ color: colors.textSecondary, fontFamily: 'monospace', fontSize: 10 }}>
                    {item.contentUrl ? 'HTTPS course site' : parseCustomLearningWorkspace(item.description) ? 'Hosted learning workspace' : 'Static HTML/CSS'}
                  </Text>
                </TouchableOpacity>
                <View style={{ flexDirection: 'row' }}>
                  <TouchableOpacity
                    disabled={isSaving || index === 0}
                    onPress={() => void moveWidget(item.id, -1)}
                    accessibilityRole="button"
                    accessibilityLabel={`Move ${item.title} earlier`}
                    accessibilityState={{ disabled: isSaving || index === 0 }}
                    style={[styles.orderButton, { borderColor: colors.border, opacity: isSaving || index === 0 ? 0.4 : 1 }]}
                  >
                    <Ionicons name="arrow-up" size={18} color={colors.text} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    disabled={isSaving || index === widgetItems.length - 1}
                    onPress={() => void moveWidget(item.id, 1)}
                    accessibilityRole="button"
                    accessibilityLabel={`Move ${item.title} later`}
                    accessibilityState={{ disabled: isSaving || index === widgetItems.length - 1 }}
                    style={[styles.orderButton, { borderColor: colors.border, opacity: isSaving || index === widgetItems.length - 1 ? 0.4 : 1 }]}
                  >
                    <Ionicons name="arrow-down" size={18} color={colors.text} />
                  </TouchableOpacity>
                </View>
              </View>
            ))}
            {!!singleItem && (
              <TouchableOpacity disabled={isSaving} onPress={confirmDeleteWidget} style={{ marginTop: 12, padding: 10, borderWidth: 1, borderColor: colors.error, borderRadius: 8, opacity: isSaving ? 0.5 : 1 }} accessibilityRole="button" accessibilityLabel={`Delete ${singleItem.title}`} accessibilityState={{ disabled: isSaving, busy: isSaving }}>
                <Text style={{ color: colors.error, fontWeight: 'bold', textAlign: 'center' }}>Delete Selected Widget</Text>
              </TouchableOpacity>
            )}
            {!!recentlyDeletedWidgets.length && (
              <View style={[styles.deletedPanel, { borderColor: colors.border, backgroundColor: colors.background }]}>
                <Text style={{ color: colors.text, fontWeight: 'bold', marginBottom: 8, fontFamily: 'monospace' }}>Recently Deleted (24 hours)</Text>
                {recentlyDeletedWidgets.map(item => (
                  <View key={item.id} style={styles.deletedRow}>
                    <Text style={{ color: colors.textSecondary, flex: 1, marginRight: 8, fontFamily: 'monospace', fontSize: 12 }}>{item.title}</Text>
                    <TouchableOpacity
                      disabled={isSaving}
                      onPress={() => void restoreWidget(item.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`Restore ${item.title}`}
                      accessibilityState={{ disabled: isSaving }}
                      style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 }}
                    >
                      <Text style={{ color: colors.primary, fontWeight: 'bold' }}>Restore</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  tabBtn: { paddingVertical: 10, paddingHorizontal: 20, marginRight: 10 },
  input: { borderWidth: 1, padding: 10, borderRadius: 8 },
  saveBtn: { minHeight: 48, padding: 15, borderRadius: 8, marginTop: 20 },
  orderButton: { width: 44, minHeight: 44, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginLeft: 4, borderRadius: 8 },
  schedulePanel: { marginTop: 15, padding: 12, borderWidth: 1, borderRadius: 8 },
  scheduleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' },
  workspaceSummary: { padding: 18, borderWidth: 1, borderRadius: 14 },
  workspaceTag: { minHeight: 32, paddingHorizontal: 9, paddingVertical: 6, borderWidth: 1, borderRadius: 8, fontSize: 11, fontFamily: 'monospace' },
  deletedPanel: { marginTop: 16, padding: 10, borderWidth: 1, borderRadius: 8 },
  deletedRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#333333' },
});
