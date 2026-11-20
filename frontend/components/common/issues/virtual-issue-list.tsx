'use client';

import type { Issue } from '@/data/issues';
import { cn } from '@/lib/utils';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useDrop } from 'react-dnd';
import { ListGroupHeader, type IssueGroupDescriptor } from './group-issues';
import { IssueDragType } from './issue-dnd';
import { IssueLine } from './issue-line';

export interface VirtualListGroup {
   group: IssueGroupDescriptor;
   issues: Issue[];
}

type ListItem =
   | { kind: 'header'; key: string; index: number; entry: VirtualListGroup; collapsed: boolean }
   | {
        kind: 'row';
        key: string;
        issue: Issue;
        order: string[];
        onDropIssue?: (issue: Issue) => void;
     };

// Exact sizes, in rem so they follow the root font size like the classes that
// draw them: an issue line is `min-h-10` (its border sits inside the box), a
// group header is `h-(--field-h)` (2rem), and every header after the first
// carries a 3px band above it. Nothing is measured per row.
const ROW_HEIGHT_REM = 2.5;
const HEADER_HEIGHT_REM = 2;
const HEADER_BAND_PX = 3;
const DEFAULT_REM_PX = 16;

/** The root font size in px, read once and again when the viewport resizes. */
function useRootFontSize() {
   const [rem, setRem] = useState(DEFAULT_REM_PX);
   useEffect(() => {
      const read = () => {
         const size = parseFloat(getComputedStyle(document.documentElement).fontSize);
         setRem(size > 0 ? size : DEFAULT_REM_PX);
      };
      read();
      window.addEventListener('resize', read);
      return () => window.removeEventListener('resize', read);
   }, []);
   return rem;
}

/** A row that is also where a dragged task lands, so it moves into this group. */
function DropRow({
   onDropIssue,
   children,
}: {
   onDropIssue?: (issue: Issue) => void;
   children: ReactNode;
}) {
   const ref = useRef<HTMLDivElement>(null);
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
      <div ref={ref} className={cn('transition-colors', isOver && 'bg-accent/30')}>
         {children}
      </div>
   );
}

/**
 * The list layout: group headers and rows as one flat list, windowed so the
 * DOM holds only what is on screen (plus an overscan) however many tasks
 * there are. It owns the scroll container; `empty` and `footer` render inside
 * it, around the windowed items.
 */
export function VirtualIssueList({
   groups,
   onDropFor,
   empty,
   footer,
}: {
   groups: VirtualListGroup[];
   onDropFor: (groupId: string) => (issue: Issue) => void;
   empty?: ReactNode;
   footer?: ReactNode;
}) {
   const scrollRef = useRef<HTMLDivElement>(null);
   const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

   const items = useMemo<ListItem[]>(() => {
      const flat: ListItem[] = [];
      groups.forEach((entry, index) => {
         const isCollapsed = collapsed.has(entry.group.id) && entry.issues.length > 0;
         flat.push({
            kind: 'header',
            key: `group:${entry.group.id}`,
            index,
            entry,
            collapsed: isCollapsed,
         });
         if (isCollapsed) return;
         // One id list per group, shared by its rows: a shift-click reads it
         // to know what lies between two rows.
         const order = entry.issues.map((issue) => issue.id);
         const onDropIssue = onDropFor(entry.group.id);
         for (const issue of entry.issues) {
            flat.push({ kind: 'row', key: issue.id, issue, order, onDropIssue });
         }
      });
      return flat;
   }, [groups, collapsed, onDropFor]);

   const rem = useRootFontSize();
   const sizeOf = (item: ListItem | undefined) => {
      if (item?.kind === 'header') {
         return HEADER_HEIGHT_REM * rem + (item.index > 0 ? HEADER_BAND_PX : 0);
      }
      return ROW_HEIGHT_REM * rem;
   };

   const virtualizer = useVirtualizer({
      count: items.length,
      getScrollElement: () => scrollRef.current,
      estimateSize: (index) => sizeOf(items[index]),
      getItemKey: (index) => items[index]?.key ?? index,
      overscan: 10,
   });

   // Sizes are fixed, so a change of root font size or of the items only needs
   // the cached offsets recomputed, not a measurement.
   useEffect(() => {
      virtualizer.measure();
   }, [virtualizer, items, rem]);

   const toggle = (groupId: string) =>
      setCollapsed((current) => {
         const next = new Set(current);
         if (!next.delete(groupId)) next.add(groupId);
         return next;
      });

   return (
      <div ref={scrollRef} className="h-full overflow-y-auto md:pb-[var(--shell-launcher-room)]">
         {empty}
         <div
            className="relative w-full bg-container"
            style={{ height: virtualizer.getTotalSize() }}
         >
            {virtualizer.getVirtualItems().map((virtualItem) => {
               const item = items[virtualItem.index];
               if (!item) return null;
               return (
                  <div
                     key={virtualItem.key}
                     className="absolute top-0 left-0 w-full"
                     style={{
                        height: virtualItem.size,
                        transform: `translateY(${virtualItem.start}px)`,
                     }}
                  >
                     {item.kind === 'header' ? (
                        // The 3px band between groups the divide utility drew.
                        <div className={cn(item.index > 0 && 'border-t-[3px] border-background')}>
                           <ListGroupHeader
                              group={item.entry.group}
                              count={item.entry.issues.length}
                              collapsed={item.collapsed}
                              onToggle={() => toggle(item.entry.group.id)}
                           />
                        </div>
                     ) : (
                        <DropRow onDropIssue={item.onDropIssue}>
                           <IssueLine issue={item.issue} order={item.order} draggable />
                        </DropRow>
                     )}
                  </div>
               );
            })}
         </div>
         {footer}
      </div>
   );
}
