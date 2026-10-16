'use client';

import { GoalStatusBadge } from '@/components/common/goals/goal-status-badge';
import { GoalProgress } from '@/components/common/goals/goal-progress';
import {
   AlertDialog,
   AlertDialogAction,
   AlertDialogCancel,
   AlertDialogContent,
   AlertDialogDescription,
   AlertDialogFooter,
   AlertDialogHeader,
   AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button, buttonVariants } from '@/components/ui/button';
import { archiveGoal, describeGoalFailure, type Goal } from '@/lib/goals';
import { canEditProduct, canEditSettings } from '@/lib/workspace-role';
import { useCreateGoalStore } from '@/store/create-goal-store';
import { useGoalsStore } from '@/store/goals-store';
import { useSessionStore } from '@/store/session-store';
import { Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { DetailSectionLabel } from './detail-section-label';

/**
 * The goals this project carries, above its updates. Always drawn so a project
 * with none still offers New goal — unlike plans, which hide when empty.
 */
export function ProjectGoalsSection({ projectId }: { projectId: string }) {
   const { orgId } = useParams<{ orgId: string }>();
   const role = useSessionStore((state) => state.workspace?.role);
   const goals = useGoalsStore((state) => state.goals);
   const removeGoal = useGoalsStore((state) => state.removeGoal);
   const canEdit = canEditProduct(role);
   const canRemove = canEditSettings(role);
   const openModal = useCreateGoalStore((state) => state.openModal);
   const [toRemove, setToRemove] = useState<Goal | null>(null);
   const [confirmOpen, setConfirmOpen] = useState(false);
   const [busy, setBusy] = useState(false);

   const listed = useMemo(
      () => goals.filter((goal) => goal.projectId === projectId),
      [goals, projectId]
   );

   const confirmRemove = () => {
      if (!toRemove) return;
      setBusy(true);
      void archiveGoal(toRemove.id)
         .then(() => {
            removeGoal(toRemove.id);
            toast.success('Goal archived');
            setConfirmOpen(false);
         })
         .catch((error: unknown) => toast.error(describeGoalFailure(error)))
         .finally(() => setBusy(false));
   };

   return (
      <div className="border-t border-border/60 pt-4">
         <div className="mb-1 flex items-center justify-between gap-2">
            <DetailSectionLabel className="mb-0 pb-[7px]">Goals</DetailSectionLabel>
            {canEdit ? (
               <Button
                  type="button"
                  variant="ghost"
                  size="xxs"
                  className="-mt-1 text-muted-foreground hover:bg-card hover:text-foreground"
                  onClick={() => openModal({ projectId, lockProject: true })}
               >
                  <Plus className="size-3.5" />
                  New goal
               </Button>
            ) : null}
         </div>
         {listed.length === 0 ? (
            <p className="text-muted-foreground">No goals in this project yet.</p>
         ) : (
            <div className="flex flex-col gap-1.5">
               {listed.map((goal) => (
                  <div
                     key={goal.id}
                     className="flex items-center rounded-sm border border-border/60 bg-card p-1 hover:bg-sidebar/50"
                  >
                     <Link
                        href={`/${orgId}/goal/${goal.id}`}
                        className="flex min-w-0 flex-1 items-center gap-2 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                     >
                        <GoalStatusBadge status={goal.status} />
                        <span className="min-w-0 truncate">{goal.title}</span>
                        <GoalProgress
                           progress={goal.progress}
                           compact
                           className="ml-auto shrink-0"
                        />
                     </Link>
                     {canRemove ? (
                        <Button
                           type="button"
                           variant="ghost"
                           size="icon"
                           className="size-6 shrink-0 text-muted-foreground hover:text-destructive"
                           aria-label={`Remove ${goal.title}`}
                           disabled={busy}
                           onClick={() => {
                              setToRemove(goal);
                              setConfirmOpen(true);
                           }}
                        >
                           <Trash2 className="size-3.5" />
                        </Button>
                     ) : null}
                  </div>
               ))}
            </div>
         )}
         <AlertDialog
            open={confirmOpen}
            onOpenChange={(open) => {
               if (busy) return;
               setConfirmOpen(open);
            }}
         >
            <AlertDialogContent>
               <AlertDialogHeader>
                  <AlertDialogTitle>Remove “{toRemove?.title ?? 'this goal'}”?</AlertDialogTitle>
                  <AlertDialogDescription>
                     The goal leaves the list. Its tasks keep their links and stay on the board.
                  </AlertDialogDescription>
               </AlertDialogHeader>
               <AlertDialogFooter>
                  <AlertDialogCancel disabled={busy}>Keep</AlertDialogCancel>
                  <AlertDialogAction
                     className={buttonVariants({ variant: 'destructive' })}
                     disabled={busy}
                     onClick={confirmRemove}
                  >
                     Remove
                  </AlertDialogAction>
               </AlertDialogFooter>
            </AlertDialogContent>
         </AlertDialog>
      </div>
   );
}
