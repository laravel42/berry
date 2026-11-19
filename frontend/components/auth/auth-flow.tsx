'use client';

import { RiGithubFill } from '@remixicon/react';
import { Mail } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent, type ReactNode } from 'react';

import { AuthCard, AuthLegalNote } from '@/components/auth/auth-card';
import {
   AuthCheckbox,
   AuthField,
   AuthFieldGroup,
   AuthPasswordField,
   AuthPrimaryButton,
   AuthSecondaryButton,
   PasswordStrength,
   authLinkClass,
} from '@/components/auth/auth-fields';
import { cn } from '@/lib/utils';
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
         <p>
            No account?{' '}
            <button type="button" className={authLinkClass} onClick={() => onSwitch('signup')}>
               Sign up
            </button>
         </p>
      );
   }
   if (step === 'signup') {
      return (
         <p>
            Have an account?{' '}
            <button type="button" className={authLinkClass} onClick={() => onSwitch('signin')}>
               Sign in
            </button>
         </p>
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
   return (
      <AuthFieldGroup label="Password" htmlFor={id} trailing={trailing}>
         <AuthPasswordField
            id={id}
            autoComplete={autoComplete}
            required
            minLength={12}
            maxLength={256}
            value={value}
            placeholder={placeholder}
            onChange={(event) => onChange(event.target.value)}
         />
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
                  className={cn(
                     'flex h-13 items-center justify-center rounded-xl border bg-card font-mono font-semibold shadow-xs',
                     active ? 'border-primary' : filled ? 'border-foreground/30' : 'border-input'
                  )}
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
                  aria-label={backup ? 'Backup code' : 'Authentication code'}
               />
               {!backup ? (
                  <AuthCheckbox id="auth-trust-device" checked={trust} onCheckedChange={setTrust}>
                     Trust this device for 30 days
                  </AuthCheckbox>
               ) : null}
               <AuthPrimaryButton
                  type="submit"
                  ready={(backup ? code.length >= 8 : code.length === 6) && !pending}
               >
                  {pending ? 'Verifying…' : 'Verify'}
               </AuthPrimaryButton>
               <div className="flex justify-between gap-3 text-muted-foreground">
                  <span>{backup ? 'Lost your codes?' : 'Lost your device?'}</span>
                  <button
                     type="button"
                     className={authLinkClass}
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
            <form className="flex flex-col gap-4" onSubmit={(event) => void sendReset(event)}>
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
               <div className="flex items-center gap-3 rounded-xl border bg-muted/40 p-3.5">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                     <Mail aria-hidden className="size-4" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                     <span className="truncate font-medium">{email || 'you@company.com'}</span>
                     <span className="text-2xs text-subtle-foreground">
                        Link expires in 15 minutes
                     </span>
                  </span>
               </div>
               <p className="m-0 text-muted-foreground">
                  Nothing arrived? Check spam, or{' '}
                  <button
                     type="button"
                     className={authLinkClass}
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
         aside={
            <>
               {options.emailRegistration ? (
                  <TopSwitch
                     step={step}
                     onSwitch={(next) => {
                        go(next);
                        setPassword('');
                     }}
                  />
               ) : null}
               <AuthLegalNote />
            </>
         }
         error={error}
         steps={registering ? { total: 3, current: 0 } : undefined}
      >
         <form className="flex flex-col gap-4" onSubmit={(event) => void submitEntry(event)}>
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
                     <button type="button" className={authLinkClass} onClick={() => go('forgot')}>
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
                  <Mail aria-hidden />
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
         </form>
      </AuthCard>
   );
}
