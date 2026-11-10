'use client';

import { Building2, Check, ChevronDown, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import {
   EmptyState,
   EmptyStateLoading,
   EmptyStateMark,
   EmptyStateText,
} from '@/components/common/empty-state';
import { useSettingsResource } from '@/components/common/settings/use-settings-resource';
import MainLayout from '@/components/layout/main-layout';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
   Command,
   CommandEmpty,
   CommandGroup,
   CommandInput,
   CommandItem,
   CommandList,
} from '@/components/ui/command';
import { Input, searchFieldClass } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { loadWorkspaceAgents } from '@/lib/agents';
import {
   addRole,
   DEPARTMENT_ORDER,
   getOrganization,
   ORGANIZATION_CHANGED,
} from '@/lib/organization';
import { cn } from '@/lib/utils';
import { useAgentsStore } from '@/store/agents-store';
import { useSessionStore } from '@/store/session-store';

/** The action column, always shown: Add. */
const ACTION_WIDTH = 'w-20';

/** One catalogue role the workspace does not have yet. Roles it has are on the Agents page. */
interface CatalogEntry {
   roleKey: string;
   name: string;
   role: string;
   department: string;
   mission: string;
}

function departmentRank(department: string): number {
   const index = (DEPARTMENT_ORDER as readonly string[]).indexOf(department);
   return index === -1 ? DEPARTMENT_ORDER.length : index;
}

/**
 * The agent catalogue: a searchable list in one accordion per department, a
 * department multiselect, an Add button per row and a bar for adding several
 * at once. Rows are not links: Add is the one thing a row does.
 */
function AgentCatalogScreen() {
   const t = useTranslations('agents.catalog');
   const tOrg = useTranslations('organization');
   const organization = useSettingsResource(getOrganization);
   const reload = organization.reload;
   const hydrateAgents = useAgentsStore((state) => state.hydrateAgents);
   const workspaceRole = useSessionStore((state) => state.workspace?.role);
   const canEdit = workspaceRole === 'owner' || workspaceRole === 'admin';

   const [query, setQuery] = useState('');
   /** Empty means every department; otherwise only these keys. */
   const [departments, setDepartments] = useState<string[]>([]);
   const [sortDescending, setSortDescending] = useState(false);
   const [selection, setSelection] = useState<string[]>([]);
   const [adding, setAdding] = useState<string[]>([]);

   // A role added from its drawer leaves the catalogue.
   useEffect(() => {
      window.addEventListener(ORGANIZATION_CHANGED, reload);
      return () => window.removeEventListener(ORGANIZATION_CHANGED, reload);
   }, [reload]);

   const departmentName = (department: string) =>
      tOrg.has(`departments.${department}` as 'departments.product')
         ? tOrg(`departments.${department}` as 'departments.product')
         : department;

   const entries = useMemo<CatalogEntry[]>(
      () =>
         (organization.value?.specialists ?? []).map((specialist) => ({
            roleKey: specialist.roleKey,
            name: specialist.name,
            role: specialist.role,
            department: specialist.department,
            mission: specialist.mission,
         })),
      [organization.value]
   );

   const departmentOptions = useMemo(
      () =>
         [...new Set(entries.map((entry) => entry.department))]
            .toSorted((left, right) => departmentRank(left) - departmentRank(right))
            .map((department) => ({ value: department, label: departmentName(department) })),
      // departmentName reads static catalogue labels.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [entries]
   );

   const scoped = useMemo(() => {
      const needle = query.trim().toLowerCase();
      const chosen = new Set(departments);
      return entries.filter((entry) => {
         if (chosen.size > 0 && !chosen.has(entry.department)) return false;
         if (needle === '') return true;
         return [entry.name, entry.role, entry.mission, departmentName(entry.department)]
            .join(' ')
            .toLowerCase()
            .includes(needle);
      });
      // departmentName reads static catalogue labels.
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [entries, query, departments]);

   const groups = useMemo(() => {
      const sign = sortDescending ? -1 : 1;
      const byDepartment = new Map<string, CatalogEntry[]>();
      for (const entry of scoped) {
         byDepartment.set(entry.department, [...(byDepartment.get(entry.department) ?? []), entry]);
      }
      return [...byDepartment.entries()]
         .toSorted(
            ([left], [right]) =>
               departmentRank(left) - departmentRank(right) || left.localeCompare(right)
         )
         .map(([department, roles]) => ({
            department,
            roles: roles.toSorted((left, right) => sign * left.name.localeCompare(right.name)),
         }));
   }, [scoped, sortDescending]);

   const rows = groups.flatMap((group) => group.roles);
   const allSelected = rows.length > 0 && rows.every((entry) => selection.includes(entry.roleKey));
   const selected = rows.filter((entry) => selection.includes(entry.roleKey));

   const add = async (targets: CatalogEntry[]) => {
      if (!canEdit || targets.length === 0) return;
      setAdding(targets.map((entry) => entry.roleKey));
      let added = 0;
      for (const entry of targets) {
         try {
            await addRole(entry.roleKey);
            added += 1;
         } catch (cause) {
            toast.error(cause instanceof Error ? cause.message : t('failed'));
         }
      }
      setAdding([]);
      setSelection([]);
      if (added === 1 && targets.length === 1)
         toast.success(t('added', { name: targets[0]!.name }));
      else if (added > 0) toast.success(t('bulk.added', { count: added }));
      loadWorkspaceAgents().then(
         (next) => hydrateAgents(next, null),
         () => undefined
      );
   };

   const header = (
      <div className="mb-1 flex w-full shrink-0 flex-wrap items-center justify-start gap-x-3 gap-y-1.5 border-b px-4 py-2.5 [&_button]:!h-[30px]">
         <Input
            className={`${searchFieldClass} w-64 max-sm:w-40`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('search')}
            aria-label={t('search')}
         />
         <DepartmentMultiselect
            options={departmentOptions}
            value={departments}
            onChange={setDepartments}
         />
      </div>
   );

   let body: React.ReactNode;
   if (organization.error) {
      body = <p className="px-6 py-8 text-muted-foreground">{organization.error}</p>;
   } else if (!organization.value) {
      body = <EmptyStateLoading label={t('loading')} />;
   } else if (rows.length === 0) {
      body = (
         <EmptyState icon={<EmptyStateMark label={t('empty')} />}>
            <EmptyStateText>{t('empty')}</EmptyStateText>
         </EmptyState>
      );
   } else {
      body = (
         <div className="flex h-full min-h-0 w-full flex-col">
            <div
               data-heading="label"
               className="flex h-9 shrink-0 items-center gap-3 border-b bg-container px-6 text-subtle-foreground"
            >
               {canEdit ? (
                  <Checkbox
                     className="shrink-0"
                     aria-label={t('bulk.selectAll')}
                     checked={allSelected}
                     onCheckedChange={() =>
                        setSelection(allSelected ? [] : rows.map((entry) => entry.roleKey))
                     }
                  />
               ) : null}
               <button
                  type="button"
                  onClick={() => setSortDescending((current) => !current)}
                  className="min-w-0 flex-1 text-left uppercase text-foreground hover:text-foreground"
               >
                  {t('columns.role')}
                  <span aria-hidden>{sortDescending ? ' ↑' : ' ↓'}</span>
               </button>
               <span className={cn('shrink-0', ACTION_WIDTH)} aria-hidden />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto divide-y-[3px] divide-background">
               {groups.map((group) => (
                  <Collapsible
                     key={group.department}
                     defaultOpen
                     className="group/role-group bg-container"
                  >
                     <div className="sticky top-0 z-10 h-9 w-full bg-container">
                        <div
                           data-column-tint="neutral"
                           className="flex h-full w-full items-center bg-group-tint-neutral px-6"
                        >
                           <CollapsibleTrigger asChild>
                              <button
                                 type="button"
                                 className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-sm text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                              >
                                 <ChevronDown
                                    aria-hidden
                                    className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=closed]/role-group:-rotate-90"
                                 />
                                 <span className="truncate font-medium">
                                    {departmentName(group.department)}
                                 </span>
                                 <span className="text-muted-foreground">{group.roles.length}</span>
                              </button>
                           </CollapsibleTrigger>
                        </div>
                     </div>
                     <CollapsibleContent>
                        {group.roles.map((entry) => (
                           <RoleLine
                              key={entry.roleKey}
                              entry={entry}
                              canEdit={canEdit}
                              selected={selection.includes(entry.roleKey)}
                              adding={adding.includes(entry.roleKey)}
                              onToggle={() =>
                                 setSelection((current) =>
                                    current.includes(entry.roleKey)
                                       ? current.filter((key) => key !== entry.roleKey)
                                       : [...current, entry.roleKey]
                                 )
                              }
                              onAdd={() => void add([entry])}
                           />
                        ))}
                     </CollapsibleContent>
                  </Collapsible>
               ))}
            </div>
            {canEdit && selected.length > 0 ? (
               <div className="sticky bottom-0 z-20 flex flex-wrap items-center gap-3 border-t bg-container px-6 py-2">
                  <Button size="sm" disabled={adding.length > 0} onClick={() => void add(selected)}>
                     {adding.length > 0 ? t('adding') : t('bulk.add', { count: selected.length })}
                  </Button>
                  <Button
                     size="sm"
                     variant="quiet"
                     disabled={adding.length > 0}
                     onClick={() => setSelection([])}
                  >
                     {t('bulk.clear')}
                  </Button>
               </div>
            ) : null}
         </div>
      );
   }

   return <MainLayout header={header}>{body}</MainLayout>;
}

/** Searchable department multiselect: empty selection means every department. */
export function DepartmentMultiselect({
   options,
   value,
   onChange,
}: {
   options: Array<{ value: string; label: string }>;
   value: string[];
   onChange: (next: string[]) => void;
}) {
   const t = useTranslations('agents.catalog');
   const selected = new Set(value);
   const label =
      value.length === 0
         ? t('filters.allDepartments')
         : value.length === 1
           ? (options.find((option) => option.value === value[0])?.label ?? value[0])
           : t('filters.departmentsSelected', { count: value.length });

   const toggle = (department: string) => {
      onChange(
         selected.has(department)
            ? value.filter((entry) => entry !== department)
            : [...value, department]
      );
   };

   return (
      <Popover>
         <PopoverTrigger asChild>
            <Button
               size="xs"
               variant="track"
               role="combobox"
               aria-label={t('filters.department')}
               className="max-w-56"
            >
               <Building2 className="size-4" />
               <span className="truncate">{label}</span>
            </Button>
         </PopoverTrigger>
         <PopoverContent className="w-64 p-0" align="start">
            <Command>
               <CommandInput placeholder={t('filters.searchDepartments')} />
               <CommandList>
                  <CommandEmpty>{t('filters.noDepartments')}</CommandEmpty>
                  <CommandGroup>
                     <CommandItem
                        value={`__all__ ${t('filters.allDepartments')}`}
                        onSelect={() => onChange([])}
                        className="justify-between"
                     >
                        {t('filters.allDepartments')}
                        {value.length === 0 ? <Check className="size-4 shrink-0" /> : null}
                     </CommandItem>
                     {options.map((option) => {
                        const on = selected.has(option.value);
                        return (
                           <CommandItem
                              key={option.value}
                              value={`${option.label} ${option.value}`}
                              onSelect={() => toggle(option.value)}
                              className="justify-between"
                           >
                              <span className="min-w-0 truncate">{option.label}</span>
                              {on ? <Check className="size-4 shrink-0" /> : null}
                           </CommandItem>
                        );
                     })}
                  </CommandGroup>
               </CommandList>
            </Command>
         </PopoverContent>
      </Popover>
   );
}

/** One role in the catalogue — the same row shape as a skill line. */
function RoleLine({
   entry,
   canEdit,
   selected,
   adding,
   onToggle,
   onAdd,
}: {
   entry: CatalogEntry;
   canEdit: boolean;
   selected: boolean;
   adding: boolean;
   onToggle: () => void;
   onAdd: () => void;
}) {
   const t = useTranslations('agents.catalog');

   return (
      <div
         className={cn(
            'flex w-full items-center gap-3 border-b border-muted-foreground/5 px-6 py-3',
            'last:border-b-0',
            selected && 'bg-sidebar/60'
         )}
      >
         {canEdit ? (
            <Checkbox
               checked={selected}
               onCheckedChange={onToggle}
               aria-label={t('bulk.select', { name: entry.name })}
               className="shrink-0"
            />
         ) : null}
         <div className="min-w-0 flex-1 overflow-hidden">
            <span className="block truncate font-medium leading-none">{entry.name}</span>
            <p className="mt-0.5 truncate text-muted-foreground" title={entry.mission}>
               {entry.mission}
            </p>
         </div>
         <div className={cn('flex shrink-0 items-center justify-end', ACTION_WIDTH)}>
            {canEdit ? (
               <Button
                  size="xxs"
                  variant="soft"
                  disabled={adding}
                  onClick={onAdd}
                  aria-label={t('row.add', { name: entry.name })}
               >
                  <Plus className="size-3.5" />
                  {adding ? t('adding') : t('add')}
               </Button>
            ) : null}
         </div>
      </div>
   );
}

export default function AgentCatalog() {
   return (
      <Suspense>
         <AgentCatalogScreen />
      </Suspense>
   );
}
