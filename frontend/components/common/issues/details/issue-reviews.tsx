'use client';

import { AgentMarkdown } from '@/components/common/agent-markdown';
import { PeerVerdictChip, shownPeerApproval } from '@/components/common/reviews/review-shared';
import { type AutoReview, loadAutoReviews } from '@/lib/runs';
import { timeAgo } from '@/lib/time-ago';
import { cn } from '@/lib/utils';
import { AlertTriangle, CircleCheck, Loader2 } from 'lucide-react';
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
 *
 * A review that has not answered yet is not drawn here. The sidebar already
 * names the reviewer and says they are reading, and this box only repeated that.
 */
export function useSettledAutoReviews(issueRef: string): AutoReview[] {
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

   return reviews.filter((review) => !review.inProgress && review.approved !== null);
}

export function reviewTimestamp(review: Pick<AutoReview, 'decidedAt' | 'startedAt'>): string {
   return review.decidedAt ?? review.startedAt;
}

/** A gate fault, not a verdict — there is no feedback for the author to act on. */
function incompleteReview(reason: string | null | undefined): boolean {
   return (reason ?? '').startsWith('The review could not be completed');
}

export function IssueReviewCard({
   review,
   inReview = false,
   autoGate = false,
}: {
   review: AutoReview;
   inReview?: boolean;
   autoGate?: boolean;
}) {
   const tActivity = useTranslations('issueDetail.activity');
   const tPeer = useTranslations('reviews.peer');
   const approved = shownPeerApproval(review.approved, inReview, autoGate);
   const when = reviewTimestamp(review);
   return (
      <div
         className={cn(
            'rounded-md border p-2',
            approved === null && 'border-border bg-muted/20',
            approved === true && 'border-review-approved/30 bg-review-approved/5',
            approved === false && 'border-status-warning/30 bg-status-warning/5'
         )}
      >
         <div className="mb-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
            {approved === null ? (
               <Loader2 className="size-4 shrink-0 animate-spin text-review-pending" aria-hidden />
            ) : approved ? (
               <CircleCheck className="size-4 shrink-0 text-review-approved" aria-hidden />
            ) : (
               <AlertTriangle className="size-4 shrink-0 text-status-warning" aria-hidden />
            )}
            <PeerVerdictChip verdict={{ approved, reviewer: review.reviewer }} />
            <span className="text-muted-foreground">{timeAgo(when, 'recently')}</span>
         </div>
         {review.reason ? (
            <AgentMarkdown
               body={review.reason}
               compact
               clamp={{
                  lines: 6,
                  moreLabel: tActivity('readRest'),
                  lessLabel: tActivity('showLess'),
               }}
               className="max-w-none font-thin text-muted-foreground [&_*]:font-thin"
            />
         ) : null}
         {approved === false && !inReview && !incompleteReview(review.reason) ? (
            <p className="mt-2 text-muted-foreground">{tPeer('returned')}</p>
         ) : null}
      </div>
   );
}

export function IssueReviews({
   issueRef,
   inReview = false,
   autoGate = false,
}: {
   issueRef: string;
   inReview?: boolean;
   autoGate?: boolean;
}) {
   const settled = useSettledAutoReviews(issueRef);
   if (settled.length === 0) return null;

   return (
      <div className="flex flex-col gap-1">
         {settled.map((review) => (
            <IssueReviewCard
               key={review.id}
               review={review}
               inReview={inReview}
               autoGate={autoGate}
            />
         ))}
      </div>
   );
}
