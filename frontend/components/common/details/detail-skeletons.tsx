import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * Placeholders for a task's and a project's detail while it loads, laid out
 * like the real thing: the header bar, the main column (title, meta,
 * description, the page's own sections, activity, the composer) and the
 * 292px properties column. Shown by `PendingDetailDrawer` the moment a
 * row is clicked, and by the detail components while their record is on its
 * way, so the reader sees where everything will be instead of a blank panel
 * or a "Loading…" line.
 *
 * Widths are fixed rather than random so the server and the client draw the
 * same thing.
 */

/** The 52px bar the detail headers sit in: breadcrumb left, actions right. */
export function DetailHeaderSkeleton() {
   return (
      <div
         aria-hidden
         className="flex h-[52px] w-full shrink-0 items-center justify-between border-b px-5"
      >
         <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="size-3 rounded-sm" />
            <Skeleton className="size-5 rounded" />
            <Skeleton className="h-4 w-44" />
         </div>
         <div className="flex items-center gap-1.5">
            <Skeleton className="size-7 rounded-md" />
            <Skeleton className="size-7 rounded-md" />
            <Skeleton className="size-7 rounded-md" />
         </div>
      </div>
   );
}

/** A task detail: sub-tasks under the description, then activity. */
export function IssueDetailSkeleton({ label = 'Loading task' }: { label?: string }) {
   return (
      <DetailFrame label={label}>
         <TitleBlock chips={3} />
         <DescriptionBlock />
         <SubTasksBlock />
         <ActivityBlock />
      </DetailFrame>
   );
}

/**
 * The sub-tasks section as `SubIssues` draws it: the collapsible heading
 * (chevron, "Sub-tasks", progress), the progress bar, the rows, and the box
 * for adding one with its two buttons.
 */
function SubTasksBlock() {
   return (
      <div className="flex flex-col gap-2.5">
         <div className="flex items-center gap-2">
            <Skeleton className="size-3.5 rounded-sm" />
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-3.5 w-10" />
         </div>
         <Skeleton className="h-1.5 w-full rounded-full" />
         <RowSkeleton />
         <RowSkeleton />
         <div className="flex items-center gap-2">
            <Skeleton className="h-11 flex-1 rounded-full" />
            <Skeleton className="h-11 w-20 rounded-full" />
            <Skeleton className="h-11 w-24 rounded-full" />
         </div>
      </div>
   );
}

/** A project overview: plan and goals, its tasks, then updates. */
export function ProjectOverviewSkeleton({ label = 'Loading project' }: { label?: string }) {
   return (
      <DetailFrame label={label}>
         <TitleBlock icon chips={0} />
         <DescriptionBlock />
         <SectionBlock title="w-20">
            <Skeleton className="h-16 w-full rounded-lg" />
         </SectionBlock>
         <SectionBlock title="w-16" divided>
            <RowSkeleton />
            <RowSkeleton />
            <RowSkeleton />
         </SectionBlock>
         <ActivityBlock />
      </DetailFrame>
   );
}

/** Main column, composer and properties column, as the detail views lay them out. */
function DetailFrame({ label, children }: { label: string; children: React.ReactNode }) {
   return (
      <div
         aria-busy="true"
         className="grid h-full min-h-0 w-full grid-cols-1 overflow-hidden bg-container lg:grid-cols-[minmax(0,1fr)_auto]"
      >
         <span className="sr-only">{label}</span>
         <div aria-hidden className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-hidden">
               <div className="mx-auto flex max-w-3xl flex-col gap-7 px-6 py-6 sm:px-8 sm:py-8">
                  {children}
               </div>
            </div>
            <div className="shrink-0 border-t border-border/60">
               <div className="mx-auto w-full max-w-3xl px-6 py-3 sm:px-8">
                  <div className="flex h-[46px] items-center justify-between rounded-lg border border-border bg-muted/15 px-2.5">
                     <Skeleton className="h-4 w-40" />
                     <Skeleton className="size-8 rounded-full" />
                  </div>
               </div>
            </div>
         </div>
         <PropertiesSkeleton />
      </div>
   );
}

function TitleBlock({ icon = false, chips }: { icon?: boolean; chips: number }) {
   return (
      <div className="flex flex-col gap-3">
         {icon ? <Skeleton className="size-9 rounded-lg" /> : null}
         <Skeleton className="h-7 w-2/3" />
         {chips > 0 ? (
            <div className="flex gap-2">
               {Array.from({ length: chips }, (_, i) => (
                  <Skeleton key={i} className={cn('h-6 rounded-full', CHIP_WIDTHS[i])} />
               ))}
            </div>
         ) : null}
      </div>
   );
}

const CHIP_WIDTHS = ['w-20', 'w-24', 'w-16'];

function DescriptionBlock() {
   return (
      <div className="flex flex-col gap-2.5">
         <Skeleton className="h-3.5 w-full" />
         <Skeleton className="h-3.5 w-11/12" />
         <Skeleton className="h-3.5 w-4/5" />
         <Skeleton className="h-3.5 w-1/2" />
      </div>
   );
}

function SectionBlock({
   title,
   divided = false,
   children,
}: {
   title: string;
   divided?: boolean;
   children: React.ReactNode;
}) {
   return (
      <div className={cn('flex flex-col gap-2.5', divided && 'border-t border-border/60 pt-5')}>
         <Skeleton className={cn('h-4', title)} />
         {children}
      </div>
   );
}

/** One list row: status glyph, title, trailing avatar. */
function RowSkeleton() {
   return (
      <div className="flex h-9 items-center gap-3 rounded-md border border-border/60 px-3">
         <Skeleton className="size-3.5 rounded-full" />
         <Skeleton className="h-3.5 w-14" />
         <Skeleton className="h-3.5 flex-1" />
         <Skeleton className="size-5 rounded-full" />
      </div>
   );
}

function ActivityBlock() {
   return (
      <div className="flex flex-col gap-4 border-t border-border/60 pt-5">
         <Skeleton className="h-4 w-20" />
         {['w-1/2', 'w-2/5', 'w-3/5'].map((width) => (
            <div key={width} className="flex items-start gap-3">
               <Skeleton className="size-6 shrink-0 rounded-full" />
               <div className="flex flex-1 flex-col gap-2 pt-1">
                  <Skeleton className={cn('h-3.5', width)} />
                  <Skeleton className="h-3 w-1/4" />
               </div>
            </div>
         ))}
      </div>
   );
}

/** The 292px properties column: label/value pairs, then a group of chips. */
function PropertiesSkeleton() {
   return (
      <aside
         aria-hidden
         className="hidden h-full w-[292px] shrink-0 flex-col gap-5 overflow-hidden border-l bg-muted/15 px-5 pt-6 pb-3.5 lg:flex"
      >
         <Skeleton className="h-3.5 w-20" />
         <div className="flex flex-col gap-4">
            {['w-24', 'w-28', 'w-20', 'w-32', 'w-24', 'w-16'].map((width, i) => (
               <div key={i} className="flex items-center justify-between gap-3">
                  <Skeleton className="h-3.5 w-16" />
                  <Skeleton className={cn('h-5', width)} />
               </div>
            ))}
         </div>
         <div className="flex flex-col gap-2.5 border-t border-border/60 pt-5">
            <Skeleton className="h-3.5 w-14" />
            <div className="flex flex-wrap gap-1.5">
               <Skeleton className="h-6 w-16 rounded-full" />
               <Skeleton className="h-6 w-20 rounded-full" />
               <Skeleton className="h-6 w-12 rounded-full" />
            </div>
         </div>
      </aside>
   );
}
