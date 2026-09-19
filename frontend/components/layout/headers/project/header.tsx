'use client';

import {
   DeleteProjectDialog,
   useProjectDeletion,
} from '@/components/common/projects/delete-project';
import { PinToggle } from '@/components/common/issues/details/issue-pin-button';
import { useDetailDrawerClose } from '@/components/layout/detail-drawer-context';
import { Button } from '@/components/ui/button';
import { IssueFilterTrigger } from '@/components/common/issues/issue-filter-trigger';
import { DisplayOptions } from '@/components/layout/headers/display-options';
import { useProject } from '@/hooks/use-project';
import { WORKSPACE_SLUG } from '@/lib/config';
import { ChevronRight, Link as LinkIcon, Trash2 } from 'lucide-react';
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
               <PinToggle targetType="project" targetId={project.id} />
               <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label="Copy link"
                  title="Copy link"
                  onClick={() => {
                     void navigator.clipboard.writeText(
                        `${window.location.origin}/${orgId ?? WORKSPACE_SLUG}/project/${project.id}/overview`
                     );
                     toast.success('Link copied to clipboard');
                  }}
               >
                  <LinkIcon className="size-4" />
               </Button>
               <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  aria-label="Delete project"
                  onClick={() => deletion.request(project)}
               >
                  <Trash2 className="size-4" />
               </Button>
            </div>
         </div>
         <DeleteProjectDialog deletion={deletion} />
      </>
   );
}
