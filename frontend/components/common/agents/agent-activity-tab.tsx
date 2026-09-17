'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { CheckCircle2, Clock3, LoaderCircle, XCircle } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { BerryApiError } from '@/lib/api';
import { agentTaskDurationMs, type AgentTask } from '@/lib/agents';
import { cancelRun, formatRunDuration } from '@/lib/runs';
import { RunTranscriptDialog } from '@/components/common/runs/transcript-dialog';

interface AgentActivityTabProps {
   tasks: AgentTask[] | null;
   /** Null when there is no further page. */
   cursor: string | null;
   loadingMore: boolean;
   onLoadMore: () => void;
   /** Re-read after a cancellation, so the lists move the run across. */
   onChanged: () => void;
   /** Shown in the transcript's subtitle; the dialog looks nothing up itself. */
   agentName?: string;
   /** When true, drop outer page padding (used inside Overview). */
   embedded?: boolean;
}

function StatusIcon({ status }: { status: string }) {
   if (status === 'succeeded')
      return <CheckCircle2 className="size-4 text-status-success" aria-hidden />;
   if (status === 'failed') return <XCircle className="size-4 text-destructive" aria-hidden />;
   if (status === 'running' || status === 'queued') {
      return <LoaderCircle className="size-4 animate-spin text-muted-foreground" aria-hidden />;
   }
   return <Clock3 className="size-4 text-muted-foreground" aria-hidden />;
}

/**
 * What this agent is doing, and what it did.
 *
 * Runs are paged in from the newest backwards rather than loaded whole: an
 * agent that has been working for months has thousands, and the reader's
 * question is almost always about the last few.
 */
export default function AgentActivityTab({
   tasks,
   cursor,
   loadingMore,
   onLoadMore,
   onChanged,
   agentName,
   embedded = false,
}: AgentActivityTabProps) {
   const { orgId } = useParams<{ orgId: string }>();
   const t = useTranslations('agentsChat.detail');
   const common = useTranslations('agentsChat.common');
   const format = useFormatter();
   const [cancelling, setCancelling] = useState<string | null>(null);
   const [transcript, setTranscript] = useState<string | null>(null);

   /**
    * A failure in the words of someone who has to decide what to do next.
    *
    * The raw code stays in the transcript header rather than inline: a code
    * like `RUNTIME_5XX` tells a reader nothing they can act on here, and the
    * person who can act on it opens the transcript anyway.
    */
   const explain = (task: AgentTask): string => {
      const code = (task.failure?.code ?? '').toUpperCase();
      if (task.status === 'cancelled') return t('failureCancelled');
      if (code.includes('TIMEOUT') || code.includes('DEADLINE')) return t('failureTimeout');
      if (code.includes('RUNTIME') || code.includes('UNAVAILABLE') || code.includes('DEPENDENCY')) {
         return t('failureRuntime');
      }
      return t('failureUnknown');
   };

   const cancel = async (task: AgentTask) => {
      setCancelling(task.id);
      try {
         await cancelRun(task.id);
         toast.success(t('activityCancelled'));
         onChanged();
      } catch (error) {
         toast.error(error instanceof BerryApiError ? error.message : t('failureUnknown'));
      } finally {
         setCancelling(null);
      }
   };

   if (!tasks) {
      return (
         <p className={embedded ? 'text-muted-foreground' : 'px-8 py-6 text-muted-foreground'}>
            {common('loading')}
         </p>
      );
   }

   const active = tasks.filter((task) => task.status === 'queued' || task.status === 'running');
   const finished = tasks.filter((task) => task.status !== 'queued' && task.status !== 'running');

   return (
      <div className={embedded ? 'flex flex-col gap-8' : 'flex flex-col gap-8 px-8 py-6'}>
         <section>
            <h2 className="font-medium">{t('activityNow')}</h2>
            {active.length === 0 ? (
               <p className="mt-3 text-muted-foreground">{t('activityNoActive')}</p>
            ) : (
               <ul className="mt-3 flex flex-col rounded-md border border-border">
                  {active.map((task) => (
                     <li key={task.id} className="border-b border-border last:border-b-0">
                        <div className="flex flex-col gap-1 px-3 py-2.5">
                           <div className="flex items-center gap-3">
                              <StatusIcon status={task.status} />
                              <p className="min-w-0 flex-1 truncate font-medium">
                                 {task.summary?.trim() || task.id.slice(0, 8)}
                              </p>
                              <Button
                                 size="xs"
                                 variant="ghost"
                                 className="shrink-0"
                                 disabled={cancelling === task.id}
                                 onClick={() => void cancel(task)}
                              >
                                 {t('activityCancel')}
                              </Button>
                           </div>
                           <div className="flex items-center gap-3 pl-7">
                              <p className="min-w-0 flex-1 truncate text-muted-foreground">
                                 {t('activitySource', {
                                    source: task.issueId ? 'issue' : 'chat',
                                 })}
                              </p>
                              {task.issueId ? (
                                 <Link
                                    href={`/${orgId}/issue/${task.issueId}`}
                                    className="shrink-0 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                                 >
                                    {t('activityOpenIssue')}
                                 </Link>
                              ) : null}
                              <button
                                 type="button"
                                 onClick={() => setTranscript(task.id)}
                                 className="shrink-0 font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                              >
                                 {t('activityTranscript')}
                              </button>
                           </div>
                        </div>
                     </li>
                  ))}
               </ul>
            )}
         </section>

         <section>
            <h2 className="font-medium">{t('activityRecent')}</h2>
            {finished.length === 0 ? (
               <p className="mt-3 text-muted-foreground">{t('activityNoRecent')}</p>
            ) : (
               <ul className="mt-3 flex flex-col rounded-md border border-border">
                  {finished.map((task) => {
                     const duration = agentTaskDurationMs(task);
                     const failed = task.status === 'failed' || task.status === 'cancelled';
                     return (
                        <li key={task.id} className="border-b border-border last:border-b-0">
                           <div className="flex flex-col gap-1 px-3 py-2.5">
                              <div className="flex items-center gap-3">
                                 <StatusIcon status={task.status} />
                                 <p className="min-w-0 flex-1 truncate font-medium">
                                    {task.summary?.trim() || task.id.slice(0, 8)}
                                 </p>
                                 {duration !== null ? (
                                    <span className="shrink-0 text-muted-foreground">
                                       {formatRunDuration(duration)}
                                    </span>
                                 ) : null}
                              </div>
                              <div className="flex items-center gap-3 pl-7">
                                 <p className="min-w-0 flex-1 truncate text-muted-foreground">
                                    {format.relativeTime(new Date(task.createdAt))}
                                    {failed ? ` · ${explain(task)}` : null}
                                 </p>
                                 <button
                                    type="button"
                                    onClick={() => setTranscript(task.id)}
                                    className="shrink-0 font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                                 >
                                    {t('activityTranscript')}
                                 </button>
                              </div>
                           </div>
                        </li>
                     );
                  })}
               </ul>
            )}
            {cursor ? (
               <Button
                  size="xs"
                  variant="secondary"
                  className="mt-3"
                  disabled={loadingMore}
                  onClick={onLoadMore}
               >
                  {t('activityMore')}
               </Button>
            ) : null}
         </section>

         <RunTranscriptDialog
            runId={transcript}
            open={transcript !== null}
            onOpenChange={(open) => (open ? undefined : setTranscript(null))}
            agentName={agentName}
         />
      </div>
   );
}
