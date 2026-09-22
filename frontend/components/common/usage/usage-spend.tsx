'use client';

import { readableModelName } from '@/components/common/agents/model-name';
import { EmptyStateLoading } from '@/components/common/empty-state';
import {
   formatCost,
   formatSpan,
   formatTokens,
   getWorkspaceUsage,
   getWorkspaceWork,
   seriesLabel,
   usageQueryKey,
   type UsageQuery,
} from '@/lib/usage';
import { useSessionStore } from '@/store/session-store';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect } from 'react';
import {
   ChartPanel,
   Donut,
   Gauge,
   Legend,
   Lollipops,
   PageHero,
   PairedBars,
   SeriesBars,
   Treemap,
   type TreemapItem,
} from '@/components/common/charts/charts';
import { useUsage } from './use-usage';

/** The theme's chart colours, in the order a ring's slices take them. */
const SLICE_COLORS = [
   'var(--foreground)',
   'var(--chart-4)',
   'var(--chart-2)',
   'var(--chart-3)',
   'var(--chart-5)',
];

/** How many agents get a tile of their own; the rest share one. */
const TREEMAP_TILES = 8;

/**
 * Spend, as charts: what the window cost, when, and who and what took which
 * share of it. Every figure is tied to what it bought (a finished task, a run,
 * an hour of agent time), because a total alone says nothing about whether it
 * was worth it.
 */
export default function UsageSpend({
   query,
   onState,
}: {
   query: UsageQuery;
   onState?: (state: { lastUpdated: Date | null; loading: boolean; reload: () => void }) => void;
}) {
   const t = useTranslations('areas.usage.spend');
   const { orgId } = useParams<{ orgId: string }>();
   const workspaceId = useSessionStore((state) => state.workspace?.id ?? null);
   const { data, error, loading, lastUpdated, reload } = useUsage(
      workspaceId
         ? async () => {
              const [usage, work] = await Promise.all([
                 getWorkspaceUsage(workspaceId, query),
                 getWorkspaceWork(workspaceId, query),
              ]);
              return { usage, work };
           }
         : null,
      `spend:${workspaceId}:${usageQueryKey(query)}`
   );

   useEffect(() => {
      onState?.({ lastUpdated, loading, reload });
   }, [onState, lastUpdated, loading, reload]);

   if (error) return <p className="px-6 py-8 text-muted-foreground">{error}</p>;
   if (!data) return <EmptyStateLoading label={t('loading')} />;

   const { usage, work } = data;
   const totals = usage.totals;
   const cost = totals.costMicros;
   if (totals.events === 0 && work.runs === 0) {
      return <p className="px-6 py-8 text-muted-foreground">{t('empty', { days: usage.days })}</p>;
   }

   const doneBy = new Map(work.byAgent.map((agent) => [agent.agentId, agent]));
   const spenders = usage.byAgent.filter((agent) => agent.costMicros > 0);
   const rest = spenders.slice(TREEMAP_TILES);
   const tiles: TreemapItem[] = spenders.slice(0, TREEMAP_TILES).map((agent) => {
      const made = doneBy.get(agent.key);
      return {
         id: agent.key,
         label: agent.agentName,
         value: agent.costMicros,
         figure: formatCost(agent.costMicros),
         caption: made ? t('tileCaption', { runs: made.runs, done: made.tasksDone }) : undefined,
         href: `/${orgId}/agents/${agent.key}`,
      };
   });
   if (rest.length > 0) {
      const value = rest.reduce((sum, agent) => sum + agent.costMicros, 0);
      tiles.push({
         id: 'rest',
         label: t('otherRoles', { count: rest.length }),
         value,
         figure: formatCost(value),
      });
   }

   const models = usage.byModel.filter((model) => model.costMicros > 0);
   const leadModel = models[0];
   const slices = models.slice(0, SLICE_COLORS.length).map((model, index) => ({
      label: readableModelName(model.key),
      value: model.costMicros,
      figure: formatCost(model.costMicros),
      color: SLICE_COLORS[index]!,
   }));

   const prompt = totals.cacheReadTokens + totals.cacheWriteTokens + totals.inputTokens;
   const cacheShare = prompt > 0 ? totals.cacheReadTokens / prompt : 0;

   const average = work.tasksDone > 0 ? cost / work.tasksDone : null;
   const perTask = spenders
      .map((agent) => ({ agent, done: doneBy.get(agent.key)?.tasksDone ?? 0 }))
      .filter((row) => row.done > 0)
      .map((row) => ({
         id: row.agent.key,
         label: row.agent.agentName,
         value: row.agent.costMicros / row.done,
         figure: formatCost(Math.round(row.agent.costMicros / row.done)),
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 9);

   const perRun = spenders
      .map((agent) => ({ agent, runs: doneBy.get(agent.key)?.runs ?? 0 }))
      .filter((row) => row.runs > 0)
      .slice(0, 10)
      .map((row) => ({
         id: row.agent.key,
         label: row.agent.agentName,
         left: row.runs,
         right: row.agent.costMicros / row.runs,
         leftFigure: String(row.runs),
         rightFigure: formatCost(Math.round(row.agent.costMicros / row.runs)),
      }));

   const topCost = Math.max(1, ...usage.topIssues.map((issue) => issue.costMicros));
   const hourly = usage.series.grain === 'hour';

   return (
      <div className="flex flex-col gap-5 px-6 py-6">
         <PageHero
            label={t('heroLabel', { days: usage.days })}
            figure={formatCost(cost)}
            caption={
               <>
                  {hourly ? t('heroHourly') : t('heroDaily', { days: usage.days })}
                  {totals.unpricedEvents > 0 ? (
                     <span className="block">
                        {t('unpriced', { unpriced: totals.unpricedEvents, events: totals.events })}
                     </span>
                  ) : null}
               </>
            }
            facts={[
               ...(average !== null
                  ? [{ value: formatCost(Math.round(average)), label: t('perTask') }]
                  : []),
               ...(work.runs > 0
                  ? [{ value: formatCost(Math.round(cost / work.runs)), label: t('perRun') }]
                  : []),
               { value: formatSpan(work.runSeconds), label: t('agentTime') },
               { value: String(work.pullRequests), label: t('pullRequests') },
            ]}
         >
            <Legend
               items={[
                  { label: t('legendCost'), tone: 'bg-foreground' },
                  { label: t('legendRuns'), tone: 'bg-status-info' },
               ]}
            />
            <SeriesBars
               label={t(hourly ? 'seriesLabelHourly' : 'seriesLabelDaily')}
               bars={usage.series.points.map((point) => ({
                  key: point.key,
                  label: seriesLabel(point.key, usage.series.grain),
                  top: point.costMicros,
                  topLabel: point.costMicros > 0 ? formatCost(point.costMicros) : undefined,
                  bottom: point.runs,
                  bottomLabel: point.runs > 0 ? String(point.runs) : undefined,
               }))}
            />
         </PageHero>

         <div className="grid gap-5 lg:grid-cols-12">
            <ChartPanel
               title={t('whoTitle')}
               hint={t('whoHint', { count: spenders.length })}
               className="min-h-96 lg:col-span-6"
            >
               <Treemap items={tiles} label={t('whoLabel')} />
            </ChartPanel>
            <ChartPanel title={t('modelTitle')} className="lg:col-span-3">
               {leadModel ? (
                  <Donut
                     slices={slices}
                     label={t('modelLabel')}
                     center={`${Math.round((leadModel.costMicros / Math.max(1, cost)) * 100)}%`}
                     centerLabel={readableModelName(leadModel.key)}
                  />
               ) : (
                  <p className="text-muted-foreground">{t('noModels')}</p>
               )}
            </ChartPanel>
            <ChartPanel title={t('cacheTitle')} className="lg:col-span-3">
               <div className="flex flex-col items-center gap-4">
                  <Gauge
                     ratio={cacheShare}
                     label={t('cacheLabel', { percent: (cacheShare * 100).toFixed(1) })}
                     figure={`${(cacheShare * 100).toFixed(1)}%`}
                     caption={t('cacheCaption')}
                  />
                  <dl className="grid w-full grid-cols-2 gap-x-4 gap-y-1.5">
                     {(
                        [
                           [t('cacheRead'), totals.cacheReadTokens],
                           [t('cacheWrite'), totals.cacheWriteTokens],
                           [t('sentFresh'), totals.inputTokens],
                           [t('generated'), totals.outputTokens],
                        ] as const
                     ).map(([label, value]) => (
                        <div key={label} className="contents">
                           <dt className="text-muted-foreground">{label}</dt>
                           <dd className="text-right font-medium tabular-nums">
                              {formatTokens(value)}
                           </dd>
                        </div>
                     ))}
                  </dl>
               </div>
            </ChartPanel>
         </div>

         <div className="grid gap-5 lg:grid-cols-12">
            <ChartPanel
               title={t('perTaskTitle')}
               hint={t('perTaskHint')}
               className="min-h-96 lg:col-span-5"
            >
               {perTask.length > 0 && average !== null ? (
                  <>
                     <Lollipops rows={perTask} reference={average} label={t('perTaskLabel')} />
                     <span className="text-muted-foreground">
                        {t('perTaskAverage', { average: formatCost(Math.round(average)) })}
                     </span>
                  </>
               ) : (
                  <p className="text-muted-foreground">{t('noTasksDone')}</p>
               )}
            </ChartPanel>
            <ChartPanel
               title={t('volumeTitle')}
               hint={t('volumeHint')}
               className="min-h-96 lg:col-span-7"
            >
               {perRun.length > 0 ? (
                  <PairedBars
                     rows={perRun}
                     label={t('volumeLabel')}
                     headings={[t('volumeRuns'), t('volumePerRun')]}
                  />
               ) : (
                  <p className="text-muted-foreground">{t('noRuns')}</p>
               )}
            </ChartPanel>
         </div>

         {usage.topIssues.length > 0 ? (
            <ChartPanel title={t('tasksTitle')} hint={t('tasksHint')}>
               <ul className="flex flex-col">
                  {usage.topIssues.map((issue) => (
                     <li key={issue.issueId}>
                        <Link
                           href={`/${orgId}/issue/${issue.identifier}`}
                           className="grid min-h-11 grid-cols-[5rem_minmax(0,1fr)_4.5rem] items-center gap-3 rounded-sm no-underline outline-none hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        >
                           <span className="font-medium text-muted-foreground">
                              {issue.identifier}
                           </span>
                           <span className="flex min-w-0 items-center gap-2.5">
                              <span
                                 aria-hidden
                                 className="h-5 shrink-0 rounded bg-foreground"
                                 style={{
                                    width: `${Math.max(2, (issue.costMicros / topCost) * 45)}%`,
                                 }}
                              />
                              <span className="shrink-0 tabular-nums">
                                 {t('runCount', { count: issue.runs })}
                              </span>
                              <span className="truncate text-muted-foreground">{issue.title}</span>
                           </span>
                           <span className="text-right font-medium tabular-nums">
                              {formatCost(issue.costMicros)}
                           </span>
                        </Link>
                     </li>
                  ))}
               </ul>
            </ChartPanel>
         ) : null}
      </div>
   );
}
