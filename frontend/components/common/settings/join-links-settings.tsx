'use client';

import { Copy, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { ConfirmAction } from '@/components/common/confirm-action';
import { SettingsCard, SettingsRow, SettingsSection } from '@/components/common/settings/shared';
import { useSettingsResource } from '@/components/common/settings/use-settings-resource';
import { Button } from '@/components/ui/button';
import {
   Select,
   SelectContent,
   SelectItem,
   SelectTrigger,
   SelectValue,
} from '@/components/ui/select';
import {
   createJoinLink,
   joinLinkUrl,
   loadJoinLinks,
   revokeJoinLink,
   type JoinLink,
} from '@/lib/join-links';
import { useSessionStore } from '@/store/session-store';

const LINK_ROLES = ['admin', 'member', 'viewer'] as const;

function roleKey(role: string): 'role_admin' | 'role_member' | 'role_viewer' {
   switch (role) {
      case 'admin':
         return 'role_admin';
      case 'viewer':
         return 'role_viewer';
      default:
         return 'role_member';
   }
}

function linkState(
   link: JoinLink
): 'joinLinksRevoked' | 'expired' | 'joinLinksUsedUp' | 'joinLinksActive' {
   if (link.revokedAt) return 'joinLinksRevoked';
   if (link.expiresAt && new Date(link.expiresAt) < new Date()) return 'expired';
   if (link.maxUses !== null && link.useCount >= link.maxUses) return 'joinLinksUsedUp';
   return 'joinLinksActive';
}

/**
 * Shareable join links, shown on Members rather than a separate page. The
 * token is shown once: the server keeps only a hash, so a lost link is
 * revoked and replaced.
 */
export function JoinLinksPanel() {
   const t = useTranslations('workspaceAdmin.members');
   const workspaceId = useSessionStore((state) => state.workspace?.id ?? '');
   const links = useSettingsResource<JoinLink[]>(
      () =>
         workspaceId
            ? loadJoinLinks(workspaceId)
            : Promise.reject(new Error('No workspace is selected.')),
      [workspaceId]
   );
   const [role, setRole] = useState<(typeof LINK_ROLES)[number]>('member');
   const [expiry, setExpiry] = useState('7');
   const [fresh, setFresh] = useState<string | null>(null);
   const [creating, setCreating] = useState(false);
   const [revoking, setRevoking] = useState<JoinLink | null>(null);

   const revoke = async (link: JoinLink) => {
      try {
         await revokeJoinLink(workspaceId, link.id);
         links.reload();
      } catch (cause) {
         toast.error(cause instanceof Error ? cause.message : t('joinLinksRevokeFailed'));
         throw cause;
      }
   };

   const create = async () => {
      setCreating(true);
      try {
         const created = await createJoinLink(workspaceId, {
            role,
            ...(expiry === 'never' ? {} : { expiresInDays: Number(expiry) }),
         });
         links.set([created, ...(links.value ?? [])]);
         setFresh(joinLinkUrl(created.token));
      } catch (cause) {
         toast.error(cause instanceof Error ? cause.message : t('joinLinksFailed'));
      } finally {
         setCreating(false);
      }
   };

   const copy = async (url: string) => {
      await navigator.clipboard.writeText(url);
      toast.success(t('copied'));
   };

   const listed = links.value ?? [];

   return (
      <SettingsSection
         title={t('joinLinks')}
         description={links.error ?? t('joinLinksDescription')}
      >
         <SettingsCard>
            <SettingsRow title={t('joinLinksCreate')}>
               <div className="flex flex-wrap items-center gap-2">
                  <Select
                     value={role}
                     onValueChange={(next) => setRole(next as (typeof LINK_ROLES)[number])}
                     disabled={creating}
                  >
                     <SelectTrigger className="w-36" aria-label={t('inviteRole')}>
                        <SelectValue />
                     </SelectTrigger>
                     <SelectContent>
                        {LINK_ROLES.map((candidate) => (
                           <SelectItem key={candidate} value={candidate}>
                              {t(`role_${candidate}`)}
                           </SelectItem>
                        ))}
                     </SelectContent>
                  </Select>
                  <Select value={expiry} onValueChange={setExpiry} disabled={creating}>
                     <SelectTrigger className="w-44" aria-label={t('joinLinksExpiry')}>
                        <SelectValue />
                     </SelectTrigger>
                     <SelectContent>
                        <SelectItem value="1">{t('joinLinksExpiry1')}</SelectItem>
                        <SelectItem value="7">{t('joinLinksExpiry7')}</SelectItem>
                        <SelectItem value="30">{t('joinLinksExpiry30')}</SelectItem>
                        <SelectItem value="never">{t('joinLinksExpiryNever')}</SelectItem>
                     </SelectContent>
                  </Select>
                  <Button size="xs" disabled={creating} onClick={() => void create()}>
                     {creating ? (
                        <Loader2 className="size-3.5 animate-spin" />
                     ) : (
                        t('joinLinksCreateAction')
                     )}
                  </Button>
               </div>
            </SettingsRow>
            {fresh ? (
               <SettingsRow
                  title={
                     <code className="block max-w-full truncate font-mono font-normal">
                        {fresh}
                     </code>
                  }
                  description={t('joinLinksFresh')}
                  trailing={
                     <Button size="xs" variant="secondary" onClick={() => void copy(fresh)}>
                        <Copy className="size-3.5" />
                        {t('copy')}
                     </Button>
                  }
               />
            ) : null}
            {links.loading ? <SettingsRow title={t('loading')} /> : null}
            {!links.loading && listed.length === 0 && !fresh ? (
               <SettingsRow title={t('joinLinksEmpty')} />
            ) : null}
            {listed.map((link) => {
               const state = linkState(link);
               return (
                  <SettingsRow
                     key={link.id}
                     muted={state !== 'joinLinksActive'}
                     title={t(roleKey(link.role))}
                     description={[t(state), t('joinLinksUsed', { count: link.useCount })].join(
                        ' · '
                     )}
                     trailing={
                        state === 'joinLinksActive' ? (
                           <Button
                              size="xs"
                              variant="ghost"
                              className="text-status-danger hover:text-status-danger"
                              onClick={() => setRevoking(link)}
                           >
                              {t('revoke')}
                           </Button>
                        ) : null
                     }
                  />
               );
            })}
         </SettingsCard>

         <ConfirmAction
            open={revoking !== null}
            onOpenChange={(open) => !open && setRevoking(null)}
            title={t('joinLinksRevokeTitle')}
            description={t('joinLinksRevokeBody')}
            confirmLabel={t('joinLinksRevokeAction')}
            destructive
            onConfirm={() => (revoking ? revoke(revoking) : undefined)}
         />
      </SettingsSection>
   );
}
