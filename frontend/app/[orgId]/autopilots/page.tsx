'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';

import AutopilotDialog from '@/components/common/autopilots/autopilot-dialog';
import Autopilots from '@/components/common/autopilots/autopilots';
import AutopilotsFilters, {
   DEFAULT_AUTOPILOT_CRITERIA,
   useAutopilotFilterColumns,
   type AutopilotCriteria,
} from '@/components/common/autopilots/autopilots-filters';
import {
   applyListFilters,
   ListFilterBar,
   useListFilters,
} from '@/components/common/filters/list-filters';
import { PageStatement } from '@/components/common/page/page-parts';
import type { FiltersState } from '@/components/data-table-filter/core/types';
import MainLayout from '@/components/layout/main-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { User } from '@/data/users';
import { Plus } from 'lucide-react';
import { useAutopilots } from '@/hooks/use-autopilots';
import type { Autopilot } from '@/lib/autopilots';
import { loadWorkspaceMembers } from '@/lib/members';
import { canEditProduct } from '@/lib/workspace-role';
import { useAgentsStore } from '@/store/agents-store';
import { useSessionStore } from '@/store/session-store';

export default function AutopilotsPage() {
   const t = useTranslations('areas.autopilots');
   const workspaceId = useSessionStore((state) => state.workspace?.id);
   const canEdit = canEditProduct(useSessionStore((state) => state.workspace?.role));
   const agents = useAgentsStore((state) => state.agents);
   const { autopilots, error, loaded, reload } = useAutopilots();

   const [people, setPeople] = useState<User[]>([]);
   const [criteria, setCriteria] = useState<AutopilotCriteria>(DEFAULT_AUTOPILOT_CRITERIA);
   const [filters, setFilters] = useState<FiltersState>([]);
   const [query, setQuery] = useState('');
   const [creating, setCreating] = useState(false);
   const [template, setTemplate] = useState<{ name: string; prompt: string } | null>(null);

   useEffect(() => {
      if (!workspaceId) return;
      let cancelled = false;
      void loadWorkspaceMembers(workspaceId).then(
         (found) => {
            if (!cancelled) setPeople(found);
         },
         () => undefined
      );
      return () => {
         cancelled = true;
      };
   }, [workspaceId]);

   const assigneeName = useMemo(() => {
      return (autopilot: Autopilot) => {
         const name = agents.find((agent) => agent.id === autopilot.assigneeId)?.name;
         return name ?? t('row.unknownAssignee');
      };
   }, [agents, t]);

   const assignees = useMemo(
      () => agents.map((agent) => ({ id: agent.id, name: agent.name })),
      [agents]
   );

   const creators = useMemo(() => {
      const seen = new Set<string>();
      for (const autopilot of autopilots) if (autopilot.createdBy) seen.add(autopilot.createdBy);
      return [...seen].map((id) => {
         const person = people.find((entry) => entry.id === id);
         return { id, name: person?.name ?? t('row.someone'), avatarUrl: person?.avatarUrl };
      });
   }, [autopilots, people, t]);

   const filterColumns = useAutopilotFilterColumns(assignees, creators);
   const filter = useListFilters({
      data: autopilots,
      columns: filterColumns,
      filters,
      onFiltersChange: setFilters,
   });

   /** The list arrives whole and is short, so it is narrowed here. */
   const shown = useMemo(() => {
      const filtered = applyListFilters(autopilots, filterColumns, filters);
      const term = query.trim().toLowerCase();
      if (!term) return filtered;
      return filtered.filter((autopilot) => {
         if (autopilot.name.toLowerCase().includes(term)) return true;
         if ((autopilot.description ?? '').toLowerCase().includes(term)) return true;
         return assigneeName(autopilot).toLowerCase().includes(term);
      });
   }, [autopilots, filterColumns, filters, query, assigneeName]);

   const enabled = autopilots.filter((autopilot) => autopilot.status === 'active').length;

   const header = (
      <>
         <PageStatement
            label={t('title')}
            figure={loaded ? enabled : undefined}
            line={t('statement.line', { count: enabled })}
            sub={t('statement.sub')}
         >
            <div className="flex items-center gap-2">
               <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('search')}
                  aria-label={t('search')}
                  className="h-[34px] w-48"
               />
               {canEdit ? (
                  <Button
                     size="xs"
                     className="h-[34px] shrink-0"
                     onClick={() => {
                        setTemplate(null);
                        setCreating(true);
                     }}
                  >
                     <Plus className="size-4" aria-hidden />
                     {t('new')}
                  </Button>
               ) : null}
            </div>
         </PageStatement>
         <AutopilotsFilters criteria={criteria} onChange={setCriteria} filter={filter} />
         <ListFilterBar filter={filter} />
      </>
   );

   return (
      <MainLayout header={header}>
         <Autopilots
            autopilots={shown}
            loaded={loaded}
            error={error}
            criteria={criteria}
            assigneeName={assigneeName}
            canEdit={canEdit}
            onChanged={reload}
            narrowed={filter.filters.length > 0 || query.trim() !== ''}
            onCriteriaChange={setCriteria}
            onUseTemplate={(chosen) => {
               setTemplate(chosen);
               setCreating(true);
            }}
         />
         <AutopilotDialog
            open={creating}
            onOpenChange={setCreating}
            template={template}
            onSaved={reload}
         />
      </MainLayout>
   );
}
