/**
 * @fileoverview src/lib/testing/sharedDemoServer.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { getAssignableCourseRoles, LAST_COURSE_MANAGER_ERROR, wouldRemoveLastCourseManager } from '../authorization/courseRoleManagement';
import { hasCoursePermission, type CoursePermission } from '../authorization/coursePermissions';
import { userBelongsToSubmissionGroup } from '../groups/courseGroups';
import { resetDemoLiveSessions, DemoLiveSessionRepository } from '../repositories/memory/LiveSessionRepositoryImpl';
import { demoContentProgress, DemoContentProgressRepository } from '../repositories/memory/ContentProgressRepositoryImpl';
import {
  demoContentItems,
  demoCourses,
  demoMessages,
  demoThreads,
  demoUsers,
} from '../repositories/memory/demoData';
import { DemoChatRepository, demoMessageReports } from '../repositories/sqlite/ChatRepositoryImpl';
import { DemoContentRepository } from '../repositories/sqlite/ContentRepositoryImpl';
import { DemoCourseRepository } from '../repositories/sqlite/CourseRepositoryImpl';
import { DemoGradebookRepository } from '../repositories/sqlite/GradebookRepositoryImpl';
import { DemoSubmissionRepository, demoSubmissions } from '../repositories/sqlite/SubmissionRepositoryImpl';
import type { Course, CourseRole, CourseUser, StudentSubmission } from '../../types/lms';

const MAX_BODY_BYTES = 10 * 1024 * 1024;
export const DEFAULT_SHARED_DEMO_HOST = '127.0.0.1';
export const DEFAULT_SHARED_DEMO_PORT = 4180;
export const DEFAULT_SHARED_DEMO_RESET_KEY = 'local-shared-demo-reset';

type ServiceName = 'courses' | 'content' | 'progress' | 'submissions' | 'gradebook' | 'chat' | 'liveSessions';

interface RPCRequest {
  service: ServiceName;
  method: string;
  args: unknown[];
}

interface ChangeEvent {
  version: number;
  kind: 'mutation' | 'reset';
  service?: ServiceName;
  method?: string;
  actorId?: string;
  at: number;
}

interface SharedDemoServerOptions {
  host?: string;
  port?: number;
  resetKey?: string;
  /** Identifies the local launcher session; never an authentication credential. */
  launchId?: string;
  handlePreparedAI?: (request: IncomingMessage, response: ServerResponse, url: URL) => Promise<boolean>;
}

const clone = <T,>(value: T): T => structuredClone(value);
const baseline = {
  users: clone(demoUsers),
  courses: clone(demoCourses),
  contentItems: clone(demoContentItems),
  threads: clone(demoThreads),
  messages: clone(demoMessages),
  submissions: clone(demoSubmissions),
};

const repositories = {
  courses: new DemoCourseRepository(),
  content: new DemoContentRepository(),
  progress: new DemoContentProgressRepository(),
  submissions: new DemoSubmissionRepository(),
  gradebook: new DemoGradebookRepository(),
  chat: new DemoChatRepository(),
  liveSessions: new DemoLiveSessionRepository(),
};

const mutatingMethods: Record<ServiceName, ReadonlySet<string>> = {
  courses: new Set(['updateCourse', 'addStudentByIdentifier', 'updateCourseUser']),
  content: new Set(['createContentItem', 'createContentItems', 'updateContentItem', 'updateContentItems', 'updateContentGrouping', 'deleteContentItem', 'restoreContentItem']),
  progress: new Set(['markViewed', 'setCompleted']),
  submissions: new Set(['upsertSubmission']),
  gradebook: new Set(['createExternalGrade']),
  chat: new Set(['sendMessage', 'editMessage', 'deleteMessage', 'reportMessage', 'createThread', 'markThreadRead']),
  liveSessions: new Set(['publishSession', 'submitAnswer', 'finalizeSession']),
};

const allowedMethods: Record<ServiceName, ReadonlySet<string>> = {
  courses: new Set(['getCoursesForUser', 'getCourseDetails', 'getUserRoleForCourse', ...mutatingMethods.courses]),
  content: new Set(['getContentItems', ...mutatingMethods.content]),
  progress: new Set(['getProgressForCourses', ...mutatingMethods.progress]),
  submissions: new Set(['getSubmissionsForCourses', ...mutatingMethods.submissions]),
  gradebook: new Set([...mutatingMethods.gradebook]),
  chat: new Set(['getDirectoryUsers', 'getThreads', 'getDirectThreads', 'getMessages', ...mutatingMethods.chat]),
  liveSessions: new Set(['getSession', ...mutatingMethods.liveSessions]),
};

const replaceArray = <T,>(target: T[], source: T[]) => {
  target.splice(0, target.length, ...clone(source));
};

export const resetSharedDemoData = () => {
  replaceArray(demoUsers, baseline.users);
  replaceArray(demoCourses, baseline.courses);
  replaceArray(demoContentItems, baseline.contentItems);
  replaceArray(demoThreads, baseline.threads);
  replaceArray(demoMessages, baseline.messages);
  replaceArray(demoSubmissions, baseline.submissions);
  demoMessageReports.splice(0, demoMessageReports.length);
  resetDemoLiveSessions();
  demoContentProgress.splice(0, demoContentProgress.length);
};

const courseFor = (courseId: unknown): Course => {
  if (typeof courseId !== 'string') throw new Error('A course identifier is required.');
  const course = demoCourses.find(candidate => candidate.id === courseId);
  if (!course) throw new Error('The requested course was not found.');
  return course;
};

const principalFor = (userId: string | undefined): CourseUser => {
  const principal = userId ? demoUsers.find(user => user.id === userId) : undefined;
  if (!principal) throw new Error('Choose a valid shared demo identity.');
  return principal;
};

const membershipFor = (course: Course, principalId: string) => {
  const membership = course.staff.find(user => user.id === principalId);
  if (!membership) throw new Error('This shared demo identity is not enrolled in the requested course.');
  return membership;
};

const requirePermission = (course: Course, principalId: string, permission: CoursePermission) => {
  const membership = membershipFor(course, principalId);
  if (!hasCoursePermission(membership.role, permission)) {
    throw new Error(`The ${membership.role} role cannot perform this shared demo action.`);
  }
  return membership;
};

const contentCourse = (itemId: unknown): Course => {
  if (typeof itemId !== 'string') throw new Error('A content item identifier is required.');
  const item = demoContentItems.find(candidate => candidate.id === itemId);
  if (!item) throw new Error('The requested content item was not found.');
  return courseFor(item.courseId);
};

const assertSamePrincipal = (claimedUserId: unknown, principalId: string) => {
  if (claimedUserId !== principalId) throw new Error('The request identity does not match the selected shared demo session.');
};

const authorize = (request: RPCRequest, principal: CourseUser) => {
  const { service, method, args } = request;
  if (!allowedMethods[service]?.has(method)) throw new Error('The requested shared demo operation is not supported.');

  if (service === 'courses') {
    if (method === 'getCoursesForUser') assertSamePrincipal(args[0], principal.id);
    else if (method === 'getUserRoleForCourse') {
      assertSamePrincipal(args[0], principal.id);
      membershipFor(courseFor(args[1]), principal.id);
    } else if (method === 'getCourseDetails') {
      membershipFor(courseFor(args[0]), principal.id);
    } else {
      const course = courseFor(args[0]);
      const manager = requirePermission(course, principal.id, 'manageCourse');
      if (method === 'updateCourseUser') {
        const targetUserId = args[1];
        const updates = args[2] as { role?: CourseRole } | undefined;
        if (typeof targetUserId !== 'string') throw new Error('A roster user identifier is required.');
        const target = course.staff.find(user => user.id === targetUserId);
        if (!target) throw new Error('The roster member was not found.');
        const nextRole = updates?.role ?? target.role;
        if (!getAssignableCourseRoles(manager.role, target.role).includes(nextRole)) {
          throw new Error('The selected manager cannot grant or remove that course role.');
        }
        if (wouldRemoveLastCourseManager(course.staff, principal.id, targetUserId, nextRole)) {
          throw new Error(LAST_COURSE_MANAGER_ERROR);
        }
      }
    }
    return;
  }

  if (service === 'content') {
    if (method === 'getContentItems') {
      membershipFor(courseFor(args[0]), principal.id);
      return;
    }
    if (method === 'createContentItem') {
      requirePermission(courseFor((args[0] as { courseId?: unknown } | undefined)?.courseId), principal.id, 'manageContent');
      return;
    }
    if (method === 'createContentItems') {
      const items = args[0] as { courseId?: unknown }[] | undefined;
      if (!Array.isArray(items) || !items.length) throw new Error('At least one content item is required.');
      items.forEach(item => requirePermission(courseFor(item.courseId), principal.id, 'manageContent'));
      return;
    }
    if (method === 'updateContentGrouping') {
      requirePermission(courseFor(args[0]), principal.id, 'manageContent');
      return;
    }
    if (method === 'updateContentItems') {
      const changes = args[0] as { itemId?: unknown }[] | undefined;
      if (!Array.isArray(changes)) throw new Error('Content changes must be an array.');
      changes.forEach(change => requirePermission(contentCourse(change.itemId), principal.id, 'manageContent'));
      return;
    }
    requirePermission(contentCourse(args[0]), principal.id, 'manageContent');
    return;
  }

  if (service === 'submissions') {
    if (method === 'getSubmissionsForCourses') {
      const courseIds = args[0];
      if (!Array.isArray(courseIds)) throw new Error('Course identifiers must be an array.');
      courseIds.forEach(courseId => membershipFor(courseFor(courseId), principal.id));
      return;
    }
    const submission = args[0] as StudentSubmission | undefined;
    if (!submission) throw new Error('A submission is required.');
    const course = courseFor(submission.courseId);
    const membership = membershipFor(course, principal.id);
    if (!hasCoursePermission(membership.role, 'grade') && submission.studentId !== principal.id) {
      throw new Error('Learners may save only their own shared demo submissions.');
    }
    return;
  }

  if (service === 'progress') {
    if (method === 'getProgressForCourses') {
      const courseIds = args[0];
      if (!Array.isArray(courseIds)) throw new Error('Course identifiers must be an array.');
      assertSamePrincipal(args[1], principal.id);
      courseIds.forEach(courseId => membershipFor(courseFor(courseId), principal.id));
      return;
    }
    assertSamePrincipal(args[1], principal.id);
    membershipFor(contentCourse(args[0]), principal.id);
    return;
  }

  if (service === 'gradebook') {
    requirePermission(courseFor((args[0] as { courseId?: unknown } | undefined)?.courseId), principal.id, 'grade');
    return;
  }

  if (service === 'chat') {
    if (method === 'getDirectoryUsers' || method === 'getDirectThreads') assertSamePrincipal(args[0], principal.id);
    if (method === 'getThreads' || method === 'getMessages') assertSamePrincipal(args[1], principal.id);
    if (method === 'sendMessage') assertSamePrincipal((args[0] as { senderId?: unknown } | undefined)?.senderId, principal.id);
    if (method === 'editMessage' || method === 'deleteMessage' || method === 'reportMessage' || method === 'markThreadRead') {
      assertSamePrincipal(args[1], principal.id);
    }
    if (method === 'createThread') assertSamePrincipal((args[0] as { createdBy?: unknown } | undefined)?.createdBy, principal.id);
    return;
  }

  if (service === 'liveSessions') {
    const courseworkId = args[0];
    const course = contentCourse(courseworkId);
    if (method === 'getSession') membershipFor(course, principal.id);
    else if (method === 'submitAnswer') {
      assertSamePrincipal(args[1], principal.id);
      const membership = membershipFor(course, principal.id);
      if (membership.role !== 'student') throw new Error('Only an enrolled learner can submit a shared live answer.');
    } else {
      requirePermission(course, principal.id, 'hostLiveAssessment');
    }
  }
};

const projectSubmissions = (courseIds: string[], principalId: string, submissions: StudentSubmission[]) => {
  const allowedCourses = new Set(courseIds);
  return submissions.filter(submission => {
    if (!allowedCourses.has(submission.courseId)) return false;
    const course = demoCourses.find(candidate => candidate.id === submission.courseId);
    const membership = course?.staff.find(user => user.id === principalId);
    if (!course || !membership) return false;
    if (hasCoursePermission(membership.role, 'grade')) return true;
    if (submission.studentId === principalId) return true;
    return userBelongsToSubmissionGroup(
      course,
      demoContentItems.find(item => item.id === submission.contentItemId),
      principalId,
      submission.groupId,
    );
  });
};

const dispatch = async (request: RPCRequest, principal: CourseUser): Promise<unknown> => {
  authorize(request, principal);
  const repository = repositories[request.service] as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  const operation = repository[request.method];
  if (typeof operation !== 'function') throw new Error('The requested shared demo operation is not available.');
  const result = await operation.apply(repository, request.args);
  if (request.service === 'submissions' && request.method === 'getSubmissionsForCourses') {
    return projectSubmissions(request.args[0] as string[], principal.id, result as StudentSubmission[]);
  }
  return result;
};

const allowedOrigin = (origin: string | undefined) => !origin
  || /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(origin);

const setCORS = (request: IncomingMessage, response: ServerResponse) => {
  const origin = request.headers.origin;
  if (origin && allowedOrigin(origin)) response.setHeader('access-control-allow-origin', origin);
  response.setHeader('vary', 'Origin');
  response.setHeader('access-control-allow-headers', 'content-type, x-demo-user-id, x-demo-reset-key, x-request-id, idempotency-key');
  response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
};

const sendJSON = (response: ServerResponse, status: number, payload: unknown) => {
  const body = JSON.stringify(payload);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  response.end(body);
};

const readJSON = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_BODY_BYTES) throw new Error('The shared demo request exceeds the 10 MB limit.');
    chunks.push(bytes);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new Error('The shared demo request body must be valid JSON.');
  }
};

const openSSE = (request: IncomingMessage, response: ServerResponse) => {
  setCORS(request, response);
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  response.write(': connected\n\n');
  const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 15_000);
  request.on('close', () => clearInterval(heartbeat));
  return (payload: unknown) => response.write(`data: ${JSON.stringify(payload)}\n\n`);
};

export const createSharedDemoServer = (options: SharedDemoServerOptions = {}): Server => {
  const host = options.host ?? DEFAULT_SHARED_DEMO_HOST;
  const port = options.port ?? DEFAULT_SHARED_DEMO_PORT;
  const resetKey = options.resetKey ?? DEFAULT_SHARED_DEMO_RESET_KEY;
  if (host !== '127.0.0.1' && host !== 'localhost') throw new Error('The shared demo server may bind only to loopback.');
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) throw new Error('The shared demo server port is invalid.');

  const changeClients = new Set<(event: ChangeEvent) => void>();
  let version = 0;
  const broadcast = (event: Omit<ChangeEvent, 'version' | 'at'>) => {
    const payload: ChangeEvent = { ...event, version: ++version, at: Date.now() };
    changeClients.forEach(client => client(payload));
  };

  const server = createServer(async (request, response) => {
    try {
      setCORS(request, response);
      if (!allowedOrigin(request.headers.origin)) {
        sendJSON(response, 403, { ok: false, error: 'Only loopback app origins may use the shared demo server.' });
        return;
      }
      if (request.method === 'OPTIONS') {
        response.writeHead(204);
        response.end();
        return;
      }

      const requestUrl = new URL(request.url || '/', `http://${host}:${port || DEFAULT_SHARED_DEMO_PORT}`);
      if (options.handlePreparedAI && await options.handlePreparedAI(request, response, requestUrl)) return;
      if (request.method === 'GET' && requestUrl.pathname === '/health') {
        sendJSON(response, 200, {
          ok: true,
          result: {
            mode: 'shared-demo',
            launchId: options.launchId,
            version,
            counts: {
              users: demoUsers.length,
              courses: demoCourses.length,
              contentItems: demoContentItems.length,
              threads: demoThreads.length,
              messages: demoMessages.length,
              submissions: demoSubmissions.length,
            },
          },
        });
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/session') {
        const body = await readJSON(request) as { email?: unknown };
        const email = typeof body.email === 'string' ? body.email.trim().toLocaleLowerCase() : '';
        const directoryUser = demoUsers.find(user => user.email?.toLocaleLowerCase() === email);
        if (!directoryUser) throw new Error('No shared demo account exists for this email address.');
        sendJSON(response, 200, {
          ok: true,
          result: {
            user: {
              id: directoryUser.id,
              name: directoryUser.name,
              email: directoryUser.email,
              globalRole: ['teacher', 'ta', 'admin', 'it'].includes(directoryUser.role) ? 'admin' : 'user',
            },
            defaultRole: directoryUser.role,
          },
        });
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/reset') {
        if (request.headers['x-demo-reset-key'] !== resetKey) {
          sendJSON(response, 403, { ok: false, error: 'The shared demo reset key is invalid.' });
          return;
        }
        resetSharedDemoData();
        broadcast({ kind: 'reset' });
        sendJSON(response, 200, { ok: true, result: { reset: true, version } });
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/rpc') {
        const body = await readJSON(request) as Partial<RPCRequest>;
        if (typeof body.service !== 'string' || typeof body.method !== 'string' || !Array.isArray(body.args)) {
          throw new Error('The shared demo RPC envelope is invalid.');
        }
        const principal = principalFor(typeof request.headers['x-demo-user-id'] === 'string' ? request.headers['x-demo-user-id'] : undefined);
        const rpcRequest = body as RPCRequest;
        const result = await dispatch(rpcRequest, principal);
        if (mutatingMethods[rpcRequest.service].has(rpcRequest.method)) {
          broadcast({ kind: 'mutation', service: rpcRequest.service, method: rpcRequest.method, actorId: principal.id });
        }
        sendJSON(response, 200, { ok: true, result: result ?? null });
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/events/changes') {
        const principal = principalFor(requestUrl.searchParams.get('userId') || undefined);
        const send = openSSE(request, response);
        const client = (event: ChangeEvent) => send(event);
        changeClients.add(client);
        send({ version, kind: 'mutation', actorId: principal.id, at: Date.now() } satisfies ChangeEvent);
        request.on('close', () => changeClients.delete(client));
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/events/messages') {
        const userId = requestUrl.searchParams.get('userId') || '';
        const threadId = requestUrl.searchParams.get('threadId') || '';
        principalFor(userId);
        const send = openSSE(request, response);
        const unsubscribe = repositories.chat.subscribeToMessages(threadId, userId, messages => send(messages));
        request.on('close', unsubscribe);
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/events/live') {
        const userId = requestUrl.searchParams.get('userId') || '';
        const courseworkId = requestUrl.searchParams.get('courseworkId') || '';
        const principal = principalFor(userId);
        membershipFor(contentCourse(courseworkId), principal.id);
        const send = openSSE(request, response);
        const unsubscribe = repositories.liveSessions.subscribeToSession(courseworkId, state => send(state));
        request.on('close', unsubscribe);
        return;
      }

      sendJSON(response, 404, { ok: false, error: 'The shared demo endpoint was not found.' });
    } catch (error) {
      if (response.headersSent) {
        response.end();
        return;
      }
      const message = error instanceof Error ? error.message : 'The shared demo request failed.';
      sendJSON(response, /cannot|not enrolled|does not match|invalid reset|access/i.test(message) ? 403 : 400, { ok: false, error: message });
    }
  });

  server.on('listening', () => {
    const address = server.address();
    if (address && typeof address !== 'string' && address.address !== '127.0.0.1' && address.address !== '::1') {
      server.close();
    }
  });
  return server;
};

export const listenSharedDemoServer = async (options: SharedDemoServerOptions = {}) => {
  const host = options.host ?? DEFAULT_SHARED_DEMO_HOST;
  const port = options.port ?? DEFAULT_SHARED_DEMO_PORT;
  const server = createSharedDemoServer({ ...options, host, port });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  return server;
};
