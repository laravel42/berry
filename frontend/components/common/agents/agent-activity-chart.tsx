'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';

import { UsageDailyChart } from '@/components/common/usage/usage-daily-chart';
import type { AgentRoster } from '@/lib/agents';
import type { UsageBucket } from '@/lib/usage';
import { cn } from '@/lib/utils';

const DAYS = 30;

function emptyBucket(key: string, events: number): UsageBucket {
   return {
      key,
      events,
      unpricedEvents: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costMicros: 0,
   };
}

/**
 * Contiguous 30-day calendar window ending today (UTC). Quiet days stay in
 * the series so the chart keeps a fixed number of columns.
 */
function seriesForMonth(activity: AgentRoster['activity']): {
   points: UsageBucket[];
   runs: number;
   failed: number;
} {
   const byDay = new Map(activity.map((point) => [point.day, point]));
   const end = new Date();
   const points: UsageBucket[] = [];
   let runs = 0;
   let failed = 0;
   for (let offset = DAYS - 1; offset >= 0; offset -= 1) {
      const date = new Date(
         Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() - offset)
      );
      const day = date.toISOString().slice(0, 10);
      const point = byDay.get(day);
      const dayRuns = point?.runs ?? 0;
      const dayFailed = point?.failed ?? 0;
      runs += dayRuns;
      failed += dayFailed;
      points.push(emptyBucket(day, dayRuns));
   }
   return { points, runs, failed };
}

/**
 * Agent run trend over the last 30 days — same chart as the usage overview.
 */
export function AgentActivityChart({
   activity,
   className,
}: {
   activity: AgentRoster['activity'] | undefined;
   className?: string;
}) {
   const t = useTranslations('agentsChat.detail');

   const { points, runs, failed } = useMemo(() => seriesForMonth(activity ?? []), [activity]);

   return (
      <section className={cn('flex flex-col gap-2', className)}>
         <h2 className="font-medium">{t('overviewStats')}</h2>
         <p className="tabular-nums text-muted-foreground">
            {runs === 0 ? t('activityChartEmpty') : t('activityChartSummary', { runs, failed })}
         </p>
         <UsageDailyChart points={points} metric="calls" />
      </section>
   );
}
