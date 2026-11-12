'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authClient } from '@/lib/auth-client';
import { describeDevice, loadSessions, revokeSession, type AccountSession } from '@/lib/settings';
import { Monitor } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
   SettingsCard,
   SettingsChip,
   SettingsEmpty,
   SettingsRow,
   SettingsSection,
   SettingsShell,
} from './shared';
import { useSettingsResource } from './use-settings-resource';

/**
 * Personal"Security & access": where this account is signed in, and optional
 * authenticator 2FA for email/password accounts.
 *
 * API keys moved to their own page. They had grown a creation form with an
 * expiry, a scope picker and a one-time secret to hand over carefully, which
 * is a page's worth of decisions rather than a section under a device list.
 */
export default function AccountSecurity() {
   const sessions = useSettingsResource<AccountSession[]>(loadSessions);
   const currentId = useCurrentSessionId();

   const all = sessions.value ?? [];
   // This device first: it is the one a person looks for to orient the rest.
   const rows = [...all].sort((a, b) => Number(b.id === currentId) - Number(a.id === currentId));
   const others = all.filter((session) => session.id !== currentId);

   const signOut = async (session: AccountSession) => {
      const rest = all.filter((entry) => entry.id !== session.id);
      await sessions.mutate(rest, () => revokeSession(session.id));
   };

   // Only offered once the current session is known, so it can never sign
   // this browser out by mistake.
   const signOutOthers = async () => {
      const keep = all.filter((entry) => entry.id === currentId);
      await sessions.mutate(keep, async () => {
         for (const session of others) await revokeSession(session.id);
      });
   };

   return (
      <SettingsShell title="Security & access" description="Where you are signed in.">
         <TwoFactorSection />
         <SettingsSection
            title="Sessions"
            description={sessions.error ?? 'Devices signed in to your account.'}
            action={
               currentId && others.length > 0 ? (
                  <Button
                     variant="soft"
                     disabled={sessions.saving}
                     onClick={() => void signOutOthers()}
                  >
                     Sign out other sessions
                  </Button>
               ) : null
            }
         >
            <SettingsCard>
               {sessions.loading ? (
                  <SettingsEmpty title="Loading…" />
               ) : rows.length === 0 ? (
                  <SettingsEmpty title="No other sessions" />
               ) : (
                  rows.map((session) => {
                     const current = session.id === currentId;
                     return (
                        <SettingsRow
                           key={session.id}
                           className="py-3"
                           icon={<Monitor className="size-[15px]" strokeWidth={1.7} />}
                           title={describeDevice(session.userAgent)}
                           description={[
                              current
                                 ? 'Active now'
                                 : `Last used ${when(session.lastUsedAt ?? session.createdAt)}`,
                              session.ip,
                           ]
                              .filter(Boolean)
                              .join(' · ')}
                           trailing={
                              current ? (
                                 <SettingsChip>
                                    <span
                                       aria-hidden
                                       className="size-1.5 rounded-full bg-status-success"
                                    />
                                    This device
                                 </SettingsChip>
                              ) : (
                                 <Button
                                    variant="soft"
                                    disabled={sessions.saving}
                                    onClick={() => void signOut(session)}
                                 >
                                    Sign out
                                 </Button>
                              )
                           }
                        />
                     );
                  })
               )}
            </SettingsCard>
         </SettingsSection>
      </SettingsShell>
   );
}

function TwoFactorSection() {
   const [password, setPassword] = useState('');
   const [pending, setPending] = useState(false);
   const [error, setError] = useState<string | null>(null);
   const [enrollment, setEnrollment] = useState<{
      totpURI: string;
      backupCodes: string[];
   } | null>(null);
   const [verifyCode, setVerifyCode] = useState('');
   const [enabled, setEnabled] = useState<boolean | null>(null);

   useEffect(() => {
      let live = true;
      authClient()
         .getSession()
         .then((result) => {
            const user = result.data?.user as { twoFactorEnabled?: boolean } | undefined;
            if (live) setEnabled(user?.twoFactorEnabled === true);
         })
         .catch(() => undefined);
      return () => {
         live = false;
      };
   }, []);

   const start = async () => {
      setPending(true);
      setError(null);
      try {
         const { data, error: failed } = await authClient().twoFactor.enable({
            password,
            method: 'totp',
         });
         if (failed || !data || data.method !== 'totp') {
            throw new Error(failed?.message || 'Could not start authenticator setup');
         }
         setEnrollment({ totpURI: data.totpURI, backupCodes: data.backupCodes });
         setPassword('');
      } catch (caught) {
         setError(caught instanceof Error ? caught.message : 'Could not start authenticator setup');
      } finally {
         setPending(false);
      }
   };

   const confirm = async () => {
      setPending(true);
      setError(null);
      try {
         const { error: failed } = await authClient().twoFactor.verifyTotp({
            code: verifyCode.trim(),
         });
         if (failed) throw new Error(failed.message || 'That code did not work');
         setEnabled(true);
         setEnrollment(null);
         setVerifyCode('');
      } catch (caught) {
         setError(caught instanceof Error ? caught.message : 'That code did not work');
      } finally {
         setPending(false);
      }
   };

   const disable = async () => {
      setPending(true);
      setError(null);
      try {
         const { error: failed } = await authClient().twoFactor.disable({ password });
         if (failed) throw new Error(failed.message || 'Could not turn off 2FA');
         setEnabled(false);
         setPassword('');
      } catch (caught) {
         setError(caught instanceof Error ? caught.message : 'Could not turn off 2FA');
      } finally {
         setPending(false);
      }
   };

   return (
      <SettingsSection
         title="Two-factor authentication"
         description="An authenticator app code after email and password. GitHub sign-in is not challenged."
      >
         <SettingsCard>
            {enabled === null ? (
               <SettingsEmpty title="Loading…" />
            ) : enabled ? (
               <div className="flex flex-col gap-3 p-3">
                  <p className="text-muted-foreground">Authenticator 2FA is on for this account.</p>
                  <Input
                     // As tall as the button under it.
                     className="min-h-(--ctl-h)"
                     type="password"
                     autoComplete="current-password"
                     placeholder="Password to turn off"
                     value={password}
                     onChange={(event) => setPassword(event.target.value)}
                  />
                  <Button
                     variant="soft-destructive"
                     disabled={pending || password.length < 12}
                     onClick={() => void disable()}
                  >
                     Turn off 2FA
                  </Button>
               </div>
            ) : enrollment ? (
               <div className="flex flex-col gap-3 p-3">
                  <p className="text-muted-foreground">
                     Add this account in your authenticator app, then enter a code to finish.
                  </p>
                  <code className="break-all rounded bg-settings-field-sunken px-2.5 py-2 font-mono">
                     {enrollment.totpURI}
                  </code>
                  <div>
                     <p className="mb-1 font-medium">Backup codes</p>
                     <ul className="grid grid-cols-2 gap-1 font-mono">
                        {enrollment.backupCodes.map((code) => (
                           <li key={code}>{code}</li>
                        ))}
                     </ul>
                  </div>
                  <Input
                     // As tall as the button under it.
                     className="min-h-(--ctl-h)"
                     inputMode="numeric"
                     placeholder="6-digit code"
                     value={verifyCode}
                     onChange={(event) =>
                        setVerifyCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                     }
                  />
                  <Button
                     disabled={pending || verifyCode.length !== 6}
                     onClick={() => void confirm()}
                  >
                     Confirm authenticator
                  </Button>
               </div>
            ) : (
               <div className="flex flex-col gap-3 p-3">
                  <p className="text-muted-foreground">
                     Requires the password for this account. OAuth-only accounts cannot enable 2FA
                     here.
                  </p>
                  <Input
                     // As tall as the button under it.
                     className="min-h-(--ctl-h)"
                     type="password"
                     autoComplete="current-password"
                     placeholder="Current password"
                     value={password}
                     onChange={(event) => setPassword(event.target.value)}
                  />
                  <Button disabled={pending || password.length < 12} onClick={() => void start()}>
                     Set up authenticator
                  </Button>
               </div>
            )}
            {error ? (
               <p role="alert" className="px-3 pb-3 text-status-danger">
                  {error}
               </p>
            ) : null}
         </SettingsCard>
      </SettingsSection>
   );
}

/**
 * The id of the session this browser is signed in with, from Better Auth's own
 * session endpoint. `/me/sessions` does not mark it, so without this every row
 * would offer"Sign out", including the one that signs this tab out.
 */
function useCurrentSessionId(): string | null {
   const [id, setId] = useState<string | null>(null);
   useEffect(() => {
      let live = true;
      authClient()
         .getSession()
         .then((result) => {
            if (live) setId(result.data?.session.id ?? null);
         })
         .catch(() => undefined);
      return () => {
         live = false;
      };
   }, []);
   return id;
}

/**"3 days ago", roughly. A security page needs recency, not a timestamp. */
function when(iso: string): string {
   const then = Date.parse(iso);
   if (Number.isNaN(then)) return 'unknown';
   const minutes = Math.max(0, Math.round((Date.now() - then) / 60_000));
   if (minutes < 1) return 'just now';
   if (minutes < 60) return `${minutes}m ago`;
   const hours = Math.round(minutes / 60);
   if (hours < 24) return `${hours}h ago`;
   const days = Math.round(hours / 24);
   return days < 30 ? `${days}d ago` : `${Math.round(days / 30)}mo ago`;
}
