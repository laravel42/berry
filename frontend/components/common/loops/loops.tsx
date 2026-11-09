'use client';

import { Plus, X } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
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
import LoopActivity from '@/components/common/loops/loop-activity';
import { PageKpiHeader, type Kpi } from '@/components/common/page/page-parts';
import type { FiltersState } from '@/components/data-table-filter/core/types';
import MainLayout from '@/components/layout/main-layout';
import { useShortcut } from '@/components/layout/shortcut-provider';
import { Button } from '@/components/ui/button';
import { Input, searchFieldClass } from '@/components/ui/input';
import type { User } from '@/data/users';
import { useAutopilots } from '@/hooks/use-autopilots';
import { useLoopActivity } from '@/hooks/use-loop-activity';
import { listLoopTemplates, type Autopilot, type LoopTemplate } from '@/lib/autopilots';
import { WORKSPACE_SLUG } from '@/lib/config';
import { loadWorkspaceMembers } from '@/lib/members';
import { canEditProduct } from '@/lib/workspace-role';
import { useAgentsStore } from '@/store/agents-store';
import { useSessionStore } from '@/store/session-store';

/**
 * The workspace's Loops: what is set up, what it has been doing, and what
 * needs someone. A Loop is a standing instruction an agent carries out on a
 * schedule or when something happens; each firing is one run, inspectable on
 * its own page.
 *
 * `?project=<id>` narrows the list to one project's Loops — how a project
 * page links here — without a second copy of the list.
 */
export default function Loops() {
   const t = useTranslations('loops');
   const router = useRouter();
   const searchParams = useSearchParams();
   const params = useParams<{ orgId?: string }>();
   const orgId = params?.orgId || WORKSPACE_SLUG;
   const projectId = searchParams?.get('project') ?? null;
   const workspaceId = useSessionStore((state) => state.workspace?.id);
   const canEdit = canEditProduct(useSessionStore((state) => state.workspace?.role));
   const agents = useAgentsStore((state) => state.agents);
   const [scope, setScope] = useState<AutopilotScope>('all');
   const [archivedTouched, setArchivedTouched] = useState(false);
   const live = useAutopilots();
   const archived = useAutopilots({ archived: true, enabled: archivedTouched });
   const activity = useLoopActivity();
   const source = scope === 'archived' ? archived : live;

   const [people, setPeople] = useState<User[]>([]);
   const [templates, setTemplates] = useState<LoopTemplate[]>([]);
   const [criteria, setCriteria] = useState<AutopilotCriteria>(DEFAULT_AUTOPILOT_CRITERIA);
   const [filters, setFilters] = useState<FiltersState>([]);
   const [query, setQuery] = useState('');

   useShortcut('loops.new', () => {
      if (canEdit) router.push(`/${orgId}/loops/new`);
   });

   useEffect(() => {
      if (!workspaceId) return;
      let cancelled = false;
      void loadWorkspaceMembers(workspaceId).then(
         (found) => {
            if (!cancelled) setPeople(found);
         },
         () => undefined
      );
      void listLoopTemplates(workspaceId).then(
         (found) => {
            if (!cancelled) setTemplates(found);
         },
         () => undefined
      );
      return () => {
         cancelled = true;
      };
   }, [workspaceId]);

   const loops = useMemo(
      () =>
         projectId
            ? source.autopilots.filter((loop) => loop.projectId === projectId)
            : source.autopilots,
      [source.autopilots, projectId]
   );

   const assigneeName = useMemo(() => {
      return (loop: Autopilot) => {
         const name = agents.find((agent) => agent.id === loop.assigneeId)?.name;
         return name ?? t('row.unknownAssignee');
      };
   }, [agents, t]);

   const assignees = useMemo(
      () => agents.map((agent) => ({ id: agent.id, name: agent.name })),
      [agents]
   );

   const creators = useMemo(() => {
      const seen = new Set<string>();
      for (const loop of loops) if (loop.createdBy) seen.add(loop.createdBy);
      return [...seen].map((id) => {
         const person = people.find((entry) => entry.id === id);
         return { id, name: person?.name ?? t('row.someone'), avatarUrl: person?.avatarUrl };
      });
   }, [loops, people, t]);

   const filterColumns = useAutopilotFilterColumns(assignees, creators);
   const filter = useListFilters({
      data: loops,
      columns: filterColumns,
      filters,
      onFiltersChange: setFilters,
   });

   /** The list arrives whole and is short, so it is narrowed here. */
   const shown = useMemo(() => {
      const filtered = applyListFilters(loops, filterColumns, filters);
      const term = query.trim().toLowerCase();
      if (!term) return filtered;
      return filtered.filter((loop) => {
         if (loop.name.toLowerCase().includes(term)) return true;
         if ((loop.description ?? '').toLowerCase().includes(term)) return true;
         return assigneeName(loop).toLowerCase().includes(term);
      });
   }, [loops, filterColumns, filters, query, assigneeName]);

   const kpis: Kpi[] =
      live.loaded && live.autopilots.length > 0
         ? [
              {
                 label: t('kpi.active'),
                 value: live.autopilots.filter((loop) => loop.status === 'active').length,
              },
              {
                 label: t('kpi.runs'),
                 value: live.autopilots.reduce((sum, loop) => sum + loop.activity.runsLast7Days, 0),
              },
              {
                 label: t('kpi.attention'),
                 ...(activity.loaded ? { value: activity.attention.length } : {}),
                 tone: activity.attention.length > 0 ? 'text-status-danger' : undefined,
              },
           ]
         : [];

   const reload = () => {
      live.reload();
      archived.reload();
      activity.reload();
   };

   const header = (
      <>
         <PageKpiHeader label={t('title')} kpis={kpis}>
            <Input
               className={`${searchFieldClass} w-64 max-sm:w-40`}
               value={query}
               onChange={(event) => setQuery(event.target.value)}
               placeholder={t('search')}
               aria-label={t('search')}
            />
            {canEdit ? (
               <Button asChild className="shrink-0">
                  <Link
                     href={`/${orgId}/loops/new${projectId ? `?project=${encodeURIComponent(projectId)}` : ''}`}
                  >
                     <Plus className="size-4" aria-hidden />
                     {t('new')}
                  </Link>
               </Button>
            ) : null}
         </PageKpiHeader>
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
         {projectId ? (
            <div className="flex items-center gap-2 border-b px-6 py-2 text-muted-foreground">
               {t('projectScope')}
               <Button asChild size="xs" variant="ghost">
                  <Link href={`/${orgId}/loops`} aria-label={t('projectScopeClear')}>
                     <X className="size-3.5" aria-hidden />
                     {t('projectScopeClear')}
                  </Link>
               </Button>
            </div>
         ) : null}
      </>
   );

   return (
      <MainLayout header={header}>
         <div className="flex h-full min-h-0 flex-col">
            {scope === 'all' && live.autopilots.length > 0 ? (
               <LoopActivity
                  recent={activity.recent}
                  attention={activity.attention}
                  canRetry={canEdit}
                  onChanged={reload}
               />
            ) : null}
            <div className="min-h-0 flex-1">
               <Autopilots
                  autopilots={shown}
                  loaded={source.loaded}
                  error={source.error}
                  criteria={criteria}
                  assigneeName={assigneeName}
                  canEdit={canEdit}
                  narrowed={filter.filters.length > 0 || query.trim() !== '' || projectId !== null}
                  onCriteriaChange={setCriteria}
                  archived={scope === 'archived'}
                  templates={templates}
                  onChanged={reload}
                  onUseTemplate={(template) =>
                     router.push(`/${orgId}/loops/new?template=${encodeURIComponent(template.key)}`)
                  }
               />
            </div>
         </div>
      </MainLayout>
   );
}
