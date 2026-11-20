import { formatDistanceToNow, parseISO } from 'date-fns';

/**
 * "3 minutes ago" for an ISO timestamp, or `fallback` when the stamp cannot
 * be read (by default the stamp itself, so a reader still sees something).
 *
 * English-only by construction (date-fns). A surface that already formats
 * through next-intl's `format.relativeTime` should keep doing so.
 */
export function timeAgo(iso: string, fallback: string = iso): string {
   try {
      return formatDistanceToNow(parseISO(iso), { addSuffix: true });
   } catch {
      return fallback;
   }
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * The compact form for a dense row: "now", "12m", "3h", "2d", "5w", "4mo",
 * "1y". Under a minute, and any stamp in the future, reads as "now". Returns
 * `fallback` when the stamp cannot be read.
 */
export function shortTimeAgo(iso: string, fallback = '', now: number = Date.now()): string {
   const at = Date.parse(iso);
   if (Number.isNaN(at)) return fallback;
   const elapsed = now - at;
   if (elapsed < MINUTE) return 'now';
   if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;
   if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`;
   if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)}d`;
   if (elapsed < 30 * DAY) return `${Math.floor(elapsed / (7 * DAY))}w`;
   if (elapsed < 365 * DAY) return `${Math.floor(elapsed / (30 * DAY))}mo`;
   return `${Math.floor(elapsed / (365 * DAY))}y`;
}
