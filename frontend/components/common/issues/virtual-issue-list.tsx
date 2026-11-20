'use client';

import type { Issue } from '@/data/issues';
import { cn } from '@/lib/utils';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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

/**
 * True on a touch screen. There the list is not windowed: WebKit (every
 * browser on an iPhone) holds back scroll events during a fling, so a
 * windowed list only learned where it was once the fling ended and showed
 * blank space until then. Touch screens get every row in normal flow instead
 * (see `FlowRows`), mounted progressively. content-visibility was tried and
 * dropped because WebKit left rows blank mid-scroll.
 */
function useCoarsePointer() {
   const [coarse, setCoarse] = useState(false);
   useEffect(() => {
      setCoarse(window.matchMedia('(pointer: coarse)').matches);
   }, []);
   return coarse;
}

/** Rows mounted on the first render on a touch screen, then this many more per idle slice. */
const FLOW_FIRST_ROWS = 80;
const FLOW_ROWS_PER_SLICE = 250;

/**
 * How many of `total` rows to mount: a first screenful at once, the rest in
 * slices while the browser is idle, so the first paint costs what the
 * windowed list did and scrolling never waits on script.
 */
function useProgressiveCount(total: number, active: boolean) {
   const [count, setCount] = useState(FLOW_FIRST_ROWS);
   useEffect(() => {
      if (!active || count >= total) return;
      const next = () => setCount((current) => current + FLOW_ROWS_PER_SLICE);
      if ('requestIdleCallback' in window) {
         const id = window.requestIdleCallback(next, { timeout: 500 });
         return () => window.cancelIdleCallback(id);
      }
      const id = setTimeout(next, 50);
      return () => clearTimeout(id);
   }, [active, count, total]);
   return Math.min(count, total);
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
   const coarse = useCoarsePointer();
   const flowCount = useProgressiveCount(items.length, coarse);
   const sizeOf = (item: ListItem | undefined) => {
      if (item?.kind === 'header') {
         return HEADER_HEIGHT_REM * rem + (item.index > 0 ? HEADER_BAND_PX : 0);
      }
      return ROW_HEIGHT_REM * rem;
   };

   const virtualizer = useVirtualizer({
      // Windowed with a mouse or trackpad only; a touch screen renders in flow.
      count: coarse ? 0 : items.length,
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

   // WebKit has no scroll anchoring, and batches of tasks land above the
   // viewport while the list loads, which shifted the content under the
   // finger. On a touch screen, find the first row still in view in the
   // previous list and put it back at the same offset in the new one.
   // scrollTop is untouched by the DOM update, so it still holds the position
   // from before the change.
   const listRef = useRef<HTMLDivElement>(null);
   const prevItemsRef = useRef<ListItem[] | null>(null);
   useLayoutEffect(() => {
      const prev = prevItemsRef.current;
      prevItemsRef.current = items;
      if (!coarse || !prev || prev === items) return;
      const el = scrollRef.current;
      const list = listRef.current;
      if (!el || !list || el.scrollTop <= 0) return;
      // Offsets are relative to the list wrapper, which may sit below `empty`.
      // `listTop` is the wrapper's top within the scroller's content (offsetTop
      // is relative to the offset parent, which is not the scroller).
      const listTop =
         list.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
      const viewTop = el.scrollTop - listTop;
      let top = 0;
      let key: string | null = null;
      let offset = 0;
      for (const item of prev) {
         const bottom = top + sizeOf(item);
         if (bottom > viewTop) {
            key = item.key;
            offset = top - viewTop;
            break;
         }
         top = bottom;
      }
      if (key === null) return;
      let newTop = 0;
      for (const item of items) {
         if (item.key === key) {
            const target = newTop + listTop - offset;
            if (Math.abs(target - el.scrollTop) > 1) el.scrollTop = target;
            return;
         }
         newTop += sizeOf(item);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps -- sizeOf only reads rem
   }, [items, coarse, rem]);

   const toggle = (groupId: string) =>
      setCollapsed((current) => {
         const next = new Set(current);
         if (!next.delete(groupId)) next.add(groupId);
         return next;
      });

   const renderItem = (item: ListItem) =>
      item.kind === 'header' ? (
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
      );

   return (
      // `overscroll-contain`: the list sits inside the shell's own scroller,
      // and on an iPhone a fling that reached the end chained into it and
      // bounced the list.
      <div
         ref={scrollRef}
         className="h-full overflow-y-auto overscroll-contain md:pb-[var(--shell-launcher-room)]"
         // Chrome on Android anchors natively; the effect above does it by hand.
         style={coarse ? { overflowAnchor: 'none' } : undefined}
      >
         {empty}
         {coarse ? (
            <div ref={listRef} className="w-full bg-container">
               {items.slice(0, flowCount).map((item) => (
                  <div
                     key={item.key}
                     data-key={item.key}
                     // Plain row in normal flow at its exact size.
                     // content-visibility: auto was tried and dropped: WebKit
                     // left rows blank mid-scroll.
                     style={{ height: sizeOf(item) }}
                  >
                     {renderItem(item)}
                  </div>
               ))}
               {flowCount < items.length ? (
                  // Room for the rows still to mount, so the scrollbar is right from the start.
                  <div
                     aria-hidden
                     style={{
                        height: items.slice(flowCount).reduce((sum, item) => sum + sizeOf(item), 0),
                     }}
                  />
               ) : null}
            </div>
         ) : (
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
                        className="absolute left-0 w-full"
                        style={{ height: virtualItem.size, top: virtualItem.start }}
                     >
                        {renderItem(item)}
                     </div>
                  );
               })}
            </div>
         )}
         {footer}
      </div>
   );
}
