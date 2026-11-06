'use client';

import { Tag, UserPen, Bot, CircleDot } from 'lucide-react';
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
import { Input, searchFieldClass } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { isOrchestrator, type Agent } from '@/lib/agents';
import { isOrchestratorSkillLabel, isSkillInUse, type Skill } from '@/lib/skills';

export const SKILL_SCOPES = ['all', 'archived'] as const;
export type SkillScope = (typeof SKILL_SCOPES)[number];

export const SKILL_COLUMNS = ['agents', 'creator', 'updated'] as const;
export type SkillColumn = (typeof SKILL_COLUMNS)[number];

export const SKILL_SORTS = ['name', 'labels', 'updated', 'usage'] as const;
export type SkillSort = (typeof SKILL_SORTS)[number];

/** How the reader lays the catalogue out; what it is narrowed by is the filter's. */
export interface SkillCriteria {
   sort: SkillSort;
   /** Reverses the sort's natural direction (A→Z, newest first, most used first). */
   descending?: boolean;
   columns: SkillColumn[];
}

export const DEFAULT_CRITERIA: SkillCriteria = {
   sort: 'name',
   columns: ['agents'],
};

/**
 * What the catalogue can be narrowed by. Every field is on the list payload,
 * so the page matches them itself and the server only answers the search.
 */
export function useSkillFilterColumns(
   skills: Skill[],
   agents: Agent[],
   /** Everyone who has made a skill here, as the list itself reports them. */
   creators: Array<{ id: string; name: string }>
) {
   const t = useTranslations('areas.skills');

   return useMemo(() => {
      const labels = [...new Set(skills.flatMap((skill) => skill.labels))]
         .filter((label) => !isOrchestratorSkillLabel(label))
         .map((label) => ({ value: label, label }))
         .sort(byLabel);
      const dtf = createColumnConfigHelper<Skill>();
      return [
         dtf
            .option()
            .id('usage')
            .accessor((skill: Skill) => (isSkillInUse(skill) ? 'inUse' : 'unused'))
            .displayName(t('filters.usage'))
            .icon(CircleDot)
            .options([
               { value: 'inUse', label: t('filters.inUse') },
               { value: 'unused', label: t('filters.unused') },
            ])
            .build(),
         dtf
            .multiOption()
            .id('agent')
            // An agent carries a skill only while its binding is switched on.
            .accessor((skill: Skill) =>
               skill.agents.filter((agent) => agent.enabled).map((agent) => agent.id)
            )
            .displayName(t('filters.agent'))
            .icon(Bot)
            .options(
               agents
                  .filter((agent) => !isOrchestrator(agent))
                  .map(agentFilterOption)
                  .sort(byLabel)
            )
            .build(),
         dtf
            .option()
            .id('creator')
            .accessor((skill: Skill) => skill.createdBy ?? 'unknown')
            .displayName(t('filters.creator'))
            .icon(UserPen)
            .options(creators.map(memberFilterOption).sort(byLabel))
            .build(),
         dtf
            .multiOption()
            .id('labels')
            .accessor((skill: Skill) => skill.labels)
            .displayName(t('columns.labels'))
            .icon(Tag)
            .options(labels)
            .build(),
      ] as const;
   }, [skills, agents, creators, t]);
}

interface Props {
   filter: ListFilterController<Skill>;
   query: string;
   onQueryChange: (query: string) => void;
   /** Trailing primary action (e.g. New skill), after the list controls. */
   action?: ReactNode;
   scope?: SkillScope;
   onScopeChange?: (scope: SkillScope) => void;
   counts?: Record<SkillScope, number | null>;
}

/** Search and Filter on the left; All / Archived on the right. */
export default function SkillsFilters({
   filter,
   query,
   onQueryChange,
   action,
   scope = 'all',
   onScopeChange,
   counts = { all: 0, archived: null },
}: Props) {
   const t = useTranslations('areas.skills');
   const scopeLabel: Record<SkillScope, string> = {
      all: t('scopeAll'),
      archived: t('scopeArchived'),
   };

   return (
      <div className="mb-1 flex w-full shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b px-4 py-[8px] [&_button]:!h-[30px]">
         <div className="flex min-w-0 shrink flex-wrap items-center gap-2">
            <Input
               className={`${searchFieldClass} w-64 max-sm:w-40`}
               value={query}
               onChange={(event) => onQueryChange(event.target.value)}
               placeholder={t('search')}
               aria-label={t('search')}
            />
            <ListFilterTrigger filter={filter} />
            {action}
         </div>
         <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Tabs value={scope} onValueChange={(value) => onScopeChange?.(value as SkillScope)}>
               <TabsList aria-label={t('title')}>
                  {SKILL_SCOPES.map((entry) => (
                     <TabsTrigger key={entry} value={entry}>
                        {scopeLabel[entry]}
                        {counts[entry] === null ? null : (
                           <span className="tabular-nums text-muted-foreground">
                              {counts[entry]}
                           </span>
                        )}
                     </TabsTrigger>
                  ))}
               </TabsList>
            </Tabs>
         </div>
      </div>
   );
}
