'use client';

import { ChevronDown, Plus } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { DepartmentMultiselect } from '@/components/common/agents/agent-catalog';
import {
   EmptyState,
   EmptyStateLoading,
   EmptyStateMark,
   EmptyStateText,
} from '@/components/common/empty-state';
import { SettingsChip } from '@/components/common/settings/shared';
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
import { BerryApiError } from '@/lib/api';
import { isOrchestrator, loadWorkspaceAgents, type Agent } from '@/lib/agents';
import { DEPARTMENT_ORDER, getOrganization } from '@/lib/organization';
import { listSkills, setSkillForAgent, withoutOrchestratorSkills, type Skill } from '@/lib/skills';
import { cn } from '@/lib/utils';
import { canEditProduct } from '@/lib/workspace-role';
import { useAgentsStore } from '@/store/agents-store';
import { useSessionStore } from '@/store/session-store';
import { useSkillsCatalogueStore } from '@/store/skills-catalogue-store';

/** The action column, always shown: Add. */
const ACTION_WIDTH = 'w-20';
/** Skills whose labels name no catalogue role. */
const OTHER = 'other';

function departmentRank(department: string): number {
   if (department === OTHER) return DEPARTMENT_ORDER.length + 1;
   const index = (DEPARTMENT_ORDER as readonly string[]).indexOf(department);
   return index === -1 ? DEPARTMENT_ORDER.length : index;
}

/**
 * The skills catalogue, laid out like the agent catalogue: every skill no
 * agent carries yet, in one accordion per department (the department of the
 * role its label names), a department multiselect, an Add per row and a bar
 * for adding several at once. Add assigns the skill to an agent, which moves
 * it to the Skills page. Rows are not links: Add is the one thing a row does.
 */
function SkillCatalogScreen() {
   const t = useTranslations('areas.skills.catalog');
   const tOrg = useTranslations('organization');
   const role = useSessionStore((state) => state.workspace?.role);
   const canEdit = canEditProduct(role);
   const bump = useSkillsCatalogueStore((state) => state.bump);
   const organization = useSettingsResource(getOrganization);
   const agents = useAgentsStore((state) => state.agents);
   const agentsReady = useAgentsStore((state) => state.ready);
   const hydrateAgents = useAgentsStore((state) => state.hydrateAgents);

   const [skills, setSkills] = useState<Skill[] | null>(null);
   const [error, setError] = useState<string | null>(null);
   const [query, setQuery] = useState('');
   /** Empty means every department; otherwise only these keys. */
   const [departments, setDepartments] = useState<string[]>([]);
   const [sortDescending, setSortDescending] = useState(false);
   const [selection, setSelection] = useState<string[]>([]);
   const [adding, setAdding] = useState<string[]>([]);

   const load = useCallback(() => {
      listSkills({ inUse: false }).then(
         (found) => {
            setSkills(withoutOrchestratorSkills(found));
            setError(null);
         },
         (failure: unknown) =>
            setError(failure instanceof BerryApiError ? failure.message : t('loadFailed'))
      );
   }, [t]);

   useEffect(() => load(), [load]);

   useEffect(() => {
      if (agentsReady) return;
      loadWorkspaceAgents().then(
         (next) => hydrateAgents(next, null),
         () => undefined
      );
   }, [agentsReady, hydrateAgents]);

   /** Every catalogue role's name → its department, the workspace's and the rest. */
   const departmentOf = useMemo(() => {
      const map = new Map<string, string>();
      for (const department of organization.value?.departments ?? []) {
         for (const entry of department.roles) map.set(entry.name, department.key);
      }
      for (const specialist of organization.value?.specialists ?? []) {
         map.set(specialist.name, specialist.department);
      }
      return map;
   }, [organization.value]);

   const departmentFor = useCallback(
      (skill: Skill) => skill.labels.map((label) => departmentOf.get(label)).find(Boolean) ?? OTHER,
      [departmentOf]
   );

   const departmentName = (department: string) =>
      department === OTHER
         ? t('otherDepartment')
         : tOrg.has(`departments.${department}` as 'departments.product')
           ? tOrg(`departments.${department}` as 'departments.product')
           : department;

   /** Agents a skill can go to; the Orchestrator stays behind the scenes. */
   const targets = useMemo(
      () =>
         agents
            .filter((agent) => !agent.archivedAt && !isOrchestrator(agent))
            .toSorted((left, right) => left.name.localeCompare(right.name)),
      [agents]
   );

   const departmentOptions = useMemo(
      () =>
         [...new Set((skills ?? []).map(departmentFor))]
            .toSorted((left, right) => departmentRank(left) - departmentRank(right))
            .map((department) => ({ value: department, label: departmentName(department) })),
      // departmentName reads static catalogue labels.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [skills, departmentFor]
   );

   const scoped = useMemo(() => {
      const needle = query.trim().toLowerCase();
      const chosen = new Set(departments);
      return (skills ?? []).filter((skill) => {
         if (chosen.size > 0 && !chosen.has(departmentFor(skill))) return false;
         if (needle === '') return true;
         return [skill.name, skill.description, ...skill.labels]
            .join(' ')
            .toLowerCase()
            .includes(needle);
      });
   }, [skills, query, departments, departmentFor]);

   const groups = useMemo(() => {
      const sign = sortDescending ? -1 : 1;
      const byDepartment = new Map<string, Skill[]>();
      for (const skill of scoped) {
         const department = departmentFor(skill);
         byDepartment.set(department, [...(byDepartment.get(department) ?? []), skill]);
      }
      return [...byDepartment.entries()]
         .toSorted(
            ([left], [right]) =>
               departmentRank(left) - departmentRank(right) || left.localeCompare(right)
         )
         .map(([department, list]) => ({
            department,
            skills: list.toSorted((left, right) => sign * left.name.localeCompare(right.name)),
         }));
   }, [scoped, sortDescending, departmentFor]);

   const rows = groups.flatMap((group) => group.skills);
   const allSelected = rows.length > 0 && rows.every((skill) => selection.includes(skill.id));
   const selected = rows.filter((skill) => selection.includes(skill.id));

   const add = async (chosen: Skill[], agent: Agent) => {
      if (!canEdit || chosen.length === 0) return;
      setAdding(chosen.map((skill) => skill.id));
      let added = 0;
      for (const skill of chosen) {
         try {
            await setSkillForAgent(skill.id, agent.id, true);
            added += 1;
         } catch (cause) {
            toast.error(cause instanceof BerryApiError ? cause.message : t('addFailed'));
         }
      }
      setAdding([]);
      setSelection([]);
      if (added === 1 && chosen.length === 1) {
         toast.success(t('added', { name: chosen[0]!.name, agent: agent.name }));
      } else if (added > 0) {
         toast.success(t('bulk.added', { count: added, agent: agent.name }));
      }
      // An assigned skill leaves the catalogue and shows on the Skills page.
      load();
      bump();
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
   if (error) {
      body = <p className="px-6 py-8 text-muted-foreground">{error}</p>;
   } else if (!skills) {
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
                        setSelection(allSelected ? [] : rows.map((skill) => skill.id))
                     }
                  />
               ) : null}
               <button
                  type="button"
                  onClick={() => setSortDescending((current) => !current)}
                  className="min-w-0 flex-1 text-left uppercase text-foreground hover:text-foreground"
               >
                  {t('columns.skill')}
                  <span aria-hidden>{sortDescending ? ' ↑' : ' ↓'}</span>
               </button>
               <span className={cn('shrink-0', ACTION_WIDTH)} aria-hidden />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto divide-y-[3px] divide-background">
               {groups.map((group) => (
                  <Collapsible
                     key={group.department}
                     defaultOpen
                     className="group/skill-group bg-container"
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
                                    className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=closed]/skill-group:-rotate-90"
                                 />
                                 <span className="truncate font-medium">
                                    {departmentName(group.department)}
                                 </span>
                                 <span className="text-muted-foreground">
                                    {group.skills.length}
                                 </span>
                              </button>
                           </CollapsibleTrigger>
                        </div>
                     </div>
                     <CollapsibleContent>
                        {group.skills.map((skill) => (
                           <SkillCatalogLine
                              key={skill.id}
                              skill={skill}
                              canEdit={canEdit}
                              selected={selection.includes(skill.id)}
                              adding={adding.includes(skill.id)}
                              targets={targets}
                              onToggle={() =>
                                 setSelection((current) =>
                                    current.includes(skill.id)
                                       ? current.filter((id) => id !== skill.id)
                                       : [...current, skill.id]
                                 )
                              }
                              onAdd={(agent) => void add([skill], agent)}
                           />
                        ))}
                     </CollapsibleContent>
                  </Collapsible>
               ))}
            </div>
            {canEdit && selected.length > 0 ? (
               <div className="sticky bottom-0 z-20 flex flex-wrap items-center gap-3 border-t bg-container px-6 py-2">
                  <AgentPicker
                     targets={targets}
                     labels={[...new Set(selected.flatMap((skill) => skill.labels))]}
                     onPick={(agent) => void add(selected, agent)}
                  >
                     <Button size="sm" disabled={adding.length > 0}>
                        {adding.length > 0
                           ? t('adding')
                           : t('bulk.add', { count: selected.length })}
                     </Button>
                  </AgentPicker>
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

/**
 * Which agent a skill goes to. Agents whose role its labels name come first,
 * as suggestions; with no agents yet, it points to the agent catalogue.
 */
function AgentPicker({
   targets,
   labels,
   onPick,
   children,
}: {
   targets: Agent[];
   labels: string[];
   onPick: (agent: Agent) => void;
   children: React.ReactNode;
}) {
   const t = useTranslations('areas.skills.catalog');
   const { orgId } = useParams<{ orgId: string }>();
   const [open, setOpen] = useState(false);
   const suggested = targets.filter((agent) => labels.includes(agent.name));
   const others = targets.filter((agent) => !labels.includes(agent.name));

   const item = (agent: Agent) => (
      <CommandItem
         key={agent.id}
         value={`${agent.name} ${agent.id}`}
         onSelect={() => {
            setOpen(false);
            onPick(agent);
         }}
      >
         <span className="min-w-0 truncate">{agent.name}</span>
      </CommandItem>
   );

   return (
      <Popover open={open} onOpenChange={setOpen}>
         <PopoverTrigger asChild>{children}</PopoverTrigger>
         <PopoverContent className="w-64 p-0" align="end">
            {targets.length === 0 ? (
               <div className="flex flex-col gap-2 p-3">
                  <p className="text-muted-foreground">{t('noAgents')}</p>
                  <Button size="sm" variant="soft" asChild>
                     <Link href={`/${orgId}/agent-catalog`}>{t('openAgentCatalog')}</Link>
                  </Button>
               </div>
            ) : (
               <Command>
                  <CommandInput placeholder={t('searchAgents')} />
                  <CommandList>
                     <CommandEmpty>{t('noAgentMatch')}</CommandEmpty>
                     {suggested.length > 0 ? (
                        <CommandGroup heading={t('suggested')}>{suggested.map(item)}</CommandGroup>
                     ) : null}
                     <CommandGroup heading={suggested.length > 0 ? t('otherAgents') : t('addTo')}>
                        {others.map(item)}
                     </CommandGroup>
                  </CommandList>
               </Command>
            )}
         </PopoverContent>
      </Popover>
   );
}

/** One skill in the catalogue — the same row shape as a role in the agent catalogue. */
function SkillCatalogLine({
   skill,
   canEdit,
   selected,
   adding,
   targets,
   onToggle,
   onAdd,
}: {
   skill: Skill;
   canEdit: boolean;
   selected: boolean;
   adding: boolean;
   targets: Agent[];
   onToggle: () => void;
   onAdd: (agent: Agent) => void;
}) {
   const t = useTranslations('areas.skills.catalog');

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
               aria-label={t('bulk.select', { name: skill.name })}
               className="shrink-0"
            />
         ) : null}
         <div className="min-w-0 flex-1 overflow-hidden">
            <div className="flex min-w-0 items-center gap-2">
               <span className="truncate font-medium leading-none">{skill.name}</span>
               {skill.labels.map((label) => (
                  <SettingsChip key={label}>{label}</SettingsChip>
               ))}
            </div>
            <p className="mt-0.5 truncate text-muted-foreground" title={skill.description}>
               {skill.description}
            </p>
         </div>
         <div className={cn('flex shrink-0 items-center justify-end', ACTION_WIDTH)}>
            {canEdit ? (
               <AgentPicker targets={targets} labels={skill.labels} onPick={onAdd}>
                  <Button
                     size="xxs"
                     variant="soft"
                     disabled={adding}
                     aria-label={t('row.add', { name: skill.name })}
                  >
                     <Plus className="size-3.5" />
                     {adding ? t('adding') : t('add')}
                  </Button>
               </AgentPicker>
            ) : null}
         </div>
      </div>
   );
}

export default function SkillCatalog() {
   return (
      <Suspense>
         <SkillCatalogScreen />
      </Suspense>
   );
}
