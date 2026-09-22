'use client';

import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';

/**
 * The Inbox layout, for any short list: the list in a rail on the left, the
 * selected item's detail on the right. On a phone the rail is the page and a
 * selection replaces it, so the detail needs its own way back.
 */
export function SplitIndex({
   rail,
   detail,
   selected,
}: {
   rail: ReactNode;
   detail: ReactNode;
   /** Whether something is selected: decides which side a phone shows. */
   selected: boolean;
}) {
   return (
      <div className="flex h-full min-h-0 w-full">
         <div
            className={cn(
               'flex h-full min-h-0 w-full shrink-0 flex-col border-r bg-container md:w-[40%] md:max-w-[520px]',
               selected ? 'hidden md:flex' : 'flex'
            )}
         >
            {rail}
         </div>
         <div
            className={cn(
               'h-full min-h-0 min-w-0 flex-1 flex-col bg-container',
               selected ? 'flex' : 'hidden md:flex'
            )}
         >
            {detail}
         </div>
      </div>
   );
}

/**
 * Selects the first row when nothing is selected and there is room for both
 * sides. A phone shows the list first, so it is left alone there.
 *
 * The selection lives in the URL, and opening something from the detail pane
 * (a task, in its drawer) rewrites the URL without it. The page stays mounted,
 * so the last selection is remembered and put back rather than jumping to the
 * first row under the person's feet.
 */
export function useSelectFirst(
   selectedId: string | null,
   ids: string[],
   select: (id: string | null) => void
) {
   const first = ids[0] ?? null;
   const missing = selectedId !== null && ids.length > 0 && !ids.includes(selectedId);
   const last = useRef<string | null>(null);
   if (selectedId !== null && !missing) last.current = selectedId;
   useEffect(() => {
      if (!first) return;
      if (selectedId !== null && !missing) return;
      if (!window.matchMedia('(min-width: 768px)').matches) {
         if (missing) select(null);
         return;
      }
      select(last.current && ids.includes(last.current) ? last.current : first);
   }, [first, ids, selectedId, missing, select]);
}
