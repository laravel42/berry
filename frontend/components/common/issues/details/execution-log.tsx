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
import { formatDistanceToNow, parseISO } from 'date-fns';
import {
   ChevronDown,
   ChevronRight,
   GitPullRequestArrow,
   RotateCcw,
   ScrollText,
   X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

/**
 * Every run this task has had.
 *
 * The activity feed already says a run happened, but it says it in the middle
 * of everything else and only once. What an operator asks of a task with six
 * runs behind it is a different question — which of these is still going, what
 * started each one, who asked, and why did that one stop — and that is a list,
 * ordered by relevance rather than by time: whatever is running now, then the
 * history behind a fold.
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

function timeAgo(iso: string): string {
   try {
      return formatDistanceToNow(parseISO(iso), { addSuffix: true });
   } catch {
      return 'recently';
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

   // The plain-language part. A failure code is what the server knows; what a
   // reader needs is the sentence, and a cancelled run needs one too because
   // "cancelled" alone reads like something went wrong.
   const reason =
      run.status === 'failed'
         ? t('reasonFailed', { reason: run.failure?.message || t('reasonUnknown') })
         : run.status === 'cancelled'
           ? t('reasonCancelled')
           : null;

   return (
      <li className="flex flex-col gap-1 border-b border-border/50 py-2 last:border-b-0">
         <div className="flex min-w-0 items-center gap-2">
            <span className={cn('shrink-0 capitalize', statusTone(run.status))}>{run.status}</span>
            <span className="min-w-0 truncate text-actor-agent">
               {agent?.name ?? t('trigger.assignment')}
            </span>
            {duration !== null ? (
               <span className="shrink-0 text-muted-foreground">{formatRunDuration(duration)}</span>
            ) : null}
         </div>
         <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-muted-foreground">
            <span className="rounded bg-accent px-1.5">{trigger}</span>
            <span className="truncate">{asker ? t('by', { name: asker }) : t('bySystem')}</span>
         </div>
         {reason ? <p className="text-muted-foreground">{reason}</p> : null}
         <div className="flex flex-wrap items-center gap-1">
            <Button variant="ghost" size="xs" onClick={() => onTranscript(run)}>
               <ScrollText className="mr-1 size-3.5" aria-hidden />
               {t('transcript')}
            </Button>
            {isTerminalRunStatus(run.status) ? (
               <Button variant="ghost" size="xs" disabled={busy} onClick={() => onRetry(run)}>
                  <RotateCcw className="mr-1 size-3.5" aria-hidden />
                  {t('retry')}
               </Button>
            ) : (
               <Button variant="ghost" size="xs" disabled={busy} onClick={() => onCancel(run)}>
                  <X className="mr-1 size-3.5" aria-hidden />
                  {t('cancel')}
               </Button>
            )}
         </div>
      </li>
   );
}

const reviewsLinkClass =
   'inline-flex h-7 items-center rounded-sm underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50';

/**
 * The latest finished run, unfolded, while the task waits on a person — and
 * the decision itself.
 *
 * In review is the moment someone opens the task to decide, and the one fact
 * they need — did the agent deliver, when, and where is the pull request —
 * should not sit behind "1 past run". Nor should the decision sit on another
 * page: once the open review queue has this task, its decision bar is here,
 * with the same rules and the same confirm as Reviews. Until the queue has
 * loaded, or when it does not list this task, only the link to Reviews shows.
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
   const when = timeAgo(run.completedAt ?? run.startedAt ?? run.createdAt);
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
      <Link href={reviewsHref} className={reviewsLinkClass}>
         {t('openInReviews')}
      </Link>
   );

   return (
      <div className="mb-2 flex flex-col gap-1 rounded-sm border border-border/60 bg-container px-3 py-2">
         <div className="flex min-w-0 items-start gap-2">
            <BerryMark
               size="sm"
               tone={stopped ? 'attention' : markTone(run.status)}
               className="mt-0.5"
            />
            <p className="min-w-0">
               <span className="sr-only">{t('latest')}: </span>
               {sentence}
               {run.status === 'succeeded' ? (
                  <span className="text-muted-foreground"> {t('awaitingReview')}</span>
               ) : null}
            </p>
         </div>
         <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-6">
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
            <Button variant="ghost" size="xs" onClick={() => onTranscript(run)}>
               <ScrollText className="mr-1 size-3.5" aria-hidden />
               {t('transcript')}
            </Button>
            {review ? null : reviewsLink}
         </div>
         {review ? (
            <ReviewDecisionBar
               key={review.id}
               item={review}
               onDecided={onDecided}
               aside={reviewsLink}
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
   /** In review: the latest run's outcome is shown without opening the fold. */
   inReview?: boolean;
   /** Every run on this task; the section decides what to show and in what order. */
   runs: RunRecord[];
   onRunsChanged: (run: RunRecord) => void;
}) {
   const t = useTranslations('issueDetail.log');
   const tReviews = useTranslations('reviews');
   const getAgentById = useAgentsStore((state) => state.getAgentById);
   const updateIssue = useIssuesStore((state) => state.updateIssue);
   const [showPast, setShowPast] = useState(false);
   const [confirming, setConfirming] = useState<RunRecord | null>(null);
   const [busy, setBusy] = useState(false);
   const [transcript, setTranscript] = useState<RunRecord | null>(null);
   const [decided, setDecided] = useState<ReviewOutcome | null>(null);

   useEffect(() => {
      setDecided(null);
   }, [issueId]);

   const { active, past } = useMemo(() => orderRunsForLog(runs), [runs]);
   const latest = inReview && active.length === 0 ? (past[0] ?? null) : null;

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
      <section>
         <h2 data-heading="label" className="mb-2 pb-[7px] text-muted-foreground">
            {t('title')}
         </h2>
         {decided ? (
            <div
               role="status"
               className="mb-2 flex items-center gap-2 rounded-sm border border-border/60 bg-muted/50 px-3 py-2"
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
                     <div className="mb-1 text-muted-foreground">{t('active')}</div>
                     <ul className="mb-2 flex flex-col">
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

               {past.length > 0 ? (
                  <>
                     <Button
                        variant="ghost"
                        size="xs"
                        className="-ml-2 text-muted-foreground"
                        aria-expanded={showPast}
                        onClick={() => setShowPast((value) => !value)}
                     >
                        {showPast ? (
                           <ChevronDown className="mr-1 size-3.5" aria-hidden />
                        ) : (
                           <ChevronRight className="mr-1 size-3.5" aria-hidden />
                        )}
                        {showPast ? t('hidePast') : t('pastCount', { count: past.length })}
                     </Button>
                     {showPast ? (
                        <ul className="flex flex-col">
                           {past.map((run) => (
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
                     ) : null}
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
      </section>
   );
}

export default ExecutionLog;
