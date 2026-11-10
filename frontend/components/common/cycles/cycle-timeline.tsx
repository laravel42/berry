'use client';

import { breakdown, formatDay, timeline, todayIso } from '@/lib/cycle-math';
import type { Cycle } from '@/lib/cycles';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo } from 'react';

const BLOCK_LOOK: Record<Cycle['status'], { block: string; fill: string; sub: string }> = {
   active: {
      block: 'border-status-success bg-status-success/10 text-foreground',
      fill: 'bg-status-success/25',
      sub: 'text-status-success',
   },
   completed: {
      block: 'border-border bg-secondary text-muted-foreground',
      fill: 'bg-status-success/10',
      sub: 'text-subtle-foreground',
   },
   upcoming: {
      block: 'border-dashed border-muted-foreground/40 bg-transparent text-foreground',
      fill: 'bg-transparent',
      sub: 'text-subtle-foreground',
   },
};

/** Every cycle laid along the calendar, today marked, each block filled by its done share. */
export function CycleTimeline({
   cycles,
   hrefFor,
}: {
   cycles: Cycle[];
   hrefFor: (cycle: Cycle) => string;
}) {
   const t = useTranslations('cycles.timeline');
   const locale = useLocale();
   const today = todayIso();
   const axis = useMemo(() => timeline(cycles, today, locale), [cycles, today, locale]);
   if (!axis) return null;

   return (
      <section
         className="overflow-hidden rounded-[10px] bg-accent"
         aria-labelledby="cycles-timeline"
      >
         <div className="flex items-center gap-2 px-4 pt-3 pb-2.5">
            <h2 id="cycles-timeline">{t('title')}</h2>
            <span className="ml-auto whitespace-nowrap text-subtle-foreground">
               {formatDay(axis.startsOn, locale)} → {formatDay(axis.endsOn, locale)}
            </span>
         </div>
         <div className="overflow-x-auto border-t">
            <div className="flex min-w-[480px] flex-col gap-2 px-4 pt-[18px] pb-3.5">
               <div className="relative h-[60px]">
                  {axis.blocks.map(({ cycle, left, width }) => {
                     const look = BLOCK_LOOK[cycle.status];
                     const progress = breakdown(cycle.progress);
                     return (
                        <Link
                           key={cycle.id}
                           href={hrefFor(cycle)}
                           className="absolute inset-y-0 px-0.5 outline-none focus-visible:[&>span]:ring-2 focus-visible:[&>span]:ring-ring"
                           style={{ left: `${left}%`, width: `${width}%` }}
                        >
                           <span
                              className={cn(
                                 'relative flex h-full flex-col justify-center gap-0.5 overflow-hidden rounded-[7px] border px-2.5 transition-[filter] hover:brightness-110',
                                 look.block
                              )}
                           >
                              <span
                                 aria-hidden
                                 className={cn('absolute inset-y-0 left-0', look.fill)}
                                 style={{
                                    width:
                                       cycle.status === 'upcoming' ? 0 : `${progress.donePercent}%`,
                                 }}
                              />
                              <span className="relative truncate font-semibold">{cycle.name}</span>
                              <span
                                 data-heading="label"
                                 className={cn('relative truncate font-[400]', look.sub)}
                              >
                                 {cycle.status === 'upcoming'
                                    ? t('tasks', { count: progress.total })
                                    : t('percentDone', { percent: progress.donePercent })}
                              </span>
                           </span>
                        </Link>
                     );
                  })}
                  {axis.today !== null ? (
                     <>
                        <span
                           aria-hidden
                           className="absolute -top-2 -ml-px h-1.5 w-0.5 rounded-[1px] bg-primary"
                           style={{ left: `${axis.today}%` }}
                        />
                        <span
                           aria-hidden
                           className="absolute -bottom-2 -ml-px h-1.5 w-0.5 rounded-[1px] bg-primary"
                           style={{ left: `${axis.today}%` }}
                        />
                     </>
                  ) : null}
               </div>
               <div data-heading="label" className="relative h-4 font-[400] text-subtle-foreground">
                  {axis.ticks.map((tick) => (
                     <span
                        key={`${tick.left}-${tick.month}`}
                        className="absolute top-0 whitespace-nowrap border-l border-muted-foreground/30 pl-1.5"
                        style={{ left: `${tick.left}%` }}
                     >
                        {tick.month}
                     </span>
                  ))}
                  {axis.today !== null ? (
                     <span
                        className="absolute top-0 -translate-x-1/2 whitespace-nowrap bg-accent px-1 font-semibold text-primary-text"
                        style={{ left: `${axis.today}%` }}
                     >
                        {t('today')}
                     </span>
                  ) : null}
               </div>
            </div>
         </div>
      </section>
   );
}
