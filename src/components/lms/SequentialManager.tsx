/**
 * @fileoverview src/components/lms/SequentialManager.tsx.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Modal, useWindowDimensions } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useThemeColors } from '../../lib/useThemeColors';
import { useLMSStore } from '../../lib/store/useLMSStore';
import { ContentItem } from '../../types/lms';
import { BaseContentManager, BaseContentManagerChildProps } from './shared/BaseContentManager';
import { useCourseRole } from '../../lib/store/selectors';
import { createEntityId } from '../../lib/id';
import { hasCoursePermission } from '../../lib/authorization/coursePermissions';

export const SequentialManager = ({ courseId }: { courseId: string }) => {
  return (
    <BaseContentManager 
      courseId={courseId} 
      renderContent={(props) => <SequentialManagerView {...props} />} 
    />
  );
};

const SequentialManagerView = (props: BaseContentManagerChildProps) => {
  const { 
    courseContent, deletedContent, mutationBusy, openAddModal, openEditModal,
    openScheduleBlock, deleteItemConfirm, openAssessmentBuilder, openPopQuizHost,
    openRecentlyDeleted,
  } = props;
  
  const courseId = props.courseId;
  const colors = useThemeColors();
  const { width: viewportWidth } = useWindowDimensions();
  const compactLayout = viewportWidth < 680;
  const addContentItem = useLMSStore(state => state.addContentItem);
  const currentUserRole = useCourseRole(courseId) ?? 'student';
  const canManageContent = hasCoursePermission(currentUserRole, 'manageContent');
  const canHostLive = hasCoursePermission(currentUserRole, 'hostLiveAssessment');

  const orderedContent = (left: ContentItem, right: ContentItem) =>
    (left.orderIndex ?? left.createdAt) - (right.orderIndex ?? right.createdAt)
    || left.id.localeCompare(right.id);
  const blocks = courseContent
    .filter(i => i.category === 'admin' && i.presentationSlot === 'block-header')
    .sort(orderedContent);
  const blockGroupKeys = new Set(blocks.flatMap(block => block.groupIcon ? [block.groupIcon] : []));
  const ungroupedItems = courseContent
    .filter(item => item.presentationSlot !== 'block-header' && (!item.groupIcon || !blockGroupKeys.has(item.groupIcon)))
    .sort(orderedContent);

  const [addBlockVisible, setAddBlockVisible] = useState(false);
  const [newBlockTitle, setNewBlockTitle] = useState('');
  const [addBlockError, setAddBlockError] = useState<string | null>(null);
  const [isAddingBlock, setIsAddingBlock] = useState(false);

  const handleAddBlock = async () => {
    if (!canManageContent) {
      setAddBlockError('You do not have permission to create course modules.');
      return;
    }
    if (!newBlockTitle.trim()) return;
    const blockId = createEntityId('block');
    const newBlock: ContentItem = {
      id: blockId,
      courseId,
      category: 'admin',
      title: newBlockTitle.trim(),
      description: '',
      presentationSlot: 'block-header',
      groupIcon: `group:${blockId}`,
      createdAt: Date.now()
    };
    setIsAddingBlock(true);
    setAddBlockError(null);
    try {
      await addContentItem(newBlock);
      setAddBlockVisible(false);
      setNewBlockTitle('');
    } catch (error) {
      setAddBlockError(error instanceof Error ? error.message : 'The module could not be created.');
    } finally {
      setIsAddingBlock(false);
    }
  };

  const renderChildItem = (child: ContentItem) => (
    <View key={child.id} style={[styles.childItem, { borderBottomColor: colors.border }]}> 
      <View style={{ flex: 1, paddingRight: 10 }}>
        <Text style={{ color: colors.text, fontWeight: 'bold' }}>{child.title}</Text>
        <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{child.category}</Text>
      </View>
      {canManageContent && (
        <View style={styles.childActions}>
          {child.category === 'coursework' ? (
            <>
              {(child.isPopQuiz || child.isPoll) && canHostLive && (
                <TouchableOpacity
                  disabled={mutationBusy}
                  onPress={() => openPopQuizHost(child)}
                  accessibilityRole="button"
                  accessibilityLabel={`${child.isPoll ? 'Host poll' : 'Host pop quiz'} ${child.title}`}
                  accessibilityState={{ disabled: mutationBusy }}
                  style={styles.iconAction}
                >
                  <Ionicons name="flash-outline" size={18} color="#C56700" />
                </TouchableOpacity>
              )}
              <TouchableOpacity
                disabled={mutationBusy}
                onPress={() => openAssessmentBuilder(child)}
                accessibilityRole="button"
                accessibilityLabel={`Edit assessment ${child.title}`}
                accessibilityState={{ disabled: mutationBusy }}
                style={styles.iconAction}
              >
                <Ionicons name="construct-outline" size={18} color={colors.primary} />
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity
              disabled={mutationBusy}
              onPress={() => openEditModal(child)}
              accessibilityRole="button"
              accessibilityLabel={`Edit ${child.title}`}
              accessibilityState={{ disabled: mutationBusy }}
              style={styles.iconAction}
            >
              <Ionicons name="pencil-outline" size={18} color={colors.primary} />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            disabled={mutationBusy}
            onPress={() => deleteItemConfirm(child.id)}
            accessibilityRole="button"
            accessibilityLabel={`Delete ${child.title}`}
            accessibilityState={{ disabled: mutationBusy }}
            style={styles.iconAction}
          >
            <Ionicons name="trash-outline" size={18} color="#D32F2F" />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      {canManageContent && (
        <View style={[styles.toolbar, { borderColor: colors.border, backgroundColor: colors.card }]}> 
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text accessibilityRole="header" style={{ color: colors.text, fontWeight: 'bold', fontSize: 18 }}>Sequential modules</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>Items appear to learners in the module order shown below.</Text>
          </View>
          <TouchableOpacity
            disabled={mutationBusy}
            onPress={openRecentlyDeleted}
            accessibilityRole="button"
            accessibilityLabel={`Recently deleted${deletedContent.length ? `, ${deletedContent.length} item${deletedContent.length === 1 ? '' : 's'}` : ''}`}
            accessibilityState={{ disabled: mutationBusy }}
            style={[styles.deletedButton, { borderColor: colors.border, opacity: mutationBusy ? 0.5 : 1 }]}
          >
            <Ionicons name="trash-bin-outline" size={19} color={colors.textSecondary} />
            {!compactLayout && <Text style={{ color: colors.textSecondary, marginLeft: 6 }}>Recently Deleted</Text>}
          </TouchableOpacity>
        </View>
      )}

      <View>
        {blocks.map(block => {
          const children = block.groupIcon
            ? courseContent.filter(i => i.groupIcon === block.groupIcon && i.id !== block.id).sort(orderedContent)
            : [];
          
          return (
            <View key={block.id} style={[styles.blockContainer, { backgroundColor: colors.card, borderColor: colors.border }]}> 
              <View style={[styles.blockHeader, compactLayout && styles.compactBlockHeader, { borderBottomColor: colors.border }]}> 
                <View style={{ flex: 1 }}>
                  <Text accessibilityRole="header" style={[styles.blockTitle, { color: colors.text }]}>{block.title}</Text>
                  {block.availableDate ? (
                    <Text style={{ color: colors.primary, fontSize: 12 }}>Scheduled: {block.availableDate}</Text>
                  ) : (
                    <Text style={{ color: colors.textSecondary, fontSize: 12 }}>Available immediately</Text>
                  )}
                </View>
                {canManageContent && (
                  <View style={[styles.moduleActions, compactLayout && { marginTop: 10, alignSelf: 'stretch' }]}>
                    <TouchableOpacity 
                      disabled={mutationBusy}
                      style={[styles.scheduleBtn, { backgroundColor: colors.primary + '20', opacity: mutationBusy ? 0.5 : 1 }]} 
                      onPress={() => {
                        openScheduleBlock(block.id, block.availableDate || '');
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`Schedule ${block.title}`}
                      accessibilityState={{ disabled: mutationBusy }}
                    >
                      <Ionicons name="calendar-outline" size={16} color={colors.primary} style={{ marginRight: 5 }} />
                      <Text style={{ color: colors.primary, fontWeight: 'bold', fontSize: 12 }}>Schedule Module</Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                      disabled={mutationBusy}
                      style={[styles.iconAction, { marginLeft: 6, opacity: mutationBusy ? 0.5 : 1 }]}
                      onPress={() => deleteItemConfirm(block.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`Delete ${block.title}`}
                      accessibilityState={{ disabled: mutationBusy }}
                    >
                      <Ionicons name="trash-outline" size={18} color="#D32F2F" />
                    </TouchableOpacity>
                  </View>
                )}
              </View>

              <View style={styles.childrenContainer}>
                {children.length === 0 ? (
                  <Text style={{ color: colors.textSecondary, fontStyle: 'italic', marginBottom: 10 }}>No items in this block.</Text>
                ) : (
                  children.map(renderChildItem)
                )}

                {canManageContent && (
                  <View style={[styles.addContentButtons, compactLayout && styles.compactAddContentButtons]}>
                    <TouchableOpacity 
                      disabled={mutationBusy}
                      style={[styles.addContentBtn, { borderColor: colors.border, opacity: mutationBusy ? 0.5 : 1 }]} 
                      onPress={() => openAddModal('admin', block.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`Add admin content or announcement to ${block.title}`}
                      accessibilityState={{ disabled: mutationBusy }}
                    >
                      <Ionicons name="add" size={16} color={colors.textSecondary} />
                      <Text style={{ color: colors.textSecondary, marginLeft: 5 }}>Add Admin</Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                      disabled={mutationBusy}
                      style={[styles.addContentBtn, compactLayout ? { marginTop: 10 } : { marginLeft: 10 }, { borderColor: colors.border, opacity: mutationBusy ? 0.5 : 1 }]} 
                      onPress={() => openAddModal('material', block.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`Add material to ${block.title}`}
                      accessibilityState={{ disabled: mutationBusy }}
                    >
                      <Ionicons name="add" size={16} color={colors.textSecondary} />
                      <Text style={{ color: colors.textSecondary, marginLeft: 5 }}>Add Material</Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                      disabled={mutationBusy}
                      style={[styles.addContentBtn, compactLayout ? { marginTop: 10 } : { marginLeft: 10 }, { borderColor: colors.border, opacity: mutationBusy ? 0.5 : 1 }]} 
                      onPress={() => openAddModal('coursework', block.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`Add coursework to ${block.title}`}
                      accessibilityState={{ disabled: mutationBusy }}
                    >
                      <Ionicons name="add" size={16} color={colors.textSecondary} />
                      <Text style={{ color: colors.textSecondary, marginLeft: 5 }}>Add Coursework</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            </View>
          );
        })}

        {!!ungroupedItems.length && (
          <View style={[styles.blockContainer, { backgroundColor: colors.card, borderColor: colors.border }]}> 
            <View style={[styles.blockHeader, { borderBottomColor: colors.border }]}> 
              <View style={{ flex: 1 }}>
                <Text accessibilityRole="header" style={[styles.blockTitle, { color: colors.text }]}>Ungrouped content</Text>
                <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>These items appear after the configured modules until they are grouped or removed.</Text>
              </View>
            </View>
            <View style={styles.childrenContainer}>{ungroupedItems.map(renderChildItem)}</View>
          </View>
        )}

        {!blocks.length && !ungroupedItems.length && (
          <View style={[styles.emptyState, { borderColor: colors.border, backgroundColor: colors.card }]}> 
            <Ionicons name="albums-outline" size={30} color={colors.textSecondary} />
            <Text style={{ color: colors.textSecondary, marginTop: 8 }}>No sequential modules or course content yet.</Text>
          </View>
        )}

        {canManageContent && (
          <TouchableOpacity 
            disabled={mutationBusy}
            style={[styles.addBlockBtn, { backgroundColor: colors.primary + '20', borderColor: colors.primary, opacity: mutationBusy ? 0.5 : 1 }]} 
            onPress={() => setAddBlockVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="Add course module"
            accessibilityState={{ disabled: mutationBusy }}
          >
            <Ionicons name="add-circle-outline" size={24} color={colors.primary} />
            <Text style={{ color: colors.primary, fontSize: 16, fontWeight: 'bold', marginLeft: 10 }}>Add Block / Module</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Add Block Modal */}
      <Modal visible={addBlockVisible} transparent animationType="fade" onRequestClose={() => {
        if (!isAddingBlock) setAddBlockVisible(false);
      }}>
        <View style={styles.modalOverlay}>
          <View accessibilityViewIsModal style={[styles.modalContent, { backgroundColor: colors.card, borderColor: colors.border }]}> 
            <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 18, fontWeight: 'bold', marginBottom: 15 }}>New Module Block</Text>
            <TextInput 
              accessibilityLabel="Module title"
              style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.background }]}
              placeholder="Module Title (e.g. Week 1)"
              placeholderTextColor={colors.textSecondary}
              value={newBlockTitle}
              onChangeText={value => { setNewBlockTitle(value); setAddBlockError(null); }}
              maxLength={500}
            />
            {!!addBlockError && <Text accessibilityRole="alert" style={{ color: colors.error, marginTop: 10 }}>{addBlockError}</Text>}
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 20 }}>
              <TouchableOpacity style={{ padding: 10, marginRight: 10 }} disabled={isAddingBlock} onPress={() => setAddBlockVisible(false)} accessibilityRole="button" accessibilityLabel="Cancel new module" accessibilityState={{ disabled: isAddingBlock, busy: isAddingBlock }}>
                <Text style={{ color: colors.textSecondary }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ padding: 10, backgroundColor: colors.primary, borderRadius: 8, opacity: isAddingBlock || !newBlockTitle.trim() ? 0.5 : 1 }} disabled={isAddingBlock || !newBlockTitle.trim()} onPress={() => void handleAddBlock()} accessibilityRole="button" accessibilityLabel="Create course module" accessibilityState={{ disabled: isAddingBlock || !newBlockTitle.trim(), busy: isAddingBlock }}>
                <Text style={{ color: isAddingBlock || !newBlockTitle.trim() ? colors.textSecondary : colors.buttonText, fontWeight: 'bold' }}>{isAddingBlock ? 'Creating…' : 'Create'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 15 },
  toolbar: { minHeight: 64, flexDirection: 'row', alignItems: 'center', padding: 12, borderWidth: 1, borderRadius: 12, marginBottom: 16 },
  deletedButton: { minHeight: 44, paddingHorizontal: 10, borderWidth: 1, borderRadius: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  blockContainer: { borderWidth: 1, borderRadius: 12, marginBottom: 20, overflow: 'hidden' },
  blockHeader: { flexDirection: 'row', alignItems: 'center', padding: 15, borderBottomWidth: 1 },
  compactBlockHeader: { flexDirection: 'column', alignItems: 'stretch' },
  blockTitle: { fontSize: 18, fontWeight: 'bold' },
  moduleActions: { flexDirection: 'row', alignItems: 'center' },
  scheduleBtn: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  childrenContainer: { padding: 15 },
  childItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1 },
  childActions: { flexDirection: 'row', alignItems: 'center' },
  iconAction: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  addContentButtons: { flexDirection: 'row', marginTop: 15 },
  compactAddContentButtons: { flexDirection: 'column' },
  addContentBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderWidth: 1, borderRadius: 8, borderStyle: 'dashed' },
  addBlockBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 15, borderWidth: 1, borderRadius: 12, borderStyle: 'dashed' },
  emptyState: { padding: 30, borderWidth: 1, borderStyle: 'dashed', borderRadius: 12, alignItems: 'center', marginBottom: 20 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent: { width: '100%', maxWidth: 400, padding: 25, borderRadius: 16, borderWidth: 1 },
  input: { borderWidth: 1, padding: 12, borderRadius: 8 }
});
