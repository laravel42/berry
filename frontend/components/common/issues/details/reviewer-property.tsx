'use client';

import { PeerVerdictChip } from '@/components/common/reviews/review-shared';
import { type AutoReview, loadAutoReviews } from '@/lib/runs';
import { CircleCheck, CircleX, Loader2, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

/**
 * Who is reviewing this task, in the sidebar beside status and assignee.
 *
 * Shown from the moment the reviewer is picked rather than when it answers.
 * The verdict row is reserved before the model is called, so for the length of
 * that call — a minute or more on a large deliverable — this reads "reviewing"
 * instead of leaving the task looking untouched.
 *
 * Polls while a review is open. A review is short-lived and the page has no
 * stream for it; a request every few seconds for the minute it lasts is
 * cheaper than the machinery to push it.
 */
export function ReviewerProperty({ issueRef }: { issueRef: string }) {
   const tPeer = useTranslations('reviews.peer');
   const [review, setReview] = useState<AutoReview | null>(null);

   useEffect(() => {
      if (!issueRef) {
         setReview(null);
         return;
      }
      let cancelled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const read = () => {
         void loadAutoReviews(issueRef)
            .then((reviews) => {
               if (cancelled) return;
               const latest = reviews[0] ?? null;
               setReview(latest);
               if (latest?.inProgress) timer = setTimeout(read, 4000);
            })
            .catch(() => {
               if (!cancelled) setReview(null);
            });
      };
      read();

      return () => {
         cancelled = true;
         if (timer) clearTimeout(timer);
      };
   }, [issueRef]);

   if (!review) return null;

   const approved = review.inProgress ? null : review.approved;
   const title =
      approved === null
         ? tPeer('reading', { reviewer: review.reviewer, author: review.author })
         : `${tPeer('by', { reviewer: review.reviewer })} · ${tPeer('attempt', { attempt: review.attempt })}`;

   return (
      <div className="flex items-center gap-2" title={title}>
         <div className="flex size-7 shrink-0 items-center justify-center">
            {approved === null ? (
               <Loader2 className="size-4 animate-spin text-review-pending" aria-hidden />
            ) : approved ? (
               <CircleCheck className="size-4 text-review-approved" aria-hidden />
            ) : (
               <CircleX className="size-4 text-review-changes" aria-hidden />
            )}
         </div>
         <span className="min-w-0 truncate">{review.reviewer}</span>
         <PeerVerdictChip verdict={{ approved, reviewer: review.reviewer }} />
      </div>
   );
}

/** The icon the section header uses, so the panel and the block agree. */
export const ReviewerIcon = ShieldCheck;
