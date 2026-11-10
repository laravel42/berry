'use client';

import { Bot, CircleDot, Repeat, UserPen, Zap } from 'lucide-react';
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EXECUTION_MODES, type Autopilot } from '@/lib/autopilots';

export const AUTOPILOT_SCOPES = ['all', 'archived'] as const;
export type AutopilotScope = (typeof AUTOPILOT_SCOPES)[number];

/** Trigger value for an autopilot that only runs by hand. */
const NO_TRIGGER = 'none';

/** What the autopilot list can be narrowed by. */
export function useAutopilotFilterColumns(
   /** The agents that can be an autopilot's assignee. */
   assignees: Array<{ id: string; name: string }>,
   creators: Array<{ id: string; name: string; avatarUrl?: string }>
) {
   const t = useTranslations('loops');

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
               { value: 'event', label: t('filters.trigger_event') },
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
   filter: ListFilterController<Autopilot>;
   scope?: AutopilotScope;
   onScopeChange?: (scope: AutopilotScope) => void;
   counts?: Record<AutopilotScope, number | null>;
}

/** Which Loops are shown: live or archived, and the filters over them. */
export default function AutopilotsFilters({
   filter,
   scope = 'all',
   onScopeChange,
   counts = { all: 0, archived: null },
}: Props) {
   const t = useTranslations('loops');
   const scopeLabel: Record<AutopilotScope, string> = {
      all: t('scopeAll'),
      archived: t('scopeArchived'),
   };

   return (
      <div className="flex w-full shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b px-6 py-2 [&_button]:!h-[30px]">
         <Tabs value={scope} onValueChange={(value) => onScopeChange?.(value as AutopilotScope)}>
            <TabsList aria-label={t('title')}>
               {AUTOPILOT_SCOPES.map((entry) => (
                  <TabsTrigger key={entry} value={entry}>
                     {scopeLabel[entry]}
                     {counts[entry] === null ? null : (
                        <span className="tabular-nums text-muted-foreground">{counts[entry]}</span>
                     )}
                  </TabsTrigger>
               ))}
            </TabsList>
         </Tabs>
         <ListFilterTrigger filter={filter} />
      </div>
   );
}
