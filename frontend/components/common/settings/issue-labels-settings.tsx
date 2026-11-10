'use client';

import {
   AlertDialog,
   AlertDialogAction,
   AlertDialogCancel,
   AlertDialogContent,
   AlertDialogDescription,
   AlertDialogFooter,
   AlertDialogHeader,
   AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
   archiveLabel,
   createLabel,
   loadLabels,
   updateLabel,
   type WorkspaceLabel,
} from '@/lib/settings';
import { useSessionStore } from '@/store/session-store';
import { Loader2, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { LABEL_PALETTE } from './label-palette';
import {
   SettingsCard,
   SettingsEmpty,
   SettingsIconButton,
   SettingsSearch,
   SettingsShell,
} from './shared';
import { useSettingsResource } from './use-settings-resource';

/**
 * Workspace labels: the vocabulary a task can be tagged with.
 *
 * These are rows in a table the workspace owns — created, renamed, recoloured,
 * removed. Removing a label archives it, and the confirmation says how many
 * tasks carry it, because that is the number that decides whether removing it
 * is a tidy-up or a loss. A label already on a task has to stay nameable, or
 * every task carrying it renders a blank chip; the name becomes free again
 * either way, because the uniqueness index only covers live rows.
 */

const PALETTE = LABEL_PALETTE;

export default function IssueLabelsSettings() {
   const t = useTranslations('workspaceAdmin.labels');
   const workspace = useSessionStore((state) => state.workspace);
   const workspaceId = workspace?.id ?? '';

   const labels = useSettingsResource<WorkspaceLabel[]>(
      () =>
         workspaceId
            ? loadLabels(workspaceId)
            : Promise.reject(new Error('No workspace is selected.')),
      [workspaceId]
   );

   const [query, setQuery] = useState('');
   const [name, setName] = useState('');
   const [creating, setCreating] = useState(false);
   const [removing, setRemoving] = useState<WorkspaceLabel | null>(null);

   const rows = useMemo(() => {
      const needle = query.trim().toLowerCase();
      return (labels.value ?? [])
         .filter((label) => label.name.toLowerCase().includes(needle))
         .sort((a, b) => a.name.localeCompare(b.name));
   }, [labels.value, query]);

   const create = async () => {
      const trimmed = name.trim();
      if (trimmed === '') return;
      setCreating(true);
      try {
         // A colour per label, chosen from the palette by name so the same
         // label is the same colour on every workspace that has it.
         const colour = PALETTE[hash(trimmed) % PALETTE.length]!;
         const saved = await createLabel(workspaceId, { name: trimmed, color: colour });
         labels.set([...(labels.value ?? []), saved]);
         setName('');
      } catch (cause) {
         toast.error(cause instanceof Error ? cause.message : t('createFailed'));
      } finally {
         setCreating(false);
      }
   };

   const recolour = (label: WorkspaceLabel, next: string) => {
      if (!/^#[0-9a-f]{6}$/.test(next) || next === label.color) return;
      void labels.mutate(
         (labels.value ?? []).map((entry) =>
            entry.id === label.id ? { ...entry, color: next } : entry
         ),
         () => updateLabel(workspaceId, label.id, { color: next }).then(() => undefined)
      );
   };

   const rename = (label: WorkspaceLabel, next: string) => {
      const trimmed = next.trim();
      if (trimmed === '' || trimmed === label.name) return;
      void labels.mutate(
         (labels.value ?? []).map((entry) =>
            entry.id === label.id ? { ...entry, name: trimmed } : entry
         ),
         () => updateLabel(workspaceId, label.id, { name: trimmed }).then(() => undefined)
      );
   };

   const archive = (label: WorkspaceLabel) => {
      setRemoving(null);
      void labels.mutate(
         (labels.value ?? []).filter((entry) => entry.id !== label.id),
         () => archiveLabel(workspaceId, label.id)
      );
   };

   return (
      <SettingsShell compact title={t('title')} description={t('issueLead')}>
         <div className="flex flex-wrap items-center gap-2.5">
            <SettingsSearch
               className="min-w-[180px]"
               placeholder={t('filter')}
               value={query}
               onChange={setQuery}
            />
            <div className="flex shrink-0 items-center gap-2">
               <Input
                  variant="settings"
                  placeholder={t('newLabel')}
                  aria-label={t('newLabel')}
                  value={name}
                  disabled={!workspaceId}
                  className="w-[180px]"
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => {
                     if (event.key === 'Enter') void create();
                  }}
               />
               <Button disabled={creating || name.trim() === ''} onClick={() => void create()}>
                  {creating ? <Loader2 className="size-3.5 animate-spin" /> : t('create')}
               </Button>
            </div>
         </div>

         <SettingsCard>
            {labels.error ? <SettingsEmpty title={labels.error} /> : null}
            {rows.map((label) => (
               <div
                  key={label.id}
                  className="flex min-h-[42px] min-w-0 items-center gap-3 pr-2 pl-4 transition-colors hover:bg-settings-row-hover"
               >
                  <Popover>
                     <PopoverTrigger
                        aria-label={t('changeColour', { name: label.name })}
                        className="size-2.5 shrink-0 cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-settings-group"
                        style={{ backgroundColor: label.color }}
                     />
                     <PopoverContent align="start" className="w-auto p-3">
                        <div className="grid grid-cols-4 gap-2">
                           {PALETTE.map((colour) => (
                              <button
                                 key={colour}
                                 type="button"
                                 aria-label={colour}
                                 className="size-6 rounded-full ring-offset-2 ring-offset-popover hover:ring-2 hover:ring-ring"
                                 style={{ backgroundColor: colour }}
                                 onClick={() => recolour(label, colour)}
                              />
                           ))}
                        </div>
                        {/* Any colour, not only the eight: a team with a
                            palette of its own should not have to pick the
                            nearest one Berry happens to ship. */}
                        <label className="mt-3 flex items-center gap-2">
                           <input
                              type="color"
                              value={label.color}
                              aria-label={t('customColour')}
                              className="size-7 cursor-pointer rounded border bg-transparent"
                              onChange={(event) =>
                                 recolour(label, event.target.value.toLowerCase())
                              }
                           />
                           <span className="text-muted-foreground">{t('customColour')}</span>
                        </label>
                     </PopoverContent>
                  </Popover>
                  {/* The name is the rename field; it reads as plain text until
                      it is pointed at. */}
                  <input
                     defaultValue={label.name}
                     aria-label={t('rename', { name: label.name })}
                     className="-ml-1.5 h-[26px] min-w-0 flex-1 truncate rounded-[6px] border border-transparent bg-transparent px-1.5 text-foreground outline-none [font:inherit] hover:border-settings-field-line focus-visible:border-settings-field-focus focus-visible:bg-settings-field"
                     onBlur={(event) => rename(label, event.target.value)}
                     onKeyDown={(event) => {
                        if (event.key === 'Enter') event.currentTarget.blur();
                        if (event.key === 'Escape') {
                           event.currentTarget.value = label.name;
                           event.currentTarget.blur();
                        }
                     }}
                  />
                  <span
                     data-settings-type="caption"
                     className="shrink-0 whitespace-nowrap text-subtle-foreground tabular-nums"
                  >
                     {label.usageCount === undefined
                        ? '—'
                        : t('usageCount', { count: label.usageCount })}
                  </span>
                  <SettingsIconButton
                     label={t('remove')}
                     destructive
                     disabled={labels.saving}
                     onClick={() => setRemoving(label)}
                  >
                     <Trash2 />
                  </SettingsIconButton>
               </div>
            ))}
            {!labels.loading && rows.length === 0 && !labels.error ? (
               <SettingsEmpty title={query.trim() === '' ? t('empty') : t('noMatch')} />
            ) : null}
         </SettingsCard>

         <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
            <AlertDialogContent>
               <AlertDialogHeader>
                  <AlertDialogTitle>
                     {t('removeTitle', { name: removing?.name ?? '' })}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                     {removing?.usageCount === undefined
                        ? t('removeBodyUnknown')
                        : t('removeBody', { count: removing.usageCount })}
                  </AlertDialogDescription>
               </AlertDialogHeader>
               <AlertDialogFooter>
                  <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => removing && archive(removing)}>
                     {t('remove')}
                  </AlertDialogAction>
               </AlertDialogFooter>
            </AlertDialogContent>
         </AlertDialog>
      </SettingsShell>
   );
}

/** Stable across reloads, so a label keeps the colour it was created with. */
function hash(value: string): number {
   let total = 0;
   for (const character of value) total = (total * 31 + character.charCodeAt(0)) >>> 0;
   return total;
}
