'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { health as HEALTH, Project } from '@/data/projects';
import type { Status } from '@/data/status';
import { priorities as PRIORITIES } from '@/data/priorities';
import { pinTarget } from '@/lib/pins';
import { useIssuesStore } from '@/store/issues-store';
import { usePinsStore } from '@/store/pins-store';
import { useProjectsStore } from '@/store/projects-store';
import { useProjectsFilterStore } from '@/store/projects-filter-store';
import { useProjectsDisplayStore, type ProjectsOrdering } from '@/store/projects-display-store';
import { useRightPanelStore } from '@/store/right-panel-store';
import { useSessionStore } from '@/store/session-store';
import { BarChart3, Box, LayoutGrid, List } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
   applyListFilters,
   ListFilterBar,
   ListFilterTrigger,
   useListFilters,
} from '@/components/common/filters/list-filters';
import { PageKpiHeader, type Kpi } from '@/components/common/page/page-parts';
import { KPI_DAYS, useWorkKpis } from '@/components/common/usage/use-work-kpis';
import { formatAge, formatCost, formatSpanShort } from '@/lib/usage';
import ProjectsBoard, { type ProjectBoardEntry } from './projects-board';
import { CreateProjectButton } from './create-project-button';
import { CreateProjectDialog } from './create-project-dialog';
import { EmptyProjects } from './empty-projects';
import { ProjectsDisplayOptions } from './projects-display-options';
import ProjectsInsightsPanel from './projects-insights-panel';
import ProjectsList from './projects-list';
import { useProjectFilterColumns } from './project-filter-columns';
import { projectCreateStatusOptions } from './create-project/project-status-options';

/** How one group of projects is found and shown; a status group also takes drops. */
interface ProjectGroupSpec {
   id: string;
   name: string;
   icon: React.ReactNode;
   status?: Status;
   match: (project: Project) => boolean;
}

export interface ProjectGroup {
   id: string;
   name: string;
   icon?: string;
   projects: Project[];
}

/** Categories hidden by "Show closed projects: Hide closed". */
const CLOSED_CATEGORIES = new Set(['completed', 'canceled']);

const STATUS_SORT_ORDER: Record<string, number> = {
   'to-do': 0,
   'in-progress': 1,
   'paused': 2,
   'done': 3,
   'cancelled': 4,
};

const PRIORITY_SORT_ORDER: Record<string, number> = {
   'urgent': 0,
   'high': 1,
   'medium': 2,
   'low': 3,
   'no-priority': 4,
};

/** A missing date sorts last in either direction. */
const byDate = (a: string | undefined, b: string | undefined) =>
   a && b ? a.localeCompare(b) : a ? -1 : b ? 1 : 0;

function sortProjects(list: Project[], ordering: ProjectsOrdering, direction: 'asc' | 'desc') {
   const compare = (a: Project, b: Project): number => {
      switch (ordering) {
         case 'start-date':
            return byDate(a.startDate, b.startDate);
         case 'target-date':
            return byDate(a.targetDate, b.targetDate);
         case 'status':
            return (STATUS_SORT_ORDER[a.status.id] ?? 99) - (STATUS_SORT_ORDER[b.status.id] ?? 99);
         case 'priority':
            return (
               (PRIORITY_SORT_ORDER[a.priority.id] ?? 99) -
               (PRIORITY_SORT_ORDER[b.priority.id] ?? 99)
            );
         case 'created':
            return a.createdAt.localeCompare(b.createdAt);
         case 'updated':
            return a.updatedAt.localeCompare(b.updatedAt);
         case 'title':
         default:
            return a.name.localeCompare(b.name);
      }
   };
   const sign = direction === 'asc' ? 1 : -1;
   return list.slice().sort((a, b) => sign * compare(a, b) || a.name.localeCompare(b.name));
}

function applyClosedFilter(list: Project[], closedProjects: string): Project[] {
   if (closedProjects !== 'hide') return list.slice();
   return list.filter((project) => !CLOSED_CATEGORIES.has(project.status.category));
}

function applySearch(list: Project[], query: string): Project[] {
   const term = query.trim().toLowerCase();
   if (!term) return list;
   return list.filter((project) => project.name.toLowerCase().includes(term));
}

function percentCompleteForProject(
   issues: ReturnType<typeof useIssuesStore.getState>['issues'],
   projectId: string
): number {
   const linked = issues.filter((issue) => issue.project?.id === projectId);
   if (linked.length === 0) return 0;
   const done = linked.filter((issue) => issue.status.category === 'completed').length;
   return Math.round((done / linked.length) * 100);
}

const LAYOUTS: { value: 'list' | 'board'; icon: React.ElementType }[] = [
   { value: 'list', icon: List },
   { value: 'board', icon: LayoutGrid },
];

const DAY_MS = 86_400_000;

/**
 * The Projects page's KPI cards. Counts come from the stores the page already
 * holds; spend, agent time and what waits on a person come from the usage read.
 * A figure stays undefined until its source has answered.
 */
function useProjectKpis(
   projects: Project[],
   /** Whether the store has answered: an empty list is then a real zero. */
   known: boolean,
   issues: ReturnType<typeof useIssuesStore.getState>['issues'],
   data: ReturnType<typeof useWorkKpis>
): Kpi[] {
   const t = useTranslations('issueLists.projects.kpi');
   return useMemo(() => {
      const open = projects.filter((project) => !CLOSED_CATEGORIES.has(project.status.category));
      const openIds = new Set(open.map((project) => project.id));
      // Every task of an open project, cancelled ones too: the same basis as a row's percentage.
      const tasks = issues.filter((issue) => issue.project && openIds.has(issue.project.id));
      const done = tasks.filter((issue) => issue.status.category === 'completed').length;
      const next = open
         .filter((project) => project.targetDate)
         .sort((a, b) => String(a.targetDate).localeCompare(String(b.targetDate)))[0];
      const days = next
         ? Math.ceil((Date.parse(String(next.targetDate)) - Date.now()) / DAY_MS)
         : null;
      const work = data?.work;
      const waiting = work ? work.waiting.reviews + work.waiting.decisions : undefined;

      return [
         {
            label: t('running'),
            value: known ? open.length : undefined,
            detail: known
               ? t('runningDetail', { finished: projects.length - open.length })
               : undefined,
         },
         {
            label: t('completion'),
            value: known
               ? tasks.length > 0
                  ? `${Math.round((done / tasks.length) * 100)}%`
                  : '–'
               : undefined,
            detail: known ? t('completionDetail', { done, total: tasks.length }) : undefined,
         },
         {
            label: t('nextDue'),
            value: known
               ? days === null
                  ? t('noDue')
                  : days < 0
                    ? t('overdue', { days: -days })
                    : `${days} d`
               : undefined,
            detail: next?.name,
            tone: days !== null && days < 0 ? 'text-status-warning' : undefined,
         },
         {
            label: t('waiting'),
            value: waiting,
            detail: work
               ? work.waiting.oldestAt
                  ? t('waitingDetail', {
                       decisions: work.waiting.decisions,
                       reviews: work.waiting.reviews,
                       age: formatAge(work.waiting.oldestAt),
                    })
                  : t('waitingNone', {
                       decisions: work.waiting.decisions,
                       reviews: work.waiting.reviews,
                    })
               : undefined,
            tone: waiting ? 'text-status-warning' : undefined,
         },
         {
            label: t('spend', { days: KPI_DAYS }),
            value: data ? formatCost(data.costMicros) : undefined,
            detail:
               data && work && work.tasksDone > 0
                  ? t('spendDetail', {
                       cost: formatCost(Math.round(data.costMicros / work.tasksDone)),
                    })
                  : undefined,
         },
         {
            label: t('agentTime', { days: KPI_DAYS }),
            value: work ? formatSpanShort(work.runSeconds) : undefined,
            detail: work
               ? t('agentTimeDetail', { agents: work.byAgent.length, runs: work.runs })
               : undefined,
         },
      ];
   }, [projects, known, issues, data, t]);
}

/** Projects page: search, filters, display options, views and insights. */
export default function Projects() {
   const lists = useTranslations('issueLists');
   const { filters, setFilters, query, setQuery } = useProjectsFilterStore();
   const { viewType, setViewType, grouping, ordering, direction, closedProjects, showEmptyGroups } =
      useProjectsDisplayStore();
   const { openPanel, togglePanel } = useRightPanelStore();
   const allProjects = useProjectsStore((state) => state.projects);
   const issues = useIssuesStore((state) => state.issues);
   const workspaceId = useSessionStore((state) => state.workspace?.id ?? '');
   const { pins, add: addPin } = usePinsStore();
   const [selected, setSelected] = useState<string[]>([]);

   const enriched = useMemo(
      () =>
         allProjects.map((project) => ({
            ...project,
            percentComplete: percentCompleteForProject(issues, project.id),
         })),
      [allProjects, issues]
   );

   const scoped = useMemo(
      () => applyClosedFilter(enriched, closedProjects),
      [enriched, closedProjects]
   );

   const filterColumns = useProjectFilterColumns();
   const filter = useListFilters({
      data: scoped,
      columns: filterColumns,
      filters,
      onFiltersChange: setFilters,
   });

   const displayed = useMemo(
      () =>
         sortProjects(
            applySearch(applyListFilters(scoped, filterColumns, filters), query),
            ordering,
            direction
         ),
      [scoped, filterColumns, filters, query, ordering, direction]
   );

   // Spend, agent time and what waits on a person are read per project when the
   // list shows exactly one; otherwise for the whole workspace.
   const soleProject = displayed.length === 1 ? displayed[0]!.id : undefined;
   const data = useWorkKpis({ projectId: soleProject });

   // One description of the groups serves both layouts: the list renders
   // it as sections, the board as columns. Only status columns can take a
   // dropped card or create a project, so only those carry the status.
   const grouped = useMemo(() => {
      const none: ProjectGroupSpec[] = [
         {
            id: 'all',
            name: 'All projects',
            icon: <Box className="size-4 text-muted-foreground" />,
            match: () => true,
         },
      ];
      const byStatus: ProjectGroupSpec[] = projectCreateStatusOptions.map((option) => ({
         id: option.status.id,
         name: option.label,
         icon: <option.status.icon />,
         status: option.status,
         match: (project: Project) => project.status.id === option.status.id,
      }));
      const byPriority: ProjectGroupSpec[] = PRIORITIES.map((priority) => ({
         id: priority.id,
         name: priority.name,
         icon: <priority.icon />,
         match: (project: Project) => project.priority.id === priority.id,
      }));
      const byHealth: ProjectGroupSpec[] = HEALTH.map((entry) => ({
         id: entry.id,
         name: entry.name,
         icon: (
            <span
               aria-hidden
               className="inline-block size-2.5 rounded-full"
               style={{ background: entry.color }}
            />
         ),
         match: (project: Project) => project.health.id === entry.id,
      }));
      // Leads are whoever leads a project here, alphabetical; no fixed vocabulary.
      const leads = new Map<string, Project['lead']>();
      for (const project of scoped) leads.set(project.lead.id, project.lead);
      const byLead: ProjectGroupSpec[] = [...leads.values()]
         .sort((a, b) => a.name.localeCompare(b.name))
         .map((lead) => ({
            id: lead.id,
            name: lead.name,
            icon: <Box className="size-4 text-muted-foreground" />,
            match: (project: Project) => project.lead.id === lead.id,
         }));
      const descriptors =
         grouping === 'status'
            ? byStatus
            : grouping === 'priority'
              ? byPriority
              : grouping === 'lead'
                ? byLead
                : grouping === 'health'
                  ? byHealth
                  : none;
      return descriptors.map((descriptor) => ({
         ...descriptor,
         projects: displayed.filter(descriptor.match),
         total: scoped.filter(descriptor.match).length,
      }));
   }, [displayed, grouping, scoped]);

   const boardEntries = useMemo<ProjectBoardEntry[]>(
      () =>
         grouped.map(({ id, name, icon, status, projects, total }) => ({
            group: { id, name, icon, status },
            projects,
            total,
         })),
      [grouped]
   );

   const groups = useMemo<ProjectGroup[]>(
      () =>
         grouped
            .map(({ id, name, projects }) => ({ id, name, projects }))
            .filter((group) => grouping === 'none' || showEmptyGroups || group.projects.length > 0),
      [grouped, grouping, showEmptyGroups]
   );

   // The cards describe the projects on the board, after search, filters and
   // the closed toggle, not the whole workspace.
   const kpis = useProjectKpis(displayed, enriched.length > 0, issues, data);

   const toggleSelected = (projectId: string) =>
      setSelected((previous) =>
         previous.includes(projectId)
            ? previous.filter((entry) => entry !== projectId)
            : [...previous, projectId]
      );

   /* Pinning a selection is the one bulk action a project list needs: it is
      how a team puts this quarter's work in the rail in one go. */
   const pinSelected = () => {
      const pending = selected.filter(
         (projectId) =>
            !pins.some((pin) => pin.targetType === 'project' && pin.targetId === projectId)
      );
      void Promise.all(pending.map((projectId) => pinTarget(workspaceId, 'project', projectId)))
         .then((created) => {
            for (const pin of created) addPin(pin);
            setSelected([]);
         })
         .catch(() => toast.error('Those projects could not be pinned.'));
   };

   return (
      <div className="w-full h-full flex flex-col overflow-hidden">
         <CreateProjectDialog />
         <div className="w-full shrink-0">
            <PageKpiHeader label={lists('projects.title')} kpis={kpis}>
               <Input
                  className="h-9 w-64 max-sm:w-40"
                  placeholder={lists('projects.search')}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
               />
               <CreateProjectButton />
            </PageKpiHeader>
         </div>
         <div className="mb-1 flex w-full shrink-0 flex-wrap items-center gap-2 border-b px-6 py-[6px] [&_button]:!h-9">
            <div
               role="group"
               aria-label={lists('projects.layout.label')}
               className="flex items-center rounded-md border p-0.5"
            >
               {LAYOUTS.map((layout) => {
                  const on = viewType === layout.value;
                  return (
                     <button
                        key={layout.value}
                        type="button"
                        aria-pressed={on}
                        aria-label={lists(`projects.layout.${layout.value}`)}
                        title={lists(`projects.layout.${layout.value}`)}
                        onClick={() => setViewType(layout.value)}
                        className={cn(
                           'flex w-10 items-center justify-center rounded outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                           on
                              ? 'bg-secondary text-foreground'
                              : 'text-muted-foreground hover:text-foreground'
                        )}
                     >
                        <layout.icon className="size-4" />
                     </button>
                  );
               })}
            </div>
            <div className="ml-auto flex flex-wrap items-center justify-end gap-1">
               <ListFilterTrigger filter={filter} />
               <Button
                  size="xs"
                  variant="outline"
                  className={cn(
                     'border-muted-foreground/15',
                     openPanel === 'insights' && 'bg-secondary hover:bg-secondary/80'
                  )}
                  onClick={() => togglePanel('insights')}
               >
                  <BarChart3 className="size-4" />
                  {lists('projects.insights')}
               </Button>
               <ProjectsDisplayOptions />
            </div>
         </div>

         <ListFilterBar filter={filter} />

         {selected.length > 0 && (
            <div className="flex items-center gap-2 border-b bg-accent/40 px-6 py-1.5 shrink-0">
               <span>{lists('projects.selected', { count: selected.length })}</span>
               <Button size="xs" variant="secondary" onClick={pinSelected}>
                  {lists('projects.bulkPin')}
               </Button>
               <Button
                  size="xs"
                  variant="ghost"
                  className="ml-auto"
                  onClick={() => setSelected([])}
               >
                  {lists('selection.clear')}
               </Button>
            </div>
         )}

         <div className="flex-1 min-h-0 w-full flex overflow-hidden">
            <div className="flex-1 min-w-0 h-full overflow-hidden">
               {viewType === 'board' ? (
                  <ProjectsBoard
                     entries={boardEntries}
                     totalCount={scoped.length}
                     filteredCount={displayed.length}
                     showEmptyGroups={showEmptyGroups}
                     empty={allProjects.length === 0}
                  />
               ) : displayed.length === 0 ? (
                  allProjects.length === 0 ? (
                     <EmptyProjects />
                  ) : (
                     <div className="flex h-full items-center justify-center text-muted-foreground">
                        {lists('projects.noneMatch')}
                     </div>
                  )
               ) : (
                  <>
                     {viewType === 'list' && (
                        <ProjectsList
                           groups={groups}
                           selected={selected}
                           onToggleSelected={toggleSelected}
                        />
                     )}
                  </>
               )}
            </div>

            {openPanel === 'insights' && (
               <aside className="hidden lg:flex w-[360px] shrink-0 border-l h-full overflow-hidden bg-container">
                  <ProjectsInsightsPanel projects={displayed} />
               </aside>
            )}
         </div>
      </div>
   );
}
