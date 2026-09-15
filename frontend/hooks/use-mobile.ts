import * as React from 'react';

/**
 * Below this the shell's rail is an overlay rather than a column: Tailwind's
 * `lg`, which the layout classes in `berry-shell.tsx` and `shell-rail.tsx`
 * use for the same switch. Keep the two in step — CSS decides how the shell
 * is drawn on first paint, and this hook decides how it behaves after.
 */
export const MOBILE_BREAKPOINT = 1024;

/**
 * True below `MOBILE_BREAKPOINT`, after mount. The server has no viewport,
 * so the first render answers false everywhere; layout that must agree with
 * the server belongs in `lg:` classes, not here.
 */
export function useIsMobile() {
   const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

   React.useEffect(() => {
      const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
      const onChange = () => {
         setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
      };
      mql.addEventListener('change', onChange);
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
      return () => mql.removeEventListener('change', onChange);
   }, []);

   return !!isMobile;
}
