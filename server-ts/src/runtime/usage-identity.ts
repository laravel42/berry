import { createHash } from 'node:crypto';

/**
 * Old runtimes omit event IDs. Their journal's absolute frame position is
 * stable across reconnects, unlike token counts or a random ID assigned by
 * each consumer. The database additionally scopes the ID to the run.
 */
export function usageEventIdentity(eventId: string | undefined, session: string, frame: number): string {
   return eventId ?? `berry-frame:${createHash('sha256').update(session).digest('hex')}:${frame}`;
}
