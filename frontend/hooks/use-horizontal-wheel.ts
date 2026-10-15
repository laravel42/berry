import { useEffect, type RefObject } from 'react';

/**
 * Map a vertical mouse wheel to horizontal scroll on a board strip.
 *
 * Trackpad sideways flicks already send `deltaX` and stay native. A column
 * that can still scroll vertically keeps the wheel. The listener is not
 * passive so the page does not also move.
 */
export function useHorizontalWheel(ref: RefObject<HTMLElement | null>) {
   useEffect(() => {
      const element = ref.current;
      if (!element) return;

      const onWheel = (event: WheelEvent) => {
         if (event.ctrlKey || event.metaKey) return;
         if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
         if (event.deltaY === 0) return;
         if (verticalScrollTakesWheel(event, element)) return;
         event.preventDefault();
         element.scrollLeft += event.deltaY;
      };

      element.addEventListener('wheel', onWheel, { passive: false });
      return () => element.removeEventListener('wheel', onWheel);
   }, [ref]);
}

function verticalScrollTakesWheel(event: WheelEvent, scroller: HTMLElement): boolean {
   for (const node of event.composedPath()) {
      if (node === scroller) break;
      if (!(node instanceof HTMLElement)) continue;
      const overflowY = getComputedStyle(node).overflowY;
      if (overflowY !== 'auto' && overflowY !== 'scroll') continue;
      if (node.scrollHeight <= node.clientHeight + 1) continue;
      if (event.deltaY < 0 && node.scrollTop > 0) return true;
      if (event.deltaY > 0 && node.scrollTop + node.clientHeight < node.scrollHeight - 1) {
         return true;
      }
   }
   return false;
}
