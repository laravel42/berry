import { z } from 'zod';
import { apiFetch } from './api';

/**
 * Usage and dashboard reads. Money arrives as integer USD micros and tokens as
 * integers; formatting happens here, once, so every panel says the same thing.
 *
 * Every windowed read takes the same three questions: how far back, whose days
 * (the bucketing zone), and which project. The answers travel back in the
 * response, so a panel can say what it is actually showing rather than what it
 * asked for.
 */

const bucketSchema = z.object({
   key: z.string(),
   events: z.number(),
   unpricedEvents: z.number(),
   inputTokens: z.number(),
   outputTokens: z.number(),
   cacheReadTokens: z.number(),
   cacheWriteTokens: z.number(),
   costMicros: z.number(),
});

const agentBucketSchema = bucketSchema.extend({ agentName: z.string() });

/** What the run ledger adds: how many runs, and how long they took. */
const runTotalsSchema = z.object({
   runs: z.number(),
   failed: z.number(),
   runSeconds: z.number(),
});

const windowSchema = z.object({
   currency: z.literal('USD'),
   days: z.number(),
   from: z.string(),
   to: z.string(),
   timezone: z.string().default('UTC'),
   boardId: z.string().nullable().default(null),
   projectId: z.string().nullable().default(null),
});

const workspaceUsageSchema = windowSchema.extend({
   totals: bucketSchema,
   daily: z.array(bucketSchema),
   byAgent: z.array(agentBucketSchema),
   byModel: z.array(bucketSchema),
   runs: runTotalsSchema,
   /**
    * The window as a chart draws it: by day, or by hour when everything that ran
    * falls inside two days. A workspace that worked for one afternoon would
    * otherwise get a 30-day chart holding a single bar.
    */
   series: z
      .object({
         grain: z.enum(['hour', 'day']),
         points: z.array(
            z.object({
               key: z.string(),
               costMicros: z.number(),
               tokens: z.number(),
               events: z.number(),
               runs: z.number(),
            })
         ),
      })
      .default({ grain: 'day', points: [] }),
   /** The tasks the most was spent on, costliest first. */
   topIssues: z
      .array(
         z.object({
            issueId: z.string(),
            identifier: z.string(),
            title: z.string(),
            costMicros: z.number(),
            runs: z.number(),
         })
      )
      .default([]),
});

/** What the window's spend produced. */
const workSchema = windowSchema.extend({
   tasksDone: z.number(),
   pullRequests: z.number(),
   commits: z.number(),
   runs: z.number(),
   runSeconds: z.number(),
   series: z.object({
      grain: z.enum(['hour', 'day']),
      points: z.array(z.object({ key: z.string(), tasksDone: z.number() })),
   }),
   byAgent: z.array(
      z.object({
         agentId: z.string(),
         agentName: z.string(),
         tasksDone: z.number(),
         runs: z.number(),
         runSeconds: z.number(),
      })
   ),
   /** Seconds from a task's creation to its completion; null when none finished. */
   duration: z
      .object({ median: z.number(), p90: z.number(), min: z.number(), max: z.number() })
      .nullable(),
   /** Runs that stopped for a reason a person can act on. */
   attention: z.object({ stepLimit: z.number(), deliveryFailed: z.number() }),
   /** Of the finished tasks an agent ran, how many took exactly one run. */
   firstPass: z.object({ oneRun: z.number(), total: z.number() }),
   /** What is stopped on a person right now, whatever the window. */
   waiting: z.object({
      reviews: z.number(),
      decisions: z.number(),
      oldestAt: z.string().nullable(),
   }),
});

const issueWorkSchema = z.object({
   issues: z.array(
      z.object({
         issueId: z.string(),
         costMicros: z.number(),
         runSeconds: z.number(),
         runs: z.number(),
      })
   ),
});
export type IssueWork = z.infer<typeof issueWorkSchema>['issues'][number];

const agentUsageSchema = windowSchema.extend({
   totals: bucketSchema,
   daily: z.array(bucketSchema),
   byModel: z.array(bucketSchema),
   runs: runTotalsSchema,
});

const dayModelSchema = z.object({
   day: z.string(),
   model: z.string(),
   tokens: z.number(),
   costMicros: z.number(),
   unpricedEvents: z.number(),
});

const runtimeUsageSchema = windowSchema.extend({
   totals: bucketSchema,
   daily: z.array(bucketSchema),
   byAgent: z.array(agentBucketSchema),
   byHour: z.array(bucketSchema),
   byModel: z.array(bucketSchema),
   byDayModel: z.array(dayModelSchema),
   runs: runTotalsSchema,
});

const issueUsageSchema = z.object({
   currency: z.literal('USD'),
   totals: bucketSchema,
   byRun: z.array(bucketSchema),
   byModel: z.array(bucketSchema),
});

const errorsSchema = windowSchema.extend({
   failedRuns: z.number(),
   succeededRuns: z.number().default(0),
   cancelledRuns: z.number().default(0),
   totalRuns: z.number(),
   agentsAffected: z.number(),
   /** Each day's runs by outcome; queued and running ones count only in `total`. */
   daily: z.array(
      z.object({
         day: z.string(),
         total: z.number(),
         succeeded: z.number().default(0),
         failed: z.number(),
         cancelled: z.number().default(0),
      })
   ),
   byType: z.array(z.object({ code: z.string(), count: z.number() })),
   offenders: z.array(
      z.object({
         agentId: z.string(),
         agentName: z.string(),
         failed: z.number(),
         total: z.number(),
      })
   ),
});

/** A run named for a person: who is on it, and which task, by key and title. */
const liveRunSchema = z.object({
   runId: z.string(),
   agentId: z.string(),
   agentName: z.string(),
   issueId: z.string(),
   issueIdentifier: z.string().default(''),
   issueTitle: z.string(),
});

const dashboardSchema = windowSchema.extend({
   usageDaily: z.array(bucketSchema),
   runsDaily: z.array(
      z.object({
         day: z.string(),
         total: z.number(),
         succeeded: z.number(),
         failed: z.number(),
         cancelled: z.number(),
      })
   ),
   failuresByAgent: z.array(
      z.object({
         agentId: z.string(),
         agentName: z.string(),
         failed: z.number(),
         total: z.number(),
      })
   ),
   runCounts: z.object({
      queued: z.number(),
      running: z.number(),
      succeeded: z.number(),
      failed: z.number(),
      cancelled: z.number(),
   }),
   workingAgents: z.array(liveRunSchema.extend({ startedAt: z.string().nullable() })),
   taskSnapshot: z.record(z.string(), z.number()),
   queuedRuns: z.array(liveRunSchema.extend({ createdAt: z.string() })).default([]),
   recentRuns: z
      .array(
         liveRunSchema.extend({
            status: z.enum(['succeeded', 'failed', 'cancelled']),
            failureCode: z.string().nullable(),
            startedAt: z.string().nullable(),
            completedAt: z.string(),
         })
      )
      .default([]),
   pendingApprovals: z
      .array(
         z.object({
            id: z.string(),
            title: z.string(),
            risk: z.string(),
            requestedAt: z.string(),
            issueIdentifier: z.string().nullable(),
         })
      )
      .default([]),
   pendingApprovalCount: z.number().default(0),
   inReview: z
      .array(
         z.object({
            issueId: z.string(),
            identifier: z.string(),
            title: z.string(),
            since: z.string(),
         })
      )
      .default([]),
   today: bucketSchema.nullable().default(null),
});

export type UsageBucket = z.infer<typeof bucketSchema>;
export type AgentUsageBucket = z.infer<typeof agentBucketSchema>;
export type RunTotals = z.infer<typeof runTotalsSchema>;
export type DayModelRow = z.infer<typeof dayModelSchema>;
export type WorkspaceUsage = z.infer<typeof workspaceUsageSchema>;
export type WorkspaceWork = z.infer<typeof workSchema>;
export type AgentUsage = z.infer<typeof agentUsageSchema>;
export type RuntimeUsage = z.infer<typeof runtimeUsageSchema>;
export type IssueUsage = z.infer<typeof issueUsageSchema>;
export type UsageErrors = z.infer<typeof errorsSchema>;
export type DashboardOverview = z.infer<typeof dashboardSchema>;

export const USAGE_DAY_OPTIONS = [7, 30, 90] as const;
/** A runtime's own page reaches back further: the heatmap wants 26 weeks. */
export const RUNTIME_DAY_OPTIONS = [7, 30, 90, 180] as const;

/** How far back, in whose days, and on which board or project. */
export interface UsageQuery {
   days: number;
   timezone?: string | undefined;
   /** A board (the workspace's issue container). The UI filters by project instead. */
   boardId?: string | null | undefined;
   /** A project: narrows every read to the tasks linked to it. */
   projectId?: string | null | undefined;
}

/** A stable cache key for a read of `query`: every field that changes the answer. */
export function usageQueryKey(query: UsageQuery): string {
   return [query.days, query.timezone ?? '', query.boardId ?? '', query.projectId ?? ''].join(':');
}

function base(workspaceId: string): string {
   return `/api/v1/usage/${encodeURIComponent(workspaceId)}`;
}

function search(query: UsageQuery): string {
   const params = new URLSearchParams({ days: String(query.days) });
   if (query.timezone) params.set('tz', query.timezone);
   if (query.boardId) params.set('boardId', query.boardId);
   if (query.projectId) params.set('projectId', query.projectId);
   return `?${params.toString()}`;
}

async function read<T>(path: string, schema: z.ZodType<T>): Promise<T> {
   const json: unknown = await apiFetch(path);
   const parsed = schema.safeParse(json);
   if (!parsed.success) throw new Error('Usage response was not recognized');
   return parsed.data;
}

export function getWorkspaceUsage(workspaceId: string, query: UsageQuery): Promise<WorkspaceUsage> {
   return read(`${base(workspaceId)}/summary${search(query)}`, workspaceUsageSchema);
}

export function getWorkspaceWork(workspaceId: string, query: UsageQuery): Promise<WorkspaceWork> {
   return read(`${base(workspaceId)}/work${search(query)}`, workSchema);
}

/** Time and money per task, for a task list's rows. Not windowed. */
export async function getIssueWork(
   workspaceId: string,
   scope: Pick<UsageQuery, 'projectId' | 'boardId'> = {}
): Promise<IssueWork[]> {
   const body = await read(
      `${base(workspaceId)}/issues${search({ days: 1, ...scope })}`,
      issueWorkSchema
   );
   return body.issues;
}

export function getUsageErrors(workspaceId: string, query: UsageQuery): Promise<UsageErrors> {
   return read(`${base(workspaceId)}/errors${search(query)}`, errorsSchema);
}

export function getAgentUsage(
   workspaceId: string,
   agentId: string,
   query: UsageQuery
): Promise<AgentUsage> {
   return read(
      `${base(workspaceId)}/agents/${encodeURIComponent(agentId)}${search(query)}`,
      agentUsageSchema
   );
}

export function getRuntimeUsage(
   workspaceId: string,
   runtimeId: string,
   query: UsageQuery
): Promise<RuntimeUsage> {
   return read(
      `${base(workspaceId)}/runtimes/${encodeURIComponent(runtimeId)}${search(query)}`,
      runtimeUsageSchema
   );
}

export function getIssueUsage(workspaceId: string, issueId: string): Promise<IssueUsage> {
   return read(`${base(workspaceId)}/issues/${encodeURIComponent(issueId)}`, issueUsageSchema);
}

export function getDashboard(workspaceId: string, query: UsageQuery): Promise<DashboardOverview> {
   return read(
      `/api/v1/dashboard/${encodeURIComponent(workspaceId)}/overview${search(query)}`,
      dashboardSchema
   );
}

/** Micros to dollars, with more places for small amounts so a cheap run is not "$0.00". */
export function formatCost(micros: number): string {
   const dollars = micros / 1_000_000;
   if (micros === 0) return '$0';
   return `$${dollars.toFixed(dollars < 1 ? 4 : 2)}`;
}

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

export function formatTokens(count: number): string {
   return compact.format(count);
}

/** Run time as a person reads it: "3 h 12 m", "45 m", "30 s". */
export function formatDuration(seconds: number): string {
   if (seconds <= 0) return '0 s';
   const hours = Math.floor(seconds / 3600);
   const minutes = Math.round((seconds % 3600) / 60);
   if (hours > 0) return `${hours} h ${minutes} min`;
   if (seconds >= 60) return `${Math.round(seconds / 60)} min`;
   return `${Math.round(seconds)} s`;
}

/** A series point's label: the hour of an hourly key, the day and month of a daily one. */
export function seriesLabel(key: string, grain: 'hour' | 'day'): string {
   if (grain === 'hour') return key.slice(11, 13);
   const [, month, day] = key.split('-');
   return `${Number(day)}/${Number(month)}`;
}

/** Seconds as a person reads a span of work: `45 s`, `12 min`, `3 h 24 min`. */
/** How long ago `iso` was, as the largest whole unit: "7 h", "3 d". */
export function formatAge(iso: string, now: number = Date.now()): string {
   const seconds = Math.max(0, (now - Date.parse(iso)) / 1000);
   if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} min`;
   if (seconds < 86400) return `${Math.round(seconds / 3600)} h`;
   return `${Math.round(seconds / 86400)} d`;
}

/** A span short enough for a headline figure: "45 s", "12 min", "8 h 52". */
export function formatSpanShort(seconds: number): string {
   if (seconds < 90) return `${Math.round(seconds)} s`;
   const minutes = Math.round(seconds / 60);
   if (minutes < 60) return `${minutes} min`;
   return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}

export function formatSpan(seconds: number): string {
   if (seconds < 90) return `${Math.round(seconds)} s`;
   const minutes = Math.round(seconds / 60);
   if (minutes < 60) return `${minutes} min`;
   const hours = Math.floor(minutes / 60);
   const rest = minutes % 60;
   return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

export function totalTokens(bucket: UsageBucket): number {
   return (
      bucket.inputTokens + bucket.outputTokens + bucket.cacheReadTokens + bucket.cacheWriteTokens
   );
}

function emptyBucket(key: string): UsageBucket {
   return {
      key,
      events: 0,
      unpricedEvents: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costMicros: 0,
   };
}

/**
 * Daily buckets folded into weeks of seven, newest week last.
 *
 * The server answers days because that is what it stores; a long window read
 * day by day is unreadable, so the chart offers weeks. The first group may be
 * short — a window rarely starts on a week boundary — and is left short rather
 * than padded, because a half week that claims to be whole reads as a dip.
 */
export function weeklyBuckets(daily: UsageBucket[]): UsageBucket[] {
   const weeks: UsageBucket[] = [];
   const leading = daily.length % 7;
   let index = 0;
   while (index < daily.length) {
      const size = weeks.length === 0 && leading > 0 ? leading : 7;
      const slice = daily.slice(index, index + size);
      const first = slice[0];
      if (!first) break;
      const week = slice.reduce(
         (sum, day) => ({
            key: sum.key,
            events: sum.events + day.events,
            unpricedEvents: sum.unpricedEvents + day.unpricedEvents,
            inputTokens: sum.inputTokens + day.inputTokens,
            outputTokens: sum.outputTokens + day.outputTokens,
            cacheReadTokens: sum.cacheReadTokens + day.cacheReadTokens,
            cacheWriteTokens: sum.cacheWriteTokens + day.cacheWriteTokens,
            costMicros: sum.costMicros + day.costMicros,
         }),
         emptyBucket(first.key)
      );
      weeks.push(week);
      index += size;
   }
   return weeks;
}
