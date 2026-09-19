import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { personalTokenResolver } from '../auth/credentials.ts';
import { SessionService } from '../auth/sessions.ts';
import { issueTestToken } from '../auth/test-credentials.ts';
import { closeDatabase, openDatabase, type Sql } from '../db/pool.ts';
import { createApp, type BerryApp } from '../http/app.ts';
import { Registry } from '../http/registry.ts';
import { recordTaskUsage } from '../usage/record.ts';
import {
   addRun,
   cleanupUsageWorld,
   finishRun,
   seedUsageWorld,
   type UsageWorld,
} from '../usage/test-fixtures.ts';
import { usageMounts } from './usage.ts';

/**
 * The usage and dashboard mounts, driven through the real app. What matters
 * beyond the numbers is the boundary: another workspace's agent, task or
 * runtime answers exactly like one that does not exist.
 */

const url = process.env.BERRY_TEST_DATABASE_URL;

describe('usage mounts', { skip: url ? false : 'BERRY_TEST_DATABASE_URL is not set' }, () => {
   let sql: Sql;
   let app: BerryApp;
   let token = '';
   let mine: UsageWorld;
   let theirs: UsageWorld;

   before(async () => {
      sql = openDatabase({ url: url! });
      const sessions = new SessionService({ sql, auth: null, bearer: [personalTokenResolver(sql)] });
      const registry = new Registry();
      registry.registerAll(usageMounts({ sessions, sql }));
      app = createApp(registry);
      mine = await seedUsageWorld(sql, 'mnt');
      theirs = await seedUsageWorld(sql, 'mnt-other');
      for (const world of [mine, theirs]) {
         await recordTaskUsage(sql, {
            runId: world.runId,
            workspaceId: world.workspaceId,
            agentId: world.agentId,
            model: 'model-a',
            inputTokens: 40,
            outputTokens: 4,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
         });
      }
      token = await issueTestToken(sql, mine.userId);
   });

   after(async () => {
      await cleanupUsageWorld(sql, mine);
      await cleanupUsageWorld(sql, theirs);
      await closeDatabase(sql);
   });

   async function get(path: string, auth = true) {
      const response = await app.request(path, {
         headers: auth ? { authorization: `Bearer ${token}` } : {},
      });
      return { status: response.status, body: (await response.json()) as Record<string, unknown> };
   }

   test('the workspace summary counts only this workspace', async () => {
      const { status, body } = await get(`/api/v1/usage/${mine.workspaceId}/summary?days=7`);
      assert.equal(status, 200);
      assert.equal(body.currency, 'USD');
      assert.equal(body.days, 7);
      assert.equal((body.totals as { inputTokens: number }).inputTokens, 40);
      assert.equal((body.daily as unknown[]).length, 7);
   });

   test("another workspace's summary is a 404", async () => {
      assert.equal((await get(`/api/v1/usage/${theirs.workspaceId}/summary`)).status, 404);
   });

   test('agent, task and runtime reads refuse ids from another workspace', async () => {
      const base = `/api/v1/usage/${mine.workspaceId}`;
      assert.equal((await get(`${base}/agents/${mine.agentId}`)).status, 200);
      assert.equal((await get(`${base}/agents/${theirs.agentId}`)).status, 404);
      assert.equal((await get(`${base}/issues/${mine.issueId}`)).status, 200);
      assert.equal((await get(`${base}/issues/${theirs.issueId}`)).status, 404);
      assert.equal((await get(`${base}/runtimes/${randomUUID()}`)).status, 404);
      const runtime = await get(`${base}/runtimes/default`);
      assert.equal(runtime.status, 200);
      assert.equal((runtime.body.byHour as unknown[]).length, 24);
   });

   test('the task panel lists the run that spent', async () => {
      const { body } = await get(`/api/v1/usage/${mine.workspaceId}/issues/${mine.issueId}`);
      assert.deepEqual((body.byRun as Array<{ key: string }>).map((row) => row.key), [mine.runId]);
   });

   test('the dashboard answers with run counts and a task snapshot', async () => {
      const { status, body } = await get(`/api/v1/dashboard/${mine.workspaceId}/overview`);
      assert.equal(status, 200);
      assert.equal((body.runCounts as { queued: number }).queued, 1);
      assert.equal((body.taskSnapshot as { todo: number }).todo, 1);
      assert.equal((body.runsDaily as unknown[]).length, 30);
   });

   test('the dashboard names the live runs, the latest ends, the waiting decisions and today', async () => {
      const done = await addRun(sql, mine);
      await finishRun(sql, done.runId, 'failed');
      const inReview = await addRun(sql, mine);
      await sql`UPDATE issues SET status = 'in_review' WHERE id = ${inReview.issueId}`;
      const approvalId = randomUUID();
      await sql`
         INSERT INTO approvals (id, workspace_id, kind, risk, title, description, issue_id,
                                requested_from_role, requested_by_type, requested_by, status)
         VALUES (${approvalId}, ${mine.workspaceId}, 'issue_start', 'medium', 'Start the task',
                 'Risky', ${mine.issueId}, 'admin', 'user', ${mine.userId}, 'pending')`;
      try {
         const { status, body } = await get(`/api/v1/dashboard/${mine.workspaceId}/overview?days=1`);
         assert.equal(status, 200);
         const queued = body.queuedRuns as Array<{ runId: string; issueIdentifier: string }>;
         assert.ok(queued.some((row) => row.runId === mine.runId), 'the seeded queued run is listed');
         assert.match(queued[0]!.issueIdentifier, /^[A-Z0-9]*-\d+$/);
         const recent = body.recentRuns as Array<{ runId: string; status: string; failureCode: string }>;
         assert.deepEqual(
            recent.map((row) => [row.runId, row.status, row.failureCode]),
            [[done.runId, 'failed', 'TEST_FAILURE']]
         );
         assert.equal(body.pendingApprovalCount, 1);
         assert.deepEqual(
            (body.pendingApprovals as Array<{ id: string; risk: string }>).map((row) => [row.id, row.risk]),
            [[approvalId, 'medium']]
         );
         assert.deepEqual(
            (body.inReview as Array<{ issueId: string }>).map((row) => row.issueId),
            [inReview.issueId]
         );
         // Today's spend: the usage recorded at setup, in the read's own zone.
         assert.equal((body.today as { inputTokens: number }).inputTokens, 40);
      } finally {
         // Leave the world as the later tests count it: one queued run, one task.
         await sql`DELETE FROM approvals WHERE id = ${approvalId}`;
         await sql`DELETE FROM runs WHERE id IN (${done.runId}, ${inReview.runId})`;
         await sql`DELETE FROM issues WHERE id IN (${done.issueId}, ${inReview.issueId})`;
      }
   });

   test('a window outside 1..180 days or an unknown parameter is refused', async () => {
      for (const query of ['days=0', 'days=181', 'days=abc', 'range=7']) {
         const { status, body } = await get(`/api/v1/usage/${mine.workspaceId}/summary?${query}`);
         assert.equal(status, 422, query);
         assert.equal((body.error as { code: string }).code, 'VALIDATION_FAILED');
      }
   });

   test('no session is a 401 before any read', async () => {
      assert.equal((await get(`/api/v1/usage/${mine.workspaceId}/summary`, false)).status, 401);
      assert.equal((await get(`/api/v1/dashboard/${mine.workspaceId}/overview`, false)).status, 401);
   });

   test('the summary counts the window’s runs and the time they took', async () => {
      const { body } = await get(`/api/v1/usage/${mine.workspaceId}/summary?days=7`);
      const runs = body.runs as { runs: number; failed: number; runSeconds: number };
      assert.equal(runs.runs, 1, 'the seeded queued run is in the window');
      assert.equal(runs.failed, 0);
      // Queued, never started: nothing has been spent in wall-clock time yet.
      assert.equal(runs.runSeconds, 0);
   });

   test('days are cut in the zone the read asks for, and an unknown zone is refused', async () => {
      const tokyo = await get(`/api/v1/usage/${mine.workspaceId}/summary?days=7&tz=Asia/Tokyo`);
      assert.equal(tokyo.status, 200);
      assert.equal(tokyo.body.timezone, 'Asia/Tokyo');
      assert.equal((tokyo.body.daily as unknown[]).length, 7);
      const utc = await get(`/api/v1/usage/${mine.workspaceId}/summary?days=7`);
      assert.equal(utc.body.timezone, 'UTC');
      const bad = await get(`/api/v1/usage/${mine.workspaceId}/summary?tz=Mars/Olympus`);
      assert.equal(bad.status, 422);
      assert.equal((bad.body.error as { code: string }).code, 'VALIDATION_FAILED');
   });

   test('a project filter narrows the read, and a project of another workspace is a 404', async () => {
      const [empty] = await sql`
         INSERT INTO boards (id, workspace_id, name, slug, created_by)
         VALUES (${randomUUID()}, ${mine.workspaceId}, 'Empty', ${`emp-${randomUUID().slice(0, 8)}`},
                 ${mine.userId})
         RETURNING id`;
      try {
         const scoped = await get(
            `/api/v1/usage/${mine.workspaceId}/summary?boardId=${empty!.id as string}`
         );
         assert.equal(scoped.status, 200);
         assert.equal(scoped.body.boardId, empty!.id);
         // A project nothing was spent on spends nothing, while the workspace did.
         assert.equal((scoped.body.totals as { inputTokens: number }).inputTokens, 0);
         assert.equal((scoped.body.runs as { runs: number }).runs, 0);

         const foreign = await get(
            `/api/v1/usage/${mine.workspaceId}/summary?boardId=${theirs.boardId}`
         );
         const absent = await get(
            `/api/v1/usage/${mine.workspaceId}/summary?boardId=${randomUUID()}`
         );
         assert.equal(foreign.status, 404);
         // Same status, same code, same words: only the request id differs.
         const envelope = (body: Record<string, unknown>) => {
            const { code, message } = body.error as { code: string; message: string };
            return { code, message };
         };
         assert.deepEqual(envelope(foreign.body), envelope(absent.body), 'a foreign project reads as an absent one');
      } finally {
         await sql`DELETE FROM boards WHERE id = ${empty!.id as string}`;
      }
   });

   test('a projectId filter narrows the summary, errors and dashboard to the linked tasks', async () => {
      const [linked] = await sql`
         INSERT INTO projects (workspace_id, name, created_by)
         VALUES (${mine.workspaceId}, 'Linked', ${mine.userId})
         RETURNING id`;
      const [empty] = await sql`
         INSERT INTO projects (workspace_id, name, created_by)
         VALUES (${mine.workspaceId}, 'Empty', ${mine.userId})
         RETURNING id`;
      const linkedId = linked!.id as string;
      const emptyId = empty!.id as string;
      await sql`
         INSERT INTO issue_project_links (workspace_id, issue_id, project_id, linked_by)
         VALUES (${mine.workspaceId}, ${mine.issueId}, ${linkedId}, ${mine.userId})`;
      try {
         const scoped = await get(`/api/v1/usage/${mine.workspaceId}/summary?projectId=${linkedId}`);
         assert.equal(scoped.status, 200);
         assert.equal(scoped.body.projectId, linkedId);
         assert.equal(scoped.body.boardId, null);
         // The seeded task is linked, so its spend and its run count.
         assert.equal((scoped.body.totals as { inputTokens: number }).inputTokens, 40);
         assert.equal((scoped.body.runs as { runs: number }).runs, 1);

         const none = await get(`/api/v1/usage/${mine.workspaceId}/summary?projectId=${emptyId}`);
         assert.equal((none.body.totals as { inputTokens: number }).inputTokens, 0);
         assert.equal((none.body.runs as { runs: number }).runs, 0);

         const errors = await get(`/api/v1/usage/${mine.workspaceId}/errors?projectId=${emptyId}`);
         assert.equal(errors.status, 200);
         assert.equal(errors.body.totalRuns, 0);

         const board = await get(`/api/v1/dashboard/${mine.workspaceId}/overview?projectId=${linkedId}`);
         assert.equal(board.status, 200);
         assert.equal(board.body.projectId, linkedId);
         assert.equal((board.body.runCounts as { queued: number }).queued, 1);
         assert.equal((board.body.taskSnapshot as { todo: number }).todo, 1);
         const quiet = await get(`/api/v1/dashboard/${mine.workspaceId}/overview?projectId=${emptyId}`);
         assert.equal((quiet.body.runCounts as { queued: number }).queued, 0);
         assert.equal((quiet.body.taskSnapshot as { todo: number }).todo, 0);
      } finally {
         await sql`DELETE FROM projects WHERE id IN (${linkedId}, ${emptyId})`;
      }
   });

   test('a projectId of another workspace, a deleted one, or a malformed one is refused', async () => {
      const [foreign] = await sql`
         INSERT INTO projects (workspace_id, name, created_by)
         VALUES (${theirs.workspaceId}, 'Theirs', ${theirs.userId})
         RETURNING id`;
      const [gone] = await sql`
         INSERT INTO projects (workspace_id, name, created_by, deleted_at)
         VALUES (${mine.workspaceId}, 'Gone', ${mine.userId}, now())
         RETURNING id`;
      try {
         for (const read of ['usage/{ws}/summary', 'usage/{ws}/errors', 'dashboard/{ws}/overview']) {
            const path = `/api/v1/${read.replace('{ws}', mine.workspaceId)}`;
            const theirsRead = await get(`${path}?projectId=${foreign!.id as string}`);
            const goneRead = await get(`${path}?projectId=${gone!.id as string}`);
            const absent = await get(`${path}?projectId=${randomUUID()}`);
            assert.equal(theirsRead.status, 404, read);
            assert.equal(goneRead.status, 404, read);
            assert.equal(absent.status, 404, read);
            const bad = await get(`${path}?projectId=not-a-uuid`);
            assert.equal(bad.status, 422, read);
         }
      } finally {
         await sql`DELETE FROM projects WHERE id IN (${foreign!.id as string}, ${gone!.id as string})`;
      }
   });

   test('the runtime read carries a day-by-model table', async () => {
      const { status, body } = await get(`/api/v1/usage/${mine.workspaceId}/runtimes/default`);
      assert.equal(status, 200);
      const rows = body.byDayModel as Array<{ day: string; model: string; tokens: number }>;
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.model, 'model-a');
      assert.equal(rows[0]?.tokens, 44);
   });

   test('the errors read counts failures, their kinds and whose they were', async () => {
      const extra = await addRun(sql, mine);
      await finishRun(sql, extra.runId, 'failed');
      const { status, body } = await get(`/api/v1/usage/${mine.workspaceId}/errors?days=7`);
      assert.equal(status, 200);
      assert.equal(body.failedRuns, 1);
      assert.equal(body.totalRuns, 2, 'the queued run counts towards the sample');
      assert.equal(body.agentsAffected, 1);
      assert.equal(body.succeededRuns, 0);
      assert.equal(body.cancelledRuns, 0);
      const daily = body.daily as Array<{ total: number; succeeded: number; failed: number; cancelled: number }>;
      assert.equal(daily.length, 7);
      // By outcome per day; the queued run is only in the day's total.
      const sum = (key: 'total' | 'succeeded' | 'failed' | 'cancelled') =>
         daily.reduce((acc, day) => acc + day[key], 0);
      assert.deepEqual(
         { total: sum('total'), succeeded: sum('succeeded'), failed: sum('failed'), cancelled: sum('cancelled') },
         { total: 2, succeeded: 0, failed: 1, cancelled: 0 }
      );
      assert.deepEqual(body.byType, [{ code: 'TEST_FAILURE', count: 1 }]);
      const offenders = body.offenders as Array<{ agentId: string; failed: number; total: number }>;
      assert.deepEqual(offenders, [{ agentId: mine.agentId, agentName: mine.agentName, failed: 1, total: 2 }]);
   });

   test("another workspace's errors read is the same 404 as an absent workspace", async () => {
      assert.equal((await get(`/api/v1/usage/${theirs.workspaceId}/errors`)).status, 404);
      assert.equal((await get(`/api/v1/usage/${randomUUID()}/errors`)).status, 404);
   });
});
