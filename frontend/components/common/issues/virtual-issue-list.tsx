'use client';

import type { Issue } from '@/data/issues';
import { cn } from '@/lib/utils';
import {
   useCallback,
   useEffect,
   useLayoutEffect,
   useMemo,
   useRef,
   useState,
   type ReactNode,
} from 'react';
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

interface WindowRange {
   start: number;
   end: number;
}

// Exact sizes, in rem so they follow the root font size like the classes that
// draw them: an issue line is `min-h-10` (its border sits inside the box), a
// group header is `h-(--field-h)` (2rem), and every header after the first
// carries a 3px band above it. Nothing is measured per row.
const ROW_HEIGHT_REM = 2.5;
const HEADER_HEIGHT_REM = 2;
const HEADER_BAND_PX = 3;
const DEFAULT_REM_PX = 16;

// Desktop keeps the mounted DOM lean (~50 rows). Touch keeps ~5 phone screens
// mounted in normal flow around the viewport (~110 rows max) with hysteresis
// so everyday scrolling triggers zero re-renders and fast flings stay ahead of
// WebKit's async compositor without ever mounting thousands of rows.
const DESKTOP_OVERSCAN = 15;
const DESKTOP_MARGIN = 5;
const TOUCH_OVERSCAN = 45;
const TOUCH_MARGIN = 15;
const INITIAL_VIEWPORT_HEIGHT = 900;
const FLING_SETTLE_MS = 150;

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

/** True on touch-primary devices (phones/tablets). */
function useCoarsePointer() {
   const [coarse, setCoarse] = useState(false);
   useEffect(() => {
      const query = window.matchMedia('(pointer: coarse)');
      const update = () => setCoarse(query.matches);
      update();
      query.addEventListener('change', update);
      return () => query.removeEventListener('change', update);
   }, []);
   return coarse;
}

function itemSize(item: ListItem, rem: number): number {
   if (item.kind === 'header') {
      return HEADER_HEIGHT_REM * rem + (item.index > 0 ? HEADER_BAND_PX : 0);
   }
   return ROW_HEIGHT_REM * rem;
}

/** Prefix-sum offsets: `offsets[i]` is item `i`'s top, `offsets[n]` is total height. */
function buildOffsets(items: ListItem[], rem: number): Float64Array {
   const offsets = new Float64Array(items.length + 1);
   let top = 0;
   for (let i = 0; i < items.length; i += 1) {
      offsets[i] = top;
      const item = items[i];
      if (item) top += itemSize(item, rem);
   }
   offsets[items.length] = top;
   return offsets;
}

/** Index of the item whose box spans `y` (`offsets[i] <= y < offsets[i + 1]`). */
function indexAtOffset(offsets: Float64Array, y: number): number {
   const count = offsets.length - 1;
   if (count <= 0 || y <= 0) return 0;
   const total = offsets[count] ?? 0;
   if (y >= total) return count - 1;
   let lo = 0;
   let hi = count - 1;
   while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if ((offsets[mid] ?? 0) <= y) lo = mid;
      else hi = mid - 1;
   }
   return lo;
}

function computeWindow(
   offsets: Float64Array,
   viewTop: number,
   viewportHeight: number,
   overscan: number,
   margin: number,
   current: WindowRange | null
): WindowRange {
   const count = offsets.length - 1;
   if (count <= 0) return { start: 0, end: 0 };
   const clampedTop = Math.max(0, viewTop);
   const visibleStart = indexAtOffset(offsets, clampedTop);
   const visibleEnd = Math.min(
      count,
      indexAtOffset(offsets, clampedTop + Math.max(1, viewportHeight)) + 1
   );

   // Keep the existing slice while the visible range stays safely inside it so
   // scrolling does not re-render on every frame.
   if (current && current.end <= count) {
      const topSafe = current.start === 0 || visibleStart >= current.start + margin;
      const bottomSafe = current.end === count || visibleEnd <= current.end - margin;
      if (topSafe && bottomSafe && current.start <= visibleStart && current.end >= visibleEnd) {
         return current;
      }
   }

   return {
      start: Math.max(0, visibleStart - overscan),
      end: Math.min(count, visibleEnd + overscan),
   };
}

function measureListTop(scroller: HTMLElement, list: HTMLElement): number {
   const top =
      list.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
   return top > 0 ? top : 0;
}

/**
 * Picks the item to keep pinned when rows arrive above the viewport.
 * Prefers an actual task row whose midpoint is in view so a group header near
 * the top edge cannot pull a different block of tasks onto screen when a batch
 * appends rows above that header.
 */
function findAnchor(
   items: ListItem[],
   offsets: Float64Array,
   viewTop: number,
   viewportHeight: number
): { key: string; offset: number } | null {
   const count = items.length;
   if (count === 0) return null;
   const firstIndex = indexAtOffset(offsets, Math.max(0, viewTop));
   const viewBottom = viewTop + Math.max(1, viewportHeight);

   for (let i = firstIndex; i < count; i += 1) {
      const top = offsets[i] ?? 0;
      if (top >= viewBottom) break;
      const bottom = offsets[i + 1] ?? top;
      const item = items[i];
      if (item && item.kind === 'row' && (top + bottom) / 2 >= viewTop) {
         return { key: item.key, offset: top - viewTop };
      }
   }

   for (let i = firstIndex; i < count; i += 1) {
      const top = offsets[i] ?? 0;
      if (top >= viewBottom) break;
      const bottom = offsets[i + 1] ?? top;
      const item = items[i];
      if (item && bottom > viewTop) {
         return { key: item.key, offset: top - viewTop };
      }
   }

   return null;
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
 * The list layout: group headers and rows as one flat normal-flow windowed
 * list, sandwiched between exact top and bottom spacers so the DOM stays
 * bounded on both desktop and mobile without `position: absolute`, per-row
 * transforms, or unmounted tail voids.
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
   const listRef = useRef<HTMLDivElement>(null);
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
   const overscan = coarse ? TOUCH_OVERSCAN : DESKTOP_OVERSCAN;
   const margin = coarse ? TOUCH_MARGIN : DESKTOP_MARGIN;

   // While a touch drag or momentum fling is moving, freeze incoming appends
   // (such as background loading batches) until the gesture settles so WebKit
   // never gets a mid-fling DOM shift or scrollTop write. Filtering or
   // collapsing shrinks the list and always applies immediately.
   const [frozenItems, setFrozenItems] = useState<ListItem[] | null>(null);
   const activeItems = frozenItems && items.length >= frozenItems.length ? frozenItems : items;

   const offsets = useMemo(() => buildOffsets(activeItems, rem), [activeItems, rem]);
   const totalHeight = offsets[activeItems.length] ?? 0;

   const [range, setRange] = useState<WindowRange>(() =>
      computeWindow(offsets, 0, INITIAL_VIEWPORT_HEIGHT, overscan, margin, null)
   );

   const latestItemsRef = useRef<ListItem[]>(items);
   const frozenItemsRef = useRef<ListItem[] | null>(frozenItems);
   const offsetsRef = useRef<Float64Array>(offsets);
   const overscanRef = useRef<number>(overscan);
   const marginRef = useRef<number>(margin);
   const rangeRef = useRef<WindowRange>(range);
   const prevSnapshotRef = useRef<{
      items: ListItem[];
      offsets: Float64Array;
      overscan: number;
   } | null>(null);
   const lastProgrammaticScrollTopRef = useRef<number | null>(null);

   useLayoutEffect(() => {
      latestItemsRef.current = items;
      if (frozenItems && items.length < frozenItems.length) {
         frozenItemsRef.current = null;
         setFrozenItems(null);
      } else {
         frozenItemsRef.current = frozenItems;
      }
   }, [items, frozenItems]);

   const syncRange = useCallback((forceRecenter = false) => {
      const el = scrollRef.current;
      const list = listRef.current;
      if (!el || !list) return;
      const listTop = measureListTop(el, list);
      const viewTop = Math.max(0, el.scrollTop - listTop);
      const viewportHeight = el.clientHeight || INITIAL_VIEWPORT_HEIGHT;
      const next = computeWindow(
         offsetsRef.current,
         viewTop,
         viewportHeight,
         overscanRef.current,
         marginRef.current,
         forceRecenter ? null : rangeRef.current
      );
      if (next.start !== rangeRef.current.start || next.end !== rangeRef.current.end) {
         rangeRef.current = next;
         setRange(next);
      }
   }, []);

   // Anchor the scroll position when the item list changes and reconcile the
   // mounted window in the same layout pass (before paint), so background
   // batches never jump the viewport into unmounted spacer space.
   useLayoutEffect(() => {
      const prev = prevSnapshotRef.current;
      prevSnapshotRef.current = { items: activeItems, offsets, overscan };
      offsetsRef.current = offsets;
      overscanRef.current = overscan;
      marginRef.current = margin;

      const el = scrollRef.current;
      const list = listRef.current;
      if (!el || !list) return;

      let scrollTop = el.scrollTop;
      const listTop = measureListTop(el, list);
      const viewportHeight = el.clientHeight || INITIAL_VIEWPORT_HEIGHT;

      if (prev && prev.items !== activeItems && scrollTop > 0 && activeItems.length > 0) {
         const prevViewTop = Math.max(0, scrollTop - listTop);
         const anchor = findAnchor(prev.items, prev.offsets, prevViewTop, viewportHeight);
         if (anchor) {
            const newIndex = activeItems.findIndex((entry) => entry.key === anchor.key);
            if (newIndex !== -1) {
               const newTop = offsets[newIndex] ?? 0;
               const target = Math.max(0, newTop + listTop - anchor.offset);
               if (Math.abs(target - scrollTop) > 1) {
                  el.scrollTop = target;
                  scrollTop = el.scrollTop;
                  lastProgrammaticScrollTopRef.current = scrollTop;
               }
            }
         }
      }

      const overscanChanged = prev !== null && prev.overscan !== overscan;
      const viewTop = Math.max(0, scrollTop - listTop);
      const next = computeWindow(
         offsets,
         viewTop,
         viewportHeight,
         overscan,
         margin,
         overscanChanged ? null : rangeRef.current
      );
      if (next.start !== rangeRef.current.start || next.end !== rangeRef.current.end) {
         rangeRef.current = next;
         setRange(next);
      }
   }, [activeItems, offsets, overscan, margin]);

   // Track scroll, resize, and touch momentum gestures on the scroll container.
   useEffect(() => {
      const el = scrollRef.current;
      if (!el) return;

      let touchDown = false;
      let touchMoved = false;
      let flingTimer: number | null = null;

      const clearFlingTimer = () => {
         if (flingTimer !== null) {
            window.clearTimeout(flingTimer);
            flingTimer = null;
         }
      };

      const releaseFrozen = () => {
         clearFlingTimer();
         if (frozenItemsRef.current !== null) {
            frozenItemsRef.current = null;
            setFrozenItems(null);
         }
      };

      const scheduleFlingEnd = () => {
         clearFlingTimer();
         flingTimer = window.setTimeout(() => {
            flingTimer = null;
            syncRange();
            releaseFrozen();
         }, FLING_SETTLE_MS);
      };

      const onScroll = () => {
         syncRange();

         const programmatic = lastProgrammaticScrollTopRef.current;
         if (programmatic !== null && Math.abs(el.scrollTop - programmatic) <= 1) {
            lastProgrammaticScrollTopRef.current = null;
            return;
         }
         lastProgrammaticScrollTopRef.current = null;

         if (touchDown) {
            touchMoved = true;
            if (frozenItemsRef.current === null && latestItemsRef.current.length > 0) {
               frozenItemsRef.current = latestItemsRef.current;
               setFrozenItems(latestItemsRef.current);
            }
         } else if (flingTimer !== null) {
            scheduleFlingEnd();
         }
      };

      const onScrollEnd = () => {
         syncRange();
         if (!touchDown) releaseFrozen();
      };

      const onTouchStart = () => {
         touchDown = true;
         touchMoved = false;
         // A finger touching down stops any prior momentum fling; flush any
         // deferred items at zero velocity before the next tap or drag begins.
         releaseFrozen();
      };

      const onTouchEnd = () => {
         const wasMoving = touchMoved;
         touchDown = false;
         touchMoved = false;
         if (wasMoving) {
            scheduleFlingEnd();
         } else {
            releaseFrozen();
         }
      };

      const passive = { passive: true } as const;
      const passiveCapture = { passive: true, capture: true } as const;
      el.addEventListener('scroll', onScroll, passive);
      el.addEventListener('scrollend', onScrollEnd, passive);
      el.addEventListener('touchstart', onTouchStart, passiveCapture);
      el.addEventListener('touchend', onTouchEnd, passiveCapture);
      el.addEventListener('touchcancel', onTouchEnd, passiveCapture);

      const resizeObserver = new ResizeObserver(() => syncRange());
      resizeObserver.observe(el);

      return () => {
         clearFlingTimer();
         el.removeEventListener('scroll', onScroll);
         el.removeEventListener('scrollend', onScrollEnd);
         el.removeEventListener('touchstart', onTouchStart, passiveCapture);
         el.removeEventListener('touchend', onTouchEnd, passiveCapture);
         el.removeEventListener('touchcancel', onTouchEnd, passiveCapture);
         resizeObserver.disconnect();
      };
   }, [syncRange]);

   const toggle = (groupId: string) => {
      frozenItemsRef.current = null;
      setFrozenItems(null);
      setCollapsed((current) => {
         const next = new Set(current);
         if (!next.delete(groupId)) next.add(groupId);
         return next;
      });
   };

   const sliceStart = Math.min(range.start, activeItems.length);
   const sliceEnd = Math.min(Math.max(sliceStart, range.end), activeItems.length);
   const topSpacerHeight = offsets[sliceStart] ?? 0;
   const bottomSpacerHeight = Math.max(0, totalHeight - (offsets[sliceEnd] ?? 0));
   const rowPx = ROW_HEIGHT_REM * rem;
   // Subtle 40px row hairlines on the virtual spacers so even an extreme mobile
   // fling that momentarily reaches the buffer edge reads as upcoming rows
   // instead of an abrupt empty block.
   const spacerStyle = (height: number) => ({
      height,
      backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${Math.max(1, rowPx - 1)}px, color-mix(in oklab, var(--border) 38%, transparent) ${Math.max(1, rowPx - 1)}px, color-mix(in oklab, var(--border) 38%, transparent) ${rowPx}px)`,
   });

   const renderItem = (item: ListItem) => {
      if (item.kind === 'header') {
         // The 3px band between groups the divide utility drew.
         return (
            <div className={cn(item.index > 0 && 'border-t-[3px] border-background')}>
               <ListGroupHeader
                  group={item.entry.group}
                  count={item.entry.issues.length}
                  collapsed={item.collapsed}
                  onToggle={() => toggle(item.entry.group.id)}
               />
            </div>
         );
      }
      // HTML5 drag-and-drop does not fire on touch screens; skipping DropRow
      // and `useDrag` keeps every mounted mobile row much lighter.
      if (coarse) {
         return <IssueLine issue={item.issue} order={item.order} draggable={false} />;
      }
      return (
         <DropRow onDropIssue={item.onDropIssue}>
            <IssueLine issue={item.issue} order={item.order} draggable />
         </DropRow>
      );
   };

   return (
      // `overscroll-contain`: the list sits inside the shell's own scroller,
      // and on an iPhone a fling that reached the end chained into it and
      // bounced the list.
      <div
         ref={scrollRef}
         className="h-full overflow-y-auto overscroll-contain md:pb-[var(--shell-launcher-room)]"
         style={{
            // Anchoring is handled explicitly in `useLayoutEffect` so native
            // scroll anchoring does not fight top-spacer height updates.
            overflowAnchor: 'none',
            // Promote the viewport-sized scroller to its own compositing layer
            // so WebKit's rounded `overflow-hidden` shell frame does not drop
            // painted tiles during fast touch flings or scrollTop adjustments.
            transform: 'translateZ(0)',
         }}
      >
         {empty}
         <div ref={listRef} className="w-full bg-container">
            {topSpacerHeight > 0 ? <div aria-hidden style={spacerStyle(topSpacerHeight)} /> : null}
            {activeItems.slice(sliceStart, sliceEnd).map((item, offsetIndex) => {
               const index = sliceStart + offsetIndex;
               const height = (offsets[index + 1] ?? 0) - (offsets[index] ?? 0);
               return (
                  <div
                     key={item.key}
                     data-key={item.key}
                     className={
                        item.kind === 'row' ? 'animate-[berry-row-in_140ms_ease-out]' : undefined
                     }
                     style={{ height }}
                  >
                     {renderItem(item)}
                  </div>
               );
            })}
            {bottomSpacerHeight > 0 ? (
               <div aria-hidden style={spacerStyle(bottomSpacerHeight)} />
            ) : null}
         </div>
         {footer}
      </div>
   );
}
