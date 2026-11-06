'use client';

import { RiGithubFill } from '@remixicon/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent, type ReactNode } from 'react';

import { AuthCard } from '@/components/auth/auth-card';
import {
   AuthField,
   AuthFieldGroup,
   AuthPrimaryButton,
   AuthSecondaryButton,
   PasswordStrength,
} from '@/components/auth/auth-fields';
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
const GENERIC_GITHUB_ERROR = 'We could not sign you in with GitHub. Please try again.';

const EMAIL_OK = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type Mode = 'signin' | 'signup';

function TopSwitch({ mode, onSwitch }: { mode: Mode; onSwitch: (next: Mode) => void }) {
   if (mode === 'signin') {
      return (
         <>
            No account?{' '}
            <button
               type="button"
               className="text-[#e8c15c] hover:text-[#f2d27e]"
               onClick={() => onSwitch('signup')}
            >
               Sign up
            </button>
         </>
      );
   }
   return (
      <>
         Have an account?{' '}
         <button
            type="button"
            className="text-[#e8c15c] hover:text-[#f2d27e]"
            onClick={() => onSwitch('signin')}
         >
            Sign in
         </button>
      </>
   );
}

function PasswordField({
   id,
   value,
   onChange,
   autoComplete,
   placeholder,
   trailing,
}: {
   id: string;
   value: string;
   onChange: (next: string) => void;
   autoComplete: string;
   placeholder: string;
   trailing?: ReactNode;
}) {
   const [show, setShow] = useState(false);
   return (
      <AuthFieldGroup label="Password" htmlFor={id} trailing={trailing}>
         <div className="flex h-11 items-center rounded-[10px] border border-[#2a2a2f] bg-[#161618] pr-1 pl-3 focus-within:border-[#e3b341] focus-within:shadow-[0_0_0_3px_rgba(227,179,65,0.2)]">
            <input
               id={id}
               type={show ? 'text' : 'password'}
               autoComplete={autoComplete}
               required
               minLength={12}
               maxLength={256}
               value={value}
               placeholder={placeholder}
               onChange={(event) => onChange(event.target.value)}
               className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[var(--brand-chalk)] outline-none placeholder:text-[var(--brand-slate)]"
            />
            <button
               type="button"
               className="flex h-[30px] items-center rounded-md px-2 text-xs text-[var(--brand-ash)] hover:bg-[#242428] hover:text-[var(--brand-chalk)]"
               onClick={() => setShow((current) => !current)}
            >
               {show ? 'Hide' : 'Show'}
            </button>
         </div>
      </AuthFieldGroup>
   );
}

function GitHubOnly({ returnedError }: { returnedError: string | null }) {
   const [available, setAvailable] = useState<boolean | null>(null);
   const [pending, setPending] = useState(false);
   const [error, setError] = useState<string | null>(returnedError);

   const start = async () => {
      setError(null);
      setPending(true);
      try {
         await signInWithGitHub();
      } catch {
         setError(GENERIC_GITHUB_ERROR);
         setPending(false);
      }
   };

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
            <AuthPrimaryButton ready={available === true && !pending} onClick={() => void start()}>
               <RiGithubFill aria-hidden className="size-4" />
               {pending ? 'Opening GitHub…' : 'Continue with GitHub'}
            </AuthPrimaryButton>
            {available === false ? (
               <div role="status" className="grid gap-1.5 text-[var(--brand-ash)]">
                  <p>
                     Sign-in is not set up on this server. An administrator needs to add GitHub
                     sign-in credentials.
                  </p>
                  <p className="font-mono text-xs">
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
   const emailOk = EMAIL_OK.test(email.trim());

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
         </form>
      </AuthCard>
   );
}

function EmailAuth({ github, returnedError }: { github: boolean; returnedError: string | null }) {
   const router = useRouter();
   const hydrateFromStorage = useSessionStore((state) => state.hydrateFromStorage);
   const [mode, setMode] = useState<Mode>('signin');
   const [name, setName] = useState('');
   const [email, setEmail] = useState('');
   const [password, setPassword] = useState('');
   const [pending, setPending] = useState(false);
   const [githubPending, setGithubPending] = useState(false);
   const [error, setError] = useState<string | null>(returnedError);

   const registering = mode === 'signup';
   const emailOk = EMAIL_OK.test(email.trim());
   const passwordOk = password.length >= 12;
   const entryReady =
      emailOk && (registering ? passwordOk && name.trim() !== '' : password.length > 0);

   const submit = async (event: FormEvent) => {
      event.preventDefault();
      if (!emailOk) {
         setError('Enter a valid email address.');
         return;
      }
      if (registering && name.trim() === '') {
         setError('Enter your name.');
         return;
      }
      if (registering && !passwordOk) {
         setError('Use at least 12 characters for your password.');
         return;
      }
      if (!registering && password.length === 0) {
         setError('Enter your password.');
         return;
      }
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

   const startGitHub = async () => {
      setError(null);
      setGithubPending(true);
      try {
         await signInWithGitHub();
      } catch {
         setError(GENERIC_GITHUB_ERROR);
         setGithubPending(false);
      }
   };

   return (
      <AuthCard
         title={registering ? 'Create your account' : 'Sign in to Berry'}
         description={
            registering ? 'Use your work email. Your team can join later.' : 'Welcome back.'
         }
         topAction={
            <TopSwitch
               mode={mode}
               onSwitch={(next) => {
                  setMode(next);
                  setError(null);
               }}
            />
         }
         error={error}
         steps={registering ? { total: 3, current: 0 } : undefined}
      >
         <form className="flex flex-col gap-3.5" onSubmit={(event) => void submit(event)}>
            {registering ? (
               <AuthFieldGroup label="Name" htmlFor="register-name">
                  <AuthField
                     id="register-name"
                     autoComplete="name"
                     required
                     maxLength={80}
                     placeholder="Andrea Lunelio"
                     value={name}
                     onChange={(event) => setName(event.target.value)}
                  />
               </AuthFieldGroup>
            ) : null}
            <AuthFieldGroup label="Email" htmlFor="auth-email">
               <AuthField
                  id="auth-email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="you@company.com"
                  value={email}
                  invalid={error !== null && !emailOk}
                  onChange={(event) => {
                     setEmail(event.target.value);
                     setError(null);
                  }}
               />
            </AuthFieldGroup>
            <PasswordField
               id="auth-password"
               value={password}
               onChange={(next) => {
                  setPassword(next);
                  setError(null);
               }}
               autoComplete={registering ? 'new-password' : 'current-password'}
               placeholder={registering ? 'At least 12 characters' : '••••••••••••'}
            />
            {registering ? <PasswordStrength password={password} /> : null}
            <AuthPrimaryButton type="submit" ready={entryReady && !pending && !githubPending}>
               {pending ? 'Working…' : registering ? 'Create account' : 'Sign in'}
            </AuthPrimaryButton>
            {github ? (
               <AuthSecondaryButton
                  disabled={pending || githubPending}
                  onClick={() => void startGitHub()}
               >
                  <RiGithubFill aria-hidden className="size-4" />
                  {githubPending ? 'Opening GitHub…' : 'Continue with GitHub'}
               </AuthSecondaryButton>
            ) : null}
            {registering ? (
               <p className="m-0 text-xs leading-relaxed text-[var(--brand-slate)]">
                  By creating an account you agree to the{' '}
                  <a
                     href="https://berry.pm/terms"
                     target="_blank"
                     rel="noreferrer"
                     className="text-[#e8c15c] hover:text-[#f2d27e]"
                  >
                     Terms
                  </a>{' '}
                  and{' '}
                  <a
                     href="https://berry.pm/privacy"
                     target="_blank"
                     rel="noreferrer"
                     className="text-[#e8c15c] hover:text-[#f2d27e]"
                  >
                     Privacy Policy
                  </a>
                  .
               </p>
            ) : null}
         </form>
      </AuthCard>
   );
}

function SignInContent() {
   const params = useSearchParams();
   const returned = params.get('error');
   const returnedError = returned ? (ERROR_MESSAGES[returned] ?? GENERIC_GITHUB_ERROR) : null;
   const [options, setOptions] = useState<{
      github: boolean;
      passwordless: boolean;
      emailRegistration: boolean;
   } | null>(null);

   useEffect(() => {
      let cancelled = false;
      fetchSignInOptions()
         .then((next) => {
            if (!cancelled) {
               setOptions({
                  github: next.github,
                  passwordless: next.passwordless,
                  emailRegistration: next.emailRegistration,
               });
            }
         })
         .catch(() => {
            if (!cancelled) {
               setOptions({ github: false, passwordless: false, emailRegistration: false });
            }
         });
      return () => {
         cancelled = true;
      };
   }, []);

   useEffect(() => {
      if (params.get('github') !== '1') return;
      let cancelled = false;
      void signInWithGitHub().catch(() => {
         if (!cancelled) {
            // EmailAuth / GitHubOnly will show the banner once options load.
         }
      });
      return () => {
         cancelled = true;
      };
   }, [params]);

   if (options === null) {
      return <div className="flex min-h-full items-center justify-center bg-[var(--brand-void)]" />;
   }
   if (options.emailRegistration) {
      return <EmailAuth github={options.github} returnedError={returnedError} />;
   }
   if (options.passwordless) return <PasswordlessSignIn />;
   return <GitHubOnly returnedError={returnedError} />;
}

/** `useSearchParams` needs a Suspense boundary for the page to prerender. */
export default function SignInPage() {
   return (
      <Suspense fallback={<div className="min-h-full bg-[var(--brand-void)]" />}>
         <SignInContent />
      </Suspense>
   );
}
