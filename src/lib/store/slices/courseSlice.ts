/**
 * @fileoverview src/lib/store/slices/courseSlice.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import { StateCreator } from 'zustand';
import { Course, CourseUser } from '../../../types/lms';
import { repoFactory } from '../../repositories/factory';
import { capturePrincipalGeneration, isPrincipalGenerationCurrent } from '../principalGeneration';

export interface CourseSlice {
  courses: Course[];
  courseMutationError: string | null;
  clearCourseMutationError: () => void;
  setCourses: (courses: Course[]) => void;
  updateCourse: (id: string, updates: Partial<Course>) => Promise<void>;
  updateCourseUser: (courseId: string, userId: string, updates: Partial<CourseUser>) => Promise<void>;
  addStudentToCourse: (courseId: string, studentIdentifier: string) => Promise<void>;
  fetchCourses: (userId: string) => Promise<void>;
}

const messageFrom = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

export const createCourseSlice: StateCreator<CourseSlice, [], [], CourseSlice> = (set, get) => ({
  courses: [],
  courseMutationError: null,
  clearCourseMutationError: () => set({ courseMutationError: null }),
  setCourses: (courses) => set({ courses }),

  updateCourse: async (id, updates) => {
    const generation = capturePrincipalGeneration();
    const exists = get().courses.some(course => course.id === id);
    if (!exists) {
      set({ courseMutationError: `Course "${id}" was not found.` });
      throw new Error(`Course "${id}" was not found.`);
    }
    try {
      await repoFactory.courses.updateCourse(id, updates);
      if (isPrincipalGenerationCurrent(generation)) set(state => ({
        courses: state.courses.map(course => course.id === id ? { ...course, ...updates, id } : course),
        courseMutationError: null,
      }));
    } catch (error) {
      if (isPrincipalGenerationCurrent(generation)) set({ courseMutationError: messageFrom(error, 'Course changes could not be saved.') });
      throw error;
    }
  },

  updateCourseUser: async (courseId, userId, updates) => {
    const generation = capturePrincipalGeneration();
    try {
      await repoFactory.courses.updateCourseUser(courseId, userId, updates);
      if (isPrincipalGenerationCurrent(generation)) set(state => ({
        courses: state.courses.map(course => {
          if (course.id !== courseId) return course;
          const staff = course.staff.map(user => user.id === userId ? { ...user, ...updates, id: userId } : user);
          return { ...course, staff, participantsCount: staff.filter(user => user.role === 'student').length };
        }),
        courseMutationError: null,
      }));
    } catch (error) {
      if (isPrincipalGenerationCurrent(generation)) set({ courseMutationError: messageFrom(error, 'Roster changes could not be saved.') });
      throw error;
    }
  },

  addStudentToCourse: async (courseId, studentIdentifier) => {
    const generation = capturePrincipalGeneration();
    try {
      const student = await repoFactory.courses.addStudentByIdentifier(courseId, studentIdentifier);
      if (isPrincipalGenerationCurrent(generation)) set(state => ({
        courses: state.courses.map(course => {
          if (course.id !== courseId) return course;
          const staff = [...course.staff, student];
          return { ...course, participantsCount: staff.filter(member => member.role === 'student').length, staff };
        }),
        courseMutationError: null,
      }));
    } catch (error) {
      if (isPrincipalGenerationCurrent(generation)) set({ courseMutationError: messageFrom(error, 'Student enrollment could not be saved.') });
      throw error;
    }
  },

  fetchCourses: async (userId) => {
    const generation = capturePrincipalGeneration();
    try {
      const courses = await repoFactory.courses.getCoursesForUser(userId);
      if (isPrincipalGenerationCurrent(generation)) set({ courses, courseMutationError: null });
    } catch (error) {
      if (isPrincipalGenerationCurrent(generation)) set({ courseMutationError: messageFrom(error, 'Courses could not be loaded.') });
      throw error;
    }
  },
});
