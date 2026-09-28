/**
 * @fileoverview src/lib/repositories/sqlite/CourseRepositoryImpl.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import { CourseRepository } from '../interfaces';
import { Course, CourseRole } from '../../../types/lms';
import { demoCourses, demoThreads, demoUsers } from '../memory/demoData';
import { getGroupFromSet } from '../../groups/courseGroups';
import { hasCoursePermission } from '../../authorization/coursePermissions';
import { projectCourseForPrincipal } from '../../privacy/principalDirectory';

const cloneJSON = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const cloneCourse = (course: Course): Course => ({
  ...course,
  staff: course.staff.map(user => ({
    ...user,
    secondaryRoles: user.secondaryRoles ? [...user.secondaryRoles] : undefined,
    metadata: user.metadata ? cloneJSON(user.metadata) : undefined,
  })),
  announcements: course.announcements.map(announcement => ({ ...announcement })),
  gradingWeights: { ...course.gradingWeights },
  groupSets: course.groupSets?.map(groupSet => ({
    ...groupSet,
    groups: groupSet.groups.map(group => ({ ...group, memberIds: [...group.memberIds] })),
  })),
  metadata: course.metadata ? cloneJSON(course.metadata) : undefined,
});


/** In-memory demo repository. Production deployments replace the factory adapter. */
export class DemoCourseRepository implements CourseRepository {
  async getCoursesForUser(userId: string): Promise<Course[]> {
    return demoCourses
      .filter(course => !userId || course.staff.some(user => user.id === userId))
      .map(course => cloneCourse(projectCourseForPrincipal(course, userId)));
  }

  async getCourseDetails(courseId: string): Promise<Course | null> {
    const course = demoCourses.find(candidate => candidate.id === courseId);
    return course ? cloneCourse(course) : null;
  }

  async getUserRoleForCourse(userId: string, courseId: string): Promise<CourseRole> {
    const course = demoCourses.find(candidate => candidate.id === courseId);
    const enrollment = course?.staff.find(user => user.id === userId);
    if (!course) throw new Error(`Course "${courseId}" was not found.`);
    if (!enrollment) throw new Error(`User "${userId}" is not enrolled in course "${courseId}".`);
    return enrollment.role;
  }

  async updateCourse(courseId: string, updates: Partial<Course>): Promise<void> {
    const index = demoCourses.findIndex(course => course.id === courseId);
    if (index < 0) throw new Error(`Course "${courseId}" was not found.`);
    demoCourses[index] = cloneCourse({ ...demoCourses[index], ...updates, id: courseId });
    if (Object.prototype.hasOwnProperty.call(updates, 'groupSets')) {
      const course = demoCourses[index];
      demoThreads.forEach(thread => {
        if (thread.courseId !== courseId || thread.scope !== 'group') return;
        const resolvedGroup = getGroupFromSet(course, thread.groupSetId, thread.groupId);
        const retainedStaff = (thread.participantIds ?? []).filter(userId => (
          hasCoursePermission(course.staff.find(member => member.id === userId)?.role, 'manageChat')
        ));
        const currentGroupMembers = (resolvedGroup?.memberIds ?? []).filter(userId => (
          course.staff.some(member => member.id === userId && member.role === 'student')
        ));
        const participantIds = Array.from(new Set([...retainedStaff, ...currentGroupMembers]));
        thread.participantIds = participantIds.length ? participantIds : undefined;
      });
    }
  }

  async addStudentByIdentifier(courseId: string, identifier: string) {
    const courseIndex = demoCourses.findIndex(course => course.id === courseId);
    if (courseIndex < 0) throw new Error(`Course "${courseId}" was not found.`);
    const normalizedIdentifier = identifier.trim();
    const normalizedEmail = normalizedIdentifier.toLocaleLowerCase();
    const user = demoUsers.find(candidate => candidate.id === normalizedIdentifier)
      || demoUsers.find(candidate => candidate.email?.toLocaleLowerCase() === normalizedEmail);
    if (!user) throw new Error('No demo directory user matches that institution ID or disclosed email address.');
    if (demoCourses[courseIndex].staff.some(member => member.id === user.id)) {
      throw new Error(`${user.email || user.name} is already enrolled in this course.`);
    }
    const student = { ...user, role: 'student' as const, secondaryRoles: undefined };
    demoCourses[courseIndex] = cloneCourse({
      ...demoCourses[courseIndex],
      staff: [...demoCourses[courseIndex].staff, student],
      participantsCount: demoCourses[courseIndex].participantsCount + 1,
    });
    return { ...student };
  }

  async updateCourseUser(courseId: string, userId: string, updates: Partial<import('../../../types/lms').CourseUser>): Promise<void> {
    const courseIndex = demoCourses.findIndex(course => course.id === courseId);
    if (courseIndex < 0) throw new Error(`Course "${courseId}" was not found.`);
    const userIndex = demoCourses[courseIndex].staff.findIndex(user => user.id === userId);
    if (userIndex < 0) throw new Error(`User "${userId}" is not enrolled in this course.`);
    const staff = demoCourses[courseIndex].staff.map(user => user.id === userId ? { ...user, ...updates, id: userId } : user);
    const nextRole = updates.role ?? demoCourses[courseIndex].staff[userIndex].role;
    const groupSets = nextRole === 'student' ? demoCourses[courseIndex].groupSets : demoCourses[courseIndex].groupSets?.map(groupSet => ({
      ...groupSet,
      groups: groupSet.groups.map(group => ({ ...group, memberIds: group.memberIds.filter(memberId => memberId !== userId) })),
    }));
    demoCourses[courseIndex] = cloneCourse({ ...demoCourses[courseIndex], staff, groupSets });
    demoThreads.forEach(thread => {
      if (thread.courseId !== courseId || thread.scope !== 'group' || !thread.participantIds?.includes(userId)) return;
      const group = getGroupFromSet(demoCourses[courseIndex], thread.groupSetId, thread.groupId);
      const retainsAccess = hasCoursePermission(nextRole, 'manageChat') || group?.memberIds.includes(userId) === true;
      if (!retainsAccess) thread.participantIds = thread.participantIds.filter(participantId => participantId !== userId);
    });
  }
}
