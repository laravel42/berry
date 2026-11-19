import { useCallback, useEffect, useState } from 'react';

const TUCK_AFTER_MS = 10_000;

/**
 * What a corner control does once it has tucked: all but a tenth of it slides
 * past the right edge. 90% of its own width plus the 1rem gap to the frame's
 * edge (and any inset) is that distance. Put it on the element that carries
 * `data-tucked`, with a transition on `translate`.
 */
export const TUCKED_CLASS = 'data-[tucked=true]:translate-x-[calc(90%+var(--app-inset-r)+1rem)]';

/**
 * A control floating in the bottom-right corner (the Agents launcher, a
 * task's Console) tucks itself off the right edge after `TUCK_AFTER_MS`
 * without interaction, so it stops sitting on top of the page. `wake` brings
 * it back and holds it there (pointer over it, or focused); `rest` starts the
 * idle clock again. While `held` is true it stays out.
 *
 * Each control keeps its own clock, so two of them in the stack tuck and come
 * back on their own hover.
 */
export function useIdleTuck(held: boolean) {
   const [tucked, setTucked] = useState(false);
   const [engaged, setEngaged] = useState(false);
   const [restedAt, setRestedAt] = useState(0);

   useEffect(() => {
      if (held || engaged) {
         setTucked(false);
         return;
      }
      const timer = window.setTimeout(() => setTucked(true), TUCK_AFTER_MS);
      return () => window.clearTimeout(timer);
   }, [held, engaged, restedAt]);

   const wake = useCallback(() => setEngaged(true), []);
   const rest = useCallback(() => {
      setEngaged(false);
      setRestedAt(Date.now());
   }, []);

   return { tucked, wake, rest };
}
