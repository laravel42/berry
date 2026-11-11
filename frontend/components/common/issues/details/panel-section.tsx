import type { ReactNode } from 'react';

/**
 * One labelled block of a task's sidebar or detail column: a `<section>`
 * headed by a section-label `<h2>`, with an optional trailing `action`
 * (an add button, a count) on the heading row.
 */
export function Section({
   title,
   action,
   className,
   children,
}: {
   title: string;
   action?: ReactNode;
   /** Layout for the section itself, e.g. `flex flex-col gap-1` to space the rows below. */
   className?: string;
   children: ReactNode;
}) {
   return (
      <section className={className}>
         {/* Same label as a project's sidebar blocks (`DetailSectionLabel`):
             the dim shell tone at the label weight, not the bolder h2. */}
         <div className="mb-1 flex min-h-6 items-center justify-between gap-2 pb-1">
            <h2 data-heading="label" className="font-semibold text-[var(--shell-text-dim)]">
               {title}
            </h2>
            {action}
         </div>
         {children}
      </section>
   );
}
