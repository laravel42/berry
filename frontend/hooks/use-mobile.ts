import * as React from 'react';

/**
 * Below this the shell's rail is an overlay rather than a column and the
 * phone tab bar takes over: Tailwind's `md`, which the layout classes in
 * `berry-shell.tsx` and `shell-rail.tsx` use for the same switch. A tablet
 * gets the desktop shell. Keep the two in step — CSS decides how the shell
 * is drawn on first paint, and this hook decides how it behaves after.
 */
export const SHELL_BREAKPOINT = 768;

/** Below this the page layouts go single-column: Tailwind's `lg`. */
export const MOBILE_BREAKPOINT = 1024;

function useBelow(breakpoint: number) {
   const [below, setBelow] = React.useState<boolean | undefined>(undefined);

   React.useEffect(() => {
      const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
      const onChange = () => {
         setBelow(window.innerWidth < breakpoint);
      };
      mql.addEventListener('change', onChange);
      setBelow(window.innerWidth < breakpoint);
      return () => mql.removeEventListener('change', onChange);
   }, [breakpoint]);

   return !!below;
}

/**
 * True below `MOBILE_BREAKPOINT`, after mount. The server has no viewport,
 * so the first render answers false everywhere; layout that must agree with
 * the server belongs in `lg:` classes, not here.
 */
export function useIsMobile() {
   return useBelow(MOBILE_BREAKPOINT);
}

/**
 * True below `SHELL_BREAKPOINT`: the rail is an overlay and the tab bar is
 * showing. Same after-mount rule as `useIsMobile`.
 */
export function useIsShellOverlay() {
   return useBelow(SHELL_BREAKPOINT);
}
