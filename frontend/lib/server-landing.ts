import { SETUP_ONBOARDING_VERSION } from '@/lib/onboarding';
import { pickWorkspace } from '@/lib/session-workspace';

function apiOrigin(): string {
   return (process.env.BERRY_API_ORIGIN || 'http://127.0.0.1:4000').replace(/\/+$/, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
   return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Where `/` should send a signed-in account: the first-login wizard when
 * this computer is not set up yet, their workspace tasks, or onboarding
 * when there is no membership (or no session yet).
 *
 * Used from `proxy.ts` so the hop is an HTTP 307 before the root layout
 * paints the boot screen. The cookie is the same Better Auth session the
 * browser would have sent; nothing is stored or logged.
 */
export async function landingPathAfterSignIn(cookieHeader: string): Promise<string> {
   if (!cookieHeader) return '/onboarding';

   try {
      const response = await fetch(`${apiOrigin()}/api/v1/me/bootstrap`, {
         headers: { accept: 'application/json', cookie: cookieHeader },
         cache: 'no-store',
      });
      if (!response.ok) return '/onboarding';
      const json: unknown = await response.json();
      if (!isRecord(json) || !Array.isArray(json.workspaces)) return '/onboarding';
      const workspaces = json.workspaces.flatMap((row) => {
         if (
            !isRecord(row) ||
            typeof row.id !== 'string' ||
            typeof row.slug !== 'string' ||
            typeof row.createdAt !== 'string'
         ) {
            return [];
         }
         return [{ id: row.id, slug: row.slug, createdAt: row.createdAt }];
      });
      const currentWorkspaceId =
         typeof json.currentWorkspaceId === 'string' ? json.currentWorkspaceId : null;
      const workspace = pickWorkspace(workspaces, currentWorkspaceId);
      if (!workspace) return '/onboarding';
      if (needsSetupFromBootstrap(json.user)) return '/onboarding';
      return `/${workspace.slug}/tasks`;
   } catch {
      return '/onboarding';
   }
}

function needsSetupFromBootstrap(user: unknown): boolean {
   if (!isRecord(user) || !isRecord(user.onboarding)) return true;
   const version = typeof user.onboarding.version === 'number' ? user.onboarding.version : 0;
   return version < SETUP_ONBOARDING_VERSION;
}
