'use client';

import { BoardColumn, BoardColumnBody, BoardColumnHeader, columnTone } from '../board-column';
import type { Issue } from '@/data/issues';
import type { Status, StatusTone } from '@/data/status';
import { useIssuesStore } from '@/store/issues-store';
import { useCreateIssueStore } from '@/store/create-issue-store';
import { cn } from '@/lib/utils';
import { useVirtualRows } from '@/lib/use-virtual-rows';
import { ChevronDown, Plus } from 'lucide-react';
import { FC, ReactNode, useRef } from 'react';
import { useDrop } from 'react-dnd';
import { Button } from '../../ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { IssueDragType, IssueGrid } from './issue-grid';
import { IssueLine } from './issue-line';
import { useIssueListView } from './use-issue-list-view';

/**
 * Generic descriptor of an issue group. Groups are usually statuses but the
 * "Display" settings also allow grouping by assignee / priority / project /
 * parent / a workspace field.
 */
export interface IssueGroupDescriptor {
   id: string;
   name: string;
   /**
    * No longer read here: the header tint comes from the status tone, and a
    * group without a status is neutral. Left optional so the builders that
    * still fill it keep compiling until they drop it.
    */
   color?: string;
   icon: ReactNode;
   /** Set when grouping by status: enables board drop + "+" default status. */
   status?: Status;
}

interface GroupIssuesProps {
   group: IssueGroupDescriptor;
   /** Issues of the group, already sorted upstream. */
   issues: Issue[];
   count: number;
   /**
    * Applies this group's value to a task dropped into it — the status of a
    * status column, the person of an assignee column, and so on. Set by the
    * view that knows what the grouping means.
    */
   onDropIssue?: (issue: Issue) => void;
}

/** Beyond this many cards a column renders only the ones in view. */
const VIRTUALIZE_ABOVE = 40;
const ESTIMATED_CARD_HEIGHT = 104;

/**
 * The list group bar takes the lighter wash of the same semantic tone the
 * board column takes (`COLUMN_TINT`, in `board-column.tsx`), so a status reads
 * the same in both layouts.
 */
const GROUP_TINT: Record<StatusTone, string> = {
   neutral: 'bg-group-tint-neutral',
   info: 'bg-group-tint-info',
   warning: 'bg-group-tint-warning',
   success: 'bg-group-tint-success',
   danger: 'bg-group-tint-danger',
};

function GroupHeaderBar({
   group,
   count,
   isViewTypeGrid,
   showChevron,
   canCollapse,
}: {
   group: IssueGroupDescriptor;
   count: number;
   isViewTypeGrid: boolean;
   showChevron: boolean;
   canCollapse: boolean;
}) {
   const { openModal } = useCreateIssueStore();

   const label = (
      <>
         {showChevron ? (
            <ChevronDown
               aria-hidden
               className={cn(
                  'size-3.5 shrink-0 transition-transform duration-200 group-data-[state=closed]/issue-group:-rotate-90',
                  canCollapse ? 'text-muted-foreground' : 'text-muted-foreground/35'
               )}
            />
         ) : null}
         {group.icon}
         {/* A group header names a column of the board, so it takes the title
             face (JetBrains Mono) like every other heading. It is a `span` and
             not an `h*`: the header is a button that collapses the group, and
             the base layer's heading rules go by element. */}
         <span className="font-mono font-medium">{group.name}</span>
         <span className="font-mono text-muted-foreground tabular-nums">{count}</span>
      </>
   );

   const createButton = (
      <Button
         className={cn(isViewTypeGrid ? 'size-5' : 'size-6')}
         size="icon"
         variant="ghost"
         aria-label={`Create task in ${group.name}`}
         onClick={(event) => {
            event.stopPropagation();
            openModal(group.status);
         }}
      >
         <Plus className={cn(isViewTypeGrid ? 'size-3.5' : 'size-4')} />
      </Button>
   );

   const tone = columnTone(group.status);

   if (isViewTypeGrid) {
      return (
         <BoardColumnHeader tone={tone} action={createButton}>
            {label}
         </BoardColumnHeader>
      );
   }

   return (
      <div className="sticky top-0 z-10 h-9 w-full bg-container">
         <div
            data-column-tint={tone}
            className={cn('flex h-full w-full items-center justify-between px-6', GROUP_TINT[tone])}
         >
            {showChevron ? (
               <CollapsibleTrigger asChild>
                  <button
                     type="button"
                     disabled={!canCollapse}
                     className={cn(
                        'flex h-full min-w-0 flex-1 items-center gap-2 rounded-sm text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                        canCollapse ? 'cursor-pointer' : 'cursor-default'
                     )}
                  >
                     {label}
                  </button>
               </CollapsibleTrigger>
            ) : (
               <div className="flex items-center gap-2">{label}</div>
            )}
            {createButton}
         </div>
      </div>
   );
}

/** The rows of a list group, and the drop target that moves a task into it. */
const IssueLineList: FC<{
   issues: Issue[];
   onDropIssue?: (issue: Issue) => void;
}> = ({ issues, onDropIssue }) => {
   const ref = useRef<HTMLDivElement>(null);
   const orderIds = issues.map((issue) => issue.id);

   const [{ isOver }, drop] = useDrop(
      () => ({
         accept: IssueDragType,
         canDrop: () => onDropIssue !== undefined,
         drop(item: Issue, monitor) {
            if (monitor.didDrop()) return;
            onDropIssue?.(item);
         },
         collect: (monitor) => ({ isOver: monitor.isOver() && monitor.canDrop() }),
      }),
      [onDropIssue]
   );
   drop(ref);

   return (
      <div ref={ref} className={cn('space-y-0 transition-colors', isOver && 'bg-accent/30')}>
         {issues.map((issue) => (
            <IssueLine key={issue.id} issue={issue} layoutId={true} order={orderIds} draggable />
         ))}
      </div>
   );
};

export function GroupIssues({ group, issues, count, onDropIssue }: GroupIssuesProps) {
   // The URL's `layout` wins over the stored preference, as it does for the
   // view around this group; a shared `?layout=grid` link shows the board.
   const { mode } = useIssueListView();
   const isViewTypeGrid = mode === 'grid';
   const showChevron = !isViewTypeGrid;
   const canCollapse = issues.length > 0;

   const header = (
      <GroupHeaderBar
         group={group}
         count={count}
         isViewTypeGrid={isViewTypeGrid}
         showChevron={showChevron}
         canCollapse={canCollapse}
      />
   );

   if (isViewTypeGrid) {
      return (
         <BoardColumn header={header}>
            <IssueGridList issues={issues} status={group.status} onDropIssue={onDropIssue} />
         </BoardColumn>
      );
   }

   return (
      <Collapsible defaultOpen disabled={!canCollapse} className="group/issue-group bg-container">
         {header}
         <CollapsibleContent>
            <IssueLineList issues={issues} onDropIssue={onDropIssue} />
         </CollapsibleContent>
      </Collapsible>
   );
}

const IssueGridList: FC<{
   issues: Issue[];
   status?: Status;
   onDropIssue?: (issue: Issue) => void;
}> = ({ issues, status, onDropIssue }) => {
   const ref = useRef<HTMLDivElement>(null);
   const moveIssue = useIssuesStore((state) => state.moveIssue);
   const columnIssueIds = issues.map((issue) => issue.id);
   // A long column renders only what is on screen. The estimate is coarse
   // because cards are not all the same height, but scrolling a thousand
   // mounted cards is worse than a scrollbar that settles a little.
   const virtual = useVirtualRows(issues.length, ESTIMATED_CARD_HEIGHT);
   const windowed = issues.length > VIRTUALIZE_ABOVE;

   const [{ isOverColumn, isOverEmpty }, drop] = useDrop(
      () => ({
         accept: IssueDragType,
         canDrop: () => status !== undefined || onDropIssue !== undefined,
         drop(item: Issue, monitor) {
            if (monitor.didDrop()) return;
            if (status) moveIssue(item.id, { targetStatus: status, insertBeforeId: null });
            onDropIssue?.(item);
         },
         collect: (monitor) => ({
            isOverColumn: monitor.isOver() && monitor.canDrop(),
            isOverEmpty: monitor.isOver({ shallow: true }) && monitor.canDrop(),
         }),
      }),
      [status, moveIssue, onDropIssue]
   );
   drop(ref);

   const visible = windowed ? issues.slice(virtual.start, virtual.end) : issues;

   return (
      <BoardColumnBody
         ref={(node) => {
            ref.current = node;
            virtual.ref.current = node;
         }}
         isOver={isOverColumn}
         isOverEmpty={isOverEmpty}
         isEmpty={issues.length === 0}
      >
         {windowed ? <div style={{ height: virtual.offset }} aria-hidden /> : null}
         {visible.map((issue, index) => (
            <IssueGrid
               key={issue.id}
               issue={issue}
               index={(windowed ? virtual.start : 0) + index}
               columnIssueIds={columnIssueIds}
               columnStatus={status}
               onDropIssue={onDropIssue}
            />
         ))}
         {windowed ? (
            <div
               style={{
                  height: Math.max(0, virtual.totalHeight - virtual.end * ESTIMATED_CARD_HEIGHT),
               }}
               aria-hidden
            />
         ) : null}
      </BoardColumnBody>
   );
};
