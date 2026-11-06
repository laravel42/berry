'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';

import { Input, searchFieldClass } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAgentFilterColumns } from '@/components/common/agents/agent-filter-columns';
import { ListFilterTrigger, useListFilters } from '@/components/common/filters/list-filters';
import { isOrchestrator } from '@/lib/agents';
import { useAgentsListStore, type AgentsScope } from '@/store/agents-list-store';
import { useAgentsStore } from '@/store/agents-store';

const SCOPES: AgentsScope[] = ['all', 'archived'];

/**
 * The agents toolbar: which agents, narrowed how.
 *
 * Every control writes to the list store rather than to the table, because the
 * page mounts this as a header and the table as its body — they never share a
 * parent that could hold the state between them. Sort is on the table headings.
 */
export default function HeaderOptions() {
   const t = useTranslations('agentsChat.list');
   const tHeader = useTranslations('agents.header');
   // The list leaves the Orchestrator out (it works behind the scenes), so the counts do too.
   const allAgents = useAgentsStore((state) => state.agents);
   const allArchived = useAgentsStore((state) => state.archived);
   const agents = useMemo(() => allAgents.filter((agent) => !isOrchestrator(agent)), [allAgents]);
   const archived = useMemo(
      () => allArchived?.filter((agent) => !isOrchestrator(agent)) ?? null,
      [allArchived]
   );
   const { scope, filters, query, setScope, setFilters, setQuery } = useAgentsListStore();
   const filterColumns = useAgentFilterColumns();
   const filter = useListFilters({
      data: scope === 'archived' ? (archived ?? []) : agents,
      columns: filterColumns,
      filters,
      onFiltersChange: setFilters,
   });

   // Archived is null only while its first load is in flight; once known,
   // zero and a positive count are both shown.
   const counts: Record<AgentsScope, number | null> = {
      all: agents.length,
      archived: archived?.length ?? null,
   };

   const scopeLabel: Record<AgentsScope, string> = {
      all: t('scopeAll'),
      archived: t('scopeArchived'),
   };

   return (
      <div className="mb-1 flex h-[44px] w-full shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b px-5 [&_button]:!h-[30px] [&_a]:!h-[30px]">
         <div className="flex min-w-0 shrink flex-wrap items-center gap-2">
            <Input
               className={`${searchFieldClass} w-64 max-sm:w-40`}
               value={query}
               onChange={(event) => setQuery(event.target.value)}
               placeholder={tHeader('search')}
               aria-label={tHeader('search')}
            />
            <ListFilterTrigger filter={filter} />
         </div>

         <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Tabs value={scope} onValueChange={(value) => setScope(value as AgentsScope)}>
               <TabsList aria-label={tHeader('title')}>
                  {SCOPES.map((entry) => (
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
