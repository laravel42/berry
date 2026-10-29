'use client';

import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { Fragment, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
   describeAutopilotFailure,
   describeReason,
   getWebhookDelivery,
   replayDelivery,
   type AutopilotRun,
   type WebhookDelivery,
} from '@/lib/autopilots';
import { cn } from '@/lib/utils';

import { DOT_TONE, runOutcome, type RunTone } from './autopilot-line';

/** Rows inside a group: dividers between them, none above the first (the group draws that). */
const LIST = 'flex flex-col [&>li+li]:border-t [&>li+li]:border-settings-divider';

function Dot({ tone }: { tone: RunTone }) {
   return <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', DOT_TONE[tone])} />;
}

/** A run of its own, or a run of skipped ones folded together. */
type Entry = { kind: 'run'; run: AutopilotRun } | { kind: 'skipped'; runs: AutopilotRun[] };

/**
 * Consecutive skipped firings become one row.
 *
 * A paused autopilot on a five-minute schedule writes hundreds of identical
 * "skipped" rows, and they bury the runs that actually did something.
 */
export function foldSkipped(runs: AutopilotRun[]): Entry[] {
   const entries: Entry[] = [];
   for (const run of runs) {
      const last = entries.at(-1);
      if (run.status === 'skipped') {
         if (last?.kind === 'skipped' && last.runs[0]?.reasonCode === run.reasonCode) {
            last.runs.push(run);
         } else {
            entries.push({ kind: 'skipped', runs: [run] });
         }
      } else {
         entries.push({ kind: 'run', run });
      }
   }
   return entries;
}

/**
 * The run history as rows: a status dot, what happened over when and how it
 * started, and a link to the task the run worked on. Rendered inside the
 * editor's Runs group.
 */
export function RunRows({ runs, orgId }: { runs: AutopilotRun[]; orgId: string }) {
   const t = useTranslations('areas.autopilots.history');
   const format = useFormatter();
   const [expanded, setExpanded] = useState<string[]>([]);

   if (runs.length === 0) {
      return <p className="px-4 py-3.5 text-subtle-foreground">{t('noRuns')}</p>;
   }
   const entries = foldSkipped(runs);

   const row = (run: AutopilotRun) => {
      const outcome = runOutcome(run);
      const reason = describeReason(run.reasonCode);
      return (
         <li
            key={run.id}
            className="grid grid-cols-[6px_minmax(0,1fr)_auto] items-center gap-2.5 px-4 py-[11px]"
         >
            <Dot tone={outcome.tone} />
            <div className="flex min-w-0 flex-col gap-px">
               <span
                  className={cn(
                     'min-w-0 truncate',
                     outcome.tone === 'danger' ? 'text-status-danger' : 'text-foreground'
                  )}
                  title={run.reasonMessage ?? undefined}
               >
                  {t(`result_${outcome.key}`)}
                  {reason && outcome.key !== 'succeeded' ? ` · ${reason}` : ''}
               </span>
               <span data-settings-type="caption" className="truncate text-subtle-foreground">
                  {format.relativeTime(new Date(run.createdAt))}
                  {' · '}
                  {t(`source_${run.source}`)}
                  {' · '}v{run.autopilotVersion}
               </span>
            </div>
            <span data-settings-type="caption" className="flex items-center gap-2">
               {run.runId ? (
                  <Link
                     className="text-subtle-foreground hover:text-foreground"
                     href={`/${orgId}/runs?run=${run.runId}`}
                  >
                     {t('transcript')}
                  </Link>
               ) : null}
               {run.issueId ? (
                  <Link
                     className="text-subtle-foreground hover:text-foreground"
                     href={`/${orgId}/issue/${run.issueId}`}
                  >
                     {t('openTask')}
                  </Link>
               ) : null}
            </span>
         </li>
      );
   };

   return (
      <ul className={LIST}>
         {entries.map((entry) => {
            if (entry.kind === 'run') return row(entry.run);
            const first = entry.runs[0];
            if (!first) return null;
            if (entry.runs.length === 1) return row(first);
            const open = expanded.includes(first.id);
            return (
               <Fragment key={first.id}>
                  <li className="grid grid-cols-[6px_minmax(0,1fr)] items-center gap-2.5 px-4 py-[11px]">
                     <Dot tone="neutral" />
                     <button
                        type="button"
                        aria-expanded={open}
                        className="min-w-0 cursor-pointer truncate text-left text-muted-foreground hover:text-foreground"
                        onClick={() =>
                           setExpanded((current) =>
                              open
                                 ? current.filter((id) => id !== first.id)
                                 : [...current, first.id]
                           )
                        }
                     >
                        {t('skippedGroup', {
                           count: entry.runs.length,
                           reason: describeReason(first.reasonCode) || t('skippedOne'),
                        })}
                     </button>
                  </li>
                  {open ? entry.runs.map(row) : null}
               </Fragment>
            );
         })}
      </ul>
   );
}

/**
 * Whether this delivery can be fired again, and why not when it cannot.
 *
 * A rejected delivery was refused at the door — most often a signature that did
 * not check out — and the server refuses to replay it. Saying so here means the
 * button explains itself instead of failing.
 */
export function replayBlock(delivery: WebhookDelivery): 'signature' | 'rejected' | 'queued' | null {
   if (delivery.status === 'rejected') {
      return (delivery.failureReason ?? '').toLowerCase().includes('signature')
         ? 'signature'
         : 'rejected';
   }
   if (delivery.autopilotRunId === null && delivery.status === 'accepted') return 'queued';
   return null;
}

/** Whether the signature checked out, as far as the delivery's record says. */
export function signatureState(delivery: WebhookDelivery): 'ok' | 'bad' {
   const reason = (delivery.failureReason ?? '').toLowerCase();
   return delivery.status === 'rejected' && reason.includes('signature') ? 'bad' : 'ok';
}

export function DeliveryRows({
   autopilotId,
   deliveries,
   canReplay,
   onReplayed,
}: {
   autopilotId: string;
   deliveries: WebhookDelivery[];
   canReplay: boolean;
   onReplayed: () => void;
}) {
   const t = useTranslations('areas.autopilots.history');
   const format = useFormatter();
   const [open, setOpen] = useState<{ delivery: WebhookDelivery; payload: string } | null>(null);

   /** How many times this delivery has been through Berry, replays included. */
   const attempts = (delivery: WebhookDelivery) =>
      1 + deliveries.filter((entry) => entry.replayOf === delivery.id).length;

   async function showPayload(delivery: WebhookDelivery) {
      try {
         const detail = await getWebhookDelivery(autopilotId, delivery.id);
         setOpen({
            delivery,
            payload:
               detail.payload === null || detail.payload === undefined
                  ? t('noPayload')
                  : JSON.stringify(detail.payload, null, 2),
         });
      } catch (failure) {
         toast.error(describeAutopilotFailure(failure));
      }
   }

   async function replay(delivery: WebhookDelivery) {
      try {
         const outcome = await replayDelivery(autopilotId, delivery.id);
         toast.success(t('replayed', { status: outcome.status }));
         onReplayed();
      } catch (failure) {
         toast.error(describeAutopilotFailure(failure));
      }
   }

   if (deliveries.length === 0) {
      return <p className="px-4 py-3.5 text-subtle-foreground">{t('noDeliveries')}</p>;
   }

   const tone = (delivery: WebhookDelivery): RunTone =>
      delivery.status === 'accepted'
         ? 'success'
         : delivery.status === 'filtered'
           ? 'neutral'
           : 'danger';

   return (
      <>
         <ul className={LIST}>
            {deliveries.map((delivery) => {
               const blocked = replayBlock(delivery);
               const signature = signatureState(delivery);
               return (
                  <li
                     key={delivery.id}
                     className="grid grid-cols-[6px_minmax(0,1fr)_auto] items-center gap-2.5 px-4 py-[11px]"
                  >
                     <Dot tone={tone(delivery)} />
                     <div className="flex min-w-0 flex-col gap-px">
                        <span
                           className={cn(
                              'min-w-0 truncate',
                              tone(delivery) === 'danger' ? 'text-status-danger' : 'text-foreground'
                           )}
                        >
                           {delivery.event ?? '—'}
                           {' · '}
                           {t(`delivery_${delivery.status}`)}
                           {delivery.failureReason ? ` · ${delivery.failureReason}` : ''}
                        </span>
                        <span
                           data-settings-type="caption"
                           className="truncate text-subtle-foreground"
                        >
                           {format.relativeTime(new Date(delivery.receivedAt))}
                           {delivery.replayOf ? ` · ${t('isReplay')}` : ''}
                           {' · '}
                           {signature === 'ok' ? t('signatureOk') : t('signatureBad')}
                           {' · '}
                           {t('attemptsCount', { count: attempts(delivery) })}
                        </span>
                     </div>
                     <span className="flex items-center gap-1">
                        <Button
                           type="button"
                           size="xs"
                           variant="quiet"
                           onClick={() => void showPayload(delivery)}
                        >
                           {t('payload')}
                        </Button>
                        {canReplay ? (
                           <Button
                              type="button"
                              size="xs"
                              variant="soft"
                              disabled={blocked !== null}
                              title={blocked ? t(`replayBlocked_${blocked}`) : undefined}
                              onClick={() => void replay(delivery)}
                           >
                              {t('replay')}
                           </Button>
                        ) : null}
                     </span>
                  </li>
               );
            })}
         </ul>

         <Dialog open={open !== null} onOpenChange={(next) => !next && setOpen(null)}>
            <DialogContent className="sm:max-w-2xl">
               <DialogHeader>
                  <DialogTitle>
                     {t('payloadTitle', { event: open?.delivery.event ?? '—' })}
                  </DialogTitle>
               </DialogHeader>
               <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-[7px] border border-input bg-container p-3 font-mono">
                  {open?.payload}
               </pre>
            </DialogContent>
         </Dialog>
      </>
   );
}
