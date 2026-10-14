'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';

import AutopilotDialog from '@/components/common/autopilots/autopilot-dialog';
import Autopilots from '@/components/common/autopilots/autopilots';
import AutopilotsFilters, {
   DEFAULT_AUTOPILOT_CRITERIA,
   useAutopilotFilterColumns,
   type AutopilotCriteria,
   type AutopilotScope,
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
   const [scope, setScope] = useState<AutopilotScope>('all');
   const [archivedTouched, setArchivedTouched] = useState(false);
   const live = useAutopilots();
   const archived = useAutopilots({ archived: true, enabled: archivedTouched });
   const { autopilots, error, loaded } = scope === 'archived' ? archived : live;

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

   const header = (
      <>
         <PageStatement label={t('title')}>
            <div className="flex min-w-0 items-center gap-2">
               <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('search')}
                  aria-label={t('search')}
                  className="h-[34px] w-48 min-w-0"
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
                     {t('new')}
                  </Button>
               ) : null}
            </div>
         </PageStatement>
         <AutopilotsFilters
            criteria={criteria}
            onChange={setCriteria}
            filter={filter}
            scope={scope}
            onScopeChange={(next) => {
               setScope(next);
               setFilters([]);
               if (next === 'archived') setArchivedTouched(true);
            }}
            counts={{
               all: live.loaded ? live.autopilots.length : 0,
               archived: archived.loaded ? archived.autopilots.length : null,
            }}
         />
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
            narrowed={filter.filters.length > 0 || query.trim() !== ''}
            onCriteriaChange={setCriteria}
            archived={scope === 'archived'}
            onChanged={() => {
               live.reload();
               archived.reload();
            }}
            onUseTemplate={(chosen) => {
               setTemplate(chosen);
               setCreating(true);
            }}
         />
         <AutopilotDialog
            open={creating}
            onOpenChange={setCreating}
            template={template}
            onSaved={() => {
               live.reload();
               archived.reload();
            }}
         />
      </MainLayout>
   );
}
