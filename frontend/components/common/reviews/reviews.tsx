'use client';

import { BerryMark } from '@/components/brand/berry-mark';
import {
   EmptyState,
   EmptyStateLoading,
   EmptyStateMark,
   EmptyStateText,
} from '@/components/common/empty-state';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
   loadReviews,
   reviewTimeAgo,
   stoppedWithoutDelivering,
   type ReviewItem,
   type ReviewQueueState,
} from '@/lib/reviews';
import { useSessionStore } from '@/store/session-store';
import { X } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import {
   useCallback,
   useEffect,
   useRef,
   useState,
   type PointerEvent as ReactPointerEvent,
   type ReactNode,
} from 'react';
import type { ReviewOutcome } from './review-decision-bar';
import { ReviewDetail, type ReviewSection } from './review-detail';
import { DiffStat, PeerVerdictChip, PrIcon } from './review-shared';

/** How a task at the gate reads in the list: what the last decision on it was. */
export function reviewStatusOf(item: ReviewItem): 'open' | 'merged' | 'closed' {
   if (item.issue.status === 'in_review') return 'open';
   if (item.issue.status === 'done') return 'merged';
   return 'closed';
}

function rowId(reviewId: string): string {
   return `review-row-${reviewId}`;
}

const LIST_WIDTH = 360;
const LIST_WIDTH_MIN = 240;
const LIST_WIDTH_MAX = 560;

function clampListWidth(width: number): number {
   return Math.min(LIST_WIDTH_MAX, Math.max(LIST_WIDTH_MIN, Math.round(width)));
}

/**
 * What the run left behind, on the row's second line: the pull request and
 * its size, or the plain fact that nothing was committed. Without this every
 * waiting row looked like a delivery, and most were not.
 */
function DeliveryFacts({ item }: { item: ReviewItem }) {
   const t = useTranslations('reviews');
   if (item.delivery.committed) {
      return (
         <>
            <span className={item.pullRequest ? 'text-foreground' : undefined}>
               {item.pullRequest
                  ? t('detail.pullRequest', { number: item.pullRequest.number })
                  : t('facts.noPullRequest')}
            </span>
            <DiffStat additions={item.delivery.insertions} deletions={item.delivery.deletions} />
         </>
      );
   }
   return (
      <>
         {item.pullRequest && (
            <span className="text-foreground">
               {t('detail.pullRequest', { number: item.pullRequest.number })}
            </span>
         )}
         {item.delivery.producedFiles > 0 ? (
            <span className="text-foreground">
               {t('facts.producedFiles', { count: item.delivery.producedFiles })}
            </span>
         ) : (
            <span>{t('facts.nothingCommitted')}</span>
         )}
      </>
   );
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
   const status = reviewStatusOf(item);
   const href = `/${orgId}/review/${item.id}${listTab === 'created' ? '?list=created' : ''}`;
   return (
      <Link
         // Soft-selects the right pane; unmodified left-click updates the URL
         // without remounting the list. Modifier-clicks still open a real link.
         id={rowId(item.id)}
         href={href}
         aria-current={selected ? 'true' : undefined}
         onClick={(event) => {
            if (
               event.metaKey ||
               event.ctrlKey ||
               event.shiftKey ||
               event.altKey ||
               event.button !== 0
            ) {
               return;
            }
            event.preventDefault();
            onSelect(item.id);
         }}
         className={cn(
            'flex flex-col gap-0.5 border-b border-border/40 px-4 py-2.5 transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset focus-visible:outline-none',
            selected ? 'bg-accent/70 hover:bg-accent/70' : 'hover:bg-accent/40'
         )}
      >
         <span className="flex items-start gap-2">
            <PrIcon
               status={status}
               muted={status === 'open' && !item.delivery.committed}
               className="pt-px"
            />
            <span className="shrink-0 pt-px text-muted-foreground">{item.issue.identifier}</span>
            <span className="line-clamp-2 min-w-0 flex-1 break-words" title={item.issue.title}>
               {item.issue.title}
            </span>
            {item.issue.autoGate && latest && latest.approved !== null && (
               <PeerVerdictChip verdict={latest} />
            )}
            <span className="shrink-0 pt-px text-muted-foreground">
               {reviewTimeAgo(item.run.completedAt ?? item.updatedAt)}
            </span>
         </span>
         <span className="flex flex-wrap items-center gap-x-2 pl-6 text-muted-foreground">
            <DeliveryFacts item={item} />
         </span>
      </Link>
   );
}

/** Collapsible status group: the header arrow really opens and closes the rows. */
function ReviewGroup({
   label,
   count,
   children,
}: {
   label: string;
   count: number;
   children: ReactNode;
}) {
   const [open, setOpen] = useState(true);
   return (
      <div>
         <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className="flex w-full cursor-pointer select-none items-center gap-1.5 border-b border-border/40 bg-muted/50 px-4 py-1.5 transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset focus-visible:outline-none"
         >
            <span data-heading="label">{label}</span>
            <svg
               width="8"
               height="8"
               viewBox="0 0 8 8"
               className={cn(
                  'text-muted-foreground transition-transform duration-200',
                  !open && '-rotate-90'
               )}
               aria-hidden
            >
               <path d="M1 3l3 3 3-3" stroke="currentColor" strokeWidth="1.2" fill="none" />
            </svg>
            <span className="ml-auto text-status-success">{count}</span>
         </button>
         <div
            className={cn(
               'grid transition-[grid-template-rows] duration-200 ease-out',
               open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
            )}
         >
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
 * decision on the right refreshes the left, announces what happened and
 * moves on to the next task waiting.
 */
export default function Reviews({
   listTab = 'for-you',
   selectedReviewId,
   section = 'overview',
}: ReviewsProps) {
   const t = useTranslations('reviews');
   const { orgId } = useParams<{ orgId: string }>();
   const workspace = useSessionStore((state) => state.workspace);
   const state: ReviewQueueState = listTab === 'for-you' ? 'open' : 'completed';
   const [items, setItems] = useState<ReviewItem[] | null>(null);
   const [error, setError] = useState<string | null>(null);
   const [outcome, setOutcome] = useState<ReviewOutcome | null>(null);
   // Selection is local so clicking a row hydrates the right pane without
   // remounting this list (a Next navigation between /reviews and /review/:id
   // would reload both sides).
   const [selectedId, setSelectedId] = useState(selectedReviewId);
   const caughtUpRef = useRef<HTMLHeadingElement>(null);
   const [listWidth, setListWidth] = useState(LIST_WIDTH);

   /** Drags the list's right edge. Pointer capture keeps the move over the detail pane. */
   const resizeList = (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const target = event.currentTarget;
      const start = listWidth;
      const origin = event.clientX;
      target.setPointerCapture(event.pointerId);
      const move = (moved: PointerEvent) =>
         setListWidth(clampListWidth(start + (moved.clientX - origin)));
      const end = () => {
         target.removeEventListener('pointermove', move);
         target.removeEventListener('pointerup', end);
         target.removeEventListener('pointercancel', end);
      };
      target.addEventListener('pointermove', move);
      target.addEventListener('pointerup', end);
      target.addEventListener('pointercancel', end);
   };

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

   const listPath = `/${orgId}/reviews${listTab === 'created' ? '/created' : ''}`;

   const selectReview = useCallback(
      (id: string) => {
         setSelectedId(id);
         const path = `/${orgId}/review/${id}${listTab === 'created' ? '?list=created' : ''}`;
         window.history.pushState(null, '', path);
      },
      [orgId, listTab]
   );

   const clearSelection = useCallback(() => {
      setSelectedId(undefined);
      window.history.pushState(null, '', listPath);
   }, [listPath]);

   const fetchItems = useCallback(async (): Promise<ReviewItem[] | null> => {
      if (!workspace) return null;
      try {
         const loaded = await loadReviews(workspace.id, state);
         setItems(loaded);
         setError(null);
         return loaded;
      } catch (cause) {
         setError(cause instanceof Error ? cause.message : t('loading'));
         return null;
      }
   }, [workspace, state, t]);

   useEffect(() => {
      void fetchItems();
   }, [fetchItems]);

   /**
    * After a decision the decided task leaves the waiting list. The next one
    * down takes its place on the right and its row takes focus, so a reviewer
    * working through the queue never has to reach for the list; when nothing
    * is left the pane says so and takes focus itself.
    */
   const handleDecided = useCallback(
      async (decided: ReviewOutcome) => {
         const previous = items ?? [];
         const index = previous.findIndex((item) => item.id === decided.reviewId);
         const fresh = await fetchItems();
         setOutcome(decided);
         if (state !== 'open') return;
         const remaining = (fresh ?? previous).filter((item) => item.id !== decided.reviewId);
         const next =
            previous.slice(index + 1).find((item) => remaining.some((r) => r.id === item.id)) ??
            remaining[0];
         if (next) {
            selectReview(next.id);
            requestAnimationFrame(() => document.getElementById(rowId(next.id))?.focus());
         } else {
            clearSelection();
            requestAnimationFrame(() => caughtUpRef.current?.focus());
         }
      },
      [items, fetchItems, state, selectReview, clearSelection]
   );

   // The waiting list splits in two. A run that stopped without committing
   // anything or opening a pull request has nothing to approve — it needs
   // help — and sits above the real deliveries so the two are never confused.
   const all = items ?? [];
   const sentBack = all.filter((item) => reviewStatusOf(item) === 'closed');
   const needsHelp = all.filter(
      (item) => reviewStatusOf(item) === 'open' && stoppedWithoutDelivering(item)
   );
   const groups = (
      state === 'open'
         ? [
              { key: 'needsHelp', label: t('groups.needsHelp'), items: needsHelp },
              {
                 key: 'waiting',
                 label: t('groups.waiting'),
                 items: all.filter(
                    (item) => reviewStatusOf(item) === 'open' && !stoppedWithoutDelivering(item)
                 ),
              },
              { key: 'sentBack', label: t('groups.sentBack'), items: sentBack },
           ]
         : [
              {
                 key: 'approved',
                 label: t('groups.approved'),
                 items: all.filter((item) => reviewStatusOf(item) === 'merged'),
              },
              { key: 'sentBack', label: t('groups.sentBack'), items: sentBack },
           ]
   ).filter((group) => group.items.length > 0);

   const outcomeText = outcome
      ? outcome.decision === 'approve'
         ? t('outcome.approved', { identifier: outcome.identifier })
         : t('outcome.sentBack', { identifier: outcome.identifier })
      : null;

   const caughtUp = items !== null && items.length === 0 && state === 'open';

   return (
      <div
         className="flex h-full w-full overflow-hidden"
         style={{ ['--reviews-list-w' as string]: `${listWidth}px` }}
      >
         <div
            className={cn(
               'relative flex h-full min-w-0 shrink-0 flex-col border-r bg-container',
               'w-full md:w-[var(--reviews-list-w)]',
               selectedId ? 'hidden md:flex' : 'flex'
            )}
         >
            <div className="shrink-0 px-4 py-[6px]">
               <Tabs value={listTab} className="gap-0">
                  <TabsList className="h-9">
                     <TabsTrigger value="for-you" asChild>
                        <Link href={`/${orgId}/reviews`}>{t('tabs.waiting')}</Link>
                     </TabsTrigger>
                     <TabsTrigger value="created" asChild>
                        <Link href={`/${orgId}/reviews/created`}>{t('tabs.decided')}</Link>
                     </TabsTrigger>
                  </TabsList>
               </Tabs>
            </div>
            <div className="flex-1 overflow-y-auto">
               {items === null && !error && <EmptyStateLoading label={t('loading')} />}
               {error && (
                  <div className="px-4 py-6 text-muted-foreground" role="alert">
                     {error}
                  </div>
               )}
               {groups.map((group) => (
                  <ReviewGroup key={group.key} label={group.label} count={group.items.length}>
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
                  <EmptyState
                     icon={
                        <EmptyStateMark
                           label={state === 'open' ? t('empty.open') : t('empty.decided')}
                        />
                     }
                  >
                     <EmptyStateText>
                        {state === 'open' ? t('empty.open') : t('empty.decided')}
                     </EmptyStateText>
                  </EmptyState>
               )}
            </div>
            <span
               className="absolute inset-y-0 right-0 z-10 hidden w-1.5 cursor-col-resize md:block"
               style={{ touchAction: 'none' }}
               onPointerDown={resizeList}
               role="separator"
               aria-orientation="vertical"
               aria-valuenow={listWidth}
               aria-valuemin={LIST_WIDTH_MIN}
               aria-valuemax={LIST_WIDTH_MAX}
               aria-label={t('resizeList')}
            />
         </div>

         <div
            className={cn(
               'flex h-full min-w-0 flex-1 flex-col overflow-hidden',
               selectedId ? 'flex w-full' : 'hidden md:flex'
            )}
         >
            {outcomeText && (
               <div
                  role="status"
                  className="flex shrink-0 items-center gap-3 border-b border-border/60 bg-muted/50 px-4 py-2"
               >
                  <BerryMark
                     size="sm"
                     tone={outcome?.decision === 'approve' ? 'complete' : 'attention'}
                     state="solid"
                  />
                  <span className="min-w-0 flex-1">{outcomeText}</span>
                  <button
                     type="button"
                     onClick={() => setOutcome(null)}
                     aria-label={t('outcome.dismiss')}
                     className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                     <X className="size-4" aria-hidden />
                  </button>
               </div>
            )}
            {selectedId ? (
               <div className="min-h-0 flex-1">
                  <ReviewDetail
                     // Keyed by review: the section tab is local state, and a
                     // different review should open on the section its link names.
                     key={selectedId}
                     reviewId={selectedId}
                     section={section}
                     listTab={listTab}
                     onDecided={handleDecided}
                     onBack={clearSelection}
                  />
               </div>
            ) : (
               <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 px-6 text-center text-muted-foreground">
                  {caughtUp ? (
                     <>
                        <h2
                           ref={caughtUpRef}
                           tabIndex={-1}
                           className="text-foreground outline-none"
                        >
                           {t('outcome.caughtUp')}
                        </h2>
                        <p>{t('outcome.caughtUpBody')}</p>
                     </>
                  ) : (
                     <>
                        <p className="text-foreground">
                           {state === 'open' ? t('select.open') : t('select.decided')}
                        </p>
                        {items && (
                           <p>
                              {t(state === 'open' ? 'count.open' : 'count.decided', {
                                 count: items.length,
                              })}
                              {state === 'open' && needsHelp.length > 0
                                 ? ` · ${t('count.needsHelp', { count: needsHelp.length })}`
                                 : ''}
                           </p>
                        )}
                     </>
                  )}
               </div>
            )}
         </div>
      </div>
   );
}
