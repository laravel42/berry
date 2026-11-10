'use client';

import { listCycleIssues, type CycleIssueRef } from '@/lib/cycles';
import { useCyclesStore } from '@/store/cycles-store';
import { useIssuesStore } from '@/store/issues-store';
import { useCallback, useEffect, useMemo, useState } from 'react';

/** Long enough for a burst of board events to settle into one refetch. */
const REFETCH_DEBOUNCE_MS = 300;

/**
 * The tasks in each of the given cycles, with their assignee and completion
 * time (what the burn-up and the per-task strips need).
 *
 * The cycle routes are the source: a cycle spans the workspace, and the
 * board's task store holds one board. The store is still the change signal —
 * the board stream keeps it live, so when a task in any cycle changes status,
 * assignee or cycle, or a cycle's counts move, the lists are fetched again.
 */
export function useCycleIssues(cycleIds: string[]): {
   issuesByCycle: Record<string, CycleIssueRef[]>;
   loaded: boolean;
   reload: () => void;
} {
   const key = useMemo(() => [...new Set(cycleIds)].sort().join(','), [cycleIds]);
   const taskSignature = useIssuesStore((state) =>
      state.issues
         .filter((issue) => issue.cycleId)
         .map(
            (issue) => `${issue.id}:${issue.cycleId}:${issue.status.id}:${issue.assignee?.id ?? ''}`
         )
         .join('|')
   );
   const cycleSignature = useCyclesStore((state) =>
      state.cycles
         .map((cycle) => `${cycle.id}:${cycle.updatedAt}:${JSON.stringify(cycle.progress ?? {})}`)
         .join('|')
   );
   const [issuesByCycle, setIssuesByCycle] = useState<Record<string, CycleIssueRef[]>>({});
   const [loadedKey, setLoadedKey] = useState<string | null>(null);
   const [token, setToken] = useState(0);

   useEffect(() => {
      const ids = key ? key.split(',') : [];
      if (ids.length === 0) {
         setIssuesByCycle({});
         setLoadedKey(key);
         return;
      }
      const controller = new AbortController();
      // The first load goes at once; later ones wait for the burst to settle.
      const delay = loadedKey === key ? REFETCH_DEBOUNCE_MS : 0;
      const timer = setTimeout(() => {
         void Promise.all(
            ids.map((id) =>
               listCycleIssues(id, controller.signal).then(
                  (nodes) => [id, nodes] as const,
                  () => [id, null] as const
               )
            )
         ).then((results) => {
            if (controller.signal.aborted) return;
            setIssuesByCycle((previous) => {
               const next: Record<string, CycleIssueRef[]> = {};
               for (const [id, nodes] of results) next[id] = nodes ?? previous[id] ?? [];
               return next;
            });
            setLoadedKey(key);
         });
      }, delay);
      return () => {
         clearTimeout(timer);
         controller.abort();
      };
      // `loadedKey` only picks the delay; it must not start a fetch of its own.
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [key, taskSignature, cycleSignature, token]);

   const reload = useCallback(() => setToken((value) => value + 1), []);
   return { issuesByCycle, loaded: loadedKey === key, reload };
}
