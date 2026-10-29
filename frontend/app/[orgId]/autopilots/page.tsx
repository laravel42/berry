'use client';

import { Plus, Search } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';

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
import type { FiltersState } from '@/components/data-table-filter/core/types';
import MainLayout from '@/components/layout/main-layout';
import { Button } from '@/components/ui/button';
import type { User } from '@/data/users';
import { useAutopilots } from '@/hooks/use-autopilots';
import type { Autopilot } from '@/lib/autopilots';
import { WORKSPACE_SLUG } from '@/lib/config';
import { loadWorkspaceMembers } from '@/lib/members';
import { canEditProduct } from '@/lib/workspace-role';
import { useAgentsStore } from '@/store/agents-store';
import { useSessionStore } from '@/store/session-store';

export default function AutopilotsPage() {
   const t = useTranslations('areas.autopilots');
   const router = useRouter();
   const params = useParams<{ orgId?: string }>();
   const orgId = params?.orgId || WORKSPACE_SLUG;
   const workspaceId = useSessionStore((state) => state.workspace?.id);
   const canEdit = canEditProduct(useSessionStore((state) => state.workspace?.role));
   const agents = useAgentsStore((state) => state.agents);
   const [scope, setScope] = useState<AutopilotScope>('all');
   const [archivedTouched, setArchivedTouched] = useState(false);
   const live = useAutopilots();
   const archived = useAutopilots({ archived: true, enabled: archivedTouched });
   const { error, loaded } = scope === 'archived' ? archived : live;

   /** Switch flips not yet confirmed by a reload, so the row moves at once. */
   const [pending, setPending] = useState<Record<string, 'active' | 'paused'>>({});
   const liveRows = useMemo(
      () =>
         live.autopilots.map((autopilot) =>
            pending[autopilot.id] ? { ...autopilot, status: pending[autopilot.id] } : autopilot
         ),
      [live.autopilots, pending]
   );
   useEffect(() => setPending({}), [live.autopilots]);

   const scoped = useMemo(() => {
      if (scope === 'archived') return archived.autopilots;
      if (scope === 'all') return liveRows;
      return liveRows.filter((autopilot) => autopilot.status === scope);
   }, [scope, archived.autopilots, liveRows]);

   const [people, setPeople] = useState<User[]>([]);
   const [criteria, setCriteria] = useState<AutopilotCriteria>(DEFAULT_AUTOPILOT_CRITERIA);
   const [filters, setFilters] = useState<FiltersState>([]);
   const [query, setQuery] = useState('');

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
      for (const autopilot of scoped) if (autopilot.createdBy) seen.add(autopilot.createdBy);
      return [...seen].map((id) => {
         const person = people.find((entry) => entry.id === id);
         return { id, name: person?.name ?? t('row.someone'), avatarUrl: person?.avatarUrl };
      });
   }, [scoped, people, t]);

   const filterColumns = useAutopilotFilterColumns(assignees, creators);
   const filter = useListFilters({
      data: scoped,
      columns: filterColumns,
      filters,
      onFiltersChange: setFilters,
   });

   /** The list arrives whole and is short, so it is narrowed here. */
   const shown = useMemo(() => {
      const filtered = applyListFilters(scoped, filterColumns, filters);
      const term = query.trim().toLowerCase();
      if (!term) return filtered;
      return filtered.filter((autopilot) => {
         if (autopilot.name.toLowerCase().includes(term)) return true;
         if ((autopilot.description ?? '').toLowerCase().includes(term)) return true;
         return assigneeName(autopilot).toLowerCase().includes(term);
      });
   }, [scoped, filterColumns, filters, query, assigneeName]);

   const reload = () => {
      live.reload();
      archived.reload();
   };

   const header = (
      <div className="settings-surface">
         <header className="flex h-[52px] w-full items-center gap-2.5 border-b px-5">
            <h1 className="font-semibold tracking-[-0.01em]">{t('title')}</h1>
            <label className="ml-auto flex h-[30px] w-[clamp(160px,22vw,280px)] items-center gap-2 rounded-[7px] bg-segment-track px-2.5 text-settings-placeholder">
               <Search className="size-[13px] shrink-0" aria-hidden />
               <input
                  // Not type="search": globals.css pins that type to 16px.
                  type="text"
                  role="searchbox"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('search')}
                  aria-label={t('search')}
                  className="min-w-0 flex-1 border-0 bg-transparent p-0 text-foreground outline-none [font:inherit] placeholder:text-placeholder"
               />
            </label>
            {canEdit ? (
               <Button className="shrink-0" onClick={() => router.push(`/${orgId}/autopilots/new`)}>
                  <Plus className="size-[13px]" strokeWidth={2.2} aria-hidden />
                  {t('new')}
               </Button>
            ) : null}
         </header>
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
               all: liveRows.length,
               active: liveRows.filter((autopilot) => autopilot.status === 'active').length,
               paused: liveRows.filter((autopilot) => autopilot.status === 'paused').length,
               archived: archived.loaded ? archived.autopilots.length : null,
            }}
         />
         <ListFilterBar filter={filter} />
      </div>
   );

   return (
      <MainLayout header={header}>
         <div className="settings-surface h-full">
            <Autopilots
               autopilots={shown}
               loaded={loaded}
               error={error}
               criteria={criteria}
               assigneeName={assigneeName}
               canEdit={canEdit}
               narrowed={filter.filters.length > 0 || query.trim() !== ''}
               query={query}
               empty={live.loaded && live.autopilots.length === 0}
               onCriteriaChange={setCriteria}
               archived={scope === 'archived'}
               onChanged={reload}
               onStatusChange={(id, status) =>
                  setPending((current) => ({ ...current, [id]: status }))
               }
               onUseTemplate={(key) => router.push(`/${orgId}/autopilots/new?template=${key}`)}
            />
         </div>
      </MainLayout>
   );
}
