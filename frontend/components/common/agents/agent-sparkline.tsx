'use client';

import { cn } from '@/lib/utils';

interface ActivityPoint {
   /** `YYYY-MM-DD`, UTC. */
   day: string;
   runs: number;
   failed: number;
}

interface AgentSparklineProps {
   activity: ActivityPoint[];
   /** Per-day tooltip, already formatted by the caller's message catalogue. */
   describe: (point: ActivityPoint & { percent: number }) => string;
   /** What a row with no runs at all says. */
   emptyLabel: string;
   className?: string;
}

const HEIGHT = 20;
const BAR = 5;
const GAP = 2;

const percentOf = (point: ActivityPoint) =>
   point.runs === 0 ? 0 : Math.round((point.failed / point.runs) * 100);

/**
 * Seven days of runs as one small column chart.
 *
 * Failures are drawn as the bottom of each column rather than as a second
 * series: the question a reader brings to this cell is "is this agent working,
 * and is its work landing", and two overlapping lines answer neither at this
 * size. One faint baseline runs under the week, so a day with no runs reads as
 * a gap on a chart rather than as a dash; a week with no runs at all is said
 * in words, because a bare baseline looks like a broken glyph.
 *
 * Tooltips are SVG `<title>` elements, one per column. They need no JavaScript,
 * they survive a table that re-renders under the pointer, and a screen reader
 * gets the same numbers from the group label. The fade on mount is skipped
 * for readers who asked for less motion.
 */
export function AgentSparkline({ activity, describe, emptyLabel, className }: AgentSparklineProps) {
   const total = activity.reduce((sum, point) => sum + point.runs, 0);

   if (activity.length === 0 || total === 0) {
      return <span className={cn('truncate text-muted-foreground', className)}>{emptyLabel}</span>;
   }

   const width = activity.length * BAR + (activity.length - 1) * GAP;
   const peak = Math.max(1, ...activity.map((point) => point.runs));

   return (
      <span
         className={cn(
            'inline-flex items-center motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-300',
            className
         )}
      >
         <svg
            width={width}
            height={HEIGHT}
            viewBox={`0 0 ${width} ${HEIGHT}`}
            role="img"
            aria-label={activity
               .map((point) => describe({ ...point, percent: percentOf(point) }))
               .join('. ')}
         >
            <rect
               x={0}
               y={HEIGHT - 1}
               width={width}
               height={1}
               className="fill-muted-foreground/25"
            />
            {activity.map((point, index) => {
               const x = index * (BAR + GAP);
               const label = describe({ ...point, percent: percentOf(point) });
               if (point.runs === 0) {
                  // Nothing to draw, but the day still answers a hover.
                  return (
                     <g key={point.day}>
                        <title>{label}</title>
                        <rect
                           x={x}
                           y={0}
                           width={BAR}
                           height={HEIGHT}
                           className="fill-transparent"
                        />
                     </g>
                  );
               }
               const full = Math.max(2, Math.round((point.runs / peak) * (HEIGHT - 2)));
               const failed =
                  point.failed === 0
                     ? 0
                     : Math.max(2, Math.round((point.failed / peak) * (HEIGHT - 2)));
               return (
                  <g key={point.day}>
                     <title>{label}</title>
                     <rect
                        x={x}
                        y={HEIGHT - full}
                        width={BAR}
                        height={full}
                        rx={1}
                        className="fill-status-info/80"
                     />
                     {failed > 0 ? (
                        <rect
                           x={x}
                           y={HEIGHT - failed}
                           width={BAR}
                           height={failed}
                           rx={1}
                           className="fill-status-danger"
                        />
                     ) : null}
                  </g>
               );
            })}
         </svg>
      </span>
   );
}
