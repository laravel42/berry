'use client';

import { Button } from '@/components/ui/button';
import {
   Dialog,
   DialogContent,
   DialogDescription,
   DialogFooter,
   DialogHeader,
   DialogTitle,
} from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Project } from '@/data/projects';
import { BerryApiError } from '@/lib/api';
import { WORKSPACE_SLUG } from '@/lib/config';
import { describePlanFailure, generatePlan, listPlans } from '@/lib/plans';
import { usePlanStore } from '@/store/plan-store';
import { useSessionStore } from '@/store/session-store';
import { Sparkles } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

/**
 * "AI Workflow" on a project's header: Berry plans the project.
 *
 * The workflow used to be started by choosing the AI workflow as the lead when
 * the project was created. This restores it for a project that already exists,
 * without touching the lead: the button asks the planner for the project and
 * goes to the plan, where the stages show and a person presses Start Plan.
 * Nothing runs until they do; approval is a step, not a formality.
 */

const STEPS: { title: string; detail: string }[] = [
   {
      title: 'Project analysis',
      detail: 'Berry reads the name, the brief and the repository to work out the intent.',
   },
   {
      title: 'Plan generation',
      detail: 'It proposes the milestones, tasks and approvals the project would take.',
   },
   {
      title: 'Plan approval',
      detail: 'You review the plan. Nothing starts until you press Start Plan.',
   },
   {
      title: 'Goals and tasks',
      detail: 'The approved plan becomes goals and tasks, routed to the agents that fit.',
   },
];

/** What Berry is asked to plan: everything the project says about itself. */
function planPrompt(project: Project): string {
   return [project.name.trim(), project.description?.trim() ?? ''].filter(Boolean).join('\n\n');
}

export function AiWorkflowButton({ project }: { project: Project }) {
   const { orgId } = useParams<{ orgId: string }>();
   const router = useRouter();
   const workspace = useSessionStore((state) => state.workspace);
   const boardId = useSessionStore((state) => state.boardId);
   const upsertRecord = usePlanStore((state) => state.upsertRecord);
   const [open, setOpen] = useState(false);
   const [pending, setPending] = useState(false);

   const planPath = (planId: string) => `/${orgId ?? WORKSPACE_SLUG}/plan/${planId}`;

   const start = async () => {
      if (!workspace) {
         toast.error('Workspace is not ready');
         return;
      }
      setPending(true);
      try {
         // One open plan per project: a second press goes to the plan that is
         // already there rather than asking for a rival.
         const existing = (await listPlans(workspace.id, 'open').catch(() => [])).find(
            (plan) => plan.projectId === project.id
         );
         if (existing) {
            setOpen(false);
            router.push(planPath(existing.id));
            return;
         }
         const record = await generatePlan({
            workspaceId: workspace.id,
            prompt: planPrompt(project),
            projectId: project.id,
            boardId: boardId ?? undefined,
         });
         upsertRecord(record);
         setOpen(false);
         router.push(planPath(record.id));
      } catch (error) {
         // The server found the open plan this tab's list did not: go there.
         if (error instanceof BerryApiError && error.code === 'PLAN_OPEN_EXISTS') {
            const planId = (error.details as { planId?: string } | null)?.planId;
            if (planId) {
               setOpen(false);
               router.push(planPath(planId));
               return;
            }
         }
         toast.error(describePlanFailure(error));
      } finally {
         setPending(false);
      }
   };

   return (
      <>
         <Tooltip>
            <TooltipTrigger asChild>
               {/* The gradient is a wrapper's padding, so the button keeps its
                   own background and the ring reads as a border that moves. */}
               <span className="ai-animated-border rounded-md">
                  <Button
                     type="button"
                     variant="ghost"
                     size="xs"
                     className="bg-background hover:bg-accent"
                     onClick={() => setOpen(true)}
                  >
                     <Sparkles className="size-3.5" />
                     AI Workflow
                  </Button>
               </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-64 text-center">
               This project will be developed with AI assistance: Berry analyses it, proposes a plan
               for you to approve, and turns it into goals and tasks.
            </TooltipContent>
         </Tooltip>

         <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
            <DialogContent className="sm:max-w-md">
               <DialogHeader>
                  <DialogTitle>Develop {project.name} with AI</DialogTitle>
                  <DialogDescription>
                     Berry plans the project in four steps. You stay in charge of the plan and of
                     every release.
                  </DialogDescription>
               </DialogHeader>
               <ol className="flex flex-col gap-3">
                  {STEPS.map((step, index) => (
                     <li key={step.title} className="flex gap-3">
                        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted font-medium text-muted-foreground">
                           {index + 1}
                        </span>
                        <div className="flex flex-col gap-0.5">
                           <span className="font-medium text-foreground">{step.title}</span>
                           <span className="text-muted-foreground">{step.detail}</span>
                        </div>
                     </li>
                  ))}
               </ol>
               <DialogFooter>
                  <Button
                     type="button"
                     variant="ghost"
                     size="sm"
                     disabled={pending}
                     onClick={() => setOpen(false)}
                  >
                     Cancel
                  </Button>
                  <Button type="button" size="sm" disabled={pending} onClick={() => void start()}>
                     <Sparkles className="size-3.5" />
                     {pending ? 'Starting…' : 'Start AI workflow'}
                  </Button>
               </DialogFooter>
            </DialogContent>
         </Dialog>
      </>
   );
}
