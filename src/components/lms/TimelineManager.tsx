/**
 * @fileoverview src/components/lms/TimelineManager.tsx.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { NestableDraggableFlatList, ScaleDecorator } from 'react-native-draggable-flatlist';
import { useThemeColors } from '../../lib/useThemeColors';
import { useLMSStore } from '../../lib/store/useLMSStore';
import { ContentItem, ContentCategory } from '../../types/lms';
import { BaseContentManager, BaseContentManagerChildProps } from './shared/BaseContentManager';
import { useCourseRole } from '../../lib/store/selectors';
import { hasCoursePermission } from '../../lib/authorization/coursePermissions';

const timelineItemSummary = (item: ContentItem): string => {
  const description = item.description?.trim() || '';
  if (!description.startsWith('{')) return description;
  try {
    const payload: unknown = JSON.parse(description);
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      const candidate = payload as { html?: unknown; css?: unknown };
      if (typeof candidate.html === 'string' || typeof candidate.css === 'string') return 'Custom code block';
    }
  } catch {
    // Malformed source remains visible so staff can recognize and repair it.
  }
  return description;
};

export const TimelineManager = ({ courseId }: { courseId: string }) => {
  return (
    <BaseContentManager 
      courseId={courseId} 
      renderContent={(props) => <TimelineManagerView {...props} />} 
    />
  );
};

const TimelineManagerView = (props: BaseContentManagerChildProps) => {
  const { 
    courseId, courseContent, deletedContent, groupLabels, mutationBusy,
    openAddModal, openEditModal, deleteItemConfirm, cyclePresentationSlot, toggleGroupSelection,
    openAssessmentBuilder, openPopQuizHost,
    openRecentlyDeleted, openManageGroups, openManageLabels, openEditGroup 
  } = props;

  const colors = useThemeColors();
  const currentUserRole = useCourseRole(courseId) ?? 'student';
  const canManageContent = hasCoursePermission(currentUserRole, 'manageContent');
  const canHostLive = hasCoursePermission(currentUserRole, 'hostLiveAssessment');
  const courses = useLMSStore(state => state.courses);
  const course = courses.find(c => c.id === courseId);
  const isCustomMode = course?.presentationMode === 'custom';
  
  const [groupingMode, setGroupingMode] = useState(false);
  const [activeGroupIcon, setActiveGroupIcon] = useState<string>(groupLabels[0] || 'Group 1');
  const [isReordering, setIsReordering] = useState(false);
  const reorderOperationRef = useRef(false);

  const handleReorder = async (items: ContentItem[]) => {
    if (reorderOperationRef.current) return;
    reorderOperationRef.current = true;
    setIsReordering(true);
    try {
      await useLMSStore.getState().reorderContentItems(items);
    } catch {
      // BaseContentManager keeps the repository error visible until dismissed.
    } finally {
      reorderOperationRef.current = false;
      setIsReordering(false);
    }
  };
  
  const adminContent = courseContent.filter(i => i.category === 'admin');
  const materialsContent = courseContent.filter(i => i.category === 'material');
  const courseworkContent = courseContent.filter(i => i.category === 'coursework');

  const renderContentBox = (title: string, description: string, items: ContentItem[], category: ContentCategory) => {
    return (
      <View
        pointerEvents={mutationBusy || isReordering ? 'none' : 'auto'}
        style={[styles.box, { backgroundColor: colors.card, borderColor: colors.border, opacity: mutationBusy || isReordering ? 0.75 : 1 }]}
      > 
        <View style={styles.boxHeader}>
          <View>
            <Text style={[styles.boxTitle, { color: colors.text }]}>{title}</Text>
            <Text style={[styles.boxDesc, { color: colors.textSecondary }]}>{description}</Text>
          </View>
          {canManageContent && (
            <TouchableOpacity 
              style={[styles.addBtn, { backgroundColor: colors.primary + '20' }]} 
              onPress={() => openAddModal(category)}
              accessibilityRole="button"
              accessibilityLabel={`Add ${title}`}
              accessibilityHint={`Opens the modal to add a new item to ${title}`}
            >
              <Ionicons name="add" size={20} color={colors.primary} />
            </TouchableOpacity>
          )}
        </View>

        {items.length === 0 ? (
          <Text style={{ color: colors.textSecondary, fontStyle: 'italic', marginTop: 10 }}>No items yet.</Text>
        ) : (
          <View style={styles.itemList}>
            <View style={{ flexDirection: 'row', paddingHorizontal: 15, paddingVertical: 10, borderBottomWidth: 1, borderColor: colors.border }}>
              {isCustomMode && <View style={{ width: Platform.OS === 'web' ? 58 : 34 }} />}
              {groupingMode && <View style={{ width: 34 }} />}
              <Text style={{ flex: 2, color: colors.textSecondary, fontSize: 12, fontWeight: 'bold', textTransform: 'uppercase' }}>Details</Text>
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' }}>
                <Text style={{ flex: 1, color: colors.textSecondary, fontSize: 12, fontWeight: 'bold', textTransform: 'uppercase', textAlign: 'center' }}>Status</Text>
                {!groupingMode && (
                  <Text style={{ flex: 1, color: colors.textSecondary, fontSize: 12, fontWeight: 'bold', textTransform: 'uppercase', textAlign: 'right' }}>Actions</Text>
                )}
              </View>
            </View>
            {isCustomMode && canManageContent && Platform.OS !== 'web' ? (
              <NestableDraggableFlatList
                data={items}
                keyExtractor={(item) => item.id}
                onDragEnd={({ data }) => void handleReorder(data)}
                renderItem={({ item, drag, isActive }) => (
                  <ScaleDecorator>
                    {renderRow(item, items, drag, isActive)}
                  </ScaleDecorator>
                )}
              />
            ) : (
              items.map(item => renderRow(item, items))
            )}
          </View>
        )}
      </View>
    );
  };

  const renderRow = (item: ContentItem, siblingItems: ContentItem[], drag?: () => void, isActive?: boolean) => (
    <View key={item.id} style={[
      styles.itemRow,  
      { borderBottomColor: colors.border, backgroundColor: isActive ? colors.primary + '20' : 'transparent' },
      item.presentationSlot === 'current' && { borderLeftWidth: 4, borderLeftColor: '#4CAF50', paddingLeft: 10, borderTopLeftRadius: 8, borderBottomLeftRadius: 8 }
    ]}>
      {isCustomMode && canManageContent && drag && (
        <TouchableOpacity disabled={isReordering || mutationBusy} onLongPress={isReordering || mutationBusy ? undefined : drag} style={{ marginRight: 10, opacity: isReordering || mutationBusy ? 0.5 : 1 }} accessibilityRole="button" accessibilityLabel={`Reorder ${item.title}`} accessibilityHint="Press and drag to change its position" accessibilityState={{ disabled: isReordering || mutationBusy }}>
          <Ionicons name="menu-outline" size={24} color={colors.textSecondary} />
        </TouchableOpacity>
      )}
      {isCustomMode && canManageContent && Platform.OS === 'web' && (
        <View style={{ width: 58, flexDirection: 'row', marginRight: 6 }}>
          {([-1, 1] as const).map(direction => {
            const currentIndex = siblingItems.findIndex(candidate => candidate.id === item.id);
            const destinationIndex = currentIndex + direction;
            const disabled = mutationBusy || isReordering || currentIndex < 0 || destinationIndex < 0 || destinationIndex >= siblingItems.length;
            return (
              <TouchableOpacity
                key={direction}
                disabled={disabled}
                onPress={() => {
                  if (disabled) return;
                  const reordered = [...siblingItems];
                  [reordered[currentIndex], reordered[destinationIndex]] = [reordered[destinationIndex], reordered[currentIndex]];
                  void handleReorder(reordered);
                }}
                style={{ width: 26, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.35 : 1 }}
                accessibilityRole="button"
                accessibilityLabel={`Move ${item.title} ${direction < 0 ? 'up' : 'down'}`}
                accessibilityState={{ disabled }}
              >
                <Ionicons name={direction < 0 ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            );
          })}
        </View>
      )}
      {groupingMode && (
        <TouchableOpacity 
          disabled={mutationBusy || isReordering}
          onPress={() => toggleGroupSelection(item, activeGroupIcon)} 
          style={{ marginRight: 10, opacity: mutationBusy || isReordering ? 0.5 : 1 }}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: item.groupIcon === activeGroupIcon, disabled: mutationBusy || isReordering }}
          accessibilityLabel={`Select ${item.title} for group`}
        >
          <Ionicons 
            name={item.groupIcon === activeGroupIcon ? "checkbox" : "square-outline"} 
            size={24} 
            color={item.groupIcon === activeGroupIcon ? colors.primary : colors.textSecondary} 
          />
        </TouchableOpacity>
      )}
      <View style={{ flex: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
          {!!item.groupIcon && (
            <View style={[styles.inlineBadge, { backgroundColor: colors.border }]}>
              <Text style={{ color: colors.text, fontSize: 10 }}>{item.groupIcon}</Text>
            </View>
          )}
          {item.isPopQuiz && (
            <View style={[styles.inlineBadge, { backgroundColor: '#FF980020', borderColor: '#FF9800', borderWidth: 1 }]}>
              <Text style={{ color: '#FF9800', fontSize: 10, fontWeight: 'bold' }}>POP QUIZ</Text>
            </View>
          )}
          <Text style={[styles.itemTitle, { color: colors.text }]}>{item.title}</Text>
          {item.questions && (
            <View style={{ marginLeft: 10, backgroundColor: colors.primary + '20', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10 }}>
              <Text style={{ color: colors.primary, fontSize: 10, fontWeight: 'bold' }}>{item.questions.length} Questions</Text>
            </View>
          )}
        </View>
        {!!item.description && <Text style={{ color: colors.textSecondary, fontSize: 12 }} numberOfLines={1}>{timelineItemSummary(item)}</Text>}
      </View>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' }}>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <TouchableOpacity
            disabled={!canManageContent || mutationBusy || isReordering}
            onPress={() => cyclePresentationSlot(item)}
            style={{ flexDirection: 'row', alignItems: 'center' }}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canManageContent || mutationBusy || isReordering }}
            accessibilityLabel={`Presentation Slot: ${item.presentationSlot}`}
            accessibilityHint={`Cycles the presentation slot of ${item.title}`}
          >
            <Text style={{ 
              color: item.presentationSlot === 'current' ? '#4CAF50' : colors.textSecondary, 
              fontSize: 10, 
              marginRight: 2, 
              textTransform: 'uppercase',
              fontWeight: item.presentationSlot === 'current' ? 'bold' : 'normal',
            }}>
              {item.presentationSlot}
            </Text>
            <Ionicons name="chevron-down" size={12} color={item.presentationSlot === 'current' ? '#4CAF50' : colors.textSecondary} />
          </TouchableOpacity>
        </View>
        {!groupingMode && (
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' }}>
            {item.category === 'coursework' && (
              <>
                {(item.isPopQuiz || item.isPoll) && canHostLive && (
                  <TouchableOpacity 
                    onPress={() => openPopQuizHost(item)} 
                    style={{ marginRight: 10 }}
                    accessibilityRole="button"
                    accessibilityLabel={item.isPoll ? "Host Poll" : "Host Pop-Quiz"}
                  >
                    <Ionicons name="flash-outline" size={18} color="#FF9800" />
                  </TouchableOpacity>
                )}

                {canManageContent && (
                  <TouchableOpacity 
                    onPress={() => openAssessmentBuilder(item)} 
                    style={{ marginRight: 10 }}
                    accessibilityRole="button"
                    accessibilityLabel="Edit Assessment"
                  >
                    <Ionicons name="construct-outline" size={18} color={colors.primary} />
                  </TouchableOpacity>
                )}
              </>
            )}
            {item.category !== 'coursework' && canManageContent && (
              <TouchableOpacity 
                onPress={() => openEditModal(item)} 
                style={{ marginRight: 10 }}
                accessibilityRole="button"
                accessibilityLabel="Edit Details"
              >
                <Ionicons name="pencil-outline" size={18} color={colors.primary} />
              </TouchableOpacity>
            )}
            {canManageContent && (
              <TouchableOpacity 
                onPress={() => deleteItemConfirm(item.id)}
                accessibilityRole="button"
                accessibilityLabel="Delete Item"
              >
                <Ionicons name="trash-outline" size={18} color="#FF5252" />
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      {canManageContent && (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <View style={[styles.toolbar, { backgroundColor: colors.card, borderColor: colors.border, flex: 1, marginRight: 10, marginBottom: 0 }]}>
            <TouchableOpacity 
              style={[styles.groupBtn, groupingMode && { backgroundColor: colors.primary }]}
              onPress={() => setGroupingMode(!groupingMode)}
              accessibilityRole="button"
              accessibilityLabel={groupingMode ? 'Done Grouping' : 'Group Items'}
              accessibilityState={{ selected: groupingMode }}
            >
              <Ionicons name="layers-outline" size={20} color={groupingMode ? colors.buttonText : colors.primary} />
              <Text style={{ marginLeft: 5, color: groupingMode ? colors.buttonText : colors.primary, fontWeight: 'bold' }}>
                {groupingMode ? 'Done Grouping' : 'Group Items'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.groupBtn, { marginLeft: 10 }]}
              onPress={() => openManageGroups()}
              accessibilityRole="button"
            >
              <Ionicons name="folder-open-outline" size={20} color={colors.primary} />
              <Text style={{ marginLeft: 5, color: colors.primary, fontWeight: 'bold' }}>Manage Groups</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity 
            style={{ padding: 15, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, flexDirection: 'row', alignItems: 'center' }}
            onPress={() => openRecentlyDeleted()}
            accessibilityRole="button"
            accessibilityLabel={`Recently deleted${deletedContent.length ? `, ${deletedContent.length} item${deletedContent.length === 1 ? '' : 's'}` : ''}`}
          >
            <Ionicons name="trash-bin-outline" size={20} color={colors.textSecondary} />
            {deletedContent.length > 0 && (
              <View style={{ position: 'absolute', top: -5, right: -5, backgroundColor: '#FF5252', borderRadius: 10, width: 20, height: 20, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: colors.onError, fontSize: 10, fontWeight: 'bold' }}>{deletedContent.length}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      )}

      <View style={{ marginBottom: 20 }}>
        {groupingMode ? (
          <ScrollView keyboardShouldPersistTaps="handled" horizontal showsHorizontalScrollIndicator={false} style={{ flexDirection: 'row' }}>
            {groupLabels.map(label => (
              <TouchableOpacity 
                key={label} 
                style={[styles.labelBtn, activeGroupIcon === label && { borderColor: colors.primary, borderWidth: 2 }, { backgroundColor: colors.card }]}
                onPress={() => setActiveGroupIcon(label)}
                accessibilityRole="radio"
                accessibilityLabel={`Assign selected items to ${label}`}
                accessibilityState={{ checked: activeGroupIcon === label }}
              >
                <Text style={{ color: colors.text, fontWeight: activeGroupIcon === label ? 'bold' : 'normal' }}>{label}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity 
              style={[styles.labelBtn, { backgroundColor: colors.primary + '20', borderColor: colors.primary, borderWidth: 1 }]}
              onPress={() => openManageLabels()}
              accessibilityRole="button"
              accessibilityLabel="Manage custom content labels"
            >
              <Text style={{ color: colors.primary, fontWeight: 'bold' }}>Custom</Text>
            </TouchableOpacity>
          </ScrollView>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {groupLabels.map(label => {
              const count = courseContent.filter(i => i.groupIcon === label).length;
              return (
                <TouchableOpacity 
                  key={`badge-${label}`} 
                  style={[styles.iconBadge, { backgroundColor: colors.card, borderColor: colors.border, marginBottom: 5, marginRight: 10, opacity: count === 0 ? 0.6 : 1 }]}
                  onPress={() => {
                    if (canManageContent) {
                      openEditGroup(label);
                    }
                  }}
                  disabled={!canManageContent}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${label} content group, ${count} item${count === 1 ? '' : 's'}`}
                  accessibilityState={{ disabled: !canManageContent }}
                >
                  <Text style={{ color: colors.text, fontSize: 12 }}>{label}</Text>
                  <View style={[styles.badgeCount, { backgroundColor: colors.primary }]}>
                    <Text style={{ color: colors.buttonText, fontSize: 10, fontWeight: 'bold' }}>{count}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </View>

      <Text style={{ color: colors.textSecondary, marginBottom: 15 }}>
        Manage your course content. Items assigned to groups can be released simultaneously.
      </Text>

      {renderContentBox('Admin', 'Syllabus, announcements, and structural information.', adminContent, 'admin')}
      {renderContentBox('Course Materials', 'Read-only content like PDFs, slides, and links.', materialsContent, 'material')}
      {renderContentBox('Course Work', 'Quizzes, assignments, dropboxes, and interactive tests.', courseworkContent, 'coursework')}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 15 },
  toolbar: { flexDirection: 'row', padding: 10, borderRadius: 12, borderWidth: 1, marginBottom: 20 },
  groupBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, paddingVertical: 8, borderRadius: 8, minHeight: 44 },
  labelBtn: { paddingHorizontal: 15, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: 'transparent', marginRight: 10, minHeight: 44, justifyContent: 'center' },
  iconBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1, minHeight: 44 },
  badgeCount: { marginLeft: 5, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10 },
  box: { borderWidth: 1, borderRadius: 16, marginBottom: 20, overflow: 'hidden' },
  boxHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', padding: 20, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.1)' },
  boxTitle: { fontSize: 20, fontWeight: 'bold', marginBottom: 5 },
  boxDesc: { fontSize: 12, maxWidth: '85%' },
  addBtn: { padding: 10, borderRadius: 12 },
  itemList: { paddingBottom: 10 },
  itemRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, paddingVertical: 15, borderBottomWidth: 1 },
  inlineBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, marginRight: 8, borderWidth: 1, borderColor: 'transparent' },
  itemTitle: { fontSize: 16, fontWeight: 'bold' }
});
