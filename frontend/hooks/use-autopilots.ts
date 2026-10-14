'use client';

import {
   describeAutopilotFailure,
   isAutopilotEvent,
   listAutopilots,
   type Autopilot,
} from '@/lib/autopilots';
import { subscribeWorkspaceEvents } from '@/lib/events';
import { useSessionStore } from '@/store/session-store';
import { useCallback, useEffect, useState } from 'react';

interface AutopilotsView {
   autopilots: Autopilot[];
   error: string | null;
   loaded: boolean;
   reload: () => void;
}

const autopilotCache = new Map<string, Autopilot[]>();

function cacheKey(workspaceId: string, archived: boolean): string {
   return `${workspaceId}:${archived ? 'archived' : 'live'}`;
}

/** The workspace's autopilots, re-read when any autopilot fact arrives on the stream. */
export function useAutopilots(
   options: { archived?: boolean; enabled?: boolean } = {}
): AutopilotsView {
   const archived = options.archived === true;
   const enabled = options.enabled !== false;
   const status = useSessionStore((state) => state.status);
   const workspaceId = useSessionStore((state) => state.workspace?.id ?? '');
   const key = cacheKey(workspaceId, archived);
   const cached = autopilotCache.get(key);
   const [autopilots, setAutopilots] = useState<Autopilot[]>(cached ?? []);
   const [error, setError] = useState<string | null>(null);
   const [loaded, setLoaded] = useState(cached !== undefined);
   const [nonce, setNonce] = useState(0);
   const reload = useCallback(() => setNonce((value) => value + 1), []);

   useEffect(() => {
      if (!enabled || status !== 'ready' || !workspaceId) return;
      let cancelled = false;
      void listAutopilots(workspaceId, { archived })
         .then((nodes) => {
            if (cancelled) return;
            autopilotCache.set(key, nodes);
            setAutopilots(nodes);
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
   }, [archived, enabled, status, workspaceId, nonce, key]);

   useEffect(() => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const unsubscribe = subscribeWorkspaceEvents((event) => {
         if (!isAutopilotEvent(event)) return;
         if (timer) clearTimeout(timer);
         timer = setTimeout(reload, 400);
      });
      return () => {
         unsubscribe();
         if (timer) clearTimeout(timer);
      };
   }, [reload]);

   return { autopilots, error, loaded, reload };
}
