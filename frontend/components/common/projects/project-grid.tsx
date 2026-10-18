'use client';

import { CapacityRing } from '@/components/common/cycles/capacity-ring';
import { ActorAvatar } from '@/components/common/issues/actor-avatar';
import { HealthPopover } from '@/components/common/projects/health-popover';
import { LeadPicker, leadCandidates } from '@/components/common/projects/lead-picker';
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu';
import {
   openContextMenuOnClick,
   ProjectContextMenuContent,
} from '@/components/common/projects/project-context-menu';
import type { Project } from '@/data/projects';
import { useResolvedProjectLead } from '@/lib/use-resolved-project-lead';
import { cn } from '@/lib/utils';
import { useMembersStore } from '@/store/members-store';
import { useProjectsDisplayStore } from '@/store/projects-display-store';
import { useProjectsStore } from '@/store/projects-store';
import type { Status } from '@/data/status';
import { User as UserIcon } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { DragSourceMonitor, useDrag, useDragLayer, useDrop } from 'react-dnd';
import { getEmptyImage } from 'react-dnd-html5-backend';

export const ProjectDragType = 'PROJECT';

type ProjectGridProps = {
   project: Project;
   columnStatus?: Status;
};

function ProjectDragPreview({ project }: { project: Project }) {
   const lead = useResolvedProjectLead(project.lead);
   return (
      <div className="flex w-full flex-col overflow-hidden rounded-lg border border-[var(--board-card-line)] bg-void px-3.5 py-2 text-chalk shadow-lg">
         <div className="mb-1.5 flex min-w-0 items-center gap-1.5">
            <project.priority.icon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="ml-auto shrink-0 whitespace-nowrap text-muted-foreground">
               {project.health.name}
            </span>
         </div>
         <div className="mb-2 line-clamp-2 min-h-[2lh]" role="heading" aria-level={4}>
            {project.name}
         </div>
         <div className="flex min-h-[1.25rem] items-center gap-2">
            <span className="inline-flex items-center gap-1 text-muted-foreground">
               <CapacityRing value={project.percentComplete} size={14} />
               {project.percentComplete}%
            </span>
            {lead ? (
               <span className="ml-auto flex min-w-0 items-center gap-1.5">
                  <ActorAvatar user={lead} size="sm" className="size-4" />
                  <span className="truncate">{lead.name}</span>
               </span>
            ) : (
               <UserIcon className="ml-auto size-3.5 text-muted-foreground" />
            )}
         </div>
      </div>
   );
}

export function ProjectDragLayer() {
   const { itemType, isDragging, item, currentOffset } = useDragLayer((monitor) => ({
      item: monitor.getItem() as Project,
      itemType: monitor.getItemType(),
      currentOffset: monitor.getSourceClientOffset(),
      isDragging: monitor.isDragging(),
   }));

   if (!isDragging || itemType !== ProjectDragType || !currentOffset) {
      return null;
   }

   return (
      <div
         className="fixed pointer-events-none z-50 left-0 top-0"
         style={{
            transform: `translate(${currentOffset.x}px, ${currentOffset.y}px)`,
            width: '266px',
         }}
      >
         <ProjectDragPreview project={item} />
      </div>
   );
}

export function ProjectGrid({ project, columnStatus }: ProjectGridProps) {
   const cardRef = useRef<HTMLDivElement>(null);
   const { orgId } = useParams<{ orgId: string }>();
   const { displayProperties } = useProjectsDisplayStore();
   const updateProjectStatus = useProjectsStore((state) => state.updateProjectStatus);
   const updateProjectLead = useProjectsStore((state) => state.updateProjectLead);
   const members = useMembersStore((state) => state.members);
   const lead = useResolvedProjectLead(project.lead);
   const [dropEdge, setDropEdge] = useState<'top' | 'bottom' | null>(null);

   const [{ isDragging }, drag, preview] = useDrag(
      () => ({
         type: ProjectDragType,
         item: () => project,
         canDrag: () => columnStatus !== undefined,
         collect: (monitor: DragSourceMonitor) => ({
            isDragging: monitor.isDragging(),
         }),
      }),
      [project, columnStatus]
   );

   useEffect(() => {
      preview(getEmptyImage(), { captureDraggingState: true });
   }, [preview]);

   const [{ isOver }, drop] = useDrop(
      () => ({
         accept: ProjectDragType,
         canDrop: (item: Project) => item.id !== project.id && columnStatus !== undefined,
         hover(_draggedItem: Project, monitor) {
            if (!cardRef.current) return;
            const rect = cardRef.current.getBoundingClientRect();
            const offset = monitor.getClientOffset();
            if (!offset) return;
            const middleY = (rect.bottom - rect.top) / 2;
            const clientY = offset.y - rect.top;
            setDropEdge(clientY > middleY ? 'bottom' : 'top');
         },
         drop(draggedItem: Project, monitor) {
            if (monitor.didDrop() || !columnStatus) return;
            if (draggedItem.status.id !== columnStatus.id) {
               updateProjectStatus(draggedItem.id, columnStatus);
            }
            setDropEdge(null);
         },
         collect: (monitor) => ({
            isOver: monitor.isOver() && monitor.canDrop(),
         }),
      }),
      [project.id, columnStatus, updateProjectStatus]
   );

   drag(drop(cardRef));

   useEffect(() => {
      if (!isOver) setDropEdge(null);
   }, [isOver]);

   return (
      <div ref={cardRef} className="relative">
         {isOver && dropEdge === 'top' ? (
            <div className="pointer-events-none absolute inset-x-1 top-0 z-20 h-0.5 -translate-y-1/2 rounded-full bg-primary" />
         ) : null}
         {isOver && dropEdge === 'bottom' ? (
            <div className="pointer-events-none absolute inset-x-1 bottom-0 z-20 h-0.5 translate-y-1/2 rounded-full bg-primary" />
         ) : null}
         <ContextMenu>
            <ContextMenuTrigger asChild>
               <div
                  className={cn(
                     'group relative flex w-full cursor-grab flex-col rounded-lg bg-void px-3.5 py-2 text-chalk transition-colors active:cursor-grabbing',
                     'border border-[var(--board-card-line)] shadow-sm',
                     'hover:bg-base',
                     columnStatus === undefined && 'cursor-default',
                     isOver && 'ring-1 ring-primary/40',
                     isOver && dropEdge === 'top' && 'mt-1',
                     isOver && dropEdge === 'bottom' && 'mb-1'
                  )}
                  style={{ opacity: isDragging ? 0.45 : 1 }}
                  onClick={openContextMenuOnClick}
               >
                  <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                     <div className="mb-1.5 flex min-w-0 items-center gap-1.5">
                        {displayProperties.priority ? (
                           <project.priority.icon className="size-3.5 shrink-0 text-muted-foreground" />
                        ) : null}
                        {displayProperties.health ? (
                           <span
                              className="relative z-[1] ml-auto shrink-0 whitespace-nowrap"
                              onPointerDown={(event) => event.stopPropagation()}
                              onClick={(event) => event.stopPropagation()}
                           >
                              <HealthPopover project={project} compact />
                           </span>
                        ) : null}
                     </div>
                     <Link
                        href={`/${orgId}/project/${project.id}/overview`}
                        className="relative z-10 block rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        draggable={false}
                        onClick={(event) => {
                           if (isDragging) event.preventDefault();
                        }}
                     >
                        {/* Body size, same as a task card title. An h3 would
                            take the heading step and the name would read
                            larger than the task titles. Two lines are reserved
                            so a short name still fills the same card. */}
                        <div
                           className="mb-2 line-clamp-2 min-h-[2lh]"
                           role="heading"
                           aria-level={4}
                        >
                           {project.name}
                        </div>
                     </Link>
                     <div className="relative z-[1] flex min-h-[1.25rem] flex-wrap items-center gap-2">
                        {displayProperties.issues ? (
                           <span className="inline-flex items-center gap-1 text-muted-foreground">
                              <CapacityRing value={project.percentComplete} size={14} />
                              {project.percentComplete}%
                           </span>
                        ) : null}
                        {displayProperties.lead ? (
                           <span
                              className="relative z-10 ml-auto min-w-0"
                              onPointerDown={(event) => event.stopPropagation()}
                              onClick={(event) => event.stopPropagation()}
                           >
                              <LeadPicker
                                 lead={lead}
                                 candidates={leadCandidates(members, lead)}
                                 onChange={(member) => updateProjectLead(project.id, member)}
                              >
                                 {lead ? (
                                    <button
                                       type="button"
                                       aria-label={`Lead: ${lead.name}`}
                                       className="flex min-w-0 items-center gap-1.5 rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                                    >
                                       <ActorAvatar user={lead} size="sm" className="size-4" />
                                       <span className="truncate">{lead.name}</span>
                                    </button>
                                 ) : (
                                    <button
                                       type="button"
                                       aria-label="Project lead"
                                       className="flex items-center gap-1.5 text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                                    >
                                       <UserIcon className="size-3.5" />
                                    </button>
                                 )}
                              </LeadPicker>
                           </span>
                        ) : null}
                     </div>
                  </div>
               </div>
            </ContextMenuTrigger>
            <ProjectContextMenuContent project={project} />
         </ContextMenu>
      </div>
   );
}
