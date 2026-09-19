import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import { IssueRepository } from '../core/issues.ts';
import { closeDatabase, openDatabase, type Sql } from '../db/pool.ts';
import { registerCoreAgentTools } from '../runtime/agent-tools/core-tools.ts';
import {
   getAgentTool,
   type AgentToolContext,
   type RepositoryLinker,
} from '../runtime/agent-tools/registry.ts';
import { cleanupFixture, seedFixture, type Fixture } from '../runtime/test-fixture.ts';
import { ensureOrganizationAgents } from './provision.ts';
import { registerOrganizationTools } from './tools.ts';

/**
 * An Orchestrator working from chat or a plan has no task of its own, and the
 * work it routes already exists. These are the tools that let it act on that
 * work by key — inside its workspace, within its delegation graph, and never
 * past what a person decides.
 */

const url = process.env.BERRY_TEST_DATABASE_URL;

describe('acting on named tasks', { skip: url ? false : 'BERRY_TEST_DATABASE_URL is not set' }, () => {
   let sql: Sql;
   let mine: Fixture;
   let theirs: Fixture;
   let issues: IssueRepository;
   const roles = new Map<string, string>();
   const linked: Array<{ projectId: string; fullName: string }> = [];

   const fakeRepositories: RepositoryLinker = {
      resolve: async (_workspaceId, fullName) => ({ githubRepoId: '4242', githubRepoFullName: fullName }),
      link: async (_workspaceId, projectId, repository) => {
         linked.push({ projectId, fullName: repository.githubRepoFullName });
      },
   };

   function agentFor(roleKey: string): string {
      const id = roles.get(roleKey);
      assert.ok(id, roleKey);
      return id;
   }

   /** A run with no task of its own: chat, a plan, an autopilot. */
   function unbound(roleKey: string, repositories: RepositoryLinker | null = fakeRepositories): AgentToolContext {
      return {
         sql,
         storage: null,
         issues,
         projects: {} as never,
         repositories,
         task: {
            tokenId: 't',
            runId: randomUUID(),
            workspaceId: mine.workspaceId,
            agentId: agentFor(roleKey),
            issueId: null,
            boardId: null,
            scopes: ['task:read', 'task:write'],
         },
      };
   }

   async function run(name: string, context: AgentToolContext, input: unknown) {
      const tool = getAgentTool(name);
      assert.ok(tool, name);
      return tool.run(context, input);
   }

   async function ok(name: string, context: AgentToolContext, input: unknown) {
      const outcome = await run(name, context, input);
      assert.ok(outcome.ok, `${name}: ${JSON.stringify(outcome)}`);
      return outcome.result as Record<string, unknown>;
   }

   async function task(fixture: Fixture, title: string, status = 'backlog') {
      const { issue } = await issues.create({
         boardId: fixture.boardId,
         title,
         description: `${title}.`,
         status,
         priority: 'none',
         sortOrder: 0,
         dueDate: null,
         assignee: null,
         project: null,
         createdBy: fixture.userId,
      });
      return { id: issue.id, key: issue.identifier };
   }

   before(async () => {
      sql = openDatabase({ url: url! });
      mine = await seedFixture(sql, 'handoff');
      theirs = await seedFixture(sql, 'handoff-other');
      await ensureOrganizationAgents(sql, mine.workspaceId);
      const rows = await sql<Array<{ id: string; role_key: string }>>`
         SELECT id, role_key FROM agents WHERE workspace_id = ${mine.workspaceId} AND role_key IS NOT NULL`;
      for (const row of rows) roles.set(row.role_key, row.id);
      issues = new IssueRepository(sql);
      registerCoreAgentTools();
      registerOrganizationTools({ sql, issues });
   });

   after(async () => {
      await sql`DELETE FROM runs WHERE workspace_id IN (${mine.workspaceId}, ${theirs.workspaceId})`;
      await cleanupFixture(sql, mine);
      await cleanupFixture(sql, theirs);
      await closeDatabase(sql);
   });

   test('a run with no task says to name one, and a named one reads in full', async () => {
      const brief = await task(mine, 'Analyze the reference site');
      await assert.rejects(run('read_task', unbound('orchestrator'), {}), /name one with `task`/);
      const read = await ok('read_task', unbound('orchestrator'), { task: brief.key.toLowerCase() });
      assert.equal(read.found, true);
      assert.equal(read.identifier, brief.key);
      assert.equal(read.title, 'Analyze the reference site');
   });

   test("another workspace's task is out of reach, by id or by key", async () => {
      const foreign = await task(theirs, 'Not yours');
      await assert.rejects(run('read_task', unbound('orchestrator'), { task: foreign.id }), /not found/i);
      await assert.rejects(run('post_comment', unbound('orchestrator'), { task: foreign.id, body: 'hi' }), /not found/i);
      // A key is per workspace: the same key here names this workspace's own
      // task, if it has one, and never the other workspace's.
      await run('post_comment', unbound('orchestrator'), { task: foreign.key, body: 'hi' }).catch(() => null);
      const [comment] = await sql`SELECT id FROM comments WHERE issue_id = ${foreign.id}`;
      assert.equal(comment, undefined, 'nothing lands on the other workspace\'s task');
   });

   test('comments and statuses reach a named task, and done stays out of reach', async () => {
      const target = await task(mine, 'Draft the brief', 'todo');
      await ok('post_comment', unbound('orchestrator'), { task: target.key, body: 'Context for whoever picks this up.' });
      const [comment] = await sql`
         SELECT author_type::text AS author_type, body FROM comments WHERE issue_id = ${target.id}`;
      assert.equal(comment?.author_type, 'agent');
      await ok('set_status', unbound('orchestrator'), { task: target.key, status: 'blocked' });
      const [row] = await sql`SELECT status::text AS status FROM issues WHERE id = ${target.id}`;
      assert.equal(row?.status, 'blocked');
      const done = await run('set_status', unbound('orchestrator'), { task: target.key, status: 'done' });
      assert.equal(done.ok, false, 'no agent can mark a task done');
   });

   test('list_agents names every agent with the id and role key the other tools take', async () => {
      const listed = await ok('list_agents', unbound('orchestrator'), {});
      const agents = listed.agents as Array<{ id: string; roleKey: string | null; self: boolean }>;
      const analyst = agents.find((agent) => agent.roleKey === 'business-analyst');
      assert.equal(analyst?.id, agentFor('business-analyst'));
      assert.equal(agents.find((agent) => agent.self)?.roleKey, 'orchestrator');
   });

   test('mention_agent by role key on another task posts the message and starts that agent there', async () => {
      const target = await task(mine, 'Review the copy', 'todo');
      const result = await ok('mention_agent', unbound('orchestrator'), {
         agentId: 'business-analyst',
         task: target.key,
         message: 'Please check the tone against the brief.',
      });
      assert.equal(result.queued, true);
      const [queued] = await sql`
         SELECT agent_id, source, prompt FROM runs WHERE issue_id = ${target.id} AND status = 'queued'`;
      assert.equal(queued?.agent_id, agentFor('business-analyst'));
      assert.equal(queued?.source, 'mention');
   });

   test('assign_task starts a ready task, and parks one whose prerequisite is unfinished', async () => {
      const analysis = await task(mine, 'Analyze emailbuilder.online');
      const design = await task(mine, 'Design the landing page');
      await sql`INSERT INTO issue_dependencies (workspace_id, issue_id, depends_on_issue_id)
                VALUES (${mine.workspaceId}, ${design.id}, ${analysis.id})`;

      const ready = await ok('assign_task', unbound('orchestrator'), {
         task: analysis.key,
         role: 'business-analyst',
         message: 'Structure, tone and IP-safe copy per section.',
      });
      assert.equal(ready.status, 'todo');
      assert.equal(ready.started, true);
      const [analysisRow] = await sql`
         SELECT status::text AS status, assignee_id FROM issues WHERE id = ${analysis.id}`;
      assert.equal(analysisRow?.assignee_id, agentFor('business-analyst'));
      const [analysisRun] = await sql`SELECT source FROM runs WHERE issue_id = ${analysis.id} AND status = 'queued'`;
      assert.equal(analysisRun?.source, 'assignment');

      const parked = await ok('assign_task', unbound('orchestrator'), { task: design.key, role: 'product-designer' });
      assert.equal(parked.status, 'blocked', 'the dependency release looks for blocked tasks');
      assert.equal(parked.started, false);
      assert.deepEqual(parked.waitingOn, [analysis.key]);
      const [designRun] = await sql`SELECT id FROM runs WHERE issue_id = ${design.id}`;
      assert.equal(designRun, undefined, 'nothing starts before its prerequisite finishes');
   });

   test('assign_task follows the delegation graph and leaves released work alone', async () => {
      const target = await task(mine, 'Out of lane');
      // The analyst hands work to product-designer and software-architect only.
      await assert.rejects(
         run('assign_task', unbound('business-analyst'), { task: target.key, role: 'backend-engineer' }),
         /cannot hand work to backend-engineer/
      );
      const [untouched] = await sql`SELECT assignee_id FROM issues WHERE id = ${target.id}`;
      assert.equal(untouched?.assignee_id, null, 'a refused handoff changes nothing');
      const lane = await ok('assign_task', unbound('business-analyst'), {
         task: target.key,
         role: 'product-designer',
         start: false,
      });
      assert.equal(lane.started, false);
      assert.equal(lane.note, 'assigned without starting');
      const closed = await task(mine, 'Already shipped', 'todo');
      await sql`UPDATE issues SET status = 'done' WHERE id = ${closed.id}`;
      await assert.rejects(
         run('assign_task', unbound('orchestrator'), { task: closed.key, role: 'qa-engineer' }),
         /a person reopens it/
      );
   });

   test('link_tasks records prerequisites, parks a waiting task and refuses a loop', async () => {
      const brief = await task(mine, 'Brief', 'todo');
      const design = await task(mine, 'Design', 'todo');
      const linked = await ok('link_tasks', unbound('orchestrator'), { task: design.key, dependsOn: [brief.key] });
      assert.deepEqual(linked.waitingOn, [brief.key]);
      const [parked] = await sql`SELECT status::text AS status FROM issues WHERE id = ${design.id}`;
      assert.equal(parked?.status, 'blocked', 'a todo task that now waits must not start early');
      // The same link twice is one link.
      await ok('link_tasks', unbound('orchestrator'), { task: design.key, dependsOn: [brief.key] });
      const edges = await sql`SELECT 1 FROM issue_dependencies WHERE issue_id = ${design.id}`;
      assert.equal(edges.length, 1);
      await assert.rejects(
         run('link_tasks', unbound('orchestrator'), { task: brief.key, dependsOn: [design.key] }),
         /loop/
      );
      await assert.rejects(
         run('link_tasks', unbound('orchestrator'), { task: brief.key, dependsOn: [brief.key] }),
         /loop/
      );
      const removed = await ok('link_tasks', unbound('orchestrator'), {
         task: design.key,
         dependsOn: [brief.key],
         remove: true,
      });
      assert.equal(removed.removed, 1);
   });

   test('create_task files a task already waiting on its prerequisites', async () => {
      const build = await task(mine, 'Build');
      const created = await ok('create_task', unbound('orchestrator'), {
         title: 'QA the build',
         dependsOn: [build.key],
      });
      assert.deepEqual(created.waitingOn, [build.key]);
      await assert.rejects(
         run('create_task', unbound('orchestrator'), { title: 'Orphan', dependsOn: ['NOPE-999999'] }),
         /not found/i
      );
      const [orphan] = await sql`SELECT id FROM issues WHERE title = 'Orphan' AND board_id = ${mine.boardId}`;
      assert.equal(orphan, undefined, 'a bad prerequisite leaves no half-made task');
   });

   test('link_project_repository links through the resolver, by project name', async () => {
      const [project] = await sql`
         INSERT INTO projects (workspace_id, name, created_by)
         VALUES (${mine.workspaceId}, 'PageBuilder landing', ${mine.userId}) RETURNING id`;
      const result = await ok('link_project_repository', unbound('orchestrator'), {
         project: 'pagebuilder landing',
         repository: 'laravel42/berry-repo-test',
      });
      assert.deepEqual(result, { projectId: project!.id, repository: 'laravel42/berry-repo-test' });
      assert.deepEqual(linked.at(-1), { projectId: project!.id, fullName: 'laravel42/berry-repo-test' });
      await assert.rejects(
         run('link_project_repository', unbound('orchestrator'), { project: 'No such project', repository: 'a/b' }),
         /not found/i
      );
      await assert.rejects(
         run('link_project_repository', unbound('orchestrator', null), { project: 'PageBuilder landing', repository: 'a/b' }),
         /cannot resolve GitHub repositories/
      );
      const shape = await run('link_project_repository', unbound('orchestrator'), {
         project: 'PageBuilder landing',
         repository: 'https://github.com/a/b',
      });
      assert.equal(shape.ok, false, 'owner/name only');
   });
});
