'use client';

import { BURNUP_HEIGHT, BURNUP_WIDTH, type BurnUp, type ProgressBreakdown } from '@/lib/cycle-math';
import type { CycleIssueRef } from '@/lib/cycles';
import { cn } from '@/lib/utils';
import { useTranslations } from 'next-intl';

/**
 * The drawings the cycle pages share: the progress ring, the burn-up chart,
 * the counts under them and the one-mark-per-task strip. Colours are status
 * tokens throughout, so both themes read the same.
 */

/** API `IssueStatus` → the background class of its mark. */
const STATUS_FILL: Record<string, string> = {
   backlog: 'bg-subtle-foreground/45',
   todo: 'bg-muted-foreground',
   inProgress: 'bg-status-info',
   inReview: 'bg-status-warning',
   blocked: 'bg-status-warning',
   done: 'bg-status-success',
   cancelled: 'bg-subtle-foreground/70',
};

export function statusFill(status: string): string {
   return STATUS_FILL[status] ?? 'bg-muted-foreground';
}

const TASK_STATUSES = [
   'backlog',
   'todo',
   'inProgress',
   'inReview',
   'blocked',
   'done',
   'cancelled',
] as const;

function isTaskStatus(value: string): value is (typeof TASK_STATUSES)[number] {
   return (TASK_STATUSES as readonly string[]).includes(value);
}

/** The translated name of an API `IssueStatus`. */
export function useTaskStatusName(): (status: string) => string {
   const t = useTranslations('cycles.taskStatus');
   return (status) => (isTaskStatus(status) ? t(status) : status);
}

const RING_RADIUS = 27;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** Done in green over done-or-started in blue, the done share in the middle. */
export function ProgressRing({
   progress,
   size = 72,
}: {
   progress: ProgressBreakdown;
   size?: number;
}) {
   const offset = (percent: number) => (RING_CIRCUMFERENCE * (1 - percent / 100)).toFixed(2);
   return (
      <div className="relative shrink-0" style={{ width: size, height: size }}>
         <svg
            width={size}
            height={size}
            viewBox="0 0 64 64"
            role="img"
            aria-label={`${progress.donePercent}%`}
         >
            <circle
               cx="32"
               cy="32"
               r={RING_RADIUS}
               className="stroke-secondary"
               strokeWidth="6"
               fill="none"
            />
            <circle
               cx="32"
               cy="32"
               r={RING_RADIUS}
               className="stroke-status-info"
               strokeWidth="6"
               fill="none"
               strokeDasharray={RING_CIRCUMFERENCE.toFixed(2)}
               strokeDashoffset={offset(progress.startedPercent)}
               transform="rotate(-90 32 32)"
            />
            <circle
               cx="32"
               cy="32"
               r={RING_RADIUS}
               className="stroke-status-success"
               strokeWidth="6"
               fill="none"
               strokeDasharray={RING_CIRCUMFERENCE.toFixed(2)}
               strokeDashoffset={offset(progress.donePercent)}
               transform="rotate(-90 32 32)"
            />
         </svg>
         <span
            data-heading="h2"
            className="absolute inset-0 flex items-center justify-center tabular-nums"
         >
            {progress.donePercent}%
         </span>
      </div>
   );
}

/** The 16px ring a table row or assignee line carries. */
export function MiniRing({ percent, size = 14 }: { percent: number; size?: number }) {
   const radius = 6;
   const circumference = 2 * Math.PI * radius;
   const clamped = Math.max(0, Math.min(100, percent));
   return (
      <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden className="shrink-0">
         <circle
            cx="8"
            cy="8"
            r={radius}
            className="stroke-secondary"
            strokeWidth="2"
            fill="none"
         />
         <circle
            cx="8"
            cy="8"
            r={radius}
            className="stroke-status-success"
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
            strokeDasharray={circumference.toFixed(2)}
            strokeDashoffset={(circumference * (1 - clamped / 100)).toFixed(2)}
            transform="rotate(-90 8 8)"
         />
      </svg>
   );
}

function LegendSwatch({ className }: { className: string }) {
   return <span aria-hidden className={cn('shrink-0', className)} />;
}

/** Done against scope and the ideal line, with today marked. */
export function BurnUpChart({
   chart,
   startLabel,
   endLabel,
}: {
   chart: BurnUp;
   startLabel: string;
   endLabel: string;
}) {
   const t = useTranslations('cycles.chart');
   return (
      <figure className="flex min-w-0 flex-col gap-2">
         <div className="relative h-[150px]">
            <svg
               viewBox={`0 0 ${BURNUP_WIDTH} ${BURNUP_HEIGHT}`}
               preserveAspectRatio="none"
               role="img"
               aria-label={t('label')}
               className="absolute inset-0 size-full overflow-visible"
            >
               <path
                  d={`M0 0H${BURNUP_WIDTH}M0 40H${BURNUP_WIDTH}M0 80H${BURNUP_WIDTH}M0 ${BURNUP_HEIGHT}H${BURNUP_WIDTH}`}
                  className="stroke-border"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                  fill="none"
               />
               {chart.area ? <path d={chart.area} className="fill-status-success/15" /> : null}
               <path
                  d={chart.ideal}
                  className="stroke-subtle-foreground/70"
                  strokeWidth="1.5"
                  strokeDasharray="4 4"
                  vectorEffect="non-scaling-stroke"
                  fill="none"
               />
               <path
                  d={chart.scope}
                  className="stroke-muted-foreground"
                  strokeWidth="1.5"
                  vectorEffect="non-scaling-stroke"
                  fill="none"
               />
               {chart.done ? (
                  <path
                     d={chart.done}
                     className="stroke-status-success"
                     strokeWidth="2.5"
                     strokeLinejoin="round"
                     vectorEffect="non-scaling-stroke"
                     fill="none"
                  />
               ) : null}
               {chart.today ? (
                  <path
                     d={chart.today}
                     className="stroke-primary"
                     strokeWidth="1.5"
                     vectorEffect="non-scaling-stroke"
                     fill="none"
                  />
               ) : null}
            </svg>
         </div>
         <figcaption
            data-heading="label"
            className="flex flex-wrap items-center gap-x-3.5 gap-y-1 font-[400] text-subtle-foreground"
         >
            <span className="whitespace-nowrap">{startLabel}</span>
            <span className="ml-auto flex items-center gap-1.5 whitespace-nowrap">
               <LegendSwatch className="h-0.5 w-2.5 bg-status-success" />
               {t('done')}
            </span>
            <span className="flex items-center gap-1.5 whitespace-nowrap">
               <LegendSwatch className="h-0.5 w-2.5 bg-muted-foreground" />
               {t('scope')}
            </span>
            <span className="flex items-center gap-1.5 whitespace-nowrap">
               <LegendSwatch className="h-0 w-2.5 border-t-2 border-dashed border-subtle-foreground/70" />
               {t('ideal')}
            </span>
            <span className="flex items-center gap-1.5 whitespace-nowrap">
               <LegendSwatch className="h-2.5 w-0.5 bg-primary" />
               {t('today')}
            </span>
            <span className="ml-auto whitespace-nowrap">{endLabel}</span>
         </figcaption>
      </figure>
   );
}

/** Done, in progress, not started — and cancelled where there is room. */
export function ProgressStats({
   progress,
   withCancelled = false,
}: {
   progress: ProgressBreakdown;
   withCancelled?: boolean;
}) {
   const t = useTranslations('cycles.stats');
   const stats: {
      key: 'done' | 'inProgress' | 'notStarted' | 'cancelled';
      value: number;
      dot: string;
   }[] = [
      { key: 'done', value: progress.done, dot: 'bg-status-success' },
      { key: 'inProgress', value: progress.working, dot: 'bg-status-info' },
      { key: 'notStarted', value: progress.notStarted, dot: 'bg-muted-foreground' },
   ];
   if (withCancelled) {
      stats.push({ key: 'cancelled', value: progress.cancelled, dot: 'bg-subtle-foreground/45' });
   }
   return (
      <dl
         className={cn('grid gap-3', withCancelled ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3')}
      >
         {stats.map((stat) => (
            <div key={stat.key} className="flex min-w-0 flex-col gap-0.5">
               <dt
                  data-heading="label"
                  className="flex items-center gap-1.5 whitespace-nowrap font-[400] text-subtle-foreground"
               >
                  <span aria-hidden className={cn('size-1.5 rounded-full', stat.dot)} />
                  {t(stat.key)}
               </dt>
               <dd data-heading="h1" className="tabular-nums">
                  {stat.value}
               </dd>
            </div>
         ))}
      </dl>
   );
}

/** One mark per task, coloured by status, in task order. */
export function TaskStrip({ issues }: { issues: CycleIssueRef[] }) {
   const statusName = useTaskStatusName();
   return (
      <span className="flex min-w-0 gap-[3px] overflow-hidden">
         {issues.map((issue) => (
            <span
               key={issue.id}
               title={`${issue.identifier} · ${statusName(issue.status)}`}
               className={cn('h-3.5 w-2.5 shrink-0 rounded-[2px]', statusFill(issue.status))}
            />
         ))}
      </span>
   );
}
