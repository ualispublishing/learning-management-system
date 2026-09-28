import assert from 'node:assert/strict';
import test from 'node:test';
import { COURSE_PERMISSION_ROLES, hasCoursePermission } from '../src/lib/authorization/coursePermissions';
import { DemoAuthRepository } from '../src/lib/repositories/sqlite/AuthRepositoryImpl';
import { demoCourses } from '../src/lib/repositories/memory/demoData';
import { DEMO_ACCOUNTS } from '../src/lib/demoAccounts';
import { CourseRole } from '../src/types/lms';

const accounts = DEMO_ACCOUNTS;

test('every advertised role can authenticate into every demo course with authoritative identity', async () => {
  const auth = new DemoAuthRepository();
  for (const account of accounts) {
    const { user, defaultRole } = await auth.login(account.email);
    assert.equal(user.id, account.id);
    assert.equal(user.name, account.name);
    assert.equal(defaultRole, account.role);
    demoCourses.forEach(course => {
      assert.equal(course.staff.find(member => member.id === account.id)?.role, account.role);
    });
  }
  await assert.rejects(() => auth.login('missing@example.edu'), /No demo account/);
  await auth.logout();
  assert.equal(await auth.getCurrentUser(), null);
});

test('roleplay accounts expose exactly their centralized course capabilities', () => {
  const expected: Record<CourseRole, Array<keyof typeof COURSE_PERMISSION_ROLES>> = {
    student: [],
    ta: ['manageContent', 'grade', 'hostLiveAssessment', 'postStaffChat', 'moderateChat', 'manageChat', 'viewRoster', 'viewGradeAnalytics'],
    teacher: ['manageContent', 'grade', 'hostLiveAssessment', 'postStaffChat', 'moderateChat', 'manageChat', 'manageCourse', 'viewRoster', 'viewGradeAnalytics'],
    it: ['manageCourse', 'viewRoster'],
    admin: Object.keys(COURSE_PERMISSION_ROLES) as Array<keyof typeof COURSE_PERMISSION_ROLES>,
  };

  accounts.forEach(({ role }) => {
    const actual = (Object.keys(COURSE_PERMISSION_ROLES) as Array<keyof typeof COURSE_PERMISSION_ROLES>)
      .filter(permission => hasCoursePermission(role, permission));
    assert.deepEqual(actual.sort(), expected[role].sort(), role);
  });
});
