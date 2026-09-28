/**
 * @fileoverview src/lib/store/slices/authSlice.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import { StateCreator } from 'zustand';
import { CourseRole } from '../../../types/lms';
import { repoFactory } from '../../repositories/factory';
import { isSharedDemoMode } from '../../repositories/remote/SharedDemoRepositoryFactory';

const isDevelopmentBuild = typeof __DEV__ !== 'undefined' && __DEV__;
const startsWithLocalDemoIdentity = isDevelopmentBuild && !isSharedDemoMode;

export interface AuthSlice {
  currentUserRole: CourseRole;
  currentUserGlobalRole: 'admin' | 'user';
  currentUserId: string | null;
  currentUserName: string | null;
  currentUserEmail: string | null;
  login: (email?: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const createAuthSlice: StateCreator<AuthSlice, [], [], AuthSlice> = (set) => ({
  currentUserRole: startsWithLocalDemoIdentity ? 'teacher' : 'student',
  currentUserGlobalRole: startsWithLocalDemoIdentity ? 'admin' : 'user',
  currentUserId: startsWithLocalDemoIdentity ? 'u1' : null,
  currentUserName: null,
  currentUserEmail: null,
  login: async (email) => {
    const { user, defaultRole } = await repoFactory.auth.login(email);
    set({
      currentUserRole: defaultRole,
      currentUserGlobalRole: user.globalRole,
      currentUserId: user.id,
      currentUserName: user.name,
      currentUserEmail: user.email ?? null,
    });
  },
  logout: async () => {
    await repoFactory.auth.logout();
    set({
      currentUserRole: 'student',
      currentUserGlobalRole: 'user',
      currentUserId: null,
      currentUserName: null,
      currentUserEmail: null,
    });
  }
});
