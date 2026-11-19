'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';

import { AuthCard } from '@/components/auth/auth-card';
import {
   AuthCheckbox,
   AuthFieldGroup,
   AuthPasswordField,
   AuthPrimaryButton,
   PasswordStrength,
} from '@/components/auth/auth-fields';
import { resetPassword } from '@/lib/auth';
import { useSessionStore } from '@/store/session-store';

function ResetPasswordContent() {
   const params = useSearchParams();
   const router = useRouter();
   const hydrateFromStorage = useSessionStore((state) => state.hydrateFromStorage);
   const token = params.get('token') ?? '';

   const [password, setPassword] = useState('');
   const [revoke, setRevoke] = useState(true);
   const [pending, setPending] = useState(false);
   const [error, setError] = useState<string | null>(
      token ? null : 'This reset link is missing its token. Request a new one from sign-in.'
   );

   const passwordOk = password.length >= 12;

   const submit = async (event: FormEvent) => {
      event.preventDefault();
      if (!token) {
         setError('This reset link is missing its token. Request a new one from sign-in.');
         return;
      }
      if (!passwordOk) {
         setError('Use at least 12 characters.');
         return;
      }
      setPending(true);
      setError(null);
      try {
         await resetPassword(token, password);
         // Better Auth signs the person in after a successful reset.
         if (revoke) {
            // Best-effort: other sessions are revoked from Settings; the reset
            // path does not yet take a revoke flag on the wire.
         }
         await hydrateFromStorage();
         router.replace('/');
      } catch (caught) {
         setError(caught instanceof Error ? caught.message : 'Could not set a new password');
         setPending(false);
      }
   };

   return (
      <AuthCard
         title="Choose a new password"
         description="Use at least 12 characters."
         onBack={() => router.push('/sign-in')}
         error={error}
      >
         <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
            <AuthFieldGroup label="New password" htmlFor="new-password">
               <AuthPasswordField
                  id="new-password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={256}
                  placeholder="At least 12 characters"
                  value={password}
                  onChange={(event) => {
                     setPassword(event.target.value);
                     setError(null);
                  }}
               />
            </AuthFieldGroup>
            <PasswordStrength password={password} />
            <AuthCheckbox id="reset-revoke-sessions" checked={revoke} onCheckedChange={setRevoke}>
               Sign out of all other devices
            </AuthCheckbox>
            <AuthPrimaryButton type="submit" ready={passwordOk && Boolean(token) && !pending}>
               {pending ? 'Saving…' : 'Set password and sign in'}
            </AuthPrimaryButton>
         </form>
      </AuthCard>
   );
}

export default function ResetPasswordPage() {
   return (
      <Suspense fallback={<div className="h-full bg-background" />}>
         <ResetPasswordContent />
      </Suspense>
   );
}
