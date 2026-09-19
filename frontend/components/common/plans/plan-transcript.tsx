'use client';

import { ScrollText } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { readableModelName } from '@/components/common/agents/model-name';
import { LogStatusBadge, PromptLogSheet } from '@/components/common/logs/prompt-logs';
import { Button } from '@/components/ui/button';
import {
   Sheet,
   SheetContent,
   SheetDescription,
   SheetHeader,
   SheetTitle,
} from '@/components/ui/sheet';
import { formatMs, listPromptLogs, type PromptLogSummary } from '@/lib/logs';
import { isPlanGenerating, listPlanEvents, type PlanEvent, type PlanRecord } from '@/lib/plans';
import { timeAgo } from '@/lib/time-ago';
import { formatTokens } from '@/lib/usage';

/** How often the transcript re-reads while the planner is still working. */
const POLL_INTERVAL_MS = 3000;

const STAGE_LABEL: Record<string, string> = {
   generate: 'Drafted the plan',
   repair: 'Repaired the plan',
   critic: 'Reviewed the plan',
};

/** What a stage's detail says about the document it produced, in words. */
function stageDetail(event: PlanEvent): string | null {
   const detail = event.detail;
   if (typeof detail !== 'object' || detail === null) return null;
   const record = detail as Record<string, unknown>;
   const parts: string[] = [];
   if (typeof record.validation === 'string') parts.push(`validation ${record.validation}`);
   if (typeof record.errors === 'number' && record.errors > 0) {
      parts.push(record.errors === 1 ? '1 error' : `${record.errors} errors`);
   }
   if (typeof record.verdict === 'string') parts.push(`verdict ${record.verdict}`);
   if (typeof record.error === 'string') parts.push(record.error);
   if (typeof record.message === 'string') parts.push(record.message);
   return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * The Transcript button and the sheet it opens.
 *
 * A plan is several model calls — a draft, repairs, a review — and until now
 * the only trace of them was the outcome. The sheet lists each stage the
 * pipeline recorded, then every model call it made for this plan, newest
 * first; a call opens in the same view the Logs page uses, prompt and answer
 * whole. While the planner is working it re-reads on a timer, so the calls
 * appear as they are made rather than after the plan lands.
 */
export function PlanTranscript({ record }: { record: PlanRecord }) {
   const [open, setOpen] = useState(false);
   return (
      <>
         <Button size="xs" variant="secondary" onClick={() => setOpen(true)}>
            <ScrollText className="size-4" />
            Transcript
         </Button>
         {open && <PlanTranscriptSheet record={record} onClose={() => setOpen(false)} />}
      </>
   );
}

function PlanTranscriptSheet({ record, onClose }: { record: PlanRecord; onClose: () => void }) {
   const [events, setEvents] = useState<PlanEvent[]>([]);
   const [calls, setCalls] = useState<PromptLogSummary[]>([]);
   const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
   const [openCall, setOpenCall] = useState<string | null>(null);
   const generating = isPlanGenerating(record);

   const load = useCallback(async () => {
      try {
         const [stages, page] = await Promise.all([
            listPlanEvents(record.id),
            listPromptLogs(record.workspaceId, {
               kind: 'completion',
               status: null,
               purpose: null,
               structured: null,
               planId: record.id,
            }),
         ]);
         setEvents(stages);
         setCalls(page.nodes);
         setState('ready');
      } catch {
         setState((previous) => (previous === 'ready' ? previous : 'failed'));
      }
   }, [record.id, record.workspaceId]);

   useEffect(() => {
      void load();
   }, [load, record.version, record.generation.status]);

   useEffect(() => {
      if (!generating) return;
      const timer = setInterval(() => void load(), POLL_INTERVAL_MS);
      return () => clearInterval(timer);
   }, [generating, load]);

   return (
      <>
         <Sheet open onOpenChange={(next) => !next && onClose()}>
            <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-xl">
               <SheetHeader className="border-b">
                  <SheetTitle>Plan transcript</SheetTitle>
                  <SheetDescription>
                     {generating
                        ? 'Berry is planning. Model calls appear here as they are made.'
                        : 'Each planning step and the model call behind it.'}
                  </SheetDescription>
               </SheetHeader>

               <div className="flex flex-col gap-6 p-4">
                  {state === 'loading' && <p className="text-muted-foreground">Loading…</p>}
                  {state === 'failed' && (
                     <p role="alert" className="text-muted-foreground">
                        The transcript could not be loaded.
                     </p>
                  )}

                  {record.generation.error && (
                     <section className="flex flex-col gap-1.5">
                        <h3 className="font-medium">Why it stopped</h3>
                        <p className="rounded-md border border-destructive/40 px-3 py-2 font-mono text-destructive">
                           {record.generation.error}
                        </p>
                     </section>
                  )}

                  {state === 'ready' && (
                     <section className="flex flex-col gap-1.5">
                        <h3 className="font-medium">Planning steps</h3>
                        {events.length === 0 ? (
                           <p className="text-muted-foreground">
                              {generating
                                 ? 'Steps are recorded when this round of planning ends.'
                                 : 'No steps were recorded for this plan.'}
                           </p>
                        ) : (
                           <ol className="flex flex-col divide-y rounded-md border">
                              {events.map((event) => (
                                 <li key={event.id} className="flex flex-col gap-0.5 px-3 py-2">
                                    <div className="flex items-center justify-between gap-3">
                                       <span className="font-medium">
                                          {STAGE_LABEL[event.stage] ?? event.stage}
                                       </span>
                                       <span
                                          className={
                                             event.outcome === 'ok'
                                                ? 'text-muted-foreground'
                                                : 'text-destructive'
                                          }
                                       >
                                          {event.outcome}
                                       </span>
                                    </div>
                                    <span className="text-muted-foreground">
                                       {[
                                          event.modelName
                                             ? readableModelName(event.modelName)
                                             : null,
                                          event.durationMs != null
                                             ? formatMs(event.durationMs)
                                             : null,
                                          event.inputTokens != null && event.outputTokens != null
                                             ? `${formatTokens(event.inputTokens)} in · ${formatTokens(event.outputTokens)} out`
                                             : null,
                                          stageDetail(event),
                                       ]
                                          .filter(Boolean)
                                          .join(' · ')}
                                    </span>
                                 </li>
                              ))}
                           </ol>
                        )}
                     </section>
                  )}

                  {state === 'ready' && (
                     <section className="flex flex-col gap-1.5">
                        <h3 className="font-medium">Model calls</h3>
                        {calls.length === 0 ? (
                           <p className="text-muted-foreground">
                              No model calls are recorded for this plan. Plans made before
                              transcripts existed have none.
                           </p>
                        ) : (
                           <ul className="flex flex-col divide-y rounded-md border">
                              {calls.map((call) => (
                                 <li key={call.id}>
                                    <button
                                       type="button"
                                       onClick={() => setOpenCall(call.id)}
                                       className="flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-accent/50"
                                    >
                                       <span className="flex items-center justify-between gap-3">
                                          <span className="truncate font-medium">
                                             {call.purpose}
                                          </span>
                                          <LogStatusBadge status={call.status} />
                                       </span>
                                       <span className="truncate text-muted-foreground">
                                          {[
                                             call.model ? readableModelName(call.model) : null,
                                             call.durationMs !== null
                                                ? formatMs(call.durationMs)
                                                : null,
                                             timeAgo(call.createdAt),
                                             call.failureCode,
                                          ]
                                             .filter(Boolean)
                                             .join(' · ')}
                                       </span>
                                    </button>
                                 </li>
                              ))}
                           </ul>
                        )}
                     </section>
                  )}
               </div>
            </SheetContent>
         </Sheet>
         <PromptLogSheet
            workspaceId={record.workspaceId}
            runId={openCall}
            onClose={() => setOpenCall(null)}
         />
      </>
   );
}
