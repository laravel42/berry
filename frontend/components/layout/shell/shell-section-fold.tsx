'use client';

import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

/**
 * A rail section heading that folds its list, the same control Manage uses.
 * The visible word is the button name, so a screen reader does not hear the
 * label change as the section opens and closes. Radix supplies aria-expanded
 * and aria-controls.
 */
export function ShellSectionFold({
   heading,
   open,
   onOpenChange,
   children,
}: {
   heading: string;
   open: boolean;
   onOpenChange: (open: boolean) => void;
   children: ReactNode;
}) {
   return (
      <Collapsible open={open} onOpenChange={onOpenChange}>
         <div className="px-3 pt-2 lg:pt-[11px]">
            <CollapsibleTrigger asChild>
               <button
                  type="button"
                  data-heading="label"
                  className="group/fold flex min-h-11 w-full cursor-pointer items-center gap-1 rounded px-3 py-[7px] text-left text-[var(--shell-text-dim)] transition-colors hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text-muted)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)] lg:min-h-0"
               >
                  {heading}
                  <ChevronRight
                     size={12}
                     strokeWidth={1.8}
                     aria-hidden="true"
                     className="transition-transform group-data-[state=open]/fold:rotate-90 motion-reduce:transition-none"
                  />
               </button>
            </CollapsibleTrigger>
         </div>
         <CollapsibleContent>{children}</CollapsibleContent>
      </Collapsible>
   );
}
