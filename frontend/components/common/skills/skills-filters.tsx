'use client';

import { ArrowUpDown, Check, Columns3, Tag, UserPen, Bot, CircleDot } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { Agent } from '@/lib/agents';
import { isSkillInUse, type Skill } from '@/lib/skills';

export const SKILL_COLUMNS = ['labels', 'agents', 'files', 'creator', 'updated'] as const;
export type SkillColumn = (typeof SKILL_COLUMNS)[number];

export const SKILL_SORTS = ['name', 'updated', 'usage'] as const;
export type SkillSort = (typeof SKILL_SORTS)[number];

/** How the reader lays the catalogue out; what it is narrowed by is the filter's. */
export interface SkillCriteria {
   sort: SkillSort;
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
   query: string;
   onQueryChange: (query: string) => void;
   /** Trailing primary action (e.g. New skill), after the list controls. */
   action?: ReactNode;
}

/** The catalogue's search, filter, sort and column controls. */
export default function SkillsFilters({
   criteria,
   onChange,
   filter,
   query,
   onQueryChange,
   action,
}: Props) {
   const t = useTranslations('areas.skills');
   const set = (patch: Partial<SkillCriteria>) => onChange({ ...criteria, ...patch });

   return (
      <div className="mb-1 flex w-full shrink-0 items-center gap-2 border-b px-4 py-[6px] [&_button]:!h-9 [&_button[aria-label='New skill']]:!h-[34px] [&_button[aria-label='New skill']]:!w-[42px] [&_input]:!h-9">
         <Input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={t('search')}
            aria-label={t('search')}
            className="h-9 max-w-64"
         />

         <div className="ml-auto flex flex-wrap items-center justify-end gap-1">
            <ListFilterTrigger filter={filter} />

            <Popover>
               <PopoverTrigger asChild>
                  <Button size="xs" variant="outline" className="border-muted-foreground/15">
                     <Columns3 className="size-4" />
                     {t('filters.columns')}
                  </Button>
               </PopoverTrigger>
               <PopoverContent className="w-52 p-0" align="start">
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

            <Popover>
               <PopoverTrigger asChild>
                  <Button size="xs" variant="outline" className="border-muted-foreground/15">
                     <ArrowUpDown className="size-4" />
                     {t(`filters.sort_${criteria.sort}`)}
                  </Button>
               </PopoverTrigger>
               <PopoverContent className="w-52 p-0" align="start">
                  <Command>
                     <CommandList>
                        <CommandGroup>
                           {SKILL_SORTS.map((sort) => (
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

            {action}
         </div>
      </div>
   );
}
