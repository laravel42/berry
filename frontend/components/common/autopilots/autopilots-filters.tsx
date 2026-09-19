'use client';

import { ArrowUpDown, Bot, Check, Columns3, Repeat, UserPen, Zap } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

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
import { EXECUTION_MODES, type Autopilot } from '@/lib/autopilots';

export const AUTOPILOT_COLUMNS = ['status', 'mode', 'quota', 'updated'] as const;
export type AutopilotColumn = (typeof AUTOPILOT_COLUMNS)[number];

export const AUTOPILOT_SORTS = ['name', 'updated', 'created'] as const;
export type AutopilotSort = (typeof AUTOPILOT_SORTS)[number];

/** Which autopilots and how they are laid out; what narrows them is the filter's. */
export interface AutopilotCriteria {
   scope: 'all' | 'active' | 'paused';
   sort: AutopilotSort;
   columns: AutopilotColumn[];
}

export const DEFAULT_AUTOPILOT_CRITERIA: AutopilotCriteria = {
   scope: 'all',
   sort: 'name',
   columns: ['status', 'mode', 'updated'],
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
}

/** Scope, filters, sort and columns for the autopilot list. */
export default function AutopilotsFilters({ criteria, onChange, filter }: Props) {
   const t = useTranslations('areas.autopilots');
   const set = (patch: Partial<AutopilotCriteria>) => onChange({ ...criteria, ...patch });

   return (
      <div className="flex flex-wrap items-center gap-2">
         <div className="flex items-center gap-1 rounded-md border p-0.5">
            {(['all', 'active', 'paused'] as const).map((scope) => (
               <Button
                  key={scope}
                  size="xxs"
                  variant={criteria.scope === scope ? 'secondary' : 'ghost'}
                  onClick={() => set({ scope })}
               >
                  {t(`filters.scope_${scope}`)}
               </Button>
            ))}
         </div>

         <div className="ml-auto flex flex-wrap items-center gap-1">
            <ListFilterTrigger filter={filter} />

            <Popover>
               <PopoverTrigger asChild>
                  <Button size="xs" variant="outline" className="border-muted-foreground/15">
                     <ArrowUpDown className="mr-1 size-4" />
                     {t(`filters.sort_${criteria.sort}`)}
                  </Button>
               </PopoverTrigger>
               <PopoverContent className="w-52 p-0" align="start">
                  <Command>
                     <CommandList>
                        <CommandGroup>
                           {AUTOPILOT_SORTS.map((sort) => (
                              <CommandItem
                                 key={sort}
                                 onSelect={() => set({ sort })}
                                 className="justify-between"
                              >
                                 {t(`filters.sort_${sort}`)}
                                 {criteria.sort === sort ? <Check className="size-4" /> : null}
                              </CommandItem>
                           ))}
                        </CommandGroup>
                     </CommandList>
                  </Command>
               </PopoverContent>
            </Popover>

            <Popover>
               <PopoverTrigger asChild>
                  <Button size="xs" variant="outline" className="border-muted-foreground/15">
                     <Columns3 className="mr-1 size-4" />
                     {t('filters.columns')}
                  </Button>
               </PopoverTrigger>
               <PopoverContent className="w-52 p-0" align="start">
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
                                          : [...criteria.columns, column],
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
         </div>
      </div>
   );
}
