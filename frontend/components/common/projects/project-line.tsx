'use client';

import { ActorAvatar } from '@/components/common/issues/actor-avatar';
import { PriorityPicker } from '@/components/common/pickers/priority-picker';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu';
import { Issue } from '@/data/issues';
import { Project } from '@/data/projects';
import { WORKSPACE_SLUG } from '@/lib/config';
import { cn } from '@/lib/utils';
import { useIssuesStore } from '@/store/issues-store';
import { useProjectsDisplayStore } from '@/store/projects-display-store';
import { useProjectsStore } from '@/store/projects-store';
import { useMembersStore } from '@/store/members-store';
import { User as UserIcon } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo } from 'react';
import { format } from 'date-fns';
import { projectCreateStatusOptions } from './create-project/project-status-options';
import {
   PROJECT_CELL_PAD,
   PROJECT_COLUMN,
   PROJECT_NAME_SLOT,
   PROJECT_SELECT_SLOT,
} from './project-columns';
import { HealthPopover } from './health-popover';
import { LeadPicker, leadCandidates } from './lead-picker';
import { StatusWithPercent } from './status-with-percent';
import { DatePicker } from './date-picker';
import { ProjectContextMenuContent } from './project-context-menu';

interface ProjectLineProps {
   project: Project;
   /** Set when the list offers selection; undefined leaves the row without a box. */
   selected?: boolean;
   onToggleSelected?: () => void;
}

const countIssues = (issues: Issue[], projectId: string) =>
   issues.filter((issue) => issue.project?.id === projectId).length;

/**
 * Controls sit above the link that covers the row, so a click on a picker
 * changes that field rather than opening the project. `z-[1]` clears the
 * link overlay; `z-10` would also paint over the sticky list header.
 */
const CONTROL = 'relative z-[1]';

export default function ProjectLine({ project, selected, onToggleSelected }: ProjectLineProps) {
   const { orgId } = useParams<{ orgId: string }>();
   const { issues } = useIssuesStore();
   const members = useMembersStore((state) => state.members);
   const {
      updateProjectStatus,
      updateProjectPriority,
      updateProjectTargetDate,
      updateProjectLead,
   } = useProjectsStore();
   const { displayProperties } = useProjectsDisplayStore();
   const issueCount = useMemo(() => countIssues(issues, project.id), [issues, project.id]);

   const href = `/${orgId ?? WORKSPACE_SLUG}/project/${project.id}/overview`;

   return (
      <ContextMenu>
         <ContextMenuTrigger asChild>
            <div
               className={cn(
                  'group relative flex w-full items-center border-b border-border/45 px-6 py-3 transition-colors',
                  'hover:bg-accent/45 focus-within:bg-accent/45'
               )}
            >
               {onToggleSelected ? (
                  <span
                     className={cn(PROJECT_SELECT_SLOT, CONTROL)}
                     onClick={(event) => event.stopPropagation()}
                     role="presentation"
                  >
                     <Checkbox
                        checked={selected}
                        onCheckedChange={onToggleSelected}
                        aria-label={`Select ${project.name}`}
                     />
                  </span>
               ) : null}

               <div className={cn(PROJECT_NAME_SLOT, 'flex items-center gap-2')}>
                  {displayProperties.priority ? (
                     <span className={cn('shrink-0', CONTROL)}>
                        <PriorityPicker
                           variant="icon"
                           priority={project.priority}
                           onChange={(next) => updateProjectPriority(project.id, next)}
                        />
                     </span>
                  ) : null}
                  {/* The link covers the whole row through its pseudo-element:
                      the name and empty space are one target. Controls above
                      are lifted over it. */}
                  <Link
                     href={href}
                     className="min-w-0 flex-1 truncate font-medium outline-none transition-colors before:absolute before:inset-0 before:rounded-sm group-hover:text-foreground focus-visible:before:ring-[3px] focus-visible:before:ring-ring/50"
                  >
                     {project.name}
                  </Link>
               </div>

               <div className="ml-auto flex min-w-0 items-center">
                  {displayProperties.health && (
                     <div className={cn(PROJECT_COLUMN.health, CONTROL)}>
                        <HealthPopover project={project} />
                     </div>
                  )}
                  {displayProperties.lead && (
                     <div className={cn(PROJECT_COLUMN.lead, CONTROL, 'min-w-0 overflow-hidden')}>
                        <LeadPicker
                           lead={project.lead}
                           candidates={leadCandidates(members, project.lead)}
                           onChange={(member) => updateProjectLead(project.id, member)}
                        >
                           <Button
                              className="flex h-7 w-full min-w-0 items-center justify-start gap-1 px-2 has-[>svg]:px-2"
                              size="sm"
                              variant="ghost"
                              role="combobox"
                              aria-label={
                                 project.lead ? `Lead: ${project.lead.name}` : 'Project lead'
                              }
                           >
                              {project.lead ? (
                                 <>
                                    <ActorAvatar user={project.lead} size="sm" className="mr-1" />
                                    <span className="hidden min-w-0 truncate md:inline">
                                       {project.lead.name}
                                    </span>
                                 </>
                              ) : (
                                 <>
                                    <UserIcon className="size-3.5 text-muted-foreground" />
                                    <span className="hidden min-w-0 truncate text-muted-foreground md:inline">
                                       Project lead
                                    </span>
                                 </>
                              )}
                           </Button>
                        </LeadPicker>
                     </div>
                  )}
                  {displayProperties.targetDate && (
                     <div
                        className={cn(
                           PROJECT_COLUMN.targetDate,
                           CONTROL,
                           'min-w-0 overflow-hidden'
                        )}
                     >
                        <DatePicker
                           date={project.targetDate ? new Date(project.targetDate) : undefined}
                           onDateChange={(date) => {
                              updateProjectTargetDate(
                                 project.id,
                                 date ? format(date, 'yyyy-MM-dd') : undefined
                              );
                           }}
                        />
                     </div>
                  )}
                  {displayProperties.issues && (
                     <div
                        className={cn(
                           PROJECT_COLUMN.issues,
                           PROJECT_CELL_PAD,
                           'tabular-nums text-muted-foreground'
                        )}
                     >
                        {issueCount}
                     </div>
                  )}
                  {displayProperties.status && (
                     <div className={cn(PROJECT_COLUMN.status, CONTROL)}>
                        <StatusWithPercent
                           status={project.status}
                           percentComplete={project.percentComplete}
                           onStatusChange={(statusId) => {
                              const match = projectCreateStatusOptions.find(
                                 (option) => option.status.id === statusId
                              );
                              if (match) updateProjectStatus(project.id, match.status);
                           }}
                        />
                     </div>
                  )}
               </div>
            </div>
         </ContextMenuTrigger>
         <ProjectContextMenuContent project={project} />
      </ContextMenu>
   );
}
