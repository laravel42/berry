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
import { Switch } from '@/components/ui/switch';
import {
   archiveProperty,
   createProperty,
   loadProperties,
   MAX_ACTIVE_PROPERTIES,
   PROPERTY_KIND_LABELS,
   PROPERTY_KINDS,
   updateProperty,
   type PropertyDefinition,
   type PropertyKind,
} from '@/lib/properties';
import { useSessionStore } from '@/store/session-store';
import { Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { DEFAULT_LABEL_COLOR, OPTION_PALETTE } from './label-palette';
import {
   SelectMenu,
   SettingsCard,
   SettingsChip,
   SettingsEmpty,
   SettingsIconButton,
   SettingsSection,
   SettingsShell,
} from './shared';
import { useSettingsResource } from './use-settings-resource';

/**
 * Workspace task fields.
 *
 * Kind is fixed at creation: stored values were checked against it, and a
 * field that changed type would be a field whose existing values no longer
 * mean anything. Options are typed as a comma list; ids are derived from
 * names.
 *
 * Removing is a soft delete, so the values already on tasks survive it and
 * come back if the field does. That is only true if there is a way back, so
 * the archived rows are listed behind a toggle and can be restored.
 *
 * The count beside the heading is the point of the bound. Every active field
 * is a row in the task panel that everybody carries, so the cost of one more
 * is not paid by whoever adds it.
 */
const OPTION_COLORS = OPTION_PALETTE;

function optionsFrom(raw: string) {
   return raw
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean)
      .map((name, index) => ({
         id:
            name
               .toLowerCase()
               .replace(/[^a-z0-9]+/g, '-')
               .replace(/^-+|-+$/g, '')
               .slice(0, 40) || `option-${index}`,
         name,
         color: OPTION_COLORS[index % OPTION_COLORS.length] ?? DEFAULT_LABEL_COLOR,
      }));
}

export default function IssuePropertiesSettings() {
   const t = useTranslations('workspaceAdmin.properties');
   const workspaceId = useSessionStore((state) => state.workspace?.id ?? '');
   const properties = useSettingsResource<PropertyDefinition[]>(
      () =>
         workspaceId
            ? loadProperties(workspaceId, true)
            : Promise.reject(new Error('No workspace is selected.')),
      [workspaceId]
   );
   const [name, setName] = useState('');
   const [kind, setKind] = useState<PropertyKind>('text');
   const [options, setOptions] = useState('');
   const [creating, setCreating] = useState(false);
   const [showArchived, setShowArchived] = useState(false);
   const [removing, setRemoving] = useState<PropertyDefinition | null>(null);
   const isSelect = kind === 'select' || kind === 'multi_select';

   const all = useMemo(() => properties.value ?? [], [properties.value]);
   const active = useMemo(() => all.filter((entry) => entry.archivedAt === null), [all]);
   const archived = useMemo(() => all.filter((entry) => entry.archivedAt !== null), [all]);
   const full = active.length >= MAX_ACTIVE_PROPERTIES;

   const replace = (next: PropertyDefinition) =>
      all.map((entry) => (entry.id === next.id ? next : entry));

   const create = async () => {
      if (!name.trim()) return;
      setCreating(true);
      try {
         const created = await createProperty(workspaceId, {
            name: name.trim(),
            kind,
            ...(isSelect ? { options: optionsFrom(options) } : {}),
         });
         properties.set([...all, created]);
         setName('');
         setOptions('');
      } catch (cause) {
         toast.error(cause instanceof Error ? cause.message : t('createFailed'));
      } finally {
         setCreating(false);
      }
   };

   const remove = (property: PropertyDefinition) => {
      setRemoving(null);
      void properties.mutate(replace({ ...property, archivedAt: new Date().toISOString() }), () =>
         archiveProperty(workspaceId, property.id)
      );
   };

   const restore = async (property: PropertyDefinition) => {
      try {
         const restored = await updateProperty(workspaceId, property.id, { archived: false });
         properties.set(replace(restored));
      } catch (cause) {
         // The commonest reason is the bound: the workspace filled up while
         // this one was away, and saying so is more use than "failed".
         toast.error(cause instanceof Error ? cause.message : t('restoreFailed'));
      }
   };

   const line = (property: PropertyDefinition) => (
      <div
         key={property.id}
         className="flex min-h-[42px] min-w-0 items-center gap-3 py-1.5 pr-2 pl-4 transition-colors hover:bg-settings-row-hover"
      >
         <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-medium">{property.name}</span>
            {property.options.length > 0 ? (
               <span data-settings-type="caption" className="truncate text-subtle-foreground">
                  {property.options.map((option) => option.name).join(', ')}
               </span>
            ) : null}
         </span>
         <SettingsChip>{PROPERTY_KIND_LABELS[property.kind]}</SettingsChip>
         {property.archivedAt === null ? (
            <SettingsIconButton
               label={t('remove')}
               destructive
               onClick={() => setRemoving(property)}
            >
               <Trash2 />
            </SettingsIconButton>
         ) : (
            <Button variant="quiet" onClick={() => void restore(property)}>
               {t('restore')}
            </Button>
         )}
      </div>
   );

   return (
      <SettingsShell title={t('title')} description={t('lead')}>
         <SettingsSection title={t('newTitle')} description={t('kindIsFixed')}>
            <SettingsCard>
               <div className="flex flex-col gap-2 px-4 py-3.5">
                  <div className="flex flex-wrap items-center gap-2">
                     <Input
                        variant="settings"
                        placeholder={t('namePlaceholder')}
                        aria-label={t('namePlaceholder')}
                        value={name}
                        disabled={full}
                        className="min-w-[180px] flex-1"
                        onChange={(event) => setName(event.target.value)}
                        onKeyDown={(event) => {
                           if (event.key === 'Enter') void create();
                        }}
                     />
                     <SelectMenu
                        className="w-[140px]"
                        aria-label={t('kindLabel')}
                        options={[...PROPERTY_KINDS]}
                        labels={PROPERTY_KIND_LABELS}
                        value={kind}
                        disabled={full}
                        onChange={(value) => setKind(value as PropertyKind)}
                     />
                     <Button
                        onClick={() => void create()}
                        disabled={creating || full || !name.trim() || (isSelect && !options.trim())}
                     >
                        {t('add')}
                     </Button>
                  </div>
                  {isSelect ? (
                     <Input
                        variant="settings"
                        placeholder={t('optionsPlaceholder')}
                        aria-label={t('optionsPlaceholder')}
                        value={options}
                        disabled={full}
                        onChange={(event) => setOptions(event.target.value)}
                     />
                  ) : null}
                  {full ? (
                     <p data-settings-type="caption" className="text-status-danger">
                        {t('atCapacity')}
                     </p>
                  ) : null}
               </div>
            </SettingsCard>
         </SettingsSection>

         <SettingsSection
            title={t('fieldsTitle')}
            description={
               <span className={full ? 'text-status-danger' : undefined}>
                  {t('counter', { used: active.length, max: MAX_ACTIVE_PROPERTIES })}
               </span>
            }
         >
            <SettingsCard>
               {properties.error ? <SettingsEmpty title={properties.error} /> : null}
               {active.map(line)}
               {active.length === 0 && !properties.loading && !properties.error ? (
                  <SettingsEmpty title={t('empty')} />
               ) : null}
            </SettingsCard>
            {archived.length > 0 ? (
               <label className="flex w-fit cursor-pointer items-center gap-2 pt-1">
                  <Switch
                     variant="settings"
                     checked={showArchived}
                     onCheckedChange={setShowArchived}
                  />
                  <span>{t('showArchived', { count: archived.length })}</span>
               </label>
            ) : null}
            {archived.length > 0 && showArchived ? (
               <>
                  <p data-settings-type="caption" className="text-subtle-foreground">
                     {t('archivedLead')}
                  </p>
                  <SettingsCard>{archived.map(line)}</SettingsCard>
               </>
            ) : null}
         </SettingsSection>

         <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
            <AlertDialogContent>
               <AlertDialogHeader>
                  <AlertDialogTitle>
                     {t('removeTitle', { name: removing?.name ?? '' })}
                  </AlertDialogTitle>
                  <AlertDialogDescription>{t('removeBody')}</AlertDialogDescription>
               </AlertDialogHeader>
               <AlertDialogFooter>
                  <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => removing && remove(removing)}>
                     {t('remove')}
                  </AlertDialogAction>
               </AlertDialogFooter>
            </AlertDialogContent>
         </AlertDialog>
      </SettingsShell>
   );
}
