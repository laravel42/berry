'use client';

import { BerryMark } from '@/components/brand/berry-mark';
import { stoppedWithoutDelivering, type ReviewItem } from '@/lib/reviews';
import { cn } from '@/lib/utils';
import { ExternalLink } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ReviewDecisionBar, type ReviewOutcome } from './review-decision-bar';
import { PR_STATUS_TONE } from './review-shared';
import { reviewStatusOf } from './reviews';

/**
 * What the run left behind, as a one-line headline: who delivered, and the
 * pull request when there is one. While the task waits at the gate, Approve
 * and Reject sit beside it.
 */
export function ReviewDeliveryLine({
   item,
   onDecided,
   className,
}: {
   item: ReviewItem;
   onDecided?: (outcome: ReviewOutcome) => void | Promise<void>;
   className?: string;
}) {
   const t = useTranslations('reviews');
   const stopped = stoppedWithoutDelivering(item);
   const waiting = item.issue.status === 'in_review';
   const agent = item.author?.name ?? t('facts.noAuthor');
   const name = (chunks: ReactNode) => <span className="text-actor-agent">{chunks}</span>;
   const prTone = PR_STATUS_TONE[reviewStatusOf(item)];
   const pr = (chunks: ReactNode) =>
      item.pullRequest?.url ? (
         <a
            href={item.pullRequest.url}
            target="_blank"
            rel="noreferrer"
            className={cn(prTone, 'underline-offset-2 hover:underline')}
         >
            <ExternalLink className="relative top-[-1px] mr-1 inline size-3.5" aria-hidden />
            {chunks}
         </a>
      ) : (
         <span className={prTone}>{chunks}</span>
      );
   const outcome = stopped
      ? t.rich('delivery.stopped', { agent, name })
      : item.pullRequest
        ? t.rich('delivery.pullRequest', {
             agent,
             number: item.pullRequest.number,
             name,
             pr,
          })
        : item.delivery.committed
          ? t.rich('delivery.committed', { agent, name })
          : t.rich('delivery.produced', {
               agent,
               count: item.delivery.producedFiles,
               name,
            });

   return (
      <div
         className={cn(
            'flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 text-lg',
            className
         )}
      >
         <p className="flex min-w-0 flex-1 items-center gap-2">
            <BerryMark
               size="sm"
               tone={stopped ? 'attention' : 'complete'}
               className="shrink-0"
            />
            <span className="min-w-0">{outcome}</span>
         </p>
         {waiting ? <ReviewDecisionBar key={item.id} item={item} onDecided={onDecided} /> : null}
      </div>
   );
}
