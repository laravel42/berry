// The Loop routes on /api/v1/autopilots, end to end through sessions, tokens
// and the workspace gate: creation defaults, event triggers and their
// validation, templates, drafting, run history, run controls, and that none
// of the new routes lets a member of one workspace reach another's Loop.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { personalTokenResolver } from '../auth/credentials.ts';
import { SessionService } from '../auth/sessions.ts';
import { issueTestToken } from '../auth/test-credentials.ts';
import { LoopDrafter } from '../autopilots/draft.ts';
import { fireAutopilot, retryAutopilotRun, type FireDeps } from '../autopilots/fire.ts';
import { AutopilotRepository } from '../autopilots/repository.ts';
import { cleanupWorkspace, seedWorkspace, testSealer, type Fixture } from '../autopilots/test-fixture.ts';
import { IssueRepository } from '../core/issues.ts';
import { closeDatabase, openDatabase, type Sql } from '../db/pool.ts';
import { createApp, type BerryApp } from '../http/app.ts';
import { IdempotencyStore } from '../http/idempotency.ts';
import { Registry } from '../http/registry.ts';
import { autopilotMounts } from './autopilots.ts';

const url = process.env.BERRY_TEST_DATABASE_URL;

describe('loops over /api/v1/autopilots', { skip: url ? false : 'BERRY_TEST_DATABASE_URL is not set' }, () => {
   let sql: Sql;
   let app: BerryApp;
   let w1: Fixture;
   let w2: Fixture;
   let u1: string;
   let u2: string;
   const cancelled: string[] = [];

   before(async () => {
      sql = openDatabase({ url: url as string });
      const sessions = new SessionService({ sql, auth: null, bearer: [personalTokenResolver(sql)] });
      const repo = new AutopilotRepository({ sql, sealer: testSealer() });
      const deps: FireDeps = {
         sql,
         issues: new IssueRepository(sql),
         enqueue: async (db, input) => {
            const runId = randomUUID();
            const [issue] = await db`SELECT board_id FROM issues WHERE id = ${input.issueId ?? null}`;
            await db`
               INSERT INTO runs (id, workspace_id, issue_id, board_id, agent_id, kind, source, autopilot_run_id)
               VALUES (${runId}, ${input.workspaceId}, ${input.issueId ?? null}, ${(issue?.board_id as string | undefined) ?? null},
                       ${input.agentId}, 'agent', 'autopilot', ${input.autopilotRunId ?? null})`;
            return { runId };
         },
      };
      const registry = new Registry();
      registry.registerAll(
         autopilotMounts({
            sessions,
            sql,
            autopilots: repo,
            idempotency: new IdempotencyStore(sql),
            fire: (input) => fireAutopilot(deps, input),
            retry: (input) => retryAutopilotRun(deps, input),
            cancelRun: async (runId) => {
               cancelled.push(runId);
               await sql`UPDATE runs SET status = 'cancelled', completed_at = now() WHERE id = ${runId}`;
            },
            drafter: new LoopDrafter({ completion: null, defaultModel: 'm' }),
            canUseModel: async () => false,
         })
      );
      app = createApp(registry);
      w1 = await seedWorkspace(sql, 'loops-1');
      w2 = await seedWorkspace(sql, 'loops-2');
      u1 = await issueTestToken(sql, w1.userId);
      u2 = await issueTestToken(sql, w2.userId);
   });

   after(async () => {
      for (const fixture of [w1, w2]) {
         await sql`DELETE FROM runs WHERE workspace_id = ${fixture.workspaceId}`;
         await cleanupWorkspace(sql, fixture);
      }
      await closeDatabase(sql);
   });

   function call(token: string, method: string, path: string, body?: unknown) {
      return app.request(path, {
         method,
         headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
            ...(method === 'POST' ? { 'idempotency-key': randomUUID() } : {}),
         },
         // Idempotent POSTs carry a JSON body, even an empty one.
         ...(body === undefined ? (method === 'POST' ? { body: '{}' } : {}) : { body: JSON.stringify(body) }),
      });
   }

   async function createLoop(token: string, fixture: Fixture, extra: Record<string, unknown> = {}) {
      const response = await call(token, 'POST', '/api/v1/autopilots', {
         workspaceId: fixture.workspaceId,
         name: 'Weekly wrap',
         assigneeType: 'agent',
         assigneeId: fixture.agentId,
         promptTemplate: 'Summarize the week.',
         executionMode: 'create_issue',
         boardId: fixture.boardId,
         ...extra,
      });
      assert.equal(response.status, 201, await response.clone().text());
      return (await response.json()) as Record<string, unknown> & { id: string };
   }

   test('a new Loop starts in recommend mode, one run at a time, with no chains', async () => {
      const loop = await createLoop(u1, w1);
      assert.equal(loop.accessMode, 'recommend');
      assert.equal(loop.concurrencyPolicy, 'skip_if_running');
      assert.equal(loop.maxChainDepth, 0);
      assert.equal(loop.allowAgentEvents, false);
      assert.deepEqual(loop.activity, { lastRun: null, nextFireAt: null, runsLast7Days: 0, failedLast7Days: 0, eventTypes: [] });
   });

   test('it can be created paused, and a chain deeper than the hard limit is refused', async () => {
      const paused = await createLoop(u1, w1, { status: 'paused' });
      assert.equal(paused.status, 'paused');
      const deep = await call(u1, 'POST', '/api/v1/autopilots', {
         workspaceId: w1.workspaceId, name: 'Deep', assigneeType: 'agent', assigneeId: w1.agentId,
         promptTemplate: 'x', executionMode: 'create_issue', boardId: w1.boardId, maxChainDepth: 4,
      });
      assert.equal(deep.status, 422);
   });

   test('event triggers accept what Berry emits and refuse what it does not', async () => {
      const loop = await createLoop(u1, w1);
      const ok = await call(u1, 'POST', `/api/v1/autopilots/${loop.id}/triggers`, {
         kind: 'event',
         eventType: 'issue.created',
         conditions: { match: 'all', rules: [{ field: 'label', op: 'in', values: ['bug'] }] },
      });
      assert.equal(ok.status, 201);
      const { trigger } = (await ok.json()) as { trigger: { eventType: string; conditions: { rules: unknown[] } } };
      assert.equal(trigger.eventType, 'issue.created');
      assert.equal(trigger.conditions.rules.length, 1);

      const decision = await call(u1, 'POST', `/api/v1/autopilots/${loop.id}/triggers`, { kind: 'event', eventType: 'approval.approved' });
      assert.equal(decision.status, 422, 'Berry never writes approval decisions to the outbox');
      const impossible = await call(u1, 'POST', `/api/v1/autopilots/${loop.id}/triggers`, {
         kind: 'event',
         eventType: 'project.created',
         conditions: { rules: [{ field: 'label', op: 'in', values: ['bug'] }] },
      });
      assert.equal(impossible.status, 422);
      const body = (await impossible.json()) as { error: { details?: { fields?: Array<{ path: string }> } } };
      assert.equal(body.error.details?.fields?.[0]?.path, '/conditions/rules/0/field');

      const detail = (await (await call(u1, 'GET', `/api/v1/autopilots/${loop.id}`)).json()) as { triggerKinds: string[]; activity: { eventTypes: string[] } };
      assert.deepEqual(detail.triggerKinds, ['event']);
      assert.deepEqual(detail.activity.eventTypes, ['issue.created']);
   });

   test('validate-trigger previews a schedule and normalises filters without saving', async () => {
      const cron = await call(u1, 'POST', '/api/v1/autopilots/validate-trigger', { kind: 'cron', expression: '0 9 * * 1-5', timezone: 'Europe/Rome' });
      assert.equal(cron.status, 200);
      assert.equal(((await cron.json()) as { nextTimes: string[] }).nextTimes.length, 5);
      const bad = await call(u1, 'POST', '/api/v1/autopilots/validate-trigger', { kind: 'cron', expression: '* * * * * *', timezone: 'UTC' });
      assert.equal(bad.status, 422);
      const event = await call(u1, 'POST', '/api/v1/autopilots/validate-trigger', {
         kind: 'event',
         eventType: 'issue.status_changed',
         conditions: { rules: [{ field: 'status', op: 'in', values: ['blocked', 'blocked'] }] },
      });
      assert.deepEqual(((await event.json()) as { conditions: unknown }).conditions, {
         match: 'all',
         rules: [{ field: 'status', op: 'in', values: ['blocked'] }],
      });
   });

   test('templates suggest the workspace’s own agent for each role', async () => {
      const response = await call(u1, 'GET', `/api/v1/autopilots/templates?workspaceId=${w1.workspaceId}`);
      const { nodes } = (await response.json()) as { nodes: Array<{ key: string; accessMode: string; suggestedAgent: { roleKey: string } | null }> };
      assert.equal(nodes.length, 9);
      assert.ok(nodes.every((template) => template.accessMode === 'recommend'));
      // Every workspace has an Orchestrator, and every template falls back to it.
      assert.ok(nodes.every((template) => template.suggestedAgent !== null));
      const other = await call(u1, 'GET', `/api/v1/autopilots/templates?workspaceId=${w2.workspaceId}`);
      assert.equal(other.status, 404);
   });

   test('a draft from a sentence is a suggestion, never act', async () => {
      const response = await call(u1, 'POST', '/api/v1/autopilots/draft', {
         workspaceId: w1.workspaceId,
         prompt: 'Every weekday at 9 AM, review open bugs and suggest priorities.',
      });
      assert.equal(response.status, 200);
      const draft = (await response.json()) as { trigger: { expression: string }; accessMode: string; source: string; suggestedAgent: unknown };
      assert.equal(draft.trigger.expression, '0 9 * * 1-5');
      assert.equal(draft.accessMode, 'recommend');
      assert.equal(draft.source, 'rules');
      assert.ok(draft.suggestedAgent);
      const before = await sql`SELECT count(*)::int AS n FROM autopilots WHERE workspace_id = ${w1.workspaceId}`;
      await call(u1, 'POST', '/api/v1/autopilots/draft', { workspaceId: w1.workspaceId, prompt: 'Every Friday wrap up' });
      const afterDraft = await sql`SELECT count(*)::int AS n FROM autopilots WHERE workspace_id = ${w1.workspaceId}`;
      assert.equal(afterDraft[0]?.n, before[0]?.n, 'drafting stores nothing');
   });

   test('runs page with a cursor, carry their state, and offer retry and cancel only where they mean something', async () => {
      const loop = await createLoop(u1, w1, { concurrencyPolicy: 'allow' });
      for (let i = 0; i < 3; i += 1) {
         const fired = await call(u1, 'POST', `/api/v1/autopilots/${loop.id}/run`);
         assert.equal(fired.status, 202);
      }
      const first = (await (await call(u1, 'GET', `/api/v1/autopilots/${loop.id}/runs?first=2`)).json()) as {
         nodes: Array<{ id: string; state: string; runId: string }>;
         pageInfo: { hasNextPage: boolean; endCursor: string };
      };
      assert.equal(first.nodes.length, 2);
      assert.equal(first.pageInfo.hasNextPage, true);
      const second = (await (await call(u1, 'GET', `/api/v1/autopilots/${loop.id}/runs?first=2&after=${first.pageInfo.endCursor}`)).json()) as {
         nodes: Array<{ id: string }>;
         pageInfo: { hasNextPage: boolean };
      };
      assert.equal(second.nodes.length, 1);
      assert.equal(second.pageInfo.hasNextPage, false);

      const run = first.nodes[0]!;
      assert.equal(run.state, 'queued');
      const notYet = await call(u1, 'POST', `/api/v1/autopilots/${loop.id}/runs/${run.id}/retry`);
      assert.equal(notYet.status, 409);
      assert.equal(((await notYet.json()) as { error: { code: string } }).error.code, 'RUN_NOT_RETRYABLE');

      const cancel = await call(u1, 'POST', `/api/v1/autopilots/${loop.id}/runs/${run.id}/cancel`);
      assert.equal(cancel.status, 202);
      assert.equal(((await cancel.json()) as { state: string }).state, 'canceled');
      assert.deepEqual(cancelled, [run.runId]);
      const again = await call(u1, 'POST', `/api/v1/autopilots/${loop.id}/runs/${run.id}/cancel`);
      assert.equal(again.status, 409);

      const retry = await call(u1, 'POST', `/api/v1/autopilots/${loop.id}/runs/${run.id}/retry`);
      assert.equal(retry.status, 202);
      const twice = await call(u1, 'POST', `/api/v1/autopilots/${loop.id}/runs/${run.id}/retry`);
      assert.equal(((await twice.json()) as { error: { code: string } }).error.code, 'ALREADY_RETRIED');

      const detail = (await (await call(u1, 'GET', `/api/v1/autopilots/${loop.id}/runs/${run.id}`)).json()) as {
         autopilotName: string; retriedBy: string | null; usage: unknown; state: string;
      };
      assert.equal(detail.autopilotName, 'Weekly wrap');
      assert.ok(detail.retriedBy);
      assert.ok(detail.usage);

      const activity = (await (await call(u1, 'GET', `/api/v1/autopilots/activity?workspaceId=${w1.workspaceId}`)).json()) as { nodes: Array<{ autopilotName: string }> };
      assert.ok(activity.nodes.length >= 4);
   });

   test('a duplicate is a paused copy', async () => {
      const loop = await createLoop(u1, w1);
      const response = await call(u1, 'POST', `/api/v1/autopilots/${loop.id}/duplicate`);
      assert.equal(response.status, 201);
      const copy = (await response.json()) as { status: string; name: string; id: string };
      assert.equal(copy.status, 'paused');
      assert.notEqual(copy.id, loop.id);
   });

   test('no Loop route lets one workspace reach another’s Loop', async () => {
      const foreign = await createLoop(u2, w2);
      await call(u2, 'POST', `/api/v1/autopilots/${foreign.id}/run`);
      const [record] = await sql`SELECT id FROM autopilot_runs WHERE autopilot_id = ${foreign.id} LIMIT 1`;
      const runId = record!.id as string;
      const attempts: Array<[string, string]> = [
         ['GET', `/api/v1/autopilots/${foreign.id}/runs`],
         ['GET', `/api/v1/autopilots/${foreign.id}/runs/${runId}`],
         ['POST', `/api/v1/autopilots/${foreign.id}/runs/${runId}/retry`],
         ['POST', `/api/v1/autopilots/${foreign.id}/runs/${runId}/cancel`],
         ['GET', `/api/v1/autopilots/${foreign.id}/receipts`],
         ['POST', `/api/v1/autopilots/${foreign.id}/duplicate`],
         ['POST', `/api/v1/autopilots/${foreign.id}/triggers`],
      ];
      for (const [method, path] of attempts) {
         const response = await call(u1, method, path, method === 'POST' ? { kind: 'event', eventType: 'issue.created' } : undefined);
         assert.equal(response.status, 404, `${method} ${path}`);
      }
      // A run id from another Loop of one's own workspace is not this Loop's either.
      const own = await createLoop(u1, w1);
      const crossed = await call(u1, 'GET', `/api/v1/autopilots/${own.id}/runs/${runId}`);
      assert.equal(crossed.status, 404);
      const activity = await call(u1, 'GET', `/api/v1/autopilots/activity?workspaceId=${w2.workspaceId}`);
      assert.equal(activity.status, 404);
      const draft = await call(u1, 'POST', '/api/v1/autopilots/draft', { workspaceId: w2.workspaceId, prompt: 'Every day summarize' });
      assert.equal(draft.status, 404);
      assert.equal(cancelled.filter((id) => id === runId).length, 0);
   });

   test('an unauthenticated caller is refused before any Loop route runs', async () => {
      for (const path of ['/api/v1/autopilots/templates?workspaceId=x', '/api/v1/autopilots/events', '/api/v1/autopilots/activity?workspaceId=x']) {
         const response = await app.request(path);
         assert.equal(response.status, 401, path);
      }
   });
});
