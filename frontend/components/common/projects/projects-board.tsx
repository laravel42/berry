'use client';

import { cn } from '@/lib/utils';
import type { Project } from '@/data/projects';
import { useProjectsFilterStore } from '@/store/projects-filter-store';
import { ChevronDown, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { EmptyProjects } from './empty-projects';
import { GroupProjects, ProjectGroupDescriptor } from './group-projects';
import { ProjectDragLayer } from './project-grid';

export interface ProjectBoardEntry {
   group: ProjectGroupDescriptor;
   projects: Project[];
   total: number;
}

interface ProjectsBoardProps {
   entries: ProjectBoardEntry[];
   totalCount: number;
   filteredCount: number;
   showEmptyGroups: boolean;
   /** True when the workspace has no projects at all (not merely filtered out). */
   empty: boolean;
}

function HiddenByFiltersFooter({ hiddenCount }: { hiddenCount: number }) {
   const t = useTranslations('projects');
   const { clearFilters } = useProjectsFilterStore();

   return (
      <div className="flex items-center justify-center gap-3 py-4 text-muted-foreground">
         <span>{t('states.hiddenByFilters', { count: hiddenCount })}</span>
         <button
            type="button"
            onClick={clearFilters}
            className="flex items-center gap-1 hover:text-foreground transition-colors"
         >
            {t('states.clearFilters')}
            <X className="size-3" />
         </button>
      </div>
   );
}

function HiddenColumns({ entries }: { entries: ProjectBoardEntry[] }) {
   const [open, setOpen] = useState(true);

   return (
      <div className="w-[278px] shrink-0 pt-1">
         <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="flex items-center gap-1.5 px-2 py-1.5 font-medium text-muted-foreground hover:text-foreground transition-colors"
         >
            <ChevronDown className={cn('size-3.5 transition-transform', !open && '-rotate-90')} />
            Hidden columns
         </button>
         {open && (
            <div className="flex flex-col gap-1.5 mt-1">
               {entries.map((entry) => (
                  <div
                     key={entry.group.id}
                     className="flex items-center justify-between gap-2 rounded-lg border bg-container px-3 h-9"
                  >
                     <div className="flex items-center gap-2 min-w-0">
                        {entry.group.icon}
                        <span className="truncate">{entry.group.name}</span>
                     </div>
                     <span className="text-muted-foreground whitespace-nowrap">
                        {entry.total > 0 ? `0 / ${entry.total}` : '0'}
                     </span>
                  </div>
               ))}
            </div>
         )}
      </div>
   );
}

/** Projects board — same column/card UX as the issues Kanban. */
export default function ProjectsBoard({
   entries,
   totalCount,
   filteredCount,
   showEmptyGroups,
   empty,
}: ProjectsBoardProps) {
   const { hasActiveFilters } = useProjectsFilterStore();
   const activeFilters = hasActiveFilters();
   const hiddenCount = Math.max(0, totalCount - filteredCount);
   const showFooter = activeFilters && hiddenCount > 0;

   const boardEntries = activeFilters
      ? entries.filter((entry) => entry.projects.length > 0)
      : entries.filter((entry) => showEmptyGroups || entry.projects.length > 0);
   const hiddenEntries = activeFilters ? entries.filter((entry) => entry.projects.length === 0) : [];

   if (empty) {
      return <EmptyProjects />;
   }

   return (
      <DndProvider backend={HTML5Backend}>
         <ProjectDragLayer />
         <div className="h-full flex flex-col">
            <div className="flex-1 min-h-0 overflow-x-auto">
               <div className="flex h-full min-w-max gap-3 px-4 py-3">
                  {boardEntries.map((entry) => (
                     <GroupProjects
                        key={entry.group.id}
                        group={entry.group}
                        projects={entry.projects}
                        count={entry.projects.length}
                     />
                  ))}
                  {hiddenEntries.length > 0 && <HiddenColumns entries={hiddenEntries} />}
               </div>
            </div>
            {showFooter && (
               <div className="shrink-0 border-t bg-container">
                  <HiddenByFiltersFooter hiddenCount={hiddenCount} />
               </div>
            )}
         </div>
      </DndProvider>
   );
}
