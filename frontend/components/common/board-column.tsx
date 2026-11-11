'use client';

import { statusTone, type Status, type StatusTone } from '@/data/status';
import { cn } from '@/lib/utils';
import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode, Ref } from 'react';

/**
 * The column of a board: the task board and the project board draw the same
 * one, so the shell, the header tint and the drop affordances live here and
 * each board only supplies its own header label, drag type and cards.
 */

/* Not a token: the body colour is stated once in globals.css with no `.dark`
   counterpart on purpose, so it is read as a variable rather than a utility. */
const BOARD_COLUMN_BODY_BG = 'var(--board-column-body)';

/**
 * Header tint per tone: a wash of the status's own `--status-*` token over
 * the container (tokens in globals.css), so the column agrees with the glyph
 * in both themes. A group that is not a status (assignee, priority, ...) has
 * no tone of its own and stays neutral.
 */
const COLUMN_TINT: Record<StatusTone, string> = {
   neutral: 'bg-column-tint-neutral',
   info: 'bg-column-tint-info',
   warning: 'bg-column-tint-warning',
   success: 'bg-column-tint-success',
   danger: 'bg-column-tint-danger',
};

/** The tone a column takes: its status's, or neutral when it groups by anything else. */
export function columnTone(status?: Status): StatusTone {
   return status ? statusTone(status) : 'neutral';
}

export function BoardColumnHeader({
   tone,
   action,
   children,
}: {
   tone: StatusTone;
   /** The create button, kept to the right of the label. */
   action?: ReactNode;
   children: ReactNode;
}) {
   return (
      <div
         data-column-tint={tone}
         className={cn(
            'flex h-full w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1',
            COLUMN_TINT[tone]
         )}
      >
         <div className="flex min-w-0 items-center gap-2">{children}</div>
         {action ? <div className="flex shrink-0 items-center">{action}</div> : null}
      </div>
   );
}

/** Shell and sticky header. The body goes in as `children`. */
export function BoardColumn({ header, children }: { header: ReactNode; children: ReactNode }) {
   return (
      <div className="bg-container flex gap-4 h-full w-[278px] shrink-0 flex-col overflow-hidden rounded-lg">
         <div className="sticky top-0 z-10 h-9 w-full shrink-0 rounded-t-lg bg-container">
            {header}
         </div>
         {children}
      </div>
   );
}

/**
 * The scrolling body of a column, and the two drop affordances: a ring around
 * a column that already holds cards, and a dashed target when it is empty.
 * The `useDrop` itself stays with the caller, which is what knows the drag
 * type — pass its ref through.
 */
export function BoardColumnBody({
   ref,
   isOver,
   isEmpty,
   isOverEmpty,
   children,
}: {
   ref?: Ref<HTMLDivElement>;
   isOver?: boolean;
   isEmpty: boolean;
   isOverEmpty?: boolean;
   children: ReactNode;
}) {
   return (
      <div
         ref={ref}
         className={cn(
            // All four corners: the body is its own surface, separated from the
            // header by the column's gap, so a square top edge read as a cut.
            'relative flex min-h-0 flex-1 flex-col space-y-1.5 overflow-y-auto rounded-lg p-1.5 transition-shadow no-scrollbar',
            isOver && !isEmpty && 'ring-2 ring-inset ring-primary/35'
         )}
         style={{ backgroundColor: BOARD_COLUMN_BODY_BG }}
      >
         <AnimatePresence>
            {isOverEmpty && isEmpty && (
               <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.1 }}
                  className="pointer-events-none flex flex-1 items-center justify-center rounded-lg border border-dashed border-primary/40 bg-primary/5 p-4"
               >
                  <p className="font-medium text-muted-foreground">Drop to move here</p>
               </motion.div>
            )}
         </AnimatePresence>
         {children}
      </div>
   );
}
