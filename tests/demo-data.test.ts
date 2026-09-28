import assert from 'node:assert/strict';
import test from 'node:test';
import { demoContentItems, demoCourses, demoMessages, demoThreads, demoUsers } from '../src/lib/repositories/memory/demoData';
import { demoSubmissions } from '../src/lib/repositories/sqlite/SubmissionRepositoryImpl';
import { validateInstitutionSync } from '../src/lib/schema/CourseSchema';

test('all bundled LMS demo data satisfies the production institution schema', () => {
  const result = validateInstitutionSync({
    schemaVersion: '1.0',
    syncId: 'bundled-demo-validation',
    generatedAt: Date.now(),
    mode: 'snapshot',
    institution: { id: 'demo', name: 'Bundled demo', timeZone: 'America/Toronto' },
    users: demoUsers,
    courses: demoCourses.map(course => ({
      course: {
        ...course,
        staff: undefined,
        participantsCount: undefined,
        materialsCount: undefined,
      },
      enrollments: course.staff.map(member => ({
        userId: member.id,
        courseRole: member.role,
        secondaryRoles: member.secondaryRoles,
      })),
      items: demoContentItems.filter(item => item.courseId === course.id),
    })),
    threads: demoThreads,
    messages: demoMessages,
    submissions: demoSubmissions,
  });
  assert.equal(result.success, true, result.success ? 'Demo data is valid.' : result.issues.map(issue => `${issue.path}: ${issue.message}`).join('\n'));
});

test('development fixtures expose every supported course role for acceptance testing', () => {
  const roles = new Set(demoUsers.map(user => user.role));
  assert.deepEqual([...roles].sort(), ['admin', 'it', 'student', 'ta', 'teacher']);
  demoCourses.forEach(course => {
    assert.deepEqual(
      [...new Set(course.staff.map(member => member.role))].sort(),
      ['admin', 'it', 'student', 'ta', 'teacher'],
      `${course.id} should support the full role matrix`,
    );
  });
});
