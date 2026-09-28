/**
 * @fileoverview src/components/editor/DeckEditor.tsx.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Switch, Pressable, Image, Platform } from 'react-native';
import { Deck } from '../../types';
import { DeckStore } from '../../lib/db/store';
import { userAlert as Alert } from '../../lib/userAlert';
import { useRouter, useNavigation } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { useThemeColors } from '../../lib/useThemeColors';
import { typography, spacing } from '../../lib/theme';
import { BackButton } from '../ui/BackButton';
import { NotificationScheduler } from '../../lib/notifications/scheduler';
import { LinearGradient } from 'expo-linear-gradient';
import { getError } from '../../lib/errorCodes';
import { createEntityId } from '../../lib/id';
import { buildDailyReminderSlots } from '../../lib/notifications/schedule';
import { getFlashcardPrincipalId } from '../../lib/db/principal';
import { isSixDigitHexColor } from '../../lib/color';
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

interface DeckEditorProps {
  initialDeck?: Deck;
  onSave?: (deck: Deck) => void;
}

export default function DeckEditor({ initialDeck, onSave }: DeckEditorProps) {
  const router = useRouter();
  const leaveEditor = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };
  const navigation = useNavigation();
  const colors = useThemeColors();
  const [name, setName] = useState(initialDeck?.name || '');
  const [description, setDescription] = useState(initialDeck?.description || '');
  
  const isSaved = React.useRef(false);
  const [isDeleting, setIsDeleting] = useState(false);
  
  // Notification Schedule state
  const initialSchedule = initialDeck?.settings?.notifSchedule;
  const [notifActive, setNotifActive] = useState(initialSchedule?.active ?? false);
  const [frequency, setFrequency] = useState(initialSchedule?.frequency?.toString() ?? '60'); // minutes
  const [startTime, setStartTime] = useState(initialSchedule?.startTime ?? '09:00');
  const [endTime, setEndTime] = useState(initialSchedule?.endTime ?? '21:00');

  const [bannerType, setBannerType] = useState(initialDeck?.settings?.bannerType || '');
  const [cardColor, setCardColor] = useState(initialDeck?.settings?.cardColor || '#E8F5E9');
  const [cardTextColor, setCardTextColor] = useState(initialDeck?.settings?.cardTextColor || '#000000');
  
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [spectrumWidth, setSpectrumWidth] = useState(300);
  const [isSaving, setIsSaving] = useState(false);
  const saveInFlight = React.useRef(false);

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (isSaved.current || isDeleting) return;
      const hasChanges = name.trim() !== (initialDeck?.name || '')
        || description.trim() !== (initialDeck?.description || '')
        || notifActive !== (initialSchedule?.active ?? false)
        || frequency !== (initialSchedule?.frequency?.toString() ?? '60')
        || startTime !== (initialSchedule?.startTime ?? '09:00')
        || endTime !== (initialSchedule?.endTime ?? '21:00')
        || bannerType !== (initialDeck?.settings?.bannerType || '')
        || cardColor !== (initialDeck?.settings?.cardColor || '#E8F5E9')
        || cardTextColor !== (initialDeck?.settings?.cardTextColor || '#000000');
      if (!hasChanges) return;

      e.preventDefault();
      Alert.alert(
        'Discard changes?',
        'You have unsaved changes. Are you sure you want to leave?',
        [
          { text: 'Keep editing', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: () => navigation.dispatch(e.data.action) },
        ]
      );
    });
    return unsubscribe;
  }, [bannerType, cardColor, cardTextColor, description, endTime, frequency, initialDeck, initialSchedule, isDeleting, name, navigation, notifActive, startTime]);

  const presetColors = ['#E8F5E9', '#E3F2FD', '#F3E5F5', '#FFF3E0', '#FFEBEE'];

  const pickImage = async () => {
    try {
      if (Platform.OS === 'web') {
        Alert.alert('Unavailable on web', 'Persistent custom deck banners are available in the iOS and Android apps.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [16, 9],
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        if (!FileSystem.documentDirectory) throw new Error('No writable document directory is available.');
        const sourceUri = result.assets[0].uri;
        const extension = /\.(png|jpe?g|webp)$/i.exec(result.assets[0].fileName || sourceUri)?.[1]?.toLowerCase() || 'jpg';
        const destination = `${FileSystem.documentDirectory}${createEntityId('banner')}.${extension}`;
        await FileSystem.copyAsync({ from: sourceUri, to: destination });
        setBannerType(destination);
      }
    } catch (error) {
      logDiagnosticError(DIAGNOSTIC_CONTEXTS.deckImageStore, error);
      Alert.alert('Image unavailable', 'The selected image could not be copied into durable app storage. Please choose it again.');
    }
  };

  const handleBgColorDrag = (e: any) => {
    let x = e.nativeEvent.locationX;
    if (x < 0) x = 0;
    if (x > spectrumWidth) x = spectrumWidth;
    const hue = (x / spectrumWidth) * 360;
    setCardColor(hslToHex(hue, 100, 85));
  };

  const handleTextColorDrag = (e: any) => {
    let x = e.nativeEvent.locationX;
    if (x < 0) x = 0;
    if (x > spectrumWidth) x = spectrumWidth;
    const hue = (x / spectrumWidth) * 360;
    setCardTextColor(hslToHex(hue, 100, 30));
  };

  const handleSave = async () => {
    if (saveInFlight.current) return;
    if (!name.trim()) {
      Alert.alert('Validation Error', getError('V3001'));
      return;
    }
    if (name.length > 200 || description.length > 10_000) {
      Alert.alert('Validation Error', 'Deck names must be at most 200 characters and descriptions at most 10,000 characters.');
      return;
    }
    if (!isSixDigitHexColor(cardColor) || !isSixDigitHexColor(cardTextColor)) {
      Alert.alert('Validation Error', 'Card colors must use six-digit hex values such as #E8F5E9.');
      return;
    }

    const deckId = initialDeck?.id || createEntityId('deck');
    const parsedFrequency = Number(frequency);
    if (notifActive && (!Number.isInteger(parsedFrequency) || parsedFrequency < 1 || parsedFrequency > 10_080)) {
      Alert.alert('Validation Error', 'Reminder frequency must be a whole number from 1 to 10,080 minutes.');
      return;
    }
    if (notifActive) {
      try {
        buildDailyReminderSlots(parsedFrequency, startTime, endTime);
      } catch (error) {
        Alert.alert('Validation Error', error instanceof Error ? error.message : 'The reminder schedule is invalid.');
        return;
      }
    }

    const settings = { ...initialDeck?.settings };
    if (bannerType.trim()) settings.bannerType = bannerType.trim();
    else delete settings.bannerType;
    Object.assign(settings, {
      cardColor,
      cardTextColor,
      notifSchedule: {
        active: notifActive,
        frequency: notifActive ? parsedFrequency : 60,
        startTime,
        endTime
      }
    });

    const deckToSave: Deck = {
      id: deckId,
      user_id: initialDeck?.user_id || getFlashcardPrincipalId(),
      parent_id: initialDeck?.parent_id,
      name: name.trim(),
      description: description.trim(),
      settings,
      position: initialDeck?.position || 0,
      completed_once: initialDeck?.completed_once || false,
      created_at: initialDeck?.created_at || Date.now(),
    };

    saveInFlight.current = true;
    setIsSaving(true);
    try {
      if (initialDeck) {
        await DeckStore.update(deckToSave);
      } else {
        await DeckStore.insert(deckToSave);
      }

      isSaved.current = true;
      let notificationWarning: string | null = null;
      if (Platform.OS !== 'web') {
        try {
          await NotificationScheduler.configureDeckReminder(deckId, name.trim(), notifActive, notifActive ? parsedFrequency : 60, startTime, endTime);
          if (notifActive) await NotificationScheduler.scheduleDueCards();
        } catch (notificationError) {
          logDiagnosticError(DIAGNOSTIC_CONTEXTS.deckNotificationConfigure, notificationError);
          notificationWarning = notificationError instanceof Error
            ? notificationError.message
            : 'Notifications could not be configured.';
        }
      }

      const finishSave = () => {
        if (onSave) onSave(deckToSave);
        else leaveEditor();
      };
      if (notificationWarning) {
        Alert.alert('Deck saved with a warning', `The deck was saved, but reminders are not active: ${notificationWarning}`, [
          { text: 'OK', onPress: finishSave },
        ]);
      } else if (onSave) {
        onSave(deckToSave);
      } else {
        Alert.alert('Success', 'Deck saved successfully!', [
          { text: 'OK', onPress: finishSave }
        ]);
      }
    } catch (e) {
      logDiagnosticError(DIAGNOSTIC_CONTEXTS.deckSave, e);
      Alert.alert('Deck not saved', e instanceof Error ? e.message : getError('E1001'));
    } finally {
      saveInFlight.current = false;
      setIsSaving(false);
    }
  };

  return (
    <View style={[styles.container, { padding: 0, backgroundColor: colors.background }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: spacing[4], borderBottomWidth: 1, borderBottomColor: colors.border, position: 'relative', minHeight: 60 }}>
        <View style={{ position: 'absolute', left: spacing[4], zIndex: 10 }}>
          <BackButton />
        </View>
        <Text accessibilityRole="header" style={[styles.headerTitle, { marginBottom: 0, color: colors.text, textAlign: 'center' }]}>
          {initialDeck ? 'Edit Deck' : 'New Deck'}
        </Text>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      
      <View style={styles.section}>
        <Text style={[styles.label, { color: colors.text }]}>Deck Name</Text>
        <TextInput
          accessibilityLabel="Deck name"
          style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
          placeholder="e.g., Spanish Vocabulary"
          placeholderTextColor={colors.textSecondary}
          value={name}
          onChangeText={setName}
        />
      </View>

      <View style={styles.section}>
        <Text style={[styles.label, { color: colors.text }]}>Description</Text>
        <TextInput
          accessibilityLabel="Deck description"
          style={[styles.input, styles.textArea, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
          placeholder="What's this deck about?"
          placeholderTextColor={colors.textSecondary}
          multiline
          value={description}
          onChangeText={setDescription}
        />
      </View>

      <View style={styles.section}>
        <Text style={[styles.label, { color: colors.text }]}>Banner Background</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={bannerType ? 'Change deck banner image' : 'Choose deck banner image'} style={[styles.imagePickerBtn, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={pickImage}>
          <Text style={[styles.imagePickerText, { color: colors.text }]}>{bannerType ? 'Change Image' : 'Pick an Image'}</Text>
        </TouchableOpacity>
        {bannerType ? (
          <View style={{ marginTop: 12, alignItems: 'center' }}>
            <Image accessible={false} source={bannerType === 'math' ? require('../../../assets/images/math_banner_original.jpg') : { uri: bannerType }} style={{ width: '100%', height: 100, borderRadius: 8 }} />
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Remove deck banner image" onPress={() => setBannerType('')} style={{ marginTop: 8, minHeight: 44, justifyContent: 'center' }}>
              <Text style={{ color: colors.error }}>Remove Banner</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text style={[styles.label, { color: colors.text }]}>Card Tint Colors</Text>
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 8, alignItems: 'center', marginBottom: 12 }}>
          {presetColors.map((color) => (
            <TouchableOpacity
              key={color}
              onPress={() => setCardColor(color)}
              accessibilityRole="button"
              accessibilityLabel={`Use ${color} as the deck card color`}
              accessibilityState={{ selected: cardColor === color }}
              style={[
                styles.colorSwatch,
                { backgroundColor: color, borderColor: colors.border },
                cardColor === color && { borderColor: colors.primary, borderWidth: 3 }
              ]}
            />
          ))}
          <TouchableOpacity
            onPress={() => setShowColorPicker(true)}
            accessibilityRole="button"
            accessibilityLabel="Choose a custom deck card color"
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
              justifyContent: 'center',
              alignItems: 'center'
            }}
          >
            <Text style={{ fontSize: 24, lineHeight: 28, color: colors.textSecondary }}>+</Text>
          </TouchableOpacity>
        </View>

        <Text style={{ fontSize: 14, color: colors.textSecondary, marginBottom: 4 }}>Background Hex</Text>
        <TextInput
          accessibilityLabel="Card background color hex code"
          style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border, marginBottom: 12 }]}
          placeholder="e.g. #E8F5E9"
          placeholderTextColor={colors.textSecondary}
          value={cardColor}
          onChangeText={setCardColor}
        />

        <Text style={{ fontSize: 14, color: colors.textSecondary, marginBottom: 4 }}>Text Hex</Text>
        <TextInput
          accessibilityLabel="Card text color hex code"
          style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
          placeholder="e.g. #000000"
          placeholderTextColor={colors.textSecondary}
          value={cardTextColor}
          onChangeText={setCardTextColor}
        />
      </View>

      <View style={styles.section}>
        {Platform.OS === 'web' ? (
          <View>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Notification Schedule</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 4 }}>
              Local scheduled reminders are managed in the iOS or Android app. Browser deck edits preserve the existing mobile schedule without pretending to schedule web notifications.
            </Text>
          </View>
        ) : (
          <>
        <View style={styles.switchRow}>
          <View style={{ flex: 1, paddingRight: 16 }}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Notification Schedule</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 4 }}>
              Reminders will fire repeatedly at the chosen frequency during the active window. Saving will actively clear and re-register device notifications.
            </Text>
          </View>
          <Switch accessibilityLabel="Enable notification schedule" value={notifActive} onValueChange={setNotifActive} />
        </View>
        
        {notifActive && (
          <View style={[styles.notifConfig, { backgroundColor: colors.card }]}>
            <Text style={[styles.label, { color: colors.text }]}>Frequency (minutes)</Text>
            <TextInput
              accessibilityLabel="Notification frequency in minutes"
              style={[styles.input, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
              keyboardType="numeric"
              value={frequency}
              onChangeText={setFrequency}
            />
            
            <View style={styles.row}>
              <View style={styles.half}>
                <Text style={[styles.label, { color: colors.text }]}>Start Time</Text>
                <TextInput
                  accessibilityLabel="Notification start time"
                  style={[styles.input, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                  placeholder="09:00"
                  placeholderTextColor={colors.textSecondary}
                  value={startTime}
                  onChangeText={setStartTime}
                />
              </View>
              <View style={styles.half}>
                <Text style={[styles.label, { color: colors.text }]}>End Time</Text>
                <TextInput
                  accessibilityLabel="Notification end time"
                  style={[styles.input, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                  placeholder="21:00"
                  placeholderTextColor={colors.textSecondary}
                  value={endTime}
                  onChangeText={setEndTime}
                />
              </View>
            </View>
          </View>
        )}
          </>
        )}
      </View>

      <TouchableOpacity accessibilityRole="button" accessibilityLabel={isSaving ? 'Saving deck' : 'Save deck'} accessibilityState={{ disabled: isSaving, busy: isSaving }} disabled={isSaving} style={[styles.saveButton, { backgroundColor: colors.primary, opacity: isSaving ? 0.6 : 1 }]} onPress={handleSave}>
        <Text style={[styles.saveButtonText, { color: colors.buttonText }]}>{isSaving ? 'Saving…' : 'Save Deck'}</Text>
      </TouchableOpacity>

      {initialDeck && (
        <TouchableOpacity 
          accessibilityRole="button"
          accessibilityLabel={isDeleting ? 'Deleting deck' : 'Delete deck'}
          accessibilityState={{ disabled: isDeleting, busy: isDeleting }}
          style={[styles.saveButton, { backgroundColor: '#B71C1C', marginTop: spacing[2], opacity: isDeleting ? 0.5 : 1 }]} 
          disabled={isDeleting}
          onPress={() => {
            Alert.alert('Delete Deck', 'Delete this deck and every child deck beneath it? Their cards, notes, reviews, and reminders will be removed from the active library.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: async () => {
                if (isDeleting) return;
                setIsDeleting(true);
                try {
                  const deletedDeckIds = await DeckStore.softDelete(initialDeck.id);
                  let notificationWarning = false;
                  try {
                    await Promise.all(deletedDeckIds.map(deckId => NotificationScheduler.removeDeckNotifications(deckId)));
                  } catch (notificationError) {
                    logDiagnosticError(DIAGNOSTIC_CONTEXTS.deckNotificationRemove, notificationError);
                    notificationWarning = true;
                  }
                  if (notificationWarning) {
                    Alert.alert('Deck deleted with a warning', 'Some device reminders could not be removed. They can be cleared from system notification settings.');
                  }
                  if (onSave) onSave(initialDeck);
                  else leaveEditor();
                } catch (e) {
                  logDiagnosticError(DIAGNOSTIC_CONTEXTS.deckDelete, e);
                  Alert.alert('Deck not deleted', e instanceof Error ? e.message : getError('E1002'));
                  setIsDeleting(false);
                }
              }}
            ]);
          }}
        >
          <Text style={[styles.saveButtonText, { color: '#FFF' }]}>{isDeleting ? 'Deleting...' : 'Delete Deck'}</Text>
        </TouchableOpacity>
      )}
      </ScrollView>

      {/* Custom Color Picker Overlay */}
      {showColorPicker && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: spacing[4], zIndex: 1000, elevation: 1000 }}>
          <Pressable accessible={false} importantForAccessibility="no" style={StyleSheet.absoluteFill} onPress={() => setShowColorPicker(false)} />
          <View accessibilityViewIsModal style={{ width: '100%', backgroundColor: colors.card, borderRadius: 12, padding: spacing[4], elevation: 10, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10 }}>
            <Text accessibilityRole="header" style={{ fontSize: typography.lg, fontWeight: 'bold', color: colors.text, marginBottom: spacing[4], textAlign: 'center' }}>Custom Color</Text>
            
            <View style={{ width: '100%', height: 60, backgroundColor: cardColor || colors.background, justifyContent: 'center', alignItems: 'center', borderRadius: 8, marginBottom: spacing[4], borderWidth: 1, borderColor: colors.border }}>
              <Text style={{ fontSize: typography.lg, fontWeight: 'bold', color: cardTextColor || colors.text }}>Preview Text</Text>
            </View>

            <Text style={{ color: colors.textSecondary, marginBottom: spacing[2], fontSize: typography.sm, fontWeight: 'bold' }}>Background Color</Text>
            <View 
              onLayout={(e) => setSpectrumWidth(e.nativeEvent.layout.width)}
              onStartShouldSetResponder={() => true}
              onResponderGrant={handleBgColorDrag}
              onResponderMove={handleBgColorDrag}
              style={{ width: '100%', height: 30, borderRadius: 15, marginBottom: spacing[4], position: 'relative' }}
            >
              <LinearGradient colors={['#FFCDD2', '#FFF9C4', '#C8E6C9', '#B2EBF2', '#BBDEFB', '#E1BEE7', '#FFCDD2']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flex: 1, borderRadius: 15 }} />
              <View style={{ position: 'absolute', left: Math.max(0, Math.min(spectrumWidth - 20, (hexToHsl(cardColor).h / 360) * spectrumWidth - 10)), top: -2, width: 20, height: 34, borderRadius: 10, backgroundColor: '#fff', borderWidth: 2, borderColor: '#000', elevation: 5 }} pointerEvents="none" />
            </View>

            <Text style={{ color: colors.textSecondary, marginBottom: spacing[2], fontSize: typography.sm, fontWeight: 'bold' }}>Text Color</Text>
            <View 
              onStartShouldSetResponder={() => true}
              onResponderGrant={handleTextColorDrag}
              onResponderMove={handleTextColorDrag}
              style={{ width: '100%', height: 30, borderRadius: 15, marginBottom: spacing[6], position: 'relative' }}
            >
              <LinearGradient colors={['#B71C1C', '#F57F17', '#1B5E20', '#006064', '#0D47A1', '#4A148C', '#B71C1C']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flex: 1, borderRadius: 15 }} />
              <View style={{ position: 'absolute', left: Math.max(0, Math.min(spectrumWidth - 20, (hexToHsl(cardTextColor).h / 360) * spectrumWidth - 10)), top: -2, width: 20, height: 34, borderRadius: 10, backgroundColor: '#fff', borderWidth: 2, borderColor: '#000', elevation: 5 }} pointerEvents="none" />
            </View>

            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Finish choosing deck card colors" onPress={() => setShowColorPicker(false)} style={[styles.saveButton, { backgroundColor: colors.primary, width: '100%', padding: spacing[3], marginBottom: 0, marginTop: 0 }]}> 
              <Text style={[styles.saveButtonText, { color: colors.buttonText }]}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: spacing[4],
  },
  headerTitle: {
    fontSize: typography['3xl'], // roughly 28
    fontWeight: 'bold',
    marginBottom: spacing[6],
  },
  section: {
    marginBottom: spacing[6],
  },
  label: {
    fontSize: typography.base,
    marginBottom: spacing[2],
  },
  input: {
    fontSize: typography.base,
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
  },
  textArea: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  sectionTitle: {
    fontSize: typography.xl,
    fontWeight: '600',
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing[4],
  },
  notifConfig: {
    padding: spacing[4],
    borderRadius: 12,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing[4],
  },
  half: {
    width: '48%',
  },
  saveButton: {
    padding: spacing[4],
    borderRadius: 8,
    alignItems: 'center',
    marginTop: spacing[4],
    marginBottom: 40,
    minHeight: 44,
    justifyContent: 'center',
  },
  saveButtonText: {
    fontSize: typography.lg,
    fontWeight: 'bold',
  },
  imagePickerBtn: {
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    minHeight: 44,
    justifyContent: 'center',
  },
  imagePickerText: {
    fontSize: typography.base,
  },
  colorSwatch: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
  },
});
