'use client';

import { BerryMark, type BerryMarkTone } from '@/components/brand/berry-mark';
import {
   ReviewDecisionBar,
   type ReviewOutcome,
} from '@/components/common/reviews/review-decision-bar';
import { RunTranscriptDialog } from '@/components/common/runs/transcript-dialog';
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
import { Button } from '@/components/ui/button';
import { BerryApiError } from '@/lib/api';
import { uiStatusFromApi } from '@/lib/catalog';
import { loadIssuePullRequests, type LinkedPullRequest } from '@/lib/github';
import { stoppedWithoutDelivering } from '@/lib/reviews';
import {
   cancelRun,
   createIssueRun,
   formatRunDuration,
   isTerminalRunStatus,
   orderRunsForLog,
   retryOrdinal,
   runDurationMs,
   runTriggerKey,
   type RunRecord,
} from '@/lib/runs';
import { cn } from '@/lib/utils';
import { useAgentsStore } from '@/store/agents-store';
import { useIssuesStore } from '@/store/issues-store';
import { useMembersStore } from '@/store/members-store';
import { selectOpenReviewForIssue, useReviewsStore } from '@/store/reviews-store';
import { useSessionStore } from '@/store/session-store';
import { timeAgo } from '@/lib/time-ago';
import { GitPullRequestArrow, RotateCcw, ScrollText, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Section } from './panel-section';

/**
 * Every run this task has had.
 *
 * The activity feed already says a run happened, but it says it in the middle
 * of everything else and only once. What an operator asks of a task with six
 * runs behind it is a different question — which of these is still going, what
 * started each one, who asked, and why did that one stop — and that is a list,
 * ordered by relevance rather than by time: whatever is running now, then every
 * finished run below it.
 */

function statusTone(status: RunRecord['status']): string {
   switch (status) {
      case 'succeeded':
         return 'text-status-success';
      case 'failed':
         return 'text-status-danger';
      case 'cancelled':
         return 'text-status-neutral';
      case 'running':
         return 'text-status-info';
      default:
         return 'text-muted-foreground';
   }
}

function markTone(status: RunRecord['status']): BerryMarkTone {
   switch (status) {
      case 'succeeded':
         return 'complete';
      case 'failed':
         return 'danger';
      case 'cancelled':
         return 'neutral';
      default:
         return 'working';
   }
}

function RunRow({
   run,
   all,
   onCancel,
   onRetry,
   onTranscript,
   busy,
}: {
   run: RunRecord;
   all: RunRecord[];
   onCancel: (run: RunRecord) => void;
   onRetry: (run: RunRecord) => void;
   onTranscript: (run: RunRecord) => void;
   busy: boolean;
}) {
   const t = useTranslations('issueDetail.log');
   const getAgentById = useAgentsStore((state) => state.getAgentById);
   const getMemberById = useMembersStore((state) => state.getMemberById);

   const agent = getAgentById(run.agentId);
   const retries = retryOrdinal(all, run);
   const trigger =
      retries > 0
         ? t('trigger.retry', { count: retries })
         : t(`trigger.${runTriggerKey(run.source)}` as 'trigger.assignment');
   const asker = run.requestedBy ? getMemberById(run.requestedBy.id)?.name : undefined;
   const duration = runDurationMs(run);
   const when = timeAgo(run.completedAt ?? run.startedAt ?? run.createdAt, 'recently');
   const live = !isTerminalRunStatus(run.status);

   const reason =
      run.status === 'failed'
         ? t('reasonFailed', { reason: run.failure?.message || t('reasonUnknown') })
         : run.status === 'cancelled'
           ? t('reasonCancelled')
           : null;

   return (
      <li
         className="flex items-center gap-2 py-0.5 text-muted-foreground"
         title={reason ?? undefined}
      >
         <span className="flex size-5 shrink-0 items-center justify-center bg-accent">
            <BerryMark
               size="sm"
               tone={markTone(run.status)}
               pulse={live}
               label={agent?.name ?? t('trigger.assignment')}
            />
         </span>
         <span className="min-w-0 flex-1 truncate">
            <span className={cn('capitalize', statusTone(run.status))}>{run.status}</span>
            <span aria-hidden> · </span>
            <span className="text-actor-agent">{agent?.name ?? t('trigger.assignment')}</span>
            <span aria-hidden> · </span>
            <span>{trigger}</span>
            <span aria-hidden> · </span>
            <span>{asker ? t('by', { name: asker }) : t('bySystem')}</span>
            {duration !== null ? (
               <>
                  <span aria-hidden> · </span>
                  <span>{formatRunDuration(duration)}</span>
               </>
            ) : null}
            <span aria-hidden> · </span>
            <span>{when}</span>
            {reason ? (
               <>
                  <span aria-hidden> · </span>
                  <span>{reason}</span>
               </>
            ) : null}
         </span>
         <span className="ml-auto flex shrink-0 items-center">
            <Button
               variant="ghost"
               size="xxs"
               className="size-6 px-0"
               title={t('transcript')}
               onClick={() => onTranscript(run)}
            >
               <ScrollText className="size-3.5" aria-hidden />
               <span className="sr-only">{t('transcript')}</span>
            </Button>
            {isTerminalRunStatus(run.status) ? (
               <Button
                  variant="ghost"
                  size="xxs"
                  className="size-6 px-0"
                  disabled={busy}
                  title={t('retry')}
                  onClick={() => onRetry(run)}
               >
                  <RotateCcw className="size-3.5" aria-hidden />
                  <span className="sr-only">{t('retry')}</span>
               </Button>
            ) : (
               <Button
                  variant="ghost"
                  size="xxs"
                  className="size-6 px-0"
                  disabled={busy}
                  title={t('cancel')}
                  onClick={() => onCancel(run)}
               >
                  <X className="size-3.5" aria-hidden />
                  <span className="sr-only">{t('cancel')}</span>
               </Button>
            )}
         </span>
      </li>
   );
}

/**
 * The latest finished run, highlighted, while the task waits on a person —
 * and the decision itself.
 *
 * In review is the moment someone opens the task to decide, and the one fact
 * they need — did the agent deliver, when, and where is the pull request —
 * sits above the rest of the log. The decision bar is here too, with the same
 * rules and the same confirm as Reviews. Until the queue has loaded, or when
 * it does not list this task, only the link to Reviews shows.
 */
function LatestOutcome({
   run,
   issueRef,
   onTranscript,
   onDecided,
}: {
   run: RunRecord;
   issueRef?: string;
   onTranscript: (run: RunRecord) => void;
   onDecided: (outcome: ReviewOutcome) => void;
}) {
   const t = useTranslations('issueDetail.log');
   const { orgId } = useParams<{ orgId: string }>();
   const getAgentById = useAgentsStore((state) => state.getAgentById);
   const workspaceId = useSessionStore((state) => state.workspace?.id);
   const review = useReviewsStore((state) =>
      issueRef ? selectOpenReviewForIssue(state, issueRef) : undefined
   );
   const [pullRequest, setPullRequest] = useState<LinkedPullRequest | null>(null);

   useEffect(() => {
      if (!workspaceId || !issueRef) return;
      let cancelled = false;
      void loadIssuePullRequests(workspaceId, issueRef)
         .then((result) => {
            if (cancelled || !result.visible) return;
            // The one still open is the one under review; anything else is history.
            setPullRequest(
               result.pullRequests.find((pr) => pr.state === 'open' || pr.state === 'draft') ??
                  result.pullRequests[0] ??
                  null
            );
         })
         .catch(() => undefined);
      return () => {
         cancelled = true;
      };
   }, [workspaceId, issueRef]);

   const name = getAgentById(run.agentId)?.name ?? t('trigger.assignment');
   const when = timeAgo(run.completedAt ?? run.startedAt ?? run.createdAt, 'recently');
   const stopped = review ? stoppedWithoutDelivering(review) : false;
   const sentence =
      run.status === 'succeeded'
         ? stopped
            ? t('outcomeStopped', { name, when })
            : t('outcomeDelivered', { name, when })
         : run.status === 'failed'
           ? t('outcomeFailed', {
                name,
                when,
                reason: run.failure?.message || t('reasonUnknown'),
             })
           : t('outcomeCancelled', { name, when });

   const reviewsHref = review ? `/${orgId}/review/${review.id}` : `/${orgId}/reviews`;
   const reviewsLink = (
      <Button asChild variant="ghost" size="xs" className="border border-input">
         <Link href={reviewsHref}>{t('openInReviews')}</Link>
      </Button>
   );
   const transcriptButton = (
      <Button variant="secondary" size="xs" onClick={() => onTranscript(run)}>
         <ScrollText className="mr-1 size-3.5" aria-hidden />
         {t('transcript')}
      </Button>
   );

   return (
      <div className="mb-1.5 flex flex-col gap-1 rounded-sm border border-border/60 bg-container px-3 py-2">
         <div className="flex min-w-0 items-start gap-2">
            <BerryMark
               size="sm"
               tone={stopped ? 'attention' : markTone(run.status)}
               className="mt-0.5"
            />
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
               <p className="min-w-0">
                  <span className="sr-only">{t('latest')}: </span>
                  {sentence}
                  {run.status === 'succeeded' ? (
                     <span className="text-muted-foreground"> {t('awaitingReview')}</span>
                  ) : null}
               </p>
               {pullRequest ? (
                  <a
                     href={pullRequest.url}
                     target="_blank"
                     rel="noreferrer"
                     title={`${pullRequest.repoFullName}#${pullRequest.number}`}
                     className="inline-flex h-7 items-center gap-1 rounded-sm underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                     <GitPullRequestArrow className="size-3.5 text-status-info" aria-hidden />
                     {t('pullRequest', { number: pullRequest.number })}
                  </a>
               ) : null}
               {review ? null : (
                  <>
                     {transcriptButton}
                     {reviewsLink}
                  </>
               )}
            </div>
         </div>
         {review ? (
            <ReviewDecisionBar
               key={review.id}
               item={review}
               onDecided={onDecided}
               aside={
                  <span className="inline-flex flex-wrap items-center gap-2">
                     {transcriptButton}
                     {reviewsLink}
                  </span>
               }
               className="mt-1 border-t border-border/60 pt-3"
            />
         ) : null}
      </div>
   );
}

export function ExecutionLog({
   issueId,
   issueRef,
   inReview = false,
   runs,
   onRunsChanged,
}: {
   issueId: string;
   /** The task key, for the pull request lookup on the outcome line. */
   issueRef?: string;
   /** In review: the latest run's outcome is highlighted above the past list. */
   inReview?: boolean;
   /** Every run on this task; the section decides what to show and in what order. */
   runs: RunRecord[];
   onRunsChanged: (run: RunRecord) => void;
}) {
   const t = useTranslations('issueDetail.log');
   const tReviews = useTranslations('reviews');
   const getAgentById = useAgentsStore((state) => state.getAgentById);
   const updateIssue = useIssuesStore((state) => state.updateIssue);
   const [confirming, setConfirming] = useState<RunRecord | null>(null);
   const [busy, setBusy] = useState(false);
   const [transcript, setTranscript] = useState<RunRecord | null>(null);
   const [decided, setDecided] = useState<ReviewOutcome | null>(null);

   useEffect(() => {
      setDecided(null);
   }, [issueId]);

   const { active, past } = useMemo(() => orderRunsForLog(runs), [runs]);
   const latest = inReview && active.length === 0 ? (past[0] ?? null) : null;
   const older = latest ? past.slice(1) : past;

   // The decision already went through the API; the page reflects it at once
   // rather than waiting for the stream, and the outcome line stays put after
   // the review box has gone.
   const handleDecided = (outcome: ReviewOutcome) => {
      setDecided(outcome);
      const status = uiStatusFromApi(outcome.decision === 'approve' ? 'done' : 'todo');
      if (status) updateIssue(issueId, { status });
   };

   const doCancel = async () => {
      if (!confirming) return;
      setBusy(true);
      try {
         onRunsChanged(await cancelRun(confirming.id));
         toast.success(t('cancelled'));
         setConfirming(null);
      } catch (error) {
         toast.error(error instanceof BerryApiError ? error.message : t('cancelFailed'));
      } finally {
         setBusy(false);
      }
   };

   const doRetry = async (run: RunRecord) => {
      setBusy(true);
      try {
         onRunsChanged(await createIssueRun(issueId, { agentId: run.agentId }));
         toast.success(t('retried'));
      } catch (error) {
         toast.error(error instanceof BerryApiError ? error.message : t('retryFailed'));
      } finally {
         setBusy(false);
      }
   };

   return (
      <Section title={t('title')}>
         {decided ? (
            <div
               role="status"
               className="mb-1.5 flex items-center gap-2 rounded-sm border border-border/60 bg-muted/50 px-3 py-2"
            >
               <BerryMark
                  size="sm"
                  tone={decided.decision === 'approve' ? 'complete' : 'attention'}
                  state="solid"
               />
               <span className="min-w-0">
                  {tReviews(
                     decided.decision === 'approve' ? 'outcome.approved' : 'outcome.sentBack',
                     { identifier: decided.identifier }
                  )}
               </span>
            </div>
         ) : null}
         {runs.length === 0 ? (
            <p className="text-muted-foreground">{t('empty')}</p>
         ) : (
            <>
               {active.length > 0 ? (
                  <>
                     <div className="mb-0.5 text-muted-foreground">{t('active')}</div>
                     <ul className="mb-1.5 flex flex-col">
                        {active.map((run) => (
                           <RunRow
                              key={run.id}
                              run={run}
                              all={runs}
                              busy={busy}
                              onCancel={setConfirming}
                              onRetry={(target) => void doRetry(target)}
                              onTranscript={setTranscript}
                           />
                        ))}
                     </ul>
                  </>
               ) : null}

               {latest ? (
                  <LatestOutcome
                     run={latest}
                     issueRef={issueRef}
                     onTranscript={setTranscript}
                     onDecided={handleDecided}
                  />
               ) : null}

               {older.length > 0 ? (
                  <>
                     {active.length > 0 || latest ? (
                        <h2 data-heading="label" className="mt-5 mb-1 pb-1 text-muted-foreground">
                           {t('past')}
                        </h2>
                     ) : null}
                     <ul className="flex flex-col">
                        {older.map((run) => (
                           <RunRow
                              key={run.id}
                              run={run}
                              all={runs}
                              busy={busy}
                              onCancel={setConfirming}
                              onRetry={(target) => void doRetry(target)}
                              onTranscript={setTranscript}
                           />
                        ))}
                     </ul>
                  </>
               ) : null}
            </>
         )}

         <AlertDialog
            open={confirming !== null}
            onOpenChange={(open) => (open ? undefined : setConfirming(null))}
         >
            <AlertDialogContent>
               <AlertDialogHeader>
                  <AlertDialogTitle>{t('cancelTitle')}</AlertDialogTitle>
                  <AlertDialogDescription>{t('cancelBody')}</AlertDialogDescription>
               </AlertDialogHeader>
               <AlertDialogFooter>
                  <AlertDialogCancel disabled={busy}>{t('keepRunning')}</AlertDialogCancel>
                  <AlertDialogAction
                     disabled={busy}
                     onClick={(event) => {
                        event.preventDefault();
                        void doCancel();
                     }}
                  >
                     {t('confirmCancel')}
                  </AlertDialogAction>
               </AlertDialogFooter>
            </AlertDialogContent>
         </AlertDialog>

         <RunTranscriptDialog
            runId={transcript?.id ?? null}
            open={transcript !== null}
            agentName={
               transcript ? (getAgentById(transcript.agentId)?.name ?? undefined) : undefined
            }
            onOpenChange={(open) => (open ? undefined : setTranscript(null))}
         />
      </Section>
   );
}

export default ExecutionLog;
