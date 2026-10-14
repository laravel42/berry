import { create } from 'zustand';
import type { User } from '@/data/users';
import { BerryApiError } from '@/lib/api';
import { devLogin, fetchBootstrap, logoutSession, type BootstrapWorkspace } from '@/lib/auth';
import { AUTO_LOGIN_EMAIL } from '@/lib/config';
import { listBoards, selectBoardId } from '@/lib/boards';
import { toUiUser } from '@/lib/catalog';
import { isLocale, type Locale } from '@/lib/i18n/locales';
import { needsSetupWizard } from '@/lib/onboarding';
import { pickWorkspace } from '@/lib/session-workspace';
import { selectWorkspace } from '@/lib/workspaces';

export type SessionStatus = 'booting' | 'anonymous' | 'ready';

export interface SessionWorkspace {
   id: string;
   name: string;
   slug: string;
   /** The signed-in account's role here, which decides what a screen may offer. */
   role: string;
}

interface SessionState {
   status: SessionStatus;
   user: User | null;
   /** The active workspace: the persisted selection, resolved on load. */
   workspace: SessionWorkspace | null;
   /** Every workspace the user belongs to, for the switcher menu. */
   workspaces: SessionWorkspace[];
   boardId: string | null;
   /** The account's interface language, from bootstrap; null when anonymous. */
   preferredLocale: Locale | null;
   /** Pair this computer and place models before the first workspace visit. */
   needsSetup: boolean;
   /** Settings calls this after saving, so LocaleSync does not revert the choice. */
   setPreferredLocale: (locale: Locale) => void;
   error: string | null;
   hydrateFromStorage: () => Promise<void>;
   signOut: () => Promise<void>;
   /** Drops to anonymous locally, without a server round trip (sign-out fallback). */
   markAnonymous: () => void;
   /**
    * Re-read `/me/bootstrap` and re-derive the ready state. Onboarding calls
    * this after creating or joining a workspace so the store reflects the new
    * membership, then routes into the resolved workspace. Returns the resolved
    * workspace (or null when the account still has none).
    */
   refreshWorkspaces: () => Promise<SessionWorkspace | null>;
   /**
    * Persist a new active workspace the user belongs to and make it current in
    * the store. Returns the switched-to workspace, or null when the id is not
    * one of the user's memberships. Callers navigate into it on success.
    */
   switchWorkspace: (workspaceId: string) => Promise<SessionWorkspace | null>;
   /** The first-login wizard finished or was skipped; stay out of it. */
   markSetupDone: () => void;
}

const SNAPSHOT_KEY = 'berry.session.snapshot.v1';

type ReadySnapshot = Pick<
   SessionState,
   'user' | 'workspace' | 'workspaces' | 'boardId' | 'preferredLocale' | 'needsSetup'
>;

function isSessionWorkspace(value: unknown): value is SessionWorkspace {
   if (typeof value !== 'object' || value === null) return false;
   const row = value as Record<string, unknown>;
   return (
      typeof row.id === 'string' &&
      typeof row.name === 'string' &&
      typeof row.slug === 'string' &&
      typeof row.role === 'string'
   );
}

function isUser(value: unknown): value is User {
   if (typeof value !== 'object' || value === null) return false;
   const row = value as Record<string, unknown>;
   return (
      typeof row.id === 'string' &&
      typeof row.name === 'string' &&
      typeof row.avatarUrl === 'string' &&
      typeof row.email === 'string' &&
      (row.status === 'online' || row.status === 'offline' || row.status === 'away') &&
      (row.role === 'Member' ||
         row.role === 'Admin' ||
         row.role === 'Guest' ||
         row.role === 'Application') &&
      typeof row.joinedDate === 'string' &&
      Array.isArray(row.teamIds) &&
      typeof row.timezone === 'string'
   );
}

function readSnapshot(): ReadySnapshot | null {
   if (typeof window === 'undefined') return null;
   try {
      const raw = window.sessionStorage.getItem(SNAPSHOT_KEY);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) return null;
      const row = parsed as Record<string, unknown>;
      if (!isUser(row.user)) return null;
      if (row.workspace != null && !isSessionWorkspace(row.workspace)) return null;
      if (!Array.isArray(row.workspaces) || !row.workspaces.every(isSessionWorkspace)) {
         return null;
      }
      if (row.boardId != null && typeof row.boardId !== 'string') return null;
      if (row.preferredLocale != null && !isLocale(row.preferredLocale)) return null;
      return {
         user: row.user,
         workspace: isSessionWorkspace(row.workspace) ? row.workspace : null,
         workspaces: row.workspaces,
         boardId: typeof row.boardId === 'string' ? row.boardId : null,
         preferredLocale: isLocale(row.preferredLocale) ? row.preferredLocale : null,
         needsSetup: typeof row.needsSetup === 'boolean' ? row.needsSetup : true,
      };
   } catch {
      return null;
   }
}

function writeSnapshot(snapshot: ReadySnapshot): void {
   if (typeof window === 'undefined') return;
   try {
      window.sessionStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
   } catch {
      // Private mode and quota errors are not worth blocking boot.
   }
}

function clearSnapshot(): void {
   if (typeof window === 'undefined') return;
   try {
      window.sessionStorage.removeItem(SNAPSHOT_KEY);
   } catch {
      // Same as write: a store we cannot clear is not a session we still hold.
   }
}

const toSessionWorkspace = (workspace: BootstrapWorkspace): SessionWorkspace => ({
   id: workspace.id,
   name: workspace.name,
   slug: workspace.slug,
   role: workspace.role,
});

async function loadReadyState(): Promise<ReadySnapshot> {
   const [bootstrap, boards] = await Promise.all([fetchBootstrap(), listBoards()]);
   const workspace = pickWorkspace(bootstrap.workspaces, bootstrap.currentWorkspaceId);
   return {
      user: toUiUser({
         id: bootstrap.user.id,
         name: bootstrap.user.name,
         avatarUrl: bootstrap.user.avatarUrl,
         email: bootstrap.user.email,
         type: 'user',
      }),
      workspace: workspace ? toSessionWorkspace(workspace) : null,
      workspaces: bootstrap.workspaces.map(toSessionWorkspace),
      boardId: selectBoardId(boards, workspace?.id),
      preferredLocale: isLocale(bootstrap.user.settings.locale)
         ? bootstrap.user.settings.locale
         : null,
      needsSetup: needsSetupWizard(bootstrap.user.onboarding),
   };
}

const ANONYMOUS = {
   status: 'anonymous' as const,
   user: null,
   workspace: null,
   workspaces: [] as SessionWorkspace[],
   boardId: null,
   preferredLocale: null,
   needsSetup: false,
   error: null,
};

export const useSessionStore = create<SessionState>((set, get) => ({
   status: 'booting',
   user: null,
   workspace: null,
   workspaces: [],
   boardId: null,
   preferredLocale: null,
   needsSetup: false,
   error: null,

   setPreferredLocale: (locale) => set({ preferredLocale: locale }),
   markSetupDone: () => {
      set({ needsSetup: false });
      const current = get();
      if (current.status === 'ready' && current.user) {
         writeSnapshot({
            user: current.user,
            workspace: current.workspace,
            workspaces: current.workspaces,
            boardId: current.boardId,
            preferredLocale: current.preferredLocale,
            needsSetup: false,
         });
      }
   },

   hydrateFromStorage: async () => {
      // Last tab's ready state is enough to paint the shell while bootstrap
      // and the board list confirm. It is not a credential — the cookie is.
      const snapshot = readSnapshot();
      if (snapshot && get().status === 'booting') {
         set({ status: 'ready', error: null, ...snapshot });
      }

      // The session is a cookie the browser sends on its own, so "is anyone
      // signed in" is simply whether bootstrap answers. A 401 is the normal
      // anonymous answer, not an error worth showing.
      try {
         const ready = await loadReadyState();
         writeSnapshot(ready);
         set({ status: 'ready', error: null, ...ready });
         return;
      } catch (error) {
         if (!(error instanceof BerryApiError) || error.status !== 401) {
            clearSnapshot();
            set({ ...ANONYMOUS, error: error instanceof BerryApiError ? error.message : null });
            return;
         }
      }

      // Development only: sign in as a configured account through dev-login.
      // The server serves that route only in development and test, so a stray
      // value cannot sign anyone in against a production API.
      if (AUTO_LOGIN_EMAIL) {
         try {
            await devLogin(AUTO_LOGIN_EMAIL);
            const ready = await loadReadyState();
            writeSnapshot(ready);
            set({ status: 'ready', error: null, ...ready });
            return;
         } catch {
            // A convenience, not a guarantee: fall through to the sign-in page.
         }
      }

      clearSnapshot();
      set({ ...ANONYMOUS });
   },

   signOut: async () => {
      await logoutSession();
      clearSnapshot();
      set({ ...ANONYMOUS });
   },

   markAnonymous: () => {
      clearSnapshot();
      set({ ...ANONYMOUS });
   },

   refreshWorkspaces: async () => {
      const ready = await loadReadyState();
      writeSnapshot(ready);
      set({ status: 'ready', error: null, ...ready });
      return ready.workspace;
   },

   switchWorkspace: async (workspaceId: string) => {
      // Only a workspace the user belongs to can be switched to; the server
      // re-checks membership on select and 404s otherwise, but guarding here
      // keeps a stale menu from issuing a doomed request.
      const target = get().workspaces.find((workspace) => workspace.id === workspaceId);
      if (!target) return null;
      if (get().workspace?.id === workspaceId) return target;

      await selectWorkspace(workspaceId);
      // The board goes with the workspace: one left from the last workspace
      // would send new tasks and plans onto another workspace's board.
      const boards = await listBoards().catch(() => []);
      const next = { workspace: target, boardId: selectBoardId(boards, target.id) };
      set(next);
      const current = get();
      if (current.status === 'ready' && current.user) {
         writeSnapshot({
            user: current.user,
            workspace: next.workspace,
            workspaces: current.workspaces,
            boardId: next.boardId,
            preferredLocale: current.preferredLocale,
            needsSetup: current.needsSetup,
         });
      }
      return target;
   },
}));
