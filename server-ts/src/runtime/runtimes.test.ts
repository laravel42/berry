import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { closeDatabase, openDatabase, type Sql } from '../db/pool.ts';
import { singleHost, syncPlatformRuntime } from './runtimes.ts';
import { cleanupFixture, seedFixture, type Fixture } from './test-fixture.ts';
import type { RuntimeTarget } from './transport.ts';

const url = process.env.BERRY_TEST_DATABASE_URL;

const agentcore: RuntimeTarget = {
   id: null,
   driver: 'agentcore',
   arn: 'arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/berry-x',
   qualifier: 'DEFAULT',
   region: 'us-east-1',
   endpointUrl: null,
};

describe('syncPlatformRuntime', { skip: url ? false : 'BERRY_TEST_DATABASE_URL is not set' }, () => {
   let sql: Sql;
   let fixture: Fixture | null = null;

   before(async () => {
      sql = openDatabase({ url: url as string });
      fixture = await seedFixture(sql, 'rt-sync');
   });
   after(async () => {
      if (!sql) return;
      await cleanupFixture(sql, fixture);
      await closeDatabase(sql);
   });

   const platform = async () => {
      const rows = await sql`
         SELECT driver, region, status, last_health_error FROM agent_runtimes
          WHERE workspace_id = ${fixture!.workspaceId} AND kind = 'platform'`;
      assert.equal(rows.length, 1);
      return rows[0]!;
   };

   test('a platform row written for the local runtime follows the deployment to AgentCore', async () => {
      await sql`DELETE FROM agent_runtimes WHERE workspace_id = ${fixture!.workspaceId} AND kind = 'platform'`;
      await sql`
         INSERT INTO agent_runtimes (workspace_id, name, kind, driver, status, last_health_error)
         VALUES (${fixture!.workspaceId}, 'Default', 'platform', 'http', 'unreachable', 'the runtime answered 502')`;

      // Scoped: test files share the database and run in parallel, and an
      // unscoped sync would rewrite, and race, every other file's workspaces.
      await syncPlatformRuntime(sql, singleHost(agentcore), { workspaceId: fixture!.workspaceId });

      const row = await platform();
      assert.equal(row.driver, 'agentcore');
      assert.equal(row.region, 'us-east-1');
      // The old probe was of a different runtime; it says nothing about this one.
      assert.equal(row.status, 'active');
      assert.equal(row.last_health_error, null);
   });

   test('a disabled platform row stays disabled, and a second sync changes nothing', async () => {
      await sql`
         UPDATE agent_runtimes SET status = 'disabled', driver = 'http'
          WHERE workspace_id = ${fixture!.workspaceId} AND kind = 'platform'`;
      const scope = { workspaceId: fixture!.workspaceId };
      await syncPlatformRuntime(sql, singleHost(agentcore), scope);
      await syncPlatformRuntime(sql, singleHost(agentcore), scope);
      const row = await platform();
      assert.equal(row.driver, 'agentcore');
      assert.equal(row.status, 'disabled');
   });

   test('each configured host gets its own row, and a host that goes away takes its row with it', async () => {
      const workspaceId = fixture!.workspaceId;
      const scope = { workspaceId };
      const local: RuntimeTarget = {
         id: null,
         driver: 'http',
         arn: null,
         qualifier: 'DEFAULT',
         region: null,
         endpointUrl: 'http://sessions:8080',
      };
      const microvm: RuntimeTarget = {
         id: null,
         driver: 'microvm',
         arn: 'arn:aws:lambda:us-east-1:123456789012:microvm-image:berry-runtime',
         qualifier: '1.0',
         region: 'us-east-1',
         endpointUrl: null,
      };
      await sql`DELETE FROM agent_runtimes WHERE workspace_id = ${workspaceId} AND kind = 'platform'`;

      await syncPlatformRuntime(sql, { default: agentcore, all: [agentcore, microvm, local] }, scope);
      const rows = await sql`
         SELECT driver, name, is_default FROM agent_runtimes
          WHERE workspace_id = ${workspaceId} AND kind = 'platform' ORDER BY driver`;
      assert.deepEqual(
         rows.map((row) => [row.driver, row.name]),
         [
            ['agentcore', 'AWS AgentCore'],
            ['http', 'Local Docker'],
            ['microvm', 'Lambda MicroVMs'],
         ]
      );
      const defaults = rows.filter((row) => row.is_default).map((row) => row.driver);
      // A workspace that already had a default keeps it; otherwise it is the default host's.
      assert.ok(defaults.length <= 1);

      await syncPlatformRuntime(sql, { default: microvm, all: [microvm] }, scope);
      const left = await sql`
         SELECT driver FROM agent_runtimes WHERE workspace_id = ${workspaceId} AND kind = 'platform'`;
      // No configured host is missing a row, so neither leftover is reused: both go.
      assert.deepEqual(left.map((row) => row.driver), ['microvm']);
   });
});
