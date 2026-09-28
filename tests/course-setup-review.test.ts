import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  buildCourseSetupPanelModel,
  buildCourseSetupReview,
  canViewCourseSetupReview,
  describeCourseSetupReview,
} from '../src/lib/courseSetupReview';
import { isRenderableCustomCoursePresentationItem } from '../src/lib/coursePresentation';
import { createInstitutionRepositoryFactory } from '../src/lib/integration/InstitutionRepositoryFactory';
import { ContentItem, Course, CourseRole } from '../src/types/lms';

const now = Date.parse('2026-09-15T12:00:00Z');

const item = (updates: Partial<ContentItem> = {}): ContentItem => ({
  id: 'item-1',
  courseId: 'course-1',
  category: 'material',
  title: 'Welcome material',
  presentationSlot: 'current',
  createdAt: now - 1_000,
  ...updates,
});

const course = (updates: Partial<Course> = {}): Course => ({
  id: 'course-1',
  title: 'Accessible Course Design',
  status: 'active',
  description: 'A course with an explicit purpose.',
  presentationMode: 'timeline',
  participantsCount: 1,
  materialsCount: 1,
  staff: [
    { id: 'teacher-1', name: 'Taylor Teacher', role: 'teacher' },
    { id: 'student-1', name: 'Sam Student', role: 'student' },
  ],
  announcements: [],
  termStart: now - 86_400_000,
  termEnd: now + 86_400_000,
  gradingWeights: {},
  visibilityTimer: 0,
  ...updates,
});

const codes = (review: NonNullable<ReturnType<typeof buildCourseSetupReview>>, severity: 'blockers' | 'warnings') =>
  review[severity].map(issue => issue.code);

test('course setup preflight is staff-only across every course role', () => {
  const expected: Record<CourseRole, boolean> = {
    student: false,
    ta: true,
    teacher: true,
    it: true,
    admin: true,
  };
  (Object.keys(expected) as CourseRole[]).forEach(role => {
    assert.equal(canViewCourseSetupReview(role), expected[role], role);
    assert.equal(buildCourseSetupReview(course(), [item()], role, now) !== null, expected[role], role);
  });
  assert.equal(buildCourseSetupReview(course(), [item()], null, now), null);
});

test('a coherent active course passes core learner readiness', () => {
  const review = buildCourseSetupReview(course(), [item()], 'teacher', now)!;
  assert.equal(review.phase, 'active');
  assert.equal(review.readyForLearners, true);
  assert.equal(review.readOnly, false);
  assert.equal(review.learnerContentCount, 1);
  assert.equal(review.availableContentCount, 1);
  assert.deepEqual(review.blockers, []);
  assert.deepEqual(review.warnings, []);
  assert.equal(review.checks.every(check => check.complete), true);
  assert.equal(describeCourseSetupReview(review).label, 'Ready for learners');
});

test('staff setup review blocks video release until captions and an adjacent transcript are supplied', () => {
  const video = item({
    id: 'video-1',
    title: 'Lecture video',
    metadata: {
      asset: {
        id: 'asset-video-1',
        name: 'lecture.mp4',
        mimeType: 'video/mp4',
        url: 'https://media.example.edu/lecture.mp4',
      },
    },
  });
  const missing = buildCourseSetupReview(course(), [video], 'teacher', now)!;
  assert.ok(codes(missing, 'blockers').includes('missing_video_captions'));
  assert.ok(codes(missing, 'blockers').includes('missing_video_transcript'));
  assert.equal(missing.checks.find(check => check.code === 'media-accessibility')?.complete, false);
  assert.equal(missing.readyForLearners, false);

  const complete = buildCourseSetupReview(course(), [{
    ...video,
    videoAlternatives: {
      captionTracks: [{ url: 'https://media.example.edu/lecture.vtt', language: 'en', label: 'English', format: 'text/vtt', isDefault: true }],
      transcript: { text: 'Speaker: Welcome to the lecture.' },
    },
  }], 'ta', now)!;
  assert.equal(complete.checks.find(check => check.code === 'media-accessibility')?.complete, true);
  assert.equal(codes(complete, 'blockers').includes('missing_video_captions'), false);
  assert.equal(codes(complete, 'blockers').includes('missing_video_transcript'), false);
  assert.ok(codes(complete, 'warnings').includes('verify_video_caption_sync'));
});

test('lifecycle boundaries distinguish future preparation from historical read-only courses', () => {
  const future = buildCourseSetupReview(course({ termStart: now + 1, termEnd: now + 10_000 }), [item()], 'teacher', now)!;
  assert.equal(future.phase, 'future');
  assert.equal(future.readyForLearners, true);
  assert.ok(codes(future, 'warnings').includes('future_course'));
  assert.equal(describeCourseSetupReview(future).tone, 'warning');

  const ended = buildCourseSetupReview(course({ termStart: now - 10_000, termEnd: now }), [item()], 'teacher', now)!;
  assert.equal(ended.phase, 'ended');
  assert.equal(ended.readOnly, true);
  assert.equal(ended.readyForLearners, false);
  assert.equal(describeCourseSetupReview(ended).label, 'Read-only course');

  const archived = buildCourseSetupReview(course({ status: 'past' }), [item()], 'it', now)!;
  assert.equal(archived.phase, 'archived');
  assert.equal(archived.readOnly, true);

  const invalid = buildCourseSetupReview(course({ termStart: now, termEnd: now }), [item()], 'admin', now)!;
  assert.equal(invalid.phase, 'invalid');
  assert.ok(codes(invalid, 'blockers').includes('invalid_term'));
});

test('snapshot drift, missing ownership, and empty content fail readiness closed', () => {
  const malformed = course({
    title: ' ',
    description: '',
    participantsCount: 4,
    materialsCount: 2,
    staff: [{ id: 'student-1', name: 'Sam Student', role: 'student' }],
  });
  const wrongCourseItem = item({ id: 'foreign', courseId: 'course-2' });
  const review = buildCourseSetupReview(malformed, [wrongCourseItem], 'admin', now)!;
  const blockerCodes = codes(review, 'blockers');
  assert.equal(review.readyForLearners, false);
  assert.ok(blockerCodes.includes('missing_title'));
  assert.ok(blockerCodes.includes('missing_course_manager'));
  assert.ok(blockerCodes.includes('missing_content_manager'));
  assert.ok(blockerCodes.includes('participant_count_mismatch'));
  assert.ok(blockerCodes.includes('cross_course_content'));
  assert.ok(blockerCodes.includes('empty_course'));
  assert.ok(codes(review, 'warnings').includes('missing_description'));
});

test('custom presentation readiness shares the learner renderer contract', () => {
  const emptyWidget = item({
    category: 'admin',
    description: JSON.stringify({ isCustomWidget: true, html: '', css: '' }),
    metadata: { lmsContentType: 'custom', lmsCustomWidgetKind: 'static' },
  });
  assert.equal(isRenderableCustomCoursePresentationItem(emptyWidget), false);
  const emptyReview = buildCourseSetupReview(course({ presentationMode: 'custom' }), [emptyWidget], 'teacher', now)!;
  assert.ok(codes(emptyReview, 'blockers').includes('empty_custom_presentation'));

  const staticWidget = item({
    category: 'admin',
    description: JSON.stringify({ isCustomWidget: true, html: '<section>Welcome</section>', css: '' }),
    metadata: { lmsContentType: 'custom', lmsCustomWidgetKind: 'static' },
  });
  assert.equal(isRenderableCustomCoursePresentationItem(staticWidget), true);
  assert.equal(buildCourseSetupReview(course({ presentationMode: 'custom' }), [staticWidget], 'teacher', now)!.readyForLearners, true);

  const linkedSite = item({
    category: 'admin',
    contentUrl: 'https://courses.example.edu/path',
    description: 'Embedded HTTPS course site',
    metadata: { lmsContentType: 'custom', lmsCustomWidgetKind: 'link' },
  });
  assert.equal(isRenderableCustomCoursePresentationItem(linkedSite), true);
  assert.equal(buildCourseSetupReview(course({ presentationMode: 'custom' }), [linkedSite], 'teacher', now)!.readyForLearners, true);

  assert.equal(isRenderableCustomCoursePresentationItem({ ...linkedSite, contentUrl: 'javascript:alert(1)' }), false);
});

test('schedule, grading, group, and active-availability edge cases remain actionable', () => {
  const malformed = item({
    category: 'coursework',
    title: 'Group assessment',
    presentationSlot: 'scheduled',
    availableDate: 'not-a-date',
    displayDate: 'also-not-a-date',
    isGraded: true,
    gradingCategory: 'Missing category',
    workType: 'group',
    groupSetId: 'missing-set',
  });
  const review = buildCourseSetupReview(course({ gradingWeights: { Assessments: 100 } }), [malformed], 'ta', now)!;
  const blockerCodes = codes(review, 'blockers');
  assert.ok(blockerCodes.includes('invalid_schedule'));
  assert.ok(blockerCodes.includes('invalid_available_date'));
  assert.ok(blockerCodes.includes('invalid_display_date'));
  assert.ok(blockerCodes.includes('missing_grading_category'));
  assert.ok(blockerCodes.includes('missing_assignment_groups'));
  assert.ok(blockerCodes.includes('no_available_content'));

  const futureItems = Array.from({ length: 12 }, (_, index) => item({
    id: `future-${index}`,
    presentationSlot: 'future',
  }));
  const futureReview = buildCourseSetupReview(course({ materialsCount: futureItems.length }), futureItems, 'teacher', now)!;
  const model = buildCourseSetupPanelModel(futureReview, 3);
  assert.equal(model.visibleIssues.length, 3);
  assert.equal(model.remainingIssueCount, futureReview.blockers.length + futureReview.warnings.length - 3);
  assert.match(model.toggleLabel, /^Course setup check:/);
});

test('institution repository rejects the same invalid term state before transport', async () => {
  const source = JSON.parse(await readFile(new URL('../docs/institution-sync.example.json', import.meta.url), 'utf8'));
  const entry = source.courses[0];
  const repositoryNow = Date.now();
  entry.course.status = 'active';
  entry.course.termStart = repositoryNow - 10_000;
  entry.course.termEnd = repositoryNow + 60_000;
  const actorId = entry.enrollments.find((enrollment: { courseRole: string }) => enrollment.courseRole === 'teacher')?.userId;
  assert.ok(actorId);
  const actor = source.users.find((candidate: { id: string }) => candidate.id === actorId);
  let pushes = 0;
  const factory = createInstitutionRepositoryFactory({
    initialSnapshot: source,
    adapter: {
      async pullSnapshot() { return source; },
      async pushMutations(mutations) {
        pushes += 1;
        return { acceptedIds: mutations.map(mutation => mutation.id), rejected: [] };
      },
    },
    getSessionUser: async () => ({
      id: actor.id,
      name: actor.name,
      email: actor.email,
      globalRole: actor.globalRole === 'admin' ? 'admin' : 'user',
    }),
  });
  const normalizedCourse = await factory.courses.getCourseDetails(entry.course.id);
  assert.ok(normalizedCourse);
  const normalizedItems = await factory.content.getContentItems(entry.course.id);
  const role = await factory.courses.getUserRoleForCourse(actor.id, entry.course.id);
  const clientReview = buildCourseSetupReview(
    { ...normalizedCourse, termEnd: normalizedCourse.termStart },
    normalizedItems,
    role,
    repositoryNow,
  )!;
  assert.ok(codes(clientReview, 'blockers').includes('invalid_term'));
  await assert.rejects(
    factory.courses.updateCourse(entry.course.id, { termEnd: normalizedCourse.termStart }),
    /Proposed course state is invalid|termEnd must be after termStart/,
  );
  assert.equal(pushes, 0);
});
