'use client';

import type { Issue } from '@/data/issues';
import { getBoardIssue, loadBoardIssues } from '@/lib/issues';
import { getRun, loadBoardRuns, type RunEvent, streamBoardEvents } from '@/lib/runs';
import { useIssuesStore } from '@/store/issues-store';
import { useRunsStore } from '@/store/runs-store';
import { useSessionStore } from '@/store/session-store';
import { useEffect } from 'react';

/** How long to wait for a burst to settle before refetching. */
const REFRESH_DEBOUNCE_MS = 400;

/** How long to wait before reconnecting a dropped stream. */
const RECONNECT_DELAY_MS = 3000;

/**
 * Past this many issues in one settled burst, refetching the whole board is
 * cheaper than one request per issue — a bulk move or an import, say.
 */
const MAX_TARGETED_ISSUES = 25;

/** A board frame names no issue with the nil uuid rather than with null. */
const NO_ID = '00000000-0000-0000-0000-000000000000';

/**
 * The run facts that can move the issue as well as the run: they change its
 * status or its `activeRunId`. Everything else a run emits (output deltas,
 * tool and command calls, usage) only changes the run itself.
 */
const RUN_LIFECYCLE_EVENTS = new Set([
   'run.created',
   'run.started',
   'run.delivered',
   'run.completed',
   'run.failed',
   'run.cancelled',
   'run.verified',
]);

/** What one settled burst says is behind in the store. */
interface PendingChanges {
   issueIds: Set<string>;
   deletedIssueIds: Set<string>;
   runIds: Set<string>;
   /** Something the ids cannot describe; only the whole board reconciles it. */
   needsFull: boolean;
}

function emptyChanges(): PendingChanges {
   return { issueIds: new Set(), deletedIssueIds: new Set(), runIds: new Set(), needsFull: false };
}

function namedId(id: string | null | undefined): string | undefined {
   return id && id !== NO_ID ? id : undefined;
}

/**
 * Note which projection one event makes stale. Only the type and the ids are
 * read: an event this does not recognise, or one missing the id it needs,
 * falls back to the whole board rather than guessing what it touched.
 */
function recordEvent(changes: PendingChanges, event: RunEvent): void {
   const issueId = namedId(event.issueId);
   if (event.type === 'issue.deleted') {
      if (issueId) changes.deletedIssueIds.add(issueId);
      else changes.needsFull = true;
      return;
   }
   if (event.type.startsWith('issue.') || event.type.startsWith('comment.')) {
      if (issueId) changes.issueIds.add(issueId);
      else changes.needsFull = true;
      return;
   }
   if (event.type.startsWith('run.')) {
      const runId = namedId(event.runId);
      if (!runId) {
         changes.needsFull = true;
         return;
      }
      changes.runIds.add(runId);
      if (RUN_LIFECYCLE_EVENTS.has(event.type)) {
         if (issueId) changes.issueIds.add(issueId);
         else changes.needsFull = true;
      }
      return;
   }
   changes.needsFull = true;
}

/** Whether `stored` is a later write than `incoming`; an unknown time never is. */
function isLaterWrite(stored: string | undefined, incoming: string | undefined): boolean {
   if (!stored || !incoming) return false;
   const storedAt = Date.parse(stored);
   const incomingAt = Date.parse(incoming);
   return !Number.isNaN(storedAt) && !Number.isNaN(incomingAt) && storedAt > incomingAt;
}

/**
 * Keeps the board live while agents work on it.
 *
 * Agents move issues without anyone clicking anything, so without this the
 * board is only ever as fresh as the last page load — work would complete and
 * the card would sit unchanged until someone reloaded.
 *
 * A run emits a burst of events (output deltas, tool calls, then completion),
 * and refetching on each would mean dozens of requests for one turn. The burst
 * is allowed to settle first, and what it named is then fetched again: the one
 * issue or run an event is about, not every page of the board. A run that
 * streams output for minutes would otherwise reload the whole board each time
 * it paused. Anything the event ids cannot describe — an unknown topic, a
 * missing id, a dropped stream, an issue that will not load — still costs the
 * full refresh, because that is the only fetch that cannot miss a change.
 */
export function useBoardEventStream(): void {
   const status = useSessionStore((state) => state.status);
   const boardId = useSessionStore((state) => state.boardId);
   const hydrateIssues = useIssuesStore((state) => state.hydrateIssues);
   const mergeIssues = useIssuesStore((state) => state.mergeIssues);
   const deleteIssue = useIssuesStore((state) => state.deleteIssue);
   const getIssueById = useIssuesStore((state) => state.getIssueById);
   const hydrateRuns = useRunsStore((state) => state.hydrateRuns);
   const upsertRun = useRunsStore((state) => state.upsertRun);

   useEffect(() => {
      if (status !== 'ready' || !boardId) return;

      const controller = new AbortController();
      let cancelled = false;
      let refreshTimer: ReturnType<typeof setTimeout> | undefined;
      let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
      let pending = emptyChanges();
      // Issues this stream has already taken off the board. A fetch that was
      // in flight when the deletion landed must not put the card back: no
      // later event would name it, so it would stay until a full refresh.
      const removedIssueIds = new Set<string>();

      const refreshIssues = () => {
         void loadBoardIssues(boardId)
            .then((issues) => {
               if (!cancelled) hydrateIssues(issues);
            })
            .catch(() => undefined);
      };

      const refreshRuns = () => {
         void loadBoardRuns(boardId, { first: 200 })
            .then((runs) => {
               if (!cancelled) hydrateRuns(runs, null);
            })
            .catch(() => undefined);
      };

      const refetchIssues = (issueIds: string[]) => {
         void Promise.all(issueIds.map((issueId) => getBoardIssue(issueId)))
            .then((results) => {
               if (cancelled) return;
               const fresh: Issue[] = [];
               let missing = false;
               for (const issue of results) {
                  if (!issue) {
                     missing = true;
                     continue;
                  }
                  if (removedIssueIds.has(issue.id)) continue;
                  // A slow response must not overwrite a newer copy that a
                  // later fetch, or a full refresh, has already stored.
                  if (isLaterWrite(getIssueById(issue.id)?.updatedAt, issue.updatedAt)) continue;
                  fresh.push(issue);
               }
               mergeIssues(fresh);
               // An issue that did not come back may be gone, hidden, or the
               // request failed; only the whole board can tell which, so it
               // is refetched rather than the card dropped on a guess.
               if (missing) {
                  pending.needsFull = true;
                  scheduleRefresh();
               }
            })
            .catch(() => undefined);
      };

      const refetchRuns = (runIds: string[]) => {
         void Promise.allSettled(runIds.map((runId) => getRun(runId)))
            .then((results) => {
               if (cancelled) return;
               let failed = false;
               for (const result of results) {
                  if (result.status === 'fulfilled') upsertRun(result.value);
                  else failed = true;
               }
               // A run that will not load is reconciled from the board's run
               // list; the issues are not involved, so they are not refetched.
               if (failed) refreshRuns();
            })
            .catch(() => undefined);
      };

      const flush = () => {
         const changes = pending;
         pending = emptyChanges();
         if (
            changes.needsFull ||
            changes.issueIds.size + changes.deletedIssueIds.size > MAX_TARGETED_ISSUES
         ) {
            refreshIssues();
            refreshRuns();
            return;
         }
         for (const issueId of changes.deletedIssueIds) {
            removedIssueIds.add(issueId);
            deleteIssue(issueId);
         }
         const issueIds = [...changes.issueIds].filter(
            (issueId) => !changes.deletedIssueIds.has(issueId)
         );
         if (issueIds.length > 0) refetchIssues(issueIds);
         if (changes.runIds.size > 0) refetchRuns([...changes.runIds]);
      };

      const scheduleRefresh = () => {
         if (refreshTimer) clearTimeout(refreshTimer);
         refreshTimer = setTimeout(flush, REFRESH_DEBOUNCE_MS);
      };

      const consume = async () => {
         try {
            const events = streamBoardEvents(boardId, controller.signal);
            // Only the event's type and ids are read, to know which issue or
            // run to fetch again; the server's own projection of it is what
            // lands in the store. Applying the payload would mean maintaining
            // a second, partial copy of the server's projection logic.
            for await (const event of events) {
               if (cancelled) return;
               recordEvent(pending, event);
               scheduleRefresh();
            }
         } catch {
            // A dropped stream is expected — a sleeping laptop, a restarted
            // API. Swallowed so it can be retried rather than surfaced as an
            // error the person cannot act on.
         }
         if (cancelled) return;
         // The stream ending is itself a reason to refresh, and a full one:
         // whatever happened while it was down is not in the store, and no
         // event will name it.
         pending.needsFull = true;
         scheduleRefresh();
         reconnectTimer = setTimeout(() => {
            if (!cancelled) void consume();
         }, RECONNECT_DELAY_MS);
      };

      void consume();

      return () => {
         cancelled = true;
         controller.abort();
         if (refreshTimer) clearTimeout(refreshTimer);
         if (reconnectTimer) clearTimeout(reconnectTimer);
      };
   }, [
      status,
      boardId,
      hydrateIssues,
      mergeIssues,
      deleteIssue,
      getIssueById,
      hydrateRuns,
      upsertRun,
   ]);
}
