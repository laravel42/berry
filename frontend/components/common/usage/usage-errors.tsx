'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { EmptyStateLoading } from '@/components/common/empty-state';
import { SegmentedControl } from '@/components/common/segmented-control';
import { getUsageErrors, usageQueryKey, type UsageQuery } from '@/lib/usage';
import { useSessionStore } from '@/store/session-store';

import { UrgencyBand, UrgencyFigures } from './usage-urgency-band';
import { useUsage } from './use-usage';

/** Below this, a rate says more about luck than about an agent. */
const LOW_SAMPLE = 10;

function percent(part: number, whole: number): string {
   if (whole === 0) return '0%';
   return `${Math.round((part / whole) * 100)}%`;
}

/** Run outcomes, bottom of the stack first, each in its status tone. */
const OUTCOMES = [
   { key: 'succeeded', color: 'var(--status-success)' },
   { key: 'failed', color: 'var(--status-danger)' },
   { key: 'cancelled', color: 'var(--status-neutral)' },
] as const;

/**
 * Runs as an urgency stack: failures lead, outcomes chart next, then whose
 * they were — not a six-tile metric wall.
 */
export default function UsageErrors({
   query,
   onState,
}: {
   query: UsageQuery;
   onState?: (state: { lastUpdated: Date | null; loading: boolean; reload: () => void }) => void;
}) {
   const t = useTranslations('areas.usage.errors');
   const { orgId } = useParams<{ orgId: string }>();
   const workspaceId = useSessionStore((state) => state.workspace?.id ?? null);
   const [rank, setRank] = useState<'count' | 'rate'>('count');

   const { data, error, loading, lastUpdated, reload } = useUsage(
      workspaceId ? () => getUsageErrors(workspaceId, query) : null,
      `errors:${workspaceId}:${usageQueryKey(query)}`
   );
   useEffect(() => {
      onState?.({ lastUpdated, loading, reload });
   }, [onState, lastUpdated, loading, reload]);

   if (error) return <p className="px-6 py-8 text-muted-foreground">{error}</p>;
   if (!data) return <EmptyStateLoading label={t('loading')} />;

   const offenders = [...data.offenders].sort((left, right) =>
      rank === 'count'
         ? right.failed - left.failed
         : right.failed / Math.max(1, right.total) - left.failed / Math.max(1, left.total)
   );
   const thin = offenders.some((row) => row.total < LOW_SAMPLE);

   return (
      <div className="flex flex-col gap-6 px-6 py-6">
         <UrgencyBand
            tone={data.failedRuns > 0 ? 'danger' : 'success'}
            label={t('failedRuns')}
            value={data.failedRuns}
            hint={data.failedRuns === 0 ? t('empty') : undefined}
         >
            <UrgencyFigures
               items={[
                  { label: t('failureRate'), value: percent(data.failedRuns, data.totalRuns) },
                  { label: t('totalRuns'), value: String(data.totalRuns) },
                  { label: t('succeededRuns'), value: String(data.succeededRuns) },
                  { label: t('cancelledRuns'), value: String(data.cancelledRuns) },
                  { label: t('agentsAffected'), value: String(data.agentsAffected) },
               ]}
            />
         </UrgencyBand>

         <section className="flex flex-col gap-3 border-t border-border/60 pt-6">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
               <h2 className="mr-auto font-medium">{t('chart')}</h2>
               <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
                  {OUTCOMES.map((outcome) => (
                     <li key={outcome.key} className="flex items-center gap-1.5">
                        <span
                           aria-hidden
                           className="size-2 rounded-[2px]"
                           style={{ backgroundColor: outcome.color }}
                        />
                        {t(`legend_${outcome.key}`)}
                     </li>
                  ))}
               </ul>
            </div>
            <div className="h-48 w-full text-foreground/70">
               <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                     data={data.daily.map((row) => ({ ...row, key: row.day.slice(5) }))}
                     margin={{ top: 4, right: 4, bottom: 0, left: 4 }}
                  >
                     <XAxis
                        dataKey="key"
                        tickLine={false}
                        axisLine={false}
                        fontSize={11}
                        minTickGap={12}
                     />
                     <YAxis hide allowDecimals={false} />
                     <Tooltip
                        cursor={{ fillOpacity: 0.08 }}
                        contentStyle={{
                           background: 'var(--popover)',
                           border: '1px solid var(--border)',
                           borderRadius: 6,
                           fontSize: 12,
                           color: 'var(--popover-foreground)',
                        }}
                        itemStyle={{ color: 'var(--popover-foreground)' }}
                        labelStyle={{ color: 'var(--muted-foreground)' }}
                     />
                     {OUTCOMES.map((outcome, index) => (
                        <Bar
                           key={outcome.key}
                           dataKey={outcome.key}
                           name={t(`legend_${outcome.key}`)}
                           stackId="runs"
                           fill={outcome.color}
                           radius={index === OUTCOMES.length - 1 ? [2, 2, 0, 0] : 0}
                        />
                     ))}
                  </BarChart>
               </ResponsiveContainer>
            </div>
         </section>

         <div className="grid gap-8 border-t border-border/60 pt-6 lg:grid-cols-2">
            <section className="flex flex-col gap-2">
               <h2 className="font-medium">{t('byType')}</h2>
               {data.byType.length === 0 ? (
                  <p className="text-muted-foreground">{t('empty')}</p>
               ) : (
                  <ul className="flex flex-col gap-1.5">
                     {data.byType.map((row) => (
                        <li key={row.code} className="flex items-center justify-between gap-3">
                           <span className="truncate font-mono">{row.code}</span>
                           <span className="tabular-nums text-muted-foreground">{row.count}</span>
                        </li>
                     ))}
                  </ul>
               )}
            </section>

            <section className="flex flex-col gap-2">
               <div className="flex flex-wrap items-center gap-2">
                  <h2 className="mr-auto font-medium">{t('offenders')}</h2>
                  <SegmentedControl
                     aria-label={t('rankLabel')}
                     value={rank}
                     onValueChange={setRank}
                     options={(['count', 'rate'] as const).map((option) => ({
                        value: option,
                        label: t(`by_${option}`),
                     }))}
                  />
               </div>
               {offenders.length === 0 ? (
                  <p className="text-muted-foreground">{t('empty')}</p>
               ) : (
                  <>
                     <ul className="flex flex-col gap-1.5">
                        {offenders.map((row) => (
                           <li
                              key={row.agentId}
                              className="flex items-center justify-between gap-3"
                           >
                              <Link
                                 href={`/${orgId}/agents/${row.agentId}`}
                                 className="truncate hover:underline"
                              >
                                 {row.agentName}
                              </Link>
                              <span className="shrink-0 tabular-nums text-muted-foreground">
                                 {t('failedOf', { failed: row.failed, total: row.total })} ·{' '}
                                 {percent(row.failed, row.total)}
                                 {row.total < LOW_SAMPLE ? '*' : ''}
                              </span>
                           </li>
                        ))}
                     </ul>
                     {thin ? <p className="text-muted-foreground">{t('lowSample')}</p> : null}
                  </>
               )}
            </section>
         </div>
      </div>
   );
}
