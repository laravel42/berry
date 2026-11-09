'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

import { RiGithubFill } from '@remixicon/react';
import { useRouter } from 'next/navigation';
import type { FormEvent } from 'react';

import { AuthCard } from '@/components/auth/auth-card';
import {
   AuthField,
   AuthFieldGroup,
   AuthPrimaryButton,
   AuthSecondaryButton,
} from '@/components/auth/auth-fields';
import { AuthFlow, type AuthStep } from '@/components/auth/auth-flow';
import { devLogin, fetchSignInOptions, signInWithGitHub, type SignInOptions } from '@/lib/auth';
import { useSessionStore } from '@/store/session-store';

/**
 * What a refused GitHub round trip means, in Berry's words. The server sends
 * the browser back here with `?error=<code>`; anything not listed gets the
 * general message rather than the raw code.
 */
const ERROR_MESSAGES: Record<string, string> = {
   account_not_linked:
      'Your GitHub account could not be linked. Make sure its primary email is verified on GitHub.',
   email_not_verified: 'Verify your primary email on GitHub, then try again.',
   unable_to_create_user: 'Verify your primary email on GitHub, then try again.',
   access_denied: 'GitHub sign-in was cancelled.',
   // Better Auth sets `error` on errorCallbackURL (replacing our magic_link
   // hint) when /magic-link/verify fails after the email click.
   magic_link: 'That sign-in link could not be used. Request a new one.',
   INVALID_TOKEN: 'That sign-in link could not be used. Request a new one.',
   new_user_signup_disabled: 'That sign-in link could not be used. Request a new one.',
};
const GENERIC_GITHUB_ERROR = 'We could not sign you in with GitHub. Please try again.';

function GitHubOnly({ returnedError }: { returnedError: string | null }) {
   const [available, setAvailable] = useState<boolean | null>(null);
   const [pending, setPending] = useState(false);
   const [error, setError] = useState<string | null>(returnedError);

   useEffect(() => {
      let cancelled = false;
      fetchSignInOptions()
         .then((options) => {
            if (!cancelled) setAvailable(options.github);
         })
         .catch(() => {
            if (!cancelled) setAvailable(false);
         });
      return () => {
         cancelled = true;
      };
   }, []);

   return (
      <AuthCard
         title="Sign in to Berry"
         description="Welcome back. Continue with the GitHub account your team uses."
         error={error}
      >
         <div className="flex flex-col gap-3.5">
            <AuthPrimaryButton
               ready={available === true && !pending}
               onClick={() => {
                  setPending(true);
                  setError(null);
                  void signInWithGitHub().catch(() => {
                     setError(GENERIC_GITHUB_ERROR);
                     setPending(false);
                  });
               }}
            >
               <RiGithubFill aria-hidden className="size-4" />
               {pending ? 'Opening GitHub…' : 'Continue with GitHub'}
            </AuthPrimaryButton>
            {available === false ? (
               <div role="status" className="grid gap-1.5 text-[var(--brand-ash)]">
                  <p>
                     Sign-in is not set up on this server. An administrator needs to add GitHub
                     sign-in credentials.
                  </p>
                  <p className="font-mono">
                     <code>BERRY_AUTH_GITHUB_CLIENT_ID</code>
                     <br />
                     <code>BERRY_AUTH_GITHUB_CLIENT_SECRET</code>
                  </p>
               </div>
            ) : null}
         </div>
      </AuthCard>
   );
}

function PasswordlessSignIn() {
   const router = useRouter();
   const hydrateFromStorage = useSessionStore((state) => state.hydrateFromStorage);
   const [email, setEmail] = useState('');
   const [pending, setPending] = useState(false);
   const [error, setError] = useState<string | null>(null);
   const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());

   const submit = async (event: FormEvent) => {
      event.preventDefault();
      if (!emailOk) {
         setError('Enter a valid email address.');
         return;
      }
      setError(null);
      setPending(true);
      try {
         await devLogin(email);
         await hydrateFromStorage();
         router.push('/');
      } catch {
         setError('That email is not an account on this server.');
         setPending(false);
      }
   };

   return (
      <AuthCard title="Sign in to Berry" description="Welcome back." error={error}>
         <form className="flex flex-col gap-3.5" onSubmit={(event) => void submit(event)}>
            <AuthFieldGroup label="Email" htmlFor="sign-in-email">
               <AuthField
                  id="sign-in-email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="you@company.com"
                  value={email}
                  invalid={error !== null}
                  onChange={(event) => {
                     setEmail(event.target.value);
                     setError(null);
                  }}
               />
            </AuthFieldGroup>
            <AuthPrimaryButton type="submit" ready={emailOk && !pending}>
               {pending ? 'Signing in…' : 'Continue'}
            </AuthPrimaryButton>
            <AuthSecondaryButton
               inverted
               disabled={pending}
               onClick={() => {
                  setPending(true);
                  void signInWithGitHub().catch(() => setPending(false));
               }}
            >
               <RiGithubFill aria-hidden className="size-4" />
               Continue with GitHub
            </AuthSecondaryButton>
         </form>
      </AuthCard>
   );
}

function SignInContent() {
   const params = useSearchParams();
   const returned = params.get('error');
   const returnedError = returned ? (ERROR_MESSAGES[returned] ?? GENERIC_GITHUB_ERROR) : null;
   const stepParam = params.get('step');
   const initialStep: AuthStep =
      stepParam === 'twofa'
         ? 'twofa'
         : stepParam === 'forgot'
           ? 'forgot'
           : stepParam === 'signup'
             ? 'signup'
             : 'signin';
   const [options, setOptions] = useState<SignInOptions | null>(null);

   useEffect(() => {
      let cancelled = false;
      fetchSignInOptions()
         .then((next) => {
            if (!cancelled) setOptions(next);
         })
         .catch(() => {
            if (!cancelled) {
               setOptions({
                  github: false,
                  passwordless: false,
                  emailRegistration: false,
                  magicLink: false,
                  passwordReset: false,
                  twoFactor: false,
                  signInOrigin: null,
               });
            }
         });
      return () => {
         cancelled = true;
      };
   }, []);

   useEffect(() => {
      if (params.get('github') !== '1') return;
      void signInWithGitHub().catch(() => undefined);
   }, [params]);

   if (options === null) {
      return <div className="min-h-svh bg-[var(--brand-void)]" />;
   }

   // Full email auth surface whenever registration, magic link or reset is on.
   // GitHub rides along as a secondary when configured.
   if (
      options.emailRegistration ||
      options.magicLink ||
      options.passwordReset ||
      initialStep === 'twofa'
   ) {
      return <AuthFlow options={options} initialStep={initialStep} returnedError={returnedError} />;
   }
   if (options.passwordless) return <PasswordlessSignIn />;
   return <GitHubOnly returnedError={returnedError} />;
}

/** `useSearchParams` needs a Suspense boundary for the page to prerender. */
export default function SignInPage() {
   return (
      <Suspense fallback={<div className="min-h-svh bg-[var(--brand-void)]" />}>
         <SignInContent />
      </Suspense>
   );
}
