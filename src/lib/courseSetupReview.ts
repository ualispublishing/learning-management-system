/**
 * @fileoverview src/lib/courseSetupReview.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import { ContentItem, Course, CourseRole } from '../types/lms';
import { hasCoursePermission } from './authorization/coursePermissions';
import { isContentLockedAt } from './contentAvailability';
import { parseContentDateTime } from './contentDateTime';
import { getCourseLifecyclePhase, CourseLifecyclePhase } from './courseLifecycle';
import { getCourseVideoAsset, isRenderableCustomCoursePresentationItem } from './coursePresentation';
import { areVideoCaptionTracksBoundToAsset, validateCourseVideoAlternatives } from './videoAlternatives';

export type CourseSetupIssueSeverity = 'blocker' | 'warning';

export interface CourseSetupIssue {
  code: string;
  severity: CourseSetupIssueSeverity;
  title: string;
  detail: string;
  itemId?: string;
}

export interface CourseSetupCheck {
  code: string;
  label: string;
  complete: boolean;
}

export interface CourseSetupReview {
  phase: CourseLifecyclePhase;
  readyForLearners: boolean;
  readOnly: boolean;
  learnerContentCount: number;
  availableContentCount: number;
  blockers: CourseSetupIssue[];
  warnings: CourseSetupIssue[];
  checks: CourseSetupCheck[];
}

export interface CourseSetupReviewSummary {
  label: string;
  detail: string;
  tone: 'success' | 'warning' | 'error' | 'neutral';
}

export interface CourseSetupPanelModel {
  summary: CourseSetupReviewSummary;
  visibleIssues: CourseSetupIssue[];
  remainingIssueCount: number;
  toggleLabel: string;
}

export const canViewCourseSetupReview = (role: CourseRole | null | undefined): boolean =>
  hasCoursePermission(role, 'manageCourse') || hasCoursePermission(role, 'manageContent');

const addIssue = (
  issues: CourseSetupIssue[],
  severity: CourseSetupIssueSeverity,
  code: string,
  title: string,
  detail: string,
  itemId?: string,
) => {
  if (issues.some(issue => issue.code === code && issue.itemId === itemId)) return;
  issues.push({ code, severity, title, detail, ...(itemId ? { itemId } : {}) });
};

const isContentManager = (role: CourseRole) => hasCoursePermission(role, 'manageContent');
const isCourseManager = (role: CourseRole) => hasCoursePermission(role, 'manageCourse');

/**
 * Staff-only, client-side preflight for configuration mistakes that can be
 * derived from the already-authorized course snapshot. It does not publish a
 * course or replace institution/server approval.
 */
export const buildCourseSetupReview = (
  course: Course,
  items: ContentItem[],
  role: CourseRole | null | undefined,
  now: number,
): CourseSetupReview | null => {
  if (!canViewCourseSetupReview(role)) return null;

  const blockers: CourseSetupIssue[] = [];
  const warnings: CourseSetupIssue[] = [];
  const allIssues = { blocker: blockers, warning: warnings } as const;
  const issue = (
    severity: CourseSetupIssueSeverity,
    code: string,
    title: string,
    detail: string,
    itemId?: string,
  ) => addIssue(allIssues[severity], severity, code, title, detail, itemId);

  const phase = getCourseLifecyclePhase(course, now);
  const validTermRange = Number.isFinite(course.termStart)
    && Number.isFinite(course.termEnd)
    && course.termStart < course.termEnd;
  if (!validTermRange || phase === 'invalid') {
    issue('blocker', 'invalid_term', 'Repair the course term', 'The start and end timestamps must be valid, and the end must be after the start.');
  } else if (phase === 'ended' || phase === 'archived') {
    issue('warning', 'read_only_course', 'Course is read-only', 'Ended and archived courses remain available for review but cannot receive setup or content changes.');
  } else if (phase === 'future') {
    issue('warning', 'future_course', 'Course has not started', 'Staff may continue preparing it; learners enter the course when the institution term begins.');
  }

  if (!course.title.trim()) {
    issue('blocker', 'missing_title', 'Add a course title', 'Learners and staff need a non-empty course title.');
  }
  if (!course.description.trim()) {
    issue('warning', 'missing_description', 'Add a course description', 'A short description helps learners confirm the course purpose and expectations.');
  }

  const courseManagers = course.staff.filter(member => isCourseManager(member.role));
  const contentManagers = course.staff.filter(member => isContentManager(member.role));
  const students = course.staff.filter(member => member.role === 'student');
  if (!courseManagers.length) {
    issue('blocker', 'missing_course_manager', 'Assign a course manager', 'At least one Teacher, IT, or Administrator must be able to maintain course settings and roster access.');
  }
  if (!contentManagers.length) {
    issue('blocker', 'missing_content_manager', 'Assign instructional staff', 'At least one Teacher, TA, or Administrator must be able to maintain learning content.');
  }
  if (!students.length) {
    issue('warning', 'empty_roster', 'No students are enrolled', 'The course can be prepared now, but no learner will receive its content.');
  }
  if (course.participantsCount !== students.length) {
    issue('blocker', 'participant_count_mismatch', 'Refresh the course roster', `The course reports ${course.participantsCount} students but its authorized roster contains ${students.length}.`);
  }

  const wrongCourseItems = items.filter(item => item.courseId !== course.id);
  if (wrongCourseItems.length) {
    issue('blocker', 'cross_course_content', 'Refresh course content', 'The loaded content set contains records owned by a different course.');
  }
  const courseItems = items.filter(item => item.courseId === course.id);
  const activeItems = courseItems.filter(item => !item.deletedAt);
  const learnerItems = activeItems.filter(item => item.presentationSlot !== 'block-header');
  const videoItems = learnerItems.filter(item => getCourseVideoAsset(item) !== null);
  let videosWithCompleteAlternatives = 0;
  const duplicateIds = new Set<string>();
  const seenIds = new Set<string>();
  activeItems.forEach(item => {
    if (seenIds.has(item.id)) duplicateIds.add(item.id);
    seenIds.add(item.id);
    if (!item.title.trim()) issue('blocker', 'untitled_content', 'Name every content item', 'An active learner-facing record has no title.', item.id);

    const availableAt = item.availableDate ? parseContentDateTime(item.availableDate) : undefined;
    const displayAt = item.displayDate ? parseContentDateTime(item.displayDate) : undefined;
    if (item.presentationSlot === 'scheduled' && availableAt === undefined) {
      issue('blocker', 'invalid_schedule', `Repair “${item.title || 'Untitled item'}”`, 'Scheduled content needs a valid institution time-zone release date.', item.id);
    }
    if (item.availableDate && availableAt === undefined) {
      issue('blocker', 'invalid_available_date', `Repair “${item.title || 'Untitled item'}”`, 'Its availability date is malformed and therefore fails closed.', item.id);
    }
    if (item.displayDate && displayAt === undefined) {
      issue('blocker', 'invalid_display_date', `Repair “${item.title || 'Untitled item'}”`, 'Its due/display date is malformed.', item.id);
    }
    if (availableAt !== undefined && displayAt !== undefined && displayAt < availableAt) {
      issue('blocker', 'display_before_release', `Repair “${item.title || 'Untitled item'}”`, 'Its due/display date is earlier than its availability date.', item.id);
    }
    if (item.releaseDate !== undefined && item.lockDate !== undefined && (
      !Number.isFinite(item.releaseDate)
      || !Number.isFinite(item.lockDate)
      || item.releaseDate >= item.lockDate
    )) {
      issue('blocker', 'invalid_release_window', `Repair “${item.title || 'Untitled item'}”`, 'Its release/lock window is invalid.', item.id);
    }
    if (availableAt !== undefined && validTermRange && availableAt >= course.termEnd) {
      issue('warning', 'release_after_term', `Review “${item.title || 'Untitled item'}”`, 'It is scheduled at or after the course ends, so learners will not receive it during the term.', item.id);
    }
    if (item.presentationSlot === 'future') {
      issue('warning', 'manual_future_release', `Release “${item.title || 'Untitled item'}” when ready`, 'Manual Future content stays hidden until staff change its presentation slot.', item.id);
    }

    if (item.isGraded && Object.keys(course.gradingWeights).length) {
      const matchedCategory = item.gradingCategory && Object.keys(course.gradingWeights)
        .some(category => category.toLocaleLowerCase() === item.gradingCategory?.toLocaleLowerCase());
      if (!matchedCategory) {
        issue('blocker', 'missing_grading_category', `Repair “${item.title || 'Untitled item'}”`, 'This graded item is not assigned to a valid grading category.', item.id);
      }
    }

    if (item.workType === 'group') {
      const groupSet = item.groupSetId
        ? course.groupSets?.find(candidate => candidate.id === item.groupSetId)
        : course.groupSets?.length === 1 ? course.groupSets[0] : undefined;
      if (!groupSet?.groups.length) {
        issue('blocker', 'missing_assignment_groups', `Repair “${item.title || 'Untitled item'}”`, 'Group coursework needs a non-empty assignment group set.', item.id);
      } else {
        const assigned = new Set(groupSet.groups.flatMap(group => group.memberIds));
        const unassignedCount = students.filter(student => !assigned.has(student.id)).length;
        if (unassignedCount) {
          issue('warning', 'unassigned_group_students', `Complete groups for “${item.title || 'Untitled item'}”`, `${unassignedCount} enrolled student${unassignedCount === 1 ? ' is' : 's are'} not assigned to this coursework’s group set.`, item.id);
        }
      }
    }

    const videoAsset = item.presentationSlot !== 'block-header' ? getCourseVideoAsset(item) : null;
    if (videoAsset) {
      const alternatives = validateCourseVideoAlternatives(item.videoAlternatives);
      if (!alternatives.success || !areVideoCaptionTracksBoundToAsset(alternatives.data, videoAsset.url)) {
        issue('blocker', 'invalid_video_alternatives', `Repair media alternatives for “${item.title || 'Untitled video'}”`, 'Its caption or transcript metadata is malformed and will fail closed for learners.', item.id);
      } else {
        const hasCaptions = Boolean(alternatives.data?.captionTracks?.length);
        const hasTranscript = Boolean(alternatives.data?.transcript?.text || alternatives.data?.transcript?.url);
        if (!hasCaptions) {
          issue('blocker', 'missing_video_captions', `Add captions for “${item.title || 'Untitled video'}”`, 'Supply at least one reviewed HTTPS WebVTT caption file and verify its timing before learner release.', item.id);
        }
        if (!hasTranscript) {
          issue('blocker', 'missing_video_transcript', `Add a transcript for “${item.title || 'Untitled video'}”`, 'Supply reviewed transcript text or an approved HTTPS transcript link adjacent to the video.', item.id);
        }
        if (hasCaptions && hasTranscript) {
          videosWithCompleteAlternatives += 1;
          issue('warning', 'verify_video_caption_sync', `Verify captions for “${item.title || 'Untitled video'}” on each target`, 'External WebVTT is selectable in the web player. Physical iOS and Android acceptance must verify accurate embedded video or HLS subtitle tracks; supplied metadata alone does not prove synchronization.', item.id);
        }
      }
    }
  });
  if (duplicateIds.size) {
    issue('blocker', 'duplicate_content_ids', 'Refresh course content', 'Active content identifiers must be unique before learners use the course.');
  }

  if (!learnerItems.length) {
    issue('blocker', 'empty_course', 'Add learner content', 'The course has no active learner-facing content.');
  }

  let presentationItems = learnerItems;
  if (course.presentationMode === 'custom') {
    presentationItems = learnerItems.filter(isRenderableCustomCoursePresentationItem);
    if (!presentationItems.length) {
      issue('blocker', 'empty_custom_presentation', 'Add a valid custom-course resource', 'Custom mode needs a non-empty static HTML/CSS widget or an approved HTTPS course site.');
    }
  }

  const readinessAt = phase === 'future' && validTermRange ? course.termStart : now;
  const availableContentCount = presentationItems.filter(item => !isContentLockedAt(item, readinessAt)).length;
  if (presentationItems.length && availableContentCount === 0) {
    issue(
      phase === 'active' ? 'blocker' : 'warning',
      'no_available_content',
      phase === 'active' ? 'Make at least one item available' : 'Review the opening release schedule',
      phase === 'active'
        ? 'The term is active, but every learner-facing item is locked.'
        : 'No learner-facing item will be available at the term start boundary.',
    );
  }

  const readOnly = phase === 'ended' || phase === 'archived' || phase === 'invalid' || !validTermRange;
  const readyForLearners = blockers.length === 0 && !readOnly;
  return {
    phase,
    readyForLearners,
    readOnly,
    learnerContentCount: presentationItems.length,
    availableContentCount,
    blockers,
    warnings,
    checks: [
      { code: 'term', label: 'Valid writable course term', complete: validTermRange && !readOnly },
      { code: 'ownership', label: 'Course and content managers assigned', complete: courseManagers.length > 0 && contentManagers.length > 0 },
      { code: 'content', label: 'Learner presentation contains content', complete: presentationItems.length > 0 },
      { code: 'availability', label: phase === 'future' ? 'Content available at term start' : 'Content currently available', complete: availableContentCount > 0 },
      { code: 'media-accessibility', label: 'Video caption files and transcripts supplied', complete: videosWithCompleteAlternatives === videoItems.length },
      { code: 'integrity', label: 'Roster count and content identities agree', complete: course.participantsCount === students.length && !duplicateIds.size && !wrongCourseItems.length },
    ],
  };
};

export const describeCourseSetupReview = (review: CourseSetupReview): CourseSetupReviewSummary => {
  if (review.readOnly) {
    return {
      label: 'Read-only course',
      detail: 'This course is ended, archived, or invalid. Review the findings without changing historical records.',
      tone: 'neutral',
    };
  }
  if (review.blockers.length) {
    return {
      label: `${review.blockers.length} setup blocker${review.blockers.length === 1 ? '' : 's'}`,
      detail: 'Resolve these items before learner access.',
      tone: 'error',
    };
  }
  if (review.warnings.length) {
    return {
      label: `Ready with ${review.warnings.length} warning${review.warnings.length === 1 ? '' : 's'}`,
      detail: review.phase === 'future' ? 'Core setup is ready for the scheduled term start.' : 'Core setup is ready; review the non-blocking findings.',
      tone: 'warning',
    };
  }
  return {
    label: review.phase === 'future' ? 'Ready for scheduled start' : 'Ready for learners',
    detail: 'The client-side course setup checks passed.',
    tone: 'success',
  };
};

/** Bounded view model so a malformed large snapshot cannot create an unbounded panel. */
export const buildCourseSetupPanelModel = (
  review: CourseSetupReview,
  issueLimit = 8,
): CourseSetupPanelModel => {
  const normalizedLimit = Number.isSafeInteger(issueLimit) ? Math.min(20, Math.max(1, issueLimit)) : 8;
  const issues = [...review.blockers, ...review.warnings];
  return {
    summary: describeCourseSetupReview(review),
    visibleIssues: issues.slice(0, normalizedLimit),
    remainingIssueCount: Math.max(0, issues.length - normalizedLimit),
    toggleLabel: `Course setup check: ${describeCourseSetupReview(review).label}`,
  };
};
