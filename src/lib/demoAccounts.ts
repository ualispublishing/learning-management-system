/**
 * @fileoverview src/lib/demoAccounts.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import type { CourseRole } from '../types/lms';

export type DemoAccountGroup = 'learners' | 'instruction' | 'administration';

export interface DemoAccount {
  id: string;
  label: string;
  name: string;
  email: string;
  role: CourseRole;
  group: DemoAccountGroup;
  summary: string;
}

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  { id: 'u3', label: 'Student A', name: 'Alice Student', email: 'alice@example.invalid', role: 'student', group: 'learners', summary: 'Learner in Project Group A.' },
  { id: 'u4', label: 'Student B', name: 'Bob Student', email: 'bob@example.invalid', role: 'student', group: 'learners', summary: 'Learner in Project Group A.' },
  { id: 'u5', label: 'Student C', name: 'Charlie Student', email: 'charlie@example.invalid', role: 'student', group: 'learners', summary: 'Learner outside Project Group A.' },
  { id: 'u2', label: 'TA', name: 'John Doe', email: 'john@example.invalid', role: 'ta', group: 'instruction', summary: 'Teaching assistant with content, grading, and moderation access.' },
  { id: 'u1', label: 'Teacher', name: 'Dr. Smith', email: 'smith@example.invalid', role: 'teacher', group: 'instruction', summary: 'Course instructor with teaching and course-management access.' },
  { id: 'u6', label: 'IT', name: 'Riley IT', email: 'riley.it@example.invalid', role: 'it', group: 'administration', summary: 'Technical administrator for configuration and roster support.' },
  { id: 'u7', label: 'Admin', name: 'Avery Administrator', email: 'avery.admin@example.invalid', role: 'admin', group: 'administration', summary: 'Course administrator with the complete course-scoped capability set.' },
] as const;

export const DEMO_ACCOUNT_GROUPS: readonly { id: DemoAccountGroup; title: string; description: string }[] = [
  { id: 'learners', title: 'Learners', description: 'Test coursework, grades, private groups, direct messages, and study tools.' },
  { id: 'instruction', title: 'Instructional staff', description: 'Test teaching, grading, content, announcements, and moderation.' },
  { id: 'administration', title: 'Administration', description: 'Test IT boundaries and the full administrator journey.' },
] as const;

export interface RoleOnboardingModel {
  title: string;
  summary: string;
  steps: readonly { title: string; body: string }[];
  boundary: string;
}

const ROLE_ONBOARDING: Record<CourseRole, RoleOnboardingModel> = {
  student: {
    title: 'Welcome to your learner workspace',
    summary: 'Courses, assignments, study decks, grades, and conversations are organized around your enrolled identity.',
    steps: [
      { title: 'Start with Courses', body: 'Open a course to review its syllabus, released materials, assessments, and your own grades.' },
      { title: 'Practice in Learn', body: 'Use flashcards and review queues; your study history stays isolated from other signed-in demo users.' },
      { title: 'Collaborate in Chat', body: 'Use course topics, your assigned private groups, and two-person direct messages.' },
    ],
    boundary: 'Learners never receive authoring, roster, grading, moderation, analytics, or course-configuration controls.',
  },
  ta: {
    title: 'Welcome to the teaching-assistant workspace',
    summary: 'Support course delivery without receiving unrestricted course-administration authority.',
    steps: [
      { title: 'Prepare course content', body: 'Create and organize instructional content and assessments within active course policy.' },
      { title: 'Support and grade learners', body: 'Review submissions, host live activities, and respond in course conversations.' },
      { title: 'Moderate responsibly', body: 'Use staff chat controls while preserving authorship and private-group boundaries.' },
    ],
    boundary: 'Teaching assistants cannot change course settings or grant privileged IT and Administrator roles.',
  },
  teacher: {
    title: 'Welcome to the instructor workspace',
    summary: 'Manage teaching, content, assessment, communication, analytics, and the ordinary course roster.',
    steps: [
      { title: 'Review course readiness', body: 'Use Courses to check structure, schedules, accessibility, and learner availability before release.' },
      { title: 'Teach and assess', body: 'Publish content, host live activities, grade submissions, and release feedback deliberately.' },
      { title: 'Communicate with context', body: 'Create topics and announcements that remain linked to the correct course audience.' },
    ],
    boundary: 'Instructors cannot silently grant or remove protected IT and Administrator memberships.',
  },
  it: {
    title: 'Welcome to the IT support workspace',
    summary: 'Maintain course configuration and roster integrity without entering instructional or grading workflows.',
    steps: [
      { title: 'Check configuration', body: 'Use Course Settings to verify presentation, integrations, dates, and technical readiness.' },
      { title: 'Support the roster', body: 'Resolve enrollment and permitted role issues without exposing unrelated learner work.' },
      { title: 'Escalate instructional changes', body: 'Coordinate with teaching staff for content, assessment, grading, analytics, and live delivery.' },
    ],
    boundary: 'IT cannot author instructional content, grade work, view teaching analytics, or host assessments.',
  },
  admin: {
    title: 'Welcome to course administration',
    summary: 'You can exercise the complete course-scoped workflow while every action remains tied to explicit course membership.',
    steps: [
      { title: 'Verify setup first', body: 'Review course settings, presentation, dates, integrations, accessibility, and readiness before publishing.' },
      { title: 'Manage people and delivery', body: 'Use the roster, content tools, grading, analytics, announcements, and live-session controls.' },
      { title: 'Validate another user', body: 'Keep a learner or staff session open beside this one to confirm visibility and permission changes.' },
    ],
    boundary: 'Administrator access is course-scoped; a global claim alone never grants access to an unenrolled course.',
  },
};

export const getRoleOnboarding = (role: CourseRole): RoleOnboardingModel => ROLE_ONBOARDING[role];

export const roleOnboardingStorageKey = (principalId: string, role: CourseRole) =>
  `@lms_role_onboarding:v1:${encodeURIComponent(principalId)}:${role}`;
