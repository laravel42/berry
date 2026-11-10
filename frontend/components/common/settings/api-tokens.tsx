'use client';

import { format, parseISO } from 'date-fns';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { ConfirmAction } from '@/components/common/confirm-action';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
   API_SCOPES,
   createToken,
   loadTokens,
   revokeToken,
   type PersonalToken,
} from '@/lib/settings';
import { cn } from '@/lib/utils';
import {
   SelectMenu,
   SettingsCard,
   SettingsEmpty,
   SettingsFooter,
   SettingsRow,
   SettingsSection,
   SettingsShell,
} from './shared';
import { useSettingsResource } from './use-settings-resource';

/** The expiry choices, as the select's values. `never` carries no expiry. */
const EXPIRIES = ['30', '90', '365', 'never'] as const;
type Expiry = (typeof EXPIRIES)[number];

const EXPIRY_LABEL: Record<Expiry, 'expiry30' | 'expiry90' | 'expiry365' | 'expiryNever'> = {
   '30': 'expiry30',
   '90': 'expiry90',
   '365': 'expiry365',
   'never': 'expiryNever',
};

/**
 * Personal API keys.
 *
 * They used to share a page with the session list, where creating one was a
 * name and nothing else: no expiry, and the secret shown beside a button that
 * dismissed it in one click. A key with no expiry is the default that ages
 * worst, so the choice is offered and ninety days is what it opens on.
 *
 * The secret appears exactly once — the server keeps a hash — in a card above
 * the list. It stays until the next key is created or that key is revoked;
 * leaving the page loses it, as the card says.
 */
export default function ApiTokens() {
   const t = useTranslations('workspaceAdmin.tokens');
   const tokens = useSettingsResource<PersonalToken[]>(loadTokens);

   const [name, setName] = useState('');
   const [expiry, setExpiry] = useState<Expiry>('90');
   /** Public API scopes for the next key; null means full access. */
   const [scopes, setScopes] = useState<string[] | null>(null);
   const [creating, setCreating] = useState(false);

   /** Shown once. The server keeps a hash, so this is the only time it exists. */
   const [secret, setSecret] = useState<string | null>(null);
   const [copied, setCopied] = useState(false);
   const [revoking, setRevoking] = useState<PersonalToken | null>(null);

   const create = async () => {
      const trimmed = name.trim();
      if (trimmed === '') return;
      setCreating(true);
      try {
         const { secret: issued, record } = await createToken(
            trimmed,
            scopes,
            expiry === 'never' ? null : Number(expiry)
         );
         tokens.set([record, ...(tokens.value ?? [])]);
         setName('');
         setScopes(null);
         setExpiry('90');
         if (issued) {
            setCopied(false);
            setSecret(issued);
         } else {
            // An idempotent replay: the key exists, but its secret is gone for
            // good, so say that rather than showing an empty box.
            toast.error(t('replayed'));
         }
      } catch (cause) {
         toast.error(cause instanceof Error ? cause.message : t('createFailed'));
      } finally {
         setCreating(false);
      }
   };

   const confirmRevoke = async () => {
      if (!revoking) return;
      const rest = (tokens.value ?? []).filter((entry) => entry.id !== revoking.id);
      const ok = await tokens.mutate(rest, () => revokeToken(revoking.id));
      if (ok) setSecret(null);
      // `mutate` rolled back and said why; the dialog stays for another go.
      if (!ok) throw new Error('The key could not be revoked.');
   };

   const when = (iso: string) => format(parseISO(iso), 'd MMM yyyy');

   const describe = (token: PersonalToken) => {
      const expired = token.expiresAt !== null && new Date(token.expiresAt) < new Date();
      return [
         `${token.prefix}…`,
         t('created', { when: when(token.createdAt) }),
         token.lastUsedAt ? t('lastUsed', { when: when(token.lastUsedAt) }) : t('neverUsed'),
         token.expiresAt === null
            ? t('neverExpires')
            : expired
              ? t('expired')
              : t('expires', { when: when(token.expiresAt) }),
         token.scopes ? token.scopes.join(', ') : t('scopesFull'),
      ].join(' · ');
   };

   const scopeHint =
      scopes === null
         ? t('scopesFullHint')
         : scopes.length === 0
           ? t('scopesNoneHint')
           : t('scopesLimitedHint', { scopes: scopes.join(', ') });

   const copySecret = () => {
      void navigator.clipboard?.writeText(secret ?? '');
      setCopied(true);
   };

   return (
      <SettingsShell title={t('title')} description={t('subtitle')}>
         <SettingsSection title={t('listTitle')} description={tokens.error ?? undefined}>
            {/* The only copy of the key: shown here, above the list, until the
                next key is made or this one is revoked. */}
            {secret !== null ? (
               <div className="flex flex-col gap-2.5 rounded-[10px] bg-settings-group px-4 py-3.5">
                  <div className="flex flex-col gap-0.5">
                     <span className="font-medium">{t('secretTitle')}</span>
                     <span data-settings-type="caption" className="text-subtle-foreground">
                        {t('secretBody')}
                     </span>
                  </div>
                  <div className="flex items-center gap-2">
                     <code className="flex h-[30px] min-w-0 flex-1 items-center overflow-hidden rounded-[7px] bg-settings-field-sunken px-2.5 font-mono text-ellipsis whitespace-nowrap text-foreground">
                        {secret}
                     </code>
                     <Button variant="soft" onClick={copySecret}>
                        {copied ? t('copiedLabel') : t('copy')}
                     </Button>
                  </div>
               </div>
            ) : null}
            <SettingsCard>
               {tokens.loading ? <SettingsEmpty title={t('loading')} /> : null}
               {!tokens.loading && (tokens.value ?? []).length === 0 ? (
                  <SettingsEmpty title={t('empty')} />
               ) : null}
               {(tokens.value ?? []).map((token) => (
                  <SettingsRow
                     key={token.id}
                     title={token.name}
                     description={describe(token)}
                     trailing={
                        <Button
                           variant="soft-destructive"
                           disabled={tokens.saving}
                           onClick={() => setRevoking(token)}
                        >
                           {t('revoke')}
                        </Button>
                     }
                  />
               ))}
            </SettingsCard>
         </SettingsSection>

         <SettingsSection title={t('newTitle')} description={t('newDescription')}>
            <SettingsCard>
               <SettingsRow
                  title={t('name')}
                  trailing={
                     <Input
                        variant="settings"
                        value={name}
                        aria-label={t('name')}
                        placeholder={t('namePlaceholder')}
                        className="w-[220px]"
                        onChange={(event) => setName(event.target.value)}
                        onKeyDown={(event) => {
                           if (event.key === 'Enter') void create();
                        }}
                     />
                  }
               />
               <SettingsRow
                  title={t('expiry')}
                  description={t('expiryDescription')}
                  trailing={
                     <SelectMenu
                        aria-label={t('expiry')}
                        options={[...EXPIRIES]}
                        labels={Object.fromEntries(
                           EXPIRIES.map((option) => [option, t(EXPIRY_LABEL[option])])
                        )}
                        value={expiry}
                        onChange={(next) => setExpiry(next as Expiry)}
                     />
                  }
               />
               <SettingsRow title={t('scopes')} description={scopeHint}>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-x-4 gap-y-2.5">
                     <label className="flex cursor-pointer items-center gap-2">
                        <Checkbox
                           variant="settings"
                           checked={scopes === null}
                           onCheckedChange={(checked) => setScopes(checked === true ? null : [])}
                        />
                        {t('scopeFull')}
                     </label>
                     {API_SCOPES.map((scope) => (
                        <label
                           key={scope}
                           className={cn(
                              'flex cursor-pointer items-center gap-2',
                              scopes === null && 'cursor-default text-muted-foreground'
                           )}
                        >
                           {/* Full access includes every scope, so they read as ticked
                               (and fixed) until Full is cleared. */}
                           <Checkbox
                              variant="settings"
                              disabled={scopes === null}
                              checked={scopes === null || scopes.includes(scope)}
                              onCheckedChange={(checked) =>
                                 setScopes((current) => {
                                    const list = (current ?? []).filter((entry) => entry !== scope);
                                    return checked === true ? [...list, scope] : list;
                                 })
                              }
                           />
                           <span className="font-mono">{scope}</span>
                        </label>
                     ))}
                  </div>
               </SettingsRow>
               <SettingsFooter>
                  <Button
                     disabled={creating || name.trim() === '' || scopes?.length === 0}
                     onClick={() => void create()}
                  >
                     {creating ? (
                        <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
                     ) : (
                        t('create')
                     )}
                  </Button>
               </SettingsFooter>
            </SettingsCard>
         </SettingsSection>

         <ConfirmAction
            open={revoking !== null}
            onOpenChange={(open) => !open && setRevoking(null)}
            title={t('revokeTitle')}
            description={t('revokeBody', { name: revoking?.name ?? '' })}
            confirmLabel={t('revokeAction')}
            cancelLabel={t('cancel')}
            destructive
            onConfirm={confirmRevoke}
         />
      </SettingsShell>
   );
}
