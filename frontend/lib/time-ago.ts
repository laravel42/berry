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
