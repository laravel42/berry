'use client';

import { MiniRing, TaskStrip } from '@/components/common/cycles/cycle-visuals';
import { breakdown, cycleLength, formatRange } from '@/lib/cycle-math';
import type { Cycle, CycleIssueRef } from '@/lib/cycles';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';

const COLUMNS =
   'grid grid-cols-[16px_minmax(100px,1fr)_minmax(170px,1.2fr)_56px_minmax(140px,1.3fr)_44px] items-center gap-3 min-w-[680px] px-4';

const DOT: Record<Cycle['status'], string> = {
   upcoming: 'bg-transparent ring-[1.5px] ring-inset ring-muted-foreground',
   active: 'bg-status-success',
   completed: 'bg-subtle-foreground',
};

/** One status's cycles as a table: dates, length, a mark per task, done share. */
export function CycleGroup({
   status,
   cycles,
   issuesByCycle,
   hrefFor,
}: {
   status: Cycle['status'];
   cycles: Cycle[];
   issuesByCycle: Record<string, CycleIssueRef[]>;
   hrefFor: (cycle: Cycle) => string;
}) {
   const t = useTranslations('cycles');
   const locale = useLocale();
   const headingId = `cycles-group-${status}`;

   return (
      <section
         className="overflow-x-auto overflow-y-hidden rounded-[10px] bg-accent"
         aria-labelledby={headingId}
      >
         <div className="flex items-center gap-2 px-4 pt-3 pb-2.5">
            <span aria-hidden className={cn('size-2 rounded-full', DOT[status])} />
            <h2 id={headingId}>{t(`status.${status}`)}</h2>
            <span className="text-subtle-foreground">{cycles.length}</span>
         </div>
         <div role="table" aria-labelledby={headingId}>
            <div
               role="row"
               data-heading="label"
               className={cn(COLUMNS, 'h-8 border-t text-subtle-foreground')}
            >
               <span role="columnheader" aria-hidden />
               <span role="columnheader">{t('list.name')}</span>
               <span role="columnheader">{t('list.dates')}</span>
               <span role="columnheader" className="text-right">
                  {t('list.length')}
               </span>
               <span role="columnheader">{t('list.tasks')}</span>
               <span role="columnheader" className="text-right">
                  {t('list.done')}
               </span>
            </div>
            {cycles.map((cycle) => {
               const progress = breakdown(cycle.progress);
               const issues = issuesByCycle[cycle.id] ?? [];
               return (
                  <Link
                     key={cycle.id}
                     role="row"
                     href={hrefFor(cycle)}
                     className={cn(
                        COLUMNS,
                        'h-12 border-t outline-none transition-colors hover:bg-secondary/50 focus-visible:bg-secondary/50'
                     )}
                  >
                     <span role="cell">
                        <MiniRing percent={progress.donePercent} />
                     </span>
                     <span role="cell" className="truncate font-semibold">
                        {cycle.name}
                     </span>
                     <span role="cell" className="whitespace-nowrap text-muted-foreground">
                        {formatRange(cycle, locale)}
                     </span>
                     <span role="cell" className="text-right text-muted-foreground tabular-nums">
                        {t('list.weeks', {
                           count: Math.max(1, Math.round(cycleLength(cycle) / 7)),
                        })}
                     </span>
                     <span role="cell" className="min-w-0">
                        {issues.length > 0 ? (
                           <TaskStrip issues={issues} />
                        ) : (
                           <span className="text-subtle-foreground tabular-nums">
                              {progress.total}
                           </span>
                        )}
                     </span>
                     <span role="cell" className="text-right text-muted-foreground tabular-nums">
                        {progress.donePercent}%
                     </span>
                  </Link>
               );
            })}
         </div>
      </section>
   );
}
