'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Check, Columns3, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import {
   DropdownMenu,
   DropdownMenuContent,
   DropdownMenuItem,
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
} from '@/store/agents-list-store';
import { useAgentsStore } from '@/store/agents-store';

const SCOPES: AgentsScope[] = ['all', 'archived'];

/**
 * The agents toolbar: which agents, narrowed how, showing what.
 *
 * Every control writes to the list store rather than to the table, because the
 * page mounts this as a header and the table as its body — they never share a
 * parent that could hold the state between them. Sort is on the table headings.
 */
export default function HeaderOptions() {
   const t = useTranslations('agentsChat.list');
   const tHeader = useTranslations('agents.header');
   const { orgId } = useParams<{ orgId: string }>();
   const agents = useAgentsStore((state) => state.agents);
   const archived = useAgentsStore((state) => state.archived);
   const { scope, filters, columns, setScope, setFilters, toggleColumn } = useAgentsListStore();
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

   return (
      <div className="mb-1 flex w-full shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b px-4 py-[6px] [&_button]:!h-9 [&_a]:!h-9 [&_button[aria-label='New agent']]:!h-[34px] [&_button[aria-label='New agent']]:!w-[42px] [&_a[aria-label='New agent']]:!h-[34px] [&_a[aria-label='New agent']]:!w-[42px]">
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

            <ListFilterTrigger filter={filter} />

            <DropdownMenu>
               <DropdownMenuTrigger asChild>
                  <Button size="xs" variant="outline" className="border-muted-foreground/15">
                     <Columns3 className="size-4" />
                     {t('columns')}
                  </Button>
               </DropdownMenuTrigger>
               <DropdownMenuContent align="start" className="w-52">
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
         </div>

         <Button
            size="xs"
            className="ml-auto h-[34px] w-[42px] shrink-0 px-0"
            aria-label={tHeader('newAgent')}
            title={tHeader('newAgent')}
            asChild
         >
            <Link href={`/${orgId}/agents/new`}>
               <Plus className="size-4" />
            </Link>
         </Button>
      </div>
   );
}
