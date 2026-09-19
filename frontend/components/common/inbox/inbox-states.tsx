'use client';

import type { BerryMarkState } from '@/components/brand/berry-mark';
import {
   EmptyState,
   EmptyStateActions,
   EmptyStateMark,
   EmptyStateText,
   EmptyStateTitle,
} from '@/components/common/empty-state';
import { Button } from '@/components/ui/button';

interface InboxPanelProps {
   title: string;
   body?: string;
   /** The mark's treatment: hollow for "nothing here", crossed for "gone". */
   state?: BerryMarkState;
   action?: { label: string; onClick: () => void };
}

/**
 * What either pane shows when it has no rows to show.
 *
 * One component for loading, empty, no-matches and failed, because the four
 * differ only in what they say and whether there is something to do about it.
 */
export function InboxPanel({ title, body, state = 'hollow', action }: InboxPanelProps) {
   return (
      <EmptyState icon={<EmptyStateMark label={title} state={state} />}>
         <EmptyStateTitle variant="plain">{title}</EmptyStateTitle>
         {body ? <EmptyStateText>{body}</EmptyStateText> : null}
         {action ? (
            <EmptyStateActions>
               <Button variant="outline" size="sm" onClick={action.onClick}>
                  {action.label}
               </Button>
            </EmptyStateActions>
         ) : null}
      </EmptyState>
   );
}
