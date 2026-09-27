'use client';

import { BerryMark, type BerryMarkTone } from '@/components/brand/berry-mark';
import { AgentMarkdown } from '@/components/common/agent-markdown';
import { RunTranscriptDialog } from '@/components/common/runs/transcript-dialog';
import { Button } from '@/components/ui/button';
import { BerryApiError } from '@/lib/api';
import type { ApiComment } from '@/lib/comments';
import {
   cancelRun,
   createIssueRun,
   formatRunDuration,
   isTerminalRunStatus,
   retryOrdinal,
   runDurationMs,
   runTriggerKey,
   type RunRecord,
} from '@/lib/runs';
import { timeAgo } from '@/lib/time-ago';
import { cn } from '@/lib/utils';
import { useAgentsStore } from '@/store/agents-store';
import { useMembersStore } from '@/store/members-store';
import { ChevronDown, ChevronRight, RotateCcw, ScrollText, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { toast } from 'sonner';

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

/**
 * A run, as one entry of the task's activity.
 *
 * Runs used to sit apart in an execution log, so what the agents did and what
 * people said about it were read in two lists. A running one pulses and can be
 * cancelled; a finished one can be run again. Here a run
 * is a line in the same timeline: status, agent, why it ran, who asked, how
 * long, when. Its output (the report it ended with, or why it stopped) folds
 * under a toggle, so a task with many runs stays a readable list. A run a
 * newer one has replaced is marked Outdated: its report describes a state of
 * the work that no longer holds.
 */
export function RunEntry({
   run,
   all,
   issueId,
   outdated,
   result = null,
   onRunChanged,
}: {
   run: RunRecord;
   /** Every run on the task, for the retry count. */
   all: RunRecord[];
   issueId: string;
   outdated: boolean;
   /** The comment the run posted when it ended: its output, when there is one. */
   result?: ApiComment | null;
   onRunChanged: (run: RunRecord) => void;
}) {
   const t = useTranslations('issueDetail.log');
   const getAgentById = useAgentsStore((state) => state.getAgentById);
   const getMemberById = useMembersStore((state) => state.getMemberById);
   const outputId = useId();
   const [open, setOpen] = useState(false);
   const [transcript, setTranscript] = useState(false);
   const [busy, setBusy] = useState(false);

   const name = getAgentById(run.agentId)?.name ?? t('trigger.assignment');
   const retries = retryOrdinal(all, run);
   const trigger =
      retries > 0
         ? t('trigger.retry', { count: retries })
         : t(`trigger.${runTriggerKey(run.source)}` as 'trigger.assignment');
   const asker = run.requestedBy ? getMemberById(run.requestedBy.id)?.name : undefined;
   const duration = runDurationMs(run);
   const when = timeAgo(run.completedAt ?? run.startedAt ?? run.createdAt, 'recently');
   // What the run posted when it ended, in full; the stored reason only when
   // it posted nothing (a run the process lost never got to).
   const posted = result?.body.trim() ?? '';
   const output =
      posted ||
      (run.status === 'failed'
         ? run.failure?.message || t('reasonUnknown')
         : run.status === 'cancelled'
           ? t('reasonCancelled')
           : (run.summary ?? '').trim());

   const live = !isTerminalRunStatus(run.status);

   const cancel = async () => {
      setBusy(true);
      try {
         onRunChanged(await cancelRun(run.id));
         toast.success(t('cancelled'));
      } catch (error) {
         toast.error(error instanceof BerryApiError ? error.message : t('cancelFailed'));
      } finally {
         setBusy(false);
      }
   };

   const retry = async () => {
      setBusy(true);
      try {
         onRunChanged(await createIssueRun(issueId, { agentId: run.agentId }));
         toast.success(t('retried'));
      } catch (error) {
         toast.error(error instanceof BerryApiError ? error.message : t('retryFailed'));
      } finally {
         setBusy(false);
      }
   };

   return (
      <div className={cn('flex flex-col', outdated && 'opacity-70')}>
         <div className="flex min-w-0 items-center gap-2 py-0.5 text-muted-foreground">
            <Button
               variant="ghost"
               size="xxs"
               className="size-5 shrink-0 px-0"
               aria-expanded={open}
               aria-controls={outputId}
               title={open ? t('hideOutput') : t('showOutput')}
               onClick={() => setOpen((value) => !value)}
            >
               {open ? (
                  <ChevronDown className="size-3.5" aria-hidden />
               ) : (
                  <ChevronRight className="size-3.5" aria-hidden />
               )}
               <span className="sr-only">{open ? t('hideOutput') : t('showOutput')}</span>
            </Button>
            <span className="flex size-5 shrink-0 items-center justify-center bg-accent">
               <BerryMark size="sm" tone={markTone(run.status)} pulse={live} label={name} />
            </span>
            <span className="min-w-0 flex-1 truncate">
               <span className={cn('capitalize', statusTone(run.status))}>{run.status}</span>
               <span aria-hidden> · </span>
               <span className="text-actor-agent">{name}</span>
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
            </span>
            {outdated ? (
               <span
                  className="shrink-0 rounded-sm border border-status-warning/40 bg-status-warning/10 px-1.5 leading-5 tracking-wider text-status-warning uppercase"
                  title={t('outdatedHint')}
               >
                  {t('outdated')}
               </span>
            ) : null}
            <span className="flex shrink-0 items-center">
               <Button
                  variant="ghost"
                  size="xxs"
                  className="size-6 px-0"
                  title={t('transcript')}
                  onClick={() => setTranscript(true)}
               >
                  <ScrollText className="size-3.5" aria-hidden />
                  <span className="sr-only">{t('transcript')}</span>
               </Button>
               {live ? (
                  <Button
                     variant="ghost"
                     size="xxs"
                     className="size-6 px-0"
                     disabled={busy}
                     title={t('cancel')}
                     onClick={() => void cancel()}
                  >
                     <X className="size-3.5" aria-hidden />
                     <span className="sr-only">{t('cancel')}</span>
                  </Button>
               ) : (
                  <Button
                     variant="ghost"
                     size="xxs"
                     className="size-6 px-0"
                     disabled={busy}
                     title={t('retry')}
                     onClick={() => void retry()}
                  >
                     <RotateCcw className="size-3.5" aria-hidden />
                     <span className="sr-only">{t('retry')}</span>
                  </Button>
               )}
            </span>
         </div>
         {open ? (
            <div
               id={outputId}
               className="mt-1 mb-1.5 ml-7 rounded-sm border border-border/60 px-3 py-2"
            >
               {output ? (
                  posted || run.status === 'succeeded' ? (
                     <AgentMarkdown body={output} />
                  ) : (
                     <p className="break-words">{output}</p>
                  )
               ) : (
                  <p className="text-muted-foreground">{t('noOutput')}</p>
               )}
            </div>
         ) : null}
         <RunTranscriptDialog
            runId={transcript ? run.id : null}
            open={transcript}
            agentName={name}
            onOpenChange={setTranscript}
         />
      </div>
   );
}

/**
 * The runs a newer one has replaced: every run older than the task's latest
 * succeeded run. The latest success is never outdated — a run that is still
 * going, failed or was cancelled after it replaces nothing — and before any
 * run has succeeded, nothing is.
 */
export function outdatedRunIds(runs: RunRecord[]): Set<string> {
   const latest = runs
      .filter((run) => run.status === 'succeeded')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
   if (!latest) return new Set();
   return new Set(
      runs
         .filter((run) => run.id !== latest.id && run.createdAt < latest.createdAt)
         .map((run) => run.id)
   );
}
