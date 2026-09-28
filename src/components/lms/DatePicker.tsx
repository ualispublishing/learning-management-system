/**
 * @fileoverview src/components/lms/DatePicker.tsx.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useThemeColors } from '../../lib/useThemeColors';
import { useLMSStore } from '../../lib/store/useLMSStore';
import { formatContentDateTimeForEditor, normalizeContentDateTime, parseContentDateTime } from '../../lib/contentDateTime';

interface DatePickerProps {
  courseId: string;
  value: string;
  onChange: (val: string) => void;
  accessibilityLabel?: string;
}

export const DatePicker = ({ courseId, value, onChange, accessibilityLabel = 'Date and time' }: DatePickerProps) => {
  const colors = useThemeColors();
  const styles = getStyles(colors);
  const { courses, lastSelectedDatePerCourse, setLastSelectedDate } = useLMSStore();
  const courseTimeZone = courses.find(course => course.id === courseId)?.timeZone;
  
  const [modalVisible, setModalVisible] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [draftValue, setDraftValue] = useState(() => formatContentDateTimeForEditor(value, courseTimeZone));
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  
  // Working state for the modal
  const [tempDate, setTempDate] = useState(''); // YYYY-MM-DD
  const [hh, setHh] = useState('11');
  const [mm, setMm] = useState('59');
  const [period, setPeriod] = useState<'AM'|'PM'>('PM');

  const parseDateTime = (val: string) => {
    const parsed = parseContentDateTime(val, courseTimeZone);
    if (parsed === undefined) return null;
    const formatted = formatContentDateTimeForEditor(parsed, courseTimeZone);
    const match = formatted.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}) (AM|PM)$/);
    if (!match) return null;
    return {
      date: match[1],
      hour: match[2],
      minute: match[3],
      period: match[4] as 'AM'|'PM',
    };
  };

  const calendarDate = (value: string) => {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day);
  };

  const commitDraft = () => {
    if (!draftValue.trim()) {
      setValidationError(null);
      setIsEditing(false);
      onChange('');
      return;
    }
    const normalized = normalizeContentDateTime(draftValue, courseTimeZone);
    if (!normalized) {
      setValidationError(`Enter a real, unambiguous date and time${courseTimeZone ? ` in ${courseTimeZone}` : ''}, for example 2026-09-15 11:59 PM.`);
      setIsEditing(true);
      return;
    }
    setValidationError(null);
    setDraftValue(formatContentDateTimeForEditor(normalized, courseTimeZone));
    setIsEditing(false);
    onChange(normalized);
    setLastSelectedDate(courseId, normalized);
  };

  const openCalendar = () => {
    let d = new Date();
    const parsed = parseDateTime(draftValue || value);
    
    if (parsed) {
      d = calendarDate(parsed.date);
      setTempDate(parsed.date);
      setHh(parsed.hour);
      setMm(parsed.minute);
      setPeriod(parsed.period);
    } else {
      // Defaults
      setTempDate('');
      setHh('11');
      setMm('59');
      setPeriod('PM');
      
      if (lastSelectedDatePerCourse[courseId]) {
        const lastParsed = parseDateTime(lastSelectedDatePerCourse[courseId]);
        if (lastParsed) {
          d = calendarDate(lastParsed.date);
          setTempDate(lastParsed.date);
        }
      } else {
        const course = courses.find(c => c.id === courseId);
        if (course?.termStart) {
          d = new Date(course.termStart);
        }
      }
    }
    
    if (!isNaN(d.getTime())) {
      setCurrentMonth(new Date(d.getFullYear(), d.getMonth(), 1));
    }
    setModalVisible(true);
    setIsEditing(true);
  };

  const confirmSelection = () => {
    if (!tempDate) {
      setDraftValue('');
      setValidationError(null);
      setIsEditing(false);
      onChange('');
      setModalVisible(false);
      return;
    }
    
    const rawHour = hh.replace(/\D/g, '');
    const rawMinute = mm.replace(/\D/g, '');
    const formatted = `${tempDate} ${rawHour}:${rawMinute} ${period}`;
    const normalized = normalizeContentDateTime(formatted, courseTimeZone);
    if (!normalized) {
      setValidationError('Select a valid hour from 1–12 and minute from 00–59.');
      return;
    }
    setValidationError(null);
    setDraftValue(formatContentDateTimeForEditor(normalized, courseTimeZone));
    setIsEditing(false);
    onChange(normalized);
    setLastSelectedDate(courseId, normalized);
    setModalVisible(false);
  };

  const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
  const firstDayIndex = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay();

  return (
    <View style={styles.container}>
      <View style={[styles.inputRow, { borderColor: colors.border, backgroundColor: colors.card }]}>
        <TextInput
          style={[styles.input, { color: colors.text }]}
          placeholder="YYYY-MM-DD HH:MM AM"
          placeholderTextColor={colors.textSecondary}
          value={isEditing || validationError || modalVisible ? draftValue : formatContentDateTimeForEditor(value, courseTimeZone)}
          onFocus={() => {
            setDraftValue(formatContentDateTimeForEditor(value, courseTimeZone));
            setIsEditing(true);
          }}
          onChangeText={text => {
            setDraftValue(text);
            setValidationError(null);
          }}
          onBlur={commitDraft}
          accessibilityLabel={accessibilityLabel}
          accessibilityHint="Use year-month-day followed by hour, minute, and AM or PM."
        />
        <TouchableOpacity onPress={openCalendar} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel={`Open date picker for ${accessibilityLabel}`}>
          <Ionicons name="calendar-outline" size={20} color={colors.primary} />
        </TouchableOpacity>
      </View>
      {!!validationError && <Text accessibilityRole="alert" style={{ color: colors.error, marginTop: 6 }}>{validationError}</Text>}
      {!!courseTimeZone && <Text style={{ color: colors.textSecondary, fontSize: 11, marginTop: 4 }}>Course time: {courseTimeZone}</Text>}

      {modalVisible && (
        <View style={[styles.inlineCalendar, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.calendarHeader}>
              <TouchableOpacity onPress={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))} accessibilityRole="button" accessibilityLabel="Previous month">
                <Ionicons name="chevron-back" size={24} color={colors.text} />
              </TouchableOpacity>
              <Text style={[styles.monthText, { color: colors.text }]}>
                {currentMonth.toLocaleString('default', { month: 'long', year: 'numeric' })}
              </Text>
              <TouchableOpacity onPress={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))} accessibilityRole="button" accessibilityLabel="Next month">
                <Ionicons name="chevron-forward" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.daysRow}>
              {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => (
                <Text key={day} style={[styles.dayHeader, { color: colors.textSecondary }]}>{day}</Text>
              ))}
            </View>

            <View style={styles.grid}>
              {Array.from({ length: firstDayIndex }).map((_, i) => (
                <View key={`empty-${i}`} style={styles.cell} />
              ))}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const dStr = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const isSelected = tempDate === dStr;
                
                return (
                  <TouchableOpacity 
                    key={day} 
                    style={[styles.cell, isSelected && { backgroundColor: colors.primary, borderRadius: 20 }]}
                    onPress={() => setTempDate(dStr)}
                    accessibilityRole="button"
                    accessibilityLabel={dStr}
                    accessibilityState={{ selected: isSelected }}
                  >
                    <Text style={{ color: isSelected ? colors.buttonText : colors.text, fontWeight: isSelected ? 'bold' : 'normal' }}>
                      {day}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Time Picker Row */}
            <View style={{ marginTop: 20, paddingTop: 15, borderTopWidth: 1, borderColor: colors.border }}>
              <Text style={{ color: colors.textSecondary, fontWeight: 'bold', marginBottom: 10 }}>Time</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                <TextInput 
                  style={[styles.timeInput, { borderColor: colors.border, color: colors.text }]}
                  value={hh}
                  onChangeText={setHh}
                  keyboardType="numeric"
                  maxLength={2}
                  accessibilityLabel="Hour"
                />
                <Text style={{ color: colors.text, marginHorizontal: 5, fontWeight: 'bold' }}>:</Text>
                <TextInput 
                  style={[styles.timeInput, { borderColor: colors.border, color: colors.text }]}
                  value={mm}
                  onChangeText={setMm}
                  keyboardType="numeric"
                  maxLength={2}
                  accessibilityLabel="Minute"
                />
                <View style={{ flexDirection: 'row', marginLeft: 15, backgroundColor: colors.background, borderRadius: 8, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
                  <TouchableOpacity 
                    style={[styles.periodBtn, period === 'AM' && { backgroundColor: colors.primary }]}
                    onPress={() => setPeriod('AM')}
                    accessibilityRole="button"
                    accessibilityState={{ selected: period === 'AM' }}
                  >
                    <Text style={{ color: period === 'AM' ? colors.buttonText : colors.text, fontWeight: 'bold' }}>AM</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.periodBtn, period === 'PM' && { backgroundColor: colors.primary }]}
                    onPress={() => setPeriod('PM')}
                    accessibilityRole="button"
                    accessibilityState={{ selected: period === 'PM' }}
                  >
                    <Text style={{ color: period === 'PM' ? colors.buttonText : colors.text, fontWeight: 'bold' }}>PM</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            <TouchableOpacity 
              style={{ marginTop: 20, backgroundColor: colors.primary, padding: 15, borderRadius: 8, alignItems: 'center' }}
              onPress={confirmSelection}
              accessibilityRole="button"
            >
              <Text style={{ color: colors.buttonText, fontWeight: 'bold' }}>Confirm Date & Time</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={{ marginTop: 10, padding: 15, borderRadius: 8, alignItems: 'center' }}
              onPress={() => {
                setModalVisible(false);
                setDraftValue(formatContentDateTimeForEditor(value));
                setValidationError(null);
                setIsEditing(false);
              }}
              accessibilityRole="button"
            >
              <Text style={{ color: colors.textSecondary, fontWeight: 'bold' }}>Cancel</Text>
            </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

const getStyles = (colors: any) => StyleSheet.create({
  container: { width: '100%', maxWidth: 320, minWidth: 0, flexShrink: 1 },
  inputRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 8, height: 45 },
  input: { flex: 1, paddingHorizontal: 15, fontSize: 16 },
  iconBtn: { padding: 10, borderLeftWidth: 1, borderColor: colors.border },
  inlineCalendar: { marginTop: 10, padding: 20, borderRadius: 12, borderWidth: 1, width: '100%', minWidth: 0, alignSelf: 'center' },
  calendarHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  monthText: { fontSize: 18, fontWeight: 'bold' },
  daysRow: { flexDirection: 'row', marginBottom: 10 },
  dayHeader: { flex: 1, textAlign: 'center', fontWeight: 'bold' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '14.28%', height: 40, justifyContent: 'center', alignItems: 'center', marginBottom: 5 },
  timeInput: { width: 45, height: 40, borderWidth: 1, borderRadius: 8, textAlign: 'center', fontSize: 16 },
  periodBtn: { paddingHorizontal: 12, paddingVertical: 10 }
});
