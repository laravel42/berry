'use client';

import { BoardColumn, BoardColumnBody, BoardColumnHeader, columnTone } from '../board-column';
import { Button } from '@/components/ui/button';
import type { Project } from '@/data/projects';
import type { Status } from '@/data/status';
import { useCreateProjectStore } from '@/store/create-project-store';
import { useProjectsStore } from '@/store/projects-store';
import { Plus } from 'lucide-react';
import { FC, ReactNode, useRef } from 'react';
import { useDrop } from 'react-dnd';
import { ProjectDragType, ProjectGrid } from './project-grid';

export interface ProjectGroupDescriptor {
   id: string;
   name: string;
   /**
    * No longer read here: the header tint comes from the status tone, and a
    * group without a status is neutral. Left optional so the builders that
    * still fill it keep compiling until they drop it.
    */
   color?: string;
   icon: ReactNode;
   /** Set when grouping by status — enables drag-drop and create-in-column. */
   status?: Status;
}

interface GroupProjectsProps {
   group: ProjectGroupDescriptor;
   projects: Project[];
   count: number;
}

function GroupHeaderBar({ group, count }: { group: ProjectGroupDescriptor; count: number }) {
   const { openModal } = useCreateProjectStore();

   return (
      <BoardColumnHeader
         tone={columnTone(group.status)}
         action={
            <Button
               className="size-5"
               size="icon"
               variant="ghost"
               aria-label={`Create project in ${group.name}`}
               onClick={(event) => {
                  event.stopPropagation();
                  openModal(group.status);
               }}
            >
               <Plus className="size-3.5" />
            </Button>
         }
      >
         {group.icon}
         <span className="font-medium">{group.name}</span>
         <span className="text-muted-foreground">{count}</span>
      </BoardColumnHeader>
   );
}

export function GroupProjects({ group, projects, count }: GroupProjectsProps) {
   return (
      <BoardColumn header={<GroupHeaderBar group={group} count={count} />}>
         <ProjectGridList projects={projects} status={group.status} />
      </BoardColumn>
   );
}

const ProjectGridList: FC<{ projects: Project[]; status?: Status }> = ({ projects, status }) => {
   const ref = useRef<HTMLDivElement>(null);
   const updateProjectStatus = useProjectsStore((state) => state.updateProjectStatus);

   const [{ isOverColumn, isOverEmpty }, drop] = useDrop(
      () => ({
         accept: ProjectDragType,
         canDrop: () => status !== undefined,
         drop(item: Project, monitor) {
            if (monitor.didDrop() || !status) return;
            if (item.status.id !== status.id) {
               updateProjectStatus(item.id, status);
            }
         },
         collect: (monitor) => ({
            isOverColumn: monitor.isOver() && monitor.canDrop(),
            isOverEmpty: monitor.isOver({ shallow: true }) && monitor.canDrop(),
         }),
      }),
      [status, updateProjectStatus]
   );
   drop(ref);

   return (
      <BoardColumnBody
         ref={ref}
         isOver={isOverColumn}
         isOverEmpty={isOverEmpty}
         isEmpty={projects.length === 0}
      >
         {projects.map((project) => (
            <ProjectGrid key={project.id} project={project} columnStatus={status} />
         ))}
      </BoardColumnBody>
   );
};
