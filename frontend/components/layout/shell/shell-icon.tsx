interface ShellIconProps {
   /** Inner SVG markup on a 24x24 viewBox. */
   path: string;
   size?: number;
   className?: string;
}

/**
 * Renders a route glyph from the prototype's inline path data.
 *
 * The markup is a compile-time constant from `shell-routes.ts` — never user or
 * API content — so `dangerouslySetInnerHTML` carries no injection risk here.
 * Keeping the icons as path strings is what lets the route table stay a plain
 * data file rather than a module of components.
 */
export function ShellIcon({ path, size = 15, className }: ShellIconProps) {
   return (
      <svg
         width={size}
         height={size}
         viewBox="0 0 24 24"
         fill="none"
         stroke="currentColor"
         strokeWidth={1.6}
         className={className}
         aria-hidden="true"
         dangerouslySetInnerHTML={{ __html: path }}
      />
   );
}

/** The Berry mark: brackets around a berry. */
export function BerryMark({ size = 17, muted = false }: { size?: number; muted?: boolean }) {
   const bracket = muted ? 'var(--shell-text-dim)' : 'var(--shell-text)';
   const weight = muted ? 7 : 6;
   return (
      <svg width={size} height={size} viewBox="0 0 64 64" className="flex-none" aria-hidden="true">
         <path d="M14 8H8v48h6" stroke={bracket} strokeWidth={weight} fill="none" />
         <path d="M50 8h6v48h-6" stroke={bracket} strokeWidth={weight} fill="none" />
         <circle cx="32" cy="32" r={muted ? 14 : 13} fill="var(--shell-accent)" />
      </svg>
   );
}

/**
 * Shared style for icon buttons in the shell.
 *
 * Mirrors the app's `secondary` button — a filled light surface with no border
 * — rather than the outlined treatment the prototype used, so an icon control
 * in the rail reads the same as one in a page header. Exported as a class
 * string rather than a component because these are variously buttons and
 * links, and wrapping both would cost more than it saves.
 */
export const shellIconButton = [
   'flex flex-none cursor-pointer items-center justify-center rounded-[5px]',
   'bg-[var(--shell-line)] text-[var(--shell-text-muted)] transition-colors',
   'hover:bg-[var(--shell-line-strong)] hover:text-[var(--shell-text)]',
   'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]',
   'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-[var(--shell-line)] disabled:hover:text-[var(--shell-text-muted)]',
].join(' ');

/**
 * A 44px touch target for a 26px control in the tab strip, below `lg` only.
 *
 * The strip's icon buttons draw at 26px so they read as chrome rather than
 * as page buttons, but a fingertip needs 44. The pseudo-element extends the
 * hit area by 9px on every side without changing what is drawn; the strip
 * spaces the buttons 18px apart on narrow screens so two hit areas meet
 * rather than overlap.
 */
export const shellStripHitArea =
   "relative max-lg:before:absolute max-lg:before:-inset-[9px] max-lg:before:content-['']";

/**
 * A rail row: icon plus label, highlighted when it is where you are.
 *
 * Shared by the workspace routes, Personal and the settings rail so the three
 * lists cannot drift. Below `lg` the rail is an overlay a person taps, so a
 * row is at least 44px tall there; as a column it sizes to its text.
 */
export function shellNavRow(on: boolean): string {
   return [
      'flex min-h-11 items-center gap-2.5 rounded px-3 py-1.5 transition-colors lg:min-h-0',
      'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)]',
      on
         ? // Inset rather than a real border: a 2px edge on a rounded pill
           // would shift the label by two pixels on selection.
           'bg-[var(--shell-surface)] text-[var(--shell-text)]'
         : 'text-[var(--shell-text-muted)] hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)]',
   ].join(' ');
}
