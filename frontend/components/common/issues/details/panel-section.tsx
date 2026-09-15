import type { ReactNode } from 'react';

/** One labelled block of the task properties sidebar. */
export function Section({
   title,
   action,
   children,
}: {
   title: string;
   action?: ReactNode;
   children: ReactNode;
}) {
   return (
      <section>
         <div className="mb-2 flex items-center justify-between gap-2 pb-[7px]">
            <h2 data-heading="label" className="text-muted-foreground">
               {title}
            </h2>
            {action}
         </div>
         {children}
      </section>
   );
}
