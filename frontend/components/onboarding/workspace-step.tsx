'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';

import { AuthCard } from '@/components/auth/auth-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BerryApiError } from '@/lib/api';
import { createWorkspace, slugFromWorkspaceName, updateWorkspaceSettings } from '@/lib/workspaces';

/**
 * Naming a new workspace: its name, and the address and task prefix shown as
 * they are derived, so they can be corrected before anything exists to break —
 * both are in every link and task reference afterwards.
 *
 * What remains of the first-run setup steps; the welcome, the "about you"
 * questions and the runtime choice are gone.
 */

/**
 * Slugs that would shadow a page Berry already serves.
 *
 * Workspace routes sit at the root as `/{slug}/…`, so a workspace called
 * "settings" or "invite" would be unreachable, or would make the real page
 * unreachable. Refused here rather than discovered later, when the address
 * cannot be changed at all.
 */
const RESERVED = new Set([
   'api',
   'invitations',
   'invite',
   'join',
   'login',
   'onboarding',
   'settings',
   'sign-in',
   'sign-up',
   'workspaces',
]);

const SLUG = /^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/;
const PREFIX = /^[A-Z][A-Z0-9]{1,9}$/;

/** The server's own derivation, mirrored so the field shows what it will get. */
function prefixFromName(name: string): string {
   const letters = name
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 3);
   return letters.length >= 2 && /^[A-Z]/.test(letters) ? letters : 'WS';
}

export function WorkspaceStep({
   onEntered,
   onJoin,
}: {
   /** Called with the created workspace; the parent routes in. */
   onEntered: (workspaceId: string) => Promise<void> | void;
   /** Offers joining a workspace by invitation instead, when given. */
   onJoin?: () => void;
}) {
   const t = useTranslations('workspaceAdmin.onboarding');
   const nw = useTranslations('workspaceAdmin.newWorkspace');

   const [failure, setFailure] = useState<string | null>(null);
   const [name, setName] = useState('');
   const [slug, setSlug] = useState('');
   const [slugEdited, setSlugEdited] = useState(false);
   const [prefix, setPrefix] = useState('');
   const [prefixEdited, setPrefixEdited] = useState(false);
   const [creating, setCreating] = useState(false);

   const effectiveSlug = slugEdited ? slug : slugFromWorkspaceName(name);
   const effectivePrefix = prefixEdited ? prefix : prefixFromName(name);

   const slugProblem = useMemo(() => {
      if (name.trim() === '') return null;
      if (RESERVED.has(effectiveSlug)) return nw('slugReserved');
      return SLUG.test(effectiveSlug) ? null : nw('slugInvalid');
   }, [name, effectiveSlug, nw]);
   const prefixProblem =
      name.trim() === '' || PREFIX.test(effectivePrefix) ? null : nw('prefixInvalid');
   const workspaceReady = name.trim() !== '' && slugProblem === null && prefixProblem === null;

   const create = async () => {
      setCreating(true);
      setFailure(null);
      try {
         const workspace = await createWorkspace({
            name: name.trim(),
            slug: effectiveSlug,
         });
         // Create takes no prefix — the server derives one — so a chosen one is
         // applied straight afterwards, while there are no tasks and
         // renumbering costs nothing.
         if (workspace.settings?.issuePrefix !== effectivePrefix) {
            await updateWorkspaceSettings(workspace.id, { issuePrefix: effectivePrefix }).catch(
               () => undefined
            );
         }
         await onEntered(workspace.id);
      } catch (cause) {
         setFailure(
            cause instanceof BerryApiError && cause.status === 409
               ? nw('slugTaken')
               : cause instanceof Error
                 ? cause.message
                 : nw('createFailed')
         );
      } finally {
         setCreating(false);
      }
   };

   return (
      <AuthCard title={t('workspaceTitle')} description={t('workspaceBody')}>
         <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
               <span className="font-medium">{nw('name')}</span>
               <Input
                  value={name}
                  autoFocus
                  placeholder={nw('namePlaceholder')}
                  disabled={creating}
                  onChange={(event) => setName(event.target.value)}
               />
            </label>

            <label className="flex flex-col gap-1.5">
               <span className="font-medium">{nw('slug')}</span>
               <Input
                  value={effectiveSlug}
                  className="font-mono"
                  disabled={creating}
                  aria-invalid={slugProblem !== null}
                  onChange={(event) => {
                     setSlugEdited(true);
                     setSlug(
                        event.target.value
                           .toLowerCase()
                           .replace(/[^a-z0-9-]/g, '')
                           .slice(0, 50)
                     );
                  }}
               />
               <span className={slugProblem ? 'text-status-danger' : 'text-muted-foreground'}>
                  {slugProblem ?? nw('slugHint', { url: `/${effectiveSlug || '…'}` })}
               </span>
            </label>

            <label className="flex flex-col gap-1.5">
               <span className="font-medium">{nw('prefix')}</span>
               <Input
                  value={effectivePrefix}
                  className="w-40 font-mono"
                  disabled={creating}
                  aria-invalid={prefixProblem !== null}
                  onChange={(event) => {
                     setPrefixEdited(true);
                     setPrefix(
                        event.target.value
                           .toUpperCase()
                           .replace(/[^A-Z0-9]/g, '')
                           .slice(0, 10)
                     );
                  }}
               />
               <span className={prefixProblem ? 'text-status-danger' : 'text-muted-foreground'}>
                  {prefixProblem ?? nw('prefixHint', { example: `${effectivePrefix || 'WS'}-1` })}
               </span>
            </label>

            {failure ? (
               <p role="alert" className="text-status-danger">
                  {failure}
               </p>
            ) : null}

            <Button disabled={!workspaceReady || creating} onClick={() => void create()}>
               {creating ? nw('creating') : nw('create')}
            </Button>
            {onJoin ? (
               <div className="text-center">
                  <button
                     type="button"
                     className="text-muted-foreground hover:underline"
                     onClick={onJoin}
                  >
                     {t('joinInstead')}
                  </button>
               </div>
            ) : null}
         </div>
      </AuthCard>
   );
}
