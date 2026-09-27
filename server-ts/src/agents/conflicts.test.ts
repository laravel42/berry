import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { closeDatabase, openDatabase, type Sql } from '../db/pool.ts';
import { cleanupFixture, createIssue, seedFixture, type Fixture } from '../runtime/test-fixture.ts';
import { afterDelivery, afterMerge, refusedForConflict, type ConflictDeps } from './conflicts.ts';

test('a refusal is a conflict only when GitHub says so', () => {
   assert.equal(refusedForConflict('merge conflict between base and head'), true);
   assert.equal(refusedForConflict('Required status check "ci" is expected'), false);
   assert.equal(refusedForConflict(null), false);
});

const url = process.env.BERRY_TEST_DATABASE_URL;

describe('conflicts resolved before review', { skip: url ? false : 'BERRY_TEST_DATABASE_URL is not set' }, () => {
   let sql: Sql;
   let f: Fixture;
   let projectId = '';

   before(async () => {
      sql = openDatabase({ url: url! });
      f = await seedFixture(sql, 'conflicts');
      const [project] = await sql`
         INSERT INTO projects (workspace_id, name, github_repo_full_name, github_repo_id, created_by)
         VALUES (${f.workspaceId}, 'Site', 'berry/site', 7, ${f.userId}) RETURNING id`;
      projectId = project!.id as string;
   });
   after(async () => {
      await sql`DELETE FROM runs WHERE workspace_id = ${f.workspaceId}`;
      await sql`DELETE FROM issue_project_links WHERE project_id = ${projectId}`;
      await sql`DELETE FROM projects WHERE id = ${projectId}`;
      await cleanupFixture(sql, f);
      await closeDatabase(sql);
   });

   /** A task in review, in the project, whose finished run opened pull request `number`. */
   async function delivered(number: number, status = 'in_review'): Promise<{ issueId: string; runId: string }> {
      const issueId = await createIssue(sql, f, `Task with #${number}`);
      await sql`INSERT INTO issue_project_links (workspace_id, issue_id, project_id, linked_by) VALUES (${f.workspaceId}, ${issueId}, ${projectId}, ${f.userId})`;
      await sql`UPDATE issues SET status = ${status}::issue_status, assignee_type = 'agent', assignee_id = ${f.agentId} WHERE id = ${issueId}`;
      const runId = randomUUID();
      await sql`
         INSERT INTO runs (id, workspace_id, issue_id, board_id, agent_id, kind, source, status, requested_by, pull_request_number, completed_at)
         VALUES (${runId}, ${f.workspaceId}, ${issueId}, ${f.boardId}, ${f.agentId}, 'agent', 'assignment', 'succeeded', ${f.userId}, ${number}, now())`;
      await sql`
         INSERT INTO run_repository_snapshots (run_id, repository, branch, base_commit, default_commit, expected_head, read_only)
         VALUES (${runId}, 'berry/site', ${`agent/task-${number}`}, 'base', 'main-then', NULL, false)`;
      return { issueId, runId };
   }

   /** GitHub, where the pull requests in `conflicting` cannot be brought up to date. */
   function github(conflicting: number[]): { deps: ConflictDeps; updated: number[] } {
      const updated: number[] = [];
      return {
         updated,
         deps: {
            sql,
            github: async () => ({
               updatePullRequestBranch: async (_owner: string, _name: string, number: number) => {
                  updated.push(number);
                  return conflicting.includes(number)
                     ? { updated: false, reason: 'merge conflict between base and head' }
                     : { updated: true, reason: null };
               },
               pullRequestState: async (_owner: string, _name: string, number: number) =>
                  ({ merged: false, open: true, conflicts: conflicting.includes(number), base: 'main' }) as never,
            }),
         },
      };
   }

   const state = async (issueId: string) => {
      const [issue] = await sql`SELECT status::text AS status FROM issues WHERE id = ${issueId}`;
      const queued = await sql`SELECT instructions FROM runs WHERE issue_id = ${issueId} AND status = 'queued'`;
      const comments = await sql`SELECT body FROM comments WHERE issue_id = ${issueId}`;
      return { status: issue!.status as string, queued: queued.map((row) => row.instructions as string), comments: comments.map((row) => row.body as string) };
   };

   test('after a merge, a task whose pull request now conflicts goes back before review; a clean one is updated and stays', async () => {
      const conflicted = await delivered(11);
      const clean = await delivered(12);
      const { deps, updated } = github([11]);

      await afterMerge(deps, { workspaceId: f.workspaceId, repository: 'berry/site', merged: { number: 10, name: 'BER-3' } });

      assert.deepEqual(updated.sort(), [11, 12]);
      const sent = await state(conflicted.issueId);
      assert.equal(sent.status, 'todo');
      assert.equal(sent.queued.length, 1, 'the author gets the conflict-resolution run');
      assert.match(sent.queued[0]!, /Pull request #11 could not be merged: it conflicts with main/);
      assert.ok(sent.comments.some((body) => /conflicts with main\*\*: BER-3 was merged into it/.test(body)));
      assert.equal((await state(clean.issueId)).status, 'in_review');
   });

   test('a task not waiting on review is updated but not sent back', async () => {
      const waiting = await delivered(21, 'todo');
      const { deps } = github([21]);
      await afterMerge(deps, { workspaceId: f.workspaceId, repository: 'berry/site', merged: { number: 20, name: 'BER-9' } });
      const after = await state(waiting.issueId);
      assert.equal(after.status, 'todo');
      assert.equal(after.queued.length, 0);
   });

   test('a delivery that meets a conflict goes back before review', async () => {
      const task = await delivered(31);
      const { deps } = github([31]);
      await afterDelivery(deps, { runId: task.runId });
      const after = await state(task.issueId);
      assert.equal(after.status, 'todo');
      assert.ok(after.comments.some((body) => /another task was merged while this run was working/.test(body)));
   });
});
