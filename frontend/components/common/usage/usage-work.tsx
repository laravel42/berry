'use client';

import { EmptyStateLoading } from '@/components/common/empty-state';
import {
   formatCost,
   formatSpan,
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
   Fact,
   Figure,
   PageHero,
   RangeStrip,
   SeriesBars,
   ShareStrip,
   Squares,
} from '@/components/common/charts/charts';
import { useUsage } from './use-usage';

/** Tasks finishing, runs ending and usage being recorded all change this view. */
const refreshOnWork = (type: string) => /^(issue\.|agent\.|usage\.recorded)/.test(type);

/**
 * Work, as charts: what the window's spend produced. Tasks that reached done,
 * what was delivered on the way, who finished them and how long a task takes.
 *
 * It does not lead with failed runs. Most of their causes are Berry's to fix,
 * and a run that failed and was retried still ends in a finished task, which
 * is what is counted here. The two causes a person can act on are said in one
 * quiet panel, and only when there are any.
 */
export default function UsageWork({
   query,
   onState,
}: {
   query: UsageQuery;
   onState?: (state: { lastUpdated: Date | null; loading: boolean; reload: () => void }) => void;
}) {
   const t = useTranslations('areas.usage.work');
   const { orgId } = useParams<{ orgId: string }>();
   const workspaceId = useSessionStore((state) => state.workspace?.id ?? null);
   const { data, error, loading, lastUpdated, reload } = useUsage(
      workspaceId
         ? async () => {
              const [work, usage] = await Promise.all([
                 getWorkspaceWork(workspaceId, query),
                 getWorkspaceUsage(workspaceId, query),
              ]);
              return { work, costMicros: usage.totals.costMicros };
           }
         : null,
      `work:${workspaceId}:${usageQueryKey(query)}`,
      refreshOnWork
   );

   useEffect(() => {
      onState?.({ lastUpdated, loading, reload });
   }, [onState, lastUpdated, loading, reload]);

   if (error) return <p className="px-6 py-8 text-muted-foreground">{error}</p>;
   if (!data) return <EmptyStateLoading label={t('loading')} />;

   const { work, costMicros } = data;
   if (work.runs === 0 && work.tasksDone === 0) {
      return <p className="px-6 py-8 text-muted-foreground">{t('empty', { days: work.days })}</p>;
   }

   const hourly = work.series.grain === 'hour';
   const finishers = work.byAgent.filter((agent) => agent.tasksDone > 0).slice(0, 10);
   const hours = work.byAgent
      .filter((agent) => agent.runSeconds > 0)
      .map((agent) => ({
         id: agent.agentId,
         label: agent.agentName,
         value: agent.runSeconds,
         figure: formatSpan(agent.runSeconds),
      }));
   const topHours = hours.slice(0, 7);
   const restHours = hours.slice(7).reduce((sum, row) => sum + row.value, 0);
   if (restHours > 0) {
      topHours.push({
         id: 'rest',
         label: t('otherRoles', { count: hours.length - 7 }),
         value: restHours,
         figure: formatSpan(restHours),
      });
   }
   const attention = work.attention.stepLimit + work.attention.deliveryFailed;

   return (
      <div className="flex flex-col gap-5 px-6 py-6">
         <PageHero
            label={t('heroLabel', { days: work.days })}
            figure={work.tasksDone}
            tone="text-status-success"
            caption={t('heroCaption')}
            facts={[
               { value: String(work.pullRequests), label: t('pullRequests') },
               { value: String(work.commits), label: t('commits') },
               { value: formatSpan(work.runSeconds), label: t('agentTime') },
            ]}
         >
            <SeriesBars
               label={t(hourly ? 'seriesLabelHourly' : 'seriesLabelDaily')}
               topTone="bg-status-success"
               height={230}
               bars={work.series.points.map((point) => ({
                  key: point.key,
                  label: seriesLabel(point.key, work.series.grain),
                  top: point.tasksDone,
                  topLabel: point.tasksDone > 0 ? String(point.tasksDone) : undefined,
               }))}
            />
         </PageHero>

         <div className="grid gap-5 lg:grid-cols-12">
            <ChartPanel title={t('whoTitle')} hint={t('whoHint')} className="lg:col-span-5">
               {finishers.length > 0 ? (
                  <ul className="flex flex-col gap-1">
                     {finishers.map((agent) => (
                        <li key={agent.agentId}>
                           <Link
                              href={`/${orgId}/agents/${agent.agentId}`}
                              className="grid min-h-11 grid-cols-[7rem_minmax(0,1fr)_2rem] items-center gap-3 rounded-sm no-underline outline-none hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                              aria-label={t('whoRow', {
                                 name: agent.agentName,
                                 count: agent.tasksDone,
                              })}
                           >
                              <span className="truncate">{agent.agentName}</span>
                              <Squares count={agent.tasksDone} />
                              <span className="text-right font-medium tabular-nums">
                                 {agent.tasksDone}
                              </span>
                           </Link>
                        </li>
                     ))}
                  </ul>
               ) : (
                  <p className="text-muted-foreground">{t('noneDone')}</p>
               )}
            </ChartPanel>

            <ChartPanel
               title={t('durationTitle')}
               hint={t('durationHint')}
               className="lg:col-span-7"
            >
               {work.duration ? (
                  <div className="flex flex-1 flex-col gap-5">
                     <div className="flex flex-wrap items-baseline gap-x-3">
                        <Figure size="lg">{formatSpan(work.duration.median)}</Figure>
                        <span className="text-muted-foreground">{t('durationTypical')}</span>
                     </div>
                     <RangeStrip
                        min={work.duration.min}
                        median={work.duration.median}
                        p90={work.duration.p90}
                        max={work.duration.max}
                        format={formatSpan}
                        label={t('durationLabel', {
                           median: formatSpan(work.duration.median),
                           p90: formatSpan(work.duration.p90),
                        })}
                        captions={{
                           min: t('fastest'),
                           median: t('halfDone'),
                           p90: t('nineInTen'),
                           max: t('slowest'),
                        }}
                     />
                     <div className="mt-auto grid grid-cols-3 gap-x-6 border-t pt-4">
                        <Fact
                           value={formatCost(Math.round(costMicros / Math.max(1, work.tasksDone)))}
                           label={t('perTask')}
                        />
                        <Fact
                           value={formatSpan(work.runSeconds / Math.max(1, work.tasksDone))}
                           label={t('timePerTask')}
                        />
                        <Fact
                           value={(work.runs / Math.max(1, work.tasksDone)).toFixed(1)}
                           label={t('runsPerTask')}
                        />
                     </div>
                  </div>
               ) : (
                  <p className="text-muted-foreground">{t('noneDone')}</p>
               )}
            </ChartPanel>
         </div>

         <div className="grid gap-5 lg:grid-cols-12">
            <ChartPanel
               title={t('hoursTitle')}
               hint={t('hoursHint')}
               className={attention > 0 ? 'lg:col-span-8' : 'lg:col-span-12'}
            >
               <ShareStrip shares={topHours} label={t('hoursLabel')} />
            </ChartPanel>
            {attention > 0 ? (
               <ChartPanel title={t('attentionTitle')} className="lg:col-span-4">
                  <ul className="flex flex-col divide-y">
                     {work.attention.stepLimit > 0 ? (
                        <li className="flex flex-col gap-0.5 py-2.5">
                           <span className="font-medium">
                              {t('stepLimit', { count: work.attention.stepLimit })}
                           </span>
                           <span className="text-muted-foreground">{t('stepLimitAdvice')}</span>
                        </li>
                     ) : null}
                     {work.attention.deliveryFailed > 0 ? (
                        <li className="flex flex-col gap-0.5 py-2.5">
                           <span className="font-medium">
                              {t('deliveryFailed', { count: work.attention.deliveryFailed })}
                           </span>
                           <span className="text-muted-foreground">
                              {t('deliveryFailedAdvice')}
                           </span>
                        </li>
                     ) : null}
                  </ul>
               </ChartPanel>
            ) : null}
         </div>
      </div>
   );
}
