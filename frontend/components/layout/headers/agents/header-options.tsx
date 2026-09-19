'use client';

import { ArrowDown, ArrowUp, Check, Columns3 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import {
   DropdownMenu,
   DropdownMenuContent,
   DropdownMenuItem,
   DropdownMenuLabel,
   DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAgentFilterColumns } from '@/components/common/agents/agent-filter-columns';
import { ListFilterTrigger, useListFilters } from '@/components/common/filters/list-filters';
import { cn } from '@/lib/utils';
import {
   AGENT_COLUMNS,
   useAgentsListStore,
   type AgentColumn,
   type AgentsScope,
   type AgentsSortKey,
} from '@/store/agents-list-store';
import { useAgentsStore } from '@/store/agents-store';

const SCOPES: AgentsScope[] = ['all', 'archived'];
const SORTS: AgentsSortKey[] = ['activity', 'name', 'runs', 'created'];

/**
 * The agents toolbar: which agents, narrowed how, in what order, showing what.
 *
 * Every control writes to the list store rather than to the table, because the
 * page mounts this as a header and the table as its body — they never share a
 * parent that could hold the state between them.
 */
export default function HeaderOptions() {
   const t = useTranslations('agentsChat.list');
   const tHeader = useTranslations('agents.header');
   const agents = useAgentsStore((state) => state.agents);
   const archived = useAgentsStore((state) => state.archived);
   const {
      scope,
      sortKey,
      sortDescending,
      filters,
      columns,
      setScope,
      sortBy,
      setFilters,
      toggleColumn,
   } = useAgentsListStore();
   const filterColumns = useAgentFilterColumns();
   const filter = useListFilters({
      data: scope === 'archived' ? (archived ?? []) : agents,
      columns: filterColumns,
      filters,
      onFiltersChange: setFilters,
   });

   // An archive nobody has opened yet has no count rather than a count of
   // zero: the two mean different things and only one of them is known.
   const counts: Record<AgentsScope, number | null> = {
      all: agents.length,
      archived: archived?.length ?? null,
   };

   const scopeLabel: Record<AgentsScope, string> = {
      all: t('scopeAll'),
      archived: t('scopeArchived'),
   };

   const columnLabel: Record<AgentColumn, string> = {
      activity: t('colActivity'),
      lastActive: t('colLastActive'),
      model: t('colModel'),
      access: t('colAccess'),
   };

   const sortLabel: Record<AgentsSortKey, string> = {
      activity: t('sortActivity'),
      name: t('sortName'),
      runs: t('sortRuns'),
      created: t('sortCreated'),
   };

   return (
      <div className="flex min-h-10 w-full flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b px-6 py-1.5">
         <div className="flex shrink-0 items-center gap-3">
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

         <div className="flex shrink-0 items-center gap-1">
            <ListFilterTrigger filter={filter} />

            <DropdownMenu>
               <DropdownMenuTrigger asChild>
                  <Button size="xs" variant="outline" className="border-muted-foreground/15">
                     <Columns3 className="size-4" />
                     {t('columns')}
                  </Button>
               </DropdownMenuTrigger>
               <DropdownMenuContent align="end" className="w-52">
                  {AGENT_COLUMNS.map((column) => (
                     <DropdownMenuItem
                        key={column}
                        // The menu stays open: choosing columns is a series of
                        // decisions, and reopening it after each one is a tax
                        // on the person who wants three of them.
                        onSelect={(event) => {
                           event.preventDefault();
                           toggleColumn(column);
                        }}
                     >
                        <Check
                           className={cn(
                              'size-3.5',
                              columns.includes(column) ? 'opacity-100' : 'opacity-0'
                           )}
                        />
                        {columnLabel[column]}
                     </DropdownMenuItem>
                  ))}
               </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
               <DropdownMenuTrigger asChild>
                  <Button size="xs" variant="outline" className="border-muted-foreground/15">
                     {sortLabel[sortKey]}
                     {sortDescending ? (
                        <ArrowDown className="size-4" />
                     ) : (
                        <ArrowUp className="size-4" />
                     )}
                  </Button>
               </DropdownMenuTrigger>
               <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuLabel>{t('sort')}</DropdownMenuLabel>
                  {SORTS.map((key) => (
                     <DropdownMenuItem key={key} onSelect={() => sortBy(key)}>
                        <Check
                           className={cn('size-3.5', sortKey === key ? 'opacity-100' : 'opacity-0')}
                        />
                        {sortLabel[key]}
                     </DropdownMenuItem>
                  ))}
               </DropdownMenuContent>
            </DropdownMenu>
         </div>
      </div>
   );
}
