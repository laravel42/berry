'use client';

import { BerryMark } from '@/components/brand/berry-mark';
import {
   describePlanCounts,
   isPlanCompiling,
   listPlanEvents,
   type PlanEvent,
   type PlanRecord,
} from '@/lib/plans';
import { isTerminalRunStatus, loadRunsForIssues, type RunRecord } from '@/lib/runs';
import { cn } from '@/lib/utils';
import { useAgentsStore } from '@/store/agents-store';
import { useIssuesStore } from '@/store/issues-store';
import { format, parseISO } from 'date-fns';
import { useEffect, useRef, useState } from 'react';

/**
 * The tail of a started plan: what Berry did with it, as it happens.
 *
 * Once a plan is approved the interesting facts are no longer the tasks it
 * listed but what became of them — compiled, routed, and each run an agent
 * makes on them. This reads the plan's own execute events and the runs of the
 * tasks it created, lays them out oldest first like a log, and keeps reading
 * while any run is still going.
 */

/** How often the log re-reads while something is still running. */
const POLL_INTERVAL_MS = 4000;

interface LogLine {
   key: string;
   at: string;
   /** The row's subject: a task identifier, or the plan itself. */
   subject: string;
   text: string;
   tone: 'muted' | 'working' | 'done' | 'failed';
}

function clock(iso: string): string {
   try {
      return format(parseISO(iso), 'HH:mm:ss');
   } catch {
      return iso;
   }
}

function routingText(event: PlanEvent): string {
   const detail =
      typeof event.detail === 'object' && event.detail !== null
         ? (event.detail as Record<string, unknown>)
         : {};
   if (event.outcome !== 'ok') {
      const message = typeof detail.message === 'string' ? detail.message : null;
      return message
         ? `Routing ${event.outcome}: ${message}`
         : `Routing ${event.outcome === 'timeout' ? 'timed out' : 'failed'}`;
   }
   const parts: string[] = [];
   if (typeof detail.assigned === 'number') parts.push(`${detail.assigned} assigned`);
   if (typeof detail.started === 'number') parts.push(`${detail.started} started`);
   if (typeof detail.unassigned === 'number' && detail.unassigned > 0) {
      parts.push(`${detail.unassigned} unassigned`);
   }
   return parts.length > 0 ? `Routed · ${parts.join(' · ')}` : 'Routed';
}

const RUN_WORD: Record<RunRecord['status'], string> = {
   queued: 'queued',
   running: 'running',
   succeeded: 'succeeded',
   failed: 'failed',
   cancelled: 'cancelled',
};

function runTone(status: RunRecord['status']): LogLine['tone'] {
   if (status === 'running') return 'working';
   if (status === 'succeeded') return 'done';
   if (status === 'failed') return 'failed';
   return 'muted';
}

const TONE = {
   muted: 'text-muted-foreground',
   working: 'text-[var(--status-info)]',
   done: 'text-[var(--status-success)]',
   failed: 'text-destructive',
} as const;

export function PlanExecutionLog({ record }: { record: PlanRecord }) {
   const compile = record.compile;
   const issueIds = compile?.issueIds ?? [];
   const issues = useIssuesStore((state) => state.issues);
   const getAgentById = useAgentsStore((state) => state.getAgentById);
   const [runs, setRuns] = useState<RunRecord[]>([]);
   const [events, setEvents] = useState<PlanEvent[]>([]);
   const [loaded, setLoaded] = useState(false);
   const endRef = useRef<HTMLDivElement>(null);
   const following = useRef(true);
   const scroller = useRef<HTMLDivElement>(null);
   const idsKey = issueIds.join(',');
   const live = runs.length === 0 || runs.some((run) => !isTerminalRunStatus(run.status));

   useEffect(() => {
      let cancelled = false;
      const read = async () => {
         const ids = idsKey ? idsKey.split(',') : [];
         const [nextRuns, nextEvents] = await Promise.all([
            loadRunsForIssues(ids),
            listPlanEvents(record.id).catch(() => [] as PlanEvent[]),
         ]);
         if (cancelled) return;
         setRuns(nextRuns);
         setEvents(nextEvents.filter((event) => event.stage === 'execute'));
         setLoaded(true);
      };
      void read();
      if (!live) return () => void (cancelled = true);
      const timer = setInterval(() => void read(), POLL_INTERVAL_MS);
      return () => {
         cancelled = true;
         clearInterval(timer);
      };
   }, [record.id, idsKey, live]);

   const lines: LogLine[] = [];
   if (compile?.compiledAt) {
      lines.push({
         key: 'compiled',
         at: compile.compiledAt,
         subject: 'plan',
         text: `Plan started · ${describePlanCounts({
            tasks: compile.issueIds.length,
            approvals: compile.approvalIds.length,
         })} created`,
         tone: 'done',
      });
   }
   for (const event of events) {
      lines.push({
         key: `event-${event.id}`,
         at: event.occurredAt,
         subject: 'plan',
         text: routingText(event),
         tone: event.outcome === 'ok' ? 'muted' : 'failed',
      });
   }
   for (const run of runs) {
      const issue = issues.find((entry) => entry.id === run.issueId);
      const agent = getAgentById(run.agentId)?.name ?? 'agent';
      const status = RUN_WORD[run.status];
      const detail = run.failure?.message ?? run.summary;
      lines.push({
         key: `run-${run.id}`,
         at: run.completedAt ?? run.startedAt ?? run.createdAt,
         subject: issue?.identifier ?? 'task',
         text: `${agent} · ${status}${detail ? ` · ${detail}` : ''}`,
         tone: runTone(run.status),
      });
   }
   lines.sort((left, right) => left.at.localeCompare(right.at));

   // Pinned to the newest line while the reader is at the bottom; someone who
   // scrolled up to read a failure is not dragged back down on every poll.
   useEffect(() => {
      if (following.current) endRef.current?.scrollIntoView({ block: 'end' });
   }, [lines.length]);

   const onScroll = () => {
      const element = scroller.current;
      if (!element) return;
      following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 32;
   };

   return (
      <div
         role="status"
         aria-label="Plan execution log"
         className="mt-5 rounded-md border border-border/60 bg-background"
      >
         <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2.5">
            <BerryMark size="sm" tone={live ? 'working' : 'complete'} pulse={live} />
            <span className="font-medium">
               {isPlanCompiling(record) ? 'Starting the plan…' : 'Plan started'}
            </span>
            <span className="text-muted-foreground">
               · {live ? 'following the work' : 'all runs finished'}
            </span>
         </div>
         <div
            ref={scroller}
            onScroll={onScroll}
            className="max-h-72 overflow-y-auto px-4 py-2 font-mono leading-5"
         >
            {lines.length === 0 ? (
               <p className="text-muted-foreground">
                  {loaded ? 'Nothing has run yet.' : 'Reading the log…'}
               </p>
            ) : (
               <ol className="flex flex-col gap-0.5">
                  {lines.map((line) => (
                     <li key={line.key} className="flex min-w-0 gap-3">
                        <span className="shrink-0 text-muted-foreground">{clock(line.at)}</span>
                        <span className="w-20 shrink-0 truncate text-muted-foreground">
                           {line.subject}
                        </span>
                        <span className={cn('min-w-0 break-words', TONE[line.tone])}>
                           {line.text}
                        </span>
                     </li>
                  ))}
               </ol>
            )}
            <div ref={endRef} />
         </div>
      </div>
   );
}
