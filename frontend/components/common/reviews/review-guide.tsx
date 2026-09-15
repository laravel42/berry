'use client';

import { AgentMarkdown } from '@/components/common/agent-markdown';
import { reviewTimeAgo, type ReviewItem } from '@/lib/reviews';
import { useTranslations } from 'next-intl';
import { PeerVerdictChip } from './review-shared';

/** Every peer verdict on the task, newest first, with its reason. */
export function ReviewVerdicts({ item }: { item: ReviewItem }) {
   const t = useTranslations('reviews');
   if (item.verdicts.length === 0) {
      return (
         <div className="flex h-full items-center justify-center px-6 text-muted-foreground">
            {item.issue.autoGate ? t('peer.none') : t('peer.notOptedIn')}
         </div>
      );
   }
   const clamp = { lines: 12, moreLabel: t('summary.more'), lessLabel: t('summary.less') };
   return (
      <div className="h-full overflow-y-auto">
         <ul className="flex w-full max-w-[75ch] flex-col gap-4 px-6 py-6">
            {item.verdicts.map((verdict) => (
               <li
                  key={verdict.id}
                  className="rounded-md border border-border/60 bg-background px-4 py-3"
               >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                     <PeerVerdictChip verdict={verdict} />
                     <span className="text-muted-foreground">
                        {t('peer.by', { reviewer: verdict.reviewer })}
                     </span>
                     <span className="text-muted-foreground">
                        · {t('peer.attempt', { attempt: verdict.attempt })}
                     </span>
                     {verdict.decidedAt && (
                        <span className="text-muted-foreground">
                           · {t('facts.ago', { time: reviewTimeAgo(verdict.decidedAt) })}
                        </span>
                     )}
                  </div>
                  {verdict.reason && (
                     <AgentMarkdown body={verdict.reason} className="mt-2" clamp={clamp} />
                  )}
               </li>
            ))}
         </ul>
      </div>
   );
}
