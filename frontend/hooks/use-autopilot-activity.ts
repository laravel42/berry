'use client';

import { useEffect, useMemo, useState } from 'react';

import {
   getAutopilot,
   isAutopilotEvent,
   listAutopilotRuns,
   type Autopilot,
   type AutopilotRun,
   type AutopilotTrigger,
} from '@/lib/autopilots';
import { subscribeWorkspaceEvents } from '@/lib/events';

/** What the list row needs beyond the autopilot itself: its triggers and its latest run. */
export interface AutopilotActivity {
   triggers: AutopilotTrigger[];
   /** The newest firing that did something; a skipped one only when nothing else is on record. */
   lastRun: AutopilotRun | null;
}

/** Requests in flight at once, so a long list does not open a socket per row. */
const CONCURRENCY = 4;

const cache = new Map<string, AutopilotActivity>();

function latest(runs: AutopilotRun[]): AutopilotRun | null {
   // The server answers newest first.
   return runs.find((run) => run.status !== 'skipped') ?? runs[0] ?? null;
}

async function load(id: string): Promise<AutopilotActivity> {
   const [detail, runs] = await Promise.all([getAutopilot(id), listAutopilotRuns(id)]);
   return { triggers: detail.triggers, lastRun: latest(runs) };
}

/**
 * Last and next run for each autopilot in the list.
 *
 * The list endpoint carries neither, so each row's triggers and history are
 * read on their own, a few at a time, and kept between visits. A frame about
 * any autopilot re-reads the visible rows: a firing changes the last run
 * without touching the autopilot's `updatedAt`.
 */
export function useAutopilotActivity(autopilots: Autopilot[]): Record<string, AutopilotActivity> {
   const ids = useMemo(() => autopilots.map((autopilot) => autopilot.id), [autopilots]);
   const key = ids.join(',');
   const [activity, setActivity] = useState<Record<string, AutopilotActivity>>(() => {
      const known: Record<string, AutopilotActivity> = {};
      for (const id of ids) {
         const hit = cache.get(id);
         if (hit) known[id] = hit;
      }
      return known;
   });
   const [nonce, setNonce] = useState(0);

   useEffect(() => {
      if (ids.length === 0) return;
      let cancelled = false;
      const queue = [...ids];
      const worker = async () => {
         while (!cancelled) {
            const id = queue.shift();
            if (!id) return;
            try {
               const found = await load(id);
               cache.set(id, found);
               if (!cancelled) setActivity((current) => ({ ...current, [id]: found }));
            } catch {
               // A row without activity shows a dash; the list itself still loaded.
            }
         }
      };
      for (let index = 0; index < Math.min(CONCURRENCY, ids.length); index += 1) void worker();
      return () => {
         cancelled = true;
      };
      // `key` stands in for `ids`: a re-sorted list is the same set of rows.
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [key, nonce]);

   useEffect(() => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const unsubscribe = subscribeWorkspaceEvents((event) => {
         if (!isAutopilotEvent(event)) return;
         if (timer) clearTimeout(timer);
         timer = setTimeout(() => setNonce((value) => value + 1), 600);
      });
      return () => {
         unsubscribe();
         if (timer) clearTimeout(timer);
      };
   }, []);

   return activity;
}
