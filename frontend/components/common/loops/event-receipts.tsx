'use client';

import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { EmptyStateLoading } from '@/components/common/empty-state';
import {
   describeAutopilotFailure,
   describeReason,
   listEventReceipts,
   type EventReceipt,
} from '@/lib/autopilots';
import { cn } from '@/lib/utils';

/**
 * Every event a Loop's event triggers heard, and what became of it: fired a
 * run, filtered out, or skipped — with the reason (its own work, a chain too
 * deep, an agent caused it, already running). This is the answer to "why did
 * my Loop not run?".
 */
export default function EventReceipts({
   autopilotId,
   orgId,
   refresh,
}: {
   autopilotId: string;
   orgId: string;
   refresh: number;
}) {
   const t = useTranslations('loops.receipts');
   const tEvent = useTranslations('loops.eventTrigger.events');
   const format = useFormatter();
   const [receipts, setReceipts] = useState<EventReceipt[] | null>(null);
   const [error, setError] = useState<string | null>(null);

   useEffect(() => {
      let cancelled = false;
      void listEventReceipts(autopilotId)
         .then((found) => {
            if (!cancelled) setReceipts(found);
         })
         .catch((failure: unknown) => {
            if (!cancelled) setError(describeAutopilotFailure(failure));
         });
      return () => {
         cancelled = true;
      };
   }, [autopilotId, refresh]);

   if (error) {
      return (
         <p className="px-6 py-6 text-muted-foreground" role="alert">
            {error}
         </p>
      );
   }
   if (!receipts) return <EmptyStateLoading label={t('loading')} />;
   if (receipts.length === 0) return <p className="px-6 py-6 text-muted-foreground">{t('none')}</p>;

   return (
      <div className="overflow-x-auto">
         <table className="w-full">
            <thead className="text-left text-muted-foreground">
               <tr className="border-b">
                  <th className="px-6 py-2 font-normal">{t('when')}</th>
                  <th className="px-2 py-2 font-normal">{t('event')}</th>
                  <th className="px-2 py-2 font-normal">{t('outcome')}</th>
                  <th className="px-2 py-2 font-normal">{t('run')}</th>
               </tr>
            </thead>
            <tbody>
               {receipts.map((receipt) => (
                  <tr key={receipt.id} className="border-b">
                     <td className="px-6 py-2">
                        <time dateTime={receipt.occurredAt}>
                           {format.relativeTime(new Date(receipt.occurredAt))}
                        </time>
                     </td>
                     <td className="px-2 py-2">
                        {tEvent.has(receipt.topic as never)
                           ? tEvent(receipt.topic as never)
                           : receipt.topic}
                     </td>
                     <td className="px-2 py-2">
                        <span
                           className={cn(
                              receipt.status === 'fired' && 'text-foreground',
                              receipt.status === 'failed' && 'text-status-danger',
                              (receipt.status === 'filtered' || receipt.status === 'skipped') &&
                                 'text-muted-foreground'
                           )}
                        >
                           {t(`status.${receipt.status}`)}
                        </span>
                        {receipt.reasonCode ? (
                           <span className="text-muted-foreground">
                              {' '}
                              · {describeReason(receipt.reasonCode)}
                           </span>
                        ) : null}
                     </td>
                     <td className="px-2 py-2">
                        {receipt.autopilotRunId ? (
                           <Link
                              className="underline-offset-2 hover:underline"
                              href={`/${orgId}/loop/${autopilotId}/runs/${receipt.autopilotRunId}`}
                           >
                              {t('openRun')}
                           </Link>
                        ) : (
                           <span className="text-muted-foreground">—</span>
                        )}
                     </td>
                  </tr>
               ))}
            </tbody>
         </table>
      </div>
   );
}
