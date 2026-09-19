'use client';

import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { readableModelName } from '@/components/common/agents/model-name';
import { SegmentedControl } from '@/components/common/segmented-control';
import {
   formatCost,
   formatDuration,
   formatTokens,
   getWorkspaceUsage,
   usageQueryKey,
   weeklyBuckets,
   type UsageQuery,
} from '@/lib/usage';
import { useSessionStore } from '@/store/session-store';

import { UsageBreakdownTable } from './usage-breakdown-table';
import { UsageDailyChart, type UsageMetric } from './usage-daily-chart';
import { UrgencyBand, UrgencyFigures } from './usage-urgency-band';
import { useUsage } from './use-usage';

const METRICS: UsageMetric[] = ['cost', 'tokens', 'calls'];

/**
 * Spend as an urgency stack: cost leads, trend next, then a continuous ledger
 * of who and what spent it — not a grid of equal tiles.
 */
export default function UsageOverview({
   query,
   onState,
}: {
   query: UsageQuery;
   onState?: (state: { lastUpdated: Date | null; loading: boolean; reload: () => void }) => void;
}) {
   const t = useTranslations('areas.usage');
   const { orgId } = useParams<{ orgId: string }>();
   const workspaceId = useSessionStore((state) => state.workspace?.id ?? null);
   const [metric, setMetric] = useState<UsageMetric>('cost');
   const [grain, setGrain] = useState<'daily' | 'weekly'>('daily');

   const { data, error, loading, lastUpdated, reload } = useUsage(
      workspaceId ? () => getWorkspaceUsage(workspaceId, query) : null,
      `${workspaceId}:${usageQueryKey(query)}`
   );
   useEffect(() => {
      onState?.({ lastUpdated, loading, reload });
   }, [onState, lastUpdated, loading, reload]);

   if (error) return <p className="px-6 py-8 text-muted-foreground">{error}</p>;
   if (!data) return <p className="px-6 py-8 text-muted-foreground">{t('loading')}</p>;

   const points = grain === 'weekly' ? weeklyBuckets(data.daily) : data.daily;
   const totals = data.totals;
   const runs = data.runs;

   return (
      <div className="flex flex-col gap-6 px-6 py-6">
         <UrgencyBand
            tone="info"
            label={t('tiles.cost')}
            value={formatCost(totals.costMicros)}
            hint={
               totals.unpricedEvents > 0
                  ? t('tiles.unpriced', {
                       unpriced: totals.unpricedEvents,
                       events: totals.events,
                    })
                  : undefined
            }
         >
            <UrgencyFigures
               items={[
                  {
                     label: t('tiles.tokens'),
                     value: formatTokens(totals.inputTokens + totals.outputTokens),
                  },
                  {
                     label: t('tiles.cache'),
                     value: `${formatTokens(totals.cacheReadTokens)} / ${formatTokens(totals.cacheWriteTokens)}`,
                  },
                  ...(runs
                     ? [
                          { label: t('tiles.runs'), value: String(runs.runs) },
                          {
                             label: t('tiles.runTime'),
                             value: formatDuration(runs.runSeconds),
                          },
                       ]
                     : []),
               ]}
            />
         </UrgencyBand>

         <section className="flex flex-col gap-3 border-t border-border/60 pt-6">
            <div className="flex flex-wrap items-center gap-2">
               <h2 className="mr-auto font-medium">{t('chart.title')}</h2>
               <SegmentedControl
                  aria-label={t('chart.metricLabel')}
                  value={metric}
                  onValueChange={setMetric}
                  options={METRICS.map((option) => ({
                     value: option,
                     label: t(`chart.metric_${option}`),
                  }))}
               />
               <SegmentedControl
                  aria-label={t('chart.grainLabel')}
                  value={grain}
                  onValueChange={setGrain}
                  options={(['daily', 'weekly'] as const).map((option) => ({
                     value: option,
                     label: t(`chart.${option}`),
                  }))}
               />
            </div>
            <UsageDailyChart points={points} metric={metric} />
         </section>

         <div className="grid gap-8 border-t border-border/60 pt-6 lg:grid-cols-2">
            <UsageBreakdownTable
               title={t('leaderboard.agents')}
               ranked
               rows={data.byAgent.map((row) => ({
                  id: row.key,
                  label: row.agentName,
                  href: `/${orgId}/agents/${row.key}`,
                  bucket: row,
               }))}
            />
            <UsageBreakdownTable
               title={t('leaderboard.models')}
               ranked
               rows={data.byModel.map((row) => ({
                  id: row.key,
                  label: readableModelName(row.key),
                  title: row.key,
                  bucket: row,
               }))}
            />
         </div>
      </div>
   );
}
