/**
 * @fileoverview src/lib/repositories/sqlite/AuthRepositoryImpl.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import { AuthRepository, User } from '../interfaces';
import { CourseRole } from '../../../types/lms';
import { demoUsers } from '../memory/demoData';

const defaultDemoUser = demoUsers.find(user => user.id === 'u1');
let currentUser: User | null = defaultDemoUser ? {
  id: defaultDemoUser.id,
  name: defaultDemoUser.name,
  email: defaultDemoUser.email,
  globalRole: 'admin',
} : null;

/** In-memory demo authentication. It must never be used as production identity. */
export class DemoAuthRepository implements AuthRepository {
  async login(email?: string): Promise<{ user: User, defaultRole: CourseRole }> {
    const normalizedEmail = email?.trim().toLowerCase() || '';
    if (!normalizedEmail) throw new Error('Email address is required.');
    const directoryUser = demoUsers.find(user => user.email?.toLocaleLowerCase() === normalizedEmail);
    if (!directoryUser) throw new Error('No demo account exists for this email address.');
    const user: User = {
      id: directoryUser.id,
      name: directoryUser.name,
      email: directoryUser.email,
      globalRole: ['teacher', 'ta', 'admin', 'it'].includes(directoryUser.role) ? 'admin' : 'user',
    };
    currentUser = user;
    return { user, defaultRole: directoryUser.role };
  }

  async logout(): Promise<void> {
    currentUser = null;
  }

  async getCurrentUser(): Promise<User | null> {
    return currentUser ? { ...currentUser } : null;
  }
}
