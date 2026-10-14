import { redirect } from 'next/navigation';

/**
 * App root. Sign-in returns to `/`. `proxy.ts` already 307s a session with a
 * membership into that workspace; this is the fallback when the proxy does
 * not run. SessionGate still sends an anonymous visitor to `/sign-in`.
 */
export default function Home() {
   redirect('/onboarding');
}
