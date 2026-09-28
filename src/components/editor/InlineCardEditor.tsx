/**
 * @fileoverview src/components/editor/InlineCardEditor.tsx.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Modal, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Card, Note, DepthLayer } from '../../types';
import { userAlert as Alert } from '../../lib/userAlert';
import * as Speech from 'expo-speech';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  type AudioRecorder,
} from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import { useHistoryState } from '../../hooks/useHistoryState';

import { useThemeColors } from '../../lib/useThemeColors';
import { typography, spacing } from '../../lib/theme';
import { CardStore, EditorStore } from '../../lib/db/store';
import { CardDisplay } from '../ui/CardDisplay';
import { createEntityId } from '../../lib/id';
import { accessibleTextColor, hasAccessibleTextContrast, isSixDigitHexColor } from '../../lib/color';
import { findInvalidCardMediaUris } from '../../lib/cardMedia';
import { DIAGNOSTIC_CONTEXTS, logDiagnosticError } from '../../lib/diagnosticLog';

function hslToHex(h: number, s: number, l: number) {
  l /= 100;
  const a = s * Math.min(l, 1 - l) / 100;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
}

function hexToHsl(hex: string) {
  if (!hex) return { h: 0, s: 0, l: 0 };
  let c = hex.replace('#', '');
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  if (c.length !== 6) return { h: 0, s: 0, l: 0 };
  const r = parseInt(c.slice(0, 2), 16) / 255;
  const g = parseInt(c.slice(2, 4), 16) / 255;
  const b = parseInt(c.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}
interface InlineCardEditorProps {
  item: { card: Card & { tags?: string[] }; note: Note; layers: DepthLayer[] };
  isEditing: boolean;
  onToggleEdit: () => void;
  onSave: (noteId: string, front: string, layers: string[]) => void;
  onDeleteCard?: (cardId: string) => void;
}

export function InlineCardEditor({ item, isEditing, onToggleEdit, onSave, onDeleteCard }: InlineCardEditorProps) {
  const colors = useThemeColors();
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const getFront = () => item.note.field_values.front || item.note.field_values.Front || '';
  const getLayersContent = () => {
    if (item.layers && item.layers.length > 0) {
      return item.layers.map(l => l.content);
    }
    const back = item.note.field_values.back || item.note.field_values.Back || '';
    return back ? [back] : [];
  };
  
  const frontState = useHistoryState<string>(getFront());
  const layersState = useHistoryState<string[]>(getLayersContent());
  const savingRef = React.useRef(false);
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewRevealed, setPreviewRevealed] = useState(false);
  const [previewDepthIndex, setPreviewDepthIndex] = useState(-1);
  const [noteColor, setNoteColor] = useState<string>(item.note.field_values.color || '');
  const [textColor, setTextColor] = useState<string>(item.note.field_values.textColor || '');
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [spectrumWidth, setSpectrumWidth] = useState(300);
  
  const [showFormatGuide, setShowFormatGuide] = useState(false);
  const [showFormatColorPicker, setShowFormatColorPicker] = useState(false);
  const [formatColorTarget, setFormatColorTarget] = useState<'color' | 'bg' | null>(null);
  const [formatCustomColor, setFormatCustomColor] = useState('#8B5CF6');
  const [formatCustomBg, setFormatCustomBg] = useState('#FBCFE8');
  
  const [expandedInput, setExpandedInput] = useState<'front' | number | null>(null);
  const [focusedInput, setFocusedInput] = useState<'front' | number | null>(null);
  const [selections, setSelections] = useState<Record<string, {start: number, end: number}>>({});
  const [showFormatToolbarFor, setShowFormatToolbarFor] = useState<'front' | number | null>(null);
  const [recording, setRecording] = useState<AudioRecorder | undefined>();
  const recordingRef = React.useRef<AudioRecorder | undefined>(undefined);
  const recordingTargetRef = React.useRef<'front' | number | null>(null);
  const recordingOperationRef = React.useRef(false);
  const recordingAudioModeRef = React.useRef(false);
  const [recordingTarget, setRecordingTarget] = useState<'front' | number | null>(null);
  const [recordingBusy, setRecordingBusy] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const isMounted = React.useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      Speech.stop();
      if (recordingRef.current) {
        recordingRef.current.stop().catch(() => {});
        recordingRef.current = undefined;
      }
      if (recordingAudioModeRef.current) {
        recordingAudioModeRef.current = false;
        void setAudioModeAsync({ allowsRecording: false }).catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const activeInput = expandedInput !== null ? expandedInput : focusedInput;
      if (activeInput === null) return;
      
      const isModifier = e.ctrlKey || e.metaKey;
      if (!isModifier) return;

      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        if (e.shiftKey) {
          if (activeInput === 'front' && frontState.canRedo) frontState.redo();
          else if (typeof activeInput === 'number' && layersState.canRedo) layersState.redo();
        } else {
          if (activeInput === 'front' && frontState.canUndo) frontState.undo();
          else if (typeof activeInput === 'number' && layersState.canUndo) layersState.undo();
        }
      } else if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault();
        if (activeInput === 'front' && frontState.canRedo) frontState.redo();
        else if (typeof activeInput === 'number' && layersState.canRedo) layersState.redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [expandedInput, focusedInput, frontState, layersState]);

  const speakText = async (text: string) => {
    const cleanText = text
      .replace(/!\[.*?\]\(.*?\)|\[VIDEO:.*?\]|\[AUDIO:.*?\]|\[IMAGE:.*?\]/g, ' media ')
      .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
      .replace(/(\*\*|__)(.*?)\1/g, '$2')
      .replace(/(\*|_)(.*?)\1/g, '$2')
      .replace(/~~(.*?)~~/g, '$1')
      .replace(/`{1,3}([^`]+)`{1,3}/g, '$1')
      .replace(/#+\s/g, '')
      .replace(/>\s/g, '')
      .trim();
    await Speech.stop();
    Speech.speak(cleanText);
  };

  const startRecording = async (target: 'front' | number) => {
    if (recordingRef.current || recordingOperationRef.current) return;
    recordingOperationRef.current = true;
    recordingTargetRef.current = target;
    setRecordingTarget(target);
    setRecordingBusy(true);
    try {
      if (Platform.OS === 'web') {
        setOperationError('Audio recording is available in the iOS and Android card editors.');
        return;
      }
      setOperationError(null);
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setOperationError('Microphone permission is required to record audio.');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      recordingAudioModeRef.current = true;
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      if (!isMounted.current) {
        await audioRecorder.stop();
        recordingAudioModeRef.current = false;
        await setAudioModeAsync({ allowsRecording: false });
        return;
      }
      recordingRef.current = audioRecorder;
      setRecording(audioRecorder);
    } catch (err) {
      logDiagnosticError(DIAGNOSTIC_CONTEXTS.recordingStart, err);
      if (recordingAudioModeRef.current) {
        recordingAudioModeRef.current = false;
        void setAudioModeAsync({ allowsRecording: false }).catch(() => {});
      }
      setOperationError('Recording could not be started. Check microphone access and try again.');
    } finally {
      if (!recordingRef.current) {
        recordingTargetRef.current = null;
        if (isMounted.current) setRecordingTarget(null);
      }
      recordingOperationRef.current = false;
      if (isMounted.current) setRecordingBusy(false);
    }
  };

  const stopRecording = async () => {
    if (recordingOperationRef.current) return;
    const activeRecording = recordingRef.current;
    if (!activeRecording) return;
    const target = recordingTargetRef.current;
    recordingOperationRef.current = true;
    setRecordingBusy(true);
    recordingRef.current = undefined;
    recordingTargetRef.current = null;
    setRecording(undefined);
    setRecordingTarget(null);
    try {
      setOperationError(null);
      await activeRecording.stop();
      const uri = activeRecording.uri;
      if (uri) {
        if (!FileSystem.documentDirectory) throw new Error('No writable document directory is available.');
        const filename = `${createEntityId('audio')}.m4a`;
        const destUri = FileSystem.documentDirectory + filename;
        await FileSystem.copyAsync({ from: uri, to: destUri });
        if (target !== null) applyFormatting(target, `\n\n[AUDIO:${filename}]`, '');
      }
    } catch (error) {
      logDiagnosticError(DIAGNOSTIC_CONTEXTS.recordingSave, error);
      setOperationError('The recording could not be saved. Please record it again.');
    } finally {
      recordingAudioModeRef.current = false;
      void setAudioModeAsync({ allowsRecording: false }).catch(() => {});
      recordingOperationRef.current = false;
      if (isMounted.current) setRecordingBusy(false);
    }
  };

  const handleSave = async () => {
    if (savingRef.current) return;
    if (!frontState.state.trim()) {
      setOperationError('A card front is required.');
      return;
    }
    if (layersState.state.length < 1 || !layersState.state[0].trim()) {
      setOperationError('The first page is required.');
      return;
    }
    if ((noteColor && !isSixDigitHexColor(noteColor)) || (textColor && !isSixDigitHexColor(textColor))) {
      setOperationError('Card colors must be empty or use six-digit hex values such as #E8F5E9.');
      return;
    }
    if (textColor && (!noteColor || !hasAccessibleTextContrast(textColor, noteColor))) {
      setOperationError('Choose a card background and text color with at least 4.5:1 contrast, or leave text color empty for automatic accessible text.');
      return;
    }
    if ([frontState.state, ...layersState.state].flatMap(findInvalidCardMediaUris).length > 0) {
      setOperationError('Card media must use a credential-free HTTPS address or an audio file recorded in this app. HTTP, device paths, and custom URI schemes are blocked.');
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setOperationError(null);
    try {
      const updatedFields = { ...item.note.field_values };
      if ('Front' in updatedFields) updatedFields.Front = frontState.state;
      else updatedFields.front = frontState.state;
      
      updatedFields.color = noteColor;
      updatedFields.textColor = textColor;

      await EditorStore.updateCardContent(item.card.id, item.note.id, updatedFields, layersState.state);

      onSave(item.note.id, frontState.state, layersState.state);
      onToggleEdit();
    } catch (err) {
      logDiagnosticError(DIAGNOSTIC_CONTEXTS.cardSave, err);
      if (isMounted.current) setOperationError('Your changes were not saved. Please retry.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const discardChanges = () => {
    frontState.reset(getFront());
    layersState.reset(getLayersContent());
    setNoteColor(item.note.field_values.color || '');
    setTextColor(item.note.field_values.textColor || '');
    setOperationError(null);
    onToggleEdit();
  };

  const handleCancel = () => {
    const hasChanges = frontState.state !== getFront()
      || JSON.stringify(layersState.state) !== JSON.stringify(getLayersContent())
      || noteColor !== (item.note.field_values.color || '')
      || textColor !== (item.note.field_values.textColor || '');
    if (!hasChanges) {
      discardChanges();
      return;
    }
    Alert.alert('Discard changes?', 'Your unsaved card edits will be lost.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: discardChanges },
    ]);
  };

  const handleDeleteLastPage = () => {
    if (layersState.state.length <= 1) return;
    const newLayers = layersState.state.slice(0, layersState.state.length - 1);
    layersState.set(newLayers);
  };

  const handleAddPage = () => {
    if (layersState.state.length >= 1_000) {
      setOperationError('A card may contain at most 1,000 pages.');
      return;
    }
    layersState.set([...layersState.state, '']);
  };

  const applyFormatting = (target: 'front' | number, prefix: string, suffix: string) => {
    if (target === 'front') {
      const text = frontState.state;
      const sel = selections[target.toString()] ?? { start: text.length, end: text.length };
      const before = text.substring(0, sel.start);
      const selectedText = text.substring(sel.start, sel.end);
      const after = text.substring(sel.end);
      frontState.set(before + prefix + selectedText + suffix + after);
    } else {
      const newLayers = [...layersState.state];
      const text = newLayers[target as number] || '';
      const sel = selections[target.toString()] ?? { start: text.length, end: text.length };
      const before = text.substring(0, sel.start);
      const selectedText = text.substring(sel.start, sel.end);
      const after = text.substring(sel.end);
      newLayers[target as number] = before + prefix + selectedText + suffix + after;
      layersState.set(newLayers);
    }
  };

  const renderFormatToolbar = (target: 'front' | number) => {
    if (showFormatToolbarFor !== target) return null;
    return (
      <View style={{ backgroundColor: 'rgba(0,0,0,0.05)', borderRadius: 8, marginBottom: 8, padding: 8 }}>
        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', marginBottom: 8 }}>
          <Pressable 
            onPress={() => target === 'front' ? frontState.undo() : layersState.undo()} 
            style={[styles.formatBtn, { backgroundColor: colors.border }]}
            disabled={target === 'front' ? !frontState.canUndo : !layersState.canUndo}
            accessibilityRole="button"
            accessibilityLabel="Undo card content change"
            accessibilityState={{ disabled: target === 'front' ? !frontState.canUndo : !layersState.canUndo }}
          >
            <Text style={[styles.formatText, { opacity: (target === 'front' ? frontState.canUndo : layersState.canUndo) ? 1 : 0.3 }]}>↩</Text>
          </Pressable>
          <Pressable 
            onPress={() => target === 'front' ? frontState.redo() : layersState.redo()} 
            style={[styles.formatBtn, { backgroundColor: colors.border }]}
            disabled={target === 'front' ? !frontState.canRedo : !layersState.canRedo}
            accessibilityRole="button"
            accessibilityLabel="Redo card content change"
            accessibilityState={{ disabled: target === 'front' ? !frontState.canRedo : !layersState.canRedo }}
          >
            <Text style={[styles.formatText, { opacity: (target === 'front' ? frontState.canRedo : layersState.canRedo) ? 1 : 0.3 }]}>↪</Text>
          </Pressable>
        </View>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: spacing[2] }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Format selected text as bold" onPress={() => applyFormatting(target, '**', '**')} style={styles.formatBtn}><Text style={styles.formatText}>B</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Format selected text as italic" onPress={() => applyFormatting(target, '*', '*')} style={styles.formatBtn}><Text style={[styles.formatText, { fontStyle: 'italic' }]}>I</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Underline selected text" onPress={() => applyFormatting(target, '[', '](format:underline)')} style={styles.formatBtn}><Text style={[styles.formatText, { textDecorationLine: 'underline' }]}>U</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Make heading level 1" onPress={() => applyFormatting(target, '# ', '')} style={styles.formatBtn}><Text style={styles.formatText}>H1</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Make heading level 2" onPress={() => applyFormatting(target, '## ', '')} style={styles.formatBtn}><Text style={styles.formatText}>H2</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Make heading level 3" onPress={() => applyFormatting(target, '### ', '')} style={styles.formatBtn}><Text style={styles.formatText}>H3</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Insert image address" onPress={() => applyFormatting(target, '![image](', ')')} style={styles.formatBtn}><Text style={styles.formatText}>Img</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Insert video address" onPress={() => applyFormatting(target, '[VIDEO:', ']')} style={styles.formatBtn}><Text style={styles.formatText}>Vid</Text></Pressable>
          
          <Pressable accessibilityRole="button" accessibilityLabel="Open formatting guide" onPress={() => setShowFormatGuide(true)} style={[styles.formatBtn, { backgroundColor: colors.info, marginLeft: 'auto' }]}> 
            <Text style={[styles.formatText, { color: colors.onInfo }]}>ⓘ Guide</Text>
          </Pressable>
        </View>

        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: spacing[2] }}>
          <Text style={{ fontSize: typography.xs, color: colors.textSecondary, alignSelf: 'center', width: 50 }}>Color:</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Format selected text in red" onPress={() => applyFormatting(target, '[', '](color:#EF4444)')} style={[styles.formatBtn, { borderColor: '#EF4444', borderWidth: 2 }]}><Text style={[styles.formatText, { color: colors.text }]}>Red</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Format selected text in blue" onPress={() => applyFormatting(target, '[', '](color:#3B82F6)')} style={[styles.formatBtn, { borderColor: '#3B82F6', borderWidth: 2 }]}><Text style={[styles.formatText, { color: colors.text }]}>Blue</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`Format selected text in ${formatCustomColor}`} onPress={() => applyFormatting(target, '[', `](color:${formatCustomColor})`)} style={[styles.formatBtn, { borderColor: formatCustomColor, borderWidth: 2 }]}><Text style={[styles.formatText, { color: colors.text }]}>Custom</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Choose custom text color" onPress={() => { setFormatColorTarget('color'); setShowFormatColorPicker(true); }} style={styles.formatBtn}><Text style={styles.formatText}>+</Text></Pressable>
        </View>

        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Text style={{ fontSize: typography.xs, color: colors.textSecondary, alignSelf: 'center', width: 50 }}>Highl.:</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Highlight selected text in yellow" onPress={() => applyFormatting(target, '[', '](bg:#FEF08A)')} style={[styles.formatBtn, { backgroundColor: '#FEF08A' }]}><Text style={[styles.formatText, { color: '#000' }]}>Yellow</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Highlight selected text in cyan" onPress={() => applyFormatting(target, '[', '](bg:#A7F3D0)')} style={[styles.formatBtn, { backgroundColor: '#A7F3D0' }]}><Text style={[styles.formatText, { color: '#000' }]}>Cyan</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`Highlight selected text in ${formatCustomBg}`} onPress={() => applyFormatting(target, '[', `](bg:${formatCustomBg})`)} style={[styles.formatBtn, { backgroundColor: formatCustomBg }]}><Text style={[styles.formatText, { color: accessibleTextColor(formatCustomBg) || colors.text }]}>Custom</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Choose custom highlight color" onPress={() => { setFormatColorTarget('bg'); setShowFormatColorPicker(true); }} style={styles.formatBtn}><Text style={styles.formatText}>+</Text></Pressable>
        </View>
      </View>
    );
  };

  const handleBgColorDrag = (e: any) => {
    let x = e.nativeEvent.locationX;
    if (x < 0) x = 0;
    if (x > spectrumWidth) x = spectrumWidth;
    const hue = (x / spectrumWidth) * 360;
    setNoteColor(hslToHex(hue, 100, 85));
  };

  const handleTextColorDrag = (e: any) => {
    let x = e.nativeEvent.locationX;
    if (x < 0) x = 0;
    if (x > spectrumWidth) x = spectrumWidth;
    const hue = (x / spectrumWidth) * 360;
    setTextColor(hslToHex(hue, 100, 30));
  };

  const handleFormatColorDrag = (e: any) => {
    let x = e.nativeEvent.locationX;
    if (x < 0) x = 0;
    if (x > spectrumWidth) x = spectrumWidth;
    const hue = (x / spectrumWidth) * 360;
    const color = hslToHex(hue, 100, formatColorTarget === 'bg' ? 85 : 40);
    if (formatColorTarget === 'bg') {
      setFormatCustomBg(color);
    } else {
      setFormatCustomColor(color);
    }
  };

  const handleDelete = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setOperationError(null);
    try {
      await CardStore.deleteCard(item.card.id);
      if (isMounted.current) {
        savingRef.current = false;
        setSaving(false);
        if (onDeleteCard) onDeleteCard(item.card.id);
      }
    } catch (e) {
      logDiagnosticError(DIAGNOSTIC_CONTEXTS.cardDelete, e);
      if (isMounted.current) {
        setOperationError('The card could not be deleted. Please retry.');
        savingRef.current = false;
        setSaving(false);
      }
    }
  };

  const handleDeleteRequest = () => {
    Alert.alert('Delete this card?', 'The card and its review history will be removed.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: handleDelete },
    ]);
  };

  if (isEditing) {
    return (
      <View style={[styles.cardRow, { backgroundColor: colors.card, borderColor: colors.primary }]}>
        {showPreview ? (
          <View style={{ paddingVertical: spacing[3], alignItems: 'center' }}>
            <View style={{ width: '100%', height: 420 }}>
              <CardDisplay
                card={{
                  id: item.card.id,
                  front: frontState.state,
                  back: layersState.state.length > 0 ? layersState.state[0] : '',
                  depthLayers: layersState.state.length > 1 ? layersState.state.slice(1) : [],
                  retrievability: 1,
                  color: noteColor,
                  textColor,
                }}
                cardColor={noteColor || undefined}
                isRevealed={previewRevealed}
                onReveal={() => setPreviewRevealed(true)}
                showRevealControl
                onUpdateNotes={() => {}}
                depthIndex={previewDepthIndex}
                onDepthIndexChange={setPreviewDepthIndex}
              />
            </View>
            {previewRevealed && (
              <Pressable onPress={() => { setPreviewRevealed(false); setPreviewDepthIndex(-1); }} style={[styles.actionBtn, { backgroundColor: colors.secondary, marginTop: spacing[3] }]} accessibilityRole="button">
                <Text style={[styles.actionBtnText, { color: colors.onSecondary }]}>Reset Preview</Text>
              </Pressable>
            )}
          </View>
        ) : (
          <>
            <View style={styles.editorHeader}>
              <Text style={[styles.editorTitle, { color: colors.text }]}>Front</Text>
              <View style={{ flexDirection: 'row', gap: spacing[2], alignItems: 'center' }}>
                    <Pressable accessibilityRole="button" accessibilityLabel="Read card front aloud" onPress={() => speakText(frontState.state)} style={[styles.mediaBtn, { backgroundColor: colors.border }]}><Text style={{ fontSize: typography.xs, color: colors.text }}>🔊 TTS</Text></Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel={recordingBusy ? 'Audio recording operation in progress' : recording && recordingTarget === 'front' ? 'Stop card front audio recording' : 'Record card front audio'} accessibilityState={{ disabled: recordingBusy || (!!recording && recordingTarget !== 'front'), busy: recordingBusy }} disabled={recordingBusy || (!!recording && recordingTarget !== 'front')} onPress={() => recording ? void stopRecording() : void startRecording('front')} style={[styles.mediaBtn, { backgroundColor: recording && recordingTarget === 'front' ? colors.error : colors.border, opacity: recordingBusy || (!!recording && recordingTarget !== 'front') ? 0.55 : 1 }]}><Text style={{ fontSize: typography.xs, color: recording && recordingTarget === 'front' ? colors.onError : colors.text }}>{recordingBusy ? '…' : recording && recordingTarget === 'front' ? '⏹️ Stop' : '🎤 Rec'}</Text></Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel="Format card front" onPress={() => setShowFormatToolbarFor(showFormatToolbarFor === 'front' ? null : 'front')} style={[styles.mediaBtn, { backgroundColor: colors.border }]}><Text style={{ fontSize: typography.xs, color: colors.text }}>Format</Text></Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel="Expand card front editor" onPress={() => setExpandedInput('front')} style={[styles.mediaBtn, { backgroundColor: colors.border }]}><Text style={{ fontSize: typography.xs, color: colors.text }}>Expand</Text></Pressable>
              </View>
            </View>
            {renderFormatToolbar('front')}
            <TextInput
              accessibilityLabel="Card front content"
              style={[styles.input, { color: colors.text, borderColor: colors.border }]}
              value={frontState.state}
              onChangeText={frontState.set}
              onSelectionChange={(e) => setSelections({ ...selections, 'front': e.nativeEvent.selection })}
              onFocus={() => setFocusedInput('front')}
              onBlur={() => setFocusedInput(null)}
              placeholder="Enter front content..."
              placeholderTextColor={colors.textSecondary}
              multiline
            />

            {layersState.state.map((content, idx) => (
              <View key={idx} style={{ marginTop: spacing[3] }}>
                <View style={styles.editorHeader}>
                  <Text style={[styles.editorTitle, { color: colors.textSecondary }]}>Page {idx + 1}</Text>
                  <View style={{ flexDirection: 'row', gap: spacing[2], alignItems: 'center' }}>
                    <Pressable accessibilityRole="button" accessibilityLabel={`Read card page ${idx + 1} aloud`} onPress={() => speakText(content)} style={[styles.mediaBtn, { backgroundColor: colors.border }]}><Text style={{ fontSize: typography.xs, color: colors.text }}>🔊 TTS</Text></Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel={recordingBusy ? 'Audio recording operation in progress' : recording && recordingTarget === idx ? `Stop card page ${idx + 1} audio recording` : `Record card page ${idx + 1} audio`} accessibilityState={{ disabled: recordingBusy || (!!recording && recordingTarget !== idx), busy: recordingBusy }} disabled={recordingBusy || (!!recording && recordingTarget !== idx)} onPress={() => recording ? void stopRecording() : void startRecording(idx)} style={[styles.mediaBtn, { backgroundColor: recording && recordingTarget === idx ? colors.error : colors.border, opacity: recordingBusy || (!!recording && recordingTarget !== idx) ? 0.55 : 1 }]}><Text style={{ fontSize: typography.xs, color: recording && recordingTarget === idx ? colors.onError : colors.text }}>{recordingBusy ? '…' : recording && recordingTarget === idx ? '⏹️ Stop' : '🎤 Rec'}</Text></Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel={`Format card page ${idx + 1}`} onPress={() => setShowFormatToolbarFor(showFormatToolbarFor === idx ? null : idx)} style={[styles.mediaBtn, { backgroundColor: colors.border }]}><Text style={{ fontSize: typography.xs, color: colors.text }}>Format</Text></Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel={`Expand card page ${idx + 1} editor`} onPress={() => setExpandedInput(idx)} style={[styles.mediaBtn, { backgroundColor: colors.border }]}><Text style={{ fontSize: typography.xs, color: colors.text }}>Expand</Text></Pressable>
                  </View>
                </View>
                {renderFormatToolbar(idx)}
                <TextInput
                  accessibilityLabel={`Card page ${idx + 1} content`}
                  style={[styles.input, { color: colors.text, borderColor: colors.border }]}
                  value={content}
                  onChangeText={(text) => {
                    const newLayers = [...layersState.state];
                    newLayers[idx] = text;
                    layersState.set(newLayers);
                  }}
                  onSelectionChange={(e) => setSelections({ ...selections, [idx]: e.nativeEvent.selection })}
                  onFocus={() => setFocusedInput(idx)}
                  onBlur={() => setFocusedInput(null)}
                  placeholder={`Enter text for Page ${idx + 1}...`}
                  placeholderTextColor={colors.textSecondary}
                  multiline
                />
              </View>
            ))}

            <View style={styles.pagesActionRow}>
              <Pressable onPress={handleAddPage} style={[styles.pageBtn, { backgroundColor: colors.border }]} accessibilityRole="button">
                <Text style={[styles.actionBtnText, { color: colors.text }]}>+ Add Page</Text>
              </Pressable>
              {layersState.state.length > 1 && (
                <Pressable onPress={handleDeleteLastPage} style={[styles.pageBtn, { backgroundColor: colors.border }]} accessibilityRole="button">
                  <Text style={[styles.actionBtnText, { color: colors.error }]}>- Delete Last Page</Text>
                </Pressable>
              )}
              <Pressable onPress={() => setShowColorPicker(true)} style={[styles.pageBtn, { backgroundColor: colors.border }]} accessibilityRole="button" accessibilityLabel="Edit card background and text colors">
                <Text style={[styles.actionBtnText, { color: colors.text }]}>Card Colors</Text>
              </Pressable>
            </View>
          </>
        )}
        
        {operationError && (
          <Text accessibilityRole="alert" style={{ color: colors.error, marginTop: spacing[3] }}>
            {operationError}
          </Text>
        )}
        <View style={styles.actionRow}>
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: saving }} disabled={saving} onPress={handleDeleteRequest} style={[styles.actionBtn, { backgroundColor: colors.error, opacity: saving ? 0.6 : 1 }]}> 
            <Text style={[styles.actionBtnText, { color: colors.onError }]}>Delete</Text>
          </Pressable>
          <View style={{ flexDirection: 'row', gap: spacing[2] }}>
            <Pressable accessibilityRole="button" accessibilityState={{ selected: showPreview }} onPress={() => setShowPreview(!showPreview)} style={[styles.actionBtn, { backgroundColor: colors.border }]}> 
              <Text style={[styles.actionBtnText, { color: colors.text }]}>{showPreview ? 'Hide Preview' : 'Preview'}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={handleCancel} style={[styles.actionBtn, { backgroundColor: colors.border }]}> 
              <Text style={[styles.actionBtnText, { color: colors.text }]}>Cancel</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityState={{ disabled: saving, busy: saving }} disabled={saving} onPress={handleSave} style={[styles.actionBtn, { backgroundColor: colors.primary, opacity: saving ? 0.6 : 1 }]}> 
              <Text style={[styles.actionBtnText, { color: colors.buttonText }]}>{saving ? 'Saving...' : 'Save'}</Text>
            </Pressable>
          </View>
        </View>
        
        {/* Fullscreen Input Modal */}
        <Modal visible={expandedInput !== null} animationType="slide" presentationStyle="pageSheet" transparent={false} onRequestClose={() => setExpandedInput(null)}>
          <View accessibilityViewIsModal style={{ flex: 1, backgroundColor: colors.background, padding: spacing[4], paddingTop: 60 }}>
            {expandedInput !== null && (
              <>
                <View style={styles.editorHeader}>
                  <Text accessibilityRole="header" style={[styles.editorTitle, { color: colors.text }]}>{expandedInput === 'front' ? 'Front' : `Page ${(expandedInput as number) + 1}`}</Text>
                  <View style={{ flexDirection: 'row', gap: spacing[2], alignItems: 'center' }}>
                    <Pressable accessibilityRole="button" accessibilityLabel="Read expanded card content aloud" onPress={() => speakText(expandedInput === 'front' ? frontState.state : layersState.state[expandedInput as number])} style={[styles.mediaBtn, { backgroundColor: colors.border }]}><Text style={{ fontSize: typography.xs, color: colors.text }}>🔊 TTS</Text></Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel={recordingBusy ? 'Audio recording operation in progress' : recording && recordingTarget === expandedInput ? 'Stop expanded card audio recording' : 'Record expanded card audio'} accessibilityState={{ disabled: recordingBusy || (!!recording && recordingTarget !== expandedInput), busy: recordingBusy }} disabled={recordingBusy || (!!recording && recordingTarget !== expandedInput)} onPress={() => recording ? void stopRecording() : void startRecording(expandedInput)} style={[styles.mediaBtn, { backgroundColor: recording && recordingTarget === expandedInput ? colors.error : colors.border, opacity: recordingBusy || (!!recording && recordingTarget !== expandedInput) ? 0.55 : 1 }]}><Text style={{ fontSize: typography.xs, color: recording && recordingTarget === expandedInput ? colors.onError : colors.text }}>{recordingBusy ? '…' : recording && recordingTarget === expandedInput ? '⏹️ Stop' : '🎤 Rec'}</Text></Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel="Format expanded card content" onPress={() => setShowFormatToolbarFor(showFormatToolbarFor === expandedInput ? null : expandedInput)} style={[styles.mediaBtn, { backgroundColor: colors.border }]}><Text style={{ fontSize: typography.xs, color: colors.text }}>Format</Text></Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel="Collapse expanded card editor" onPress={() => setExpandedInput(null)} style={[styles.mediaBtn, { backgroundColor: colors.border }]}><Text style={{ fontSize: typography.xs, color: colors.text }}>Collapse</Text></Pressable>
                  </View>
                </View>
                {renderFormatToolbar(expandedInput)}
                <TextInput
                  accessibilityLabel={expandedInput === 'front' ? 'Expanded card front content' : `Expanded card page ${(expandedInput as number) + 1} content`}
                  style={[styles.input, { flex: 1, color: colors.text, borderColor: colors.border, textAlignVertical: 'top' }]}
                  value={expandedInput === 'front' ? frontState.state : layersState.state[expandedInput as number]}
                  onChangeText={expandedInput === 'front' ? frontState.set : (text) => {
                    const newLayers = [...layersState.state];
                    newLayers[expandedInput as number] = text;
                    layersState.set(newLayers);
                  }}
                  onSelectionChange={(e) => setSelections({ ...selections, [expandedInput]: e.nativeEvent.selection })}
                  placeholder="Type here..."
                  placeholderTextColor={colors.textSecondary}
                  multiline
                />
              </>
            )}
          </View>
        </Modal>

        {/* Custom Color Modal */}
        <Modal visible={showColorPicker} animationType="fade" transparent={true} onRequestClose={() => setShowColorPicker(false)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: spacing[4] }}>
            <Pressable accessible={false} importantForAccessibility="no" style={StyleSheet.absoluteFill} onPress={() => setShowColorPicker(false)} />
            <View accessibilityViewIsModal style={{ width: '100%', backgroundColor: colors.card, borderRadius: 12, padding: spacing[4], elevation: 10, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10 }}>
              <Text accessibilityRole="header" style={{ fontSize: typography.lg, fontWeight: 'bold', color: colors.text, marginBottom: spacing[4], textAlign: 'center' }}>Custom Color</Text>
              
              <View style={{ width: '100%', height: 60, backgroundColor: noteColor || colors.background, justifyContent: 'center', alignItems: 'center', borderRadius: 8, marginBottom: spacing[4], borderWidth: 1, borderColor: colors.border }}>
                <Text style={{ fontSize: typography.lg, fontWeight: 'bold', color: textColor || colors.text }}>Preview Text</Text>
              </View>

              <Text style={{ color: colors.textSecondary, marginBottom: spacing[2], fontSize: typography.sm, fontWeight: 'bold' }}>Background Color</Text>
              <TextInput
                accessibilityLabel="Card background color hex code"
                style={[styles.input, { color: colors.text, borderColor: colors.border, marginBottom: spacing[3] }]}
                placeholder="#E8F5E9"
                placeholderTextColor={colors.textSecondary}
                value={noteColor}
                onChangeText={setNoteColor}
                autoCapitalize="characters"
                maxLength={7}
              />
              <View 
                onLayout={(e) => setSpectrumWidth(e.nativeEvent.layout.width)}
                onStartShouldSetResponder={() => true}
                onResponderGrant={handleBgColorDrag}
                onResponderMove={handleBgColorDrag}
                style={{ width: '100%', height: 30, borderRadius: 15, marginBottom: spacing[4], position: 'relative' }}
              >
                <LinearGradient colors={['#FFCDD2', '#FFF9C4', '#C8E6C9', '#B2EBF2', '#BBDEFB', '#E1BEE7', '#FFCDD2']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flex: 1, borderRadius: 15 }} />
                <View style={{ position: 'absolute', left: Math.max(0, Math.min(spectrumWidth - 20, (hexToHsl(noteColor).h / 360) * spectrumWidth - 10)), top: -2, width: 20, height: 34, borderRadius: 10, backgroundColor: '#fff', borderWidth: 2, borderColor: '#000', elevation: 5 }} pointerEvents="none" />
              </View>

              <Text style={{ color: colors.textSecondary, marginBottom: spacing[2], fontSize: typography.sm, fontWeight: 'bold' }}>Text Color</Text>
              <TextInput
                accessibilityLabel="Card text color hex code"
                style={[styles.input, { color: colors.text, borderColor: colors.border, marginBottom: spacing[3] }]}
                placeholder="#0F172A"
                placeholderTextColor={colors.textSecondary}
                value={textColor}
                onChangeText={setTextColor}
                autoCapitalize="characters"
                maxLength={7}
              />
              <View 
                onStartShouldSetResponder={() => true}
                onResponderGrant={handleTextColorDrag}
                onResponderMove={handleTextColorDrag}
                style={{ width: '100%', height: 30, borderRadius: 15, marginBottom: spacing[6], position: 'relative' }}
              >
                <LinearGradient colors={['#B71C1C', '#F57F17', '#1B5E20', '#006064', '#0D47A1', '#4A148C', '#B71C1C']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flex: 1, borderRadius: 15 }} />
                <View style={{ position: 'absolute', left: Math.max(0, Math.min(spectrumWidth - 20, (hexToHsl(textColor).h / 360) * spectrumWidth - 10)), top: -2, width: 20, height: 34, borderRadius: 10, backgroundColor: '#fff', borderWidth: 2, borderColor: '#000', elevation: 5 }} pointerEvents="none" />
              </View>

              <Pressable accessibilityRole="button" accessibilityLabel="Finish choosing card colors" onPress={() => setShowColorPicker(false)} style={[styles.actionBtn, { backgroundColor: colors.primary, width: '100%' }]}>
                <Text style={[styles.actionBtnText, { color: colors.buttonText }]}>Done</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        {/* Formatting Guide Modal */}
        <Modal visible={showFormatGuide} animationType="fade" transparent={true} onRequestClose={() => setShowFormatGuide(false)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: spacing[4] }}>
            <Pressable accessible={false} importantForAccessibility="no" style={StyleSheet.absoluteFill} onPress={() => setShowFormatGuide(false)} />
            <View accessibilityViewIsModal style={{ width: '100%', backgroundColor: colors.card, borderRadius: 12, padding: spacing[4], elevation: 10, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10 }}>
              <Text accessibilityRole="header" style={{ fontSize: typography.lg, fontWeight: 'bold', color: colors.text, marginBottom: spacing[4] }}>Formatting Guide</Text>
              
              <Text style={{ color: colors.text, marginBottom: spacing[2] }}><Text style={{fontWeight: 'bold'}}>Bold:</Text> **text**</Text>
              <Text style={{ color: colors.text, marginBottom: spacing[2] }}><Text style={{fontWeight: 'bold'}}>Italic:</Text> *text*</Text>
              <Text style={{ color: colors.text, marginBottom: spacing[2] }}><Text style={{fontWeight: 'bold'}}>Underline:</Text> [text](format:underline)</Text>
              <Text style={{ color: colors.text, marginBottom: spacing[2] }}><Text style={{fontWeight: 'bold'}}>Headings:</Text> # H1, ## H2, ### H3</Text>
              <Text style={{ color: colors.text, marginBottom: spacing[2] }}><Text style={{fontWeight: 'bold'}}>Text Color:</Text> [text](color:red) (or #HEX)</Text>
              <Text style={{ color: colors.text, marginBottom: spacing[4] }}><Text style={{fontWeight: 'bold'}}>Highlight:</Text> [text](bg:yellow) (or #HEX)</Text>

              <Pressable accessibilityRole="button" accessibilityLabel="Close formatting guide" onPress={() => setShowFormatGuide(false)} style={[styles.actionBtn, { backgroundColor: colors.primary, width: '100%' }]}>
                <Text style={[styles.actionBtnText, { color: colors.buttonText }]}>Close</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        {/* Format Color Picker Modal */}
        <Modal visible={showFormatColorPicker} animationType="fade" transparent={true} onRequestClose={() => setShowFormatColorPicker(false)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: spacing[4] }}>
            <Pressable accessible={false} importantForAccessibility="no" style={StyleSheet.absoluteFill} onPress={() => setShowFormatColorPicker(false)} />
            <View accessibilityViewIsModal style={{ width: '100%', backgroundColor: colors.card, borderRadius: 12, padding: spacing[4], elevation: 10, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10 }}>
              <Text accessibilityRole="header" style={{ fontSize: typography.lg, fontWeight: 'bold', color: colors.text, marginBottom: spacing[4], textAlign: 'center' }}>Custom {formatColorTarget === 'bg' ? 'Highlight' : 'Text'} Color</Text>

              <View style={{ width: '100%', height: 60, backgroundColor: formatColorTarget === 'bg' ? formatCustomBg : colors.background, justifyContent: 'center', alignItems: 'center', borderRadius: 8, marginBottom: spacing[4], borderWidth: 1, borderColor: colors.border }}>
                <Text style={{ fontSize: typography.lg, fontWeight: 'bold', color: formatColorTarget === 'color' ? formatCustomColor : (accessibleTextColor(formatCustomBg) || colors.text) }}>Preview Text</Text>
              </View>
              
              <Text style={{ color: colors.textSecondary, marginBottom: spacing[2], fontSize: typography.sm, fontWeight: 'bold' }}>Pick Color</Text>
              <View 
                onStartShouldSetResponder={() => true}
                onResponderGrant={handleFormatColorDrag}
                onResponderMove={handleFormatColorDrag}
                style={{ width: '100%', height: 30, borderRadius: 15, marginBottom: spacing[4], position: 'relative' }}
              >
                <LinearGradient colors={['#FF0000', '#FFFF00', '#00FF00', '#00FFFF', '#0000FF', '#FF00FF', '#FF0000']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flex: 1, borderRadius: 15 }} />
                <View style={{ position: 'absolute', left: Math.max(0, Math.min(spectrumWidth - 20, (hexToHsl(formatColorTarget === 'bg' ? formatCustomBg : formatCustomColor).h / 360) * spectrumWidth - 10)), top: -2, width: 20, height: 34, borderRadius: 10, backgroundColor: '#fff', borderWidth: 2, borderColor: '#000', elevation: 5 }} pointerEvents="none" />
              </View>

              <View style={{ flexDirection: 'row', gap: spacing[2], marginBottom: spacing[6], alignItems: 'center' }}>
                <TextInput accessibilityLabel={`Custom ${formatColorTarget === 'bg' ? 'highlight' : 'text'} color hex code`} style={{ flex: 1, height: 40, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: spacing[2], color: colors.text }} placeholder="#HEX" value={formatColorTarget === 'bg' ? formatCustomBg : formatCustomColor} onChangeText={formatColorTarget === 'bg' ? setFormatCustomBg : setFormatCustomColor} autoCapitalize="characters" maxLength={7} />
                <View style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: formatColorTarget === 'bg' ? formatCustomBg : formatCustomColor, borderWidth: 1, borderColor: colors.border }} />
              </View>

              <Pressable accessibilityRole="button" accessibilityLabel="Insert custom color formatting" onPress={() => {
                const customColor = formatColorTarget === 'bg' ? formatCustomBg : formatCustomColor;
                if (!isSixDigitHexColor(customColor)) {
                  setOperationError('Formatting colors must use six-digit hex values such as #8B5CF6.');
                  return;
                }
                if (showFormatToolbarFor !== null) {
                  applyFormatting(showFormatToolbarFor, '[', `](${formatColorTarget}:${customColor})`);
                }
                setShowFormatColorPicker(false);
              }} style={[styles.actionBtn, { backgroundColor: colors.primary, width: '100%' }]}>
                <Text style={[styles.actionBtnText, { color: colors.buttonText }]}>Insert Formatting</Text>
              </Pressable>
              
              <Pressable accessibilityRole="button" accessibilityLabel="Cancel custom color formatting" onPress={() => setShowFormatColorPicker(false)} style={[styles.actionBtn, { backgroundColor: colors.border, width: '100%', marginTop: spacing[2] }]}>
                <Text style={[styles.actionBtnText, { color: colors.text }]}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  return (
    <Pressable style={[styles.cardRow, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={onToggleEdit} accessibilityRole="button" accessibilityLabel="Edit card">
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, paddingRight: spacing[2] }}>
          <Text style={[styles.cardFrontText, { color: colors.text }]} numberOfLines={1}>
            {frontState.state}
          </Text>
          <Text style={[styles.cardBackText, { color: colors.textSecondary }]} numberOfLines={1}>
            {layersState.state.length > 0 ? layersState.state[0] : ''} {layersState.state.length > 1 ? `(+${layersState.state.length - 1} pages)` : ''}
          </Text>
        </View>
        <View style={styles.editIconBtn}>
          <Text style={{ fontSize: 18 }}>✏️</Text>
        </View>
      </View>
      
      <View style={[styles.statsRow, { borderTopColor: colors.border }]}>
        <Text style={[styles.statsText, { color: colors.textSecondary }]}>Due: {new Date(item.card.due).toLocaleDateString()}</Text>
        <Text style={[styles.statsText, { color: colors.textSecondary }]}>Reps: {item.card.reps}</Text>
      </View>
      {(item.card.tags && item.card.tags.length > 0) && (
        <View style={styles.cardTagsRow}>
          {item.card.tags.map(t => (
            <View key={t} style={[styles.cardTagSmall, { backgroundColor: colors.primary }]}><Text style={[styles.cardTagSmallText, { color: colors.buttonText }]}>{t}</Text></View>
          ))}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cardRow: {
    padding: spacing[4],
    borderRadius: 12,
    marginBottom: spacing[3],
    borderWidth: 1,
  },
  cardFrontText: {
    fontSize: typography.base,
    fontWeight: '700',
    marginBottom: spacing[1],
  },
  cardBackText: {
    fontSize: typography.sm,
    marginBottom: spacing[2],
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    paddingTop: spacing[2],
  },
  statsText: {
    fontSize: typography.xs,
  },
  cardTagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: spacing[2],
  },
  cardTagSmall: {
    paddingHorizontal: spacing[1] + 2,
    paddingVertical: spacing[0] + 2,
    borderRadius: 8,
  },
  cardTagSmallText: {
    fontSize: typography.xs - 2,
    fontWeight: 'bold',
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: spacing[3],
    fontSize: typography.base,
    minHeight: 44,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing[4],
    paddingTop: spacing[3],
    borderTopWidth: 1,
    borderTopColor: 'rgba(150,150,150,0.2)',
  },
  actionBtn: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: 8,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionBtnText: {
    fontWeight: 'bold',
    fontSize: typography.sm,
  },
  editIconBtn: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  editorHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing[1],
  },
  editorTitle: {
    fontSize: typography.sm,
    fontWeight: 'bold',
  },
  mediaBtn: {
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderRadius: 4,
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pagesActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
    marginTop: spacing[3],
  },
  pageBtn: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: 6,
    minHeight: 44,
    justifyContent: 'center',
  },
  formatBtn: {
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    backgroundColor: 'rgba(255,255,255,0.8)',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  formatText: {
    fontWeight: 'bold',
    fontSize: typography.sm,
  }
});
