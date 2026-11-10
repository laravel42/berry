'use client';

import { BerryMark } from '@/components/brand/berry-mark';
import { WORKSPACE_SLUG } from '@/lib/config';
import { useSessionStore } from '@/store/session-store';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { LocaleSync } from './locale-sync';
import { ThemeSync } from './theme-sync';

// Routes that must render for an anonymous visitor. `/login` is the legacy
// entry that forwards to `/sign-in`, the one sign-in page; keep it here so a
// 'ready' user landing on it is bounced into the app rather than left on a shim.
const AUTH_ROUTES = new Set(['/sign-in', '/login', '/reset-password']);

function isAuthRoute(pathname: string): boolean {
   return AUTH_ROUTES.has(pathname);
}

/**
 * Unauthenticated product surfaces: join-link preview, and `/` which the
 * proxy rewrites to the marketing site (wordmark home).
 */
function isPublicAnonymousRoute(pathname: string): boolean {
   return pathname === '/' || pathname === '/join' || pathname.startsWith('/join/');
}

function isAnonymousAllowed(pathname: string): boolean {
   return isAuthRoute(pathname) || isPublicAnonymousRoute(pathname);
}

function BootScreen({ error, onRetry }: { error: string | null; onRetry: () => void }) {
   return (
      <div className="flex min-h-full items-center justify-center bg-background">
         <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <div className="flex items-center gap-2">
               <BerryMark
                  size="md"
                  tone="brand"
                  pulse={!error}
                  label={error ? 'Berry unreachable' : 'Loading Berry'}
               />
               <span>{error ? 'Berry is unreachable' : 'Loading Berry'}</span>
            </div>
            {error ? (
               <button
                  type="button"
                  className="cursor-pointer text-sm text-foreground underline underline-offset-4"
                  onClick={onRetry}
               >
                  Try again
               </button>
            ) : null}
         </div>
      </div>
   );
}

export function SessionGate({ children }: { children: React.ReactNode }) {
   const pathname = usePathname();
   const router = useRouter();
   const status = useSessionStore((state) => state.status);
   const error = useSessionStore((state) => state.error);
   const workspace = useSessionStore((state) => state.workspace);
   const hydrateFromStorage = useSessionStore((state) => state.hydrateFromStorage);

   useEffect(() => {
      void hydrateFromStorage();
   }, [hydrateFromStorage]);

   // While the API is down we stay on the boot screen; keep asking until it
   // answers so a brief outage does not leave the visitor stuck after recovery.
   useEffect(() => {
      if (status !== 'booting' || !error) return;
      const timer = window.setInterval(() => {
         void hydrateFromStorage();
      }, 2_000);
      return () => window.clearInterval(timer);
   }, [status, error, hydrateFromStorage]);

   useEffect(() => {
      if (status === 'booting') return;

      const onAuthRoute = isAuthRoute(pathname);

      // Anonymous visitors may only see auth and the public join landing;
      // everything else sends them to sign in.
      if (status === 'anonymous' && !isAnonymousAllowed(pathname)) {
         router.replace('/sign-in');
         return;
      }

      // A signed-in user has no business on an auth route — carry them into
      // their workspace. Leave `/join/…` alone so they can accept the link.
      if (status === 'ready' && onAuthRoute) {
         router.replace(`/${workspace?.slug || WORKSPACE_SLUG}/tasks`);
      }
   }, [status, pathname, router, workspace?.slug]);

   if (status === 'booting') {
      return <BootScreen error={error} onRetry={() => void hydrateFromStorage()} />;
   }

   return (
      <>
         <LocaleSync />
         <ThemeSync />
         {children}
      </>
   );
}
