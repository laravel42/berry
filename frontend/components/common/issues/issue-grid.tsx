'use client';

import { Issue } from '@/data/issues';
import { Status } from '@/data/status';
import { useDisplaySettingsStore } from '@/store/display-settings-store';
import { useIssuesStore } from '@/store/issues-store';
import { format } from 'date-fns';
import Link from 'next/link';
import { useIssueHref } from './use-issue-href';
import { memo, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { MoreVertical } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { DragSourceMonitor, useDrag, useDragLayer, useDrop } from 'react-dnd';
import { getEmptyImage } from 'react-dnd-html5-backend';
import { ActorLiveMark, useIssueLiveRun } from './actor-avatar';
import { AutoGateMark } from './auto-gate-mark';
import { AssigneeUser } from './assignee-user';
import { LabelBadge } from './label-badge';
import { IssuePriorityPicker } from './issue-pickers';
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu';
import { IssueContextMenu, type IssueMoveTo } from './issue-context-menu';

import { cn } from '@/lib/utils';
import { isSameValue } from '@/lib/same-value';

import { BoardMoveContext, IssueDragType, type BoardMove } from './issue-dnd';

// Re-exported so the callers that import them from here keep working.
export { BoardMoveContext, IssueDragType };
export type { BoardMove };

type IssueGridProps = {
   issue: Issue;
   index: number;
   columnIssueIds: string[];
   columnStatus?: Status;
   /** The board column this card is in; Move to marks it as current. */
   columnId?: string;
   /** Applies the column's grouped value to a card dropped onto this one. */
   onDropIssue?: (issue: Issue) => void;
};

function IssueDragPreview({ issue }: { issue: Issue }) {
   return (
      <div
         data-board-card
         className="w-full overflow-hidden rounded-lg border border-[var(--board-card-line)] bg-[var(--board-card)] px-3.5 py-2 text-[var(--board-card-foreground)] shadow-lg"
      >
         <div className="mb-1.5 flex min-w-0 items-center gap-1.5">
            <span data-identifier className="min-w-0 truncate text-subtle-foreground">
               {issue.identifier}
            </span>
            {issue.autoGate ? <AutoGateMark /> : null}
            <span className="ml-auto -mr-1.5 flex shrink-0 items-center">
               <IssuePriorityPicker issue={issue} />
            </span>
         </div>
         {/* Plain text, not a heading: the ghost is a transient copy of the
             card that only exists mid-drag, so it has nothing to contribute to
             the document outline. */}
         <div data-card-title className="mb-2 line-clamp-2">
            {issue.title}
         </div>
         <div className="mb-2 flex min-h-[1.25rem] flex-wrap gap-1">
            <LabelBadge label={issue.labels} />
         </div>
         <div className="mt-auto flex min-w-0 items-center justify-between gap-2 pt-1">
            <span data-card-date className="shrink-0 whitespace-nowrap text-muted-foreground">
               {format(new Date(issue.createdAt), 'MMM dd')}
            </span>
            <span className="-mr-1.5 flex shrink-0 items-center">
               <AssigneeUser user={issue.assignee} issueId={issue.id} monogram={false} />
            </span>
         </div>
      </div>
   );
}

export function CustomDragLayer() {
   const { itemType, isDragging, item, currentOffset } = useDragLayer((monitor) => ({
      item: monitor.getItem() as Issue,
      itemType: monitor.getItemType(),
      currentOffset: monitor.getSourceClientOffset(),
      isDragging: monitor.isDragging(),
   }));

   if (!isDragging || itemType !== IssueDragType || !currentOffset) {
      return null;
   }

   return (
      <div
         className="fixed pointer-events-none z-50 left-0 top-0"
         style={{
            transform: `translate(${currentOffset.x}px, ${currentOffset.y}px)`,
            width: '266px',
         }}
      >
         <IssueDragPreview issue={item} />
      </div>
   );
}

function IssueGridCard({
   issue,
   index,
   columnIssueIds,
   columnStatus,
   columnId,
   onDropIssue,
}: IssueGridProps) {
   const cardRef = useRef<HTMLDivElement>(null);
   const insertBeforeIdRef = useRef<string | null | undefined>(undefined);
   const issueHref = useIssueHref();
   const { displayProperties } = useDisplaySettingsStore();
   const moveIssue = useIssuesStore((state) => state.moveIssue);
   const [dropEdge, setDropEdge] = useState<'top' | 'bottom' | null>(null);
   const liveRun = useIssueLiveRun(issue);
   const t = useTranslations('issueLists');
   const board = useContext(BoardMoveContext);
   const innerRef = useRef<HTMLDivElement>(null);
   const moveTo = useMemo<IssueMoveTo | undefined>(
      () =>
         board && columnId !== undefined
            ? {
                 columns: board.columns,
                 currentId: columnId,
                 replacesStatus: board.replacesStatus,
                 onMove: (target) => board.move(target, issue),
              }
            : undefined,
      [board, columnId, issue]
   );

   const columnKey = columnIssueIds.join(',');

   const [{ isDragging }, drag, preview] = useDrag(
      () => ({
         type: IssueDragType,
         item: () => issue,
         collect: (monitor: DragSourceMonitor) => ({
            isDragging: monitor.isDragging(),
         }),
      }),
      [issue]
   );

   useEffect(() => {
      preview(getEmptyImage(), { captureDraggingState: true });
   }, [preview]);

   const [{ isOver }, drop] = useDrop(
      () => ({
         accept: IssueDragType,
         canDrop: (item: Issue) => item.id !== issue.id,
         hover(draggedItem: Issue, monitor) {
            if (!cardRef.current || draggedItem.id === issue.id) {
               return;
            }

            const rect = cardRef.current.getBoundingClientRect();
            const offset = monitor.getClientOffset();
            if (!offset) return;

            const middleY = (rect.bottom - rect.top) / 2;
            const clientY = offset.y - rect.top;
            const insertAfter = clientY > middleY;

            setDropEdge(insertAfter ? 'bottom' : 'top');
            insertBeforeIdRef.current = insertAfter
               ? index + 1 < columnIssueIds.length
                  ? columnIssueIds[index + 1]
                  : null
               : issue.id;
         },
         drop(draggedItem: Issue, monitor) {
            if (monitor.didDrop()) return;
            const insertBeforeId = insertBeforeIdRef.current;
            if (insertBeforeId === undefined) return;

            moveIssue(draggedItem.id, {
               targetStatus: columnStatus,
               insertBeforeId,
            });
            // A card dropped from another column lands in this one's group, so
            // whatever the board is grouped by takes this column's value.
            onDropIssue?.(draggedItem);
            insertBeforeIdRef.current = undefined;
            setDropEdge(null);
         },
         collect: (monitor) => ({
            isOver: monitor.isOver() && monitor.canDrop(),
         }),
      }),
      [issue.id, index, columnKey, columnStatus, moveIssue, onDropIssue]
   );

   drag(drop(cardRef));

   useEffect(() => {
      if (!isOver) {
         setDropEdge(null);
      }
   }, [isOver]);

   return (
      <div ref={cardRef} className="relative shrink-0 animate-[berry-row-in_140ms_ease-out]">
         {isOver && dropEdge === 'top' ? (
            <div className="pointer-events-none absolute inset-x-1 top-0 z-20 h-0.5 -translate-y-1/2 rounded-full bg-primary" />
         ) : null}
         {isOver && dropEdge === 'bottom' ? (
            <div className="pointer-events-none absolute inset-x-1 bottom-0 z-20 h-0.5 translate-y-1/2 rounded-full bg-primary" />
         ) : null}
         <ContextMenu>
            <ContextMenuTrigger asChild>
               <div
                  ref={innerRef}
                  data-board-card
                  className={cn(
                     'group relative w-full cursor-grab rounded-lg bg-[var(--board-card)] px-3.5 py-2 text-[var(--board-card-foreground)] transition-colors active:cursor-grabbing',
                     /* Not the themed `--border`, which would turn near-white on a
                        card that stays dark in both themes. `--board-card-line` is
                        the column behind it lifted a step, so the edge reads as a
                        seam. In dark the card and the column resolve to the same
                        colour, which leaves this border as the only thing marking
                        where one ends -- the shadow has nothing to fall against
                        and does its work in light mode. */
                     'border border-[var(--board-card-line)] shadow-sm',
                     'hover:border-[var(--board-card-hover-line)]',
                     isOver && 'ring-1 ring-primary/40',
                     isOver && dropEdge === 'top' && 'mt-1',
                     isOver && dropEdge === 'bottom' && 'mb-1'
                  )}
                  style={{ opacity: isDragging ? 0.45 : 1 }}
               >
                  <div className="min-w-0">
                     <div className="mb-1.5 flex min-w-0 items-center gap-1.5">
                        {liveRun ? (
                           <ActorLiveMark run={liveRun} fallbackName={issue.assignee?.name} />
                        ) : null}
                        {displayProperties.id ? (
                           /* `data-identifier` is the hook for a task's ref:
                              the rule in globals.css gives it the mono face
                              and tabular figures, so BER-9 and BER-11 line up
                              down a column. */
                           <span
                              data-identifier
                              className="min-w-0 truncate whitespace-nowrap text-subtle-foreground"
                           >
                              {issue.identifier}
                           </span>
                        ) : null}
                        {issue.autoGate ? <AutoGateMark /> : null}
                        <div className="ml-auto -mr-1.5 flex shrink-0 items-center">
                           {displayProperties.priority ? (
                              <span
                                 className={cn(
                                    'relative z-[1] flex shrink-0 items-center',
                                    // On touch screens the overflow menu already sits beside
                                    // this slot and offers Priority; hiding the three-dash
                                    // "no priority" glyph avoids two ellipsis-like icons in a row.
                                    issue.priority.id === 'no-priority' &&
                                       '[@media(hover:none)]:hidden'
                                 )}
                              >
                                 <IssuePriorityPicker issue={issue} />
                              </span>
                           ) : null}
                           {/* A finger has no right-click and no hover, so a touch
                               screen gets a visible button that opens the card's
                               menu where it stands. Pointer devices keep the
                               right-click. */}
                           <button
                              type="button"
                              aria-label={t('menu.cardActions')}
                              className="relative z-[1] flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 [@media(hover:hover)]:hidden"
                              onClick={(event) => {
                                 const rect = event.currentTarget.getBoundingClientRect();
                                 innerRef.current?.dispatchEvent(
                                    new MouseEvent('contextmenu', {
                                       bubbles: true,
                                       cancelable: true,
                                       view: window,
                                       clientX: rect.left,
                                       clientY: rect.bottom,
                                    })
                                 );
                              }}
                           >
                              <MoreVertical className="size-4" aria-hidden />
                           </button>
                        </div>
                     </div>
                     {/* The link covers the card through its pseudo-element,
                         so the card's hover promise -- the whole thing lifts
                         -- is kept by the whole thing. Priority and assignee
                         sit above it as their own controls. */}
                     <Link
                        href={issueHref(issue.identifier)}
                        className="block outline-none before:absolute before:inset-0 before:rounded-lg focus-visible:before:ring-[3px] focus-visible:before:ring-ring/50"
                        draggable={false}
                        onClick={(event) => {
                           if (isDragging) event.preventDefault();
                        }}
                     >
                        {/* Sized as body text, so under the type scale it
                            cannot be an h1-h4 -- those carry sizes. The
                            heading role keeps what the element was giving
                            back: a grid of cards is skimmed by its titles,
                            and dropping to a bare div would leave screen
                            readers tabbing every card to find one. */}
                        <div
                           data-card-title
                           className="mb-2 line-clamp-2"
                           role="heading"
                           aria-level={4}
                        >
                           {issue.title}
                        </div>
                     </Link>
                     <div className="relative z-[1] mb-2 flex min-h-[1.25rem] flex-wrap gap-1">
                        {displayProperties.labels && <LabelBadge label={issue.labels} />}
                     </div>
                     {displayProperties.created || displayProperties.assignee ? (
                        <div className="relative z-[1] mt-auto flex min-w-0 items-center gap-2 pt-1">
                           {displayProperties.created ? (
                              <span
                                 data-card-date
                                 className="shrink-0 whitespace-nowrap text-muted-foreground"
                              >
                                 {format(new Date(issue.createdAt), 'MMM dd')}
                              </span>
                           ) : null}
                           {displayProperties.assignee ? (
                              <span className="ml-auto -mr-1.5 flex shrink-0 items-center">
                                 <AssigneeUser
                                    user={issue.assignee}
                                    issueId={issue.id}
                                    monogram={false}
                                 />
                              </span>
                           ) : null}
                        </div>
                     ) : null}
                  </div>
               </div>
            </ContextMenuTrigger>
            <IssueContextMenu issueId={issue.id} moveTo={moveTo} />
         </ContextMenu>
      </div>
   );
}

/**
 * A card renders when its own task, its place in the column or the drop it
 * performs changes. The column's ids are rebuilt on every render, so they are
 * compared by content; the drop callback is compared by reference, because a
 * stale one would apply the grouping the board had before.
 */
function sameIssueGridProps(previous: IssueGridProps, next: IssueGridProps): boolean {
   return (
      previous.issue === next.issue &&
      previous.index === next.index &&
      isSameValue(previous.columnStatus, next.columnStatus) &&
      previous.columnId === next.columnId &&
      isSameValue(previous.columnIssueIds, next.columnIssueIds) &&
      previous.onDropIssue === next.onDropIssue
   );
}

export const IssueGrid = memo(IssueGridCard, sameIssueGridProps);
