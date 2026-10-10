'use client';

import { PeerVerdictChip, shownPeerApproval } from '@/components/common/reviews/review-shared';
import { type AutoReview, loadAutoReviews } from '@/lib/runs';
import { cn } from '@/lib/utils';
import { CircleCheck, CircleX, Loader2, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

/**
 * What the peer reviewer decided, and why.
 *
 * A rejected AutoGate review left the task sitting in review with nothing to
 * read — the verdict was recorded and the reason written, and no surface
 * showed either, so a task an agent had declined to approve looked exactly
 * like one nobody had looked at yet. The reason is the useful part: it says
 * what to fix before the task is worth running again.
 *
 * The verdict is the same chip Reviews draws. While AutoGate is on and the
 * task is still in review, a rejection stays "Peer reviewing". With AutoGate
 * off that rejection is the verdict it already was. The reason is on the
 * page either way.
 */
export function IssueReviews({
   issueRef,
   inReview = false,
   autoGate = false,
}: {
   issueRef: string;
   inReview?: boolean;
   autoGate?: boolean;
}) {
   const t = useTranslations('issueDetail.reviews');
   const tPeer = useTranslations('reviews.peer');
   const [reviews, setReviews] = useState<AutoReview[]>([]);

   useEffect(() => {
      if (!issueRef) {
         setReviews([]);
         return;
      }
      let cancelled = false;
      void loadAutoReviews(issueRef)
         .then((loaded) => {
            if (!cancelled) setReviews(loaded);
         })
         .catch(() => {
            if (!cancelled) setReviews([]);
         });
      return () => {
         cancelled = true;
      };
   }, [issueRef]);

   if (reviews.length === 0) return null;

   return (
      <div>
         <h2
            data-heading="label"
            className="mb-2 flex items-center gap-1.5 pb-[7px] text-muted-foreground"
         >
            <ShieldCheck className="size-3.5" aria-hidden />
            {t('title')}
         </h2>
         <div className="flex flex-col gap-2">
            {reviews.map((review) => {
               const decided = review.inProgress ? null : review.approved;
               const approved = shownPeerApproval(decided, inReview, autoGate);
               return (
                  <div
                     key={review.id}
                     className={cn(
                        'rounded-md border p-3',
                        approved === null && 'border-border bg-muted/20',
                        approved === true && 'border-review-approved/30 bg-review-approved/5',
                        approved === false && 'border-review-changes/30 bg-review-changes/5'
                     )}
                  >
                     <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                        {approved === null ? (
                           <Loader2
                              className="size-4 shrink-0 animate-spin text-review-pending"
                              aria-hidden
                           />
                        ) : approved ? (
                           <CircleCheck
                              className="size-4 shrink-0 text-review-approved"
                              aria-hidden
                           />
                        ) : (
                           <CircleX className="size-4 shrink-0 text-review-changes" aria-hidden />
                        )}
                        <PeerVerdictChip verdict={{ approved, reviewer: review.reviewer }} />
                        <span className="min-w-0 truncate text-muted-foreground">
                           {tPeer('by', { reviewer: review.reviewer })} ·{' '}
                           {tPeer('ofAuthor', { author: review.author })}
                           {review.attempt > 1
                              ? ` · ${tPeer('attempt', { attempt: review.attempt })}`
                              : ''}
                        </span>
                     </div>
                     {decided === null ? (
                        <p className="text-muted-foreground">
                           {tPeer('reading', { reviewer: review.reviewer, author: review.author })}
                        </p>
                     ) : (
                        <p className="whitespace-pre-wrap text-muted-foreground">{review.reason}</p>
                     )}
                     {approved === false && !inReview ? (
                        <p className="mt-2 text-muted-foreground">{tPeer('returned')}</p>
                     ) : null}
                  </div>
               );
            })}
         </div>
      </div>
   );
}
