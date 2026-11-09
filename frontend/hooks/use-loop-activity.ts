'use client';

import { useCallback, useEffect, useState } from 'react';

import {
   describeAutopilotFailure,
   isAutopilotEvent,
   listLoopActivity,
   type WorkspaceLoopRun,
} from '@/lib/autopilots';
import { subscribeWorkspaceEvents } from '@/lib/events';
import { useSessionStore } from '@/store/session-store';

interface LoopActivityView {
   recent: WorkspaceLoopRun[];
   attention: WorkspaceLoopRun[];
   loaded: boolean;
   error: string | null;
   reload: () => void;
}

/**
 * Runs across the workspace's Loops: what happened lately, and the failures
 * nobody has retried. Re-read when a Loop fact arrives on the workspace
 * stream — including `autopilot.run.updated`, which the server writes when a
 * Loop's agent run ends — rather than on a timer.
 */
export function useLoopActivity(enabled = true): LoopActivityView {
   const status = useSessionStore((state) => state.status);
   const workspaceId = useSessionStore((state) => state.workspace?.id ?? '');
   const [recent, setRecent] = useState<WorkspaceLoopRun[]>([]);
   const [attention, setAttention] = useState<WorkspaceLoopRun[]>([]);
   const [loaded, setLoaded] = useState(false);
   const [error, setError] = useState<string | null>(null);
   const [nonce, setNonce] = useState(0);
   const reload = useCallback(() => setNonce((value) => value + 1), []);

   useEffect(() => {
      if (!enabled || status !== 'ready' || !workspaceId) return;
      let cancelled = false;
      void Promise.all([
         listLoopActivity(workspaceId),
         listLoopActivity(workspaceId, { attention: true }),
      ])
         .then(([latest, failing]) => {
            if (cancelled) return;
            setRecent(latest);
            setAttention(failing);
            setError(null);
         })
         .catch((failure: unknown) => {
            if (!cancelled) setError(describeAutopilotFailure(failure));
         })
         .finally(() => {
            if (!cancelled) setLoaded(true);
         });
      return () => {
         cancelled = true;
      };
   }, [enabled, status, workspaceId, nonce]);

   useEffect(() => {
      if (!enabled) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const unsubscribe = subscribeWorkspaceEvents((event) => {
         if (!isAutopilotEvent(event)) return;
         if (timer) clearTimeout(timer);
         timer = setTimeout(reload, 500);
      });
      return () => {
         unsubscribe();
         if (timer) clearTimeout(timer);
      };
   }, [enabled, reload]);

   return { recent, attention, loaded, error, reload };
}
