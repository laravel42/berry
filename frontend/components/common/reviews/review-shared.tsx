'use client';

import { cn } from '@/lib/utils';
import type { ReviewStatus } from '@/data/reviews';
import type { ReviewVerdict } from '@/lib/reviews';
import { useTranslations } from 'next-intl';

/**
 * The gate's three states, each on its review token so a waiting task reads
 * as pending (amber), an approved one as approved (green) and a returned one
 * as changes requested (red), in both themes.
 */
export const PR_STATUS_TONE: Record<ReviewStatus, string> = {
   open: 'text-review-pending',
   merged: 'text-review-approved',
   closed: 'text-review-changes',
};

/**
 * Pull-request icon for a review's state. The colour carries the state for
 * sighted readers and the visually hidden label carries it for everyone else,
 * so a row never says "waiting" by hue alone. `muted` is for a waiting task
 * whose run committed nothing: the amber would promise a delivery that is
 * not there, so it drops to the neutral tone and says so.
 */
export function PrIcon({
   status,
   muted = false,
   className,
}: {
   status: ReviewStatus;
   muted?: boolean;
   className?: string;
}) {
   const t = useTranslations('reviews');
   const label = muted ? t('status.undelivered') : t(`status.${status}`);
   return (
      <span
         className={cn(
            'inline-flex shrink-0',
            muted ? 'text-status-neutral' : PR_STATUS_TONE[status],
            className
         )}
      >
         {status === 'open' ? (
            <svg viewBox="0 0 16 16" className="size-4 shrink-0" fill="currentColor" aria-hidden>
               <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
            </svg>
         ) : (
            <svg viewBox="0 0 16 16" className="size-4 shrink-0" fill="currentColor" aria-hidden>
               <path d="M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218ZM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm8.5-4.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z" />
            </svg>
         )}
         <span className="sr-only">{label}</span>
      </span>
   );
}

/** Check chip for the linked task, on the agent actor colour. */
export function IssueCheckIcon({ className }: { className?: string }) {
   return (
      <svg
         viewBox="0 0 16 16"
         className={cn('size-4 shrink-0 text-actor-agent', className)}
         aria-hidden
      >
         <circle cx="8" cy="8" r="7" fill="currentColor" />
         <path
            d="M5 8.2 7.2 10.4 11 6.2"
            fill="none"
            stroke="var(--primary-foreground)"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
         />
      </svg>
   );
}

/** "+46 -1" diff stat on the status tokens. */
export function DiffStat({
   additions,
   deletions,
   className,
}: {
   additions: number;
   deletions: number;
   className?: string;
}) {
   return (
      <span className={cn('inline-flex items-center gap-1 font-medium', className)}>
         <span className="text-status-success">+{additions}</span>
         {deletions > 0 && <span className="text-status-danger">-{deletions}</span>}
      </span>
   );
}

export type PeerOutcome = 'approved' | 'sentBack' | 'reviewing';

export function peerOutcomeOf(verdict: Pick<ReviewVerdict, 'approved'>): PeerOutcome {
   if (verdict.approved === null) return 'reviewing';
   return verdict.approved ? 'approved' : 'sentBack';
}

const PEER_TONE: Record<PeerOutcome, string> = {
   approved: 'text-review-approved',
   sentBack: 'text-review-changes',
   reviewing: 'text-review-pending',
};

/**
 * One vocabulary for a peer verdict wherever it appears: "Peer approved",
 * "Peer sent back", "Peer reviewing". The list row, the overview and the
 * verdicts tab all draw this chip, so the same verdict never reads two ways.
 */
export function PeerVerdictChip({
   verdict,
   className,
}: {
   verdict: Pick<ReviewVerdict, 'approved' | 'reviewer'>;
   className?: string;
}) {
   const t = useTranslations('reviews');
   const outcome = peerOutcomeOf(verdict);
   return (
      <span
         className={cn(
            'inline-flex shrink-0 items-center whitespace-nowrap rounded border border-border/60 bg-muted/40 px-1.5 leading-5 font-medium',
            PEER_TONE[outcome],
            className
         )}
         title={t('peer.by', { reviewer: verdict.reviewer })}
      >
         {t(`peer.${outcome}`)}
      </span>
   );
}
