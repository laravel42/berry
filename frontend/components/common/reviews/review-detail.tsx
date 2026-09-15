'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { loadReviews, type ReviewItem } from '@/lib/reviews';
import { useSessionStore } from '@/store/session-store';
import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ReviewDecisionBar, type ReviewOutcome } from './review-decision-bar';
import { ReviewDiff } from './review-diff';
import { ReviewVerdicts } from './review-guide';
import { ReviewOverview } from './review-overview';
import { DiffStat, IssueCheckIcon, PrIcon } from './review-shared';
import { reviewStatusOf } from './reviews';

export type { ReviewOutcome } from './review-decision-bar';

export type ReviewSection = 'overview' | 'guide' | 'diff';

const SECTION_PATH: Record<ReviewSection, string> = {
   overview: '',
   guide: '/review',
   diff: '/changes',
};

/**
 * Right pane of the Reviews split view: the task, the pull request, and the
 * decision. The item is found in either list, because a decided task is still
 * worth opening; the decision bar shows only while it waits.
 */
export function ReviewDetail({
   reviewId,
   section,
   listTab = 'for-you',
   onDecided,
   onBack,
}: {
   reviewId: string;
   section: ReviewSection;
   /** The list beside this pane, kept when switching sections. */
   listTab?: 'for-you' | 'created';
   onDecided?: (outcome: ReviewOutcome) => void | Promise<void>;
   /** Narrow screens show one pane at a time; this returns to the list. */
   onBack?: () => void;
}) {
   const t = useTranslations('reviews');
   const { orgId } = useParams<{ orgId: string }>();
   const workspace = useSessionStore((state) => state.workspace);
   const [item, setItem] = useState<ReviewItem | null | undefined>(undefined);
   // Switching sections is local: a route change per tab would remount this
   // pane and refetch both review lists for what is only a different view.
   const [active, setActive] = useState<ReviewSection>(section);

   const load = useCallback(async () => {
      if (!workspace) return;
      const [open, completed] = await Promise.all([
         loadReviews(workspace.id, 'open'),
         loadReviews(workspace.id, 'completed'),
      ]);
      setItem([...open, ...completed].find((candidate) => candidate.id === reviewId) ?? null);
   }, [workspace, reviewId]);

   useEffect(() => {
      void load();
   }, [load]);

   const decided = useCallback(
      async (outcome: ReviewOutcome) => {
         if (onDecided) await onDecided(outcome);
         else await load();
      },
      [onDecided, load]
   );

   if (item === undefined) {
      return (
         <div className="flex h-full items-center justify-center px-6 text-muted-foreground">
            {t('detail.loading')}
         </div>
      );
   }
   if (item === null) {
      return (
         <div className="flex h-full items-center justify-center px-6 text-muted-foreground">
            {t('detail.notFound')}
         </div>
      );
   }

   const status = reviewStatusOf(item);
   const waiting = item.issue.status === 'in_review';
   // Verdicts exist only where AutoGate asked agents to review, and a diff
   // only where a pull request was opened; a task without either has no such
   // tab, and an old link to one opens the overview.
   const shown: ReviewSection =
      (active === 'guide' && !item.issue.autoGate) || (active === 'diff' && !item.pullRequest)
         ? 'overview'
         : active;

   const selectSection = (next: ReviewSection) => {
      setActive(next);
      // The address follows the tab, so a reload or a shared link opens this
      // section, without navigating.
      window.history.replaceState(
         null,
         '',
         `/${orgId}/review/${item.id}${SECTION_PATH[next]}${listTab === 'created' ? '?list=created' : ''}`
      );
   };

   return (
      <div className="flex h-full flex-col overflow-hidden">
         <div className="flex h-10 min-w-0 shrink-0 items-center gap-2 border-b px-4">
            {onBack && (
               <button
                  type="button"
                  onClick={onBack}
                  className="-ml-1 inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none md:hidden"
                  aria-label={t('detail.backToList')}
               >
                  <ArrowLeft className="size-4" aria-hidden />
               </button>
            )}
            <Link
               href={`/${orgId}/issue/${item.issue.identifier}`}
               className="flex shrink-0 items-center gap-1.5 rounded-sm hover:opacity-80 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            >
               <IssueCheckIcon />
               <span className="font-medium">{item.issue.identifier}</span>
            </Link>
            <span className="shrink-0 text-muted-foreground" aria-hidden>
               ›
            </span>
            <PrIcon status={status} muted={waiting && !item.delivery.committed} />
            <h2 className="min-w-0 truncate" title={item.issue.title}>
               {item.issue.title}
            </h2>
            {item.delivery.committed && (
               <DiffStat
                  additions={item.delivery.insertions}
                  deletions={item.delivery.deletions}
                  className="shrink-0"
               />
            )}
            <span className="flex-1" />
            {item.pullRequest?.url && (
               <a
                  href={item.pullRequest.url}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 rounded-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
               >
                  {t('detail.pullRequest', { number: item.pullRequest.number })}
               </a>
            )}
         </div>
         <Tabs
            value={shown}
            onValueChange={(value) => selectSection(value as ReviewSection)}
            className="flex min-h-0 flex-1 flex-col gap-0"
         >
            <div className="flex h-10 shrink-0 items-center border-b px-4">
               <TabsList className="h-8">
                  <TabsTrigger value="overview">{t('sections.overview')}</TabsTrigger>
                  {item.issue.autoGate && (
                     <TabsTrigger value="guide">
                        {t('sections.verdicts')}
                        {item.verdicts.length > 0 && (
                           <span className="text-muted-foreground">{item.verdicts.length}</span>
                        )}
                     </TabsTrigger>
                  )}
                  {item.pullRequest && <TabsTrigger value="diff">{t('sections.diff')}</TabsTrigger>}
               </TabsList>
            </div>
            <TabsContent value="overview" className="min-h-0 flex-1 overflow-hidden">
               <ReviewOverview item={item} />
            </TabsContent>
            {item.issue.autoGate && (
               <TabsContent value="guide" className="min-h-0 flex-1 overflow-hidden">
                  <ReviewVerdicts item={item} />
               </TabsContent>
            )}
            {item.pullRequest && (
               <TabsContent value="diff" className="min-h-0 flex-1 overflow-hidden">
                  <ReviewDiff item={item} />
               </TabsContent>
            )}
         </Tabs>
         {waiting && (
            <ReviewDecisionBar
               key={item.id}
               item={item}
               onDecided={decided}
               className="shrink-0 border-t border-border/60 bg-container px-4 py-3"
            />
         )}
      </div>
   );
}
