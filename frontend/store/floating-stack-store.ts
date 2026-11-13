import { useCallback, useEffect, useId, useState } from 'react';
import { create } from 'zustand';

/**
 * The column of floating controls in the bottom-right corner.
 *
 * Everything that floats there takes a place in one stack instead of picking
 * its own corner, so nothing lands on top of anything else. The stack grows
 * from the bottom: a control that joins (a task's Restart and Console, say)
 * takes the lowest place and pushes the ones already standing, such as the
 * Agents launcher, up above it. Leaving lets them fall back.
 *
 * `order` decides who stands lower: smaller is nearer the bottom. The launcher
 * is `FLOATING_ORDER.launcher`; page controls sit below it.
 */

export const FLOATING_ORDER = {
   /** A page's own floating actions, such as a task's Restart and Console. */
   page: 0,
   /** The Agents launcher: the shell's own, so it stands on top. */
   launcher: 100,
} as const;

/** Space between stacked controls, in pixels. */
const GAP = 8;

interface Entry {
   order: number;
   height: number;
}

interface FloatingStackState {
   entries: Record<string, Entry>;
   set: (id: string, entry: Entry | null) => void;
}

export const useFloatingStackStore = create<FloatingStackState>()((set) => ({
   entries: {},
   set: (id, entry) =>
      set((state) => {
         const current = state.entries[id];
         if (!entry) {
            if (!current) return state;
            const entries = { ...state.entries };
            delete entries[id];
            return { entries };
         }
         if (current && current.order === entry.order && current.height === entry.height) {
            return state;
         }
         return { entries: { ...state.entries, [id]: entry } };
      }),
}));

/** Pixels below a control of `order`: the heights of those under it, with gaps. */
function liftFor(entries: Record<string, Entry>, id: string, order: number): number {
   let lift = 0;
   for (const [other, entry] of Object.entries(entries)) {
      if (other === id || entry.height === 0) continue;
      // Ties keep a fixed order by id, so two page controls never swap places.
      if (entry.order < order || (entry.order === order && other < id)) {
         lift += entry.height + GAP;
      }
   }
   return lift;
}

/**
 * Join the stack. Put `ref` on the floating element and its `bottom` (a CSS
 * length, measured from the stack's floor) on its style; the element keeps
 * its place while mounted and gives it up when it unmounts.
 */
export function useFloatingStackItem(order: number) {
   const id = useId();
   const setEntry = useFloatingStackStore((state) => state.set);
   const lift = useFloatingStackStore((state) => liftFor(state.entries, id, order));
   const [node, setNode] = useState<HTMLElement | null>(null);

   useEffect(() => {
      if (!node) return;
      const measure = () => setEntry(id, { order, height: node.offsetHeight });
      measure();
      const observer = new ResizeObserver(measure);
      observer.observe(node);
      return () => {
         observer.disconnect();
         setEntry(id, null);
      };
   }, [node, id, order, setEntry]);

   const ref = useCallback((element: HTMLElement | null) => setNode(element), []);
   return { ref, lift, bottom: `calc(var(--shell-launcher-b) + ${lift}px)` };
}
