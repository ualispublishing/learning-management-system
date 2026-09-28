/**
 * @fileoverview Repository factory selection.
 *
 * Reviewer notes:
 * - Development can use local demo repositories or the loopback shared-demo
 *   server.
 * - Production deliberately fails closed until authenticated institution-backed
 *   repositories are configured by the host application.
 */
import { RepositoryFactory } from './interfaces';
import { DemoAuthRepository } from './sqlite/AuthRepositoryImpl';
import { DemoCourseRepository } from './sqlite/CourseRepositoryImpl';
import { DemoContentRepository } from './sqlite/ContentRepositoryImpl';
import { DemoChatRepository } from './sqlite/ChatRepositoryImpl';
import { DemoSubmissionRepository } from './sqlite/SubmissionRepositoryImpl';
import { DemoGradebookRepository } from './sqlite/GradebookRepositoryImpl';
import { DemoLiveSessionRepository } from './memory/LiveSessionRepositoryImpl';
import { DemoContentProgressRepository } from './memory/ContentProgressRepositoryImpl';
import {
  createSharedDemoRepositoryFactory,
  sharedDemoServerUrl,
} from './remote/SharedDemoRepositoryFactory';

const isDevelopmentBuild = typeof __DEV__ !== 'undefined' && __DEV__;

function createDemoFactory(): RepositoryFactory {
  return {
  auth: new DemoAuthRepository(),
  courses: new DemoCourseRepository(),
  content: new DemoContentRepository(),
  progress: new DemoContentProgressRepository(),
  submissions: new DemoSubmissionRepository(),
  gradebook: new DemoGradebookRepository(),
  chat: new DemoChatRepository(),
  liveSessions: new DemoLiveSessionRepository(),
  };
}

function configurationError(): never {
  throw new Error('Institution repositories are not configured. Configure authenticated repository adapters before starting a production build.');
}

const rejectUnconfigured = async (): Promise<never> => configurationError();

function createUnconfiguredFactory(): RepositoryFactory {
  return {
    auth: {
      login: rejectUnconfigured,
      logout: rejectUnconfigured,
      getCurrentUser: rejectUnconfigured,
    },
    courses: {
      getCoursesForUser: rejectUnconfigured,
      getCourseDetails: rejectUnconfigured,
      getUserRoleForCourse: rejectUnconfigured,
      updateCourse: rejectUnconfigured,
      addStudentByIdentifier: rejectUnconfigured,
      updateCourseUser: rejectUnconfigured,
    },
    content: {
      getContentItems: rejectUnconfigured,
      createContentItem: rejectUnconfigured,
      createContentItems: rejectUnconfigured,
      updateContentItem: rejectUnconfigured,
      updateContentItems: rejectUnconfigured,
      updateContentGrouping: rejectUnconfigured,
      deleteContentItem: rejectUnconfigured,
      restoreContentItem: rejectUnconfigured,
    },
    progress: {
      getProgressForCourses: rejectUnconfigured,
      markViewed: rejectUnconfigured,
      setCompleted: rejectUnconfigured,
    },
    submissions: {
      getSubmissionsForCourses: rejectUnconfigured,
      upsertSubmission: rejectUnconfigured,
    },
    gradebook: {
      createExternalGrade: rejectUnconfigured,
    },
    chat: {
      getDirectoryUsers: rejectUnconfigured,
      getThreads: rejectUnconfigured,
      getDirectThreads: rejectUnconfigured,
      getMessages: rejectUnconfigured,
      sendMessage: rejectUnconfigured,
      editMessage: rejectUnconfigured,
      deleteMessage: rejectUnconfigured,
      reportMessage: rejectUnconfigured,
      createThread: rejectUnconfigured,
      markThreadRead: rejectUnconfigured,
      subscribeToMessages: () => () => undefined,
    },
    liveSessions: {
      getSession: rejectUnconfigured,
      publishSession: rejectUnconfigured,
      submitAnswer: rejectUnconfigured,
      finalizeSession: rejectUnconfigured,
      subscribeToSession: () => () => undefined,
    },
  };
}

// Demo data is a development fixture. Production deliberately fails closed
// until the host configures authenticated institution-backed repositories.
export let repoFactory: RepositoryFactory = isDevelopmentBuild
  ? sharedDemoServerUrl
    ? createSharedDemoRepositoryFactory(sharedDemoServerUrl)
    : createDemoFactory()
  : createUnconfiguredFactory();

let repositoryFactoryConfigured = isDevelopmentBuild;

export const isRepositoryFactoryConfigured = () => repositoryFactoryConfigured;

export const configureRepositoryFactory = (factory: RepositoryFactory) => {
  repoFactory = factory;
  repositoryFactoryConfigured = true;
};
