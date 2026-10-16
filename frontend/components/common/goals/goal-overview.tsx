'use client';

import { BerryMark } from '@/components/brand/berry-mark';
import { ApprovalCard } from '@/components/common/approvals/approval-card';
import { DescriptionTextarea } from '@/components/common/editor/description-textarea';
import { EmptyStateLoading } from '@/components/common/empty-state';
import { IssueLine } from '@/components/common/issues/issue-line';
import { Pill, SectionHeading } from '@/components/common/plans/plan-sections';
import { useInDetailDrawer } from '@/components/layout/detail-drawer-context';
import { useGoal } from '@/hooks/use-goal';
import { APPROVAL_STATUS, GOAL_STATUS, statusLook, uiStatusFromApi } from '@/lib/catalog';
import { WORKSPACE_SLUG } from '@/lib/config';
import { subscribeWorkspaceEvents } from '@/lib/events';
import {
   describeGoalStatusReason,
   listGoalApprovals,
   listGoalIssues,
   listGoalPlans,
   updateWorkspaceGoal,
   type Goal,
   type GoalApprovalRef,
   type GoalIssueRef,
   type GoalPlanRef,
} from '@/lib/goals';
import { cn } from '@/lib/utils';
import { canEditProduct } from '@/lib/workspace-role';
import { useApprovalsStore } from '@/store/approvals-store';
import { useGoalsStore } from '@/store/goals-store';
import { useIssuesStore } from '@/store/issues-store';
import { useMembersStore } from '@/store/members-store';
import { useProjectsStore } from '@/store/projects-store';
import { useSessionStore } from '@/store/session-store';
import { format, parseISO } from 'date-fns';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { GoalActionsMenu } from './goal-context-menu';
import { GoalProgress } from './goal-progress';
import { GoalStatusBadge } from './goal-status-badge';
import { GoalTitle } from './goal-title';

function whenText(iso: string | null | undefined): string {
   if (!iso) return '—';
   try {
      return format(parseISO(iso), 'd MMM yyyy, HH:mm');
   } catch {
      return iso;
   }
}

interface GoalLists {
   issues: GoalIssueRef[];
   approvals: GoalApprovalRef[];
   plans: GoalPlanRef[];
}

const EMPTY_LISTS: GoalLists = { issues: [], approvals: [], plans: [] };

/** Everything hanging off a goal, re-read when the stream says something moved. */
function useGoalLists(goalId: string): { lists: GoalLists; loaded: boolean } {
   const status = useSessionStore((state) => state.status);
   const [lists, setLists] = useState<GoalLists>(EMPTY_LISTS);
   const [loaded, setLoaded] = useState(false);

   useEffect(() => {
      if (status !== 'ready' || !goalId) return;
      let cancelled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const read = () => {
         void Promise.all([
            listGoalIssues(goalId).catch(() => []),
            listGoalApprovals(goalId).catch(() => []),
            listGoalPlans(goalId).catch(() => []),
         ]).then(([issues, approvals, plans]) => {
            if (cancelled) return;
            setLists({ issues, approvals, plans });
            setLoaded(true);
         });
      };
      read();
      const unsubscribe = subscribeWorkspaceEvents((event) => {
         const type = event.type;
         if (
            !type.startsWith('issue.') &&
            !type.startsWith('approval.') &&
            !type.startsWith('plan.') &&
            !type.startsWith('goal.')
         ) {
            return;
         }
         if (timer) clearTimeout(timer);
         timer = setTimeout(read, 500);
      });
      return () => {
         cancelled = true;
         unsubscribe();
         if (timer) clearTimeout(timer);
      };
   }, [status, goalId]);

   return { lists, loaded };
}

function WorkSection({ refs, orgId }: { refs: GoalIssueRef[]; orgId: string }) {
   const issues = useIssuesStore((state) => state.issues);
   return (
      <section className="mt-8">
         <SectionHeading title="Work" count={refs.length} />
         {refs.length === 0 ? (
            <p className="mt-2 text-muted-foreground">
               This goal groups no tasks yet. Link work to it, or start a plan from its project.
            </p>
         ) : (
            <div className="mt-2 overflow-hidden rounded-md border border-border/60 bg-background">
               {refs.map((ref) => {
                  const issue = issues.find((candidate) => candidate.id === ref.id);
                  if (issue) return <IssueLine key={ref.id} issue={issue} />;
                  const status = uiStatusFromApi(ref.status);
                  return (
                     <Link
                        key={ref.id}
                        href={`/${orgId}/issue/${ref.identifier}`}
                        className="flex min-h-11 items-center gap-2 border-b border-border/45 px-4 last:border-b-0 hover:bg-accent/45 sm:px-6"
                     >
                        {status && <status.icon />}
                        <span className="w-[72px] shrink-0 truncate text-subtle-foreground">
                           {ref.identifier}
                        </span>
                        <span className="truncate">{ref.title}</span>
                     </Link>
                  );
               })}
            </div>
         )}
      </section>
   );
}

function ApprovalsSection({
   refs,
   goalId,
   orgId,
}: {
   refs: GoalApprovalRef[];
   goalId: string;
   orgId: string;
}) {
   const allApprovals = useApprovalsStore((state) => state.approvals);
   const approvals = useMemo(
      () => allApprovals.filter((approval) => approval.goalId === goalId),
      [allApprovals, goalId]
   );
   const known = new Set(approvals.map((approval) => approval.id));
   const pending = approvals.filter((approval) => approval.status === 'pending');
   const resolved = approvals.filter((approval) => approval.status !== 'pending');
   const unknown = refs.filter((ref) => !known.has(ref.id));
   const total = approvals.length + unknown.length;
   return (
      <section className="mt-8">
         <SectionHeading title="Approvals" count={total} />
         {total === 0 ? (
            <p className="mt-2 text-muted-foreground">Nothing is waiting on a decision.</p>
         ) : (
            <div className="mt-2 space-y-2">
               {pending.map((approval) => (
                  <ApprovalCard key={approval.id} approval={approval} />
               ))}
               {[...resolved].map((approval) => (
                  <ApprovalCard key={approval.id} approval={approval} compact />
               ))}
               {unknown.map((ref) => {
                  const look = statusLook(APPROVAL_STATUS, ref.status);
                  return (
                     <Link
                        key={ref.id}
                        href={`/${orgId}/inbox?approval=${ref.id}`}
                        className="flex items-center gap-2.5 rounded-md border border-border/60 bg-background px-3 py-2.5 hover:bg-accent/45"
                     >
                        <BerryMark size="sm" tone={look.tone} state={look.state} />
                        <span className="truncate font-medium">{ref.title}</span>
                        <span className="text-muted-foreground">{look.label.toLowerCase()}</span>
                     </Link>
                  );
               })}
            </div>
         )}
      </section>
   );
}

/**
 * The plan this goal came from. There is no "plan this goal" action: planning
 * is what makes a goal, so a second plan would make a second goal rather than
 * change this one.
 */
function PlansSection({ refs, orgId }: { refs: GoalPlanRef[]; orgId: string }) {
   return (
      <section className="mt-8">
         <SectionHeading title={refs.length === 1 ? 'Plan' : 'Plans'} count={refs.length} />
         {refs.length === 0 ? (
            <p className="mt-2 text-muted-foreground">No plan is recorded for this goal.</p>
         ) : (
            <ul className="mt-2 space-y-1.5">
               {refs.map((ref) => (
                  <li key={ref.id}>
                     <Link
                        href={`/${orgId}/plan/${ref.id}`}
                        className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border/60 bg-background px-3 py-2 hover:bg-accent/45"
                     >
                        <span className="font-medium">
                           Plan{ref.version ? ` v${ref.version}` : ''}
                        </span>
                        <Pill>{ref.status}</Pill>
                        {ref.generationStatus && ref.generationStatus !== 'succeeded' && (
                           <Pill tone="attention">{ref.generationStatus}</Pill>
                        )}
                        {ref.compileStatus && ref.compileStatus !== 'not_started' && (
                           <Pill tone={ref.compileStatus === 'succeeded' ? 'complete' : 'neutral'}>
                              {ref.compileStatus === 'succeeded' ? 'started' : ref.compileStatus}
                           </Pill>
                        )}
                        <span className="ml-auto text-muted-foreground">
                           {whenText(ref.createdAt)}
                        </span>
                     </Link>
                  </li>
               ))}
            </ul>
         )}
      </section>
   );
}

function Properties({ goal }: { goal: Goal }) {
   const projects = useProjectsStore((state) => state.projects);
   const members = useMembersStore((state) => state.members);
   const project = goal.projectId
      ? projects.find((candidate) => candidate.id === goal.projectId)
      : undefined;
   const creator = goal.createdBy
      ? (members.find((member) => member.id === goal.createdBy?.id)?.name ?? goal.createdBy.name)
      : '—';
   const rows: { label: string; value: ReactNode }[] = [
      { label: 'Status', value: <GoalStatusBadge status={goal.status} /> },
      { label: 'Project', value: project?.name ?? (goal.projectId ? 'Unknown project' : 'None') },
      { label: 'Planned by', value: creator },
      { label: 'Created', value: whenText(goal.createdAt) },
      { label: 'Started', value: whenText(goal.startedAt) },
      { label: 'Completed', value: whenText(goal.completedAt) },
      {
         label: 'Waiting on',
         value: goal.progress
            ? `${goal.progress.approvalsPending} approval${goal.progress.approvalsPending === 1 ? '' : 's'}`
            : '—',
      },
   ];
   return (
      <dl className="space-y-3">
         {rows.map((row) => (
            <div key={row.label} className="flex flex-col gap-0.5">
               <dt className="text-muted-foreground">{row.label}</dt>
               <dd className="min-w-0 break-words">{row.value}</dd>
            </div>
         ))}
      </dl>
   );
}

function GoalDescription({ goal, readOnly }: { goal: Goal; readOnly: boolean }) {
   const t = useTranslations('goals.description');
   const upsertGoal = useGoalsStore((state) => state.upsertGoal);
   const text = goal.description ?? '';

   if (readOnly && !text) return null;
   if (readOnly) {
      return (
         <section className="mt-6">
            <p className="whitespace-pre-line">{text}</p>
         </section>
      );
   }

   return (
      <DescriptionTextarea
         value={text}
         aria-label={t('label')}
         placeholder={t('placeholder')}
         className="mt-6 min-h-24 placeholder:text-placeholder"
         onCommit={(next) => {
            const description = next === '' ? null : next;
            if (description === (goal.description ?? null)) return;
            const previous = goal.description ?? null;
            upsertGoal({ ...goal, description });
            void updateWorkspaceGoal(goal.id, { description })
               .then((updated) => upsertGoal(updated))
               .catch(() => {
                  upsertGoal({ ...goal, description: previous });
                  toast.error(t('failed'));
               });
         }}
      />
   );
}

/**
 * A goal and everything that serves it: the tasks, the approvals it waits
 * on and the plans that proposed it, with the progress the server counts
 * rather than a client-side estimate.
 */
export default function GoalOverview({ goalId }: { goalId: string }) {
   const params = useParams<{ orgId?: string }>();
   const orgId = params?.orgId || WORKSPACE_SLUG;
   const pathname = usePathname();
   const inDrawer = useInDetailDrawer();
   // The goal page header already carries this button. The list pane does not.
   const menuInHeader = pathname?.includes('/goal/') ?? false;
   const role = useSessionStore((state) => state.workspace?.role);
   const canEdit = canEditProduct(role);
   const { goal, error, loading } = useGoal(goalId);
   const { lists } = useGoalLists(goalId);

   if (!goal) {
      if (loading) return <EmptyStateLoading label="Loading goal…" />;
      return (
         <div className="p-6 text-muted-foreground" role={error ? 'alert' : 'status'}>
            {error ?? 'Goal not found.'}
         </div>
      );
   }

   const look = statusLook(GOAL_STATUS, goal.status);

   return (
      <div
         className={cn(
            // A container, so the properties column follows the room this view is
            // given (a full page, a drawer, the pane beside a list), not the window.
            '@container h-full min-h-0 w-full overflow-hidden bg-container',
            inDrawer ? 'grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto]' : 'flex'
         )}
      >
         <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-y-auto">
               <div className="w-full px-6 py-6 sm:px-8 sm:py-8">
                  <div className="flex items-start justify-between gap-3">
                     <div className="min-w-0 flex-1">
                        <GoalTitle goal={goal} readOnly={!canEdit} />
                     </div>
                     {menuInHeader ? null : <GoalActionsMenu goal={goal} />}
                  </div>
                  <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
                     <span className="inline-flex items-center gap-1.5">
                        <BerryMark size="sm" tone={look.tone} state={look.state} />
                        {look.label}
                     </span>
                     {/* Nobody set this status, so the page says what put it there. */}
                     <span>{describeGoalStatusReason(goal.status)}</span>
                  </p>

                  <GoalProgress progress={goal.progress} className="mt-5" />

                  <GoalDescription goal={goal} readOnly={!canEdit} />

                  <WorkSection refs={lists.issues} orgId={orgId} />
                  <ApprovalsSection refs={lists.approvals} goalId={goal.id} orgId={orgId} />
                  <PlansSection refs={lists.plans} orgId={orgId} />
               </div>
            </div>
         </div>

         <aside className="hidden h-full w-[292px] min-w-0 shrink-0 flex-col overflow-y-auto border-l bg-muted/15 px-5 pt-6 pb-3.5 @4xl:flex">
            <Properties goal={goal} />
         </aside>
      </div>
   );
}
