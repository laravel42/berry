import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

/**
 * App root. A signed-in session goes into onboarding (workspace or create/join).
 * An anonymous visit is rewritten by `proxy.ts` to the marketing site on this
 * same origin, so this file only runs when a session cookie is present — or as
 * a last resort when the rewrite did not. The SessionGate allows `/` for
 * anonymous visitors so a failed rewrite does not bounce them to `/sign-in`.
 */
export default async function Home() {
   const jar = await cookies();
   if (jar.has('berry.session_token')) {
      redirect('/onboarding');
   }
   return null;
}
