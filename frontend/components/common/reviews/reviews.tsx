'use client';

import { BerryMark } from '@/components/brand/berry-mark';
import { cn } from '@/lib/utils';
import { loadReviews, reviewTimeAgo, type ReviewItem, type ReviewQueueState } from '@/lib/reviews';
import { useSessionStore } from '@/store/session-store';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { ReactNode, useCallback, useEffect, useState } from 'react';
import { ReviewDetail, ReviewSection } from './review-detail';
import { PrIcon } from './review-shared';

/** Hand-drawn empty-state sketch (paper plane over a folded sheet). */
function EmptySketch() {
   return (
      <svg width="150" height="120" viewBox="0 0 150 120" fill="none" aria-hidden>
         <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M28 78l58-22 34 30-64 16z" />
            <path d="M28 78l30-6 28 28" />
            <path d="M86 56l-8 40" strokeDasharray="4 4" />
            <path d="M104 34c8-10 22-12 26-6s-4 16-14 18" />
            <path d="M116 46c-4 2-8 2-12 0" />
            <path d="M44 66l6-2M56 84l6-2M70 92l6-2" strokeDasharray="3 4" />
         </g>
      </svg>
   );
}

/** How a task at the gate reads in the list: what the last decision on it was. */
export function reviewStatusOf(item: ReviewItem): 'open' | 'merged' | 'closed' {
   if (item.issue.status === 'in_review') return 'open';
   if (item.issue.status === 'done') return 'merged';
   return 'closed';
}

function ReviewRow({
   item,
   orgId,
   selected,
   listTab,
   onSelect,
}: {
   item: ReviewItem;
   orgId: string;
   selected: boolean;
   listTab: ReviewList;
   onSelect: (id: string) => void;
}) {
   const latest = item.verdicts[0];
   const href = `/${orgId}/review/${item.id}${listTab === 'created' ? '?list=created' : ''}`;
   return (
      <Link
         // Soft-selects the right pane; unmodified left-click updates the URL
         // without remounting the list. Modifier-clicks still open a real link.
         href={href}
         onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
               return;
            }
            event.preventDefault();
            onSelect(item.id);
         }}
         className={cn(
            'mt-px flex items-start gap-2 border-b border-border/40 px-4 py-3 transition-colors',
            selected
               ? 'bg-[#99a2b220] hover:bg-[#99a2b22e]'
               : 'bg-[#99a2b210] hover:bg-[#99a2b218]'
         )}
      >
         <PrIcon status={reviewStatusOf(item)} />
         <span className="text-muted-foreground shrink-0 pt-px">{item.issue.identifier}</span>
         <span className="min-w-0 flex-1 whitespace-normal break-words">
            {item.issue.title}
         </span>
         {item.issue.autoGate && latest && latest.approved !== null && (
            <span
               className={cn(
                  'shrink-0 rounded px-1.5 py-px',
                  latest.approved
                     ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                     : 'bg-red-500/10 text-red-600'
               )}
               title={`Peer review by ${latest.reviewer}`}
            >
               {latest.approved ? 'peer ok' : 'peer no'}
            </span>
         )}
         <span className="shrink-0 pt-px text-muted-foreground">
            {reviewTimeAgo(item.run.completedAt ?? item.updatedAt)}
         </span>
      </Link>
   );
}

/** Collapsible status group: the header arrow really opens and closes the rows. */
function ReviewGroup({ label, count, children }: { label: string; count: number; children: ReactNode }) {
   const [open, setOpen] = useState(true);
   return (
      <div>
         <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className="flex w-full cursor-pointer select-none items-center gap-1.5 border-b border-border/40 px-4 py-1.5 font-medium transition-colors"
            style={{ backgroundColor: '#eb575710' }}
         >
            {label}
            <svg width="8" height="8" viewBox="0 0 8 8" className={cn('text-muted-foreground transition-transform duration-200', !open && '-rotate-90')} aria-hidden>
               <path d="M1 3l3 3 3-3" stroke="currentColor" strokeWidth="1.2" fill="none" />
            </svg>
            <span className="ml-auto text-muted-foreground font-normal">{count}</span>
         </button>
         <div className={cn('grid transition-[grid-template-rows] duration-200 ease-out', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
            <div className="overflow-hidden">{children}</div>
         </div>
      </div>
   );
}

/** The two lists: what waits for a decision, and what was decided. */
export type ReviewList = 'for-you' | 'created';

interface ReviewsProps {
   /** Which list tab is active ("/reviews" waits, "/reviews/created" decided). */
   listTab?: ReviewList;
   /** Selected review (detail routes). The id is the task's. */
   selectedReviewId?: string;
   section?: ReviewSection;
}

/**
 * Reviews split view: the tasks at the review gate on the left, the evidence
 * for one on the right. Loaded from the API for the active workspace; a
 * decision on the right refreshes the left.
 */
export default function Reviews({ listTab = 'for-you', selectedReviewId, section = 'overview' }: ReviewsProps) {
   const t = useTranslations('reviews');
   const { orgId } = useParams<{ orgId: string }>();
   const workspace = useSessionStore((state) => state.workspace);
   const state: ReviewQueueState = listTab === 'for-you' ? 'open' : 'completed';
   const [items, setItems] = useState<ReviewItem[] | null>(null);
   const [error, setError] = useState<string | null>(null);
   // Selection is local so clicking a row hydrates the right pane without
   // remounting this list (a Next navigation between /reviews and /review/:id
   // would reload both sides).
   const [selectedId, setSelectedId] = useState(selectedReviewId);

   useEffect(() => {
      setSelectedId(selectedReviewId);
   }, [selectedReviewId]);

   useEffect(() => {
      const onPopState = () => {
         const match = window.location.pathname.match(/\/review\/([^/]+)/);
         setSelectedId(match?.[1]);
      };
      window.addEventListener('popstate', onPopState);
      return () => window.removeEventListener('popstate', onPopState);
   }, []);

   const selectReview = useCallback(
      (id: string) => {
         setSelectedId(id);
         const path = `/${orgId}/review/${id}${listTab === 'created' ? '?list=created' : ''}`;
         window.history.pushState(null, '', path);
      },
      [orgId, listTab]
   );

   const reload = useCallback(async () => {
      if (!workspace) return;
      try {
         setItems(await loadReviews(workspace.id, state));
         setError(null);
      } catch (cause) {
         setError(cause instanceof Error ? cause.message : 'Could not load reviews');
      }
   }, [workspace, state]);

   useEffect(() => {
      void reload();
   }, [reload]);

   const groups = [
      {
         label: state === 'open' ? t('groups.waiting') : t('groups.approved'),
         status: state === 'open' ? 'open' : 'merged',
      },
      { label: t('groups.sentBack'), status: 'closed' },
   ]
      .map((group) => ({ ...group, items: (items ?? []).filter((item) => reviewStatusOf(item) === group.status) }))
      .filter((group) => group.items.length > 0);

   return (
      <div className="w-full h-full flex overflow-hidden">
         <div className="flex h-full w-[40%] shrink-0 flex-col border-r bg-container">
            <div className="flex items-center justify-between px-4 py-1.5 h-10 border-b shrink-0">
               <span className="font-medium">{t('title')}</span>
            </div>
            <div className="flex items-center gap-1.5 px-4 py-2 shrink-0">
               <Link
                  href={`/${orgId}/reviews`}
                  className={cn(
                     'px-2.5 py-1 rounded-md border font-medium transition-colors',
                     listTab === 'for-you'
                        ? 'border-azure/50 bg-azure/20 text-foreground'
                        : 'border-transparent text-muted-foreground hover:bg-accent/50'
                  )}
               >
                  {t('tabs.waiting')}
               </Link>
               <Link
                  href={`/${orgId}/reviews/created`}
                  className={cn(
                     'px-2.5 py-1 rounded-md border font-medium transition-colors',
                     listTab === 'created'
                        ? 'border-azure/50 bg-azure/20 text-foreground'
                        : 'border-transparent text-muted-foreground hover:bg-accent/50'
                  )}
               >
                  {t('tabs.decided')}
               </Link>
            </div>
            <div className="flex-1 overflow-y-auto">
               {items === null && !error && <div className="px-4 py-6 text-muted-foreground">{t('loading')}</div>}
               {error && <div className="px-4 py-6 text-muted-foreground" role="alert">{error}</div>}
               {groups.map((group) => (
                  <ReviewGroup key={group.label} label={group.label} count={group.items.length}>
                     {group.items.map((item) => (
                        <ReviewRow
                           key={item.id}
                           item={item}
                           orgId={orgId}
                           selected={item.id === selectedId}
                           listTab={listTab}
                           onSelect={selectReview}
                        />
                     ))}
                  </ReviewGroup>
               ))}
               {items !== null && items.length === 0 && !error && (
                  <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
                     <BerryMark
                        size="lg"
                        tone="neutral"
                        state="hollow"
                        label={state === 'open' ? t('empty.open') : t('empty.decided')}
                     />
                     <p className="max-w-[16rem] leading-relaxed text-muted-foreground">
                        {state === 'open' ? t('empty.open') : t('empty.decided')}
                     </p>
                  </div>
               )}
            </div>
         </div>

         <div className="h-full min-w-0 w-[60%] overflow-hidden">
            {selectedId ? (
               <ReviewDetail
                  // Keyed by review: the section tab is local state, and a
                  // different review should open on the section its link names.
                  key={selectedId}
                  reviewId={selectedId}
                  section={section}
                  listTab={listTab}
                  onDecided={reload}
               />
            ) : (
               <div className="h-full flex flex-col items-center justify-center gap-4 text-muted-foreground">
                  <EmptySketch />
                  <span className="flex items-center gap-2">
                     <BerryMark size="sm" tone="neutral" />
                     {items ? t(state === 'open' ? 'count.open' : 'count.decided', { count: items.length }) : ''}
                  </span>
               </div>
            )}
         </div>
      </div>
   );
}
