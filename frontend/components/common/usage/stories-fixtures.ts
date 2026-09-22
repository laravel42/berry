import { http, HttpResponse } from 'msw';

import type {
   DashboardOverview,
   IssueUsage,
   RuntimeUsage,
   UsageBucket,
   UsageErrors,
   WorkspaceUsage,
} from '@/lib/usage';
import { useSessionStore } from '@/store/session-store';

/**
 * Usage payloads as `/api/v1/usage/*` and `/api/v1/dashboard/*` return them,
 * shared by the usage, dashboard and runtime stories. Numbers are generated
 * from a fixed formula so every render (and every snapshot) is identical.
 */

export const WORKSPACE_ID = 'ws-1';

/** The signed-in admin every usage screen reads through. */
export function seedAdminSession() {
   const workspace = { id: WORKSPACE_ID, name: 'Elian', slug: 'elian', role: 'admin' };
   useSessionStore.setState({
      status: 'ready',
      workspace,
      workspaces: [workspace],
      boardId: 'board-1',
      user: {
         id: 'user-1',
         name: 'Andrea Lunelio',
         avatarUrl: '',
         email: 'andrea@elian.dev',
         status: 'online',
         role: 'Admin',
         joinedDate: '2026-01-12',
         teamIds: [],
         timezone: 'UTC',
      },
   });
}

export function bucket(key: string, scale: number, unpricedEvents = 0): UsageBucket {
   const events = Math.round(12 * scale);
   return {
      key,
      events,
      unpricedEvents,
      inputTokens: Math.round(184_000 * scale),
      outputTokens: Math.round(22_500 * scale),
      cacheReadTokens: Math.round(96_000 * scale),
      cacheWriteTokens: Math.round(14_000 * scale),
      costMicros: Math.round(1_420_000 * scale),
   };
}

/** `count` consecutive days ending on 2026-09-18, oldest first. */
export function dayKeys(count: number): string[] {
   const end = Date.UTC(2026, 8, 18);
   return Array.from({ length: count }, (_, index) =>
      new Date(end - (count - 1 - index) * 86_400_000).toISOString().slice(0, 10)
   );
}

/** A believable week: busy midweek, quiet weekends, a spike now and then. */
function dayScale(index: number): number {
   const weekday = index % 7;
   const base = weekday >= 5 ? 0.2 : 0.8 + (weekday % 3) * 0.35;
   return index % 11 === 4 ? base * 2.4 : base;
}

export function dailyBuckets(count: number): UsageBucket[] {
   return dayKeys(count).map((key, index) => bucket(key, dayScale(index)));
}

const window30 = {
   currency: 'USD' as const,
   days: 30,
   from: '2026-08-20T00:00:00Z',
   to: '2026-09-18T23:59:59Z',
   timezone: 'UTC',
   boardId: null,
   projectId: null,
};

const agentRows = [
   { key: 'agent-eng', agentName: 'Engineer', scale: 14.2 },
   { key: 'agent-rev', agentName: 'Code Reviewer', scale: 6.8 },
   { key: 'agent-orch', agentName: 'Orchestrator', scale: 3.1 },
   { key: 'agent-qa', agentName: 'QA Analyst', scale: 1.4 },
];

const modelRows = [
   { key: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0', scale: 18.6 },
   { key: 'us.anthropic.claude-haiku-4-5-20251001-v1:0', scale: 6.1 },
   { key: 'us.amazon.nova-pro-v1:0', scale: 0.8, unpriced: 3 },
];

const byAgent = agentRows.map((row) => ({
   ...bucket(row.key, row.scale),
   agentName: row.agentName,
}));
const byModel = modelRows.map((row) => bucket(row.key, row.scale, row.unpriced ?? 0));

export const workspaceUsage: WorkspaceUsage = {
   ...window30,
   totals: { ...bucket('total', 25.5), unpricedEvents: 3 },
   daily: dailyBuckets(30),
   byAgent,
   byModel,
   runs: { runs: 142, failed: 9, runSeconds: 41_820 },
   series: {
      grain: 'day',
      points: dailyBuckets(30).map((day, index) => ({
         key: day.key,
         costMicros: day.costMicros,
         tokens: day.inputTokens + day.outputTokens,
         events: day.events,
         runs: (index * 7) % 11,
      })),
   },
   topIssues: [],
};

export const emptyWorkspaceUsage: WorkspaceUsage = {
   ...window30,
   totals: bucket('total', 0),
   daily: dayKeys(30).map((key) => bucket(key, 0)),
   byAgent: [],
   byModel: [],
   runs: { runs: 0, failed: 0, runSeconds: 0 },
   series: { grain: 'day', points: [] },
   topIssues: [],
};

export const usageErrors: UsageErrors = {
   ...window30,
   failedRuns: 9,
   succeededRuns: 128,
   cancelledRuns: 5,
   totalRuns: 142,
   agentsAffected: 3,
   daily: dayKeys(30).map((day, index) => {
      const total = Math.round(6 * dayScale(index));
      const failed = Math.min(total, index % 9 === 2 ? 2 : index % 13 === 5 ? 1 : 0);
      const cancelled = index % 10 === 7 ? Math.min(1, total - failed) : 0;
      return { day, total, succeeded: total - failed - cancelled, failed, cancelled };
   }),
   byType: [
      { code: 'RUNTIME_TIMEOUT', count: 4 },
      { code: 'TOOL_DENIED', count: 3 },
      { code: 'MODEL_THROTTLED', count: 2 },
   ],
   offenders: [
      { agentId: 'agent-eng', agentName: 'Engineer', failed: 5, total: 88 },
      { agentId: 'agent-qa', agentName: 'QA Analyst', failed: 2, total: 4 },
      { agentId: 'agent-rev', agentName: 'Code Reviewer', failed: 2, total: 37 },
   ],
};

export const emptyUsageErrors: UsageErrors = {
   ...window30,
   failedRuns: 0,
   succeededRuns: 0,
   cancelledRuns: 0,
   totalRuns: 0,
   agentsAffected: 0,
   daily: dayKeys(30).map((day) => ({ day, total: 0, succeeded: 0, failed: 0, cancelled: 0 })),
   byType: [],
   offenders: [],
};

export const dashboard: DashboardOverview = {
   ...window30,
   usageDaily: dailyBuckets(30),
   runsDaily: dayKeys(30).map((day, index) => {
      const total = Math.round(6 * dayScale(index));
      const failed = index % 9 === 2 ? Math.min(2, total) : 0;
      const cancelled = index % 10 === 7 ? Math.min(1, total - failed) : 0;
      return { day, total, succeeded: total - failed - cancelled, failed, cancelled };
   }),
   failuresByAgent: [
      { agentId: 'agent-eng', agentName: 'Engineer', failed: 5, total: 88 },
      { agentId: 'agent-rev', agentName: 'Code Reviewer', failed: 2, total: 37 },
   ],
   runCounts: { queued: 2, running: 3, succeeded: 128, failed: 9, cancelled: 4 },
   workingAgents: [
      {
         runId: 'run-301',
         agentId: 'agent-eng',
         agentName: 'Engineer',
         issueId: 'issue-42',
         issueIdentifier: 'ELI-42',
         issueTitle: 'Persist project health to the database',
         startedAt: '2026-09-18T11:41:00Z',
      },
      {
         runId: 'run-302',
         agentId: 'agent-rev',
         agentName: 'Code Reviewer',
         issueId: 'issue-57',
         issueIdentifier: 'ELI-57',
         issueTitle: 'Review: move approvals into the inbox',
         startedAt: '2026-09-18T11:52:00Z',
      },
      {
         runId: 'run-303',
         agentId: 'agent-orch',
         agentName: 'Orchestrator',
         issueId: 'issue-61',
         issueIdentifier: 'ELI-61',
         issueTitle: 'Plan the shared list filter rollout',
         startedAt: null,
      },
   ],
   taskSnapshot: {
      backlog: 23,
      todo: 11,
      inProgress: 6,
      inReview: 4,
      blocked: 1,
      done: 87,
      cancelled: 5,
   },
   queuedRuns: [
      {
         runId: 'run-304',
         agentId: 'agent-qa',
         agentName: 'QA Analyst',
         issueId: 'issue-63',
         issueIdentifier: 'ELI-63',
         issueTitle: 'Cover health updates with DB-backed tests',
         createdAt: '2026-09-18T11:57:00Z',
      },
      {
         runId: 'run-305',
         agentId: 'agent-eng',
         agentName: 'Engineer',
         issueId: 'issue-64',
         issueIdentifier: 'ELI-64',
         issueTitle: 'Drop the OpenRouter fallback',
         createdAt: '2026-09-18T11:59:00Z',
      },
   ],
   recentRuns: [
      recentRun(
         'run-299',
         'Engineer',
         'agent-eng',
         'ELI-40',
         'Share the list filter through the URL',
         'succeeded',
         '11:31',
         '11:55'
      ),
      recentRun(
         'run-298',
         'QA Analyst',
         'agent-qa',
         'ELI-39',
         'Rotate the integration encryption key',
         'failed',
         '11:20',
         '11:32',
         'RUNTIME_TIMEOUT'
      ),
      recentRun(
         'run-297',
         'Code Reviewer',
         'agent-rev',
         'ELI-38',
         'Tighten task, review and display surfaces',
         'succeeded',
         '10:58',
         '11:12'
      ),
      recentRun(
         'run-296',
         'Orchestrator',
         'agent-orch',
         'ELI-37',
         'Route the invoices export',
         'cancelled',
         '10:40',
         '10:41'
      ),
      recentRun(
         'run-295',
         'Engineer',
         'agent-eng',
         'ELI-36',
         'Render run transcript steps in a code editor',
         'succeeded',
         '09:02',
         '10:20'
      ),
   ],
   pendingApprovals: [
      {
         id: 'appr-1',
         title: 'Start ELI-42: migrate project health to the database',
         risk: 'medium',
         requestedAt: '2026-09-18T09:30:00Z',
         issueIdentifier: 'ELI-42',
      },
      {
         id: 'appr-2',
         title: 'Accept proposal: add an authorization check to the export route',
         risk: 'high',
         requestedAt: '2026-09-18T10:05:00Z',
         issueIdentifier: null,
      },
   ],
   pendingApprovalCount: 3,
   inReview: [
      {
         issueId: 'issue-50',
         identifier: 'ELI-50',
         title: 'Move approvals into the inbox',
         since: '2026-09-17T16:10:00Z',
      },
      {
         issueId: 'issue-51',
         identifier: 'ELI-51',
         title: 'Persist project health and updates',
         since: '2026-09-18T08:45:00Z',
      },
      {
         issueId: 'issue-52',
         identifier: 'ELI-52',
         title: 'Retint autonomy chips',
         since: '2026-09-18T10:30:00Z',
      },
   ],
   today: { ...bucket('today', 1.7), unpricedEvents: 0 },
};

function recentRun(
   runId: string,
   agentName: string,
   agentId: string,
   issueIdentifier: string,
   issueTitle: string,
   status: 'succeeded' | 'failed' | 'cancelled',
   started: string,
   completed: string,
   failureCode: string | null = null
): DashboardOverview['recentRuns'][number] {
   return {
      runId,
      agentId,
      agentName,
      issueId: `issue-${issueIdentifier}`,
      issueIdentifier,
      issueTitle,
      status,
      failureCode,
      startedAt: `2026-09-18T${started}:00Z`,
      completedAt: `2026-09-18T${completed}:00Z`,
   };
}

export const quietDashboard: DashboardOverview = {
   ...dashboard,
   usageDaily: dayKeys(30).map((key) => bucket(key, 0)),
   runsDaily: dayKeys(30).map((day) => ({ day, total: 0, succeeded: 0, failed: 0, cancelled: 0 })),
   failuresByAgent: [],
   runCounts: { queued: 0, running: 0, succeeded: 0, failed: 0, cancelled: 0 },
   workingAgents: [],
   taskSnapshot: { backlog: 3, todo: 1 },
   queuedRuns: [],
   recentRuns: [],
   pendingApprovals: [],
   pendingApprovalCount: 0,
   inReview: [],
   today: bucket('today', 0),
};

const hourKeys = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0'));

export const runtimeUsage: RuntimeUsage = {
   ...window30,
   days: 180,
   totals: { ...bucket('total', 61.3), unpricedEvents: 3 },
   daily: dailyBuckets(182),
   byAgent,
   byHour: hourKeys.map((key, hour) =>
      bucket(key, hour >= 8 && hour <= 19 ? 1.6 + ((hour * 7) % 5) * 0.3 : 0.15)
   ),
   byModel,
   byDayModel: dayKeys(5).flatMap((day, index) => [
      {
         day,
         model: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
         tokens: 1_840_000 + index * 120_000,
         costMicros: 9_320_000 + index * 610_000,
         unpricedEvents: 0,
      },
      {
         day,
         model: 'us.amazon.nova-pro-v1:0',
         tokens: 42_000,
         costMicros: 0,
         unpricedEvents: index === 3 ? 3 : 0,
      },
   ]),
   runs: { runs: 386, failed: 21, runSeconds: 118_400 },
};

export const emptyRuntimeUsage: RuntimeUsage = {
   ...runtimeUsage,
   totals: bucket('total', 0),
   daily: dayKeys(30).map((key) => bucket(key, 0)),
   byAgent: [],
   byHour: hourKeys.map((key) => bucket(key, 0)),
   byModel: [],
   byDayModel: [],
   runs: { runs: 0, failed: 0, runSeconds: 0 },
};

export const issueUsage: IssueUsage = {
   currency: 'USD',
   totals: bucket('total', 1.9),
   byRun: [bucket('run-201', 1.1), bucket('run-202', 0.8)],
   byModel: [bucket('us.anthropic.claude-sonnet-4-5-20250929-v1:0', 1.9)],
};

/** The error envelope every Berry route answers a failure with. */
export function errorEnvelope(status: number, code: string, message: string) {
   return HttpResponse.json({ error: { code, message, requestId: 'req-story' } }, { status });
}

/** Handlers answering every usage read with its loaded fixture. */
export const usageHandlers = [
   http.get('*/api/v1/usage/:workspaceId/summary', () => HttpResponse.json(workspaceUsage)),
   http.get('*/api/v1/usage/:workspaceId/errors', () => HttpResponse.json(usageErrors)),
   http.get('*/api/v1/usage/:workspaceId/runtimes/:runtimeId', () =>
      HttpResponse.json(runtimeUsage)
   ),
   http.get('*/api/v1/usage/:workspaceId/issues/:issueId', () => HttpResponse.json(issueUsage)),
   http.get('*/api/v1/dashboard/:workspaceId/overview', () => HttpResponse.json(dashboard)),
];
