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
         <div className="mb-1 flex items-center justify-between gap-2 pb-1">
            <h2 data-heading="label" className="text-muted-foreground">
               {title}
            </h2>
            {action}
         </div>
         {children}
      </section>
   );
}
