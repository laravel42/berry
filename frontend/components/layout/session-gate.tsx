'use client';

import { BerryMark } from '@/components/brand/berry-mark';
import { useSessionStore } from '@/store/session-store';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { LocaleSync } from './locale-sync';

// Routes that must render for an anonymous visitor. `/login` is the legacy
// entry that forwards to `/sign-in`, the one sign-in page; keep it here so a
// 'ready' user landing on it is bounced into the app rather than left on a shim.
const AUTH_ROUTES = new Set(['/sign-in', '/login']);

function isAuthRoute(pathname: string): boolean {
   return AUTH_ROUTES.has(pathname);
}

/** Invite and join must stay reachable while the first-login wizard is open. */
function isSetupBypass(pathname: string): boolean {
   return (
      pathname === '/onboarding' ||
      pathname === '/workspaces' ||
      pathname.startsWith('/workspaces/') ||
      pathname.startsWith('/invite/') ||
      pathname.startsWith('/invitations') ||
      pathname.startsWith('/join/')
   );
}

function BootScreen() {
   return (
      <div className="flex min-h-full items-center justify-center bg-background">
         <div className="flex items-center gap-2 text-muted-foreground">
            <BerryMark size="md" tone="brand" pulse label="Loading Berry" />
            <span>Loading Berry</span>
         </div>
      </div>
   );
}

export function SessionGate({ children }: { children: React.ReactNode }) {
   const pathname = usePathname();
   const router = useRouter();
   const status = useSessionStore((state) => state.status);
   const workspace = useSessionStore((state) => state.workspace);
   const needsSetup = useSessionStore((state) => state.needsSetup);
   const hydrateFromStorage = useSessionStore((state) => state.hydrateFromStorage);

   useEffect(() => {
      void hydrateFromStorage();
   }, [hydrateFromStorage]);

   useEffect(() => {
      if (status === 'booting') return;

      const onAuthRoute = isAuthRoute(pathname);

      // Anonymous visitors may only see the auth routes; everything else sends
      // them to sign in.
      if (status === 'anonymous' && !onAuthRoute) {
         router.replace('/sign-in');
         return;
      }

      if (status !== 'ready') return;

      // A signed-in user has no business on an auth route — carry them into
      // their workspace.
      if (onAuthRoute) {
         router.replace(needsSetup || !workspace ? '/onboarding' : `/${workspace.slug}/tasks`);
         return;
      }

      if (needsSetup && workspace && !isSetupBypass(pathname)) {
         router.replace('/onboarding');
         return;
      }

      // `/` and `/onboarding` used to wait on another `/me/bootstrap` before
      // routing in. The store already resolved the workspace; skip that hop
      // unless they asked to add one, GitHub just came back from install, or
      // the first-login wizard still has work.
      if ((pathname === '/' || pathname === '/onboarding') && workspace && !needsSetup) {
         const params = new URLSearchParams(window.location.search);
         if (params.get('add') === '1') return;
         if (params.get('integration') === 'github') return;
         router.replace(`/${workspace.slug}/tasks`);
      }
   }, [status, pathname, router, workspace, workspace?.slug, needsSetup]);

   if (status === 'booting') {
      return <BootScreen />;
   }

   return (
      <>
         <LocaleSync />
         {children}
      </>
   );
}
