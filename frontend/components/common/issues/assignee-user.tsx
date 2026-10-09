'use client';

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
import { statusUserColors, type User } from '@/data/users';
import { agentToUser } from '@/lib/agents';
import { useAgentsStore } from '@/store/agents-store';
import { useIssuesStore } from '@/store/issues-store';
import { useMembersStore } from '@/store/members-store';
import { CheckIcon, UserRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActorAvatar, ActorName } from './actor-avatar';
import { cn } from '@/lib/utils';

/**
 * The assignee control of a row, a card and the properties panel.
 *
 * A person or an agent, picked from one list with two groups. The list is
 * searchable as soon as it is long enough to need it, and the search box takes
 * focus when the menu opens, so the keyboard route is type-then-Enter rather
 * than arrow-down eighteen times past the organization's roles.
 */

/** Agents shown before a search narrows them; the workspace ships with nineteen. */
const MAX_VISIBLE_AGENTS = 10;
/** Below this many names the list is short enough to scan; above it, search. */
const SEARCH_THRESHOLD = 6;

interface AssigneeUserProps {
   user: User | null;
   issueId?: string;
   /** Off where the full name is printed beside the control, as in the properties panel. */
   monogram?: boolean;
   /** Print the assignee's name inside the trigger so avatar and name are one control. */
   showName?: boolean;
   /** Body weight for that name. The default is one step heavier. */
   plainName?: boolean;
}

function AssigneePlaceholder() {
   return (
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-dashed border-muted-foreground/45 bg-muted/20">
         <UserRound className="size-3.5 text-muted-foreground/70" />
      </span>
   );
}

function AssigneeItem({
   person,
   selected,
   onSelect,
}: {
   person: User;
   selected: boolean;
   onSelect: () => void;
}) {
   return (
      <CommandItem value={person.name} onSelect={onSelect} className="flex items-center gap-2">
         <ActorAvatar user={person} size="sm" />
         <span className="min-w-0 truncate">{person.name}</span>
         {selected ? <CheckIcon className="ml-auto size-4 shrink-0" /> : null}
      </CommandItem>
   );
}

export function AssigneeUser({
   user,
   issueId,
   monogram = true,
   showName = false,
   plainName = false,
}: AssigneeUserProps) {
   const t = useTranslations('issueLists.assignee');
   const listRef = useRef<HTMLDivElement>(null);
   const [open, setOpen] = useState(false);
   const [query, setQuery] = useState('');
   const [currentAssignee, setCurrentAssignee] = useState<User | null>(user);
   const agents = useAgentsStore((state) => state.agents);
   const members = useMembersStore((state) => state.members);
   const updateIssueAssignee = useIssuesStore((state) => state.updateIssueAssignee);

   const agentAssignees = useMemo(
      () => agents.filter((agent) => !agent.archivedAt).map(agentToUser),
      [agents]
   );

   // With a search the command list does the narrowing; without one the
   // current agent leads and the rest is capped, so the menu stays a menu.
   const visibleAgents = useMemo(() => {
      if (query.trim()) return agentAssignees;
      const current = currentAssignee?.role === 'Application' ? currentAssignee : null;
      const rest = current
         ? agentAssignees.filter((agent) => agent.id !== current.id)
         : agentAssignees;
      return (current ? [current, ...rest] : rest).slice(0, MAX_VISIBLE_AGENTS);
   }, [agentAssignees, query, currentAssignee]);

   const searchable = members.length + agentAssignees.length > SEARCH_THRESHOLD;
   const capped =
      !query.trim() && agentAssignees.length > MAX_VISIBLE_AGENTS
         ? { shown: visibleAgents.length, total: agentAssignees.length }
         : null;

   useEffect(() => {
      setCurrentAssignee(user);
   }, [user]);

   useEffect(() => {
      if (!open) setQuery('');
   }, [open]);

   // The menu opens from a sheet, whose scroll lock swallows the wheel. A
   // non-passive listener on the list keeps that gesture on the names.
   useEffect(() => {
      const list = listRef.current;
      if (!open || !list) return;
      const onWheel = (event: WheelEvent) => {
         if (list.scrollHeight <= list.clientHeight) return;
         event.preventDefault();
         list.scrollTop += event.deltaY;
      };
      list.addEventListener('wheel', onWheel, { passive: false });
      return () => list.removeEventListener('wheel', onWheel);
   }, [open]);

   const choose = (assignee: User | null) => {
      setCurrentAssignee(assignee);
      setOpen(false);
      if (issueId) updateIssueAssignee(issueId, assignee);
   };

   return (
      <Popover open={open} onOpenChange={setOpen}>
         <PopoverTrigger asChild>
            <button
               type="button"
               aria-haspopup="listbox"
               aria-expanded={open}
               aria-label={
                  currentAssignee ? t('assigned', { name: currentAssignee.name }) : t('unassigned')
               }
               className={cn(
                  'relative flex min-w-0 items-center gap-1.5 rounded-sm outline-none transition-colors hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  showName ? 'max-w-full' : 'w-fit'
               )}
            >
               {currentAssignee ? (
                  <>
                     <span className="relative shrink-0">
                        <ActorAvatar user={currentAssignee} monogram={monogram} />
                        {currentAssignee.role !== 'Application' ? (
                           <span
                              className="border-background absolute -end-0.5 -bottom-0.5 size-2.5 rounded-full border-2"
                              style={{
                                 backgroundColor: statusUserColors[currentAssignee.status],
                              }}
                           >
                              <span className="sr-only">{currentAssignee.status}</span>
                           </span>
                        ) : null}
                     </span>
                     {showName ? (
                        <ActorName
                           user={currentAssignee}
                           plain={plainName}
                           className="min-w-0 truncate"
                        />
                     ) : null}
                  </>
               ) : (
                  <AssigneePlaceholder />
               )}
            </button>
         </PopoverTrigger>
         <PopoverContent
            align="start"
            collisionPadding={12}
            className="flex max-h-(--radix-popover-content-available-height) w-[240px] flex-col overflow-hidden p-0"
         >
            <Command className="h-auto max-h-full">
               {searchable ? (
                  <CommandInput
                     autoFocus
                     value={query}
                     onValueChange={setQuery}
                     placeholder={t('search')}
                     aria-label={t('search')}
                  />
               ) : null}
               <CommandList
                  ref={listRef}
                  className="max-h-[min(300px,var(--radix-popover-content-available-height))] overscroll-contain"
               >
                  <CommandEmpty>{t('noMatch')}</CommandEmpty>
                  <CommandGroup>
                     <CommandItem
                        value={t('none')}
                        onSelect={() => choose(null)}
                        className="flex items-center gap-2"
                     >
                        <AssigneePlaceholder />
                        <span>{t('none')}</span>
                        {!currentAssignee ? (
                           <CheckIcon className="ml-auto size-4 shrink-0" />
                        ) : null}
                     </CommandItem>
                  </CommandGroup>

                  {members.length > 0 ? (
                     <>
                        <CommandSeparator />
                        <CommandGroup heading={t('people')}>
                           {members.map((member) => (
                              <AssigneeItem
                                 key={member.id}
                                 person={member}
                                 selected={currentAssignee?.id === member.id}
                                 onSelect={() => choose(member)}
                              />
                           ))}
                        </CommandGroup>
                     </>
                  ) : null}

                  {agentAssignees.length > 0 ? (
                     <>
                        <CommandSeparator />
                        <CommandGroup heading={t('agents')}>
                           {visibleAgents.map((agent) => (
                              <AssigneeItem
                                 key={agent.id}
                                 person={agent}
                                 selected={currentAssignee?.id === agent.id}
                                 onSelect={() => choose(agent)}
                              />
                           ))}
                        </CommandGroup>
                        {capped ? (
                           <p className="px-3 pb-1.5 text-muted-foreground">
                              {t('showing', capped)}
                           </p>
                        ) : null}
                     </>
                  ) : null}
               </CommandList>
            </Command>
         </PopoverContent>
      </Popover>
   );
}
