'use client';

import { ChevronLeft, ChevronRight, ExternalLink, RotateCcw, Square } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import { BerryMark } from '@/components/brand/berry-mark';
import { EmptyStateLoading } from '@/components/common/empty-state';
import LoopRunStateBadge from '@/components/common/loops/run-state-badge';
import { RunTranscript } from '@/components/common/runs/transcript-dialog';
import MainLayout from '@/components/layout/main-layout';
import { PageTitleBar } from '@/components/layout/headers/page-title-bar';
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
   cancelLoopRun,
   describeAutopilotFailure,
   describeReason,
   getLoopRun,
   isAutopilotEvent,
   retryLoopRun,
   type LoopRunDetail,
} from '@/lib/autopilots';
import { WORKSPACE_SLUG } from '@/lib/config';
import { subscribeWorkspaceEvents } from '@/lib/events';
import { cn } from '@/lib/utils';
import { canEditProduct } from '@/lib/workspace-role';
import { useAgentsStore } from '@/store/agents-store';
import { useSessionStore } from '@/store/session-store';

const ACTIVE = new Set(['queued', 'running']);
const RETRYABLE = new Set(['failed', 'canceled', 'timed_out']);

/**
 * One Loop run, inspected: what started it, what it was allowed, what it
 * spent, and — from the run's own event stream — what it did.
 *
 * The timeline is the run transcript every agent run has (tool calls,
 * commands, results, errors), followed live while it works. Berry records
 * no private reasoning, so none is shown; the agent's progress messages and
 * its report are.
 */
export default function LoopRun({ loopId, runId }: { loopId: string; runId: string }) {
   const t = useTranslations('loops.run');
   const format = useFormatter();
   const router = useRouter();
   const params = useParams<{ orgId?: string }>();
   const orgId = params?.orgId || WORKSPACE_SLUG;
   const canEdit = canEditProduct(useSessionStore((state) => state.workspace?.role));
   const agents = useAgentsStore((state) => state.agents);
   const [run, setRun] = useState<LoopRunDetail | null>(null);
   const [error, setError] = useState<string | null>(null);
   const [busy, setBusy] = useState(false);
   const [confirmCancel, setConfirmCancel] = useState(false);
   const [nonce, setNonce] = useState(0);
   const reload = useCallback(() => setNonce((value) => value + 1), []);

   useEffect(() => {
      const controller = new AbortController();
      void getLoopRun(loopId, runId, controller.signal)
         .then((found) => {
            setRun(found);
            setError(null);
         })
         .catch((failure: unknown) => {
            if (!controller.signal.aborted) setError(describeAutopilotFailure(failure));
         });
      return () => controller.abort();
   }, [loopId, runId, nonce]);

   // The server writes `autopilot.run.updated` when this run's agent run ends.
   useEffect(() => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const unsubscribe = subscribeWorkspaceEvents((event) => {
         if (!isAutopilotEvent(event, loopId)) return;
         if (timer) clearTimeout(timer);
         timer = setTimeout(reload, 300);
      });
      return () => {
         unsubscribe();
         if (timer) clearTimeout(timer);
      };
   }, [loopId, reload]);

   const header = (
      <PageTitleBar title={run ? t('title', { name: run.autopilotName }) : t('loadingTitle')}>
         {run ? <LoopRunStateBadge state={run.state} /> : null}
      </PageTitleBar>
   );

   if (error) {
      return (
         <MainLayout header={header}>
            <div className="flex min-h-64 flex-col items-center justify-center gap-4 px-8 py-16 text-center">
               <BerryMark size="lg" tone="neutral" state="crossed" label={t('loadFailed')} />
               <p className="max-w-sm text-muted-foreground" role="alert">
                  {error}
               </p>
               <Button asChild variant="secondary">
                  <Link href={`/${orgId}/loop/${loopId}?view=runs`}>{t('backToLoop')}</Link>
               </Button>
            </div>
         </MainLayout>
      );
   }
   if (!run) {
      return (
         <MainLayout header={header}>
            <EmptyStateLoading label={t('loading')} />
         </MainLayout>
      );
   }

   const agent = agents.find((entry) => entry.id === run.agentId);
   const started = run.startedAt ?? run.createdAt;
   const finished = run.completedAt;
   const duration = finished ? Date.parse(finished) - Date.parse(started) : null;
   const active = ACTIVE.has(run.state);
   const retryable = RETRYABLE.has(run.state) && !run.retriedBy;

   const retry = async () => {
      setBusy(true);
      try {
         const outcome = await retryLoopRun(loopId, run.id);
         toast.success(t('retried'));
         router.push(`/${orgId}/loop/${loopId}/runs/${outcome.autopilotRunId}`);
      } catch (failure) {
         toast.error(describeAutopilotFailure(failure));
         reload();
      } finally {
         setBusy(false);
      }
   };

   const cancel = async () => {
      setBusy(true);
      try {
         await cancelLoopRun(loopId, run.id);
         toast.success(t('cancelled'));
         reload();
      } catch (failure) {
         toast.error(describeAutopilotFailure(failure));
         reload();
      } finally {
         setBusy(false);
         setConfirmCancel(false);
      }
   };

   return (
      <MainLayout header={header}>
         <div className="flex h-full min-h-0 flex-col lg:flex-row">
            <section
               className="min-h-0 flex-1 overflow-y-auto border-b lg:border-b-0 lg:border-r"
               aria-label={t('timeline')}
            >
               <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3">
                  <Button asChild variant="ghost" size="xs">
                     <Link href={`/${orgId}/loop/${loopId}?view=runs`}>
                        <ChevronLeft className="size-3.5" aria-hidden />
                        {run.autopilotName}
                     </Link>
                  </Button>
                  <div className="ml-auto flex items-center gap-2">
                     {run.issueIdentifier ? (
                        <Button asChild variant="ghost" size="xs">
                           <Link href={`/${orgId}/issue/${run.issueIdentifier}`}>
                              <ExternalLink className="size-3.5" aria-hidden />
                              {t('openTask', { identifier: run.issueIdentifier })}
                           </Link>
                        </Button>
                     ) : null}
                     {canEdit && active && run.runId ? (
                        <Button
                           variant="secondary"
                           size="xs"
                           disabled={busy}
                           onClick={() => setConfirmCancel(true)}
                        >
                           <Square className="size-3.5" aria-hidden />
                           {t('cancel')}
                        </Button>
                     ) : null}
                     {canEdit && retryable ? (
                        <Button size="xs" disabled={busy} onClick={() => void retry()}>
                           <RotateCcw className="size-3.5" aria-hidden />
                           {t('retry')}
                        </Button>
                     ) : null}
                     {run.retriedBy ? (
                        <Button asChild variant="ghost" size="xs">
                           <Link href={`/${orgId}/loop/${loopId}/runs/${run.retriedBy}`}>
                              {t('viewRetry')}
                              <ChevronRight className="size-3.5" aria-hidden />
                           </Link>
                        </Button>
                     ) : null}
                  </div>
               </div>
               {run.state === 'waiting_for_approval' ? (
                  <p className="border-b bg-status-warning/5 px-5 py-2.5" role="status">
                     {t('waitingForApproval')}
                  </p>
               ) : null}
               {run.runId ? (
                  <RunTranscript
                     runId={run.runId}
                     order="oldest-first"
                     className="min-h-[420px]"
                     listClassName="max-h-none"
                  />
               ) : (
                  <div className="px-5 py-10 text-muted-foreground">
                     <p>{t('noAgentRun')}</p>
                     {run.reasonMessage ? (
                        <p className="mt-2 text-foreground">{run.reasonMessage}</p>
                     ) : null}
                  </div>
               )}
            </section>

            <aside
               className="w-full shrink-0 overflow-y-auto px-5 py-4 lg:w-80"
               aria-label={t('details')}
            >
               <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
                  <Fact label={t('state')}>
                     <LoopRunStateBadge state={run.state} />
                  </Fact>
                  {run.reasonCode ? (
                     <Fact label={t('reason')}>{describeReason(run.reasonCode)}</Fact>
                  ) : null}
                  <Fact label={t('trigger')}>
                     {t(`source.${run.source}`)}
                     {run.slot
                        ? ` · ${format.dateTime(new Date(run.slot), { dateStyle: 'medium', timeStyle: 'short' })}`
                        : ''}
                  </Fact>
                  <Fact label={t('started')}>
                     <time dateTime={started}>
                        {format.dateTime(new Date(started), {
                           dateStyle: 'medium',
                           timeStyle: 'medium',
                        })}
                     </time>
                  </Fact>
                  {finished ? (
                     <Fact label={t('finished')}>
                        <time dateTime={finished}>
                           {format.dateTime(new Date(finished), {
                              dateStyle: 'medium',
                              timeStyle: 'medium',
                           })}
                        </time>
                     </Fact>
                  ) : null}
                  {duration !== null ? (
                     <Fact label={t('duration')}>{formatDuration(duration)}</Fact>
                  ) : null}
                  <Fact label={t('agent')}>
                     {agent?.name ?? (run.agentId ? t('unknownAgent') : '—')}
                  </Fact>
                  {run.model?.runtime || run.model?.model ? (
                     <Fact label={t('model')}>
                        {[run.model.runtime, run.model.model].filter(Boolean).join(' · ')}
                     </Fact>
                  ) : null}
                  {run.usage && run.usage.totalTokens > 0 ? (
                     <Fact label={t('tokens')}>
                        {t('tokenCount', {
                           total: format.number(run.usage.totalTokens),
                           input: format.number(run.usage.inputTokens),
                           output: format.number(run.usage.outputTokens),
                        })}
                     </Fact>
                  ) : null}
                  {run.usage?.costMicros !== null &&
                  run.usage?.costMicros !== undefined &&
                  run.usage.currency ? (
                     <Fact label={t('cost')}>
                        {format.number(run.usage.costMicros / 1_000_000, {
                           style: 'currency',
                           currency: run.usage.currency,
                        })}
                     </Fact>
                  ) : null}
                  {run.depth > 0 || run.parentAutopilotRunId ? (
                     <Fact label={t('chain')}>{t('depth', { depth: run.depth })}</Fact>
                  ) : null}
                  {run.retryOf ? (
                     <Fact label={t('retryOf')}>
                        <Link
                           className="underline-offset-2 hover:underline"
                           href={`/${orgId}/loop/${loopId}/runs/${run.retryOf}`}
                        >
                           {t('originalRun')}
                        </Link>
                     </Fact>
                  ) : null}
                  {run.failureCode ? (
                     <Fact label={t('failure')}>
                        <span className="text-status-danger">
                           {run.failureMessage ?? run.failureCode}
                        </span>
                     </Fact>
                  ) : null}
                  <Fact label={t('runId')}>
                     <code className="break-all text-muted-foreground">{run.id}</code>
                  </Fact>
               </dl>

               {run.children.length > 0 ? (
                  <section className="mt-5">
                     <h2 data-heading="label" className="mb-2 text-subtle-foreground">
                        {t('ledTo')}
                     </h2>
                     <ul className="grid gap-1">
                        {run.children.map((child) => (
                           <li key={child.id} className="flex items-center gap-2">
                              <LoopRunStateBadge state={child.state} compact />
                              <Link
                                 className="truncate hover:underline"
                                 href={`/${orgId}/loop/${child.autopilotId}/runs/${child.id}`}
                              >
                                 {child.autopilotName}
                              </Link>
                           </li>
                        ))}
                     </ul>
                  </section>
               ) : null}

               {run.triggerPayload !== null && run.triggerPayload !== undefined ? (
                  <PayloadSection payload={run.triggerPayload} label={t('payload')} />
               ) : null}

               {run.summary ? (
                  <section className="mt-5">
                     <h2 data-heading="label" className="mb-2 text-subtle-foreground">
                        {t('summary')}
                     </h2>
                     <p className="whitespace-pre-wrap">{run.summary}</p>
                  </section>
               ) : null}
            </aside>
         </div>

         <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
            <AlertDialogContent>
               <AlertDialogHeader>
                  <AlertDialogTitle>{t('cancelTitle')}</AlertDialogTitle>
                  <AlertDialogDescription>{t('cancelBody')}</AlertDialogDescription>
               </AlertDialogHeader>
               <AlertDialogFooter>
                  <AlertDialogCancel>{t('keepRunning')}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void cancel()}>{t('cancel')}</AlertDialogAction>
               </AlertDialogFooter>
            </AlertDialogContent>
         </AlertDialog>
      </MainLayout>
   );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
   return (
      <>
         <dt className="text-muted-foreground">{label}</dt>
         <dd className="min-w-0">{children}</dd>
      </>
   );
}

function PayloadSection({ payload, label }: { payload: unknown; label: string }) {
   const [open, setOpen] = useState(false);
   return (
      <Collapsible open={open} onOpenChange={setOpen} className="mt-5">
         <CollapsibleTrigger className="flex items-center gap-1 rounded text-subtle-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
            <ChevronRight
               className={cn('size-4 transition-transform', open && 'rotate-90')}
               aria-hidden
            />
            <span data-heading="label">{label}</span>
         </CollapsibleTrigger>
         <CollapsibleContent>
            <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-settings-group p-3">
               {JSON.stringify(payload, null, 2)}
            </pre>
         </CollapsibleContent>
      </Collapsible>
   );
}

function formatDuration(ms: number): string {
   if (ms < 1000) return `${Math.max(0, ms)} ms`;
   const seconds = Math.round(ms / 1000);
   if (seconds < 60) return `${seconds}s`;
   const minutes = Math.floor(seconds / 60);
   if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
   return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
