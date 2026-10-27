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
/**
 * The shell's own copy of the isotipo, on --shell-* rather than theme tokens.
 *
 * The shell is dark whatever the rest of the app is doing, so it always wants
 * the asset's dark colourway -- which is what --shell-text and --shell-accent
 * already are. Same official geometry as components/brand/berry-mark.tsx; this
 * stays a separate component only because its colours come from a palette the
 * theme does not reach.
 */
export function BerryMark({ size = 17, muted = false }: { size?: number; muted?: boolean }) {
   const bracket = muted ? 'var(--shell-text-dim)' : 'var(--shell-text)';
   return (
      <svg
         width={size}
         height={size}
         viewBox="0 0 100 100"
         className="flex-none"
         aria-hidden="true"
      >
         <path
            d="M18.75,10.42V0H0v100h18.75v-10.42h-8.33V10.42h8.33ZM81.25,0v10.42h8.33v79.17h-8.33v10.42h18.75V0h-18.75Z"
            fill={bracket}
         />
         <circle cx="50" cy="50" r="25.16" fill="var(--shell-accent)" />
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
