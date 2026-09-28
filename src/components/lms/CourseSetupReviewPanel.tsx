/**
 * @fileoverview src/components/lms/CourseSetupReviewPanel.tsx.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useMemo, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { accessibleForegroundColor } from '../../lib/color';
import { buildCourseSetupPanelModel, buildCourseSetupReview } from '../../lib/courseSetupReview';
import { useThemeColors } from '../../lib/useThemeColors';
import { ContentItem, Course, CourseRole } from '../../types/lms';

interface CourseSetupReviewPanelProps {
  course: Course;
  items: ContentItem[];
  role: CourseRole | null | undefined;
  now: number;
}

export const CourseSetupReviewPanel = ({ course, items, role, now }: CourseSetupReviewPanelProps) => {
  const colors = useThemeColors();
  const [expanded, setExpanded] = useState(false);
  const review = useMemo(
    () => buildCourseSetupReview(course, items, role, now),
    [course, items, role, now],
  );
  const model = useMemo(() => review ? buildCourseSetupPanelModel(review) : null, [review]);
  if (!review || !model) return null;

  const errorColor = accessibleForegroundColor(colors.error, [colors.card]) || colors.text;
  const warningColor = accessibleForegroundColor(colors.warning, [colors.card]) || colors.text;
  const successColor = accessibleForegroundColor(colors.success, [colors.card]) || colors.text;
  const toneColor = model.summary.tone === 'error'
    ? errorColor
    : model.summary.tone === 'warning'
      ? warningColor
      : model.summary.tone === 'success'
        ? successColor
        : colors.textSecondary;
  const toneIcon = model.summary.tone === 'error'
    ? 'alert-circle'
    : model.summary.tone === 'warning'
      ? 'warning'
      : model.summary.tone === 'success'
        ? 'checkmark-circle'
        : 'information-circle';

  return (
    <View
      style={{ marginHorizontal: 20, marginTop: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.card, overflow: 'hidden' }}
      accessibilityLabel="Staff course setup preflight"
    >
      <TouchableOpacity
        onPress={() => setExpanded(current => !current)}
        accessibilityRole="button"
        accessibilityLabel={model.toggleLabel}
        accessibilityHint={`${expanded ? 'Collapses' : 'Expands'} the staff-only client-side setup findings.`}
        accessibilityState={{ expanded }}
        style={{ minHeight: 56, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center' }}
      >
        <Ionicons name={toneIcon} size={22} color={toneColor} />
        <View style={{ flex: 1, marginHorizontal: 10 }}>
          <Text accessibilityLiveRegion="polite" style={{ color: colors.text, fontWeight: '700' }}>{model.summary.label}</Text>
          <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>{model.summary.detail}</Text>
        </View>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={20} color={colors.textSecondary} />
      </TouchableOpacity>

      {expanded && (
        <View style={{ padding: 14, paddingTop: 0, borderTopWidth: 1, borderTopColor: colors.border }}>
          <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 10, marginBottom: 8 }}>
            Client-side preflight only. Institution publication policy and server authorization remain authoritative.
          </Text>
          {model.visibleIssues.map(issue => (
            <View key={`${issue.severity}:${issue.code}:${issue.itemId || ''}`} style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 9 }}>
              <Ionicons
                name={issue.severity === 'blocker' ? 'close-circle' : 'warning-outline'}
                size={17}
                color={issue.severity === 'blocker' ? errorColor : warningColor}
                style={{ marginTop: 1 }}
              />
              <View style={{ flex: 1, marginLeft: 8 }}>
                <Text style={{ color: colors.text, fontWeight: '600' }}>{issue.title}</Text>
                <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 1 }}>{issue.detail}</Text>
              </View>
            </View>
          ))}
          {model.remainingIssueCount > 0 && (
            <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 9 }}>
              {model.remainingIssueCount} additional finding{model.remainingIssueCount === 1 ? '' : 's'} omitted from this compact view.
            </Text>
          )}
          <View accessibilityRole="list" accessibilityLabel="Course setup checks" style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 9 }}>
            {review.checks.map(check => (
              <View key={check.code} style={{ minHeight: 28, flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name={check.complete ? 'checkmark' : 'close'} size={16} color={check.complete ? successColor : errorColor} />
                <Text style={{ color: colors.textSecondary, fontSize: 12, marginLeft: 7 }}>{check.label}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
};
