'use client';

import { Button } from '@/components/ui/button';
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
 * Personal "Security & access": where this account is signed in.
 *
 * The passkey and commit-signing sections this page used to show are gone.
 * Berry has neither, and a button that opens nothing on a security page is
 * worse than an absent one — it suggests a protection that is not there.
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

/**
 * The id of the session this browser is signed in with, from Better Auth's own
 * session endpoint. `/me/sessions` does not mark it, so without this every row
 * would offer "Sign out", including the one that signs this tab out.
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

/** "3 days ago", roughly. A security page needs recency, not a timestamp. */
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
