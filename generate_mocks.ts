/**
 * Legacy fixture command retained as a safe validator.
 *
 * Demo term dates are normalized at runtime, so regenerating the checked-in
 * course JSON is no longer necessary.  The previous version of this script
 * silently overwrote the current fixtures with an obsolete two-role schema.
 * Running it now verifies the canonical fixtures without modifying them.
 */
import customCodeJson from './src/assets/mock-courses/custom_code.json';
import customLinkJson from './src/assets/mock-courses/custom_link.json';
import sequentialJson from './src/assets/mock-courses/sequential.json';
import timelineJson from './src/assets/mock-courses/timeline.json';
import usersJson from './src/assets/mock-institution/users.json';
import { CourseUser } from './src/types/lms';
import { formatValidationIssues, validateCourseImport } from './src/lib/schema/CourseSchema';

const users = usersJson as CourseUser[];
const fixtures: Array<[string, unknown]> = [
  ['timeline.json', timelineJson],
  ['sequential.json', sequentialJson],
  ['custom_link.json', customLinkJson],
  ['custom_code.json', customCodeJson],
];

for (const [filename, fixture] of fixtures) {
  // Match the demo repository import contract: legacy fixture items may omit
  // IDs because the normalizer assigns deterministic course-scoped IDs.
  const result = validateCourseImport(fixture, users, `fixtures.${filename}`);
  if (!result.success) {
    throw new Error(`Bundled fixture ${filename} is invalid:\n${formatValidationIssues(result.issues)}`);
  }

  const roles = new Set(result.data.course.staff.map(member => member.role));
  for (const role of ['student', 'ta', 'teacher', 'it', 'admin'] as const) {
    if (!roles.has(role)) {
      throw new Error(`Bundled fixture ${filename} has no ${role} enrollment for acceptance testing.`);
    }
  }
}

console.log(`Validated ${fixtures.length} bundled course fixtures without modifying them.`);
