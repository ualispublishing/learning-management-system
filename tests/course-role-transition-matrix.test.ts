import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { COURSE_PERMISSION_ROLES, hasCoursePermission } from '../src/lib/authorization/coursePermissions';
import { getAssignableCourseRoles } from '../src/lib/authorization/courseRoleManagement';
import { createInstitutionRepositoryFactory } from '../src/lib/integration/InstitutionRepositoryFactory';
import type { CourseRole } from '../src/types/lms';

const roles: CourseRole[] = ['student', 'ta', 'teacher', 'it', 'admin'];
const courseManagers = new Set<CourseRole>(['teacher', 'it', 'admin']);

const expectedAssignableRoles = (
  managerRole: CourseRole,
  currentRole: CourseRole,
): CourseRole[] => {
  if (!courseManagers.has(managerRole)) return [];
  if (managerRole === 'teacher') {
    return currentRole === 'it' || currentRole === 'admin'
      ? [currentRole]
      : ['student', 'ta', 'teacher'];
  }
  if (managerRole === 'it') {
    return currentRole === 'admin'
      ? ['admin']
      : ['student', 'ta', 'teacher', 'it'];
  }
  return [...roles];
};

const redactLearnerSecrets = (source: any) => {
  source.courses.forEach((entry: any) => entry.items.forEach((item: any) => item.questions?.forEach((question: any) => {
    delete question.correctAnswer;
    if (question.customConfig) delete question.customConfig.testCases;
  })));
  source.submissions = [];
  source.threads = [];
  source.messages = [];
  return source;
};

const prepareRoleFixture = (
  serialized: string,
  managerRole: CourseRole,
  targetRole: CourseRole,
  lifecycle: 'future' | 'active' | 'ended' | 'archived' = 'active',
) => {
  const source = redactLearnerSecrets(JSON.parse(serialized));
  const now = Date.now();
  const course = source.courses[0].course;
  const manager = source.users.find((user: any) => user.id === 'teacher-100');
  const managerEnrollment = source.courses[0].enrollments.find((entry: any) => entry.userId === manager.id);
  manager.role = managerRole;
  managerEnrollment.courseRole = managerRole;
  source.users.push({ id: 'role-matrix-target', name: 'Role Matrix Target', role: targetRole });
  source.courses[0].enrollments.push({ userId: 'role-matrix-target', courseRole: targetRole });

  if (lifecycle === 'future') {
    Object.assign(course, { status: 'active', termStart: now + 60_000, termEnd: now + 120_000 });
  } else if (lifecycle === 'active') {
    Object.assign(course, { status: 'active', termStart: now - 60_000, termEnd: now + 60_000 });
  } else if (lifecycle === 'ended') {
    Object.assign(course, { status: 'active', termStart: now - 120_000, termEnd: now });
  } else {
    Object.assign(course, { status: 'past', termStart: now - 60_000, termEnd: now + 60_000 });
  }
  return source;
};

const createRoleFactory = (source: any, managerRole: CourseRole, onPush: () => void) =>
  createInstitutionRepositoryFactory({
    initialSnapshot: source,
    adapter: {
      async pullSnapshot() { return source; },
      async pushMutations(mutations) {
        onPush();
        return { acceptedIds: mutations.map(mutation => mutation.id), rejected: [] };
      },
    },
    getSessionUser: async () => ({
      id: 'teacher-100',
      name: 'Ada Teacher',
      email: 'ada.teacher@example.edu',
      globalRole: managerRole === 'admin' ? 'admin' : 'user',
    }),
  });

test('production roster authorization covers every manager × current role × next role transition', async () => {
  const serialized = await readFile(new URL('../docs/institution-sync.example.json', import.meta.url), 'utf8');
  let exercised = 0;

  for (const managerRole of roles) {
    for (const targetRole of roles) {
      for (const nextRole of roles) {
        const source = prepareRoleFixture(serialized, managerRole, targetRole);
        let pushes = 0;
        const factory = createRoleFactory(source, managerRole, () => { pushes += 1; });
        const expectedRoles = expectedAssignableRoles(managerRole, targetRole);
        const expected = expectedRoles.includes(nextRole);
        if (courseManagers.has(managerRole)) {
          assert.deepEqual(
            getAssignableCourseRoles(managerRole, targetRole),
            expectedRoles,
            `${managerRole}/${targetRole} assignable roles`,
          );
        }
        const update = () => factory.courses.updateCourseUser(
          'course-chem-101',
          'role-matrix-target',
          { role: nextRole },
        );

        if (expected) await update();
        else await assert.rejects(update, /permission|cannot grant/i, `${managerRole}/${targetRole}/${nextRole}`);

        assert.equal(pushes, expected ? 1 : 0, `${managerRole}/${targetRole}/${nextRole}`);
        const course = await factory.courses.getCourseDetails('course-chem-101');
        assert.equal(
          course?.staff.find(member => member.id === 'role-matrix-target')?.role,
          expected ? nextRole : targetRole,
          `${managerRole}/${targetRole}/${nextRole}`,
        );
        exercised += 1;
      }
    }
  }

  assert.equal(exercised, roles.length ** 3);
  assert.deepEqual([...COURSE_PERMISSION_ROLES.manageCourse], ['teacher', 'it', 'admin']);
  assert.deepEqual(roles.filter(role => hasCoursePermission(role, 'manageCourse')), [...courseManagers]);
});

test('roster writes allow future preparation and fail closed at ended and archived boundaries for every role', async () => {
  const serialized = await readFile(new URL('../docs/institution-sync.example.json', import.meta.url), 'utf8');
  const lifecycles = ['future', 'active', 'ended', 'archived'] as const;
  let exercised = 0;

  for (const managerRole of roles) {
    for (const lifecycle of lifecycles) {
      const source = prepareRoleFixture(serialized, managerRole, 'student', lifecycle);
      let pushes = 0;
      const factory = createRoleFactory(source, managerRole, () => { pushes += 1; });
      const expected = (lifecycle === 'future' || lifecycle === 'active')
        && expectedAssignableRoles(managerRole, 'student').includes('ta');
      const update = () => factory.courses.updateCourseUser(
        'course-chem-101',
        'role-matrix-target',
        { role: 'ta' },
      );

      if (expected) await update();
      else await assert.rejects(update, /permission|read-only/i, `${managerRole}/${lifecycle}`);
      assert.equal(pushes, expected ? 1 : 0, `${managerRole}/${lifecycle}`);
      exercised += 1;
    }
  }

  assert.equal(exercised, roles.length * lifecycles.length);
});
