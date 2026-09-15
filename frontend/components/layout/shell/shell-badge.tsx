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
 * The figure is hidden from assistive technology and the row carries a
 * spoken form instead ("3 approvals waiting"): a bare number announced after
 * a link's name says nothing about what it counts.
 */
export function ShellBadge({ count, label }: { count: number; label: string }) {
   if (count <= 0) return null;
   return (
      <span
         // Smaller than anything the base type scale sizes, so the size is set
         // here rather than with a text utility the project keeps in globals.
         style={{ fontSize: '10px', lineHeight: '16px' }}
         className="ml-auto min-w-[18px] rounded-full bg-[var(--shell-line-strong)] px-1.5 py-px text-center leading-4 text-[var(--shell-text)]"
      >
         <span aria-hidden="true">{badgeText(count)}</span>
         <span className="sr-only">{label}</span>
      </span>
   );
}
