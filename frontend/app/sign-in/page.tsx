'use client';

import { RiGithubFill } from '@remixicon/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';

import { AuthCard } from '@/components/auth/auth-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
   devLogin,
   fetchSignInOptions,
   registerWithEmail,
   signInWithEmail,
   signInWithGitHub,
} from '@/lib/auth';
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
   // Better Auth's code when the create hook refuses an unverified address.
   unable_to_create_user: 'Verify your primary email on GitHub, then try again.',
   access_denied: 'GitHub sign-in was cancelled.',
};
const GENERIC_ERROR = 'We could not sign you in with GitHub. Please try again.';

function PasswordlessSignIn() {
   const router = useRouter();
   const hydrateFromStorage = useSessionStore((state) => state.hydrateFromStorage);
   const [email, setEmail] = useState('');
   const [pending, setPending] = useState(false);
   const [error, setError] = useState<string | null>(null);

   const submit = async (event: FormEvent) => {
      event.preventDefault();
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
      <AuthCard
         title="Sign in to Berry"
         description="Sign in with the email of an account on this server."
      >
         <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
            <div className="grid gap-1.5 text-left">
               <Label htmlFor="sign-in-email">Email</Label>
               <Input
                  id="sign-in-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
               />
            </div>
            <Button type="submit" className="w-full" disabled={pending || email.trim() === ''}>
               {pending ? 'Signing in…' : 'Continue'}
            </Button>
            {error ? (
               <p role="alert" className="text-status-danger">
                  {error}
               </p>
            ) : null}
         </form>
      </AuthCard>
   );
}

function GitHubSignIn() {
   const params = useSearchParams();
   const returned = params.get('error');
   const [available, setAvailable] = useState<boolean | null>(null);
   const [pending, setPending] = useState(false);
   const [error, setError] = useState<string | null>(
      returned ? (ERROR_MESSAGES[returned] ?? GENERIC_ERROR) : null
   );

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

   const start = async () => {
      setError(null);
      setPending(true);
      try {
         // On success the browser navigates to GitHub; nothing after this runs.
         await signInWithGitHub();
      } catch {
         setError(GENERIC_ERROR);
         setPending(false);
      }
   };

   return (
      <AuthCard
         title="Sign in to Berry"
         description="Berry uses your GitHub account to sign you in."
      >
         <div className="grid gap-4">
            <Button
               type="button"
               className="w-full"
               onClick={() => void start()}
               disabled={pending || available !== true}
            >
               <RiGithubFill aria-hidden className="size-4" />
               {pending ? 'Opening GitHub…' : 'Continue with GitHub'}
            </Button>
            {available === false ? (
               <div role="status" className="grid gap-1.5 text-muted-foreground">
                  <p>
                     Sign-in is not set up on this server. An administrator needs to add the GitHub
                     sign-in credentials.
                  </p>
                  <p className="font-mono">
                     <code>BERRY_AUTH_GITHUB_CLIENT_ID</code>
                     <br />
                     <code>BERRY_AUTH_GITHUB_CLIENT_SECRET</code>
                  </p>
               </div>
            ) : null}
            {error ? (
               <p role="alert" className="text-status-danger">
                  {error}
               </p>
            ) : null}
         </div>
      </AuthCard>
   );
}

function EmailRegistration() {
   const router = useRouter();
   const hydrateFromStorage = useSessionStore((state) => state.hydrateFromStorage);
   const [mode, setMode] = useState<'register' | 'sign-in'>('register');
   const [name, setName] = useState('');
   const [email, setEmail] = useState('');
   const [password, setPassword] = useState('');
   const [pending, setPending] = useState(false);
   const [error, setError] = useState<string | null>(null);
   const registering = mode === 'register';

   const submit = async (event: FormEvent) => {
      event.preventDefault();
      setError(null);
      setPending(true);
      try {
         if (registering) {
            await registerWithEmail({ name, email, password });
         } else {
            await signInWithEmail(email, password);
         }
         await hydrateFromStorage();
         router.push('/');
      } catch (caught) {
         setError(caught instanceof Error ? caught.message : 'Could not sign in');
         setPending(false);
      }
   };

   return (
      <AuthCard
         title={registering ? 'Create your account' : 'Sign in to Berry'}
         description={
            registering
               ? 'This account is stored in the database on this server.'
               : 'Sign in with the email and password you registered.'
         }
         footer={
            <button
               type="button"
               className="underline-offset-4 hover:underline"
               onClick={() => {
                  setMode(registering ? 'sign-in' : 'register');
                  setError(null);
               }}
            >
               {registering ? 'Already have an account? Sign in' : 'Need an account? Register'}
            </button>
         }
      >
         <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
            {registering ? (
               <div className="grid gap-1.5 text-left">
                  <Label htmlFor="register-name">Name</Label>
                  <Input
                     id="register-name"
                     autoComplete="name"
                     required
                     maxLength={80}
                     value={name}
                     onChange={(event) => setName(event.target.value)}
                  />
               </div>
            ) : null}
            <div className="grid gap-1.5 text-left">
               <Label htmlFor="register-email">Email</Label>
               <Input
                  id="register-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
               />
            </div>
            <div className="grid gap-1.5 text-left">
               <Label htmlFor="register-password">Password</Label>
               <Input
                  id="register-password"
                  type="password"
                  autoComplete={registering ? 'new-password' : 'current-password'}
                  required
                  minLength={12}
                  maxLength={256}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
               />
            </div>
            <Button
               type="submit"
               className="w-full"
               disabled={
                  pending ||
                  email.trim() === '' ||
                  password.length < 12 ||
                  (registering && name.trim() === '')
               }
            >
               {pending ? 'Working…' : registering ? 'Create account' : 'Sign in'}
            </Button>
            {error ? (
               <p role="alert" className="text-status-danger">
                  {error}
               </p>
            ) : null}
         </form>
      </AuthCard>
   );
}

function SignInContent() {
   const [options, setOptions] = useState<{
      passwordless: boolean;
      emailRegistration: boolean;
   } | null>(null);

   useEffect(() => {
      let cancelled = false;
      fetchSignInOptions()
         .then((next) => {
            if (!cancelled) {
               setOptions({
                  passwordless: next.passwordless,
                  emailRegistration: next.emailRegistration,
               });
            }
         })
         .catch(() => {
            if (!cancelled) setOptions({ passwordless: false, emailRegistration: false });
         });
      return () => {
         cancelled = true;
      };
   }, []);

   if (options === null) return null;
   if (options.emailRegistration) return <EmailRegistration />;
   if (options.passwordless) return <PasswordlessSignIn />;
   return <GitHubSignIn />;
}

/** `useSearchParams` needs a Suspense boundary for the page to prerender. */
export default function SignInPage() {
   return (
      <Suspense fallback={null}>
         <SignInContent />
      </Suspense>
   );
}
