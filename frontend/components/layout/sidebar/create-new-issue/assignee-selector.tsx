'use client';

import { ActorAvatar } from '@/components/common/issues/actor-avatar';
import { Button } from '@/components/ui/button';
import {
   Command,
   CommandEmpty,
   CommandGroup,
   CommandInput,
   CommandItem,
   CommandList,
   CommandSeparator,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { User } from '@/data/users';
import { agentToUser, type Agent } from '@/lib/agents';
import { cn } from '@/lib/utils';
import { useAgentsStore } from '@/store/agents-store';
import { useIssuesStore } from '@/store/issues-store';
import { useMembersStore } from '@/store/members-store';
import { CheckIcon, UserCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useState } from 'react';

/** Below this many names the list is short enough to scan; above it, search. */
const SEARCH_THRESHOLD = 6;

/** The one agent whose job is to hand work to the others. */
export function isOrchestrator(agent: Pick<Agent, 'capabilities' | 'roleKey'>): boolean {
   return agent.capabilities.includes('orchestrate') || agent.roleKey === 'orchestrator';
}

/** Orchestrator first, then everyone else by name. */
export function sortAgentsForPicker(agents: Agent[]): Agent[] {
   return agents.slice().sort((left, right) => {
      const leftFirst = isOrchestrator(left) ? 0 : 1;
      const rightFirst = isOrchestrator(right) ? 0 : 1;
      return leftFirst - rightFirst || left.name.localeCompare(right.name);
   });
}

interface AssigneeSelectorProps {
   assignee: User | null;
   onChange: (assignee: User | null) => void;
   /** `agents` lists only agents — the "hand it to an agent" picker. */
   scope?: 'all' | 'agents';
   /** Trigger text while nothing is chosen. */
   placeholder?: string;
}

/**
 * The create dialog's assignee picker: people and agents in one list, or only
 * agents when the task is being handed over. Search appears once the list is
 * long enough to need it and takes focus when the list opens.
 *
 * Handing over is a choice between roles, so that list says what each role
 * is for: its description, and the autonomy level that caps what it may do.
 * The Orchestrator leads, because for a person who does not yet know the
 * roster it is the right answer.
 */
export function AssigneeSelector({
   assignee,
   onChange,
   scope = 'all',
   placeholder,
}: AssigneeSelectorProps) {
   const t = useTranslations('issueLists.assignee');
   const org = useTranslations('organization');
   const id = useId();
   const [open, setOpen] = useState<boolean>(false);
   const [value, setValue] = useState<string | null>(assignee?.id || null);

   const { filterByAssignee } = useIssuesStore();
   const members = useMembersStore((state) => state.members);
   const agents = useAgentsStore((state) => state.agents);

   const people = useMemo(() => (scope === 'agents' ? [] : members), [scope, members]);
   const liveAgents = useMemo(
      () => sortAgentsForPicker(agents.filter((agent) => !agent.archivedAt)),
      [agents]
   );
   const agentUsers = useMemo(() => liveAgents.map(agentToUser), [liveAgents]);
   const agentById = useMemo(
      () => new Map(liveAgents.map((agent) => [agent.id, agent])),
      [liveAgents]
   );
   const everyone = useMemo(
      () =>
         [...people, ...agentUsers].filter(
            (person, index, list) => list.findIndex((entry) => entry.id === person.id) === index
         ),
      [people, agentUsers]
   );
   const searchable = everyone.length > SEARCH_THRESHOLD;

   useEffect(() => {
      setValue(assignee?.id || null);
   }, [assignee]);

   const choose = (person: User | null) => {
      setValue(person?.id ?? null);
      onChange(person);
      setOpen(false);
   };

   const selected = value ? everyone.find((person) => person.id === value) : undefined;
   const emptyLabel = placeholder ?? t('none');

   const levelChip = (agent: Agent) => {
      const level = agent.contract?.autonomy_level ?? agent.autonomyLevel ?? null;
      if (level === null) return null;
      const key = String(level) as '1' | '2' | '3' | '4' | '5';
      return (
         <span
            className="shrink-0 rounded border border-border/70 px-1.5 py-px text-muted-foreground"
            title={org('levelHint')}
         >
            {org('levelChip', { level: key, name: org(`levelNames.${key}`) })}
         </span>
      );
   };

   const item = (person: User) => {
      const agent = scope === 'agents' ? agentById.get(person.id) : undefined;
      const description = agent?.description?.trim() || null;
      return (
         <CommandItem
            key={person.id}
            value={person.name}
            keywords={description ? [description] : undefined}
            onSelect={() => choose(person)}
            className={cn('flex items-center gap-2', agent && 'items-start py-2')}
         >
            <ActorAvatar user={person} size="sm" className={cn(agent && 'mt-px')} />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
               <div className="flex min-w-0 items-center gap-2">
                  <span className={cn('min-w-0 truncate', agent && 'font-medium')}>
                     {person.name}
                  </span>
                  {agent ? levelChip(agent) : null}
               </div>
               {description ? (
                  <p className="truncate text-muted-foreground" title={description}>
                     {description}
                  </p>
               ) : null}
            </div>
            {value === person.id ? (
               <CheckIcon size={16} className="ml-auto shrink-0 text-foreground" />
            ) : null}
            {scope === 'all' ? (
               <span className="shrink-0 text-muted-foreground">
                  {filterByAssignee(person.id).length}
               </span>
            ) : null}
         </CommandItem>
      );
   };

   return (
      <div className="*:not-first:mt-2">
         <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
               <Button
                  id={id}
                  className="flex max-w-[260px] items-center justify-center"
                  size="xs"
                  variant="secondary"
                  role="combobox"
                  aria-expanded={open}
                  aria-label={selected ? t('assigned', { name: selected.name }) : emptyLabel}
               >
                  {selected ? (
                     <ActorAvatar user={selected} size="sm" />
                  ) : (
                     <UserCircle className="size-5" aria-hidden />
                  )}
                  <span className="min-w-0 truncate">{selected ? selected.name : emptyLabel}</span>
               </Button>
            </PopoverTrigger>
            <PopoverContent
               className={cn(
                  'border-input w-full min-w-[var(--radix-popper-anchor-width)] p-0',
                  // Role rows carry a description and a level: they need the
                  // room a name alone does not.
                  scope === 'agents' && 'w-[min(26rem,calc(100vw-2rem))]'
               )}
               align="start"
            >
               <Command>
                  {searchable ? (
                     <CommandInput
                        autoFocus
                        placeholder={scope === 'agents' ? t('searchAgents') : t('search')}
                        aria-label={scope === 'agents' ? t('searchAgents') : t('search')}
                     />
                  ) : null}
                  <CommandList className={cn(scope === 'agents' && 'max-h-[min(22rem,60vh)]')}>
                     <CommandEmpty>{t('noMatch')}</CommandEmpty>
                     {scope === 'all' ? (
                        <CommandGroup>
                           <CommandItem
                              value={t('none')}
                              onSelect={() => choose(null)}
                              className="flex items-center justify-between"
                           >
                              <div className="flex items-center gap-2">
                                 <UserCircle className="size-5" aria-hidden />
                                 {t('none')}
                              </div>
                              {value === null && <CheckIcon size={16} className="ml-auto" />}
                              <span className="text-muted-foreground">
                                 {filterByAssignee(null).length}
                              </span>
                           </CommandItem>
                        </CommandGroup>
                     ) : null}
                     {people.length > 0 ? (
                        <>
                           <CommandSeparator />
                           <CommandGroup heading={t('people')}>{people.map(item)}</CommandGroup>
                        </>
                     ) : null}
                     {agentUsers.length > 0 ? (
                        <>
                           {scope === 'all' ? <CommandSeparator /> : null}
                           <CommandGroup heading={t('agents')}>{agentUsers.map(item)}</CommandGroup>
                        </>
                     ) : null}
                  </CommandList>
               </Command>
            </PopoverContent>
         </Popover>
      </div>
   );
}
