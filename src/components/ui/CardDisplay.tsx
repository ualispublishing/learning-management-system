/**
 * @fileoverview src/components/ui/CardDisplay.tsx.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import React, { useCallback, useState, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, ScrollView, Platform, Linking, ActivityIndicator } from 'react-native';
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import Markdown from 'react-native-markdown-display';
import * as Speech from 'expo-speech';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  type AudioRecorder,
} from 'expo-audio';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useEvent } from 'expo';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image as ExpoImage } from 'expo-image';
import * as FileSystem from 'expo-file-system/legacy';
import { useThemeColors } from '../../lib/useThemeColors';
import { typography, spacing } from '../../lib/theme';
import { useSettingsStore } from '../../lib/store/useSettingsStore';
import { createEntityId } from '../../lib/id';
import { userAlert as Alert } from '../../lib/userAlert';
import { resolveCardMediaUri, type ResolvedCardMediaSource } from '../../lib/cardMedia';
import { canonicalSafeHttpsUrl } from '../../lib/safeUrl';
import { accessibleTextColor, hasAccessibleTextContrast, isSixDigitHexColor } from '../../lib/color';
import { DIAGNOSTIC_CONTEXTS, logDiagnosticError, logDiagnosticWarning } from '../../lib/diagnosticLog';
import { performAudioPlaybackAction } from '../../lib/audio/playbackAction';

export interface CardData {
  id: string;
  front: string;
  back: string;
  depthLayers?: string[];
  layerNotes?: Record<string, { text?: string; voiceUri?: string }>;
  retrievability?: number;
  color?: string;
  textColor?: string;
  userNotes?: string;
  voiceNoteUri?: string;
}

interface CardDisplayProps {
  card: CardData;
  isRevealed: boolean;
  onReveal: () => void;
  onUpdateNotes: (notes: string, voiceNoteUri?: string, targetLayer?: number) => void | Promise<void>;
  submittedAnswer?: string;
  cardColor?: string; // Hex color for the deck
  depthIndex?: number;
  onDepthIndexChange?: (index: number) => void;
  onComplete?: () => void;
  showRevealControl?: boolean;
}


const injectStyle = (children: any, styleToInject: any): any => {
  return React.Children.map(children, child => {
    if (!React.isValidElement(child)) return child;
    const childProps = child.props as any;
    const childChildren = childProps?.children;
    return React.cloneElement(child as React.ReactElement<any>, {
      style: [childProps.style, styleToInject]
    }, childChildren ? injectStyle(childChildren, styleToInject) : undefined);
  });
};

const MediaUnavailable = ({ reason }: { reason: string }) => (
  <View style={mediaStyles.message} accessible accessibilityLabel={`Media unavailable. ${reason}`}>
    <Ionicons name="warning-outline" size={22} color="#B45309" />
    <Text style={mediaStyles.messageText}>Media unavailable</Text>
    <Text style={mediaStyles.detailText}>{reason}</Text>
  </View>
);

const RemoteMediaPrompt = ({ host, kind, onLoad }: { host: string; kind: 'image' | 'video'; onLoad: () => void }) => (
  <View style={mediaStyles.message}>
    <Ionicons name="shield-checkmark-outline" size={24} color="#1D4ED8" />
    <Text style={mediaStyles.messageText}>Remote {kind} blocked</Text>
    <Text style={mediaStyles.detailText}>Loading contacts {host} and may share network information.</Text>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Load remote ${kind} from ${host}`}
      accessibilityHint={`Contacts ${host} to download this media`}
      onPress={(event) => {
        event.stopPropagation();
        onLoad();
      }}
      style={mediaStyles.loadButton}
    >
      <Text style={mediaStyles.loadButtonText}>Load {kind}</Text>
    </Pressable>
  </View>
);

// Keep approval and playback state inside a canonical-destination lifetime.
// An effect reset is too late: a video hook can create a player during render.
const mediaSourceKey = (source: ResolvedCardMediaSource) => source.kind === 'invalid' ? 'invalid' : source.uri;

type CardImageProps = Pick<React.ComponentProps<typeof ExpoImage>, 'contentFit' | 'transition' | 'accessibilityLabel'> & {
  uri: unknown;
  style?: React.ComponentProps<typeof View>['style'];
};

const CustomImage = ({ uri, ...props }: CardImageProps) => {
  const source = resolveCardMediaUri(uri, FileSystem.documentDirectory);
  return <SourceImage key={mediaSourceKey(source)} source={source} {...props} />;
};

const SourceImage = ({ source, style, contentFit, transition, accessibilityLabel = 'Card image' }: Omit<CardImageProps, 'uri'> & { source: ResolvedCardMediaSource }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [remoteApproved, setRemoteApproved] = useState(false);

  if (source.kind === 'invalid') {
    return <View style={style}><MediaUnavailable reason={source.reason} /></View>;
  }
  if (source.kind === 'remote' && !remoteApproved) {
    return <View style={style}><RemoteMediaPrompt host={source.host} kind="image" onLoad={() => setRemoteApproved(true)} /></View>;
  }

  return (
    <View style={[style, { overflow: 'hidden' }]}> 
      <ExpoImage 
        source={{ uri: source.uri }} 
        contentFit={contentFit} 
        style={StyleSheet.absoluteFill} 
        transition={transition}
        accessible
        accessibilityLabel={accessibilityLabel}
        onLoadStart={() => setIsLoading(true)}
        onLoadEnd={() => setIsLoading(false)}
      />
      {isLoading && (
        <View style={[StyleSheet.absoluteFill, { justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.05)' }]} pointerEvents="none">
          <ActivityIndicator size="small" color="#999" />
        </View>
      )}
    </View>
  );
};

const AudioPlayer = ({ uri }: { uri: string }) => {
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const [loadedUri, setLoadedUri] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const source = resolveCardMediaUri(uri, FileSystem.documentDirectory);
  const playbackUri = source.kind === 'invalid' ? '' : source.uri;
  const isPlaying = status.playing;
  const effectivePlaybackError = playbackError || (status.error ? 'Audio could not be played.' : null);

  const togglePlayback = async () => {
    try {
      setPlaybackError(null);
      const nextLoadedUri = await performAudioPlaybackAction({
        player,
        playbackUri,
        loadedUri,
        isPlaying,
        didJustFinish: status.didJustFinish,
      });
      setLoadedUri(nextLoadedUri);
    } catch (error) {
      logDiagnosticError(DIAGNOSTIC_CONTEXTS.cardAudioPlayback, error);
      setPlaybackError('Audio could not be played.');
    }
  };

  if (source.kind === 'invalid') return <MediaUnavailable reason={source.reason} />;

  const audioLabel = source.kind === 'remote'
    ? `${isPlaying ? 'Pause' : 'Play'} remote card audio from ${source.host}`
    : `${isPlaying ? 'Pause' : 'Play'} card audio`;

  return (
    <View>
      <Pressable accessibilityRole="button" accessibilityLabel={audioLabel} accessibilityHint={source.kind === 'remote' ? `Playing contacts ${source.host} and may share network information` : undefined} onPress={togglePlayback} style={{ backgroundColor: 'rgba(0,0,0,0.1)', padding: 10, borderRadius: 8, marginVertical: 8, flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ fontSize: 16 }}>{isPlaying ? '⏸️ Pause Audio' : '▶️ Play Audio'}</Text>
      </Pressable>
      {source.kind === 'remote' && loadedUri !== playbackUri && <Text style={mediaStyles.inlinePrivacyText}>Loads from {source.host} only when played.</Text>}
      {effectivePlaybackError && <Text accessibilityRole="alert" style={{ color: '#B91C1C' }}>{effectivePlaybackError}</Text>}
    </View>
  );
};

const VideoPlayer = ({ uri }: { uri: string }) => {
  const source = resolveCardMediaUri(uri, FileSystem.documentDirectory);
  return <SourceVideoPlayer key={mediaSourceKey(source)} source={source} />;
};

const SourceVideoPlayer = ({ source }: { source: ResolvedCardMediaSource }) => {
  const [hasStarted, setHasStarted] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [remoteApproved, setRemoteApproved] = useState(false);
  const playbackUri = source.kind === 'invalid' ? '' : source.uri;
  const player = useVideoPlayer(
    playbackUri && (source.kind !== 'remote' || remoteApproved) ? { uri: playbackUri } : null,
  );
  const statusEvent = useEvent(player, 'statusChange', { status: player.status });
  const playingEvent = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const isPlaying = playingEvent.isPlaying;
  const isLoaded = statusEvent.status === 'readyToPlay';
  const isBuffering = statusEvent.status === 'loading';
  const effectivePlaybackError = playbackError
    || (statusEvent.status === 'error' ? 'Video playback failed. Check the media source and try again.' : null);
  const didStart = hasStarted || isPlaying;

  const togglePlay = (e: any) => {
    if (e && e.stopPropagation) e.stopPropagation();
    try {
      setPlaybackError(null);
      if (isPlaying) {
        player.pause();
      } else {
        player.play();
        setHasStarted(true);
      }
    } catch (err) {
      logDiagnosticWarning(DIAGNOSTIC_CONTEXTS.cardVideoPlayback, err);
      setPlaybackError('Video playback failed. Check the media source and try again.');
    }
  };

  if (source.kind === 'invalid') return <MediaUnavailable reason={source.reason} />;
  if (source.kind === 'remote' && !remoteApproved) {
    return <View style={{ width: '100%', height: 200, marginVertical: 8 }}><RemoteMediaPrompt host={source.host} kind="video" onLoad={() => setRemoteApproved(true)} /></View>;
  }

  return (
    <Pressable 
      style={{ width: '100%', alignItems: 'center', height: 200, marginVertical: 8 }}
      onPress={(e) => e.stopPropagation()}
      accessible={false}
    >
      <VideoView
        player={player}
        nativeControls={didStart}
        contentFit="contain"
        fullscreenOptions={{ enable: true }}
        playsInline
        style={{ width: '100%', maxWidth: '100%', height: '100%', borderRadius: 8, backgroundColor: '#000', alignSelf: 'center' }}
      />
      {effectivePlaybackError && (
        <View style={[StyleSheet.absoluteFill, { justifyContent: 'center', alignItems: 'center', padding: spacing[3], backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 8 }]}> 
          <Text accessibilityRole="alert" style={{ color: '#fff', textAlign: 'center' }}>{effectivePlaybackError}</Text>
        </View>
      )}
      {!effectivePlaybackError && (!isLoaded || isBuffering) && (
        <View style={[StyleSheet.absoluteFill, { justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 8 }]} pointerEvents="none">
          <ActivityIndicator size="large" color="#fff" />
        </View>
      )}
      {!effectivePlaybackError && !didStart && isLoaded && !isBuffering && (
        <Pressable 
          onPress={togglePlay} 
          style={[StyleSheet.absoluteFill, { justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 8 }]}
          accessibilityRole="button"
          accessibilityLabel="Play card video"
        >
          <Ionicons name="play-circle" size={64} color="white" />
        </Pressable>
      )}
    </Pressable>
  );
};

const FullscreenVideoPlayer = ({ uri }: { uri: string }) => {
  const source = resolveCardMediaUri(uri, FileSystem.documentDirectory);
  return <SourceFullscreenVideoPlayer key={mediaSourceKey(source)} source={source} />;
};

const SourceFullscreenVideoPlayer = ({ source }: { source: ResolvedCardMediaSource }) => {
  const [hasStarted, setHasStarted] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [remoteApproved, setRemoteApproved] = useState(false);
  const playbackUri = source.kind === 'invalid' ? '' : source.uri;
  const player = useVideoPlayer(
    playbackUri && (source.kind !== 'remote' || remoteApproved) ? { uri: playbackUri } : null,
  );
  const statusEvent = useEvent(player, 'statusChange', { status: player.status });
  const playingEvent = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const isPlaying = playingEvent.isPlaying;
  const isLoaded = statusEvent.status === 'readyToPlay';
  const isBuffering = statusEvent.status === 'loading';
  const effectivePlaybackError = playbackError
    || (statusEvent.status === 'error' ? 'Video playback failed. Check the media source and try again.' : null);
  const didStart = hasStarted || isPlaying;

  const togglePlay = (e: any) => {
    if (e && e.stopPropagation) e.stopPropagation();
    try {
      setPlaybackError(null);
      if (isPlaying) {
        player.pause();
      } else {
        player.play();
        setHasStarted(true);
      }
    } catch (err) {
      logDiagnosticWarning(DIAGNOSTIC_CONTEXTS.fullscreenVideoPlayback, err);
      setPlaybackError('Video playback failed. Check the media source and try again.');
    }
  };

  if (source.kind === 'invalid') return <MediaUnavailable reason={source.reason} />;
  if (source.kind === 'remote' && !remoteApproved) {
    return <RemoteMediaPrompt host={source.host} kind="video" onLoad={() => setRemoteApproved(true)} />;
  }

  return (
    <View style={StyleSheet.absoluteFill}>
      <VideoView
        player={player}
        nativeControls={didStart}
        contentFit="cover"
        fullscreenOptions={{ enable: true }}
        playsInline
        style={[StyleSheet.absoluteFill, { borderRadius: 16 }]}
      />
      {effectivePlaybackError && (
        <View style={[StyleSheet.absoluteFill, { justifyContent: 'center', alignItems: 'center', padding: spacing[4], backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 16 }]}> 
          <Text accessibilityRole="alert" style={{ color: '#fff', textAlign: 'center' }}>{effectivePlaybackError}</Text>
        </View>
      )}
      {!effectivePlaybackError && (!isLoaded || isBuffering) && (
        <View style={[StyleSheet.absoluteFill, { justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 16 }]} pointerEvents="none">
          <ActivityIndicator size="large" color="#fff" />
        </View>
      )}
      {!effectivePlaybackError && !didStart && isLoaded && !isBuffering && (
        <Pressable 
          onPress={togglePlay} 
          style={[StyleSheet.absoluteFill, { justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 16 }]}
          accessibilityRole="button"
          accessibilityLabel="Play fullscreen card video"
        >
          <Ionicons name="play-circle" size={80} color="white" />
        </Pressable>
      )}
    </View>
  );
};

export function CardDisplay({ card, isRevealed, onReveal, onUpdateNotes, submittedAnswer, cardColor = '#E8F5E9', depthIndex: externalDepthIndex, onDepthIndexChange, showRevealControl = false }: CardDisplayProps) {
  const colors = useThemeColors();
  const { reducedMotion, continuousCardView } = useSettingsStore();
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const voiceNotePlayer = useAudioPlayer(null);
  const voiceNoteStatus = useAudioPlayerStatus(voiceNotePlayer);
  const flipAnim = useSharedValue(0);
  const [internalDepthIndex, setInternalDepthIndex] = useState(-1);
  const depthIndex = externalDepthIndex !== undefined ? externalDepthIndex : internalDepthIndex;
  
  const actualCardColor = cardColor && cardColor !== 'transparent' ? cardColor : colors.card;
  const textColor = card.textColor && isSixDigitHexColor(card.textColor) && hasAccessibleTextContrast(card.textColor, actualCardColor)
    ? card.textColor
    : accessibleTextColor(actualCardColor) || colors.text;
  const textSecondaryColor = textColor;

  const customMarkdownRules = {
    link: (node: any, children: any, parent: any, styles: any) => {
      if (node.attributes && node.attributes.href) {
        if (node.attributes.href.startsWith('#color:')) {
          const color = decodeURIComponent(node.attributes.href.replace('#color:', ''));
          return <Text key={node.key}>{injectStyle(children, { color })}</Text>;
        }
        if (node.attributes.href.startsWith('#bg:')) {
          const bg = decodeURIComponent(node.attributes.href.replace('#bg:', ''));
          return <Text key={node.key} style={{ backgroundColor: bg, paddingHorizontal: 4, borderRadius: 4 }}>{injectStyle(children, { color: '#000' })}</Text>;
        }
        if (node.attributes.href === 'format:underline') {
          return <Text key={node.key} style={{ textDecorationLine: 'underline' }}>{children}</Text>;
        }
      }
      const safeUrl = canonicalSafeHttpsUrl(node.attributes?.href);
      return (
        <Text
          key={node.key}
          style={safeUrl ? styles.link : undefined}
          accessibilityRole={safeUrl ? "link" : undefined}
          accessibilityHint={safeUrl ? "Opens in your browser" : "This link was blocked because it is not a safe HTTPS address"}
          onPress={safeUrl ? () => {
            void Linking.openURL(safeUrl).catch(() => setAudioError('The link could not be opened.'));
          } : undefined}
        >
          {children}
        </Text>
      );
    },
    image: (node: any) => (
      <CustomImage
        key={node.key}
        uri={node.attributes?.src}
        accessibilityLabel={node.attributes?.alt || 'Card image'}
        contentFit="contain"
        style={{ width: '100%', maxWidth: '100%', height: 200, marginVertical: 8, borderRadius: 8 }}
        transition={200}
      />
    ),
  };

  const updateDepthIndex = useCallback((val: number | ((prev: number) => number)) => {
    setInternalDepthIndex(prev => {
      const current = externalDepthIndex !== undefined ? externalDepthIndex : prev;
      const newIdx = typeof val === 'function' ? val(current) : val;
      if (onDepthIndexChange && newIdx !== current) {
         setTimeout(() => onDepthIndexChange(newIdx), 0);
      }
      return newIdx;
    });
  }, [externalDepthIndex, onDepthIndexChange]);
  const [isEditingNote, setIsEditingNote] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [voiceNoteUri, setVoiceNoteUri] = useState<string | null>(null);
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [noteSaveError, setNoteSaveError] = useState<string | null>(null);
  
  /* eslint-disable react-hooks/set-state-in-effect -- These effects synchronize editable hardware/UI state to the selected card layer. */
  useEffect(() => {
    const layerKey = depthIndex.toString();
    const activeNote = card.layerNotes?.[layerKey];
    setNoteText(activeNote?.text || (depthIndex === -1 ? card.userNotes || '' : ''));
    setVoiceNoteUri(activeNote?.voiceUri || (depthIndex === -1 ? card.voiceNoteUri || null : null));
    setIsEditingNote(false);
  }, [depthIndex, card.layerNotes, card.userNotes, card.voiceNoteUri]);

  const [isSpeaking, setIsSpeaking] = useState(false);

  // Audio Recording State
  const [recording, setRecording] = useState<AudioRecorder | null>(null);
  const recordingRef = React.useRef<AudioRecorder | null>(null);
  const recordingOperationRef = React.useRef(false);
  const [recordingBusy, setRecordingBusy] = useState(false);
  const isMounted = React.useRef(true);
  const [audioError, setAudioError] = useState<string | null>(null);
  const effectiveAudioError = audioError || (voiceNoteStatus.error
    ? 'The voice note could not be played. It may have been removed from this device.'
    : null);

  useEffect(() => {
    if (reducedMotion) {
      flipAnim.value = isRevealed ? 1 : 0;
    } else {
      flipAnim.value = withSpring(isRevealed ? 1 : 0, {
        damping: 15, stiffness: 120, mass: 0.8,
      });
    }
    if (!isRevealed) {
      updateDepthIndex(-1);
      setIsEditingNote(false);
      Speech.stop();
      setIsSpeaking(false);
    }
  }, [isRevealed, card.id, flipAnim, reducedMotion, updateDepthIndex]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Unmount cleanup for hardware resources
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      Speech.stop();
      if (recordingRef.current) {
        recordingRef.current.stop().catch(() => {});
        recordingRef.current = null;
      }
      void setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    };
  }, []);

  const frontStyle = useAnimatedStyle(() => {
    const rotateX = interpolate(flipAnim.value, [0, 1], [0, 180]);
    return {
      transform: [{ rotateX: `${rotateX}deg` }],
      opacity: flipAnim.value < 0.5 ? 1 : 0,
      zIndex: flipAnim.value < 0.5 ? 1 : 0,
    };
  });

  const backStyle = useAnimatedStyle(() => {
    const rotateX = interpolate(flipAnim.value, [0, 1], [180, 360]);
    return {
      transform: [{ rotateX: `${rotateX}deg` }],
      opacity: flipAnim.value >= 0.5 ? 1 : 0,
      zIndex: flipAnim.value >= 0.5 ? 1 : 0,
    };
  });

  const showDepthLayers = card.depthLayers && card.depthLayers.length > 0 && (card.retrievability ?? 0) > 0.8;
  const totalPages = showDepthLayers ? 1 + (card.depthLayers?.length || 0) : 1;

  const handleNextPage = () => { if (depthIndex < totalPages - 2) updateDepthIndex(d => d + 1); };
  const handlePrevPage = () => { if (depthIndex > -1) updateDepthIndex(d => d - 1); };

  const handleSaveNote = async () => {
    if (isSavingNote) return;
    setIsSavingNote(true);
    setNoteSaveError(null);
    try {
      await onUpdateNotes(noteText, voiceNoteUri || undefined, depthIndex);
      if (isMounted.current) setIsEditingNote(false);
    } catch (error) {
      logDiagnosticError(DIAGNOSTIC_CONTEXTS.studyNoteSave, error);
      if (isMounted.current) {
        setNoteSaveError(error instanceof Error ? error.message : 'The note could not be saved. Please retry.');
      }
    } finally {
      if (isMounted.current) setIsSavingNote(false);
    }
  };

  const handleSpeak = async (text: string) => {
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

    if (isSpeaking) {
      Speech.stop();
      setIsSpeaking(false);
    } else {
      setIsSpeaking(true);
      Speech.speak(cleanText, {
        onDone: () => setIsSpeaking(false),
        onStopped: () => setIsSpeaking(false),
        onError: () => setIsSpeaking(false),
      });
    }
  };

  const startRecording = async () => {
    if (recordingRef.current || recordingOperationRef.current) return;
    recordingOperationRef.current = true;
    setRecordingBusy(true);
    try {
      setAudioError(null);
      if (Platform.OS === 'web') {
        Alert.alert('Unavailable on web', 'Voice-note recording is available in the iOS and Android apps.');
        return;
      }
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setAudioError('Microphone permission is required to record a voice note.');
        return;
      }
      voiceNotePlayer.pause();
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      if (!isMounted.current) {
        await audioRecorder.stop();
        return;
      }
      recordingRef.current = audioRecorder;
      setRecording(audioRecorder);
    } catch (err) {
      logDiagnosticError(DIAGNOSTIC_CONTEXTS.recordingStart, err);
      void setAudioModeAsync({ allowsRecording: false }).catch(() => {});
      if (isMounted.current) setAudioError('Recording could not be started. Check microphone access and try again.');
    } finally {
      recordingOperationRef.current = false;
      if (isMounted.current) setRecordingBusy(false);
    }
  };

  const stopRecording = async () => {
    if (recordingOperationRef.current) return;
    const activeRecording = recordingRef.current;
    if (!activeRecording) return;
    recordingOperationRef.current = true;
    setRecordingBusy(true);
    recordingRef.current = null;
    setRecording(null);
    try {
      setAudioError(null);
      await activeRecording.stop();
      const uri = activeRecording.uri;
      if (!uri || !FileSystem.documentDirectory) throw new Error('No durable recording location is available.');
      const filename = `${createEntityId('voice-note')}.m4a`;
      await FileSystem.copyAsync({ from: uri, to: FileSystem.documentDirectory + filename });
      if (isMounted.current) setVoiceNoteUri(filename);
    } catch (error) {
      logDiagnosticError(DIAGNOSTIC_CONTEXTS.recordingSave, error);
      if (isMounted.current) setAudioError('The voice note could not be saved. Please record it again.');
    } finally {
      void setAudioModeAsync({ allowsRecording: false }).catch(() => {});
      recordingOperationRef.current = false;
      if (isMounted.current) setRecordingBusy(false);
    }
  };

  const playVoiceNote = async () => {
    if (!voiceNoteUri) return;
    try {
      setAudioError(null);
      const source = resolveCardMediaUri(voiceNoteUri, FileSystem.documentDirectory);
      if (source.kind === 'invalid') throw new Error(source.reason);
      voiceNotePlayer.pause();
      voiceNotePlayer.replace({ uri: source.uri });
      voiceNotePlayer.play();
    } catch (error) {
      logDiagnosticError(DIAGNOSTIC_CONTEXTS.voiceNotePlayback, error);
      if (isMounted.current) setAudioError('The voice note could not be played. It may have been removed from this device.');
    }
  };

  const clearVoiceNote = () => {
    setAudioError(null);
    setVoiceNoteUri(null);
  };

  const renderContent = (text: string, stylesObj: any, color: string) => {
    let t = (text || '').trim();
    // Pre-process legacy color syntax to valid markdown anchors so they aren't stripped
    t = t.replace(/\[([^\]]+)\]\(color:([^)]+)\)/g, '[$1](#color:$2)');
    t = t.replace(/\[([^\]]+)\]\(bg:([^)]+)\)/g, '[$1](#bg:$2)');
    t = t.replace(/\[([^\]]+)\]\(format:([^)]+)\)/g, '[$1](#format:$2)');

    // Support markdown image or new [IMAGE:...] syntax
    const markdownImageMatch = t.match(/^!\[([^\]]*)\]\((.*?)\)$/);
    const taggedImageMatch = t.match(/^\[IMAGE:(.*?)\]$/);
    if (markdownImageMatch || taggedImageMatch) {
      const uri = markdownImageMatch?.[2] || taggedImageMatch?.[1];
      const label = markdownImageMatch?.[1] || 'Card image';
      return { isFullScreen: true, component: <CustomImage uri={uri} accessibilityLabel={label} contentFit="cover" style={{ width: '100%', maxWidth: '100%', height: '100%', borderRadius: 16 }} transition={200} /> };
    }
    const vidMatch = t.match(/^\[VIDEO:(.*?)\]$/);
    if (vidMatch) return { isFullScreen: true, isInteractive: true, component: <FullscreenVideoPlayer uri={vidMatch[1]} /> };

    const regex = /(\[AUDIO:.*?\]|\[VIDEO:.*?\]|\[IMAGE:.*?\])/g;
    const parts = t.split(regex).filter(p => p.trim().length > 0);
    const component = parts.map((part, i) => {
      if (part.startsWith('[AUDIO:')) {
        const uri = part.substring(7, part.length - 1);
        return <AudioPlayer key={i} uri={uri} />;
      }
      if (part.startsWith('[VIDEO:')) {
        const uri = part.substring(7, part.length - 1);
        return <VideoPlayer key={i} uri={uri} />;
      }
      if (part.startsWith('[IMAGE:')) {
        const uri = part.substring(7, part.length - 1);
        return <CustomImage key={i} uri={uri} contentFit="contain" style={{ width: '100%', maxWidth: '100%', height: 200, marginVertical: 8, borderRadius: 8 }} transition={200} />;
      }
      return <Markdown key={i} rules={customMarkdownRules} style={{ ...stylesObj, body: { ...stylesObj.body, color: color } }}>{part}</Markdown>;
    });
    return { isFullScreen: false, component };
  };

  const currentVisibleText = !isRevealed ? card.front : 
    (depthIndex === -1 ? card.back : card.depthLayers?.[depthIndex] || '');

  const frontContentData = renderContent(card.front, markdownStyles, textColor);
  const backMainContentData = renderContent(card.back, markdownStyles, textColor);
  const depthContentData = renderContent(card.depthLayers?.[depthIndex] || '', markdownStyles, textColor);
  return (
    <View style={styles.container}>
      <View style={styles.cardWrapper}>
        {isRevealed && submittedAnswer ? (
          <View style={styles.answerBubbleOverlay}>
            <View style={[styles.answerBubble, { backgroundColor: colors.primary }]}>
              <Text style={[styles.answerBubbleTitle, { color: colors.buttonText }]}>Your Answer:</Text>
              <Text style={[styles.answerBubbleText, { color: colors.buttonText }]}>{submittedAnswer}</Text>
            </View>
          </View>
        ) : null}

        <View style={styles.speakerBtnContainer}>
          <Pressable 
            onPress={() => handleSpeak(currentVisibleText)} 
            style={[styles.speakerBtn, { backgroundColor: colors.background, borderColor: colors.border }]}
            accessibilityRole="button"
            accessibilityLabel={isSpeaking ? "Stop speaking" : "Speak text"}
            accessibilityState={{ selected: isSpeaking }}
          >
            <Text style={styles.speakerIcon}>{isSpeaking ? '⏹️' : '🔊'}</Text>
          </Pressable>
        </View>

        <View style={styles.cardContainer}>
          {/* Front */}
          <Animated.View 
            style={[styles.card, { backgroundColor: frontContentData.isFullScreen ? 'transparent' : actualCardColor, borderColor: frontContentData.isFullScreen ? 'transparent' : colors.border, padding: frontContentData.isFullScreen ? 0 : spacing[6] }, frontStyle]}
            {...(Platform.OS === 'web'
              ? ({ 'aria-hidden': isRevealed } as object)
              : { accessibilityElementsHidden: isRevealed, importantForAccessibility: isRevealed ? 'no-hide-descendants' as const : 'yes' as const })}
          >
            {frontContentData.component}
          </Animated.View>

          {/* Back */}
          <Animated.View 
            style={[styles.card, { backgroundColor: actualCardColor, borderColor: colors.border }, backStyle]}
            {...(Platform.OS === 'web'
              ? ({ 'aria-hidden': !isRevealed } as object)
              : { accessibilityElementsHidden: !isRevealed, importantForAccessibility: !isRevealed ? 'no-hide-descendants' as const : 'yes' as const })}
          >
            <View style={styles.backContent}>
              {depthIndex === -1 && !continuousCardView ? (
                <View style={styles.mainBackContent}>
                  {backMainContentData.component}
                </View>
              ) : !continuousCardView ? (
                <View style={styles.depthContent}>
                  <Text style={[styles.depthTitle, { color: textSecondaryColor }]}>And Also...</Text>
                  {depthContentData.component}
                </View>
              ) : (
                <ScrollView keyboardShouldPersistTaps="handled" style={{ width: '100%', flex: 1 }} contentContainerStyle={{ paddingBottom: 20 }} showsVerticalScrollIndicator={false}>
                  {backMainContentData.component}
                  {showDepthLayers && card.depthLayers && card.depthLayers.map((layer, idx) => (
                    <View key={idx} style={[styles.continuousNode, { borderLeftColor: textColor }]}>
                      <Text style={[styles.continuousNodeTitle, { color: textColor }]}>Depth Layer {idx + 1}</Text>
                      {renderContent(layer, markdownStylesLeft, textSecondaryColor).component}
                    </View>
                  ))}
                </ScrollView>
              )}

              {/* Note Section */}
              {isRevealed && (
                <View style={styles.noteSection}>
                  {isEditingNote ? (
                    <View style={[styles.noteEditor, { backgroundColor: textColor === '#000000' ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.1)' }]}> 
                      <TextInput
                        style={[styles.noteInput, { color: textColor }]}
                        value={noteText}
                        onChangeText={setNoteText}
                        maxLength={250_000}
                        multiline
                        placeholder="Add a note..."
                        placeholderTextColor={textSecondaryColor}
                        accessibilityLabel="Note text input"
                      />
                      <View style={styles.editorActions}>
                        {noteSaveError && (
                          <Text accessibilityRole="alert" style={{ color: colors.error, width: '100%', marginBottom: spacing[2] }}>
                            {noteSaveError}
                          </Text>
                        )}
                        {effectiveAudioError && (
                          <Text accessibilityRole="alert" style={{ color: colors.error, width: '100%', marginBottom: spacing[2] }}>
                            {effectiveAudioError}
                          </Text>
                        )}
                        {!voiceNoteUri && !recording && (
                          <Pressable 
                            onPress={startRecording} 
                            disabled={recordingBusy}
                            style={[styles.recordBtn, { backgroundColor: textColor, opacity: recordingBusy ? 0.55 : 1 }]}
                            accessibilityRole="button"
                            accessibilityLabel={recordingBusy ? 'Starting voice note recording' : 'Record voice note'}
                            accessibilityState={{ disabled: recordingBusy, busy: recordingBusy }}
                          >
                            <Text style={[styles.recordBtnText, { color: actualCardColor }]}>{recordingBusy ? 'Starting…' : '🎤 Record'}</Text>
                          </Pressable>
                        )}
                        {recording && (
                          <Pressable 
                            onPress={stopRecording} 
                            disabled={recordingBusy}
                            style={[styles.recordingBtn, { backgroundColor: colors.danger, opacity: recordingBusy ? 0.55 : 1 }]}
                            accessibilityRole="button"
                            accessibilityLabel={recordingBusy ? 'Saving voice note recording' : 'Stop recording voice note'}
                            accessibilityState={{ disabled: recordingBusy, busy: recordingBusy }}
                          >
                            <Text style={[styles.recordBtnText, { color: colors.onDanger }]}>⏹️ Stop</Text>
                          </Pressable>
                        )}
                        {voiceNoteUri && !recording && (
                          <View style={styles.voiceNotePlayer}>
                            <Pressable 
                              onPress={playVoiceNote} 
                              style={[styles.playBtn, { backgroundColor: colors.primary }]}
                              accessibilityRole="button"
                              accessibilityLabel="Play voice note"
                            >
                              <Text style={[styles.playBtnText, { color: colors.buttonText }]}>▶️ Play Voice Note</Text>
                            </Pressable>
                            <Pressable 
                              onPress={clearVoiceNote} 
                              style={[styles.clearBtn, { backgroundColor: colors.error }]}
                              accessibilityRole="button"
                              accessibilityLabel="Delete voice note"
                            >
                              <Text style={styles.clearBtnText}>❌</Text>
                            </Pressable>
                          </View>
                        )}
                        <Pressable 
                          style={[styles.saveBtn, { backgroundColor: textColor }]} 
                          onPress={handleSaveNote}
                          disabled={isSavingNote}
                          accessibilityRole="button"
                          accessibilityLabel="Save note"
                          accessibilityState={{ disabled: isSavingNote, busy: isSavingNote }}
                        >
                          <Text style={[styles.saveBtnText, { color: actualCardColor }]}>{isSavingNote ? 'Saving…' : 'Save'}</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : noteText || voiceNoteUri ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: noteText ? 'space-between' : 'center', width: '100%', padding: spacing[3], backgroundColor: textColor === '#000000' ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.1)', borderRadius: 8, borderWidth: 1, borderColor: textSecondaryColor }}>
                      {noteText ? (
                        <Pressable 
                          onPress={() => setIsEditingNote(true)} 
                          style={{ flex: 1, marginEnd: voiceNoteUri ? 12 : 0, minHeight: 44, justifyContent: 'center' }}
                          accessibilityRole="button"
                          accessibilityLabel="Edit note"
                        >
                          <Text style={{ color: textColor, fontSize: typography.sm }}>{noteText}</Text>
                        </Pressable>
                      ) : null}
                      
                      {voiceNoteUri ? (
                        <Pressable 
                          onPress={(e) => {
                             e.stopPropagation();
                             playVoiceNote();
                          }} 
                          style={{ backgroundColor: colors.primary, paddingHorizontal: spacing[3], paddingVertical: spacing[2], borderRadius: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 3, elevation: 2, minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' }}
                          accessibilityRole="button"
                          accessibilityLabel="Play note"
                        >
                          <Text style={{ color: colors.buttonText, fontSize: typography.xs, fontWeight: 'bold' }}>▶️ Play Note</Text>
                        </Pressable>
                      ) : null}

                      {!noteText && (
                        <Pressable 
                          onPress={() => setIsEditingNote(true)} 
                          style={{ position: 'absolute', end: 12, padding: 4, minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' }}
                          accessibilityRole="button"
                          accessibilityLabel="Edit note"
                        >
                          <Text style={{ fontSize: typography.xs, color: textSecondaryColor }}>✏️ Edit</Text>
                        </Pressable>
                      )}
                    </View>
                  ) : (
                    <Pressable 
                      style={[styles.addNoteBtn, { backgroundColor: 'transparent', borderColor: textSecondaryColor }]} 
                      onPress={() => setIsEditingNote(true)}
                      accessibilityRole="button"
                      accessibilityLabel="Add note or voice"
                    >
                      <Text style={[styles.addNoteText, { color: textSecondaryColor }]}>+ Add note or voice</Text>
                    </Pressable>
                  )}
                </View>
              )}

              {/* Pagination Controls */}
              {totalPages > 1 && !continuousCardView && (
                <View style={styles.pagination}>
                  <Pressable 
                    onPress={handlePrevPage} 
                    disabled={depthIndex === -1} 
                    style={styles.pageBtn}
                    accessibilityRole="button"
                    accessibilityLabel="Previous page"
                    accessibilityState={{ disabled: depthIndex === -1 }}
                  >
                    <Text style={[styles.pageBtnText, { color: textColor }, depthIndex === -1 && { color: textSecondaryColor }]}>{'<'}</Text>
                  </Pressable>
                  <Text style={[styles.pageText, { color: textSecondaryColor }]}>{depthIndex + 2} / {totalPages}</Text>
                  <Pressable 
                    onPress={handleNextPage} 
                    disabled={depthIndex === totalPages - 2} 
                    style={styles.pageBtn}
                    accessibilityRole="button"
                    accessibilityLabel="Next page"
                    accessibilityState={{ disabled: depthIndex === totalPages - 2 }}
                  >
                    <Text style={[styles.pageBtnText, { color: textColor }, depthIndex === totalPages - 2 && { color: textSecondaryColor }]}>{'>'}</Text>
                  </Pressable>
                </View>
              )}
            </View>
          </Animated.View>
          {showRevealControl && !isRevealed && (
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={onReveal}
              accessibilityRole="button"
              accessibilityLabel="Reveal answer"
              accessibilityHint="Shows the answer in this card preview"
            />
          )}
        </View>
      </View>
    </View>
  );
}

const markdownStyles = {
  body: {
    fontSize: typography['2xl'],
    textAlign: 'center',
    fontWeight: '600' as const,
  },
  strong: {
    fontWeight: '900' as const,
  },
  code_inline: {
    backgroundColor: '#FFE082',
    color: '#000',
    paddingHorizontal: 4,
    borderRadius: 4,
  },
  s: {
    color: '#EF4444',
    textDecorationLine: 'none' as const,
  }
};

const markdownStylesLeft = {
  body: {
    fontSize: typography.lg,
    lineHeight: 24,
    fontWeight: '600' as const,
  },
  strong: {
    fontWeight: '900' as const,
  },
};

const mediaStyles = StyleSheet.create({
  message: {
    flex: 1,
    width: '100%',
    minHeight: 120,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    padding: spacing[4],
    borderWidth: 1,
    borderColor: '#94A3B8',
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
  },
  messageText: {
    color: '#0F172A',
    fontSize: typography.base,
    fontWeight: '800',
    textAlign: 'center',
  },
  detailText: {
    color: '#334155',
    fontSize: typography.sm,
    textAlign: 'center',
  },
  loadButton: {
    minWidth: 120,
    minHeight: 44,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#1D4ED8',
  },
  loadButtonText: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  inlinePrivacyText: {
    color: '#475569',
    fontSize: typography.xs,
    marginBottom: spacing[2],
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingHorizontal: spacing[5],
  },
  cardWrapper: {
    width: '100%',
    position: 'relative',
    alignItems: 'center',
  },
  speakerBtnContainer: {
    position: 'absolute',
    top: 16,
    end: 16,
    zIndex: 60,
  },
  speakerBtn: {
    padding: spacing[2],
    borderRadius: 20,
    borderWidth: 1,
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  speakerIcon: {
    fontSize: typography.base,
  },
  answerBubbleOverlay: {
    position: 'absolute',
    bottom: '100%',
    marginBottom: spacing[3],
    zIndex: 50,
    width: '100%',
    alignItems: 'center',
  },
  answerBubble: {
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[3],
    borderRadius: 16,
  },
  answerBubbleTitle: {
    fontSize: typography.xs,
    fontWeight: '800',
    marginBottom: spacing[1],
  },
  answerBubbleText: {
    fontSize: typography.base,
    fontWeight: '600',
  },
  cardContainer: {
    width: '100%',
    height: 400,
    position: 'relative',
  },
  card: {
    position: 'absolute',
    top: 0, start: 0, end: 0, bottom: 0,
    borderRadius: 16,
    padding: spacing[6],
    justifyContent: 'center',
    alignItems: 'center',
    backfaceVisibility: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 10,
    borderWidth: 2,
    overflow: 'hidden', // Prevents images from overflowing visually
  },
  backContent: {
    flex: 1,
    width: '100%',
    justifyContent: 'space-between',
  },
  mainBackContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  depthContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  depthTitle: {
    fontSize: typography.sm,
    marginBottom: 10,
    fontWeight: '700',
  },
  noteSection: {
    marginTop: spacing[5],
    width: '100%',
  },
  addNoteBtn: {
    padding: spacing[3],
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 44,
    minHeight: 44,
  },
  addNoteText: {
    fontSize: typography.sm,
    fontWeight: '600',
  },
  noteEditor: {
    borderRadius: 8,
    padding: spacing[2],
  },
  noteInput: {
    padding: spacing[2],
    minHeight: 44,
    fontWeight: '600',
  },
  editorActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing[2],
  },
  recordBtn: {
    padding: 6,
    borderRadius: 6,
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  recordingBtn: {
    padding: 6,
    borderRadius: 6,
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  recordBtnText: {
    fontWeight: '600',
    fontSize: typography.xs,
  },
  voiceNotePlayer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  playBtn: {
    padding: 6,
    borderRadius: 6,
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playBtnText: {
    fontWeight: '600',
    fontSize: typography.xs,
  },
  clearBtn: {
    padding: 6,
    borderRadius: 6,
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  clearBtnText: {
    fontSize: typography.xs,
  },
  saveBtn: {
    paddingHorizontal: spacing[3],
    paddingVertical: 6,
    borderRadius: 6,
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveBtnText: {
    fontWeight: 'bold',
  },
  pagination: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing[5],
    gap: spacing[4],
  },
  pageBtn: { 
    padding: spacing[2],
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pageBtnText: {
    fontSize: typography.lg,
    fontWeight: 'bold',
  },
  disabledText: { },
  pageText: {
    fontSize: typography.sm,
    fontWeight: '600',
  },
  continuousNode: {
    padding: spacing[4],
    borderRadius: 12,
    marginTop: spacing[3],
    borderStartWidth: 4,
  },
  continuousNodeTitle: {
    fontSize: typography.xs,
    fontWeight: '800',
    marginBottom: 6,
  },
});
