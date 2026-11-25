import { createAuthClient } from 'better-auth/react';
import { magicLinkClient, twoFactorClient } from 'better-auth/client/plugins';

import { API_BASE_URL } from './config';

function createBerryAuthClient() {
   return createAuthClient({
      baseURL: API_BASE_URL || (typeof window !== 'undefined' ? window.location.origin : ''),
      basePath: '/api/auth',
      plugins: [
         magicLinkClient(),
         twoFactorClient({
            onTwoFactorRedirect() {
               if (typeof window === 'undefined') return;
               const next = new URL('/sign-in', window.location.origin);
               next.searchParams.set('step', 'twofa');
               window.location.assign(next.toString());
            },
         }),
      ],
   });
}

type AuthClient = ReturnType<typeof createBerryAuthClient>;

let client: AuthClient | null = null;

/**
 * The Better Auth client, for starting sign-in and signing out.
 *
 * Created on first use in the browser rather than at import, so a page that
 * imports it can still be prerendered: there is no origin to point at on the
 * server. Same-origin by default (Next rewrites /api/* to the server); the
 * explicit API URL only in cross-origin development.
 *
 * There is deliberately no 'use client' directive: this is not a component, and
 * the directive would make the dynamic import in lib/auth.ts a client reference
 * of the root layout, putting the Better Auth chunk in every page's initial JS.
 */
export function authClient(): AuthClient {
   if (typeof window === 'undefined') {
      throw new Error('The auth client is browser-only');
   }
   client ??= createBerryAuthClient();
   return client;
}
