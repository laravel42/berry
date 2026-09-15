import { MOBILE_BREAKPOINT } from '@/hooks/use-mobile';

/**
 * The shell's fixed dimensions, for code that has to reason about them.
 *
 * The classes that draw the rail and the strip are literal Tailwind utilities
 * (`w-[218px]`, `h-[34px]`), because Tailwind reads class names statically.
 * These numbers mirror them so a drawer that must clear the rail, or a panel
 * that must sit under the strip, does not carry its own copy of a width that
 * quietly stops being true. Change one, change the other.
 */

/** The rail as a column at `lg` and above, expanded. `w-[218px]` in shell-rail.tsx. */
export const RAIL_WIDTH = 218;

/** The rail collapsed to its expand control. `w-9` in berry-shell.tsx. */
export const RAIL_COLLAPSED_WIDTH = 36;

/** Below `lg` the rail is an overlay and reserves nothing. */
export const RAIL_OVERLAY_WIDTH = 0;

/** The viewport width below which the rail becomes an overlay: Tailwind's `lg`. */
export const RAIL_OVERLAY_BREAKPOINT = MOBILE_BREAKPOINT;
