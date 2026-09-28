/**
 * @fileoverview src/app/admin/course/[id]/roster.tsx.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import React, { useRef, useState } from 'react';
import { ActivityIndicator, Modal, View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Platform, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useThemeColors } from '../../../../lib/useThemeColors';
import { useLMSStore } from '../../../../lib/store/useLMSStore';
import { CourseRole } from '../../../../types/lms';
import { hasCoursePermission } from '../../../../lib/authorization/coursePermissions';
import {
  COURSE_ROLE_LABELS,
  getAssignableCourseRoles,
  LAST_COURSE_MANAGER_ERROR,
  wouldRemoveLastCourseManager,
} from '../../../../lib/authorization/courseRoleManagement';

const ROSTER_FILTERS: (CourseRole | null)[] = [null, 'student', 'ta', 'teacher', 'it', 'admin'];

export default function CourseRosterAdmin() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const router = useRouter();
  const colors = useThemeColors();
  const { width: viewportWidth } = useWindowDimensions();
  const { courses, currentUserId, updateCourseUser } = useLMSStore();
  const course = courses.find(c => c.id === id);
  
  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState<CourseRole | null>(null);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [roleUpdateUserId, setRoleUpdateUserId] = useState<string | null>(null);
  const [roleUpdateTarget, setRoleUpdateTarget] = useState<CourseRole | null>(null);
  const [roleMutationError, setRoleMutationError] = useState<string | null>(null);
  const roleUpdateInFlightRef = useRef(false);
  const compactRoster = viewportWidth < 760;
  const returnToPreviousScreen = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/admin');
  };

  if (!course) {
    return (
      <View style={[styles.container, styles.center, { backgroundColor: colors.background }]}> 
        <Text accessibilityRole="alert" style={{ color: colors.error }}>Course not found.</Text>
        <TouchableOpacity onPress={returnToPreviousScreen} style={{ marginTop: 16 }} accessibilityRole="button" accessibilityLabel="Back to courses">
          <Text style={{ color: colors.primary }}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const currentMembership = course.staff.find(member => member.id === currentUserId);
  const effectiveRole = currentMembership?.role;
  if (!hasCoursePermission(effectiveRole, 'viewRoster')) {
    return (
      <View style={[styles.container, styles.center, { backgroundColor: colors.background }]}> 
        <Text accessibilityRole="alert" style={{ color: colors.error }}>You do not have permission to view the course roster.</Text>
        <TouchableOpacity onPress={returnToPreviousScreen} style={{ marginTop: 16 }} accessibilityRole="button" accessibilityLabel="Back to courses">
          <Text style={{ color: colors.primary }}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }
  const canManageCourse = hasCoursePermission(effectiveRole, 'manageCourse');
  const editingMember = course.staff.find(member => member.id === editingUserId);
  const assignableRoles = editingMember && effectiveRole && canManageCourse
    ? getAssignableCourseRoles(effectiveRole, editingMember.role)
    : [];
  const privilegedRoleIsReadOnly = Boolean(
    editingMember
    && effectiveRole !== 'admin'
    && (editingMember.role === 'it' || editingMember.role === 'admin'),
  );

  const closeRoleEditor = () => {
    if (roleUpdateInFlightRef.current) return;
    setEditingUserId(null);
    setRoleMutationError(null);
  };

  const changeRole = async (nextRole: CourseRole) => {
    if (!editingMember || !canManageCourse || roleUpdateInFlightRef.current) return;
    if (nextRole === editingMember.role) {
      closeRoleEditor();
      return;
    }
    if (wouldRemoveLastCourseManager(course.staff, currentUserId, editingMember.id, nextRole)) {
      setRoleMutationError(LAST_COURSE_MANAGER_ERROR);
      return;
    }

    roleUpdateInFlightRef.current = true;
    setRoleUpdateUserId(editingMember.id);
    setRoleUpdateTarget(nextRole);
    setRoleMutationError(null);
    try {
      await updateCourseUser(course.id, editingMember.id, { role: nextRole });
      setEditingUserId(null);
    } catch (error) {
      setRoleMutationError(error instanceof Error ? error.message : 'The participant role could not be saved.');
    } finally {
      roleUpdateInFlightRef.current = false;
      setRoleUpdateUserId(null);
      setRoleUpdateTarget(null);
    }
  };

  const filteredRoster = course.staff.filter(s => {
    const query = search.trim().toLocaleLowerCase();
    if (query && ![s.name, s.email, s.id].some(value => value?.toLocaleLowerCase().includes(query))) return false;
    if (filterRole && s.role !== filterRole) return false;
    return true;
  });

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 15 }}>
          <TouchableOpacity 
            onPress={returnToPreviousScreen} 
            style={{ marginRight: 15 }}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            accessibilityHint="Returns to the previous screen."
          >
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>Participant Roster</Text>
        </View>
        <Text style={{ color: colors.textSecondary, marginBottom: 15 }}>{course.title}</Text>
        
        <View style={[styles.searchRow, compactRoster && styles.compactSearchRow]}>
          <View style={[styles.searchBox, compactRoster && styles.compactSearchBox, { backgroundColor: colors.card, borderColor: colors.border }]}> 
            <Ionicons name="search" size={20} color={colors.textSecondary} style={{ marginRight: 10 }} />
            <TextInput 
              accessibilityLabel="Search participant roster"
              style={[styles.searchInput, { color: colors.text }]}
              placeholder="Search by name, email, or ID..."
              placeholderTextColor={colors.textSecondary}
              value={search}
              onChangeText={setSearch}
            />
          </View>
          <TouchableOpacity 
            style={[styles.filterBtn, { backgroundColor: colors.card, borderColor: colors.border }]} 
            onPress={() => {
              const nextIndex = (ROSTER_FILTERS.indexOf(filterRole) + 1) % ROSTER_FILTERS.length;
              setFilterRole(ROSTER_FILTERS[nextIndex]);
            }}
            accessibilityRole="button"
            accessibilityLabel={`Roster role filter: ${filterRole ? COURSE_ROLE_LABELS[filterRole] : 'All participants'}. Activate to select the next filter.`}
            accessibilityState={{ selected: filterRole !== null }}
          >
            <Ionicons name="filter" size={20} color={filterRole ? colors.primary : colors.textSecondary} />
            <Text style={{ color: filterRole ? colors.primary : colors.textSecondary, marginLeft: 5 }}>{filterRole ? filterRole.toUpperCase() : 'ALL'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Table Header */}
      {!compactRoster && (
        <View style={[styles.tableHeader, { borderBottomColor: colors.border, backgroundColor: colors.card }]}> 
          <Text style={[styles.th, { flex: 2, color: colors.textSecondary }]}>Name</Text>
          <Text style={[styles.th, { flex: 2, color: colors.textSecondary }]}>Email</Text>
          <Text style={[styles.th, { flex: 1, color: colors.textSecondary }]}>Primary Role</Text>
          <Text style={[styles.th, { flex: 2, color: colors.textSecondary }]}>Secondary Roles</Text>
          <Text style={[styles.th, { flex: 2, color: colors.textSecondary }]}>Assignment Groups</Text>
        </View>
      )}

      {/* Roster List */}
      <ScrollView keyboardShouldPersistTaps="handled" style={styles.list}>
        {filteredRoster.map(s => {
          const secondaryRoles = s.secondaryRoles ?? [];
          const assignmentGroups = (course.groupSets || []).flatMap(groupSet => groupSet.groups
            .filter(group => group.memberIds.includes(s.id))
            .map(group => `${groupSet.name}: ${group.name}`));
          const roleControl = canManageCourse ? (
            <TouchableOpacity
              disabled={roleUpdateUserId !== null}
              onPress={() => {
                setRoleMutationError(null);
                setEditingUserId(s.id);
              }}
              accessibilityRole="button"
              accessibilityLabel={`Change role for ${s.name}. Current role: ${COURSE_ROLE_LABELS[s.role]}.`}
              accessibilityHint="Opens a list of course roles."
              accessibilityState={{ disabled: roleUpdateUserId !== null, busy: roleUpdateUserId === s.id }}
              style={[
                styles.roleBadge,
                { backgroundColor: s.role === 'ta' ? '#FF980020' : colors.primary + '20', opacity: roleUpdateUserId !== null && roleUpdateUserId !== s.id ? 0.5 : 1 },
              ]}
            >
              {roleUpdateUserId === s.id ? (
                <View style={styles.pendingRole}>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text style={[styles.roleBadgeText, { color: colors.primary }]}>Saving…</Text>
                </View>
              ) : (
                <View style={styles.pendingRole}>
                  <Text numberOfLines={1} style={[styles.roleBadgeText, { color: s.role === 'ta' ? '#C56700' : colors.primary }]}>{s.role.toUpperCase()}</Text>
                  <Ionicons name="chevron-down" size={12} color={s.role === 'ta' ? '#C56700' : colors.primary} />
                </View>
              )}
            </TouchableOpacity>
          ) : (
            <View style={[styles.roleBadge, { backgroundColor: s.role === 'ta' ? '#FF980020' : colors.primary + '20' }]}> 
              <Text numberOfLines={1} style={[styles.roleBadgeText, { color: s.role === 'ta' ? '#C56700' : colors.primary }]}>{s.role.toUpperCase()}</Text>
            </View>
          );
          const secondaryRoleBadges = secondaryRoles.length ? secondaryRoles.map(sr => (
            <View key={sr} style={[styles.secRoleBadge, { backgroundColor: colors.border }]}>
              <Text style={{ color: colors.text, fontSize: 10 }}>{sr}</Text>
            </View>
          )) : <Text style={{ color: colors.textSecondary, fontSize: 12 }}>None</Text>;
          const assignmentGroupBadges = assignmentGroups.length ? assignmentGroups.map(group => (
            <View key={group} style={[styles.secRoleBadge, { backgroundColor: `${colors.primary}20` }]}>
              <Text style={{ color: colors.text, fontSize: 10 }}>{group}</Text>
            </View>
          )) : <Text style={{ color: colors.textSecondary, fontSize: 12 }}>None</Text>;

          if (compactRoster) {
            return (
              <View key={s.id} accessibilityLabel={`${s.name}, ${COURSE_ROLE_LABELS[s.role]}`} style={[styles.compactCard, { borderColor: colors.border, backgroundColor: colors.card }]}> 
                <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 17, fontWeight: 'bold' }}>{s.name}</Text>
                <Text style={{ color: colors.textSecondary, marginTop: 3 }}>{s.email || 'Email not disclosed'}</Text>
                <View style={styles.compactField}>
                  <Text style={[styles.compactLabel, { color: colors.textSecondary }]}>Primary role</Text>
                  {roleControl}
                </View>
                <View style={styles.compactField}>
                  <Text style={[styles.compactLabel, { color: colors.textSecondary }]}>Secondary roles</Text>
                  <View style={styles.compactBadges}>{secondaryRoleBadges}</View>
                </View>
                <View style={styles.compactField}>
                  <Text style={[styles.compactLabel, { color: colors.textSecondary }]}>Assignment groups</Text>
                  <View style={styles.compactBadges}>{assignmentGroupBadges}</View>
                </View>
              </View>
            );
          }
          return (
            <View 
              key={s.id} 
              style={[styles.row, { borderBottomColor: colors.border }]}
            >
              <Text style={[styles.td, { flex: 2, color: colors.text, fontWeight: 'bold' }]}>{s.name}</Text>
              <Text style={[styles.td, { flex: 2, color: colors.textSecondary }]}>{s.email || 'Not disclosed'}</Text>
              <View style={{ flex: 1, justifyContent: 'center' }}>{roleControl}</View>
              <View style={{ flex: 2, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>
                {secondaryRoleBadges}
              </View>
              <View style={{ flex: 2, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>
                {assignmentGroupBadges}
              </View>
            </View>
          );
        })}
        {filteredRoster.length === 0 && <Text style={{ color: colors.textSecondary, padding: 20, textAlign: 'center' }}>No roster members match this filter.</Text>}
      </ScrollView>

      <Modal
        visible={Boolean(editingMember)}
        transparent
        animationType="fade"
        onRequestClose={closeRoleEditor}
      >
        <View style={styles.modalOverlay}>
          <View
            accessibilityViewIsModal
            style={[styles.roleDialog, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Text accessibilityRole="header" style={[styles.roleDialogTitle, { color: colors.text }]}>Change course role</Text>
            <Text style={[styles.roleDialogSubtitle, { color: colors.textSecondary }]}>Select a role for {editingMember?.name}. Changes save immediately.</Text>

            {!!roleMutationError && (
              <Text accessibilityRole="alert" style={[styles.roleError, { color: colors.error, borderColor: colors.error }]}>{roleMutationError}</Text>
            )}

            {privilegedRoleIsReadOnly && (
              <Text style={[styles.managerNotice, { color: colors.textSecondary, marginBottom: 12 }]}>Only course administrators can change IT or Administrator memberships. This privileged role is shown read-only.</Text>
            )}

            <View accessibilityRole="radiogroup" accessibilityLabel={`Course role for ${editingMember?.name || 'participant'}`}>
              {assignableRoles.map(role => {
                const isSelected = editingMember?.role === role;
                const removesLastManager = Boolean(editingMember && wouldRemoveLastCourseManager(
                  course.staff,
                  currentUserId,
                  editingMember.id,
                  role,
                ));
                const isDisabled = roleUpdateUserId !== null || removesLastManager;
                return (
                  <TouchableOpacity
                    key={role}
                    disabled={isDisabled}
                    onPress={() => void changeRole(role)}
                    accessibilityRole="radio"
                    accessibilityLabel={COURSE_ROLE_LABELS[role]}
                    accessibilityHint={removesLastManager ? LAST_COURSE_MANAGER_ERROR : 'Saves this participant role.'}
                    accessibilityState={{ checked: isSelected, disabled: isDisabled, busy: roleUpdateUserId === editingMember?.id && roleUpdateTarget === role }}
                    style={[
                      styles.roleOption,
                      {
                        borderColor: isSelected ? colors.primary : colors.border,
                        backgroundColor: isSelected ? `${colors.primary}15` : colors.background,
                        opacity: isDisabled ? 0.5 : 1,
                      },
                    ]}
                  >
                    <Ionicons name={isSelected ? 'radio-button-on' : 'radio-button-off'} size={22} color={isSelected ? colors.primary : colors.textSecondary} />
                    <Text style={[styles.roleOptionText, { color: colors.text }]}>{COURSE_ROLE_LABELS[role]}</Text>
                    {roleUpdateUserId === editingMember?.id && roleUpdateTarget === role && <ActivityIndicator size="small" color={colors.primary} />}
                  </TouchableOpacity>
                );
              })}
            </View>

            {editingMember && assignableRoles.some(role => wouldRemoveLastCourseManager(course.staff, currentUserId, editingMember.id, role)) && (
              <Text style={[styles.managerNotice, { color: colors.textSecondary }]}>{LAST_COURSE_MANAGER_ERROR}</Text>
            )}

            <TouchableOpacity
              disabled={roleUpdateUserId !== null}
              onPress={closeRoleEditor}
              accessibilityRole="button"
              accessibilityLabel="Cancel role change"
              accessibilityState={{ disabled: roleUpdateUserId !== null }}
              style={[styles.cancelButton, { borderColor: colors.border, opacity: roleUpdateUserId !== null ? 0.5 : 1 }]}
            >
              <Text style={{ color: colors.text, fontWeight: 'bold' }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { padding: 20, paddingTop: Platform.OS === 'ios' ? 60 : 30, borderBottomWidth: 1 },
  title: { fontSize: 24, fontWeight: 'bold' },
  searchRow: { flexDirection: 'row', alignItems: 'center' },
  compactSearchRow: { flexDirection: 'column', alignItems: 'stretch' },
  searchBox: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, paddingVertical: 10, borderRadius: 12, borderWidth: 1, marginRight: 10 },
  compactSearchBox: { marginRight: 0, marginBottom: 10 },
  searchInput: { flex: 1, fontSize: 16 },
  filterBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, paddingVertical: 10, borderRadius: 12, borderWidth: 1 },
  tableHeader: { flexDirection: 'row', padding: 15, borderBottomWidth: 1 },
  th: { fontWeight: 'bold' },
  list: { flex: 1 },
  row: { flexDirection: 'row', padding: 15, borderBottomWidth: 1 },
  compactCard: { marginHorizontal: 12, marginTop: 12, padding: 15, borderWidth: 1, borderRadius: 12 },
  compactField: { marginTop: 14 },
  compactLabel: { fontSize: 12, fontWeight: 'bold', marginBottom: 6 },
  compactBadges: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  td: { fontSize: 14, justifyContent: 'center', display: 'flex' },
  roleBadge: { minHeight: 32, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 12, alignSelf: 'flex-start', justifyContent: 'center' },
  roleBadgeText: { fontSize: 11, fontWeight: 'bold' },
  pendingRole: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  secRoleBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, marginRight: 5, marginBottom: 5 },
  center: { justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalOverlay: { flex: 1, padding: 20, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  roleDialog: { width: '100%', maxWidth: 440, borderWidth: 1, borderRadius: 16, padding: 20 },
  roleDialogTitle: { fontSize: 21, fontWeight: 'bold' },
  roleDialogSubtitle: { marginTop: 6, marginBottom: 16, lineHeight: 20 },
  roleError: { borderWidth: 1, borderRadius: 8, padding: 10, marginBottom: 12 },
  roleOption: { minHeight: 48, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, marginBottom: 8, flexDirection: 'row', alignItems: 'center' },
  roleOptionText: { flex: 1, marginLeft: 10, fontSize: 16, fontWeight: '600' },
  managerNotice: { marginTop: 4, lineHeight: 18 },
  cancelButton: { minHeight: 44, marginTop: 16, borderWidth: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
