'use client';

import { Check, Columns3, Tag, UserPen, Bot, CircleDot } from 'lucide-react';
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Agent } from '@/lib/agents';
import { isSkillInUse, type Skill } from '@/lib/skills';

export const SKILL_SCOPES = ['all', 'archived'] as const;
export type SkillScope = (typeof SKILL_SCOPES)[number];

export const SKILL_COLUMNS = ['agents', 'files', 'creator', 'updated'] as const;
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
   columns: ['agents', 'files'],
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
            .options(agents.map(agentFilterOption).sort(byLabel))
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
   criteria: SkillCriteria;
   onChange: (criteria: SkillCriteria) => void;
   filter: ListFilterController<Skill>;
   /** Trailing primary action (e.g. New skill), after the list controls. */
   action?: ReactNode;
   scope?: SkillScope;
   onScopeChange?: (scope: SkillScope) => void;
   counts?: Record<SkillScope, number | null>;
}

/** The catalogue's filter and column controls. Search sits on the page statement. */
export default function SkillsFilters({
   criteria,
   onChange,
   filter,
   action,
   scope = 'all',
   onScopeChange,
   counts = { all: 0, archived: null },
}: Props) {
   const t = useTranslations('areas.skills');
   const set = (patch: Partial<SkillCriteria>) => onChange({ ...criteria, ...patch });
   const scopeLabel: Record<SkillScope, string> = {
      all: t('scopeAll'),
      archived: t('scopeArchived'),
   };

   return (
      <div className="mb-1 flex w-full shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b px-4 py-[6px] [&_button]:!h-[30px]">
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
         <div className="flex shrink-0 flex-wrap items-center gap-2">
            <ListFilterTrigger filter={filter} />
            <Popover>
               <PopoverTrigger asChild>
                  <Button size="xs" variant="track">
                     <Columns3 className="size-4" />
                     {t('filters.columns')}
                  </Button>
               </PopoverTrigger>
               <PopoverContent className="w-52 p-0" align="end">
                  <Command>
                     <CommandList>
                        <CommandGroup>
                           {SKILL_COLUMNS.map((column) => (
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
            {action}
         </div>
      </div>
   );
}
