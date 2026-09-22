'use client';

import {
   getWorkspaceUsage,
   getWorkspaceWork,
   usageQueryKey,
   type UsageQuery,
   type WorkspaceWork,
} from '@/lib/usage';
import { useSessionStore } from '@/store/session-store';
import { useUsage } from './use-usage';

/** The window an index page's KPI cards look back over. */
export const KPI_DAYS = 30;

/** Tasks finishing, runs ending, approvals answered and usage recorded all move these figures. */
const refreshOnWork = (type: string) => /^(issue\.|agent\.|approval\.|usage\.recorded)/.test(type);

export interface WorkKpis {
   work: WorkspaceWork;
   costMicros: number;
}

/**
 * What an index page's KPI cards are computed from: the window's output (tasks
 * done, lead time, first-pass rate, what waits on a person) and its spend.
 * Null until the first read lands, so a card shows a dash rather than a zero.
 */
export function useWorkKpis(scope: Pick<UsageQuery, 'projectId'> = {}): WorkKpis | null {
   const workspaceId = useSessionStore((state) => state.workspace?.id ?? null);
   const query: UsageQuery = { days: KPI_DAYS, projectId: scope.projectId };
   const { data } = useUsage(
      workspaceId
         ? async () => {
              const [work, usage] = await Promise.all([
                 getWorkspaceWork(workspaceId, query),
                 getWorkspaceUsage(workspaceId, query),
              ]);
              return { work, costMicros: usage.totals.costMicros };
           }
         : null,
      `kpis:${workspaceId}:${usageQueryKey(query)}`,
      refreshOnWork
   );
   return data;
}
