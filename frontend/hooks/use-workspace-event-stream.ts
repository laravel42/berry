'use client';

import { BerryApiError } from '@/lib/api';
import { currentUser } from '@/data/users';
import { loadWorkspaceApprovals } from '@/lib/approvals';
import { loadWorkspaceCycles } from '@/lib/cycles';
import { publishWorkspaceEvent, streamWorkspaceEvents, type EventEnvelope } from '@/lib/events';
import { loadWorkspaceMilestones } from '@/lib/milestones';
import { loadInboxUnreadCount, loadWorkspaceInbox } from '@/lib/inbox';
import { loadWorkspaceProjects } from '@/lib/projects';
import { useApprovalsStore } from '@/store/approvals-store';
import { useCyclesStore } from '@/store/cycles-store';
import { useEventStreamStore } from '@/store/event-stream-store';
import { useMilestonesStore } from '@/store/milestones-store';
import { useNotificationsStore } from '@/store/notifications-store';
import { useProjectsStore } from '@/store/projects-store';
import { serverNow, useSessionStore } from '@/store/session-store';
import { useEffect, useRef } from 'react';

/** How long to wait for a burst to settle before refetching. */
const REFRESH_DEBOUNCE_MS = 400;

/** Reconnect delays: first retry quickly, then back off to the cap. */
const RECONNECT_MIN_MS = 3000;
const RECONNECT_MAX_MS = 30_000;

/** How long to wait for an idle moment before opening the stream anyway. */
const IDLE_TIMEOUT_MS = 3000;

/** How far back from "now" a fresh cursor reaches; repeats are harmless. */
const SINCE_MARGIN_MS = 5000;

/** A server-time cursor, RFC 3339, `SINCE_MARGIN_MS` before the server's now. */
function sinceCursor(): string {
   return new Date(serverNow().getTime() - SINCE_MARGIN_MS).toISOString();
}

type Family = 'milestones' | 'cycles' | 'approvals' | 'inbox' | 'projects';

/** Which stores a frame makes stale. Events are invalidation signals only. */
function familiesFor(event: EventEnvelope): Family[] {
   const type = event.type;
   if (type.startsWith('milestone.') || type.startsWith('goal.')) return ['milestones'];
   if (type.startsWith('project.')) return ['projects'];
   if (type.startsWith('cycle.')) return ['cycles'];
   if (type.startsWith('approval.')) return ['approvals', 'milestones', 'inbox'];
   if (type.startsWith('plan.')) return ['inbox', 'milestones'];
   // A task done, filed or deleted moves its milestone's and its cycle's progress.
   if (type.startsWith('issue.')) return ['milestones', 'cycles'];
   return [];
}

/**
 * Keeps milestones, cycles, projects, approvals and the inbox live.
 *
 * One connection per page over `GET /api/v1/events?workspaceId=`; every
 * frame is fanned out to in-page subscribers (a plan page refetches its
 * record on `plan.updated`) and, debounced, refreshes the stores the frame
 * touched. The last event id is remembered so a reconnect resumes with
 * `after` and misses nothing the server retained.
 */
export function useWorkspaceEventStream(): void {
   const status = useSessionStore((state) => state.status);
   const workspaceId = useSessionStore((state) => state.workspace?.id);
   const user = useSessionStore((state) => state.user);
   const hydrateGoals = useMilestonesStore((state) => state.hydrateGoals);
   const hydrateProjects = useProjectsStore((state) => state.hydrateProjects);
   const hydrateCycles = useCyclesStore((state) => state.hydrateCycles);
   const hydrateApprovals = useApprovalsStore((state) => state.hydrateApprovals);
   const hydrateNotifications = useNotificationsStore((state) => state.hydrateNotifications);
   const setServerUnreadCount = useNotificationsStore((state) => state.setServerUnreadCount);
   const setConnected = useEventStreamStore((state) => state.setConnected);
   const setLastEventId = useEventStreamStore((state) => state.setLastEventId);

   // Taken when the workspace starts loading, before the stream opens in idle.
   const startedAt = useRef<{ workspaceId: string; since: string } | null>(null);
   useEffect(() => {
      if (status === 'ready' && workspaceId) {
         startedAt.current = { workspaceId, since: sinceCursor() };
      }
   }, [status, workspaceId]);

   useEffect(() => {
      if (status !== 'ready' || !workspaceId) return;
      const started = startedAt.current;
      let since = started && started.workspaceId === workspaceId ? started.since : sinceCursor();

      useEventStreamStore.getState().setScope(`${user?.id ?? 'anonymous'}:${workspaceId}`);
      const controller = new AbortController();
      let cancelled = false;
      let reconnectDelay = RECONNECT_MIN_MS;
      let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
      const pending = new Set<Family>();
      let refreshTimer: ReturnType<typeof setTimeout> | undefined;
      const actor = user ?? currentUser;

      const refresh = () => {
         const families = Array.from(pending);
         pending.clear();
         if (families.includes('milestones')) {
            void loadWorkspaceMilestones(workspaceId).then((milestones) => {
               if (!cancelled) hydrateGoals(milestones);
            });
         }
         if (families.includes('cycles')) {
            void loadWorkspaceCycles(workspaceId).then((cycles) => {
               if (!cancelled) hydrateCycles(cycles);
            });
         }
         if (families.includes('projects')) {
            void loadWorkspaceProjects(workspaceId).then((projects) => {
               if (!cancelled) hydrateProjects(projects);
            });
         }
         if (families.includes('approvals')) {
            void loadWorkspaceApprovals(workspaceId).then((approvals) => {
               if (!cancelled) hydrateApprovals(approvals);
            });
         }
         if (families.includes('inbox')) {
            void loadWorkspaceInbox(workspaceId, actor).then((items) => {
               if (!cancelled) hydrateNotifications(items);
            });
            void loadInboxUnreadCount(workspaceId).then((count) => {
               if (!cancelled) setServerUnreadCount(count);
            });
         }
      };

      const scheduleRefresh = (families: Family[]) => {
         for (const family of families) pending.add(family);
         if (pending.size === 0) return;
         if (refreshTimer) clearTimeout(refreshTimer);
         refreshTimer = setTimeout(refresh, REFRESH_DEBOUNCE_MS);
      };

      const consume = async () => {
         try {
            const after = useEventStreamStore.getState().lastEventId ?? undefined;
            const events = streamWorkspaceEvents(workspaceId, {
               after,
               // Never without a cursor: with no last id, replay from `since`.
               since,
               signal: controller.signal,
            });
            for await (const event of events) {
               if (cancelled) return;
               if (!useEventStreamStore.getState().connected) setConnected(true);
               reconnectDelay = RECONNECT_MIN_MS;
               setLastEventId(event.id);
               publishWorkspaceEvent(event);
               scheduleRefresh(familiesFor(event));
            }
         } catch (error) {
            if (cancelled) return;
            if (
               error instanceof BerryApiError &&
               ['CURSOR_EXPIRED', 'INVALID_CURSOR'].includes(error.code)
            ) {
               setLastEventId(null);
               since = serverNow().toISOString();
            }
         }
         if (cancelled) return;
         setConnected(false);
         // With no event seen yet, the next connection starts from here.
         since = sinceCursor();
         // Whatever happened while the stream was down is not in the stores.
         scheduleRefresh(['milestones', 'cycles', 'approvals', 'inbox', 'projects']);
         reconnectTimer = setTimeout(() => {
            if (!cancelled) void consume();
         }, reconnectDelay);
         reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
      };

      let idleHandle: number | undefined;
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      const open = () => {
         if (!cancelled) void consume();
      };
      if (typeof window.requestIdleCallback === 'function') {
         idleHandle = window.requestIdleCallback(open, { timeout: IDLE_TIMEOUT_MS });
      } else {
         idleTimer = setTimeout(open, IDLE_TIMEOUT_MS);
      }

      return () => {
         cancelled = true;
         controller.abort();
         if (idleHandle !== undefined) window.cancelIdleCallback(idleHandle);
         if (idleTimer) clearTimeout(idleTimer);
         setConnected(false);
         if (refreshTimer) clearTimeout(refreshTimer);
         if (reconnectTimer) clearTimeout(reconnectTimer);
      };
   }, [
      status,
      workspaceId,
      user,
      hydrateGoals,
      hydrateProjects,
      hydrateCycles,
      hydrateApprovals,
      hydrateNotifications,
      setServerUnreadCount,
      setConnected,
      setLastEventId,
   ]);
}
