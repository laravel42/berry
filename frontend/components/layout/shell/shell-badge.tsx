/** Past this the exact figure stops being information. */
export const BADGE_CAP = 99;

/** `99+` past the cap: a number you cannot act on one at a time. */
export function badgeText(count: number): string {
   return count > BADGE_CAP ? `${BADGE_CAP}+` : String(count);
}

/**
 * The count at the end of a rail row: unread in the inbox, decisions waiting
 * in approvals. Nothing at zero — a row that says "0" is a row asking to be
 * looked at for no reason.
 *
 * It is a figure, not a pill: mono 700 tabular (`data-figure`), so counts line
 * up down the rail and read as one voice with every other number in the app.
 * `hot` is owed work — "waiting on you" — the one rail state invariant 3 lets
 * wear the berry accent; every other count stays the neutral dim. The accent
 * is the colour, not a fill, so it never becomes the berry-pill-everywhere the
 * redesign set out to remove.
 *
 * The figure is hidden from assistive technology and the row carries a spoken
 * form instead ("3 approvals waiting"): a bare number announced after a link's
 * name says nothing about what it counts.
 */
export function ShellBadge({
   count,
   label,
   hot = false,
}: {
   count: number;
   label: string;
   hot?: boolean;
}) {
   if (count <= 0) return null;
   return (
      <span
         data-figure
         className={`ml-auto ${
            hot ? 'text-[var(--shell-accent)]' : 'text-[var(--shell-text-dim)]'
         }`}
      >
         <span aria-hidden="true">{badgeText(count)}</span>
         <span className="sr-only">{label}</span>
      </span>
   );
}
