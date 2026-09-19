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
         // Darker berry red (#a8384c) — not a black mix; chalk/white stays
         // readable at 10px without muddying the hue.
         style={{ fontSize: '10px', lineHeight: '16px', backgroundColor: '#a8384c' }}
         className="ml-auto min-w-[18px] rounded-full px-1.5 py-px text-center font-medium leading-4 text-[var(--primary-foreground)]"
      >
         <span aria-hidden="true">{badgeText(count)}</span>
         <span className="sr-only">{label}</span>
      </span>
   );
}
