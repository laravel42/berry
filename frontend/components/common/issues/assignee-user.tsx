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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { statusUserColors, type User } from '@/data/users';
import { agentToUser } from '@/lib/agents';
import { useAgentsStore } from '@/store/agents-store';
import { useIssuesStore } from '@/store/issues-store';
import { useMembersStore } from '@/store/members-store';
import { Button } from '@/components/ui/button';
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
   /** Extra classes for the printed name, e.g. to hide it on narrow screens. */
   nameClassName?: string;
   /**
    * The whole property line is the control, matching the project sidebar.
    * `emptyLabel` is the word shown when nobody is assigned.
    */
   row?: boolean;
   emptyLabel?: string;
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
         {selected ? <CheckIcon className="text-(--primary) ml-auto size-4 shrink-0" /> : null}
      </CommandItem>
   );
}

/**
 * The list inside the popover. `PopoverContent` mounts it only while the menu
 * is open, so the member and agent stores, the filtering and the items cost a
 * closed control nothing.
 */
function AssigneeMenu({
   currentAssignee,
   open,
   onChoose,
}: {
   currentAssignee: User | null;
   open: boolean;
   onChoose: (assignee: User | null) => void;
}) {
   const t = useTranslations('issueLists.assignee');
   const listRef = useRef<HTMLDivElement>(null);
   const [query, setQuery] = useState('');
   const agents = useAgentsStore((state) => state.agents);
   const members = useMembersStore((state) => state.members);

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

   return (
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
                  onSelect={() => onChoose(null)}
                  className="flex items-center gap-2"
               >
                  <AssigneePlaceholder />
                  <span>{t('none')}</span>
                  {!currentAssignee ? (
                     <CheckIcon className="text-(--primary) ml-auto size-4 shrink-0" />
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
                           onSelect={() => onChoose(member)}
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
                           onSelect={() => onChoose(agent)}
                        />
                     ))}
                  </CommandGroup>
                  {capped ? (
                     <p className="px-3 pb-1.5 text-muted-foreground">{t('showing', capped)}</p>
                  ) : null}
               </>
            ) : null}
         </CommandList>
      </Command>
   );
}

export function AssigneeUser({
   user,
   issueId,
   monogram = true,
   showName = false,
   plainName = false,
   nameClassName,
   row = false,
   emptyLabel,
}: AssigneeUserProps) {
   const t = useTranslations('issueLists.assignee');
   const [open, setOpen] = useState(false);
   const [currentAssignee, setCurrentAssignee] = useState<User | null>(user);
   const updateIssueAssignee = useIssuesStore((state) => state.updateIssueAssignee);

   useEffect(() => {
      setCurrentAssignee(user);
   }, [user]);

   const choose = (assignee: User | null) => {
      setCurrentAssignee(assignee);
      setOpen(false);
      if (issueId) updateIssueAssignee(issueId, assignee);
   };

   const hasMonogram = Boolean(!showName && monogram && currentAssignee?.role === 'Application');
   const showHoverTooltip = !row && !showName && Boolean(currentAssignee);

   const trigger = row ? (
      <Button
         type="button"
         variant="ghost"
         size="sm"
         aria-haspopup="listbox"
         aria-expanded={open}
         aria-label={
            currentAssignee ? t('assigned', { name: currentAssignee.name }) : t('unassigned')
         }
         className="w-full min-w-0 justify-start gap-2 px-0 font-medium"
      >
         {currentAssignee ? (
            <>
               <ActorAvatar user={currentAssignee} monogram={monogram} />
               <span className="min-w-0 truncate">{currentAssignee.name}</span>
            </>
         ) : (
            <>
               <AssigneePlaceholder />
               <span className="min-w-0 truncate text-muted-foreground">{emptyLabel}</span>
            </>
         )}
      </Button>
   ) : (
      // The field height, like the priority and status beside it.
      <Button
         variant="ghost"
         size={showName && currentAssignee ? 'sm' : 'icon-sm'}
         aria-haspopup="listbox"
         aria-expanded={open}
         aria-label={
            currentAssignee ? t('assigned', { name: currentAssignee.name }) : t('unassigned')
         }
         className={cn(
            'relative min-w-0 gap-1.5 font-normal',
            showName && currentAssignee
               ? 'max-w-full justify-start px-1.5'
               : hasMonogram
                 ? 'w-fit px-1'
                 : 'p-0'
         )}
      >
         {currentAssignee ? (
            <>
               <span className="relative shrink-0">
                  <ActorAvatar
                     user={currentAssignee}
                     monogram={monogram}
                     showTitle={!showHoverTooltip}
                  />
                  {currentAssignee.role !== 'Application' ? (
                     <span
                        className="border-background absolute -end-0.5 -bottom-0.5 size-2 rounded-full border-2"
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
                     className={cn('min-w-0 truncate', nameClassName)}
                  />
               ) : null}
            </>
         ) : (
            <AssigneePlaceholder />
         )}
      </Button>
   );

   return (
      <Popover open={open} onOpenChange={setOpen}>
         {showHoverTooltip && currentAssignee ? (
            <Tooltip>
               <TooltipTrigger asChild>
                  <PopoverTrigger asChild>{trigger}</PopoverTrigger>
               </TooltipTrigger>
               {!open ? (
                  <TooltipContent side="top" className="text-foreground shadow-sm">
                     {currentAssignee.name}
                  </TooltipContent>
               ) : null}
            </Tooltip>
         ) : (
            <PopoverTrigger asChild>{trigger}</PopoverTrigger>
         )}
         <PopoverContent
            align="start"
            collisionPadding={12}
            className={cn(
               'flex max-h-(--radix-popover-content-available-height) flex-col overflow-hidden p-0',
               row ? 'w-full min-w-[var(--radix-popper-anchor-width)]' : 'w-[240px]'
            )}
         >
            <AssigneeMenu currentAssignee={currentAssignee} open={open} onChoose={choose} />
         </PopoverContent>
      </Popover>
   );
}
