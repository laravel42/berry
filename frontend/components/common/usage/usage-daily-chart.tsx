'use client';

import { useTranslations } from 'next-intl';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { formatCost, formatTokens, totalTokens, type UsageBucket } from '@/lib/usage';

export type UsageMetric = 'cost' | 'tokens' | 'calls';

function value(point: UsageBucket, metric: UsageMetric): number {
   if (metric === 'cost') return point.costMicros;
   if (metric === 'tokens') return totalTokens(point);
   return point.events;
}

/**
 * One bar per bucket. Keys are days (`YYYY-MM-DD`), weeks (the day they start)
 * or hours (`00`..`23`), and the chart draws whichever it is given. Bars take
 * the agent-activity hue (`chart-2`) over a muted track, so an empty day still
 * reads as a day.
 */
export function UsageDailyChart({
   points,
   metric,
}: {
   points: UsageBucket[];
   metric: UsageMetric;
}) {
   const t = useTranslations('areas.usage.chart');
   const data = points.map((point) => ({
      key: point.key.length === 10 ? point.key.slice(5) : point.key,
      value: value(point, metric),
   }));
   const format =
      metric === 'cost'
         ? formatCost
         : metric === 'tokens'
           ? formatTokens
           : (count: number) => String(count);
   return (
      <div className="h-48 w-full text-muted-foreground">
         <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
               <XAxis
                  dataKey="key"
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
                  minTickGap={12}
               />
               <YAxis hide />
               <Tooltip
                  cursor={{ fillOpacity: 0.08 }}
                  formatter={(raw) => [format(Number(raw)), t(`metric_${metric}`)]}
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
               <Bar
                  dataKey="value"
                  fill="var(--chart-2)"
                  background={{ fill: 'var(--muted)', radius: 2 }}
                  radius={[2, 2, 0, 0]}
               />
            </BarChart>
         </ResponsiveContainer>
      </div>
   );
}
