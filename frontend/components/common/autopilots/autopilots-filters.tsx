'use client';

import { Bot, Check, CircleDot, Columns3, Repeat, UserPen, Zap } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, type ReactNode } from 'react';

import {
   agentFilterOption,
   byLabel,
   memberFilterOption,
} from '@/components/common/filters/filter-options';
import {
   ListFilterTrigger,
   type ListFilterController,
} from '@/components/common/filters/list-filters';
import { createColumnConfigHelper } from '@/components/data-table-filter/core/filters';
import { Button } from '@/components/ui/button';
import { Command, CommandGroup, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SegmentedControl } from '@/components/common/segmented-control';
import { EXECUTION_MODES, type Autopilot } from '@/lib/autopilots';

export const AUTOPILOT_SCOPES = ['all', 'active', 'paused', 'archived'] as const;
export type AutopilotScope = (typeof AUTOPILOT_SCOPES)[number];

export const AUTOPILOT_COLUMNS = [
   'agent',
   'lastRun',
   'nextRun',
   'mode',
   'quota',
   'updated',
] as const;
export type AutopilotColumn = (typeof AUTOPILOT_COLUMNS)[number];

export const AUTOPILOT_SORTS = ['name', 'status', 'mode', 'quota', 'updated', 'created'] as const;
export type AutopilotSort = (typeof AUTOPILOT_SORTS)[number];

/** How the list is laid out; what narrows it is the filter's. */
export interface AutopilotCriteria {
   sort: AutopilotSort;
   /** True = Z→A / newest first; false = A→Z / oldest first. */
   sortDescending: boolean;
   columns: AutopilotColumn[];
}

export const DEFAULT_AUTOPILOT_CRITERIA: AutopilotCriteria = {
   sort: 'name',
   sortDescending: false,
   columns: ['agent', 'lastRun', 'nextRun'],
};

/** Trigger value for an autopilot that only runs by hand. */
const NO_TRIGGER = 'none';

/** What the autopilot list can be narrowed by. */
export function useAutopilotFilterColumns(
   /** The agents that can be an autopilot's assignee. */
   assignees: Array<{ id: string; name: string }>,
   creators: Array<{ id: string; name: string; avatarUrl?: string }>
) {
   const t = useTranslations('areas.autopilots');

   return useMemo(() => {
      const dtf = createColumnConfigHelper<Autopilot>();
      return [
         dtf
            .option()
            .id('status')
            .accessor((autopilot: Autopilot) => autopilot.status)
            .displayName(t('filters.status'))
            .icon(CircleDot)
            .options([
               { value: 'active', label: t('status.active') },
               { value: 'paused', label: t('status.paused') },
            ])
            .build(),
         dtf
            .option()
            .id('assignee')
            .accessor((autopilot: Autopilot) => autopilot.assigneeId)
            .displayName(t('filters.assignee'))
            .icon(Bot)
            .options(assignees.map(agentFilterOption).sort(byLabel))
            .build(),
         dtf
            .option()
            .id('mode')
            .accessor((autopilot: Autopilot) => autopilot.executionMode)
            .displayName(t('filters.mode'))
            .icon(Repeat)
            .options(EXECUTION_MODES.map((mode) => ({ value: mode, label: t(`mode.${mode}`) })))
            .build(),
         dtf
            .multiOption()
            .id('trigger')
            .accessor((autopilot: Autopilot) =>
               autopilot.triggerKinds.length > 0 ? [...autopilot.triggerKinds] : [NO_TRIGGER]
            )
            .displayName(t('filters.trigger'))
            .icon(Zap)
            .options([
               { value: 'cron', label: t('filters.trigger_cron') },
               { value: 'webhook', label: t('filters.trigger_webhook') },
               { value: NO_TRIGGER, label: t('filters.trigger_none') },
            ])
            .build(),
         dtf
            .option()
            .id('creator')
            .accessor((autopilot: Autopilot) => autopilot.createdBy ?? 'unknown')
            .displayName(t('filters.creator'))
            .icon(UserPen)
            .options(creators.map(memberFilterOption).sort(byLabel))
            .build(),
      ] as const;
   }, [assignees, creators, t]);
}

interface Props {
   criteria: AutopilotCriteria;
   onChange: (criteria: AutopilotCriteria) => void;
   filter: ListFilterController<Autopilot>;
   /** Trailing primary action (e.g. New autopilot), after Display-style controls. */
   action?: ReactNode;
   scope?: AutopilotScope;
   onScopeChange?: (scope: AutopilotScope) => void;
   counts?: Record<AutopilotScope, number | null>;
}

/**
 * The list toolbar: scope tabs with counts on the left, Filter and Columns on
 * the right. Search and the create action sit on the header bar above.
 */
export default function AutopilotsFilters({
   criteria,
   onChange,
   filter,
   action,
   scope = 'all',
   onScopeChange,
   counts = { all: 0, active: 0, paused: 0, archived: null },
}: Props) {
   const t = useTranslations('areas.autopilots');
   const set = (patch: Partial<AutopilotCriteria>) => onChange({ ...criteria, ...patch });
   const scopeLabel: Record<AutopilotScope, string> = {
      all: t('scopeAll'),
      active: t('scopeActive'),
      paused: t('scopePaused'),
      archived: t('scopeArchived'),
   };

   return (
      <div className="flex h-[46px] w-full shrink-0 items-center gap-2 overflow-x-auto border-b px-5">
         <SegmentedControl
            aria-label={t('title')}
            value={scope}
            onValueChange={(next) => onScopeChange?.(next)}
            options={AUTOPILOT_SCOPES.map((entry) => ({
               value: entry,
               label: (
                  <span data-settings-type="segment" className="flex items-center gap-1.5 px-0.5">
                     {scopeLabel[entry]}
                     {counts[entry] === null ? null : (
                        <span className="tabular-nums text-subtle-foreground">{counts[entry]}</span>
                     )}
                  </span>
               ),
            }))}
         />
         <div className="ml-auto flex shrink-0 items-center gap-2">
            <ListFilterTrigger filter={filter} />
            <Popover>
               <PopoverTrigger asChild>
                  <Button size="xs" variant="track">
                     <Columns3 className="size-[13px]" />
                     {t('filters.columns')}
                  </Button>
               </PopoverTrigger>
               <PopoverContent className="w-52 p-0" align="end">
                  <Command>
                     <CommandList>
                        <CommandGroup>
                           {AUTOPILOT_COLUMNS.map((column) => (
                              <CommandItem
                                 key={column}
                                 onSelect={() =>
                                    set({
                                       columns: criteria.columns.includes(column)
                                          ? criteria.columns.filter((entry) => entry !== column)
                                          : AUTOPILOT_COLUMNS.filter(
                                               (entry) =>
                                                  entry === column ||
                                                  criteria.columns.includes(entry)
                                            ),
                                    })
                                 }
                                 className="justify-between"
                              >
                                 {t(`columns.${column}`)}
                                 {criteria.columns.includes(column) ? (
                                    <Check className="size-4" />
                                 ) : null}
                              </CommandItem>
                           ))}
                        </CommandGroup>
                     </CommandList>
                  </Command>
               </PopoverContent>
            </Popover>
            {action}
         </div>
      </div>
   );
}
