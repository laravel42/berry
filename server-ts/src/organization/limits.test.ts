import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { IssueRepository } from '../core/issues.ts';
import { closeDatabase, openDatabase, type Sql } from '../db/pool.ts';
import { getAgentTool, type AgentToolContext } from '../runtime/agent-tools/registry.ts';
import { cleanupFixture, seedFixture, type Fixture } from '../runtime/test-fixture.ts';
import { ensureOrganizationAgents } from './provision.ts';
import { registerOrganizationTools } from './tools.ts';

const url = process.env.BERRY_TEST_DATABASE_URL;

/**
 * The deployment's ceilings on handing work around. Its own file because the
 * tools are registered once per process, with the limits they were given.
 */
describe('organization limits', { skip: url ? false : 'BERRY_TEST_DATABASE_URL is not set' }, () => {
   let sql: Sql;
   let fixture: Fixture;
   let issues: IssueRepository;
   const agents = new Map<string, string>();

   const context = (role: string, issueId: string): AgentToolContext => ({
      sql,
      storage: null,
      issues,
      projects: {} as never,
      task: { tokenId: 't', runId: randomUUID(), workspaceId: fixture.workspaceId, agentId: agents.get(role)!, issueId, boardId: fixture.boardId, scopes: ['task:read', 'task:write'] },
   });
   const task = async (title: string, role: string) =>
      (await issues.create({ boardId: fixture.boardId, title, description: null, status: 'todo', priority: 'medium', sortOrder: 0, dueDate: null, assignee: { type: 'agent', id: agents.get(role)! }, project: null, createdBy: fixture.userId })).issue;
   const delegate = (role: string, issueId: string, to: string, title: string) =>
      getAgentTool('delegate_to_agent')!.run(context(role, issueId), { role: to, title, description: '', acceptanceCriteria: ['done'] });

   before(async () => {
      sql = openDatabase({ url: url! });
      fixture = await seedFixture(sql, 'org-limits');
      await ensureOrganizationAgents(sql, fixture.workspaceId);
      for (const row of await sql<Array<{ id: string; role_key: string }>>`SELECT id, role_key FROM agents WHERE workspace_id = ${fixture.workspaceId} AND role_key IS NOT NULL`) agents.set(row.role_key, row.id);
      issues = new IssueRepository(sql);
      registerOrganizationTools({ sql, issues, gate: null, limits: { maxDelegationDepth: 1, maxDelegationsPerRun: 2, handoffWindow: 4, handoffMinUniqueAgents: 3 } });
   });

   after(async () => {
      if (!sql) return;
      await sql`UPDATE issues SET active_run_id = NULL WHERE board_id = ${fixture.boardId}`;
      await sql`DELETE FROM runs WHERE board_id = ${fixture.boardId}`;
      await sql`DELETE FROM comments WHERE issue_id IN (SELECT id FROM issues WHERE board_id = ${fixture.boardId})`;
      await sql`DELETE FROM issues WHERE board_id = ${fixture.boardId} AND parent_id IS NOT NULL`;
      await sql`DELETE FROM issues WHERE board_id = ${fixture.boardId}`;
      await cleanupFixture(sql, fixture);
      await closeDatabase(sql);
   });

   test('a run may create only so many sub-tasks', async () => {
      const root = await task('Prolific', 'engineering-manager');
      assert.equal((await delegate('engineering-manager', root.id, 'backend-engineer', 'one')).ok, true);
      assert.equal((await delegate('engineering-manager', root.id, 'backend-engineer', 'two')).ok, true);
      await assert.rejects(delegate('engineering-manager', root.id, 'backend-engineer', 'three'), /already created 2 sub-tasks/);
      assert.equal((await sql`SELECT 1 FROM issues WHERE title = 'three' AND board_id = ${fixture.boardId}`).length, 0);
   });

   test('a sub-task at the depth limit cannot delegate further', async () => {
      const root = await task('Deep', 'engineering-manager');
      await delegate('engineering-manager', root.id, 'backend-engineer', 'level one');
      const [child] = await sql<Array<{ id: string }>>`SELECT id FROM issues WHERE title = 'level one' AND board_id = ${fixture.boardId}`;
      await assert.rejects(delegate('backend-engineer', child!.id, 'qa-engineer', 'level two'), /sub-tasks stop at 1/);
   });

   test('a task sent back once is ordinary; two roles passing it back and forth are stopped', async () => {
      const bounced = await task('Bounced', 'backend-engineer');
      const assign = (from: string, to: string) => getAgentTool('assign_task')!.run(context(from, bounced.id), { task: bounced.identifier, role: to, start: false });
      assert.equal((await assign('backend-engineer', 'qa-engineer')).ok, true);
      assert.equal((await assign('qa-engineer', 'backend-engineer')).ok, true, 'sent back once');
      await assert.rejects(assign('backend-engineer', 'qa-engineer'), /back and forth between the same roles/);
      // A third role breaks the pattern: that is a handoff going somewhere.
      assert.equal((await assign('backend-engineer', 'security-engineer')).ok, true);
   });
});
