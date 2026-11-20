import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { openDatabase, closeDatabase, type Sql } from '../db/pool.ts';
import { repositoryForIssue } from './repository-context.ts';

/**
 * Which repository a run's work belongs in: the task's own (migration 262).
 *
 * Database-backed, because the answer is a join across the task, its project
 * link and the project, and a fake would agree with any SQL.
 */

const url = process.env.BERRY_TEST_DATABASE_URL;

describe('repository for an issue', { skip: url ? false : 'BERRY_TEST_DATABASE_URL is not set' }, () => {
   let sql: Sql;
   const fixture: Record<string, string> = {};

   before(async () => {
      sql = openDatabase({ url: url! });
      const suffix = randomUUID().slice(0, 8);
      const [user] = await sql`
         INSERT INTO users (id, email, name)
         VALUES (${randomUUID()}, ${`repo-${suffix}@berry.test`}, 'Repo Test') RETURNING id`;
      fixture.userId = user!.id as string;

      const [workspace] = await sql`
         INSERT INTO workspaces (id, name, slug, settings, created_by)
         VALUES (${randomUUID()}, ${`Repo ${suffix}`}, ${`repo-${suffix}`},
                 ${sql.json({ issuePrefix: 'REP', defaultRole: 'member', allowMemberInvites: false } as never)},
                 ${fixture.userId})
         RETURNING id`;
      fixture.workspaceId = workspace!.id as string;
      await sql`
         INSERT INTO workspace_memberships (workspace_id, user_id, role)
         VALUES (${fixture.workspaceId}, ${fixture.userId}, 'owner')`;

      const [board] = await sql`
         INSERT INTO boards (id, workspace_id, name, slug, created_by)
         VALUES (${randomUUID()}, ${fixture.workspaceId}, 'Repo board', ${`rep-${suffix}`}, ${fixture.userId})
         RETURNING id`;
      fixture.boardId = board!.id as string;
   });

   after(async () => {
      if (!sql) return;
      await sql`DELETE FROM issue_project_links WHERE workspace_id = ${fixture.workspaceId!}`;
      await sql`DELETE FROM issues WHERE board_id = ${fixture.boardId!}`;
      await sql`DELETE FROM projects WHERE workspace_id = ${fixture.workspaceId!}`;
      await sql`DELETE FROM boards WHERE id = ${fixture.boardId!}`;
      await sql`DELETE FROM workspace_memberships WHERE workspace_id = ${fixture.workspaceId!}`;
      await sql`UPDATE users SET last_workspace_id = NULL WHERE id = ${fixture.userId!}`;
      await closeDatabase(sql);
   });

   async function newIssue(): Promise<string> {
      const id = randomUUID();
      const [counter] = await sql`
         UPDATE boards SET issue_counter = issue_counter + 1
          WHERE id = ${fixture.boardId!} RETURNING issue_counter`;
      await sql`
         INSERT INTO issues (id, board_id, number, title, created_by)
         VALUES (${id}, ${fixture.boardId!}, ${Number(counter!.issue_counter)}, 'Task', ${fixture.userId!})`;
      return id;
   }

   /** `github_repo_id` is a bigint, and a constraint keeps it with the name. */
   let nextRepoId = 1000;
   async function newProject(repo: string | null, verify: string[] = []): Promise<{ id: string; repoId: number | null }> {
      const id = randomUUID();
      const repoId = repo ? (nextRepoId += 1) : null;
      await sql`
         INSERT INTO projects (id, workspace_id, name, github_repo_full_name, github_repo_id, verify_commands, created_by)
         VALUES (${id}, ${fixture.workspaceId!}, ${`Project ${id.slice(0, 4)}`},
                 ${repo}, ${repoId}, ${verify}, ${fixture.userId!})`;
      return { id, repoId };
   }

   async function link(issueId: string, projectId: string, at: string): Promise<void> {
      await sql`
         INSERT INTO issue_project_links (workspace_id, issue_id, project_id, linked_by, created_at)
         VALUES (${fixture.workspaceId!}, ${issueId}, ${projectId}, ${fixture.userId!}, ${at})`;
   }

   /** The task's own repository (migration 262). */
   async function setRepository(issueId: string, repo: string, repoId: number): Promise<void> {
      await sql`UPDATE issues SET github_repo_full_name = ${repo}, github_repo_id = ${repoId} WHERE id = ${issueId}`;
   }

   test('a task with no repository has none, which is not an error', async () => {
      // Plenty of work is answering a question. A run without code to change
      // proceeds without a checkout.
      assert.equal(await repositoryForIssue(sql, await newIssue()), null);
   });

   test('the task names the repository, not its project', async () => {
      // A project's repository is only the default a task starts with: a task
      // that never took it has none of its own.
      const issueId = await newIssue();
      await link(issueId, (await newProject('berry/default')).id, '2026-01-01T00:00:00Z');
      assert.equal(await repositoryForIssue(sql, issueId), null);

      await setRepository(issueId, 'berry/frontend', 4242);
      const found = await repositoryForIssue(sql, issueId);
      assert.equal(found?.fullName, 'berry/frontend');
      assert.equal(found?.provider, 'github');
      assert.match(found?.projectName ?? '', /^Project /);
   });

   test('a task in no project still has its repository', async () => {
      const issueId = await newIssue();
      await setRepository(issueId, 'berry/solo', 4343);
      const found = await repositoryForIssue(sql, issueId);
      assert.equal(found?.fullName, 'berry/solo');
      assert.equal(found?.projectId, null);
      assert.deepEqual(found?.verifyCommands, []);
   });

   test("the project's verify commands apply only in the project's repository", async () => {
      const project = await newProject('berry/app', ['npm test']);
      const onDefault = await newIssue();
      await link(onDefault, project.id, '2026-01-01T00:00:00Z');
      await setRepository(onDefault, 'berry/app', project.repoId!);
      assert.deepEqual((await repositoryForIssue(sql, onDefault))?.verifyCommands, ['npm test']);

      const elsewhere = await newIssue();
      await link(elsewhere, project.id, '2026-01-01T00:00:00Z');
      await setRepository(elsewhere, 'berry/other', 9191);
      assert.deepEqual((await repositoryForIssue(sql, elsewhere))?.verifyCommands, []);
   });

   test('the database will not let a task belong to two projects', async () => {
      const issueId = await newIssue();
      await link(issueId, (await newProject('berry/first')).id, '2026-01-01T00:00:00Z');
      await assert.rejects(
         link(issueId, (await newProject('berry/second')).id, '2026-06-01T00:00:00Z'),
         /duplicate key|issue_project_links_pkey/
      );
   });
});
