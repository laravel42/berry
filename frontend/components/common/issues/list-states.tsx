'use client';

import { BerryMark } from '@/components/brand/berry-mark';
import { EmptyState, EmptyStateActions, EmptyStateText } from '@/components/common/empty-state';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useIssuesStore } from '@/store/issues-store';
import type { ViewType } from '@/store/view-store';
import { AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';

/** The load state of the task list, and the way back from a failure. */
export function useIssueListLoad() {
   const loadState = useIssuesStore((state) => state.loadState);
   const loadError = useIssuesStore((state) => state.loadError);
   const retry = useIssuesStore((state) => state.retryLoad);
   return { loadState, loadError, retry };
}

function Row() {
   return (
      <div className="flex items-center gap-3 border-b border-border/45 px-6 py-3">
         <Skeleton className="size-4 rounded-full" />
         <Skeleton className="h-3 w-16" />
         <Skeleton className="h-3 flex-1 max-w-96" />
         <Skeleton className="ml-auto size-6 rounded-full" />
      </div>
   );
}

function Card() {
   return (
      <div className="flex flex-col gap-2 rounded-lg border border-border/50 p-2">
         <Skeleton className="h-3 w-14" />
         <Skeleton className="h-3 w-full" />
         <Skeleton className="h-3 w-2/3" />
      </div>
   );
}

/**
 * The shape of the layout that is loading, rather than one spinner for all of
 * them: a board that resolves into a list, or a table that resolves into
 * cards, reads as the page changing its mind.
 */
export function IssueListSkeleton({ mode }: { mode: ViewType }) {
   if (mode === 'grid') {
      return (
         <div className="flex h-full min-w-max gap-3 px-4 py-3" aria-hidden>
            {[0, 1, 2].map((column) => (
               <div key={column} className="flex w-[278px] flex-col gap-1.5">
                  <Skeleton className="h-7 w-full rounded-lg" />
                  {[0, 1, 2].map((card) => (
                     <Card key={card} />
                  ))}
               </div>
            ))}
         </div>
      );
   }

   if (mode === 'table') {
      return (
         <div className="flex flex-col" aria-hidden>
            <div className="flex items-center gap-6 border-b px-4 py-2">
               {[0, 1, 2, 3].map((column) => (
                  <Skeleton key={column} className="h-3 w-24" />
               ))}
            </div>
            {[0, 1, 2, 3, 4, 5].map((row) => (
               <div key={row} className="flex items-center gap-6 border-b px-4 py-2.5">
                  <Skeleton className="h-3 w-40" />
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-3 w-24" />
               </div>
            ))}
         </div>
      );
   }

   return (
      <div className="flex flex-col" aria-hidden>
         <Skeleton className="mx-6 my-2 h-4 w-32" />
         {[0, 1, 2, 3, 4, 5, 6].map((row) => (
            <Row key={row} />
         ))}
      </div>
   );
}

const TAIL_SKELETON_ROWS = [
   { width: 'w-2/5 max-w-64', opacity: 'opacity-90' },
   { width: 'w-3/5 max-w-80', opacity: 'opacity-55' },
   { width: 'w-1/2 max-w-72', opacity: 'opacity-25' },
] as const;

/**
 * Tail loader shown while background task pages are still arriving: fading
 * row silhouettes that match the layout above, closed by Berry's pulsing mark.
 */
export function IssueListMoreLoader({ mode = 'list', label }: { mode?: ViewType; label: string }) {
   if (mode === 'grid') {
      return (
         <div
            role="status"
            aria-live="polite"
            className="flex h-10 items-center justify-center gap-2 text-muted-foreground"
         >
            <BerryMark size="sm" tone="brand" pulse />
            <span>{label}</span>
         </div>
      );
   }

   return (
      <div
         role="status"
         aria-live="polite"
         className="w-full bg-container animate-[berry-row-in_140ms_ease-out]"
      >
         <div aria-hidden>
            {TAIL_SKELETON_ROWS.map((row, index) => (
               <div
                  key={index}
                  className={cn(
                     'flex items-center gap-3 border-b border-border/45',
                     mode === 'table' ? 'h-[38px] px-4' : 'h-10 px-4 sm:px-6',
                     row.opacity
                  )}
               >
                  <Skeleton className="size-3.5 shrink-0 rounded-full" />
                  <Skeleton className="hidden h-3 w-14 shrink-0 sm:block" />
                  <Skeleton className={cn('h-3', row.width)} />
                  <Skeleton className="ml-auto size-5 shrink-0 rounded-full" />
               </div>
            ))}
         </div>
         <div className="flex h-12 items-center justify-center gap-2 text-muted-foreground">
            <BerryMark size="sm" tone="brand" pulse />
            <span>{label}</span>
         </div>
      </div>
   );
}

/** The list could not be loaded at all — say why, and offer the way back. */
export function IssueListError({ message, onRetry }: { message: string; onRetry: () => void }) {
   const t = useTranslations('issueLists');

   return (
      <EmptyState icon={<AlertTriangle className="size-5 text-status-warning" />}>
         <EmptyStateText>{message || t('states.loadFailed')}</EmptyStateText>
         <EmptyStateActions>
            <Button variant="secondary" onClick={onRetry}>
               {t('states.retry')}
            </Button>
         </EmptyStateActions>
      </EmptyState>
   );
}
