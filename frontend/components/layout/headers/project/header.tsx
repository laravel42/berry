'use client';

import { AiWorkflowButton } from '@/components/common/projects/details/ai-workflow-button';
import {
   DeleteProjectDialog,
   useProjectDeletion,
} from '@/components/common/projects/delete-project';
import { useDetailDrawerClose } from '@/components/layout/detail-drawer-context';
import { Button } from '@/components/ui/button';
import {
   DropdownMenu,
   DropdownMenuContent,
   DropdownMenuItem,
   DropdownMenuSeparator,
   DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { IssueFilterTrigger } from '@/components/common/issues/issue-filter-trigger';
import { DisplayOptions } from '@/components/layout/headers/display-options';
import { useProject } from '@/hooks/use-project';
import { WORKSPACE_SLUG } from '@/lib/config';
import { pinTarget, unpinTarget } from '@/lib/pins';
import { usePinsStore } from '@/store/pins-store';
import { useSessionStore } from '@/store/session-store';
import { ChevronRight, Link as LinkIcon, MoreHorizontal, Pin, PinOff, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { toast } from 'sonner';

export default function Header({
   projectId,
   listControls = false,
}: {
   projectId: string;
   /** The task tab wants the filter and display controls; the overview does not. */
   listControls?: boolean;
}) {
   const { orgId } = useParams<{ orgId: string }>();
   const router = useRouter();
   const closeDrawer = useDetailDrawerClose();
   const project = useProject(projectId);
   const workspaceId = useSessionStore((state) => state.workspace?.id ?? '');
   const { pins, add, remove } = usePinsStore();

   const afterDelete = useCallback(() => {
      if (closeDrawer) {
         closeDrawer();
         return;
      }
      router.push(`/${orgId ?? WORKSPACE_SLUG}/projects`);
   }, [closeDrawer, router, orgId]);

   const deletion = useProjectDeletion(afterDelete);

   if (!project) {
      return (
         <div className="flex h-10 w-full items-center border-b px-6 py-1.5 text-muted-foreground">
            Loading project…
         </div>
      );
   }

   const pin = pins.find(
      (entry) => entry.targetType === 'project' && entry.targetId === project.id
   );

   const togglePin = () => {
      const write = pin
         ? unpinTarget(workspaceId, pin.id).then(() => remove(pin.id))
         : pinTarget(workspaceId, 'project', project.id).then(add);
      void write.catch(() => toast.error('The pin could not be changed.'));
   };

   const copyLink = () => {
      void navigator.clipboard.writeText(
         `${window.location.origin}/${orgId ?? WORKSPACE_SLUG}/project/${project.id}/overview`
      );
      toast.success('Link copied to clipboard');
   };

   return (
      <>
         <div className="flex h-10 w-full items-center justify-between border-b px-6 py-1.5">
            <div className="flex min-w-0 items-center gap-1.5">
               <Link
                  href={`/${orgId}/projects`}
                  className="text-muted-foreground transition-colors hover:text-foreground"
               >
                  Projects
               </Link>
               <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
               <span className="inline-flex size-5 shrink-0 items-center justify-center rounded bg-muted/50">
                  <project.icon className="size-3.5" />
               </span>
               <span className="truncate font-medium">{project.name}</span>
            </div>
            <div className="flex shrink-0 items-center gap-1">
               {listControls ? (
                  <>
                     <IssueFilterTrigger />
                     <DisplayOptions />
                  </>
               ) : null}
               <AiWorkflowButton project={project} />
               <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                     <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-muted-foreground"
                        aria-label="Project actions"
                     >
                        <MoreHorizontal className="size-4" />
                     </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                     <DropdownMenuItem onClick={togglePin}>
                        {pin ? <PinOff className="size-4" /> : <Pin className="size-4" />}
                        {pin ? 'Unpin' : 'Pin'}
                     </DropdownMenuItem>
                     <DropdownMenuItem onClick={copyLink}>
                        <LinkIcon className="size-4" />
                        Copy link
                     </DropdownMenuItem>
                     <DropdownMenuSeparator />
                     <DropdownMenuItem
                        variant="destructive"
                        className="text-destructive focus:text-destructive data-[variant=destructive]:text-destructive data-[variant=destructive]:*:[svg]:!text-destructive"
                        onClick={() => deletion.request(project)}
                     >
                        <Trash2 className="size-4" />
                        Delete
                     </DropdownMenuItem>
                  </DropdownMenuContent>
               </DropdownMenu>
            </div>
         </div>
         <DeleteProjectDialog deletion={deletion} />
      </>
   );
}
