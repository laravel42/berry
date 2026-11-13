'use client';

import { Button } from '@/components/ui/button';
import { Input, searchFieldClass } from '@/components/ui/input';
import { health as HEALTH, Project } from '@/data/projects';
import type { User } from '@/data/users';
import type { Status } from '@/data/status';
import { priorities as PRIORITIES } from '@/data/priorities';
import { pinTarget } from '@/lib/pins';
import { loadWorkspaceProjects } from '@/lib/projects';
import { useIssuesStore } from '@/store/issues-store';
import { usePinsStore } from '@/store/pins-store';
import { useProjectsStore } from '@/store/projects-store';
import { useProjectsFilterStore } from '@/store/projects-filter-store';
import { useProjectsDisplayStore, type ProjectsOrdering } from '@/store/projects-display-store';
import { useSessionStore } from '@/store/session-store';
import { Box, ChartNoAxesGantt, LayoutGrid, List } from 'lucide-react';
import { SegmentedControl } from '@/components/common/segmented-control';
import { cn } from '@/lib/utils';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
   applyListFilters,
   ListFilterBar,
   ListFilterTrigger,
   useListFilters,
} from '@/components/common/filters/list-filters';
import { PageKpiHeader } from '@/components/common/page/page-parts';
import ProjectsBoard, { type ProjectBoardEntry } from './projects-board';
import { CreateProjectButton } from './create-project-button';
import { CreateProjectDialog } from './create-project-dialog';
import { EmptyProjects } from './empty-projects';
import { ProjectsDisplayOptions } from './projects-display-options';
import ProjectsList from './projects-list';
import ProjectsTimeline from './projects-timeline';
import { useProjectFilterColumns } from './project-filter-columns';
import { projectCreateStatusOptions } from './create-project/project-status-options';
import type { ProjectsViewType } from '@/store/projects-display-store';

/** How one group of projects is found and shown; a status group also takes drops. */
interface ProjectGroupSpec {
   id: string;
   name: string;
   icon: ReactNode;
   status?: Status;
   match: (project: Project) => boolean;
}

export interface ProjectGroup {
   id: string;
   name: string;
   icon?: ReactNode;
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

const LAYOUTS: { value: ProjectsViewType; icon: React.ElementType }[] = [
   { value: 'list', icon: List },
   { value: 'board', icon: LayoutGrid },
   { value: 'timeline', icon: ChartNoAxesGantt },
];

/** Projects page: search, filters, display options and views. */
export default function Projects() {
   const lists = useTranslations('issueLists');
   const { filters, setFilters, query, setQuery } = useProjectsFilterStore();
   const { viewType, setViewType, grouping, ordering, direction, closedProjects, showEmptyGroups } =
      useProjectsDisplayStore();
   const allProjects = useProjectsStore((state) => state.projects);
   const hydrateProjects = useProjectsStore((state) => state.hydrateProjects);
   const issues = useIssuesStore((state) => state.issues);
   const workspaceId = useSessionStore((state) => state.workspace?.id ?? '');
   const sessionStatus = useSessionStore((state) => state.status);
   const { pins, add: addPin } = usePinsStore();
   const [selected, setSelected] = useState<string[]>([]);

   // The list is a session snapshot. An agent-created project is already in
   // the database; opening this page reads it even if the stream missed it.
   useEffect(() => {
      if (sessionStatus !== 'ready' || !workspaceId) return;
      let cancelled = false;
      void loadWorkspaceProjects(workspaceId).then((projects) => {
         if (!cancelled) hydrateProjects(projects);
      });
      return () => {
         cancelled = true;
      };
   }, [sessionStatus, workspaceId, hydrateProjects]);

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
      // Projects with nobody leading them share one group at the end.
      const leads = new Map<string, User>();
      let unassigned = false;
      for (const project of scoped) {
         if (!project.lead) {
            unassigned = true;
            continue;
         }
         leads.set(project.lead.id, project.lead);
      }
      const byLead: ProjectGroupSpec[] = [...leads.values()]
         .sort((a, b) => a.name.localeCompare(b.name))
         .map((lead) => ({
            id: lead.id,
            name: lead.name,
            icon: <Box className="size-4 text-muted-foreground" />,
            match: (project: Project) => project.lead?.id === lead.id,
         }));
      if (unassigned) {
         byLead.push({
            id: 'no-lead',
            name: 'No lead',
            icon: <Box className="size-4 text-muted-foreground" />,
            match: (project: Project) => project.lead == null,
         });
      }
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
            .map(({ id, name, icon, projects }) => ({ id, name, icon, projects }))
            .filter((group) => grouping === 'none' || showEmptyGroups || group.projects.length > 0),
      [grouped, grouping, showEmptyGroups]
   );

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
            <PageKpiHeader label={lists('projects.title')}>
               <CreateProjectButton />
            </PageKpiHeader>
         </div>
         <div className="mb-1 flex h-[48px] w-full shrink-0 flex-wrap items-center gap-2 border-b px-5 py-[2px] [&_button]:!h-[30px]">
            <div className="flex flex-wrap items-center gap-1">
               <Input
                  className={cn(searchFieldClass, 'w-64 max-sm:w-40')}
                  placeholder={lists('projects.search')}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
               />
               <ListFilterTrigger filter={filter} iconOnly />
               <ProjectsDisplayOptions iconOnly />
            </div>
            <div className="ml-auto flex items-center gap-1.5">
               <SegmentedControl
                  aria-label={lists('projects.layout.label')}
                  value={viewType}
                  onValueChange={setViewType}
                  options={LAYOUTS.map((layout) => ({
                     value: layout.value,
                     title: lists(`projects.layout.${layout.value}`),
                     label: <layout.icon className="size-4" aria-hidden />,
                  }))}
               />
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

         <div className="relative flex-1 min-h-0 w-full flex overflow-hidden">
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
               ) : viewType === 'timeline' ? (
                  <ProjectsTimeline groups={groups} />
               ) : (
                  <ProjectsList
                     groups={groups}
                     selected={selected}
                     onToggleSelected={toggleSelected}
                  />
               )}
            </div>
         </div>
      </div>
   );
}
