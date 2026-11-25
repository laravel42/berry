import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * One list row sketched in: a mark, a short id, a title, and a trailing
 * avatar. The widths step down row by row so the block reads as a list of
 * different items rather than one repeated stripe.
 */
function SkeletonRow({ index }: { index: number }) {
   const title = ['max-w-96', 'max-w-80', 'max-w-[26rem]', 'max-w-72', 'max-w-[22rem]'][index % 5];
   return (
      <div className="flex items-center gap-3 border-b border-border/45 px-2 py-3 sm:px-5">
         <Skeleton className="size-4 shrink-0 rounded-full" />
         <Skeleton className="h-3 w-14 shrink-0 max-sm:hidden" />
         <Skeleton className={cn('h-3 flex-1', title)} />
         <Skeleton className="ml-auto size-6 shrink-0 rounded-full" />
      </div>
   );
}

/**
 * The rows of a section list while its first load is in flight. It replaces
 * the "Loading…" mark: the list's own shape, so the page does not change its
 * mind when the rows land. `label` is announced; the shapes are not.
 */
export function ListSkeleton({ label, rows = 8 }: { label: string; rows?: number }) {
   return (
      <div role="status" aria-busy="true" className="flex w-full flex-col">
         <span className="sr-only">{label}</span>
         <div aria-hidden>
            {Array.from({ length: rows }, (_, index) => (
               <SkeletonRow key={index} index={index} />
            ))}
         </div>
      </div>
   );
}

/**
 * A whole section between a click and its page landing: the header bar, the
 * toolbar under it, and the list. Matches `PageKpiHeader` (52px, `px-5`) so
 * the real header replaces it without a jump.
 */
export function SectionSkeleton({ label }: { label: string }) {
   return (
      <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-container text-foreground">
         <div
            aria-hidden
            className="flex h-[52px] shrink-0 items-center gap-3 border-b px-2 sm:px-5"
         >
            <Skeleton className="h-4 w-28" />
            <Skeleton className="ml-auto h-8 w-28 rounded-full max-sm:hidden" />
            <Skeleton className="h-8 w-24 rounded-full max-sm:ml-auto" />
         </div>
         <div aria-hidden className="flex h-12 shrink-0 items-center gap-2 border-b px-2 sm:px-5">
            <Skeleton className="h-7 w-20 rounded-full" />
            <Skeleton className="ml-auto h-7 w-32 rounded-lg" />
         </div>
         <ListSkeleton label={label} />
      </div>
   );
}
