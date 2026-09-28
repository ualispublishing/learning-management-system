/**
 * @fileoverview src/components/editor/CardEditor.tsx.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Modal, Pressable, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { EditorStore } from '../../lib/db/store';
import { userAlert as Alert } from '../../lib/userAlert';
import Markdown from 'react-native-markdown-display';
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
import { getError } from '../../lib/errorCodes';
import { useRouter, useNavigation } from 'expo-router';
import { useThemeColors } from '../../lib/useThemeColors';
import { typography, spacing } from '../../lib/theme';
import { createEntityId } from '../../lib/id';
import { accessibleTextColor, hasAccessibleTextContrast, isSixDigitHexColor } from '../../lib/color';
import { findInvalidCardMediaUris } from '../../lib/cardMedia';
import { DIAGNOSTIC_CONTEXTS, logDiagnosticError } from '../../lib/diagnosticLog';

interface CardEditorProps {
  deckId: string;
}


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

const presetColors = ['#E8F5E9', '#FFF3E0', '#E3F2FD', '#FCE4EC', '#F3E5F5', '#F8FAFC'];

export default function CardEditor({ deckId }: CardEditorProps) {
  const router = useRouter();
  const leaveEditor = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };
  const navigation = useNavigation();
  const colors = useThemeColors();
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const frontState = useHistoryState('');
  const layersState = useHistoryState<string[]>(['']);
  const [activeTab, setActiveTab] = useState<number>(0); // 0 is Front, 1+ are Layers
  const [previewMode, setPreviewMode] = useState(false);
  const [recording, setRecording] = useState<AudioRecorder | undefined>();
  const recordingRef = React.useRef<AudioRecorder | undefined>(undefined);
  const recordingTargetRef = React.useRef<number | null>(null);
  const recordingOperationRef = React.useRef(false);
  const recordingAudioModeRef = React.useRef(false);
  const [recordingBusy, setRecordingBusy] = useState(false);
  const [recordingStatus, setRecordingStatus] = useState<string | null>(null);
  const [isReversible, setIsReversible] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [selection, setSelection] = useState({ start: 0, end: 0 });

  const [noteColor, setNoteColor] = useState<string>('');
  const [textColor, setTextColor] = useState<string>('');
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [spectrumWidth, setSpectrumWidth] = useState(300);

  const [showFormatGuide, setShowFormatGuide] = useState(false);
  const [showFormatColorPicker, setShowFormatColorPicker] = useState(false);
  const [formatColorTarget, setFormatColorTarget] = useState<'color' | 'bg' | null>(null);
  const [formatCustomColor, setFormatCustomColor] = useState('#8B5CF6');
  const [formatCustomBg, setFormatCustomBg] = useState('#FBCFE8');
  const [isContentInputFocused, setIsContentInputFocused] = useState(false);

  const isSaved = React.useRef(false);
  const isMounted = React.useRef(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
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
      if (!isContentInputFocused) return;
      const isModifier = e.ctrlKey || e.metaKey;
      if (!isModifier) return;

      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        if (e.shiftKey) {
          if (activeTab === 0 && frontState.canRedo) frontState.redo();
          else if (activeTab > 0 && layersState.canRedo) layersState.redo();
        } else {
          if (activeTab === 0 && frontState.canUndo) frontState.undo();
          else if (activeTab > 0 && layersState.canUndo) layersState.undo();
        }
      } else if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault();
        if (activeTab === 0 && frontState.canRedo) frontState.redo();
        else if (activeTab > 0 && layersState.canRedo) layersState.redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, frontState, isContentInputFocused, layersState]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (isSaved.current) return;
      const hasChanges = frontState.state.trim() !== '' || layersState.state.some(l => l.trim() !== '');
      if (!hasChanges) return;
      
      e.preventDefault();
      Alert.alert(
        'Discard changes?',
        'You have unsaved changes. Are you sure to discard them and leave?',
        [
          { text: 'Don\'t leave', style: 'cancel', onPress: () => {} },
          { text: 'Discard', style: 'destructive', onPress: () => navigation.dispatch(e.data.action) },
        ]
      );
    });
    return unsubscribe;
  }, [navigation, frontState.state, layersState.state]);

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


  const addLayer = () => {
    if (layersState.state.length >= 1_000) {
      Alert.alert('Page limit reached', 'A card may contain at most 1,000 pages.');
      return;
    }
    layersState.set([...layersState.state, '']);
    setActiveTab(layersState.state.length + 1); // Switch to the new layer
  };

  const updateLayer = (index: number, content: string) => {
    const newLayers = [...layersState.state];
    newLayers[index] = content;
    layersState.set(newLayers);
  };

  const handleSave = async () => {
    if (isSaving) return;
    if (!frontState.state.trim() || layersState.state[0].trim() === '') {
      Alert.alert('Validation Error', getError('V3002'));
      return;
    }
    if ((noteColor && !isSixDigitHexColor(noteColor)) || (textColor && !isSixDigitHexColor(textColor))) {
      Alert.alert('Validation Error', 'Card colors must be empty or use six-digit hex values such as #E8F5E9.');
      return;
    }
    if (textColor && (!noteColor || !hasAccessibleTextContrast(textColor, noteColor))) {
      Alert.alert('Validation Error', 'Choose a card background and text color with at least 4.5:1 contrast, or leave text color empty for automatic accessible text.');
      return;
    }
    const invalidMedia = [frontState.state, ...layersState.state].flatMap(findInvalidCardMediaUris);
    if (invalidMedia.length > 0) {
      Alert.alert('Validation Error', 'Card media must use a credential-free HTTPS address or an audio file recorded in this app. HTTP, device paths, and custom URI schemes are blocked.');
      return;
    }
    setIsSaving(true);
    try {
      const allTags = [...tags];
      if (tagInput.trim()) {
        allTags.push(tagInput.trim());
      }
      const parsedTags = allTags.flatMap(t => t.split(',').map(tag => tag.trim())).filter(t => t.length > 0);

      const additionalFields = { color: noteColor, textColor };
      const definitions = [{
        frontContent: frontState.state.trim(),
        layers: layersState.state.map(layer => layer.trim()),
        initialUnlockedLayers: 1,
        tags: parsedTags,
        additionalFields,
      }];
      if (isReversible) {
        definitions.push({
          frontContent: layersState.state[0].trim(),
          layers: [frontState.state.trim(), ...layersState.state.slice(1).map(layer => layer.trim())],
          initialUnlockedLayers: 1,
          tags: parsedTags,
          additionalFields,
        });
      }
      await EditorStore.createCardsWithLayers(deckId, definitions);
      isSaved.current = true;

      Alert.alert('Success', 'Card created successfully!', [
        { text: 'OK', onPress: leaveEditor }
      ]);
    } catch (e) {
      logDiagnosticError(DIAGNOSTIC_CONTEXTS.cardSave, e);
      Alert.alert('Card not saved', e instanceof Error ? e.message : getError('E1003'));
      if (isMounted.current) setIsSaving(false);
    }
  };

  const applyFormat = (prefix: string, suffix: string = prefix) => {
    const text = activeTab === 0 ? frontState.state : layersState.state[activeTab - 1];
    const newText = text.substring(0, selection.start) + prefix + text.substring(selection.start, selection.end) + suffix + text.substring(selection.end);
    if (activeTab === 0) frontState.set(newText);
    else updateLayer(activeTab - 1, newText);
  };

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

  const startRecording = async () => {
    if (recordingRef.current || recordingOperationRef.current) return;
    recordingOperationRef.current = true;
    recordingTargetRef.current = activeTab;
    setRecordingBusy(true);
    setRecordingStatus(null);
    try {
      if (Platform.OS === 'web') {
        setRecordingStatus('Unavailable on web: Audio recording is available in the iOS and Android card editors.');
        return;
      }
      const permission = await requestRecordingPermissionsAsync();
      if (permission.granted) {
        await setAudioModeAsync({
          allowsRecording: true,
          playsInSilentMode: true,
        });
        recordingAudioModeRef.current = true;
        await audioRecorder.prepareToRecordAsync();
        audioRecorder.record();
        if (isMounted.current) {
          recordingRef.current = audioRecorder;
          setRecording(audioRecorder);
        } else {
          await audioRecorder.stop();
          recordingAudioModeRef.current = false;
          await setAudioModeAsync({ allowsRecording: false });
        }
      } else {
        Alert.alert('Permission Denied', getError('E2003'));
      }
    } catch (err) {
      logDiagnosticError(DIAGNOSTIC_CONTEXTS.recordingStart, err);
      if (recordingAudioModeRef.current) {
        recordingAudioModeRef.current = false;
        void setAudioModeAsync({ allowsRecording: false }).catch(() => {});
      }
      Alert.alert('Recording failed', 'Recording could not be started. Check microphone access and try again.');
    } finally {
      if (!recordingRef.current) recordingTargetRef.current = null;
      recordingOperationRef.current = false;
      if (isMounted.current) setRecordingBusy(false);
    }
  };

  const stopRecording = async () => {
    if (recordingOperationRef.current) return;
    const activeRecording = recordingRef.current;
    if (!activeRecording) return;
    const recordingTarget = recordingTargetRef.current;
    recordingOperationRef.current = true;
    setRecordingBusy(true);
    recordingRef.current = undefined;
    recordingTargetRef.current = null;
    setRecording(undefined);
    try {
      await activeRecording.stop();
      const uri = activeRecording.uri;
      if (uri) {
        if (!FileSystem.documentDirectory) throw new Error('No writable document directory is available.');
        const filename = `${createEntityId('audio')}.m4a`;
        const destUri = FileSystem.documentDirectory + filename;
        await FileSystem.copyAsync({ from: uri, to: destUri });
        
        // Inject [AUDIO:filename] to current active tab content using relative path
        if (isMounted.current) {
          if (recordingTarget === 0) {
            frontState.set(frontState.state + `\n\n[AUDIO:${filename}]`);
          } else if (recordingTarget !== null && layersState.state[recordingTarget - 1] !== undefined) {
            updateLayer(recordingTarget - 1, layersState.state[recordingTarget - 1] + `\n\n[AUDIO:${filename}]`);
          }
        }
      }
    } catch (error) {
      logDiagnosticError(DIAGNOSTIC_CONTEXTS.recordingSave, error);
      Alert.alert('Recording failed', 'The recording could not be saved. Please record it again.');
    } finally {
      recordingAudioModeRef.current = false;
      void setAudioModeAsync({ allowsRecording: false }).catch(() => {});
      recordingOperationRef.current = false;
      if (isMounted.current) setRecordingBusy(false);
    }
  };

  const currentContent = activeTab === 0 ? frontState.state : layersState.state[activeTab - 1];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Tab Bar */}
      <View style={[styles.tabBar, { borderBottomColor: colors.border }]}>
        <ScrollView keyboardShouldPersistTaps="handled" horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabScroll}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 0 && { borderBottomColor: colors.primary }]}
            onPress={() => setActiveTab(0)}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === 0 }}
          >
            <Text style={[styles.tabText, { color: colors.textSecondary }, activeTab === 0 && { color: colors.primary }]}>Front</Text>
          </TouchableOpacity>
          
          {layersState.state.map((_, i) => (
            <TouchableOpacity
              key={i}
              style={[styles.tab, activeTab === i + 1 && { borderBottomColor: colors.primary }]}
              onPress={() => setActiveTab(i + 1)}
              accessibilityRole="tab"
              accessibilityState={{ selected: activeTab === i + 1 }}
            >
              <Text style={[styles.tabText, { color: colors.textSecondary }, activeTab === i + 1 && { color: colors.primary }]}>Page {i + 1}</Text>
            </TouchableOpacity>
          ))}
          
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Add card page" style={styles.addTab} onPress={addLayer}>
            <Text style={[styles.addTabText, { color: colors.primary }]}>+ Add</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>

      {/* Media Buttons */}
      <View style={styles.mediaBar}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={recordingBusy ? 'Audio recording operation in progress' : recording ? 'Stop audio recording' : 'Record card audio'} accessibilityState={{ disabled: recordingBusy, busy: recordingBusy }} disabled={recordingBusy} style={[styles.mediaButton, { backgroundColor: colors.card, opacity: recordingBusy ? 0.55 : 1 }]} onPress={recording ? stopRecording : startRecording}>
          <Text style={[styles.mediaButtonText, { color: colors.text }, recording && { color: colors.error, fontWeight: 'bold' }]}> 
            {recordingBusy ? 'Working…' : recording ? '⏹️ Stop' : '🎤 Record'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Read card content aloud" style={[styles.mediaButton, { backgroundColor: colors.card }]} onPress={() => speakText(currentContent)}>
          <Text style={[styles.mediaButtonText, { color: colors.text }]}>🔊 TTS</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={previewMode ? 'Return to card editing' : 'Preview card formatting'} accessibilityState={{ selected: previewMode }} style={[styles.mediaButton, { backgroundColor: colors.card }]} onPress={() => setPreviewMode(!previewMode)}>
          <Text style={[styles.mediaButtonText, { color: colors.text }]}>{previewMode ? 'Edit' : 'Preview'}</Text>
        </TouchableOpacity>
      </View>
      {recordingStatus && (
        <Text accessibilityRole="alert" style={[styles.recordingStatus, { color: colors.error }]}>
          {recordingStatus}
        </Text>
      )}

      {/* Formatting Toolbar */}
      {!previewMode && (
        <View style={{ backgroundColor: 'rgba(0,0,0,0.05)', borderRadius: 8, marginBottom: 8, padding: 8 }}>
          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', marginBottom: 8 }}>
            <Pressable 
              onPress={() => activeTab === 0 ? frontState.undo() : layersState.undo()} 
              style={[styles.formatBtn, { backgroundColor: colors.border }]}
              disabled={activeTab === 0 ? !frontState.canUndo : !layersState.canUndo}
              accessibilityRole="button"
              accessibilityLabel="Undo card content change"
              accessibilityState={{ disabled: activeTab === 0 ? !frontState.canUndo : !layersState.canUndo }}
            >
              <Text style={[styles.formatText, { opacity: (activeTab === 0 ? frontState.canUndo : layersState.canUndo) ? 1 : 0.3 }]}>↩</Text>
            </Pressable>
            <Pressable 
              onPress={() => activeTab === 0 ? frontState.redo() : layersState.redo()} 
              style={[styles.formatBtn, { backgroundColor: colors.border }]}
              disabled={activeTab === 0 ? !frontState.canRedo : !layersState.canRedo}
              accessibilityRole="button"
              accessibilityLabel="Redo card content change"
              accessibilityState={{ disabled: activeTab === 0 ? !frontState.canRedo : !layersState.canRedo }}
            >
              <Text style={[styles.formatText, { opacity: (activeTab === 0 ? frontState.canRedo : layersState.canRedo) ? 1 : 0.3 }]}>↪</Text>
            </Pressable>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: spacing[2] }}>
            <Pressable accessibilityRole="button" accessibilityLabel="Format selected text as bold" onPress={() => applyFormat('**', '**')} style={styles.formatBtn}><Text style={styles.formatText}>B</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Format selected text as italic" onPress={() => applyFormat('*', '*')} style={styles.formatBtn}><Text style={[styles.formatText, { fontStyle: 'italic' }]}>I</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Underline selected text" onPress={() => applyFormat('[', '](format:underline)')} style={styles.formatBtn}><Text style={[styles.formatText, { textDecorationLine: 'underline' }]}>U</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Make heading level 1" onPress={() => applyFormat('# ', '')} style={styles.formatBtn}><Text style={styles.formatText}>H1</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Make heading level 2" onPress={() => applyFormat('## ', '')} style={styles.formatBtn}><Text style={styles.formatText}>H2</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Make heading level 3" onPress={() => applyFormat('### ', '')} style={styles.formatBtn}><Text style={styles.formatText}>H3</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Insert image address" onPress={() => applyFormat('![image](', ')')} style={styles.formatBtn}><Text style={styles.formatText}>Image</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Insert video address" onPress={() => applyFormat('[VIDEO:', ']')} style={styles.formatBtn}><Text style={styles.formatText}>Video</Text></Pressable>
            
            <Pressable accessibilityRole="button" accessibilityLabel="Open formatting guide" onPress={() => setShowFormatGuide(true)} style={[styles.formatBtn, { backgroundColor: colors.info, marginLeft: 'auto' }]}> 
              <Text style={[styles.formatText, { color: colors.onInfo }]}>ⓘ Guide</Text>
            </Pressable>
          </View>

          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: spacing[2] }}>
            <Text style={{ fontSize: typography.xs, color: colors.textSecondary, alignSelf: 'center', width: 50 }}>Color:</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Format selected text in red" onPress={() => applyFormat('[', '](color:#EF4444)')} style={[styles.formatBtn, { borderColor: '#EF4444', borderWidth: 2 }]}><Text style={[styles.formatText, { color: colors.text }]}>Red</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Format selected text in blue" onPress={() => applyFormat('[', '](color:#3B82F6)')} style={[styles.formatBtn, { borderColor: '#3B82F6', borderWidth: 2 }]}><Text style={[styles.formatText, { color: colors.text }]}>Blue</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`Format selected text in ${formatCustomColor}`} onPress={() => applyFormat('[', `](color:${formatCustomColor})`)} style={[styles.formatBtn, { borderColor: formatCustomColor, borderWidth: 2 }]}><Text style={[styles.formatText, { color: colors.text }]}>Custom</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Choose custom text color" onPress={() => { setFormatColorTarget('color'); setShowFormatColorPicker(true); }} style={styles.formatBtn}><Text style={styles.formatText}>+</Text></Pressable>
          </View>

          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Text style={{ fontSize: typography.xs, color: colors.textSecondary, alignSelf: 'center', width: 50 }}>Highl.:</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Highlight selected text in yellow" onPress={() => applyFormat('[', '](bg:#FEF08A)')} style={[styles.formatBtn, { backgroundColor: '#FEF08A' }]}><Text style={[styles.formatText, { color: '#000' }]}>Yellow</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Highlight selected text in cyan" onPress={() => applyFormat('[', '](bg:#A7F3D0)')} style={[styles.formatBtn, { backgroundColor: '#A7F3D0' }]}><Text style={[styles.formatText, { color: '#000' }]}>Cyan</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`Highlight selected text in ${formatCustomBg}`} onPress={() => applyFormat('[', `](bg:${formatCustomBg})`)} style={[styles.formatBtn, { backgroundColor: formatCustomBg }]}><Text style={[styles.formatText, { color: accessibleTextColor(formatCustomBg) || colors.text }]}>Custom</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Choose custom highlight color" onPress={() => { setFormatColorTarget('bg'); setShowFormatColorPicker(true); }} style={styles.formatBtn}><Text style={styles.formatText}>+</Text></Pressable>
          </View>
        </View>
      )}

      {/* Editor / Preview */}
      <View style={[styles.editorContainer, { backgroundColor: colors.card }]}>
        {previewMode ? (
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.preview}>
            <Markdown rules={{
              image: (node: any) => <Text key={node.key} accessibilityLabel={`Protected image preview: ${node.attributes?.alt || 'card image'}`} style={{ color: colors.textSecondary }}>[Image preview protected — open the full card preview to load it]</Text>,
              link: (node: any, children: any) => <Text key={node.key} style={{ color: colors.primary }}>{children}</Text>,
            }} style={{
              body: { color: colors.text, fontSize: typography.lg },
              heading1: { color: colors.text },
              heading2: { color: colors.text },
              heading3: { color: colors.text },
              link: { color: colors.primary },
            }}>{currentContent}</Markdown>
          </ScrollView>
        ) : (
            <TextInput
              accessibilityLabel={activeTab === 0 ? 'Card front content' : `Card page ${activeTab} content`}
              style={[styles.textInput, { color: colors.text }]}
              multiline
              placeholder={activeTab === 0 ? "Enter front text here.\n\nFormatting: **bold**, *italic*\nMedia: [IMAGE:url], [VIDEO:url], [AUDIO:url]\nColors: [Text](color:red) or [Text](bg:yellow)\n\nTip: A single media tag creates a Fullscreen Card!" : `Enter text for Page ${activeTab}...\n\nThis will be revealed sequentially during study as a depth layer.`}
              placeholderTextColor={colors.textSecondary}
              value={currentContent}
              maxLength={250_000}
              onChangeText={(text) => {
                if (activeTab === 0) frontState.set(text);
                else updateLayer(activeTab - 1, text);
              }}
              onFocus={() => setIsContentInputFocused(true)}
              onBlur={() => setIsContentInputFocused(false)}
              onSelectionChange={(e) => setSelection(e.nativeEvent.selection)}
            />
          )}
        </View>

        {/* Tags & Toggles */}
        <View style={[styles.optionsContainer, { backgroundColor: colors.card }]}>
          <View style={styles.tagsSection}>
            <Text style={[styles.optionsLabel, { color: colors.text }]}>Tags (comma separated):</Text>
            <View style={styles.tagsList}>
              {tags.map((t, idx) => (
                <View key={idx} style={[styles.tagBadge, { backgroundColor: colors.primary }]}>
                  <Text style={[styles.tagText, { color: colors.buttonText }]}>{t}</Text>
                  <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Remove ${t} tag`} onPress={() => setTags(prev => prev.filter((_, i) => i !== idx))}>
                    <Text style={[styles.tagRemove, { color: colors.buttonText }]}>×</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
            <TextInput
              accessibilityLabel="Card tags"
              style={[styles.tagInput, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
              placeholder="Add tags (e.g. math, science) and press enter..."
              placeholderTextColor={colors.textSecondary}
              value={tagInput}
              maxLength={10_100}
              onChangeText={setTagInput}
              onSubmitEditing={() => {
                const newTags = tagInput.split(',').map(t => t.trim()).filter(t => t && !tags.includes(t));
                setTags(prev => [...prev, ...newTags]);
                setTagInput('');
              }}
              blurOnSubmit={false}
            />
          </View>

          {/* Card Color Selection */}
          <View style={{ marginBottom: spacing[4] }}>
            <Text style={[styles.optionsLabel, { color: colors.text, marginBottom: spacing[2] }]}>Card Colors:</Text>
            <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
              {presetColors.map(color => (
                <Pressable
                  key={color}
                  onPress={() => setNoteColor(noteColor === color ? '' : color)}
                  style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: color, borderWidth: 2, borderColor: noteColor === color ? colors.primary : colors.border }}
                  accessibilityRole="button"
                  accessibilityLabel={`Use ${color} as card color`}
                  accessibilityState={{ selected: noteColor === color }}
                />
              ))}
              {showColorPicker ? (
                <Pressable accessibilityRole="button" accessibilityLabel="Finish choosing custom card colors" onPress={() => setShowColorPicker(false)} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ fontSize: 16, color: colors.buttonText }}>✓</Text>
                </Pressable>
              ) : (
                <Pressable accessibilityRole="button" accessibilityLabel="Choose custom card colors" onPress={() => setShowColorPicker(true)} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ fontSize: 18, color: colors.textSecondary }}>+</Text>
                </Pressable>
              )}
            </View>
          </View>
          
          <View style={styles.toggleRow}>
            <View>
              <Text style={[styles.optionsLabel, { color: colors.text }]}>Generate Reversible Card?</Text>
              <Text style={{ color: colors.textSecondary, fontSize: typography.xs, marginTop: 2 }}>Creates a second card with front/back swapped.</Text>
            </View>
            <TouchableOpacity 
              style={[styles.toggleTrack, { backgroundColor: colors.border }, isReversible && { backgroundColor: colors.primary }]} 
              onPress={() => setIsReversible(!isReversible)}
              accessibilityRole="switch"
              accessibilityLabel="Generate reversible card"
              accessibilityState={{ checked: isReversible }}
            >
              <View style={[styles.toggleThumb, isReversible && { transform: [{ translateX: 20 }] }]} />
            </TouchableOpacity>
          </View>
        </View>

      {/* Save Button */}
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={isSaving ? 'Saving card' : 'Save card'} accessibilityState={{ disabled: isSaving, busy: isSaving }} style={[styles.saveButton, { backgroundColor: isSaving ? colors.border : colors.primary }]} onPress={handleSave} disabled={isSaving}>
        <Text style={[styles.saveButtonText, { color: isSaving ? colors.textSecondary : colors.buttonText }]}>{isSaving ? 'Saving...' : 'Save Card'}</Text>
      </TouchableOpacity>
      {/* Custom Color Modal */}
      <Modal visible={showColorPicker} animationType="fade" transparent={true} onRequestClose={() => setShowColorPicker(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: spacing[4] }}>
          <Pressable accessible={false} importantForAccessibility="no" style={StyleSheet.absoluteFill} onPress={() => setShowColorPicker(false)} />
          <View accessibilityViewIsModal style={{ width: '100%', backgroundColor: colors.card, borderRadius: 12, padding: spacing[4] }}>
            <Text accessibilityRole="header" style={{ fontSize: typography.lg, fontWeight: 'bold', color: colors.text, marginBottom: spacing[4], textAlign: 'center' }}>Custom Color</Text>
            <View style={{ width: '100%', height: 60, backgroundColor: noteColor || colors.background, justifyContent: 'center', alignItems: 'center', borderRadius: 8, marginBottom: spacing[4], borderWidth: 1, borderColor: colors.border }}>
              <Text style={{ fontSize: typography.lg, fontWeight: 'bold', color: textColor || colors.text }}>Preview Text</Text>
            </View>
            <Text style={{ color: colors.textSecondary, marginBottom: spacing[2], fontSize: typography.sm, fontWeight: 'bold' }}>Background Color</Text>
            <TextInput
              accessibilityLabel="Card background color hex code"
              style={[styles.tagInput, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border, marginBottom: spacing[3] }]}
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
              <View style={{ position: 'absolute', left: Math.max(0, Math.min(spectrumWidth - 20, (hexToHsl(noteColor).h / 360) * spectrumWidth - 10)), top: -2, width: 20, height: 34, borderRadius: 10, backgroundColor: '#fff', borderWidth: 2, borderColor: '#000' }} pointerEvents="none" />
            </View>
            <Text style={{ color: colors.textSecondary, marginBottom: spacing[2], fontSize: typography.sm, fontWeight: 'bold' }}>Text Color</Text>
            <TextInput
              accessibilityLabel="Card text color hex code"
              style={[styles.tagInput, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border, marginBottom: spacing[3] }]}
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
              <View style={{ position: 'absolute', left: Math.max(0, Math.min(spectrumWidth - 20, (hexToHsl(textColor).h / 360) * spectrumWidth - 10)), top: -2, width: 20, height: 34, borderRadius: 10, backgroundColor: '#fff', borderWidth: 2, borderColor: '#000' }} pointerEvents="none" />
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Finish choosing card colors" onPress={() => setShowColorPicker(false)} style={{ padding: spacing[4], backgroundColor: colors.primary, borderRadius: 8, alignItems: 'center' }}>
              <Text style={{ color: colors.buttonText, fontWeight: 'bold' }}>Done</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Formatting Guide Modal */}
      <Modal visible={showFormatGuide} animationType="fade" transparent={true} onRequestClose={() => setShowFormatGuide(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: spacing[4] }}>
          <Pressable accessible={false} importantForAccessibility="no" style={StyleSheet.absoluteFill} onPress={() => setShowFormatGuide(false)} />
          <View accessibilityViewIsModal style={{ width: '100%', backgroundColor: colors.card, borderRadius: 12, padding: spacing[4] }}>
            <Text accessibilityRole="header" style={{ fontSize: typography.lg, fontWeight: 'bold', color: colors.text, marginBottom: spacing[4] }}>Formatting Guide</Text>
            <Text style={{ color: colors.text, marginBottom: spacing[2] }}><Text style={{fontWeight: 'bold'}}>Bold:</Text> **text**</Text>
            <Text style={{ color: colors.text, marginBottom: spacing[2] }}><Text style={{fontWeight: 'bold'}}>Italic:</Text> *text*</Text>
            <Text style={{ color: colors.text, marginBottom: spacing[2] }}><Text style={{fontWeight: 'bold'}}>Underline:</Text> [text](format:underline)</Text>
            <Text style={{ color: colors.text, marginBottom: spacing[2] }}><Text style={{fontWeight: 'bold'}}>Headings:</Text> # H1, ## H2, ### H3</Text>
            <Text style={{ color: colors.text, marginBottom: spacing[2] }}><Text style={{fontWeight: 'bold'}}>Text Color:</Text> [text](color:red) (or #HEX)</Text>
            <Text style={{ color: colors.text, marginBottom: spacing[4] }}><Text style={{fontWeight: 'bold'}}>Highlight:</Text> [text](bg:yellow) (or #HEX)</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close formatting guide" onPress={() => setShowFormatGuide(false)} style={{ padding: spacing[4], backgroundColor: colors.primary, borderRadius: 8, alignItems: 'center' }}>
              <Text style={{ color: colors.buttonText, fontWeight: 'bold' }}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Format Color Picker Modal */}
      <Modal visible={showFormatColorPicker} animationType="fade" transparent={true} onRequestClose={() => setShowFormatColorPicker(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: spacing[4] }}>
          <Pressable accessible={false} importantForAccessibility="no" style={StyleSheet.absoluteFill} onPress={() => setShowFormatColorPicker(false)} />
          <View accessibilityViewIsModal style={{ width: '100%', backgroundColor: colors.card, borderRadius: 12, padding: spacing[4] }}>
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
              <View style={{ position: 'absolute', left: Math.max(0, Math.min(spectrumWidth - 20, (hexToHsl(formatColorTarget === 'bg' ? formatCustomBg : formatCustomColor).h / 360) * spectrumWidth - 10)), top: -2, width: 20, height: 34, borderRadius: 10, backgroundColor: '#fff', borderWidth: 2, borderColor: '#000' }} pointerEvents="none" />
            </View>
            <View style={{ flexDirection: 'row', gap: spacing[2], marginBottom: spacing[6], alignItems: 'center' }}>
              <TextInput accessibilityLabel={`Custom ${formatColorTarget === 'bg' ? 'highlight' : 'text'} color hex code`} style={{ flex: 1, height: 40, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: spacing[2], color: colors.text }} placeholder="#HEX" value={formatColorTarget === 'bg' ? formatCustomBg : formatCustomColor} onChangeText={formatColorTarget === 'bg' ? setFormatCustomBg : setFormatCustomColor} autoCapitalize="characters" maxLength={7} />
              <View style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: formatColorTarget === 'bg' ? formatCustomBg : formatCustomColor, borderWidth: 1, borderColor: colors.border }} />
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Insert custom color formatting" onPress={() => {
              const customColor = formatColorTarget === 'bg' ? formatCustomBg : formatCustomColor;
              if (!isSixDigitHexColor(customColor)) {
                Alert.alert('Invalid color', 'Use a six-digit hex value such as #8B5CF6.');
                return;
              }
              applyFormat('[', `](${formatColorTarget}:${customColor})`);
              setShowFormatColorPicker(false);
            }} style={{ padding: spacing[4], backgroundColor: colors.primary, borderRadius: 8, alignItems: 'center' }}>
              <Text style={{ color: colors.buttonText, fontWeight: 'bold' }}>Insert Formatting</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Cancel custom color formatting" onPress={() => setShowFormatColorPicker(false)} style={{ padding: spacing[4], backgroundColor: colors.border, borderRadius: 8, alignItems: 'center', marginTop: spacing[2] }}>
              <Text style={{ color: colors.text, fontWeight: 'bold' }}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: spacing[4],
  },
  tabBar: {
    flexDirection: 'row',
    marginBottom: spacing[4],
    borderBottomWidth: 1,
  },
  tabScroll: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tab: {
    paddingVertical: 10,
    paddingHorizontal: spacing[4],
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    minHeight: 44,
  },
  tabText: {
    fontSize: typography.base,
    fontWeight: '600',
  },
  addTab: {
    paddingVertical: 10,
    paddingHorizontal: spacing[4],
    minHeight: 44,
    justifyContent: 'center',
  },
  addTabText: {
    fontSize: typography.base,
    fontWeight: '600',
  },
  mediaBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing[4],
  },
  mediaButton: {
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    borderRadius: 8,
    minHeight: 44,
    justifyContent: 'center',
  },
  mediaButtonText: {
    fontSize: typography.sm,
  },
  recordingStatus: {
    marginTop: -spacing[2],
    marginBottom: spacing[4],
    fontWeight: '600',
  },
  editorContainer: {
    flex: 1,
    borderRadius: 12,
    padding: spacing[4],
    marginBottom: spacing[4],
  },
  textInput: {
    flex: 1,
    fontSize: typography.lg,
    textAlignVertical: 'top',
  },
  preview: {
    flex: 1,
  },
  saveButton: {
    padding: spacing[4],
    borderRadius: 12,
    alignItems: 'center',
    marginTop: spacing[4],
  },
  saveButtonText: {
    fontSize: typography.lg,
    fontWeight: 'bold',
  },
  formattingBar: {
    flexDirection: 'row',
    gap: spacing[2],
    marginBottom: spacing[2],
  },
  formatText: {
    fontWeight: 'bold',
    fontSize: typography.sm,
  },
  formatBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  formatBtnText: {
    fontWeight: 'bold',
    fontSize: typography.base,
  },
  optionsContainer: {
    padding: spacing[4],
    borderRadius: 12,
  },
  optionsLabel: {
    fontSize: typography.base,
    fontWeight: '600',
  },
  tagsSection: {
    marginBottom: spacing[4],
  },
  tagsList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
    marginTop: spacing[2],
    marginBottom: spacing[2],
  },
  tagBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: spacing[1],
    borderRadius: 12,
    gap: 6,
  },
  tagText: { fontSize: typography.sm, fontWeight: 'bold' },
  tagRemove: { fontSize: typography.base, fontWeight: 'bold' },
  tagInput: {
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  toggleTrack: {
    width: 50,
    height: 30,
    borderRadius: 15,
    padding: 2,
    justifyContent: 'center',
  },
  toggleThumb: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#FFF',
  },
});
