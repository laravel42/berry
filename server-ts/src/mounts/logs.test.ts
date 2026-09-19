import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { personalTokenResolver } from '../auth/credentials.ts';
import { SessionService } from '../auth/sessions.ts';
import { issueTestToken } from '../auth/test-credentials.ts';
import { closeDatabase, openDatabase, type Sql } from '../db/pool.ts';
import { createApp, type BerryApp } from '../http/app.ts';
import { Registry } from '../http/registry.ts';
import { cleanupUsageWorld, seedUsageWorld, type UsageWorld } from '../usage/test-fixtures.ts';
import { logsMounts } from './logs.ts';

/**
 * The prompt log, driven through the real app: completion runs only, their
 * spec and answer read back whole, and another workspace's call a 404.
 */

const url = process.env.BERRY_TEST_DATABASE_URL;

async function addCompletion(
   sql: Sql,
   world: UsageWorld,
   input: { purpose: string; structured: boolean; status: 'succeeded' | 'failed' }
): Promise<string> {
   const runId = randomUUID();
   const spec = {
      purpose: input.purpose,
      system: `You are the ${input.purpose}.`,
      jsonSchema: input.structured ? { type: 'object', properties: { ok: { type: 'boolean' } } } : null,
      model: 'model-a',
   };
   const result = input.status === 'succeeded' ? { text: '{"ok":true}', structured: { ok: true } } : null;
   await sql`
      INSERT INTO runs (id, workspace_id, agent_id, kind, source, status, prompt, completion_spec, result,
                        input_tokens, output_tokens, failure_code, failure_message, started_at, completed_at)
      VALUES (${runId}, ${world.workspaceId}, ${world.agentId}, 'completion', 'completion',
              ${input.status}::run_status, ${`Plan ${input.purpose}`}, ${sql.json(spec as never)},
              ${result ? sql.json(result as never) : null}, 12, 3,
              ${input.status === 'failed' ? 'COMPLETION_INVALID' : null},
              ${input.status === 'failed' ? 'not the shape asked for' : null}, now() - interval '2 seconds', now())`;
   return runId;
}

describe('logs mount', { skip: url ? false : 'BERRY_TEST_DATABASE_URL is not set' }, () => {
   let sql: Sql;
   let app: BerryApp;
   let token = '';
   let mine: UsageWorld;
   let theirs: UsageWorld;
   let structuredRun = '';
   let theirRun = '';

   before(async () => {
      sql = openDatabase({ url: url! });
      const sessions = new SessionService({ sql, auth: null, bearer: [personalTokenResolver(sql)] });
      const registry = new Registry();
      registry.registerAll(logsMounts({ sessions, sql }));
      app = createApp(registry);
      mine = await seedUsageWorld(sql, 'logs');
      theirs = await seedUsageWorld(sql, 'logs-other');
      structuredRun = await addCompletion(sql, mine, { purpose: 'planner', structured: true, status: 'succeeded' });
      await addCompletion(sql, mine, { purpose: 'chat', structured: false, status: 'failed' });
      theirRun = await addCompletion(sql, theirs, { purpose: 'planner', structured: true, status: 'succeeded' });
      token = await issueTestToken(sql, mine.userId);
   });

   after(async () => {
      // A completion has no task, so the fixture's issue cleanup does not reach it.
      for (const world of [mine, theirs]) {
         if (world?.workspaceId) await sql`DELETE FROM runs WHERE workspace_id = ${world.workspaceId} AND kind = 'completion'`;
      }
      await cleanupUsageWorld(sql, mine);
      await cleanupUsageWorld(sql, theirs);
      await closeDatabase(sql);
   });

   async function get(path: string) {
      const response = await app.request(path, { headers: { authorization: `Bearer ${token}` } });
      return { status: response.status, body: (await response.json()) as Record<string, unknown> };
   }

   type Node = { id: string; purpose: string; structured: boolean; status: string };

   test('lists only this workspace’s model calls, not its agent runs', async () => {
      const { status, body } = await get(`/api/v1/logs/${mine.workspaceId}/prompts`);
      assert.equal(status, 200);
      const nodes = body.nodes as Node[];
      assert.equal(nodes.length, 2);
      assert.ok(!nodes.some((node) => node.id === mine.runId || node.id === theirRun));
   });

   test('filters by structured output, purpose and status', async () => {
      const base = `/api/v1/logs/${mine.workspaceId}/prompts`;
      const structured = (await get(`${base}?structured=true`)).body.nodes as Node[];
      assert.deepEqual(structured.map((node) => node.id), [structuredRun]);
      const chat = (await get(`${base}?purpose=chat`)).body.nodes as Node[];
      assert.deepEqual(chat.map((node) => node.status), ['failed']);
      assert.equal((await get(`${base}?status=nope`)).status, 422);
   });

   test('pages with a cursor', async () => {
      const base = `/api/v1/logs/${mine.workspaceId}/prompts`;
      const first = await get(`${base}?first=1`);
      const pageInfo = first.body.pageInfo as { hasNextPage: boolean; endCursor: string };
      assert.equal(pageInfo.hasNextPage, true);
      const second = await get(`${base}?first=1&after=${pageInfo.endCursor}`);
      assert.equal((second.body.nodes as Node[]).length, 1);
      assert.equal((second.body.pageInfo as { hasNextPage: boolean }).hasNextPage, false);
   });

   test('the detail carries the whole prompt and the answer', async () => {
      const { status, body } = await get(`/api/v1/logs/${mine.workspaceId}/prompts/${structuredRun}`);
      assert.equal(status, 200);
      assert.equal(body.system, 'You are the planner.');
      assert.equal(body.prompt, 'Plan planner');
      assert.equal((body.jsonSchema as { type: string }).type, 'object');
      assert.deepEqual((body.response as { structured: unknown }).structured, { ok: true });
   });

   test('another workspace’s call, or an agent run, is a 404', async () => {
      const base = `/api/v1/logs/${mine.workspaceId}/prompts`;
      assert.equal((await get(`${base}/${theirRun}`)).status, 404);
      assert.equal((await get(`${base}/${mine.runId}`)).status, 404);
      assert.equal((await get(`/api/v1/logs/${theirs.workspaceId}/prompts`)).status, 404);
   });

   test('purposes lists what this workspace called with', async () => {
      const { body } = await get(`/api/v1/logs/${mine.workspaceId}/purposes`);
      assert.deepEqual(body.purposes, ['chat', 'planner']);
   });
});
