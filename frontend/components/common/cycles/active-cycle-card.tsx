'use client';

import { BurnUpChart, ProgressRing, ProgressStats } from '@/components/common/cycles/cycle-visuals';
import {
   addDays,
   breakdown,
   burnUp,
   cycleDay,
   cycleLength,
   daysBetween,
   formatDay,
   formatRange,
   isWeekend,
   progressFromIssues,
   todayIso,
} from '@/lib/cycle-math';
import type { Cycle, CycleIssueRef } from '@/lib/cycles';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';

/**
 * The cycle under way: how far through it the calendar is, how far the work
 * is, and the burn-up of the two. The whole card opens the cycle.
 */
export function ActiveCycleCard({
   cycle,
   issues,
   href,
}: {
   cycle: Cycle;
   /** Undefined while the tasks are still loading: the counts then come from the cycle. */
   issues: CycleIssueRef[] | undefined;
   href: string;
}) {
   const t = useTranslations('cycles.active');
   const locale = useLocale();
   const today = todayIso();
   const length = cycleLength(cycle);
   const day = cycleDay(cycle, today);
   const left = daysBetween(today, cycle.endsOn);
   const progress = breakdown(issues ? progressFromIssues(issues) : cycle.progress);
   const chart = burnUp(cycle, issues ?? [], today);

   const remaining =
      left < 0 ? t('overdue') : left === 0 ? t('endsToday') : t('daysLeft', { count: left });

   return (
      <section className="overflow-hidden rounded-[10px] bg-accent" aria-labelledby="cycles-active">
         <div className="flex items-center gap-2 px-4 pt-3 pb-2.5">
            <span aria-hidden className="size-2 rounded-full bg-status-success" />
            <h2 id="cycles-active">{t('title')}</h2>
            <span
               className={cn(
                  'ml-auto whitespace-nowrap',
                  left < 0 ? 'text-status-warning' : 'text-subtle-foreground'
               )}
            >
               {remaining}
            </span>
         </div>
         <Link
            href={href}
            aria-label={t('open', { name: cycle.name })}
            className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] items-center gap-x-8 gap-y-5 border-t px-4 py-[18px] outline-none transition-colors hover:bg-secondary/50 focus-visible:bg-secondary/50"
         >
            <div className="flex min-w-0 flex-col gap-[18px]">
               <div className="flex min-w-0 items-center gap-4">
                  <ProgressRing progress={progress} />
                  <div className="flex min-w-0 flex-col gap-1">
                     <span data-figure="sm" className="truncate font-semibold">
                        {cycle.name}
                     </span>
                     <span className="text-muted-foreground">{formatRange(cycle, locale)}</span>
                     <span className="text-subtle-foreground">{t('dayOf', { day, length })}</span>
                  </div>
               </div>
               <div className="flex flex-wrap gap-[3px]" aria-hidden>
                  {Array.from({ length }, (_, index) => {
                     const date = addDays(cycle.startsOn, index);
                     const past = index + 1 < day;
                     const now = index + 1 === day && left >= 0;
                     const weekend = isWeekend(date);
                     return (
                        <span
                           key={date}
                           title={formatDay(date, locale)}
                           className={cn(
                              'h-[18px] min-w-2.5 flex-1 rounded-[3px]',
                              now
                                 ? 'bg-primary'
                                 : past || left < 0
                                   ? 'bg-muted-foreground/35'
                                   : weekend
                                     ? 'bg-transparent ring-1 ring-inset ring-border'
                                     : 'bg-secondary'
                           )}
                        />
                     );
                  })}
               </div>
               <ProgressStats progress={progress} />
            </div>
            <BurnUpChart
               chart={chart}
               startLabel={formatDay(cycle.startsOn, locale)}
               endLabel={formatDay(cycle.endsOn, locale)}
            />
         </Link>
      </section>
   );
}
