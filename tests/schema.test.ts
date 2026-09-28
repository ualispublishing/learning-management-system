import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeNormalizedInstitutionSync, validateInstitutionSync } from '../src/lib/schema/CourseSchema';

const makePayload = () => ({
  schemaVersion: '1.0',
  syncId: 'sync-001',
  generatedAt: Date.UTC(2026, 6, 19),
  mode: 'snapshot',
  institution: { id: 'inst-1', name: 'Example University', timeZone: 'America/Toronto' },
  users: [
    { id: 'teacher-1', name: 'Ada Teacher', email: 'ada@example.edu', role: 'teacher' },
    { id: 'student-1', name: 'Sam Student', email: 'sam@example.edu', role: 'student' },
  ],
  courses: [{
    course: {
      id: 'course-1',
      title: 'Production LMS 101',
      status: 'active',
      description: 'A validated example course.',
      presentationMode: 'timeline',
      termStart: Date.UTC(2026, 7, 1),
      termEnd: Date.UTC(2026, 11, 15),
      gradingWeights: { Assessments: 100 },
      visibilityTimer: 24,
      announcements: [],
    },
    enrollments: [
      { userId: 'teacher-1', courseRole: 'teacher' },
      { userId: 'student-1', courseRole: 'student' },
    ],
    items: [{
      id: 'quiz-1',
      category: 'coursework',
      title: 'Checkpoint',
      presentationSlot: 'current',
      createdAt: Date.UTC(2026, 7, 2),
      isGraded: true,
      questions: [{
        id: 'q-1',
        label: '1',
        content: 'Choose A.',
        answerType: 'multiple_choice',
        options: ['A', 'B'],
        correctAnswer: 'A',
        points: 10,
      }],
      quizConfig: { questionsPerPage: 'all', maxAttempts: 2, allowRevisit: true },
    }],
  }],
  threads: [{
    id: 'dm-1',
    title: 'Ada and Sam',
    isAnnouncement: false,
    createdAt: Date.UTC(2026, 7, 2),
    scope: 'direct',
    participantIds: ['teacher-1', 'student-1'],
    createdBy: 'teacher-1',
  }],
  messages: [{
    id: 'message-1',
    threadId: 'dm-1',
    senderId: 'student-1',
    senderName: 'Sam Student',
    role: 'student',
    text: 'Could you clarify question one?',
    timestamp: Date.UTC(2026, 7, 2, 1),
    readBy: 1,
    readByUserIds: ['student-1'],
  }],
  submissions: [{
    id: 'submission-1',
    studentId: 'student-1',
    contentItemId: 'quiz-1',
    courseId: 'course-1',
    submittedAt: Date.UTC(2026, 7, 3),
    status: 'submitted',
    responses: [{ questionId: 'q-1', answer: 'A', score: 10 }],
    totalScore: 10,
    attemptNumber: 1,
    revision: 1,
  }],
});

test('institution snapshot normalizes valid cross-referenced data atomically', () => {
  const result = validateInstitutionSync(makePayload());
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.data.courses[0].course.participantsCount, 1);
  assert.equal(result.data.courses[0].course.materialsCount, 1);
  assert.equal(result.data.courses[0].course.timeZone, 'America/Toronto');
  assert.equal(result.data.messages?.[0].threadId, 'dm-1');
});

test('institution schema accepts bounded video alternatives while preserving legacy video items', () => {
  const payload: any = makePayload();
  payload.submissions = [];
  payload.courses[0].items[0] = {
    id: 'video-1',
    category: 'material',
    title: 'Lecture video',
    presentationSlot: 'current',
    createdAt: Date.UTC(2026, 7, 2),
    metadata: {
      asset: {
        id: 'asset-video-1',
        name: 'lecture.mp4',
        mimeType: 'VIDEO/MP4',
        url: 'https://media.example.edu/lecture.mp4',
      },
    },
    videoAlternatives: {
      captionTracks: [{
        url: 'https://media.example.edu/lecture-en.vtt',
        language: 'en-CA',
        label: 'English captions',
        format: 'text/vtt',
        isDefault: true,
      }],
      transcript: { text: 'Speaker: Welcome.', label: 'Transcript' },
    },
  };
  const result = validateInstitutionSync(payload);
  assert.equal(result.success, true, result.success ? '' : result.issues.map(issue => `${issue.code}: ${issue.message}`).join('\n'));
  if (!result.success) return;
  assert.equal(result.data.courses[0].items[0].videoAlternatives?.captionTracks?.[0].format, 'text/vtt');

  delete payload.courses[0].items[0].videoAlternatives;
  assert.equal(validateInstitutionSync(payload).success, true, 'Legacy videos remain importable so staff can remediate them in setup review.');
});

test('institution schema rejects unsafe video alternatives and alternatives attached without a video asset', () => {
  const base: any = makePayload();
  base.submissions = [];
  base.courses[0].items[0] = {
    id: 'video-1',
    category: 'material',
    title: 'Lecture video',
    presentationSlot: 'current',
    createdAt: Date.UTC(2026, 7, 2),
    metadata: { asset: { id: 'asset-1', name: 'lecture.mp4', mimeType: 'video/mp4', url: 'https://media.example.edu/lecture.mp4' } },
    videoAlternatives: {
      captionTracks: [{ url: 'http://media.example.edu/lecture.vtt', language: 'en', label: 'English', format: 'text/vtt' }],
      transcript: { url: 'https://media.example.edu/transcript.html' },
    },
  };
  const unsafe = validateInstitutionSync(base);
  assert.equal(unsafe.success, false);
  if (!unsafe.success) assert.ok(unsafe.issues.some(issue => issue.code === 'unsafe_video_caption_url'));

  base.courses[0].items[0].videoAlternatives.captionTracks[0].url = 'https://tracking.example.net/lecture.vtt';
  const crossOrigin = validateInstitutionSync(base);
  assert.equal(crossOrigin.success, false);
  if (!crossOrigin.success) assert.ok(crossOrigin.issues.some(issue => issue.code === 'cross_origin_video_caption_url'));

  base.courses[0].items[0].videoAlternatives.captionTracks[0].url = 'https://media.example.edu/lecture.vtt';
  base.courses[0].items[0].metadata.asset.mimeType = 'application/pdf';
  const wrongAsset = validateInstitutionSync(base);
  assert.equal(wrongAsset.success, false);
  if (!wrongAsset.success) assert.ok(wrongAsset.issues.some(issue => issue.code === 'video_alternatives_without_video'));
});

test('historical submissions and course-message roles survive a later participant promotion', () => {
  const payload: any = makePayload();
  payload.courses[0].enrollments[1].courseRole = 'ta';
  Object.assign(payload.threads[0], {
    scope: 'course',
    courseId: 'course-1',
    title: 'Course discussion',
    createdBy: 'teacher-1',
  });
  const result = validateInstitutionSync(payload);
  assert.equal(result.success, true, result.success ? '' : result.issues.map(issue => `${issue.code}: ${issue.message}`).join('\n'));
  if (!result.success) return;
  assert.equal(result.data.courses[0].course.staff.find(member => member.id === 'student-1')?.role, 'ta');
  assert.equal(result.data.messages?.[0].role, 'student');
  assert.equal(result.data.submissions?.[0].studentId, 'student-1');
});

test('integration descriptors support partial providers and directories without email addresses', () => {
  const payload: any = makePayload();
  delete (payload.users[1] as { email?: string }).email;
  payload.integrations = [{
    id: 'district-oneroster',
    kind: 'oneroster',
    displayName: 'District OneRoster',
    version: '1.2',
    capabilities: ['courses.read', 'roster.read', 'content.read', 'submissions.read', 'grades.read', 'grades.write', 'chat.read'],
  }];
  const result = validateInstitutionSync(payload);
  assert.equal(result.success, true, result.success ? 'Payload is valid.' : result.issues.map(issue => issue.message).join('\n'));
  if (!result.success) return;
  assert.equal(result.data.users[1].email, undefined);
  assert.deepEqual(result.data.integrations?.[0].capabilities, ['courses.read', 'roster.read', 'content.read', 'submissions.read', 'grades.read', 'grades.write', 'chat.read']);
});

test('integration descriptors reject unknown capabilities instead of silently over-promising support', () => {
  const payload: any = makePayload();
  payload.integrations = [{
    id: 'unknown-provider',
    kind: 'custom',
    displayName: 'Unknown provider',
    capabilities: ['attendance.write'],
  }];
  const result = validateInstitutionSync(payload);
  assert.equal(result.success, false);
  if (result.success) return;
  assert.ok(result.issues.some(issue => issue.code === 'unknown_integration_capability'));
});

test('cursor tombstones reconcile remote removals atomically and reject orphaned state', () => {
  const snapshot = validateInstitutionSync(makePayload());
  assert.equal(snapshot.success, true);
  if (!snapshot.success) return;
  const baseUpsert = {
    schemaVersion: '1.0',
    syncId: 'sync-002',
    generatedAt: Date.UTC(2026, 6, 20),
    mode: 'upsert',
    institution: { id: 'inst-1', name: 'Example University', timeZone: 'America/Toronto' },
    users: [],
    courses: [],
  };
  const orphaning = validateInstitutionSync({
    ...baseUpsert,
    deletions: { threads: ['dm-1'] },
  }, snapshot.data);
  assert.equal(orphaning.success, false);
  if (!orphaning.success) assert.ok(orphaning.issues.some(issue => issue.code === 'effective_unknown_thread'));

  const removal = validateInstitutionSync({
    ...baseUpsert,
    deletions: {
      courses: ['course-1'],
      threads: ['dm-1'],
      messages: ['message-1'],
      submissions: ['submission-1'],
    },
  }, snapshot.data);
  assert.equal(removal.success, true, removal.success ? 'Removal is valid.' : removal.issues.map(issue => issue.message).join('\n'));
  if (!removal.success) return;
  const effective = mergeNormalizedInstitutionSync(snapshot.data, removal.data);
  assert.equal(effective.courses.length, 0);
  assert.equal(effective.threads?.length, 0);
  assert.equal(effective.messages?.length, 0);
  assert.equal(effective.submissions?.length, 0);
});

test('an atomic upsert cannot update and tombstone the same entity', () => {
  const snapshot = validateInstitutionSync(makePayload());
  assert.equal(snapshot.success, true);
  if (!snapshot.success) return;
  const message = makePayload().messages[0];
  const result = validateInstitutionSync({
    schemaVersion: '1.0',
    syncId: 'sync-conflict',
    generatedAt: Date.UTC(2026, 6, 20),
    mode: 'upsert',
    institution: { id: 'inst-1', name: 'Example University', timeZone: 'America/Toronto' },
    users: [],
    courses: [],
    messages: [message],
    deletions: { messages: [message.id] },
  }, snapshot.data);
  assert.equal(result.success, false);
  if (result.success) return;
  assert.ok(result.issues.some(issue => issue.code === 'upsert_delete_conflict'));
});

test('institution content and assessment questions require stable backend IDs', () => {
  const withoutItemId = makePayload();
  delete (withoutItemId.courses[0].items[0] as { id?: string }).id;
  const itemResult = validateInstitutionSync(withoutItemId);
  assert.equal(itemResult.success, false);
  assert.ok(itemResult.issues.some(issue => issue.path === 'courses[0].items[0].id'));

  const withoutQuestionId = makePayload();
  delete (withoutQuestionId.courses[0].items[0].questions[0] as { id?: string }).id;
  const questionResult = validateInstitutionSync(withoutQuestionId);
  assert.equal(questionResult.success, false);
  assert.ok(questionResult.issues.some(issue => issue.path === 'courses[0].items[0].questions[0].id'));
});

test('institution snapshot rejects unknown references and duplicate ids', () => {
  const payload = makePayload();
  payload.users.push({ ...payload.users[1] });
  payload.messages[0].threadId = 'missing-thread';
  const result = validateInstitutionSync(payload);
  assert.equal(result.success, false);
  if (result.success) return;
  assert.ok(result.issues.some(issue => issue.code === 'duplicate_user_id'));
  assert.ok(result.issues.some(issue => issue.code === 'unknown_thread'));
});

test('institution JSON rejects duplicate array values instead of silently dropping them', () => {
  const payload = makePayload();
  payload.courses[0].items[0].questions[0].options = ['A', 'A'];
  const result = validateInstitutionSync(payload);
  assert.equal(result.success, false);
  if (result.success) return;
  assert.ok(result.issues.some(issue => issue.code === 'duplicate_array_value'));
});

test('institution snapshot rejects insecure and incomplete external URLs', () => {
  const payload = makePayload();
  Object.assign(payload.courses[0].items[0], {
    contentUrl: 'http://insecure.example.edu/file.pdf',
    submissionTarget: 'external-link',
    externalUrl: 'javascript:alert(1)',
  });
  const result = validateInstitutionSync(payload);
  assert.equal(result.success, false);
  if (result.success) return;
  assert.ok(result.issues.some(issue => issue.code === 'unsafe_content_url'));
  assert.ok(result.issues.some(issue => issue.code === 'unsafe_external_url'));

  const credentialed = makePayload();
  Object.assign(credentialed.courses[0].items[0], { contentUrl: 'https://user:password@files.example.edu/private.pdf' });
  const credentialedResult = validateInstitutionSync(credentialed);
  assert.equal(credentialedResult.success, false);
  assert.ok(credentialedResult.issues.some(issue => issue.code === 'unsafe_content_url'));
});

test('institution identifiers reject control characters before they reach URLs or headers', () => {
  const payload = makePayload() as any;
  payload.courses[0].items[0].questions[0].id = 'question\nheader';
  payload.submissions[0].responses[0].questionId = 'question\nheader';
  payload.cursor = 'cursor\nheader';
  payload.etag = 'etag\rheader';
  const result = validateInstitutionSync(payload);
  assert.equal(result.success, false);
  if (result.success) return;
  assert.ok(result.issues.some(issue => issue.code === 'invalid_identifier'));
  assert.equal(result.issues.filter(issue => issue.code === 'invalid_sync_token').length, 2);
});

test('submitted attempts must include every assessment response', () => {
  const payload = makePayload();
  payload.submissions[0].responses = [];
  const result = validateInstitutionSync(payload);
  assert.equal(result.success, false);
  if (result.success) return;
  assert.ok(result.issues.some(issue => issue.code === 'missing_question_response'));
});

test('institution scheduling rejects invalid time zones, negative timestamps, and reversed terms', () => {
  const payload = makePayload();
  payload.institution.timeZone = 'Mars/Olympus_Mons';
  payload.generatedAt = -1;
  payload.courses[0].course.termStart = Date.UTC(2026, 11, 16);
  payload.courses[0].course.termEnd = Date.UTC(2026, 11, 15);
  const result = validateInstitutionSync(payload);
  assert.equal(result.success, false);
  if (result.success) return;
  assert.ok(result.issues.some(issue => issue.code === 'invalid_time_zone'));
  assert.ok(result.issues.some(issue => issue.code === 'invalid_timestamp' && issue.path === 'generatedAt'));
  assert.ok(result.issues.some(issue => issue.code === 'invalid_term_range'));
});

test('institution data cannot release an ungraded submission', () => {
  const payload = makePayload();
  Object.assign(payload.submissions[0], { gradeStatus: 'released' });
  const result = validateInstitutionSync(payload);
  assert.equal(result.success, false);
  if (result.success) return;
  assert.ok(result.issues.some(issue => issue.code === 'released_ungraded_submission'));
});

test('imported assessments retain semantic validation while permitting server-only answer keys', () => {
  const payload = makePayload();
  payload.courses[0].items[0].questions[0].options = ['Answer', ' answer '];
  delete (payload.courses[0].items[0].questions[0] as { correctAnswer?: string }).correctAnswer;
  const result = validateInstitutionSync(payload);
  assert.equal(result.success, false);
  if (result.success) return;
  assert.ok(result.issues.some(issue => issue.code === 'duplicate_options'));
  assert.ok(result.issues.some(issue => issue.code === 'server_graded_answer_redacted' && issue.severity === 'warning'));
});

test('student-safe assessments can omit answer keys for authoritative server grading', () => {
  const payload = makePayload();
  delete (payload.courses[0].items[0].questions[0] as { correctAnswer?: string }).correctAnswer;
  const result = validateInstitutionSync(payload);
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.ok(result.issues.some(issue => issue.code === 'server_graded_answer_redacted'));
});

test('institution course settings reject ambiguous grade labels and invalid visibility timers', () => {
  const payload = makePayload();
  (payload.courses[0].course as { gradingWeights: Record<string, number> }).gradingWeights = { Exams: 50, ' exams ': 50 };
  payload.courses[0].course.visibilityTimer = 1.5;
  const result = validateInstitutionSync(payload);
  assert.equal(result.success, false);
  if (result.success) return;
  assert.ok(result.issues.some(issue => issue.code === 'duplicate_grading_label'));
  assert.ok(result.issues.some(issue => issue.code === 'invalid_visibility_timer'));
});

test('discarded submissions require a deletion timestamp for recovery enforcement', () => {
  const payload = makePayload();
  payload.submissions[0].status = 'discarded';
  const result = validateInstitutionSync(payload);
  assert.equal(result.success, false);
  if (result.success) return;
  assert.ok(result.issues.some(issue => issue.code === 'discarded_without_timestamp'));
});

test('institution content scheduling fails closed on invalid or ambiguous date-times', () => {
  const payload = makePayload();
  Object.assign(payload.courses[0].items[0], {
    presentationSlot: 'scheduled',
    availableDate: '2026-02-31 11:59 PM',
    displayDate: '2026-09-01',
  });
  const result = validateInstitutionSync(payload);
  assert.equal(result.success, false);
  if (result.success) return;
  assert.ok(result.issues.some(issue => issue.code === 'invalid_content_datetime'));
  assert.ok(result.issues.some(issue => issue.code === 'scheduled_without_available_date'));

  const deviceLocal = makePayload();
  Object.assign(deviceLocal.courses[0].items[0], {
    presentationSlot: 'scheduled',
    availableDate: '2026-09-01 09:00 AM',
  });
  const deviceLocalResult = validateInstitutionSync(deviceLocal);
  assert.equal(deviceLocalResult.success, false);
  assert.ok(deviceLocalResult.issues.some(issue => issue.code === 'invalid_content_datetime'));
});

test('graded content must map to a configured grading category', () => {
  const payload = makePayload();
  (payload.courses[0].course as { gradingWeights: Record<string, number> }).gradingWeights = { Exams: 60, Assignments: 40 };
  const result = validateInstitutionSync(payload);
  assert.equal(result.success, false);
  if (result.success) return;
  assert.ok(result.issues.some(issue => issue.code === 'missing_grading_category'));
});

test('chat messages cannot impersonate access to a restricted course thread', () => {
  const payload = makePayload();
  Object.assign(payload.threads[0], { scope: 'course', courseId: 'course-1', isAnnouncement: true, isLocked: true });
  const result = validateInstitutionSync(payload);
  assert.equal(result.success, false);
  if (result.success) return;
  assert.ok(result.issues.some(issue => issue.code === 'restricted_thread_message'));
});

test('submissions enforce enrollment, work type, and grading authority cross-references', () => {
  const payload = makePayload();
  payload.users.push({ id: 'outsider', name: 'Outside User', email: 'outside@example.edu', role: 'student' });
  Object.assign(payload.submissions[0], { studentId: 'outsider', groupId: 'Group A', status: 'graded', gradedBy: 'outsider', gradedAt: Date.UTC(2026, 7, 4) });
  const result = validateInstitutionSync(payload);
  assert.equal(result.success, false);
  if (result.success) return;
  assert.ok(result.issues.some(issue => issue.code === 'submission_student_not_enrolled'));
  assert.ok(result.issues.some(issue => issue.code === 'unexpected_submission_group'));
  assert.ok(result.issues.some(issue => issue.code === 'grader_not_authorized'));
});

test('first-class group sets separate sections from assignment membership', () => {
  const payload = makePayload() as any;
  payload.users[1].secondaryRoles = ['Section 01'];
  payload.courses[0].enrollments[1].secondaryRoles = ['Section 01'];
  payload.courses[0].course.groupSets = [{
    id: 'project-groups',
    name: 'Project Groups',
    groups: [{ id: 'project-a', name: 'Project A', memberIds: ['student-1'] }],
  }];
  payload.courses[0].items[0].workType = 'group';
  payload.courses[0].items[0].groupSetId = 'project-groups';
  payload.submissions[0].groupId = 'project-a';
  const result = validateInstitutionSync(payload);
  assert.equal(result.success, true, result.success ? '' : result.issues.map(issue => issue.message).join('\n'));

  payload.submissions[0].groupId = 'Section 01';
  const sectionAsGroup = validateInstitutionSync(payload);
  assert.equal(sectionAsGroup.success, false);
  if (!sectionAsGroup.success) assert.ok(sectionAsGroup.issues.some(issue => issue.code === 'submission_group_mismatch'));
});

test('group sets reject duplicate memberships and group coursework without a resolvable set', () => {
  const payload = makePayload() as any;
  payload.courses[0].course.groupSets = [{
    id: 'projects',
    name: 'Projects',
    groups: [
      { id: 'a', name: 'A', memberIds: ['student-1'] },
      { id: 'b', name: 'B', memberIds: ['student-1'] },
    ],
  }];
  payload.courses[0].items[0].workType = 'group';
  delete payload.courses[0].items[0].groupSetId;
  payload.submissions[0].groupId = 'a';
  const duplicate = validateInstitutionSync(payload);
  assert.equal(duplicate.success, false);
  if (!duplicate.success) assert.ok(duplicate.issues.some(issue => issue.code === 'duplicate_group_membership'));

  payload.courses[0].course.groupSets = [];
  const missing = validateInstitutionSync(payload);
  assert.equal(missing.success, false);
  if (!missing.success) assert.ok(missing.issues.some(issue => issue.code === 'missing_group_set'));
});

test('institution JSON rejects unsupported fields instead of silently discarding them', () => {
  const payload = makePayload() as any;
  payload.courses[0].items[0].institutionSpecificStatus = 'approved';
  const result = validateInstitutionSync(payload);
  assert.equal(result.success, false);
  if (result.success) return;
  assert.ok(result.issues.some(issue =>
    issue.code === 'unknown_field'
      && issue.path === 'courses[0].items[0].institutionSpecificStatus',
  ));
});

test('institution-specific JSON extensions are preserved under bounded metadata', () => {
  const payload = makePayload() as any;
  payload.institution.metadata = { sis: { source: 'banner', revision: 4 } };
  payload.users[0].metadata = { directory: { campus: 'north' } };
  payload.courses[0].course.metadata = { catalog: { subject: 'LMS' } };
  payload.courses[0].items[0].metadata = { outcomes: ['critical-thinking'] };
  const result = validateInstitutionSync(payload);
  assert.equal(result.success, true, result.success ? '' : result.issues.map(issue => issue.message).join('\n'));
  if (!result.success) return;
  assert.deepEqual(result.data.institution.metadata, payload.institution.metadata);
  assert.deepEqual(result.data.users[0].metadata, payload.users[0].metadata);
  assert.deepEqual(result.data.courses[0].course.metadata, payload.courses[0].course.metadata);
  assert.deepEqual(result.data.courses[0].items[0].metadata, payload.courses[0].items[0].metadata);
});

test('institution extension fields reject non-JSON values and unsafe keys', () => {
  const payload = makePayload() as any;
  payload.courses[0].items[0].metadata = { score: Number.NaN };
  payload.institution.metadata = JSON.parse('{"__proto__":{"polluted":true}}');
  const result = validateInstitutionSync(payload);
  assert.equal(result.success, false);
  if (result.success) return;
  assert.ok(result.issues.some(issue => issue.code === 'invalid_extension_number'));
  assert.ok(result.issues.some(issue => issue.code === 'unsafe_extension_key'));
});

test('content identifiers are institution-wide unique across courses', () => {
  const payload = makePayload() as any;
  const secondCourse = JSON.parse(JSON.stringify(payload.courses[0]));
  secondCourse.course.id = 'course-2';
  secondCourse.course.title = 'Production LMS 202';
  secondCourse.items[0].id = payload.courses[0].items[0].id;
  payload.courses.push(secondCourse);
  const result = validateInstitutionSync(payload);
  assert.equal(result.success, false);
  if (result.success) return;
  assert.ok(result.issues.some(issue => issue.code === 'duplicate_content_id'));
});

test('incremental sync cannot silently reassign immutable entity identities', () => {
  const initial = validateInstitutionSync(makePayload());
  assert.equal(initial.success, true);
  if (!initial.success) return;
  const payload = makePayload() as any;
  const upsert = {
    schemaVersion: payload.schemaVersion,
    syncId: 'identity-drift',
    generatedAt: payload.generatedAt + 1,
    mode: 'upsert',
    institution: payload.institution,
    threads: [{ ...payload.threads[0], createdAt: payload.threads[0].createdAt + 1 }],
    messages: [{
      ...payload.messages[0],
      senderId: 'teacher-1',
      senderName: 'Ada Teacher',
      role: 'teacher',
    }],
    submissions: [{ ...payload.submissions[0], attemptNumber: 2 }],
  };
  const result = validateInstitutionSync(upsert, initial.data);
  assert.equal(result.success, false);
  if (result.success) return;
  assert.ok(result.issues.some(issue => issue.code === 'thread_identity_changed'));
  assert.ok(result.issues.some(issue => issue.code === 'message_identity_changed'));
  assert.ok(result.issues.some(issue => issue.code === 'submission_identity_changed'));
});

test('chat replies reject self references, cycles, and reply-target reassignment', () => {
  const selfReply = makePayload() as any;
  selfReply.messages[0].replyToMessageId = selfReply.messages[0].id;
  const selfResult = validateInstitutionSync(selfReply);
  assert.equal(selfResult.success, false);
  if (!selfResult.success) assert.ok(selfResult.issues.some(issue => issue.code === 'cyclic_message_reply'));

  const cyclic = makePayload() as any;
  cyclic.messages[0].replyToMessageId = 'message-2';
  cyclic.messages.push({
    ...cyclic.messages[0],
    id: 'message-2',
    replyToMessageId: cyclic.messages[0].id,
    timestamp: cyclic.messages[0].timestamp + 1,
  });
  const cyclicResult = validateInstitutionSync(cyclic);
  assert.equal(cyclicResult.success, false);
  if (!cyclicResult.success) assert.ok(cyclicResult.issues.some(issue => issue.code === 'cyclic_message_reply'));

  const initial = validateInstitutionSync(makePayload());
  assert.equal(initial.success, true);
  if (!initial.success) return;
  const payload = makePayload() as any;
  const reassigned = validateInstitutionSync({
    schemaVersion: '1.0',
    syncId: 'reply-reassignment',
    generatedAt: payload.generatedAt + 1,
    mode: 'upsert',
    institution: payload.institution,
    messages: [{ ...payload.messages[0], revision: 2, replyToMessageId: 'another-message' }],
  }, initial.data);
  assert.equal(reassigned.success, false);
  if (!reassigned.success) assert.ok(reassigned.issues.some(issue => issue.code === 'message_identity_changed'));
});

test('wrong-typed optional fields are rejected instead of normalized to defaults', () => {
  const payload = makePayload() as any;
  payload.courses[0].items[0].isGraded = 'true';
  payload.courses[0].items[0].questions[0].points = '10';
  payload.messages[0].readBy = '1';
  delete payload.submissions[0].responses[0].answer;
  const result = validateInstitutionSync(payload);
  assert.equal(result.success, false);
  if (result.success) return;
  assert.ok(result.issues.some(issue => issue.code === 'invalid_boolean' && issue.path.endsWith('.isGraded')));
  assert.ok(result.issues.some(issue => issue.code === 'invalid_number' && issue.path.endsWith('.points')));
  assert.ok(result.issues.some(issue => issue.code === 'invalid_number' && issue.path.endsWith('.readBy')));
  assert.ok(result.issues.some(issue => issue.code === 'missing_answer'));
});

test('principal-scoped chat summaries are bounded and internally complete', () => {
  const incomplete = makePayload() as any;
  incomplete.threads[0].unreadCount = -1;
  incomplete.threads[0].lastMessagePreview = 'Preview without a timestamp';
  const rejected = validateInstitutionSync(incomplete);
  assert.equal(rejected.success, false);
  if (!rejected.success) {
    assert.ok(rejected.issues.some(issue => issue.code === 'invalid_unread_count'));
    assert.ok(rejected.issues.some(issue => issue.code === 'incomplete_thread_summary'));
  }

  const valid = makePayload() as any;
  valid.threads[0].unreadCount = 2;
  valid.threads[0].lastMessagePreview = 'Latest bounded preview';
  valid.threads[0].lastMessageAt = valid.threads[0].updatedAt ?? valid.threads[0].createdAt;
  assert.equal(validateInstitutionSync(valid).success, true);
});

test('external-link grades may use an audited global score without synthetic response allocation', () => {
  const payload = makePayload() as any;
  Object.assign(payload.courses[0].items[0], {
    submissionTarget: 'external-link',
    externalUrl: 'https://assessment.example.edu/result/1',
  });
  Object.assign(payload.submissions[0], {
    status: 'graded',
    totalScore: 10,
    gradedBy: 'teacher-1',
    gradedAt: Date.UTC(2026, 7, 4),
    gradeStatus: 'released',
  });
  payload.submissions[0].responses[0].score = 0;
  const result = validateInstitutionSync(payload);
  assert.equal(result.success, true, result.success ? '' : result.issues.map(issue => issue.message).join('\n'));
});

test('external grade columns support a validated global maximum without synthetic questions', () => {
  const payload = makePayload() as any;
  Object.assign(payload.courses[0].items[0], {
    submissionTarget: 'external-link',
    externalUrl: 'https://assessment.example.edu/result/1',
    questions: undefined,
    metadata: { gradingMaxPoints: 100 },
  });
  Object.assign(payload.submissions[0], {
    responses: [],
    status: 'graded',
    totalScore: 75,
    gradedBy: 'teacher-1',
    gradedAt: Date.UTC(2026, 7, 4),
    gradeStatus: 'released',
  });
  const valid = validateInstitutionSync(payload);
  assert.equal(valid.success, true, valid.success ? '' : valid.issues.map(issue => issue.message).join('\n'));

  payload.submissions[0].totalScore = 101;
  const aboveMaximum = validateInstitutionSync(payload);
  assert.equal(aboveMaximum.success, false);
  if (!aboveMaximum.success) assert.ok(aboveMaximum.issues.some(issue => issue.code === 'score_above_maximum'));

  payload.submissions[0].totalScore = 75;
  payload.courses[0].items[0].metadata.gradingMaxPoints = '100';
  const malformedMaximum = validateInstitutionSync(payload);
  assert.equal(malformedMaximum.success, false);
  if (!malformedMaximum.success) assert.ok(malformedMaximum.issues.some(issue => issue.code === 'invalid_grading_maximum'));
});

test('learner-visible study cards are first-class content rather than redacted assessment keys', () => {
  const payload = makePayload() as any;
  payload.courses[0].items.push({
    id: 'study-set-1',
    category: 'material',
    title: 'Verified review cards',
    presentationSlot: 'current',
    createdAt: Date.UTC(2026, 7, 4),
    studyCards: [{
      id: 'card-1',
      front: 'What is a production invariant?',
      back: 'A condition that must remain true across every supported interaction.',
      tags: ['reliability'],
      sourceExcerpt: 'Production invariants must hold across every supported interaction.',
      sourceLocation: 'Course notes, page 2',
      confidence: 0.98,
      reviewerVerified: true,
    }],
  });
  const result = validateInstitutionSync(payload);
  assert.equal(result.success, true, result.success ? '' : result.issues.map(issue => issue.message).join('\n'));
  if (!result.success) return;
  assert.equal(result.data.courses[0].items[1].studyCards?.[0].back, 'A condition that must remain true across every supported interaction.');
});

test('study cards reject assessment mixing and malformed or oversized card data', () => {
  const payload = makePayload() as any;
  payload.courses[0].items[0].studyCards = [{
    id: 'card-1',
    front: 'x'.repeat(501),
    back: 'Answer',
    unsupported: true,
  }];
  const result = validateInstitutionSync(payload);
  assert.equal(result.success, false);
  if (result.success) return;
  assert.ok(result.issues.some(issue => issue.code === 'mixed_learning_interaction'));
  assert.ok(result.issues.some(issue => issue.code === 'invalid_study_card_item'));
  assert.ok(result.issues.some(issue => issue.code === 'study_card_front_too_long'));
  assert.ok(result.issues.some(issue => issue.code === 'unknown_field' && issue.path.endsWith('.unsupported')));
});

test('institution payload and assessment cardinality limits fail closed', () => {
  const oversized = makePayload();
  oversized.courses[0].course.description = 'x'.repeat(10 * 1024 * 1024);
  const oversizedResult = validateInstitutionSync(oversized);
  assert.equal(oversizedResult.success, false);
  if (!oversizedResult.success) assert.ok(oversizedResult.issues.some(issue => issue.code === 'payload_too_large'));

  const assessment = makePayload() as any;
  assessment.courses[0].items[0].questions[0].points = 1_000_001;
  assessment.courses[0].items[0].questions[0].options = Array.from({ length: 501 }, (_, index) => `Option ${index}`);
  const assessmentResult = validateInstitutionSync(assessment);
  assert.equal(assessmentResult.success, false);
  if (assessmentResult.success) return;
  assert.ok(assessmentResult.issues.some(issue => issue.code === 'points_too_large'));
  assert.ok(assessmentResult.issues.some(issue => issue.code === 'too_many_options'));
});

test('spectrum labels and submission display names remain authoritative', () => {
  const spectrumPayload = makePayload() as any;
  Object.assign(spectrumPayload.courses[0].items[0].questions[0], {
    answerType: 'spectrum',
    options: undefined,
    correctAnswer: undefined,
    customConfig: { min: 1, max: 5, valueLabels: { 1: 'Low', 6: 'Outside range', 2: 42 } },
  });
  spectrumPayload.submissions[0].responses[0].answer = 1;
  const spectrumResult = validateInstitutionSync(spectrumPayload);
  assert.equal(spectrumResult.success, false);
  if (!spectrumResult.success) {
    assert.ok(spectrumResult.issues.some(issue => issue.code === 'invalid_value_label_key'));
    assert.ok(spectrumResult.issues.some(issue => issue.code === 'invalid_value_label'));
  }

  const namePayload = makePayload() as any;
  namePayload.submissions[0].studentName = 'Another Learner';
  const nameResult = validateInstitutionSync(namePayload);
  assert.equal(nameResult.success, false);
  if (!nameResult.success) assert.ok(nameResult.issues.some(issue => issue.code === 'submission_name_mismatch'));
});

test('direct locks and out-of-group participant admissions are rejected', () => {
  const lockedDirect = makePayload() as any;
  lockedDirect.threads[0].isLocked = true;
  let result = validateInstitutionSync(lockedDirect);
  assert.equal(result.success, false);
  if (!result.success) assert.ok(result.issues.some(issue => issue.code === 'invalid_direct_lock'));

  const leakyGroup = makePayload() as any;
  leakyGroup.users.push({ id: 'student-2', name: 'Outside Student', role: 'student' });
  leakyGroup.courses[0].enrollments.push({ userId: 'student-2', courseRole: 'student' });
  leakyGroup.courses[0].course.groupSets = [{
    id: 'project-groups', name: 'Project Groups', groups: [{ id: 'group-a', name: 'Group A', memberIds: ['student-1'] }],
  }];
  leakyGroup.threads.push({
    id: 'group-a-thread', courseId: 'course-1', title: 'Private group', isAnnouncement: false,
    scope: 'group', groupSetId: 'project-groups', groupId: 'group-a', participantIds: ['student-1', 'student-2'],
    createdBy: 'teacher-1', createdAt: Date.UTC(2026, 7, 2),
  });
  result = validateInstitutionSync(leakyGroup);
  assert.equal(result.success, false);
  if (!result.success) assert.ok(result.issues.some(issue => issue.code === 'thread_participant_outside_group'));
});

test('deleted message snapshots are redacted and incremental sync cannot restore a tombstone', () => {
  const initial = validateInstitutionSync(makePayload());
  assert.equal(initial.success, true);
  if (!initial.success) return;
  const base = makePayload() as any;
  const deleted = validateInstitutionSync({
    schemaVersion: '1.0', syncId: 'message-delete', generatedAt: base.generatedAt + 1, mode: 'upsert',
    institution: base.institution,
    messages: [{
      ...base.messages[0], revision: 2, deletedAt: base.messages[0].timestamp + 1,
      text: 'Provider retained sensitive deleted text', mediaUrl: 'https://files.example.edu/secret.pdf',
      mediaType: 'document', mediaName: 'secret.pdf', mentionedUserIds: ['teacher-1'],
    }],
  }, initial.data);
  assert.equal(deleted.success, true, deleted.success ? '' : deleted.issues.map(issue => issue.message).join('\n'));
  if (!deleted.success) return;
  assert.equal(deleted.data.messages?.[0].text, '');
  assert.equal(deleted.data.messages?.[0].mediaUrl, undefined);
  assert.equal(deleted.data.messages?.[0].mediaName, undefined);
  assert.equal(deleted.data.messages?.[0].mentionedUserIds, undefined);

  const withTombstone = mergeNormalizedInstitutionSync(initial.data, deleted.data);
  const restored = validateInstitutionSync({
    schemaVersion: '1.0', syncId: 'message-restore', generatedAt: base.generatedAt + 2, mode: 'upsert',
    institution: base.institution,
    messages: [{ ...base.messages[0], revision: 3, text: 'Restored without an explicit recovery model' }],
  }, withTombstone);
  assert.equal(restored.success, false);
  if (!restored.success) assert.ok(restored.issues.some(issue => issue.code === 'message_tombstone_reversed'));
});
