import type { ScopedQuery } from '../identity/workspace-context.ts';
import { formatIdentifier } from '../core/issues.ts';
import { toRFC3339 } from '../db/pool.ts';
import { issueStatusToApi } from '../runs/ledger.ts';

/**
 * Every read behind the Usage page, the Dashboard and the usage panels.
 *
 * Each takes a {@link ScopedQuery}, and each predicate is on
 * `q.workspaceId` — the membership-confirmed scope, never a request value —
 * so a foreign id finds nothing rather than someone else's spend. Charts read
 * the hourly rollup; a task's own panel reads the raw rows, because it wants
 * each run and there are few.
 *
 * Days are cut in the window's timezone, not always in UTC: a workspace that
 * works in Tokyo should not see its evening counted as tomorrow. A project
 * filter is the one thing the rollup cannot answer — it keeps no board — so a
 * filtered read falls back to the raw rows, shaped to look the same.
 */

export interface UsageWindow {
   days: number;
   from: string;
   to: string;
   /** IANA zone the daily and hourly buckets are cut in. */
   timezone: string;
}

/**
 * The offset of a zone at an instant, in milliseconds: what has to be added to
 * UTC to read the local wall clock.
 */
function zoneOffsetMs(at: Date, timeZone: string): number {
   const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
   }).formatToParts(at);
   const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? '0');
   // `hour` formats midnight as 24 in some locales' hour-cycle handling.
   const hour = read('hour') % 24;
   const asIfUtc = Date.UTC(read('year'), read('month') - 1, read('day'), hour, read('minute'), read('second'));
   return asIfUtc - at.getTime();
}

/** Whole local days: today plus the `days - 1` before it, cut in `timezone`. */
export function usageWindow(days: number, now: Date = new Date(), timezone = 'UTC'): UsageWindow {
   const offset = zoneOffsetMs(now, timezone);
   const local = new Date(now.getTime() + offset);
   const localMidnight = Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate() - (days - 1)
   );
   // Two passes: the second uses the offset in force at the start of the
   // window rather than now, so a window spanning a DST change still begins
   // at local midnight.
   const approximate = localMidnight - offset;
   const start = new Date(localMidnight - zoneOffsetMs(new Date(approximate), timezone));
   return { days, from: start.toISOString(), to: now.toISOString(), timezone };
}

export interface UsageBucket {
   key: string;
   events: number;
   /** Reports with no published price; their tokens count, their cost does not. */
   unpricedEvents: number;
   inputTokens: number;
   outputTokens: number;
   cacheReadTokens: number;
   cacheWriteTokens: number;
   costMicros: number;
}

export interface AgentUsageBucket extends UsageBucket {
   agentName: string;
}

/** What the run ledger adds to a window: how many, and how long they took. */
export interface RunTotals {
   runs: number;
   failed: number;
   /** Wall-clock seconds of finished runs. A run still going adds nothing yet. */
   runSeconds: number;
}

type Row = Record<string, unknown>;

function toBucket(row: Row | undefined, fallbackKey = 'total'): UsageBucket {
   return {
      key: row?.key === undefined || row.key === null ? fallbackKey : String(row.key),
      events: Number(row?.events ?? 0),
      unpricedEvents: Number(row?.unpriced_events ?? 0),
      inputTokens: Number(row?.input_tokens ?? 0),
      outputTokens: Number(row?.output_tokens ?? 0),
      cacheReadTokens: Number(row?.cache_read_tokens ?? 0),
      cacheWriteTokens: Number(row?.cache_write_tokens ?? 0),
      costMicros: Number(row?.cost_micros ?? 0),
   };
}

function toAgentBucket(row: Row): AgentUsageBucket {
   return { ...toBucket(row), agentName: String(row.agent_name) };
}

/** What narrows a usage read beyond the workspace. */
export interface UsageFilter {
   agentId?: string | undefined;
   /** `{ id: null }` is the workspace-default runtime. Absent means every runtime. */
   runtime?: { id: string | null } | undefined;
   /** One board. Only the raw rows know it, so it changes the source. */
   boardId?: string | undefined;
   /**
    * One project: the tasks linked to it through `issue_project_links`. Like a
    * board, only the raw rows name the task, so it changes the source too.
    */
   projectId?: string | undefined;
}

/** The ids of the tasks linked to the filter's project, for an `IN (…)` clause. */
function projectIssues(q: ScopedQuery, projectId: string) {
   return q.sql`
      SELECT l.issue_id FROM issue_project_links AS l
       WHERE l.workspace_id = ${q.workspaceId} AND l.project_id = ${projectId}`;
}

function sums(q: ScopedQuery) {
   return q.sql`
      COALESCE(SUM(h.events), 0)::bigint AS events,
      COALESCE(SUM(h.unpriced_events), 0)::bigint AS unpriced_events,
      COALESCE(SUM(h.input_tokens), 0)::bigint AS input_tokens,
      COALESCE(SUM(h.output_tokens), 0)::bigint AS output_tokens,
      COALESCE(SUM(h.cache_read_tokens), 0)::bigint AS cache_read_tokens,
      COALESCE(SUM(h.cache_write_tokens), 0)::bigint AS cache_write_tokens,
      COALESCE(SUM(h.cost_micros), 0)::bigint AS cost_micros`;
}

/**
 * Where a usage read gets its rows.
 *
 * Without a board or project filter it is the hourly rollup, which is what it
 * is for. With one it is `task_usage`, shaped into the same columns — one row
 * is one report, so `events` is 1 and an unpriced report is 1 — because only
 * the raw row names the task, and only the task names its board and project.
 */
function usageSource(q: ScopedQuery, filter: UsageFilter) {
   if (filter.boardId === undefined && filter.projectId === undefined) {
      return q.sql`task_usage_hourly`;
   }
   const board = filter.boardId === undefined ? q.sql`` : q.sql`AND i.board_id = ${filter.boardId}`;
   const project =
      filter.projectId === undefined
         ? q.sql``
         : q.sql`AND i.id IN (${projectIssues(q, filter.projectId)})`;
   return q.sql`(
      SELECT u.workspace_id, u.occurred_at AS bucket, u.agent_id, u.runtime_id, u.model,
             1 AS events,
             CASE WHEN u.cost_micros IS NULL THEN 1 ELSE 0 END AS unpriced_events,
             u.input_tokens, u.output_tokens, u.cache_read_tokens, u.cache_write_tokens,
             COALESCE(u.cost_micros, 0) AS cost_micros
        FROM task_usage AS u
        JOIN issues AS i ON i.id = u.issue_id
       WHERE TRUE ${board} ${project}
   )`;
}

function narrow(q: ScopedQuery, filter: UsageFilter) {
   const agent = filter.agentId ? q.sql`AND h.agent_id = ${filter.agentId}` : q.sql``;
   const runtime =
      filter.runtime === undefined
         ? q.sql``
         : filter.runtime.id === null
           ? q.sql`AND h.runtime_id IS NULL`
           : q.sql`AND h.runtime_id = ${filter.runtime.id}`;
   return q.sql`${agent} ${runtime}`;
}

/** The window's local days, as timestamps in the window's zone. */
function localDays(q: ScopedQuery, window: UsageWindow) {
   return q.sql`generate_series(
      date_trunc('day', ${window.from}::timestamptz AT TIME ZONE ${window.timezone}),
      date_trunc('day', ${window.to}::timestamptz AT TIME ZONE ${window.timezone}),
      interval '1 day')`;
}

async function usageTotals(q: ScopedQuery, window: UsageWindow, filter: UsageFilter) {
   const [row] = await q.sql`
      SELECT 'total' AS key, ${sums(q)}
        FROM ${usageSource(q, filter)} AS h
       WHERE h.workspace_id = ${q.workspaceId} AND h.bucket >= ${window.from}
             ${narrow(q, filter)}`;
   return toBucket(row);
}

async function usageDaily(q: ScopedQuery, window: UsageWindow, filter: UsageFilter) {
   const rows = await q.sql`
      SELECT to_char(d.day, 'YYYY-MM-DD') AS key, ${sums(q)}
        FROM ${localDays(q, window)} AS d(day)
        LEFT JOIN ${usageSource(q, filter)} AS h
          ON h.workspace_id = ${q.workspaceId}
         AND h.bucket >= d.day AT TIME ZONE ${window.timezone}
         AND h.bucket < (d.day + interval '1 day') AT TIME ZONE ${window.timezone}
             ${narrow(q, filter)}
       GROUP BY d.day
       ORDER BY d.day`;
   return rows.map((row) => toBucket(row));
}

async function usageByAgent(q: ScopedQuery, window: UsageWindow, filter: UsageFilter) {
   const rows = await q.sql`
      SELECT h.agent_id::text AS key, COALESCE(a.name, 'Removed agent') AS agent_name,
             ${sums(q)}
        FROM ${usageSource(q, filter)} AS h
        LEFT JOIN agents AS a ON a.id = h.agent_id
       WHERE h.workspace_id = ${q.workspaceId} AND h.bucket >= ${window.from}
             ${narrow(q, filter)}
       GROUP BY h.agent_id, a.name
       ORDER BY cost_micros DESC, input_tokens DESC
       LIMIT 50`;
   return rows.map(toAgentBucket);
}

async function usageByModel(q: ScopedQuery, window: UsageWindow, filter: UsageFilter) {
   const rows = await q.sql`
      SELECT h.model AS key, ${sums(q)}
        FROM ${usageSource(q, filter)} AS h
       WHERE h.workspace_id = ${q.workspaceId} AND h.bucket >= ${window.from}
             ${narrow(q, filter)}
       GROUP BY h.model
       ORDER BY cost_micros DESC, input_tokens DESC
       LIMIT 50`;
   return rows.map((row) => toBucket(row));
}

async function usageByHour(q: ScopedQuery, window: UsageWindow, filter: UsageFilter) {
   const rows = await q.sql`
      SELECT to_char(g.hour, 'FM00') AS key, ${sums(q)}
        FROM generate_series(0, 23) AS g(hour)
        LEFT JOIN ${usageSource(q, filter)} AS h
          ON h.workspace_id = ${q.workspaceId}
         AND h.bucket >= ${window.from}
         AND EXTRACT(HOUR FROM h.bucket AT TIME ZONE ${window.timezone}) = g.hour
             ${narrow(q, filter)}
       GROUP BY g.hour
       ORDER BY g.hour`;
   return rows.map((row) => toBucket(row));
}

/** One row per day and model, for the runtime's day-by-model table. */
export interface DayModelRow {
   day: string;
   model: string;
   tokens: number;
   costMicros: number;
   unpricedEvents: number;
}

async function usageByDayModel(
   q: ScopedQuery,
   window: UsageWindow,
   filter: UsageFilter
): Promise<DayModelRow[]> {
   const rows = await q.sql`
      SELECT to_char(h.bucket AT TIME ZONE ${window.timezone}, 'YYYY-MM-DD') AS day,
             h.model AS model,
             COALESCE(SUM(h.input_tokens + h.output_tokens + h.cache_read_tokens
                          + h.cache_write_tokens), 0)::bigint AS tokens,
             COALESCE(SUM(h.cost_micros), 0)::bigint AS cost_micros,
             COALESCE(SUM(h.unpriced_events), 0)::bigint AS unpriced_events
        FROM ${usageSource(q, filter)} AS h
       WHERE h.workspace_id = ${q.workspaceId} AND h.bucket >= ${window.from}
             ${narrow(q, filter)}
       GROUP BY 1, 2
       ORDER BY 1 DESC, cost_micros DESC
       LIMIT 500`;
   return rows.map((row) => ({
      day: String(row.day),
      model: String(row.model),
      tokens: Number(row.tokens),
      costMicros: Number(row.cost_micros),
      unpricedEvents: Number(row.unpriced_events),
   }));
}

/** Runs scoped to the workspace, and to one board or project when the read asks for one. */
function runsInScope(q: ScopedQuery, filter: UsageFilter) {
   const board = filter.boardId ? q.sql`AND r.board_id = ${filter.boardId}` : q.sql``;
   const project = filter.projectId
      ? q.sql`AND r.issue_id IN (${projectIssues(q, filter.projectId)})`
      : q.sql``;
   const agent = filter.agentId ? q.sql`AND r.agent_id = ${filter.agentId}` : q.sql``;
   const runtime =
      filter.runtime === undefined
         ? q.sql``
         : filter.runtime.id === null
           ? q.sql`AND r.runtime_id IS NULL`
           : q.sql`AND r.runtime_id = ${filter.runtime.id}`;
   return q.sql`
      SELECT r.id, r.agent_id, r.issue_id, r.status, r.failure_code, r.created_at,
             r.started_at, r.completed_at
        FROM runs AS r
       WHERE r.workspace_id = ${q.workspaceId} ${board} ${project} ${agent} ${runtime}`;
}

async function runTotals(
   q: ScopedQuery,
   window: UsageWindow,
   filter: UsageFilter
): Promise<RunTotals> {
   const [row] = await q.sql`
      SELECT COUNT(*)::bigint AS runs,
             COUNT(*) FILTER (WHERE r.status = 'failed')::bigint AS failed,
             COALESCE(SUM(EXTRACT(EPOCH FROM (r.completed_at - r.started_at)))
                      FILTER (WHERE r.completed_at IS NOT NULL AND r.started_at IS NOT NULL), 0) AS seconds
        FROM (${runsInScope(q, filter)}) AS r
       WHERE r.created_at >= ${window.from}`;
   return {
      runs: Number(row?.runs ?? 0),
      failed: Number(row?.failed ?? 0),
      runSeconds: Math.round(Number(row?.seconds ?? 0)),
   };
}

/**
 * How a chart of the window should be drawn: by day, or by hour when all the
 * activity falls inside two days.
 *
 * A workspace that ran for one afternoon has a 30-day window holding one
 * non-empty day, and a daily chart of it is a single bar. The frame is taken
 * from the runs in scope, since nothing is spent or finished without one.
 */
export interface SeriesFrame {
   grain: 'hour' | 'day';
   /** The first and last bucket, as instants; null when nothing ran. */
   from: string | null;
   to: string | null;
}

const HOURLY_SPAN_HOURS = 48;

async function seriesFrame(q: ScopedQuery, window: UsageWindow, filter: UsageFilter): Promise<SeriesFrame> {
   const [row] = await q.sql`
      SELECT date_trunc('hour', MIN(r.created_at)) AS first_hour,
             date_trunc('hour', MAX(COALESCE(r.completed_at, r.created_at))) AS last_hour
        FROM (${runsInScope(q, filter)}) AS r
       WHERE r.created_at >= ${window.from}`;
   const first = (row?.first_hour as string | null) ?? null;
   const last = (row?.last_hour as string | null) ?? null;
   if (!first || !last) return { grain: 'day', from: null, to: null };
   const hours = (new Date(last).getTime() - new Date(first).getTime()) / 3_600_000;
   return hours <= HOURLY_SPAN_HOURS ? { grain: 'hour', from: first, to: last } : { grain: 'day', from: null, to: null };
}

/** The frame's buckets as local timestamps: every hour between the two ends, or every day of the window. */
function frameBuckets(q: ScopedQuery, window: UsageWindow, frame: SeriesFrame) {
   if (frame.grain === 'hour' && frame.from && frame.to) {
      return q.sql`generate_series(
         ${frame.from}::timestamptz AT TIME ZONE ${window.timezone},
         ${frame.to}::timestamptz AT TIME ZONE ${window.timezone},
         interval '1 hour')`;
   }
   return localDays(q, window);
}

export interface SeriesPoint {
   /** `YYYY-MM-DD` for a day, `YYYY-MM-DD HH` for an hour, in the window's zone. */
   key: string;
   costMicros: number;
   tokens: number;
   events: number;
   runs: number;
}

async function usageSeries(q: ScopedQuery, window: UsageWindow, filter: UsageFilter, frame: SeriesFrame): Promise<SeriesPoint[]> {
   const step = frame.grain === 'hour' ? q.sql`interval '1 hour'` : q.sql`interval '1 day'`;
   const format = frame.grain === 'hour' ? 'YYYY-MM-DD HH24' : 'YYYY-MM-DD';
   const rows = await q.sql`
      SELECT to_char(b.at, ${format}) AS key,
             (SELECT COALESCE(SUM(h.cost_micros), 0)::bigint
                FROM ${usageSource(q, filter)} AS h
               WHERE h.workspace_id = ${q.workspaceId}
                 AND h.bucket >= b.at AT TIME ZONE ${window.timezone}
                 AND h.bucket < (b.at + ${step}) AT TIME ZONE ${window.timezone}
                     ${narrow(q, filter)}) AS cost_micros,
             (SELECT COALESCE(SUM(h.input_tokens + h.output_tokens), 0)::bigint
                FROM ${usageSource(q, filter)} AS h
               WHERE h.workspace_id = ${q.workspaceId}
                 AND h.bucket >= b.at AT TIME ZONE ${window.timezone}
                 AND h.bucket < (b.at + ${step}) AT TIME ZONE ${window.timezone}
                     ${narrow(q, filter)}) AS tokens,
             (SELECT COALESCE(SUM(h.events), 0)::bigint
                FROM ${usageSource(q, filter)} AS h
               WHERE h.workspace_id = ${q.workspaceId}
                 AND h.bucket >= b.at AT TIME ZONE ${window.timezone}
                 AND h.bucket < (b.at + ${step}) AT TIME ZONE ${window.timezone}
                     ${narrow(q, filter)}) AS events,
             (SELECT COUNT(*)::bigint FROM (${runsInScope(q, filter)}) AS r
               WHERE r.created_at >= b.at AT TIME ZONE ${window.timezone}
                 AND r.created_at < (b.at + ${step}) AT TIME ZONE ${window.timezone}) AS runs
        FROM ${frameBuckets(q, window, frame)} AS b(at)
       ORDER BY b.at`;
   return rows.map((row) => ({
      key: String(row.key),
      costMicros: Number(row.cost_micros ?? 0),
      tokens: Number(row.tokens ?? 0),
      events: Number(row.events ?? 0),
      runs: Number(row.runs ?? 0),
   }));
}

export interface IssueSpend {
   issueId: string;
   identifier: string;
   title: string;
   costMicros: number;
   runs: number;
}

/** The tasks the most was spent on. Always from the raw rows: only they name the task. */
async function usageTopIssues(q: ScopedQuery, window: UsageWindow, filter: UsageFilter): Promise<IssueSpend[]> {
   const board = filter.boardId ? q.sql`AND i.board_id = ${filter.boardId}` : q.sql``;
   const project = filter.projectId ? q.sql`AND i.id IN (${projectIssues(q, filter.projectId)})` : q.sql``;
   const agent = filter.agentId ? q.sql`AND u.agent_id = ${filter.agentId}` : q.sql``;
   const rows = await q.sql`
      SELECT i.id::text AS issue_id, berry_issue_identifier(b.workspace_id, i.number) AS identifier, i.title,
             COALESCE(SUM(u.cost_micros), 0)::bigint AS cost_micros,
             COUNT(DISTINCT u.run_id)::bigint AS runs
        FROM task_usage AS u
        JOIN issues AS i ON i.id = u.issue_id
        JOIN boards AS b ON b.id = i.board_id
       WHERE u.workspace_id = ${q.workspaceId} AND u.occurred_at >= ${window.from}
             ${board} ${project} ${agent}
       GROUP BY i.id, b.workspace_id, i.number, i.title
      HAVING COALESCE(SUM(u.cost_micros), 0) > 0
       ORDER BY cost_micros DESC
       LIMIT 5`;
   return rows.map((row) => ({
      issueId: String(row.issue_id),
      identifier: String(row.identifier),
      title: String(row.title),
      costMicros: Number(row.cost_micros ?? 0),
      runs: Number(row.runs ?? 0),
   }));
}

export async function workspaceUsage(q: ScopedQuery, window: UsageWindow, filter: UsageFilter = {}) {
   const frame = await seriesFrame(q, window, filter);
   const [totals, daily, byAgent, byModel, runs, points, topIssues] = await Promise.all([
      usageTotals(q, window, filter),
      usageDaily(q, window, filter),
      usageByAgent(q, window, filter),
      usageByModel(q, window, filter),
      runTotals(q, window, filter),
      usageSeries(q, window, filter, frame),
      usageTopIssues(q, window, filter),
   ]);
   return { totals, daily, byAgent, byModel, runs, series: { grain: frame.grain, points }, topIssues };
}

/**
 * What the window's spend produced: tasks that reached done, the pull requests
 * and commits delivered on the way, how long a task takes, and who did it.
 *
 * A task counts once, at its latest `issue.completed` inside the window, and
 * only while it is still done: one reopened since is not output. Whose it was
 * is the agent it is assigned to now, which is who delivered it.
 */
export interface WorkOverview {
   tasksDone: number;
   pullRequests: number;
   commits: number;
   runs: number;
   runSeconds: number;
   series: { grain: 'hour' | 'day'; points: Array<{ key: string; tasksDone: number }> };
   byAgent: Array<{ agentId: string; agentName: string; tasksDone: number; runs: number; runSeconds: number }>;
   /** Seconds from a task's creation to its completion; null when no task finished. */
   duration: { median: number; p90: number; min: number; max: number } | null;
   /** Runs that stopped for a reason a person can act on. */
   attention: { stepLimit: number; deliveryFailed: number };
   /** Of the tasks finished in the window that an agent ran, how many took exactly one run. */
   firstPass: { oneRun: number; total: number };
   /**
    * What is stopped on a person right now, whatever the window: tasks in
    * review and approvals still pending. `oldestAt` is when the longest-waiting
    * one began to wait; null when nothing waits.
    */
   waiting: { reviews: number; decisions: number; oldestAt: string | null };
}

/** Tasks in review: a person's approval is what they wait for. */
function waitingReviews(q: ScopedQuery, filter: UsageFilter) {
   const board = filter.boardId ? q.sql`AND i.board_id = ${filter.boardId}` : q.sql``;
   const project = filter.projectId ? q.sql`AND i.id IN (${projectIssues(q, filter.projectId)})` : q.sql``;
   const agent = filter.agentId ? q.sql`AND i.assignee_type = 'agent' AND i.assignee_id = ${filter.agentId}` : q.sql``;
   return q.sql`
      SELECT i.id, i.updated_at AS since
        FROM issues AS i
        JOIN boards AS b ON b.id = i.board_id AND b.workspace_id = ${q.workspaceId}
       WHERE i.deleted_at IS NULL AND i.status = 'in_review' ${board} ${project} ${agent}`;
}

/** Approvals nobody has answered yet. One without a task belongs to no board, project or agent. */
function waitingDecisions(q: ScopedQuery, filter: UsageFilter) {
   const board = filter.boardId ? q.sql`AND a.issue_id IN (SELECT i.id FROM issues AS i WHERE i.board_id = ${filter.boardId})` : q.sql``;
   const project = filter.projectId ? q.sql`AND a.issue_id IN (${projectIssues(q, filter.projectId)})` : q.sql``;
   const agent = filter.agentId
      ? q.sql`AND a.issue_id IN (SELECT i.id FROM issues AS i WHERE i.assignee_type = 'agent' AND i.assignee_id = ${filter.agentId})`
      : q.sql``;
   return q.sql`
      SELECT a.id, a.requested_at AS since
        FROM approvals AS a
       WHERE a.workspace_id = ${q.workspaceId} AND a.status = 'pending' ${board} ${project} ${agent}`;
}

function completedInScope(q: ScopedQuery, window: UsageWindow, filter: UsageFilter) {
   const board = filter.boardId ? q.sql`AND i.board_id = ${filter.boardId}` : q.sql``;
   const project = filter.projectId ? q.sql`AND i.id IN (${projectIssues(q, filter.projectId)})` : q.sql``;
   const agent = filter.agentId ? q.sql`AND i.assignee_type = 'agent' AND i.assignee_id = ${filter.agentId}` : q.sql``;
   return q.sql`
      SELECT i.id, i.created_at, i.assignee_type, i.assignee_id, MAX(e.occurred_at) AS completed_at
        FROM outbox_events AS e
        JOIN issues AS i ON i.id = e.aggregate_id AND i.deleted_at IS NULL AND i.status = 'done'
       WHERE e.workspace_id = ${q.workspaceId} AND e.topic = 'issue.completed'
         AND e.occurred_at >= ${window.from} ${board} ${project} ${agent}
       GROUP BY i.id`;
}

export async function workOverview(q: ScopedQuery, window: UsageWindow, filter: UsageFilter = {}): Promise<WorkOverview> {
   const frame = await seriesFrame(q, window, filter);
   const step = frame.grain === 'hour' ? q.sql`interval '1 hour'` : q.sql`interval '1 day'`;
   const format = frame.grain === 'hour' ? 'YYYY-MM-DD HH24' : 'YYYY-MM-DD';
   const [[totals], [delivered], points, agents, [spread], runs, [passes], [waits]] = await Promise.all([
      q.sql`SELECT COUNT(*)::bigint AS done FROM (${completedInScope(q, window, filter)}) AS c`,
      q.sql`
         SELECT COUNT(DISTINCT (r.issue_id, r.pull_request_number)) FILTER (WHERE r.pull_request_number IS NOT NULL)::bigint AS pull_requests,
                COUNT(*) FILTER (WHERE r.head_commit IS NOT NULL)::bigint AS commits,
                COUNT(*) FILTER (WHERE r.failure_code = 'RUN_LIMIT_REACHED')::bigint AS step_limit,
                COUNT(*) FILTER (WHERE r.failure_code = 'DELIVERY_FAILED')::bigint AS delivery_failed
           FROM runs AS r
          WHERE r.id IN (SELECT s.id FROM (${runsInScope(q, filter)}) AS s WHERE s.created_at >= ${window.from})`,
      q.sql`
         SELECT to_char(b.at, ${format}) AS key,
                (SELECT COUNT(*)::bigint FROM (${completedInScope(q, window, filter)}) AS c
                  WHERE c.completed_at >= b.at AT TIME ZONE ${window.timezone}
                    AND c.completed_at < (b.at + ${step}) AT TIME ZONE ${window.timezone}) AS done
           FROM ${frameBuckets(q, window, frame)} AS b(at)
          ORDER BY b.at`,
      q.sql`
         SELECT a.id::text AS agent_id, a.name AS agent_name,
                (SELECT COUNT(*)::bigint FROM (${completedInScope(q, window, filter)}) AS c
                  WHERE c.assignee_type = 'agent' AND c.assignee_id = a.id) AS done,
                COUNT(r.id)::bigint AS runs,
                COALESCE(SUM(EXTRACT(EPOCH FROM (r.completed_at - r.started_at)))
                         FILTER (WHERE r.completed_at IS NOT NULL AND r.started_at IS NOT NULL), 0) AS seconds
           FROM agents AS a
           LEFT JOIN (${runsInScope(q, filter)}) AS r ON r.agent_id = a.id AND r.created_at >= ${window.from}
          WHERE a.workspace_id = ${q.workspaceId}
          GROUP BY a.id, a.name
         HAVING COUNT(r.id) > 0
          ORDER BY done DESC, seconds DESC
          LIMIT 50`,
      q.sql`
         SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (c.completed_at - c.created_at))) AS median,
                percentile_cont(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (c.completed_at - c.created_at))) AS p90,
                MIN(EXTRACT(EPOCH FROM (c.completed_at - c.created_at))) AS shortest,
                MAX(EXTRACT(EPOCH FROM (c.completed_at - c.created_at))) AS longest
           FROM (${completedInScope(q, window, filter)}) AS c`,
      runTotals(q, window, filter),
      q.sql`
         SELECT COUNT(*) FILTER (WHERE n.runs = 1)::bigint AS one_run, COUNT(*)::bigint AS total
           FROM (SELECT c.id, COUNT(r.id) AS runs
                   FROM (${completedInScope(q, window, filter)}) AS c
                   JOIN (${runsInScope(q, filter)}) AS r ON r.issue_id = c.id
                  GROUP BY c.id) AS n`,
      q.sql`
         SELECT (SELECT COUNT(*)::bigint FROM (${waitingReviews(q, filter)}) AS w) AS reviews,
                (SELECT COUNT(*)::bigint FROM (${waitingDecisions(q, filter)}) AS w) AS decisions,
                LEAST((SELECT MIN(w.since) FROM (${waitingReviews(q, filter)}) AS w),
                      (SELECT MIN(w.since) FROM (${waitingDecisions(q, filter)}) AS w)) AS oldest`,
   ]);
   const done = Number(totals?.done ?? 0);
   return {
      tasksDone: done,
      pullRequests: Number(delivered?.pull_requests ?? 0),
      commits: Number(delivered?.commits ?? 0),
      runs: runs.runs,
      runSeconds: runs.runSeconds,
      series: { grain: frame.grain, points: points.map((row) => ({ key: String(row.key), tasksDone: Number(row.done ?? 0) })) },
      byAgent: agents.map((row) => ({
         agentId: String(row.agent_id),
         agentName: String(row.agent_name),
         tasksDone: Number(row.done ?? 0),
         runs: Number(row.runs ?? 0),
         runSeconds: Math.round(Number(row.seconds ?? 0)),
      })),
      duration:
         done === 0 || spread?.median == null
            ? null
            : {
                 median: Math.round(Number(spread.median)),
                 p90: Math.round(Number(spread.p90)),
                 min: Math.max(0, Math.round(Number(spread.shortest))),
                 max: Math.round(Number(spread.longest)),
              },
      attention: { stepLimit: Number(delivered?.step_limit ?? 0), deliveryFailed: Number(delivered?.delivery_failed ?? 0) },
      firstPass: { oneRun: Number(passes?.one_run ?? 0), total: Number(passes?.total ?? 0) },
      waiting: {
         reviews: Number(waits?.reviews ?? 0),
         decisions: Number(waits?.decisions ?? 0),
         // The API's client hands timestamps back as text; a plain one (the tests') as a Date.
         oldestAt: waits?.oldest == null ? null : waits.oldest instanceof Date ? waits.oldest.toISOString() : toRFC3339(String(waits.oldest)),
      },
   };
}

/**
 * Time and money per task, for the rows of a task list. One row per task that
 * has a run or a usage event; a task with neither is absent, not zero.
 */
export async function issueWork(q: ScopedQuery, filter: UsageFilter = {}) {
   const project = filter.projectId ? q.sql`AND i.id IN (${projectIssues(q, filter.projectId)})` : q.sql``;
   const board = filter.boardId ? q.sql`AND i.board_id = ${filter.boardId}` : q.sql``;
   const rows = await q.sql`
      SELECT i.id::text AS issue_id,
             COALESCE(u.cost_micros, 0)::bigint AS cost_micros,
             COALESCE(r.seconds, 0) AS seconds,
             COALESCE(r.runs, 0)::bigint AS runs
        FROM issues AS i
        JOIN boards AS b ON b.id = i.board_id AND b.workspace_id = ${q.workspaceId}
        LEFT JOIN (SELECT t.issue_id, SUM(t.cost_micros) AS cost_micros
                     FROM task_usage AS t WHERE t.workspace_id = ${q.workspaceId} GROUP BY t.issue_id) AS u ON u.issue_id = i.id
        LEFT JOIN (SELECT s.issue_id, COUNT(*) AS runs,
                          SUM(EXTRACT(EPOCH FROM (s.completed_at - s.started_at)))
                             FILTER (WHERE s.completed_at IS NOT NULL AND s.started_at IS NOT NULL) AS seconds
                     FROM runs AS s WHERE s.workspace_id = ${q.workspaceId} AND s.issue_id IS NOT NULL GROUP BY s.issue_id) AS r ON r.issue_id = i.id
       WHERE i.deleted_at IS NULL AND (u.issue_id IS NOT NULL OR r.issue_id IS NOT NULL) ${project} ${board}`;
   return rows.map((row) => ({
      issueId: String(row.issue_id),
      costMicros: Number(row.cost_micros ?? 0),
      runSeconds: Math.round(Number(row.seconds ?? 0)),
      runs: Number(row.runs ?? 0),
   }));
}

export async function agentUsage(q: ScopedQuery, agentId: string, window: UsageWindow) {
   const filter: UsageFilter = { agentId };
   const [totals, daily, byModel, runs] = await Promise.all([
      usageTotals(q, window, filter),
      usageDaily(q, window, filter),
      usageByModel(q, window, filter),
      runTotals(q, window, filter),
   ]);
   return { totals, daily, byModel, runs };
}

export async function runtimeUsage(q: ScopedQuery, runtimeId: string | null, window: UsageWindow) {
   const filter: UsageFilter = { runtime: { id: runtimeId } };
   const [totals, daily, byAgent, byHour, byModel, byDayModel, runs] = await Promise.all([
      usageTotals(q, window, filter),
      usageDaily(q, window, filter),
      usageByAgent(q, window, filter),
      usageByHour(q, window, filter),
      usageByModel(q, window, filter),
      usageByDayModel(q, window, filter),
      runTotals(q, window, filter),
   ]);
   return { totals, daily, byAgent, byHour, byModel, byDayModel, runs };
}

/**
 * Whether a runtime id may be read from this workspace.
 *
 * `agent_runtimes` is workstream A's table and may not exist yet. Until it
 * does, only the workspace default (`'default'`, handled by the mount) is a
 * runtime. A platform runtime (no workspace) is visible to every workspace;
 * its usage is still filtered to this one.
 */
export async function runtimeVisible(q: ScopedQuery, runtimeId: string): Promise<boolean> {
   const [registry] = await q.sql`
      SELECT to_regclass('public.agent_runtimes') IS NOT NULL AS present`;
   if (!registry?.present) return false;
   const rows = await q.sql`
      SELECT 1 FROM agent_runtimes
       WHERE id = ${runtimeId}
         AND (workspace_id = ${q.workspaceId} OR workspace_id IS NULL)`;
   return rows.length > 0;
}

export async function issueInWorkspace(q: ScopedQuery, issueId: string): Promise<boolean> {
   const rows = await q.sql`
      SELECT 1 FROM issues AS i
        JOIN boards AS b ON b.id = i.board_id
       WHERE i.id = ${issueId} AND b.workspace_id = ${q.workspaceId} AND i.deleted_at IS NULL`;
   return rows.length > 0;
}

/** The board filter names a board; a board of another workspace is not one. */
export async function boardInWorkspace(q: ScopedQuery, boardId: string): Promise<boolean> {
   const rows = await q.sql`
      SELECT 1 FROM boards AS b WHERE b.id = ${boardId} AND b.workspace_id = ${q.workspaceId}`;
   return rows.length > 0;
}

/** A live project of this workspace; another workspace's, or a deleted one, is not. */
export async function projectInWorkspace(q: ScopedQuery, projectId: string): Promise<boolean> {
   const rows = await q.sql`
      SELECT 1 FROM projects AS p
       WHERE p.id = ${projectId} AND p.workspace_id = ${q.workspaceId} AND p.deleted_at IS NULL`;
   return rows.length > 0;
}

function rawSums(q: ScopedQuery) {
   return q.sql`
      COUNT(u.id)::bigint AS events,
      COUNT(u.id) FILTER (WHERE u.cost_micros IS NULL)::bigint AS unpriced_events,
      COALESCE(SUM(u.input_tokens), 0)::bigint AS input_tokens,
      COALESCE(SUM(u.output_tokens), 0)::bigint AS output_tokens,
      COALESCE(SUM(u.cache_read_tokens), 0)::bigint AS cache_read_tokens,
      COALESCE(SUM(u.cache_write_tokens), 0)::bigint AS cache_write_tokens,
      COALESCE(SUM(u.cost_micros), 0)::bigint AS cost_micros`;
}

export async function issueUsage(q: ScopedQuery, issueId: string) {
   const [totalsRow] = await q.sql`
      SELECT 'total' AS key, ${rawSums(q)}
        FROM task_usage AS u
       WHERE u.workspace_id = ${q.workspaceId} AND u.issue_id = ${issueId}`;
   const byRun = await q.sql`
      SELECT u.run_id::text AS key, ${rawSums(q)}
        FROM task_usage AS u
       WHERE u.workspace_id = ${q.workspaceId} AND u.issue_id = ${issueId}
       GROUP BY u.run_id
       ORDER BY MIN(u.occurred_at)`;
   const byModel = await q.sql`
      SELECT u.model AS key, ${rawSums(q)}
        FROM task_usage AS u
       WHERE u.workspace_id = ${q.workspaceId} AND u.issue_id = ${issueId}
       GROUP BY u.model
       ORDER BY cost_micros DESC`;
   return {
      totals: toBucket(totalsRow),
      byRun: byRun.map((row) => toBucket(row)),
      byModel: byModel.map((row) => toBucket(row)),
   };
}

export interface ErrorsOverview {
   failedRuns: number;
   succeededRuns: number;
   cancelledRuns: number;
   totalRuns: number;
   agentsAffected: number;
   /** Every run of the day by outcome; queued and running ones count only in `total`. */
   daily: Array<{
      day: string;
      total: number;
      succeeded: number;
      failed: number;
      cancelled: number;
   }>;
   byType: Array<{ code: string; count: number }>;
   /** Ranked by failures; `total` is the sample each rate is computed from. */
   offenders: Array<{ agentId: string; agentName: string; failed: number; total: number }>;
}

/**
 * The runs tab: how the window's runs ended, when, what failed, and whose.
 *
 * The rate is deliberately not computed here. An agent that failed one of one
 * run is not "100% failing", and only a reader who can see the sample size can
 * judge that — so both numbers travel together.
 */
export async function errorsOverview(
   q: ScopedQuery,
   window: UsageWindow,
   filter: UsageFilter = {}
): Promise<ErrorsOverview> {
   const scope = runsInScope(q, filter);
   const [totals, daily, byType, offenders] = await Promise.all([
      q.sql`
         SELECT COUNT(*)::bigint AS total,
                COUNT(*) FILTER (WHERE r.status = 'failed')::bigint AS failed,
                COUNT(*) FILTER (WHERE r.status = 'succeeded')::bigint AS succeeded,
                COUNT(*) FILTER (WHERE r.status = 'cancelled')::bigint AS cancelled,
                COUNT(DISTINCT r.agent_id) FILTER (WHERE r.status = 'failed')::bigint AS agents
           FROM (${scope}) AS r
          WHERE r.created_at >= ${window.from}`,
      q.sql`
         SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
                COUNT(r.id)::bigint AS total,
                COUNT(r.id) FILTER (WHERE r.status = 'succeeded')::bigint AS succeeded,
                COUNT(r.id) FILTER (WHERE r.status = 'failed')::bigint AS failed,
                COUNT(r.id) FILTER (WHERE r.status = 'cancelled')::bigint AS cancelled
           FROM ${localDays(q, window)} AS d(day)
           LEFT JOIN (${scope}) AS r
             ON r.created_at >= d.day AT TIME ZONE ${window.timezone}
            AND r.created_at < (d.day + interval '1 day') AT TIME ZONE ${window.timezone}
          GROUP BY d.day
          ORDER BY d.day`,
      q.sql`
         SELECT COALESCE(r.failure_code, 'UNKNOWN') AS code, COUNT(*)::bigint AS count
           FROM (${scope}) AS r
          WHERE r.status = 'failed' AND r.created_at >= ${window.from}
          GROUP BY 1
          ORDER BY count DESC, code ASC
          LIMIT 20`,
      q.sql`
         SELECT r.agent_id::text AS agent_id, COALESCE(a.name, 'Removed agent') AS agent_name,
                COUNT(*) FILTER (WHERE r.status = 'failed')::bigint AS failed,
                COUNT(*)::bigint AS total
           FROM (${scope}) AS r
           LEFT JOIN agents AS a ON a.id = r.agent_id
          WHERE r.created_at >= ${window.from}
          GROUP BY r.agent_id, a.name
         HAVING COUNT(*) FILTER (WHERE r.status = 'failed') > 0
          ORDER BY failed DESC, total DESC
          LIMIT 20`,
   ]);
   const head = totals[0];
   return {
      failedRuns: Number(head?.failed ?? 0),
      succeededRuns: Number(head?.succeeded ?? 0),
      cancelledRuns: Number(head?.cancelled ?? 0),
      totalRuns: Number(head?.total ?? 0),
      agentsAffected: Number(head?.agents ?? 0),
      daily: daily.map((row) => ({
         day: String(row.day),
         total: Number(row.total),
         succeeded: Number(row.succeeded),
         failed: Number(row.failed),
         cancelled: Number(row.cancelled),
      })),
      byType: byType.map((row) => ({ code: String(row.code), count: Number(row.count) })),
      offenders: offenders.map((row) => ({
         agentId: String(row.agent_id),
         agentName: String(row.agent_name),
         failed: Number(row.failed),
         total: Number(row.total),
      })),
   };
}

const RUN_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const;
type RunStatus = (typeof RUN_STATUSES)[number];

const TASK_STATUSES = ['backlog', 'todo', 'inProgress', 'inReview', 'blocked', 'done', 'cancelled'];

export interface DashboardOverview {
   usageDaily: UsageBucket[];
   runsDaily: Array<{ day: string; total: number; succeeded: number; failed: number; cancelled: number }>;
   failuresByAgent: Array<{ agentId: string; agentName: string; failed: number; total: number }>;
   runCounts: Record<RunStatus, number>;
   workingAgents: Array<LiveRun & { startedAt: string | null }>;
   taskSnapshot: Record<string, number>;
   /** Waiting for the runtime, oldest first. */
   queuedRuns: Array<LiveRun & { createdAt: string }>;
   /** The latest runs to end, newest first. */
   recentRuns: Array<
      LiveRun & {
         status: 'succeeded' | 'failed' | 'cancelled';
         failureCode: string | null;
         startedAt: string | null;
         completedAt: string;
      }
   >;
   /** Decisions only a person can make: pending approvals, oldest first, and their total. */
   pendingApprovals: Array<{
      id: string;
      title: string;
      risk: string;
      requestedAt: string;
      issueIdentifier: string | null;
   }>;
   pendingApprovalCount: number;
   /** Tasks waiting in review, longest waiting first; the total is `taskSnapshot.inReview`. */
   inReview: Array<{ issueId: string; identifier: string; title: string; since: string }>;
   /** What today (local midnight in the read's zone, until now) has cost so far. */
   today: UsageBucket;
}

/** A run named for a person: who is on it, and which task, by key and title. */
interface LiveRun {
   runId: string;
   agentId: string;
   agentName: string;
   issueId: string;
   issueIdentifier: string;
   issueTitle: string;
}

/** How many rows each live list carries; the page shows counts for the rest. */
const LIVE_LIST_LIMIT = 8;

function liveRun(row: Record<string, unknown>): LiveRun {
   return {
      runId: String(row.run_id),
      agentId: String(row.agent_id),
      agentName: String(row.agent_name),
      issueId: String(row.issue_id),
      issueIdentifier: formatIdentifier(String(row.issue_prefix ?? ''), Number(row.issue_number)),
      issueTitle: String(row.issue_title),
   };
}

const isoOrNull = (value: unknown): string | null =>
   value === null || value === undefined ? null : new Date(String(value)).toISOString();

/**
 * The workspace at a glance. Runs are scoped through their board, the way the
 * board-bound ledger reads them; the task snapshot is every live task now, not
 * only the window's. A board or project filter narrows every part of it: the
 * spend, the runs, who is working and the task snapshot.
 */
export async function dashboardOverview(
   q: ScopedQuery,
   window: UsageWindow,
   filter: Pick<UsageFilter, 'boardId' | 'projectId'> = {}
): Promise<DashboardOverview> {
   const runBoard = filter.boardId ? q.sql`AND r.board_id = ${filter.boardId}` : q.sql``;
   const runProject = filter.projectId
      ? q.sql`AND r.issue_id IN (${projectIssues(q, filter.projectId)})`
      : q.sql``;
   const boardRuns = q.sql`
      SELECT r.id, r.agent_id, r.issue_id, r.status, r.failure_code, r.created_at,
             r.started_at, r.completed_at
        FROM runs AS r
        JOIN boards AS b ON b.id = r.board_id
       WHERE b.workspace_id = ${q.workspaceId} ${runBoard} ${runProject}`;
   const taskBoard = filter.boardId ? q.sql`AND i.board_id = ${filter.boardId}` : q.sql``;
   const taskProject = filter.projectId
      ? q.sql`AND i.id IN (${projectIssues(q, filter.projectId)})`
      : q.sql``;

   const liveRunColumns = q.sql`
      r.id AS run_id, r.agent_id::text AS agent_id,
      COALESCE(a.name, 'Removed agent') AS agent_name,
      r.issue_id::text AS issue_id, i.title AS issue_title, i.number AS issue_number,
      w.settings->>'issuePrefix' AS issue_prefix`;
   const liveRunJoins = q.sql`
      JOIN issues AS i ON i.id = r.issue_id
      JOIN workspaces AS w ON w.id = ${q.workspaceId}
      LEFT JOIN agents AS a ON a.id = r.agent_id`;
   const approvalProject = filter.projectId
      ? q.sql`AND ap.issue_id IN (${projectIssues(q, filter.projectId)})`
      : q.sql``;
   const approvalBoard = filter.boardId
      ? q.sql`AND ap.issue_id IN (SELECT id FROM issues WHERE board_id = ${filter.boardId})`
      : q.sql``;

   const [queued, recent, approvals, approvalCount, reviewing, today] = await Promise.all([
      q.sql`
         SELECT ${liveRunColumns}, r.created_at
           FROM (${boardRuns}) AS r ${liveRunJoins}
          WHERE r.status = 'queued'
          ORDER BY r.created_at
          LIMIT ${LIVE_LIST_LIMIT}`,
      q.sql`
         SELECT ${liveRunColumns}, r.status::text AS status, r.failure_code,
                r.started_at, r.completed_at
           FROM (${boardRuns}) AS r ${liveRunJoins}
          WHERE r.status IN ('succeeded', 'failed', 'cancelled') AND r.completed_at IS NOT NULL
          ORDER BY r.completed_at DESC
          LIMIT ${LIVE_LIST_LIMIT}`,
      q.sql`
         SELECT ap.id::text AS id, ap.title, ap.risk, ap.requested_at,
                i.number AS issue_number, w.settings->>'issuePrefix' AS issue_prefix
           FROM approvals AS ap
           JOIN workspaces AS w ON w.id = ap.workspace_id
           LEFT JOIN issues AS i ON i.id = ap.issue_id
          WHERE ap.workspace_id = ${q.workspaceId} AND ap.status = 'pending'
                ${approvalProject} ${approvalBoard}
          ORDER BY ap.requested_at
          LIMIT ${LIVE_LIST_LIMIT}`,
      q.sql`
         SELECT COUNT(*)::bigint AS count
           FROM approvals AS ap
          WHERE ap.workspace_id = ${q.workspaceId} AND ap.status = 'pending'
                ${approvalProject} ${approvalBoard}`,
      q.sql`
         SELECT i.id::text AS issue_id, i.number AS issue_number, i.title, i.updated_at,
                w.settings->>'issuePrefix' AS issue_prefix
           FROM issues AS i
           JOIN boards AS b ON b.id = i.board_id
           JOIN workspaces AS w ON w.id = b.workspace_id
          WHERE b.workspace_id = ${q.workspaceId} AND i.deleted_at IS NULL
                AND i.status = 'in_review' ${taskBoard} ${taskProject}
          ORDER BY i.updated_at
          LIMIT ${LIVE_LIST_LIMIT}`,
      usageTotals(q, usageWindow(1, new Date(), window.timezone), filter),
   ]);

   const [spendDaily, runsDaily, failures, counts, working, tasks] = await Promise.all([
      usageDaily(q, window, filter),
      q.sql`
         SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
                COUNT(r.id)::bigint AS total,
                COUNT(r.id) FILTER (WHERE r.status = 'succeeded')::bigint AS succeeded,
                COUNT(r.id) FILTER (WHERE r.status = 'failed')::bigint AS failed,
                COUNT(r.id) FILTER (WHERE r.status = 'cancelled')::bigint AS cancelled
           FROM ${localDays(q, window)} AS d(day)
           LEFT JOIN (${boardRuns}) AS r
             ON r.created_at >= d.day AT TIME ZONE ${window.timezone}
            AND r.created_at < (d.day + interval '1 day') AT TIME ZONE ${window.timezone}
          GROUP BY d.day
          ORDER BY d.day`,
      q.sql`
         SELECT r.agent_id::text AS agent_id, COALESCE(a.name, 'Removed agent') AS agent_name,
                COUNT(*) FILTER (WHERE r.status = 'failed')::bigint AS failed,
                COUNT(*)::bigint AS total
           FROM (${boardRuns}) AS r
           LEFT JOIN agents AS a ON a.id = r.agent_id
          WHERE r.created_at >= ${window.from}
          GROUP BY r.agent_id, a.name
         HAVING COUNT(*) FILTER (WHERE r.status = 'failed') > 0
          ORDER BY failed DESC, total DESC
          LIMIT 20`,
      q.sql`
         SELECT r.status::text AS status, COUNT(*)::bigint AS count
           FROM (${boardRuns}) AS r
          WHERE r.created_at >= ${window.from} OR r.status IN ('queued', 'running')
          GROUP BY r.status`,
      q.sql`
         SELECT ${liveRunColumns}, r.started_at
           FROM (${boardRuns}) AS r ${liveRunJoins}
          WHERE r.status = 'running'
          ORDER BY r.started_at NULLS LAST
          LIMIT 50`,
      q.sql`
         SELECT i.status::text AS status, COUNT(*)::bigint AS count
           FROM issues AS i
           JOIN boards AS b ON b.id = i.board_id
          WHERE b.workspace_id = ${q.workspaceId} AND i.deleted_at IS NULL
                ${taskBoard} ${taskProject}
          GROUP BY i.status`,
   ]);

   const runCounts = Object.fromEntries(RUN_STATUSES.map((status) => [status, 0])) as Record<
      RunStatus,
      number
   >;
   for (const row of counts) {
      const status = String(row.status);
      if ((RUN_STATUSES as readonly string[]).includes(status)) {
         runCounts[status as RunStatus] = Number(row.count);
      }
   }

   const taskSnapshot: Record<string, number> = Object.fromEntries(
      TASK_STATUSES.map((status) => [status, 0])
   );
   for (const row of tasks) {
      const key = issueStatusToApi(String(row.status));
      taskSnapshot[key] = (taskSnapshot[key] ?? 0) + Number(row.count);
   }

   return {
      usageDaily: spendDaily,
      runsDaily: runsDaily.map((row) => ({
         day: String(row.day),
         total: Number(row.total),
         succeeded: Number(row.succeeded),
         failed: Number(row.failed),
         cancelled: Number(row.cancelled),
      })),
      failuresByAgent: failures.map((row) => ({
         agentId: String(row.agent_id),
         agentName: String(row.agent_name),
         failed: Number(row.failed),
         total: Number(row.total),
      })),
      runCounts,
      workingAgents: working.map((row) => ({ ...liveRun(row), startedAt: isoOrNull(row.started_at) })),
      taskSnapshot,
      queuedRuns: queued.map((row) => ({
         ...liveRun(row),
         createdAt: new Date(String(row.created_at)).toISOString(),
      })),
      recentRuns: recent.map((row) => ({
         ...liveRun(row),
         status: String(row.status) as 'succeeded' | 'failed' | 'cancelled',
         failureCode: row.failure_code === null ? null : String(row.failure_code),
         startedAt: isoOrNull(row.started_at),
         completedAt: new Date(String(row.completed_at)).toISOString(),
      })),
      pendingApprovals: approvals.map((row) => ({
         id: String(row.id),
         title: String(row.title),
         risk: String(row.risk),
         requestedAt: new Date(String(row.requested_at)).toISOString(),
         issueIdentifier:
            row.issue_number === null
               ? null
               : formatIdentifier(String(row.issue_prefix ?? ''), Number(row.issue_number)),
      })),
      pendingApprovalCount: Number(approvalCount[0]?.count ?? 0),
      inReview: reviewing.map((row) => ({
         issueId: String(row.issue_id),
         identifier: formatIdentifier(String(row.issue_prefix ?? ''), Number(row.issue_number)),
         title: String(row.title),
         since: new Date(String(row.updated_at)).toISOString(),
      })),
      today,
   };
}
