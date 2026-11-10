'use client';

import { IssueLine } from '@/components/common/issues/issue-line';
import { Button } from '@/components/ui/button';
import { Issue } from '@/data/issues';
import { displayOrderedStatus } from '@/data/status';
import { BerryApiError } from '@/lib/api';
import { loadBoardIssues } from '@/lib/issues';
import { generateProjectTasks } from '@/lib/projects';
import { renderStatusIcon } from '@/lib/status-utils';
import { canEditProduct } from '@/lib/workspace-role';
import { useIssuesStore } from '@/store/issues-store';
import { useMilestonesStore } from '@/store/milestones-store';
import { useSessionStore } from '@/store/session-store';
import { Lightbulb } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { DetailSectionLabel } from './detail-section-label';

/** Compact project task list for the unified project detail view. */
export function ProjectTasksSection({ projectId, issues }: { projectId: string; issues: Issue[] }) {
   const role = useSessionStore((state) => state.workspace?.role);
   const boardId = useSessionStore((state) => state.boardId);
   const hydrateIssues = useIssuesStore((state) => state.hydrateIssues);
   const milestones = useMilestonesStore((state) => state.milestones);
   const canEdit = canEditProduct(role);
   const [pending, setPending] = useState(false);

   const hasMilestones = useMemo(
      () => milestones.some((milestone) => milestone.projectId === projectId),
      [milestones, projectId]
   );

   const grouped = useMemo(() => {
      return displayOrderedStatus
         .map((status) => ({
            status,
            issues: issues.filter((issue) => issue.status.id === status.id),
         }))
         .filter((group) => group.issues.length > 0);
   }, [issues]);

   const onGenerate = async () => {
      if (pending) return;
      setPending(true);
      try {
         const created = await generateProjectTasks(projectId);
         if (boardId) {
            hydrateIssues(await loadBoardIssues(boardId));
         }
         if (created.length === 0) {
            toast.message(
               hasMilestones
                  ? 'No new tasks were proposed for these milestones'
                  : 'Add milestones before generating tasks'
            );
            return;
         }
         toast.success(
            created.length === 1 ? 'Generated 1 task' : `Generated ${created.length} tasks`
         );
      } catch (error) {
         toast.error(error instanceof BerryApiError ? error.message : 'Could not generate tasks');
      } finally {
         setPending(false);
      }
   };

   return (
      <section>
         <div className="mb-1 flex items-center justify-between gap-2">
            <DetailSectionLabel className="mb-0 pb-[7px]">Tasks</DetailSectionLabel>
            {canEdit ? (
               <Button
                  type="button"
                  variant="ghost"
                  size="xxs"
                  className="-mt-1 text-ripe hover:bg-card hover:text-ripe"
                  disabled={pending || !hasMilestones}
                  title={
                     hasMilestones
                        ? 'Generate tasks from project milestones'
                        : 'Add milestones before generating tasks'
                  }
                  aria-label="Generate task"
                  onClick={() => void onGenerate()}
               >
                  <Lightbulb className="size-3.5" strokeWidth={1.6} aria-hidden />
                  {pending ? 'Generating…' : 'Generate task'}
               </Button>
            ) : null}
         </div>
         {issues.length === 0 ? (
            <p className="text-muted-foreground">No tasks linked to this project yet.</p>
         ) : (
            <div className="flex flex-col gap-4">
               {grouped.map(({ status, issues: statusIssues }) => (
                  <div key={status.id}>
                     <div className="mb-1.5 flex items-center gap-1.5 text-muted-foreground">
                        {renderStatusIcon(status.id)}
                        <span>{status.name}</span>
                        <span className="tabular-nums">{statusIssues.length}</span>
                     </div>
                     <div className="overflow-hidden rounded-md border border-border/45">
                        {statusIssues.map((issue) => (
                           <IssueLine key={issue.id} issue={issue} />
                        ))}
                     </div>
                  </div>
               ))}
            </div>
         )}
      </section>
   );
}
