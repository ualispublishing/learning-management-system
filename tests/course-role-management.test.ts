import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getAssignableCourseRoles,
  wouldRemoveLastCourseManager,
} from '../src/lib/authorization/courseRoleManagement';
import { COURSE_PERMISSION_ROLES, hasCoursePermission } from '../src/lib/authorization/coursePermissions';
import { CourseUser } from '../src/types/lms';

const member = (id: string, role: CourseUser['role']): CourseUser => ({
  id,
  name: id,
  role,
});

test('course role choices expose instructional roles without granting privileged roles to teachers', () => {
  assert.deepEqual(getAssignableCourseRoles('teacher', 'student'), ['student', 'ta', 'teacher']);
  assert.deepEqual(getAssignableCourseRoles('teacher', 'it'), ['it']);
  assert.deepEqual(getAssignableCourseRoles('teacher', 'admin'), ['admin']);
  assert.deepEqual(getAssignableCourseRoles('it', 'student'), ['student', 'ta', 'teacher', 'it']);
  assert.deepEqual(getAssignableCourseRoles('it', 'admin'), ['admin']);
  assert.deepEqual(getAssignableCourseRoles('admin', 'student'), ['student', 'ta', 'teacher', 'it', 'admin']);
});

test('the only course manager cannot remove their own manager capability', () => {
  const roster = [member('manager', 'teacher'), member('learner', 'student')];

  assert.equal(wouldRemoveLastCourseManager(roster, 'manager', 'manager', 'student'), true);
  assert.equal(wouldRemoveLastCourseManager(roster, 'manager', 'manager', 'ta'), true);
  assert.equal(wouldRemoveLastCourseManager(roster, 'manager', 'manager', 'teacher'), false);
  assert.equal(wouldRemoveLastCourseManager(roster, 'manager', 'manager', 'it'), false);
  assert.equal(wouldRemoveLastCourseManager(roster, 'manager', 'learner', 'teacher'), false);
});

test('self-demotion is allowed when another course manager remains', () => {
  const roster = [member('manager', 'teacher'), member('other-manager', 'it'), member('learner', 'student')];
  assert.equal(wouldRemoveLastCourseManager(roster, 'manager', 'manager', 'student'), false);
});

test('course administration permissions preserve the intended student, TA, teacher, IT, and admin boundaries', () => {
  const expected = {
    student: [],
    ta: ['grade', 'hostLiveAssessment', 'manageChat', 'manageContent', 'moderateChat', 'postStaffChat', 'viewGradeAnalytics', 'viewRoster'],
    teacher: ['grade', 'hostLiveAssessment', 'manageChat', 'manageContent', 'manageCourse', 'moderateChat', 'postStaffChat', 'viewGradeAnalytics', 'viewRoster'],
    it: ['manageCourse', 'viewRoster'],
    admin: Object.keys(COURSE_PERMISSION_ROLES).sort(),
  } as const;

  (Object.keys(expected) as CourseUser['role'][]).forEach(role => {
    const actual = Object.keys(COURSE_PERMISSION_ROLES)
      .filter(permission => hasCoursePermission(role, permission as keyof typeof COURSE_PERMISSION_ROLES))
      .sort();
    assert.deepEqual(actual, [...expected[role]].sort(), `${role} permission matrix drifted`);
  });
});
