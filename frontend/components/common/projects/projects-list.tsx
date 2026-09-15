'use client';

import { useProjectsDisplayStore } from '@/store/projects-display-store';
import { cn } from '@/lib/utils';
import {
   PROJECT_ACTIONS_SLOT,
   PROJECT_CELL_PAD,
   PROJECT_COLUMN,
   PROJECT_SELECT_SLOT,
} from './project-columns';
import ProjectLine from './project-line';
import { ProjectGroup } from './projects';

interface ProjectsListProps {
   groups: ProjectGroup[];
   /** Ids currently selected; omitted when the surface offers no selection. */
   selected?: string[];
   onToggleSelected?: (projectId: string) => void;
}

/** Projects "List" view: grouped table (status sections by default). */
export default function ProjectsList({ groups, selected, onToggleSelected }: ProjectsListProps) {
   const { grouping, displayProperties } = useProjectsDisplayStore();

   return (
      <div className="w-full h-full overflow-y-auto">
         <div className="sticky top-0 z-10 flex items-center border-b bg-container px-6 py-1.5 text-muted-foreground">
            {onToggleSelected ? <span className={PROJECT_SELECT_SLOT} aria-hidden /> : null}
            <div className="min-w-0 flex-1">Name</div>
            {displayProperties.health && (
               <div className={cn(PROJECT_COLUMN.health, PROJECT_CELL_PAD)}>Health</div>
            )}
            {displayProperties.priority && (
               <div className={cn(PROJECT_COLUMN.priority, PROJECT_CELL_PAD)}>Priority</div>
            )}
            {displayProperties.lead && (
               <div className={cn(PROJECT_COLUMN.lead, PROJECT_CELL_PAD)}>Lead</div>
            )}
            {displayProperties.targetDate && (
               <div className={cn(PROJECT_COLUMN.targetDate, PROJECT_CELL_PAD)}>Target date</div>
            )}
            {displayProperties.issues && (
               <div className={cn(PROJECT_COLUMN.issues, PROJECT_CELL_PAD)}>Tasks</div>
            )}
            {displayProperties.status && (
               <div className={cn(PROJECT_COLUMN.status, PROJECT_CELL_PAD)}>Status</div>
            )}
            <span className={cn(PROJECT_ACTIONS_SLOT, 'h-px')} aria-hidden />
         </div>

         {groups.map((group) => (
            <div key={group.id}>
               {grouping !== 'none' && (
                  <div className="flex items-center gap-2 px-6 h-9 font-medium bg-[color-mix(in_oklab,var(--accent)_30%,var(--container))] border-b border-border/40 sticky top-8 z-[9]">
                     {group.icon && <span>{group.icon}</span>}
                     {group.name}
                     <span className="text-muted-foreground">{group.projects.length}</span>
                  </div>
               )}
               {group.projects.map((project) => (
                  <ProjectLine
                     key={project.id}
                     project={project}
                     selected={selected?.includes(project.id)}
                     onToggleSelected={
                        onToggleSelected ? () => onToggleSelected(project.id) : undefined
                     }
                  />
               ))}
               {group.projects.length === 0 && (
                  <div className="px-6 py-3 text-muted-foreground border-b border-border/40">
                     No projects
                  </div>
               )}
            </div>
         ))}
      </div>
   );
}
