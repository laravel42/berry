import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

/**
 * The parts every page is set with, so the app reads as one hand: a page
 * opens by saying how much there is, in one figure and one sentence; small
 * capitals name a group or a column; a panel holds one subject. They carry no
 * data and no layout of their own beyond that, so a page adopts them without
 * changing what it does.
 *
 * Charts are not here. They belong to the Usage page
 * (`components/common/charts/charts.tsx`).
 */

/** One number in the display face (see `[data-figure]` in globals.css). */
export function Figure({
   size = 'lg',
   className,
   children,
}: {
   size?: 'hero' | 'xl' | 'lg' | 'md' | 'sm';
   className?: string | undefined;
   children: ReactNode;
}) {
   return (
      <span data-figure={size} className={className}>
         {children}
      </span>
   );
}

/** A small figure over what it counts. */
export function Fact({ value, label }: { value: string; label: string }) {
   return (
      <div className="flex min-w-0 flex-col">
         <Figure size="sm" className="font-sans font-medium">
            {value}
         </Figure>
         <span className="text-muted-foreground">{label}</span>
      </div>
   );
}

/** Small capitals: the name of a page, a group or a column. */
export function SectionLabel({
   as: Tag = 'span',
   className,
   children,
}: {
   as?: 'span' | 'h1' | 'h2' | 'h3' | 'div';
   className?: string | undefined;
   children: ReactNode;
}) {
   return (
      <Tag className={cn('font-medium tracking-wider text-muted-foreground uppercase', className)}>
         {children}
      </Tag>
   );
}

/**
 * The top of a list page: its name, the one figure it is about and a sentence
 * saying what that figure counts. The page's controls (tabs, search, filters)
 * stay in its own header below; `children` is for the page's one action.
 */
export function PageStatement({
   label,
   heading = 'h1',
   figure,
   tone = 'text-primary',
   line,
   sub,
   children,
}: {
   /** The page's name. Rendered as its `<h1>`. */
   label: string;
   /** `h2` where the page already has an `<h1>` above it, as every Settings page does. */
   heading?: 'h1' | 'h2';
   /** Omit while the count is unknown, so a loading page does not claim zero. */
   figure?: ReactNode;
   /** A text colour class for the figure. */
   tone?: string | undefined;
   line?: ReactNode;
   sub?: ReactNode;
   children?: ReactNode;
}) {
   return (
      <header className="flex w-full flex-col gap-3 border-b px-6 pt-4 pb-5">
         <div className="flex min-h-7 items-center justify-between gap-4">
            <SectionLabel as={heading}>{label}</SectionLabel>
            {children}
         </div>
         {figure !== undefined ? (
            <div className="flex items-end gap-4">
               <Figure size="xl" className={tone}>
                  {figure}
               </Figure>
               <div className="flex min-w-0 flex-col gap-0.5 pb-1">
                  {line ? <span className="font-medium">{line}</span> : null}
                  {sub ? <span className="text-muted-foreground">{sub}</span> : null}
               </div>
            </div>
         ) : null}
      </header>
   );
}

/** A panel: one subject, under its name. */
export function Panel({
   title,
   hint,
   className,
   children,
}: {
   title?: string | undefined;
   hint?: string | undefined;
   className?: string | undefined;
   children: ReactNode;
}) {
   return (
      <section
         className={cn('flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-5', className)}
      >
         {title ? (
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
               <h2 className="font-medium">{title}</h2>
               {hint ? <span className="text-muted-foreground">{hint}</span> : null}
            </div>
         ) : null}
         {children}
      </section>
   );
}

export interface Kpi {
   label: string;
   /** Omit while unknown: the card then shows a dash, never a zero it has not counted. */
   value?: ReactNode;
   /** One terse line of supporting figures. Data, not a sentence. */
   detail?: ReactNode;
   /** A text colour class for the value, when its state matters (`text-status-warning`). */
   tone?: string | undefined;
}

/**
 * A row of KPI cards: the figures a professional reads a page by. Each card is
 * a name, one number and one line of the numbers behind it.
 */
export function KpiStrip({ kpis }: { kpis: Kpi[] }) {
   return (
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
         {kpis.map((kpi) => (
            <div
               key={kpi.label}
               className="flex min-w-0 flex-col gap-2 rounded-xl border bg-card px-4 pt-3.5 pb-4"
            >
               <dt className="truncate font-medium tracking-wider text-muted-foreground uppercase">
                  {kpi.label}
               </dt>
               <dd className="flex min-w-0 flex-col gap-2">
                  <Figure size="lg" className={cn('whitespace-nowrap', kpi.tone)}>
                     {kpi.value ?? '–'}
                  </Figure>
                  {kpi.detail ? (
                     <span className="line-clamp-2 min-h-[2lh] text-muted-foreground">
                        {kpi.detail}
                     </span>
                  ) : null}
               </dd>
            </div>
         ))}
      </dl>
   );
}

/**
 * The top of an index page: its name and its search and create controls on one
 * line, over its KPI cards. The page's toolbar (layout, filter, panels) sits
 * below, in the page's own header.
 */
export function PageKpiHeader({
   label,
   kpis,
   children,
}: {
   label: string;
   kpis: Kpi[];
   /** Search and the page's one create action. */
   children?: ReactNode;
}) {
   return (
      <header className="flex w-full flex-col gap-3.5 border-b px-6 pt-3 pb-5">
         <div className="flex min-h-9 items-center gap-3">
            <SectionLabel as="h1">{label}</SectionLabel>
            <div className="ml-auto flex items-center gap-2">{children}</div>
         </div>
         <KpiStrip kpis={kpis} />
      </header>
   );
}
