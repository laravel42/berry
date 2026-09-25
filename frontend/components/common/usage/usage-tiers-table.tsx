'use client';

import { useTranslations } from 'next-intl';

import { isTier, TIER_NAMES, TIERS } from '@/lib/agents';
import { formatCost, type TierUsageRow } from '@/lib/usage';
import { cn } from '@/lib/utils';

/** Tiers in Berry's order, Max first; a tier the server knows and this build does not goes last. */
function byTier(left: TierUsageRow, right: TierUsageRow): number {
   const rank = (row: TierUsageRow) =>
      isTier(row.tier) ? TIERS.indexOf(row.tier) : Number.MAX_SAFE_INTEGER;
   return rank(left) - rank(right) || left.tier.localeCompare(right.tier);
}

function rate(part: number, whole: number): string {
   if (whole <= 0) return '—';
   return `${Math.round((part / whole) * 100)}%`;
}

/**
 * The Berry tiers side by side for the window: runs, cost, cost per run and
 * how often a run fell back. A table, not a chart: five rows compared on four
 * numbers read faster as figures. Unpriced appears only when a tier has any.
 */
export function UsageTiersTable({ rows }: { rows: TierUsageRow[] }) {
   const t = useTranslations('areas.usage.tiers');
   if (rows.length === 0) return <p className="text-muted-foreground">{t('empty')}</p>;

   const sorted = rows.slice().sort(byTier);
   const showUnpriced = rows.some((row) => row.unpricedRecords > 0);

   return (
      <div className="overflow-x-auto">
         <table className="w-full">
            <thead className="text-left text-muted-foreground">
               <tr>
                  <th className="py-1 pr-4 font-normal">{t('tier')}</th>
                  <th className="py-1 pr-4 text-right font-normal">{t('runs')}</th>
                  <th className="py-1 pr-4 text-right font-normal">{t('cost')}</th>
                  <th className="py-1 pr-4 text-right font-normal">{t('perRun')}</th>
                  <th className={cn('py-1 text-right font-normal', showUnpriced && 'pr-4')}>
                     {t('fallbackRate')}
                  </th>
                  {showUnpriced ? (
                     <th className="py-1 text-right font-normal">{t('unpriced')}</th>
                  ) : null}
               </tr>
            </thead>
            <tbody>
               {sorted.map((row) => (
                  <tr key={row.tier} className="border-t">
                     <td className="py-1.5 pr-4 font-medium">
                        {isTier(row.tier) ? TIER_NAMES[row.tier] : row.tier}
                     </td>
                     <td className="py-1.5 pr-4 text-right tabular-nums">{row.runs}</td>
                     <td className="py-1.5 pr-4 text-right tabular-nums">
                        {formatCost(row.costMicros)}
                        {row.unpricedRecords > 0 ? '*' : ''}
                     </td>
                     <td className="py-1.5 pr-4 text-right tabular-nums">
                        {row.runs > 0 ? formatCost(Math.round(row.costMicros / row.runs)) : '—'}
                     </td>
                     <td className={cn('py-1.5 text-right tabular-nums', showUnpriced && 'pr-4')}>
                        {rate(row.fellBackRuns, row.runs)}
                     </td>
                     {showUnpriced ? (
                        <td className="py-1.5 text-right tabular-nums">{row.unpricedRecords}</td>
                     ) : null}
                  </tr>
               ))}
            </tbody>
         </table>
      </div>
   );
}
