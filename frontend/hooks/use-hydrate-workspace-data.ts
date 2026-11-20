'use client';

import type { Issue } from '@/data/issues';
import { currentUser } from '@/data/users';
import { BerryApiError } from '@/lib/api';
import { loadWorkspaceAgents } from '@/lib/agents';
import { loadWorkspaceApprovals } from '@/lib/approvals';
import { loadWorkspaceMilestones } from '@/lib/milestones';
import { loadWorkspaceCycles } from '@/lib/cycles';
import { loadWorkspaceLabels } from '@/lib/labels';
import { loadWorkspaceInbox, loadInboxUnreadCount } from '@/lib/inbox';
import { loadBoardIssues } from '@/lib/issues';
import { loadWorkspaceMembers } from '@/lib/members';
import { loadWorkspaceProjects } from '@/lib/projects';
import { loadBoardRuns } from '@/lib/runs';
import { loadWorkspaceViews } from '@/lib/views';
import { useAgentsStore } from '@/store/agents-store';
import { useApprovalsStore } from '@/store/approvals-store';
import { useMilestonesStore } from '@/store/milestones-store';
import { useCyclesStore } from '@/store/cycles-store';
import { useIssuesStore } from '@/store/issues-store';
import { useLabelsStore } from '@/store/labels-store';
import { useMembersStore } from '@/store/members-store';
import { useNotificationsStore } from '@/store/notifications-store';
import { useProjectsStore } from '@/store/projects-store';
import { useRunsStore } from '@/store/runs-store';
import { useSessionStore } from '@/store/session-store';
import { useViewsStore } from '@/store/views-store';
import { useEffect } from 'react';
import { useBoardEventStream } from './use-board-event-stream';
import { useOpenReviewsSync } from './use-open-reviews-sync';
import { useWorkspaceEventStream } from './use-workspace-event-stream';
import { warmRepositoryProbe } from '@/components/common/projects/repository-selector';

/**
 * What this tab has already seeded. Survives a remount (React Strict Mode)
 * so a second mount of the same board does not flash loading and refetch.
 */
let seededBoardId: string | null = null;
let seededBoardRetry = -1;

/** Buffered task pages are merged into the store once this many are waiting. */
const MERGE_BATCH_SIZE = 500;

/**
 * Runs `task` when the browser is idle (a timeout where there is no idle
 * callback) and returns a function that cancels it. The off-screen stores load
 * through this so they do not compete with the first paint.
 */
function whenIdle(task: () => void): () => void {
   if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(task, { timeout: 2000 });
      return () => window.cancelIdleCallback(handle);
   }
   const handle = window.setTimeout(task, 200);
   return () => window.clearTimeout(handle);
}

/**
 * Seeds workspace data from the API once a session is ready.
 */
export function useHydrateWorkspaceData(): void {
   // The initial load below is a snapshot; these keep it current as agents
   // work: the board stream for tasks and runs, the workspace stream for
   // milestones, approvals and the inbox.
   useBoardEventStream();
   useWorkspaceEventStream();
   // The open review queue feeds the rail's count and the task page's link to
   // its own review; it rides on the workspace stream above.
   useOpenReviewsSync();

   const status = useSessionStore((state) => state.status);
   const boardId = useSessionStore((state) => state.boardId);
   const workspaceId = useSessionStore((state) => state.workspace?.id);
   const user = useSessionStore((state) => state.user);
   const hydrateIssues = useIssuesStore((state) => state.hydrateIssues);
   const mergeIssues = useIssuesStore((state) => state.mergeIssues);
   const setIssuesLoadState = useIssuesStore((state) => state.setLoadState);
   const retryToken = useIssuesStore((state) => state.retryToken);
   const hydrateProjects = useProjectsStore((state) => state.hydrateProjects);
   const hydrateNotifications = useNotificationsStore((state) => state.hydrateNotifications);
   const setServerUnreadCount = useNotificationsStore((state) => state.setServerUnreadCount);
   const hydrateAgents = useAgentsStore((state) => state.hydrateAgents);
   const hydrateRuns = useRunsStore((state) => state.hydrateRuns);
   const hydrateMembers = useMembersStore((state) => state.hydrateMembers);
   const hydrateLabels = useLabelsStore((state) => state.hydrateLabels);
   const hydrateViews = useViewsStore((state) => state.hydrateViews);
   const hydrateGoals = useMilestonesStore((state) => state.hydrateGoals);
   const hydrateCycles = useCyclesStore((state) => state.hydrateCycles);
   const hydrateApprovals = useApprovalsStore((state) => state.hydrateApprovals);

   // Repository pickers show only for hosts that work, which takes a listing
   // to know; asked now, it is answered before anyone opens a picker.
   useEffect(() => {
      if (status === 'ready' && workspaceId) warmRepositoryProbe(workspaceId);
   }, [status, workspaceId]);

   useEffect(() => {
      if (status !== 'ready' || !boardId) return;
      if (seededBoardId === boardId && seededBoardRetry === retryToken) return;
      let cancelled = false;
      const sameBoard = seededBoardId === boardId;
      if (!sameBoard) setIssuesLoadState('loading');
      // The first load paints each page as it lands rather than after the
      // last one. Pages are merged, not swapped in: a task opened by direct
      // link is added while the board loads, and a partial page must not
      // read as its deletion. A board switch or a retry keeps the list it
      // has until the whole new one replaces it below.
      const initialLoad = !sameBoard && useIssuesStore.getState().issues.length === 0;
      // The first page lands at once; later pages are buffered and merged in
      // one store update when the browser is idle, once MERGE_BATCH_SIZE tasks
      // are waiting, so pages arriving close together do not re-render the
      // list once each. The tail below a full batch lands with the final list.
      let firstPageSeen = false;
      let buffered: Issue[] = [];
      let cancelFlush: (() => void) | undefined;
      const dropBuffered = () => {
         cancelFlush?.();
         cancelFlush = undefined;
         buffered = [];
      };
      const flushBuffered = () => {
         cancelFlush = undefined;
         if (cancelled || buffered.length === 0) return;
         const batch = buffered;
         buffered = [];
         mergeIssues(batch);
      };
      const issuesLoad = loadBoardIssues(boardId, {
         onPage: initialLoad
            ? (page) => {
                 if (cancelled) return;
                 if (!firstPageSeen) {
                    firstPageSeen = true;
                    mergeIssues(page);
                    return;
                 }
                 buffered.push(...page);
                 if (buffered.length >= MERGE_BATCH_SIZE) cancelFlush ??= whenIdle(flushBuffered);
              }
            : undefined,
      })
         .then((issues) => {
            // The full list supersedes any batch still waiting.
            dropBuffered();
            if (cancelled) return;
            seededBoardId = boardId;
            seededBoardRetry = retryToken;
            hydrateIssues(issues);
            setIssuesLoadState('ready');
         })
         .catch((error: unknown) => {
            if (cancelled) return;
            setIssuesLoadState(
               'error',
               error instanceof BerryApiError ? error.message : 'Tasks could not be loaded.'
            );
         });
      // The run list is not part of the first screen: it loads when the
      // tasks have landed and the browser is idle.
      let cancelIdle: (() => void) | undefined;
      const loadRuns = () => {
         cancelIdle = whenIdle(() => {
            void loadBoardRuns(boardId, { first: 200 })
               .then((runs) => {
                  if (!cancelled) hydrateRuns(runs, null);
               })
               .catch((error: unknown) => {
                  if (!cancelled) {
                     hydrateRuns(
                        [],
                        error instanceof BerryApiError ? error.message : 'Runs could not be loaded.'
                     );
                  }
               });
         });
      };
      void issuesLoad.then(loadRuns, loadRuns);
      return () => {
         cancelled = true;
         dropBuffered();
         cancelIdle?.();
      };
   }, [status, boardId, hydrateIssues, mergeIssues, hydrateRuns, setIssuesLoadState, retryToken]);

   useEffect(() => {
      if (status !== 'ready' || !workspaceId) return;
      let cancelled = false;
      const viewer = user ?? currentUser;
      // A person lead is resolved from the member store while each project is
      // mapped. Load the roster first: running both requests in parallel meant a
      // fast project response permanently became "Unknown member", because the
      // later member hydration did not remap projects already in the store.
      const critical: Promise<unknown>[] = [];
      critical.push(
         loadWorkspaceMembers(workspaceId).then(async (members) => {
            if (cancelled) return;
            hydrateMembers(members);
            const projects = await loadWorkspaceProjects(workspaceId);
            if (!cancelled) hydrateProjects(projects);
         }),
         loadWorkspaceInbox(workspaceId, viewer).then((items) => {
            if (!cancelled) hydrateNotifications(items);
         }),
         loadInboxUnreadCount(workspaceId).then((count) => {
            if (!cancelled) setServerUnreadCount(count);
         }),
         loadWorkspaceAgents()
            .then((agents) => {
               if (!cancelled) hydrateAgents(agents, null);
            })
            .catch((error: unknown) => {
               if (!cancelled) {
                  hydrateAgents(
                     [],
                     error instanceof BerryApiError
                        ? error.message
                        : 'Agent runtime is unavailable.'
                  );
               }
            }),
         loadWorkspaceLabels(workspaceId).then((labels) => {
            if (!cancelled) hydrateLabels(labels);
         })
      );
      // Views, milestones, cycles and approvals are not on the first screen:
      // they load once the critical data has landed and the browser is idle.
      // Other screens read these stores and expect them to fill by themselves.
      let cancelIdle: (() => void) | undefined;
      const loadDeferred = () => {
         if (cancelled) return;
         cancelIdle = whenIdle(() => {
            if (cancelled) return;
            loadDeferredBody();
         });
      };
      const loadDeferredBody = () => {
         void loadWorkspaceViews(workspaceId, viewer).then((views) => {
            if (!cancelled) hydrateViews(views);
         });
         void loadWorkspaceMilestones(workspaceId).then((milestones) => {
            if (!cancelled) hydrateGoals(milestones);
         });
         void loadWorkspaceCycles(workspaceId).then((cycles) => {
            if (!cancelled) hydrateCycles(cycles);
         });
         void loadWorkspaceApprovals(workspaceId).then((approvals) => {
            if (!cancelled) hydrateApprovals(approvals);
         });
      };
      void Promise.allSettled(critical).then(loadDeferred);
      return () => {
         cancelled = true;
         cancelIdle?.();
      };
   }, [
      status,
      workspaceId,
      user,
      hydrateProjects,
      hydrateNotifications,
      setServerUnreadCount,
      hydrateAgents,
      hydrateMembers,
      hydrateLabels,
      hydrateViews,
      hydrateGoals,
      hydrateCycles,
      hydrateApprovals,
   ]);
}
