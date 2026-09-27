import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { closeDatabase, openDatabase, type Sql } from '../db/pool.ts';
import { GitHubError, type GitHubClient } from '../integrations/github.ts';
import type { RunLedger } from '../runs/ledger.ts';
import { recordDelivery } from './delivery.ts';
import { cleanupFixture, createIssue, seedFixture, type Fixture } from './test-fixture.ts';

/**
 * A run that commits nothing still delivers the work its branch carries from
 * earlier runs of the task: the continuation after a step limit, which finds
 * the checkpoint already complete, used to leave the branch with no pull
 * request and its review under "Needs help".
 */

const url = process.env.BERRY_TEST_DATABASE_URL;

describe('recording a delivery', { skip: url ? false : 'BERRY_TEST_DATABASE_URL is not set' }, () => {
   let sql: Sql;
   let fixture: Fixture | null = null;

   before(async () => {
      sql = openDatabase({ url: url! });
      fixture = await seedFixture(sql, 'delivery');
   });
   after(async () => {
      await sql`DELETE FROM runs WHERE workspace_id = ${fixture!.workspaceId}`;
      await cleanupFixture(sql, fixture);
      await closeDatabase(sql);
   });

   const plan = {
      fullName: 'berry/site',
      defaultBranch: 'main',
      branch: 'designer/ber-3',
      reference: 'BER-3',
      title: 'Select imagery',
      mergeRequiresApproval: true,
      mayOpenPullRequest: true,
   };
   const nothing = { committed: false, commit: null, branch: 'designer/ber-3', files: [], filesChanged: 0, insertions: 0, deletions: 0 };
   const ledger = { appendDelivered: async () => undefined } as unknown as RunLedger;

   /** A succeeded run whose branch stood at `expectedHead` when it began. */
   async function run(expectedHead: string | null): Promise<string> {
      const f = fixture!;
      const issueId = await createIssue(sql, f);
      const id = randomUUID();
      await sql`
         INSERT INTO runs (id, workspace_id, issue_id, board_id, agent_id, kind, source, status, requested_by)
         VALUES (${id}, ${f.workspaceId}, ${issueId}, ${f.boardId}, ${f.agentId}, 'agent', 'assignment', 'running', ${f.userId})`;
      await sql`
         INSERT INTO run_repository_snapshots (run_id, repository, branch, base_commit, default_commit, expected_head, read_only)
         VALUES (${id}, 'berry/site', 'designer/ber-3', ${expectedHead ?? 'main-head'}, 'main-head', ${expectedHead}, false)`;
      return id;
   }

   function github(open: () => Promise<{ number: number; url: string; created: boolean }>) {
      const opened: string[] = [];
      const client = {
         openPullRequest: async (input: { head: string }) => {
            opened.push(input.head);
            return open();
         },
      } as unknown as GitHubClient;
      return { client, opened };
   }

   test('a run that added nothing to a branch of earlier work opens its pull request', async () => {
      const runId = await run('checkpoint-2fe6276');
      const { client, opened } = github(async () => ({ number: 7, url: 'https://github.test/pull/7', created: true }));
      await recordDelivery({ sql, ledger, github: client, runId, plan, delivery: nothing, summary: 'Done.', verified: null });
      assert.deepEqual(opened, ['designer/ber-3']);
      const [row] = await sql`SELECT pull_request_number, head_commit FROM runs WHERE id = ${runId}`;
      assert.equal(Number(row!.pull_request_number), 7);
      assert.equal(row!.head_commit, 'checkpoint-2fe6276', 'the delivery is the earlier work');
   });

   test('a run on a fresh branch that committed nothing opens nothing', async () => {
      const runId = await run(null);
      const { client, opened } = github(async () => ({ number: 8, url: '', created: true }));
      await recordDelivery({ sql, ledger, github: client, runId, plan, delivery: nothing, summary: null, verified: null });
      assert.deepEqual(opened, []);
   });

   test('earlier work already merged is no pull request and no failure', async () => {
      const runId = await run('merged-long-ago');
      const { client } = github(async () => {
         throw new GitHubError('Validation Failed: No commits between main and designer/ber-3', 422);
      });
      await recordDelivery({ sql, ledger, github: client, runId, plan, delivery: nothing, summary: null, verified: null });
      const [row] = await sql`SELECT pull_request_number, head_commit FROM runs WHERE id = ${runId}`;
      assert.equal(row!.pull_request_number, null);
      assert.equal(row!.head_commit, null);
   });
});
