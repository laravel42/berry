'use client';

import { Issue } from '@/data/issues';
import { Status } from '@/data/status';
import { useDisplaySettingsStore } from '@/store/display-settings-store';
import { useIssuesStore } from '@/store/issues-store';
import { format } from 'date-fns';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { DragSourceMonitor, useDrag, useDragLayer, useDrop } from 'react-dnd';
import { getEmptyImage } from 'react-dnd-html5-backend';
import { ActorLiveMark, useIssueLiveRun } from './actor-avatar';
import { AssigneeUser } from './assignee-user';
import { LabelBadge } from './label-badge';
import { IssuePriorityPicker } from './issue-pickers';
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu';
import { IssueContextMenu } from './issue-context-menu';
import { WORKSPACE_SLUG } from '@/lib/config';
import { cn } from '@/lib/utils';

export const IssueDragType = 'ISSUE';

type IssueGridProps = {
   issue: Issue;
   index: number;
   columnIssueIds: string[];
   columnStatus?: Status;
   /** Applies the column's grouped value to a card dropped onto this one. */
   onDropIssue?: (issue: Issue) => void;
};

function IssueDragPreview({ issue }: { issue: Issue }) {
   return (
      <div className="w-full overflow-hidden rounded-lg border border-[var(--board-card-line)] bg-void px-3.5 py-2 text-chalk shadow-lg">
         <div className="mb-1.5 flex min-w-0 items-center gap-1.5">
            <IssuePriorityPicker issue={issue} />
            <span className="min-w-0 truncate text-subtle-foreground">{issue.identifier}</span>
            <span className="ml-auto shrink-0 whitespace-nowrap text-muted-foreground">
               {format(new Date(issue.createdAt), 'MMM dd')}
            </span>
         </div>
         {/* Plain text, not a heading: the ghost is a transient copy of the
             card that only exists mid-drag, so it has nothing to contribute to
             the document outline. */}
         <div className="mb-2 line-clamp-2 font-medium">{issue.title}</div>
         <div className="mb-2 flex min-h-[1.25rem] flex-wrap gap-1">
            <LabelBadge label={issue.labels} />
         </div>
         <div className="mt-auto flex min-w-0 justify-end pt-1">
            <AssigneeUser user={issue.assignee} issueId={issue.id} monogram={false} showName />
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

export function IssueGrid({
   issue,
   index,
   columnIssueIds,
   columnStatus,
   onDropIssue,
}: IssueGridProps) {
   const cardRef = useRef<HTMLDivElement>(null);
   const insertBeforeIdRef = useRef<string | null | undefined>(undefined);
   const { orgId } = useParams<{ orgId: string }>();
   const { displayProperties } = useDisplaySettingsStore();
   const moveIssue = useIssuesStore((state) => state.moveIssue);
   const [dropEdge, setDropEdge] = useState<'top' | 'bottom' | null>(null);
   const liveRun = useIssueLiveRun(issue);

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
      <div ref={cardRef} className="relative">
         {isOver && dropEdge === 'top' ? (
            <div className="pointer-events-none absolute inset-x-1 top-0 z-20 h-0.5 -translate-y-1/2 rounded-full bg-primary" />
         ) : null}
         {isOver && dropEdge === 'bottom' ? (
            <div className="pointer-events-none absolute inset-x-1 bottom-0 z-20 h-0.5 translate-y-1/2 rounded-full bg-primary" />
         ) : null}
         <ContextMenu>
            <ContextMenuTrigger asChild>
               <div
                  className={cn(
                     'group relative w-full cursor-grab rounded-lg bg-void px-3.5 py-2 text-chalk transition-colors active:cursor-grabbing',
                     /* Not the themed `--border`, which would turn near-white on a
                        card that stays dark in both themes. `--board-card-line` is
                        the column behind it lifted a step, so the edge reads as a
                        seam. In dark the card and the column resolve to the same
                        colour, which leaves this border as the only thing marking
                        where one ends -- the shadow has nothing to fall against
                        and does its work in light mode. */
                     'border border-[var(--board-card-line)] shadow-sm',
                     'hover:bg-base',
                     isOver && 'ring-1 ring-primary/40',
                     isOver && dropEdge === 'top' && 'mt-1',
                     isOver && dropEdge === 'bottom' && 'mb-1'
                  )}
                  style={{ opacity: isDragging ? 0.45 : 1 }}
               >
                  <div className="min-w-0">
                     <div className="mb-1.5 flex min-w-0 items-center gap-1.5">
                        {displayProperties.priority ? (
                           <span className="relative z-[1] flex shrink-0 items-center">
                              <IssuePriorityPicker issue={issue} />
                           </span>
                        ) : null}
                        {liveRun ? (
                           <ActorLiveMark run={liveRun} fallbackName={issue.assignee?.name} />
                        ) : null}
                        {displayProperties.id ? (
                           <span className="min-w-0 truncate whitespace-nowrap text-subtle-foreground">
                              {issue.identifier}
                           </span>
                        ) : null}
                        {displayProperties.created ? (
                           <span className="ml-auto shrink-0 whitespace-nowrap text-muted-foreground">
                              {format(new Date(issue.createdAt), 'MMM dd')}
                           </span>
                        ) : null}
                     </div>
                     {/* The link covers the card through its pseudo-element,
                         so the card's hover promise -- the whole thing lifts
                         -- is kept by the whole thing. Priority and assignee
                         sit above it as their own controls. */}
                     <Link
                        href={`/${orgId ?? WORKSPACE_SLUG}/issue/${issue.identifier}`}
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
                           className="mb-2 line-clamp-2 font-medium"
                           role="heading"
                           aria-level={4}
                        >
                           {issue.title}
                        </div>
                     </Link>
                     <div className="relative z-[1] mb-2 flex min-h-[1.25rem] flex-wrap gap-1">
                        {displayProperties.labels && <LabelBadge label={issue.labels} />}
                     </div>
                     {displayProperties.assignee ? (
                        <div className="relative z-[1] mt-auto flex min-w-0 justify-end pt-1">
                           <AssigneeUser
                              user={issue.assignee}
                              issueId={issue.id}
                              monogram={false}
                              showName
                           />
                        </div>
                     ) : null}
                  </div>
               </div>
            </ContextMenuTrigger>
            <IssueContextMenu issueId={issue.id} />
         </ContextMenu>
      </div>
   );
}
