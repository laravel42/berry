'use client';

import { BerryMark } from '@/components/brand/berry-mark';
import { DescriptionTextarea } from '@/components/common/editor/description-textarea';
import { ProjectSelector } from '@/components/layout/sidebar/create-new-issue/project-selector';
import { Button } from '@/components/ui/button';
import {
   Dialog,
   DialogContent,
   DialogDescription,
   DialogFooter,
   DialogHeader,
   DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { Project } from '@/data/projects';
import { WORKSPACE_NAME, WORKSPACE_SLUG } from '@/lib/config';
import { createWorkspaceGoal, describeGoalFailure } from '@/lib/goals';
import { useCreateGoalStore } from '@/store/create-goal-store';
import { useGoalsStore } from '@/store/goals-store';
import { useProjectsStore } from '@/store/projects-store';
import { useSessionStore } from '@/store/session-store';
import { ChevronRight, Plus, X } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

/**
 * Files a draft goal on a project. Planning still creates goals when a plan
 * starts; this is the path for an outcome that needs no plan yet.
 */
export function CreateGoalDialog() {
   const router = useRouter();
   const params = useParams<{ orgId?: string }>();
   const orgId = params?.orgId || WORKSPACE_SLUG;
   const workspace = useSessionStore((state) => state.workspace);
   const projects = useProjectsStore((state) => state.projects);
   const upsertGoal = useGoalsStore((state) => state.upsertGoal);
   const { isOpen, prefill, closeModal } = useCreateGoalStore();

   const [title, setTitle] = useState('');
   const [description, setDescription] = useState('');
   const [project, setProject] = useState<Project | undefined>();
   const [pending, setPending] = useState(false);
   const titleRef = useRef<HTMLInputElement>(null);

   useEffect(() => {
      if (!isOpen) return;
      setTitle('');
      setDescription('');
      setProject(
         prefill.projectId
            ? projects.find((candidate) => candidate.id === prefill.projectId)
            : undefined
      );
      setPending(false);
      // `projects` is read once when the dialog opens; a later hydration
      // must not reset what the person typed.
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [isOpen, prefill]);

   const submit = async () => {
      const trimmed = title.trim();
      if (!trimmed) {
         toast.error('A goal needs a title.');
         return;
      }
      if (!project) {
         toast.error('A goal belongs to a project.');
         return;
      }
      if (!workspace) {
         toast.error('Workspace is not ready');
         return;
      }
      setPending(true);
      try {
         const goal = await createWorkspaceGoal({
            workspaceId: workspace.id,
            title: trimmed,
            description: description.trim() || undefined,
            projectId: project.id,
         });
         upsertGoal(goal);
         closeModal();
         if (!prefill.lockProject) {
            router.push(`/${orgId}/goals?goal=${goal.id}`);
         }
      } catch (error) {
         toast.error(describeGoalFailure(error));
      } finally {
         setPending(false);
      }
   };

   const canSubmit = Boolean(title.trim() && project && !pending);

   return (
      <Dialog open={isOpen} onOpenChange={(open) => !open && closeModal()}>
         <DialogContent
            showCloseButton={false}
            className="flex w-full flex-col gap-0 p-0 shadow-lg top-[22%] translate-y-0 sm:max-w-[52rem]"
            onOpenAutoFocus={(event) => {
               event.preventDefault();
               titleRef.current?.focus();
            }}
         >
            <DialogHeader className="px-6 pt-5 pb-0">
               <DialogTitle className="sr-only">New goal</DialogTitle>
               <DialogDescription className="sr-only">
                  Name an outcome for a project. The goal starts as a draft; tasks can join it
                  later, or a plan can fill it.
               </DialogDescription>
               <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                     <BerryMark size="sm" />
                     <span className="font-medium text-foreground">{WORKSPACE_NAME}</span>
                     {prefill.lockProject && project ? (
                        <>
                           <ChevronRight className="size-3.5 shrink-0" />
                           <span className="truncate">{project.name}</span>
                        </>
                     ) : null}
                     <ChevronRight className="size-3.5 shrink-0" />
                     <span className="truncate">New goal</span>
                  </div>
                  <Button
                     type="button"
                     variant="ghost"
                     size="icon"
                     className="size-8 shrink-0"
                     aria-label="Close"
                     onClick={closeModal}
                  >
                     <X className="size-4" />
                  </Button>
               </div>
            </DialogHeader>

            <form
               className="flex min-h-0 flex-1 flex-col"
               onSubmit={(event) => {
                  event.preventDefault();
                  void submit();
               }}
               onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                     event.preventDefault();
                     void submit();
                  }
               }}
            >
               <div className="space-y-1 px-6 pt-4 pb-4">
                  <Input
                     ref={titleRef}
                     data-heading="h2"
                     plain
                     aria-label="Goal title"
                     placeholder="What should this project achieve?"
                     value={title}
                     onChange={(event) => setTitle(event.target.value)}
                     className="h-auto border-none bg-transparent px-0 font-medium text-foreground shadow-none placeholder:text-placeholder"
                  />
                  <DescriptionTextarea
                     aria-label="Goal description"
                     placeholder="Add a description…"
                     value={description}
                     onChange={setDescription}
                     className="min-h-20 placeholder:text-placeholder"
                  />
                  {prefill.lockProject ? null : (
                     <div className="flex flex-wrap items-center gap-1.5 pt-3">
                        <ProjectSelector project={project} onChange={setProject} />
                     </div>
                  )}
               </div>

               <DialogFooter className="flex-row items-center justify-between gap-2 border-t px-6 py-3">
                  <span className="text-muted-foreground">⌘↵ to create</span>
                  <div className="flex items-center gap-2">
                     <Button type="button" variant="ghost" size="sm" onClick={closeModal}>
                        Cancel
                     </Button>
                     <Button type="submit" size="sm" disabled={!canSubmit}>
                        <Plus className="size-4" />
                        {pending ? 'Creating…' : 'Create goal'}
                     </Button>
                  </div>
               </DialogFooter>
            </form>
         </DialogContent>
      </Dialog>
   );
}
