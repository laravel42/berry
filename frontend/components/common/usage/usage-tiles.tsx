'use client';

import { useTranslations } from 'next-intl';

import {
   formatCost,
   formatDuration,
   formatTokens,
   type RunTotals,
   type UsageBucket,
} from '@/lib/usage';

/**
 * One figure and what it counts, in a bordered tile: the unit of every
 * usage and dashboard summary row. Lay tiles out in a grid; the value is
 * tabular so figures in neighbouring tiles line up.
 */
export function StatTile({ label, value }: { label: string; value: string | number }) {
   return (
      <div className="rounded-md border px-4 py-3">
         <p className="text-muted-foreground">{label}</p>
         <p className="mt-1 font-medium tabular-nums">{value}</p>
      </div>
   );
}

/**
 * What a window cost and what it took: money, tokens, and — when the read
 * carries them — the runs behind both.
 */
export function UsageTiles({ totals, runs }: { totals: UsageBucket; runs?: RunTotals }) {
   const t = useTranslations('areas.usage.tiles');
   const tiles = [
      { label: t('cost'), value: formatCost(totals.costMicros) },
      { label: t('tokens'), value: formatTokens(totals.inputTokens + totals.outputTokens) },
      {
         label: t('cache'),
         value: `${formatTokens(totals.cacheReadTokens)} / ${formatTokens(totals.cacheWriteTokens)}`,
      },
      ...(runs
         ? [
              { label: t('runs'), value: String(runs.runs) },
              { label: t('runTime'), value: formatDuration(runs.runSeconds) },
           ]
         : []),
   ];
   return (
      <div className="flex flex-col gap-2">
         <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            {tiles.map((tile) => (
               <StatTile key={tile.label} label={tile.label} value={tile.value} />
            ))}
         </div>
         {totals.unpricedEvents > 0 ? (
            <p className="text-muted-foreground">
               {t('unpriced', { unpriced: totals.unpricedEvents, events: totals.events })}
            </p>
         ) : null}
      </div>
   );
}
