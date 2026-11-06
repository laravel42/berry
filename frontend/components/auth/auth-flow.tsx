'use client';

import { RiGithubFill } from '@remixicon/react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent, type ReactNode } from 'react';

import { AuthCard } from '@/components/auth/auth-card';
import {
   AuthField,
   AuthFieldGroup,
   AuthPrimaryButton,
   AuthSecondaryButton,
   PasswordStrength,
} from '@/components/auth/auth-fields';
import {
   requestMagicLink,
   requestPasswordReset,
   registerWithEmail,
   signInWithEmail,
   signInWithGitHub,
   verifyTwoFactorBackup,
   verifyTwoFactorTotp,
   type SignInOptions,
} from '@/lib/auth';
import { useSessionStore } from '@/store/session-store';

const EMAIL_OK = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type AuthStep = 'signin' | 'signup' | 'forgot' | 'sent' | 'twofa' | 'twofa-backup';

type SentKind = 'magic' | 'reset';

function TopSwitch({
   step,
   onSwitch,
}: {
   step: AuthStep;
   onSwitch: (next: 'signin' | 'signup') => void;
}) {
   if (step === 'signin') {
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
   if (step === 'signup') {
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
   return null;
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
               className="flex h-[30px] items-center rounded-md px-2 text-[var(--brand-ash)] hover:bg-[#242428] hover:text-[var(--brand-chalk)]"
               onClick={() => setShow((current) => !current)}
            >
               {show ? 'Hide' : 'Show'}
            </button>
         </div>
      </AuthFieldGroup>
   );
}

function CodeCells({ code }: { code: string }) {
   return (
      <div className="grid grid-cols-6 gap-2" aria-hidden>
         {Array.from({ length: 6 }, (_, index) => {
            const filled = code[index] ?? '';
            const active = index === code.length;
            return (
               <span
                  key={index}
                  data-auth-code-cell
                  className="flex h-[52px] items-center justify-center rounded-[10px] border bg-[#19191c] font-semibold"

                  style={{
                     borderColor: active ? '#e3b341' : filled ? '#3a3a40' : '#2e2e33',
                  }}
               >
                  {filled}
               </span>
            );
         })}
      </div>
   );
}

export function AuthFlow({
   options,
   initialStep = 'signin',
   returnedError = null,
}: {
   options: SignInOptions;
   initialStep?: AuthStep;
   returnedError?: string | null;
}) {
   const router = useRouter();
   const hydrateFromStorage = useSessionStore((state) => state.hydrateFromStorage);

   const [step, setStep] = useState<AuthStep>(initialStep);
   const [name, setName] = useState('');
   const [email, setEmail] = useState('');
   const [password, setPassword] = useState('');
   const [code, setCode] = useState('');
   const [trust, setTrust] = useState(true);
   const [sentKind, setSentKind] = useState<SentKind>('magic');
   const [pending, setPending] = useState(false);
   const [error, setError] = useState<string | null>(returnedError);

   const emailOk = EMAIL_OK.test(email.trim());
   const passwordOk = password.length >= 12;
   const registering = step === 'signup';
   const entryReady =
      emailOk && (registering ? passwordOk && name.trim() !== '' : password.length > 0);

   const go = (next: AuthStep) => {
      setStep(next);
      setError(null);
      setCode('');
   };

   const afterSession = async () => {
      await hydrateFromStorage();
      router.push('/');
   };

   const submitEntry = async (event: FormEvent) => {
      event.preventDefault();
      if (!emailOk) {
         setError('Enter a valid email address.');
         return;
      }
      if (registering) {
         if (name.trim() === '') {
            setError('Enter your name.');
            return;
         }
         if (!passwordOk) {
            setError('Use at least 12 characters for your password.');
            return;
         }
      } else if (password.length === 0) {
         setError('Enter your password.');
         return;
      }
      setPending(true);
      setError(null);
      try {
         if (registering) {
            await registerWithEmail({ name, email, password });
            await afterSession();
         } else {
            await signInWithEmail(email, password);
            // 2FA redirects via the client plugin; otherwise hydrate.
            if (!window.location.search.includes('step=twofa')) {
               await afterSession();
            }
         }
      } catch (caught) {
         setError(caught instanceof Error ? caught.message : 'Could not sign in');
         setPending(false);
      }
   };

   const sendMagic = async () => {
      if (!emailOk) {
         setError('Enter your email first and we will send a link.');
         return;
      }
      setPending(true);
      setError(null);
      try {
         await requestMagicLink(email);
         setSentKind('magic');
         go('sent');
         setPending(false);
      } catch (caught) {
         setError(caught instanceof Error ? caught.message : 'Could not send a sign-in link');
         setPending(false);
      }
   };

   const sendReset = async (event: FormEvent) => {
      event.preventDefault();
      if (!emailOk) {
         setError('Enter a valid email address.');
         return;
      }
      setPending(true);
      setError(null);
      try {
         await requestPasswordReset(email);
         setSentKind('reset');
         go('sent');
         setPending(false);
      } catch (caught) {
         setError(caught instanceof Error ? caught.message : 'Could not send a reset link');
         setPending(false);
      }
   };

   const submitTwoFa = async (event: FormEvent) => {
      event.preventDefault();
      if (code.length !== 6) return;
      setPending(true);
      setError(null);
      try {
         if (step === 'twofa-backup') {
            await verifyTwoFactorBackup(code);
         } else {
            await verifyTwoFactorTotp(code, trust);
         }
         await afterSession();
      } catch (caught) {
         setError(caught instanceof Error ? caught.message : 'That code did not work');
         setPending(false);
      }
   };

   if (step === 'twofa' || step === 'twofa-backup') {
      const backup = step === 'twofa-backup';
      return (
         <AuthCard
            title={backup ? 'Backup code' : 'Two-factor authentication'}
            description={
               backup
                  ? 'Enter one of the backup codes you saved when you enabled 2FA.'
                  : 'Enter the code from your authenticator app.'
            }
            onBack={() => go('signin')}
            error={error}
         >
            <form className="flex flex-col gap-4" onSubmit={(event) => void submitTwoFa(event)}>
               <CodeCells code={code} />
               <AuthField
                  inputMode="numeric"
                  autoFocus
                  placeholder="Type the 6-digit code"
                  value={code}
                  maxLength={backup ? 12 : 6}
                  onChange={(event) =>
                     setCode(
                        backup
                           ? event.target.value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)
                           : event.target.value.replace(/\D/g, '').slice(0, 6)
                     )
                  }
                  className="h-9 border-dashed bg-transparent text-[var(--brand-ash)]"
               />
               {!backup ? (
                  <label className="flex cursor-pointer items-center gap-2.5 text-[var(--brand-ash)]">
                     <button
                        type="button"
                        role="checkbox"
                        aria-checked={trust}
                        onClick={() => setTrust((current) => !current)}
                        className="flex size-4 items-center justify-center rounded border"
                        style={{
                           borderColor: trust ? '#e3b341' : '#3a3a40',
                           background: trust ? '#e3b341' : 'transparent',
                        }}
                     >
                        {trust ? (
                           <svg
                              width="10"
                              height="10"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="#111113"
                              strokeWidth="3"
                              aria-hidden
                           >
                              <path d="M5 12l5 5 9-10" />
                           </svg>
                        ) : null}
                     </button>
                     Trust this device for 30 days
                  </label>
               ) : null}
               <AuthPrimaryButton
                  type="submit"
                  ready={(backup ? code.length >= 8 : code.length === 6) && !pending}
               >
                  {pending ? 'Verifying…' : 'Verify'}
               </AuthPrimaryButton>
               <div className="flex justify-between text-[var(--brand-slate)]">
                  <span>{backup ? 'Lost your codes?' : 'Lost your device?'}</span>
                  <button
                     type="button"
                     className="text-[#e8c15c] hover:text-[#f2d27e]"
                     onClick={() => go(backup ? 'twofa' : 'twofa-backup')}
                  >
                     {backup ? 'Use authenticator' : 'Use a backup code'}
                  </button>
               </div>
            </form>
         </AuthCard>
      );
   }

   if (step === 'forgot') {
      return (
         <AuthCard
            title="Reset your password"
            description="We’ll email you a link to choose a new one."
            onBack={() => go('signin')}
            error={error}
         >
            <form className="flex flex-col gap-3.5" onSubmit={(event) => void sendReset(event)}>
               <AuthFieldGroup label="Email" htmlFor="forgot-email">
                  <AuthField
                     id="forgot-email"
                     type="email"
                     autoComplete="email"
                     required
                     placeholder="you@company.com"
                     value={email}
                     onChange={(event) => {
                        setEmail(event.target.value);
                        setError(null);
                     }}
                  />
               </AuthFieldGroup>
               <AuthPrimaryButton type="submit" ready={emailOk && !pending}>
                  {pending ? 'Sending…' : 'Send reset link'}
               </AuthPrimaryButton>
            </form>
         </AuthCard>
      );
   }

   if (step === 'sent') {
      return (
         <AuthCard
            title={sentKind === 'magic' ? 'Check your inbox' : 'Reset link sent'}
            description={
               sentKind === 'magic'
                  ? 'Click the link in the email to sign in. You can close this tab.'
                  : 'Follow the link in the email to choose a new password.'
            }
            onBack={() => go(sentKind === 'magic' ? 'signin' : 'forgot')}
         >
            <div className="flex flex-col gap-3">
               <div className="flex items-center gap-3 rounded-[10px] border border-[#2a2a2f] bg-[#19191c] p-3.5">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-[#242428]">
                     <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#a9a7ad"
                        strokeWidth="1.8"
                        aria-hidden
                     >
                        <path d="M3 6h18v12H3zM3 7l9 6 9-6" />
                     </svg>
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                     <span className="truncate font-medium">{email || 'you@company.com'}</span>
                     <span className="text-[var(--brand-slate)]">Link expires in 15 minutes</span>
                  </span>
               </div>
               <p className="m-0 text-[var(--brand-slate)]">
                  Nothing arrived? Check spam, or{' '}
                  <button
                     type="button"
                     className="text-[#e8c15c] hover:text-[#f2d27e]"
                     onClick={() => go(sentKind === 'magic' ? 'signin' : 'forgot')}
                  >
                     use another email
                  </button>
                  .
               </p>
            </div>
         </AuthCard>
      );
   }

   const title = registering ? 'Create your account' : 'Sign in to Berry';
   const description = registering
      ? 'Use your work email. Your team can join later.'
      : 'Welcome back.';

   return (
      <AuthCard
         title={title}
         description={description}
         topAction={
            options.emailRegistration ? (
               <TopSwitch
                  step={step}
                  onSwitch={(next) => {
                     go(next);
                     setPassword('');
                  }}
               />
            ) : undefined
         }
         error={error}
         steps={registering ? { total: 3, current: 0 } : undefined}
      >
         <form className="flex flex-col gap-3.5" onSubmit={(event) => void submitEntry(event)}>
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
               trailing={
                  !registering && options.passwordReset ? (
                     <button
                        type="button"
                        className="text-[#e8c15c] hover:text-[#f2d27e]"
                        onClick={() => go('forgot')}
                     >
                        Forgot?
                     </button>
                  ) : undefined
               }
            />
            {registering ? <PasswordStrength password={password} /> : null}
            <AuthPrimaryButton type="submit" ready={entryReady && !pending}>
               {pending ? 'Working…' : registering ? 'Create account' : 'Sign in'}
            </AuthPrimaryButton>
            {!registering && options.magicLink ? (
               <AuthSecondaryButton disabled={pending} onClick={() => void sendMagic()}>
                  <svg
                     width="14"
                     height="14"
                     viewBox="0 0 24 24"
                     fill="none"
                     stroke="currentColor"
                     strokeWidth="1.8"
                     aria-hidden
                  >
                     <path d="M3 6h18v12H3zM3 7l9 6 9-6" />
                  </svg>
                  Email me a sign-in link
               </AuthSecondaryButton>
            ) : null}
            {options.github ? (
               <AuthSecondaryButton
                  disabled={pending}
                  onClick={() => {
                     setPending(true);
                     void signInWithGitHub().catch((caught: unknown) => {
                        setError(
                           caught instanceof Error
                              ? caught.message
                              : 'We could not sign you in with GitHub.'
                        );
                        setPending(false);
                     });
                  }}
               >
                  <RiGithubFill aria-hidden className="size-4" />
                  Continue with GitHub
               </AuthSecondaryButton>
            ) : null}
            {registering ? (
               <p className="m-0 leading-relaxed text-[var(--brand-slate)]">
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
