'use client';

import { BerryMark } from '@/components/brand/berry-mark';
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
import { WORKSPACE_NAME, WORKSPACE_SLUG } from '@/lib/config';
import { describePlanFailure, generatePlan, listPlans } from '@/lib/plans';
import { usePlanStore } from '@/store/plan-store';
import { useSessionStore } from '@/store/session-store';
import { ChevronRight, Sparkles, X } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

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
      detail: 'It proposes the goals, tasks and approvals the project would take.',
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

/** Set once the AI Workflow explanation has been shown, so later hovers stay quiet. */
export const AI_WORKFLOW_HINT_KEY = 'berry.ai-workflow-hint';

function hintAlreadySeen(): boolean {
   try {
      return window.localStorage.getItem(AI_WORKFLOW_HINT_KEY) === '1';
   } catch {
      return true;
   }
}

function rememberHint(): void {
   try {
      window.localStorage.setItem(AI_WORKFLOW_HINT_KEY, '1');
   } catch {
      // A browser that will not store this shows the hint again next visit.
   }
}

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
   // Unknown until the browser is asked, so the server render and the first
   // client render agree. A store that cannot be read counts as already seen.
   const [hintSeen, setHintSeen] = useState(false);
   const [hintKnown, setHintKnown] = useState(false);
   const hintShown = useRef(false);

   useEffect(() => {
      setHintSeen(hintAlreadySeen());
      setHintKnown(true);
   }, []);

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
         <Tooltip
            open={hintKnown && hintSeen ? false : undefined}
            onOpenChange={(next) => {
               if (next) {
                  hintShown.current = true;
                  return;
               }
               if (!hintShown.current) return;
               rememberHint();
               setHintSeen(true);
               setHintKnown(true);
            }}
         >
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
            <DialogContent
               showCloseButton={false}
               className="flex max-h-[85vh] w-full flex-col gap-0 p-0 shadow-lg top-[22%] translate-y-0 sm:max-w-lg"
               onEscapeKeyDown={(event) => pending && event.preventDefault()}
            >
               <DialogHeader className="px-6 pt-5 pb-0">
                  <div className="flex items-center justify-between gap-3">
                     <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                        <BerryMark size="sm" />
                        <span className="font-medium text-foreground">{WORKSPACE_NAME}</span>
                        <ChevronRight className="size-3.5 shrink-0" />
                        <span className="truncate">AI workflow</span>
                     </div>
                     <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8 shrink-0"
                        aria-label="Close"
                        disabled={pending}
                        onClick={() => setOpen(false)}
                     >
                        <X className="size-4" />
                     </Button>
                  </div>
               </DialogHeader>

               <div
                  data-step-body="prose"
                  className="min-h-0 flex-1 overflow-y-auto px-6 pt-4 pb-4"
               >
                  <DialogTitle asChild>
                     <p className="font-medium text-foreground">Develop {project.name} with AI</p>
                  </DialogTitle>
                  <DialogDescription className="mt-1">
                     Berry plans the project in four steps. You stay in charge of the plan and of
                     every release.
                  </DialogDescription>
                  <ol className="mt-4">
                     {STEPS.map((step, index) => (
                        <li
                           key={step.title}
                           className="grid grid-cols-[2ch_minmax(0,1fr)] gap-x-3 border-t border-border/60 py-3 first:border-t-0 first:pt-0 last:pb-0"
                        >
                           <span className="tabular-nums text-muted-foreground">{index + 1}</span>
                           <div className="min-w-0">
                              <p className="font-medium text-foreground">{step.title}</p>
                              <p className="mt-0.5 text-muted-foreground">{step.detail}</p>
                           </div>
                        </li>
                     ))}
                  </ol>
               </div>

               <DialogFooter data-step-body="prose" className="border-t px-6 py-3 sm:justify-end">
                  <Button
                     type="button"
                     variant="ghost"
                     size="sm"
                     className="max-sm:min-h-11"
                     disabled={pending}
                     onClick={() => setOpen(false)}
                  >
                     Cancel
                  </Button>
                  <Button
                     type="button"
                     size="sm"
                     className="max-sm:min-h-11"
                     disabled={pending}
                     onClick={() => void start()}
                  >
                     <Sparkles className="size-4" />
                     {pending ? 'Starting…' : 'Start AI workflow'}
                  </Button>
               </DialogFooter>
            </DialogContent>
         </Dialog>
      </>
   );
}
