/**
 * @fileoverview Courses tab route.
 *
 * Reviewer notes:
 * - Intentionally thin: visual page chrome belongs here, course behavior lives
 *   in CourseList and lower-level LMS components.
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useThemeColors } from '../../lib/useThemeColors';
import { CourseList } from '../../components/lms/CourseList';

export default function AdminScreen() {
  const colors = useThemeColors();
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <CourseList />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  }
});
