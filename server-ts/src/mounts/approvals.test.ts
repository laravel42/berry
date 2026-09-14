import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import { ApprovalRepository } from '../approvals/repository.ts';
import { personalTokenResolver } from '../auth/credentials.ts';
import { SessionService } from '../auth/sessions.ts';
import { issueTestToken } from '../auth/test-credentials.ts';
import { BoardRepository } from '../core/boards.ts';
import { IssueRepository } from '../core/issues.ts';
import { closeDatabase, openDatabase, type Sql } from '../db/pool.ts';
import { createApp, type BerryApp } from '../http/app.ts';
import { IdempotencyStore } from '../http/idempotency.ts';
import { Registry } from '../http/registry.ts';
import { ensureOrganizationAgents } from '../organization/provision.ts';
import { RunRepository } from '../runs/repository.ts';
import { cleanupFixture, seedFixture, type Fixture } from '../runtime/test-fixture.ts';
import { approvalMounts } from './approvals.ts';

/**
 * A decision that hands a task back to an agent starts it: an accepted work
 * proposal and an answered escalation get the same auto-dispatch an
 * assignment does, after the decision commits.
 */

const url = process.env.BERRY_TEST_DATABASE_URL;

describe('/api/v1/approvals releases work to agents', { skip: url ? false : 'BERRY_TEST_DATABASE_URL is not set' }, () => {
   let sql: Sql;
   let app: BerryApp;
   let fixture: Fixture | null = null;
   let issues: IssueRepository;
   let token = '';
   const dispatchErrors: unknown[] = [];

   before(async () => {
      sql = openDatabase({ url: url as string });
      fixture = await seedFixture(sql, 'approvals-dispatch');
      await ensureOrganizationAgents(sql, fixture.workspaceId);
      await sql`UPDATE users SET last_workspace_id = ${fixture.workspaceId} WHERE id = ${fixture.userId}`;
      token = await issueTestToken(sql, fixture.userId);
      issues = new IssueRepository(sql);

      const registry = new Registry();
      registry.registerAll(
         approvalMounts({
            sessions: new SessionService({ sql, auth: null, bearer: [personalTokenResolver(sql)] }),
            approvals: new ApprovalRepository(sql),
            boards: new BoardRepository(sql),
            issues,
            idempotency: new IdempotencyStore(sql),
            dispatch: new RunRepository(sql),
            onDispatchError: (_issueId, error) => dispatchErrors.push(error),
         })
      );
      app = createApp(registry);
   });

   after(async () => {
      if (!sql) return;
      if (fixture) {
         await sql`DELETE FROM work_proposals WHERE workspace_id = ${fixture.workspaceId}`;
         await sql`DELETE FROM approvals WHERE workspace_id = ${fixture.workspaceId}`;
         await sql`DELETE FROM run_events WHERE board_id = ${fixture.boardId}`;
         await sql`UPDATE issues SET active_run_id = NULL WHERE board_id = ${fixture.boardId}`;
         await sql`DELETE FROM runs WHERE board_id = ${fixture.boardId}`;
      }
      await cleanupFixture(sql, fixture);
      await closeDatabase(sql);
   });

   const decide = (approvalId: string, decision: 'approve' | 'reject') =>
      app.request(`/api/v1/approvals/${approvalId}/${decision}`, {
         method: 'POST',
         body: '{}',
         headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
            'idempotency-key': `decide-${randomUUID()}`,
         },
      });

   async function agentIdFor(roleKey: string): Promise<string> {
      const [row] = await sql`
         SELECT id FROM agents WHERE workspace_id = ${fixture!.workspaceId} AND role_key = ${roleKey} AND archived_at IS NULL`;
      return row!.id as string;
   }

   async function task(title: string, status: string, assigneeId: string | null): Promise<string> {
      const { issue } = await issues.create({
         boardId: fixture!.boardId,
         title,
         description: '',
         status,
         priority: 'medium',
         sortOrder: 0,
         dueDate: null,
         assignee: assigneeId ? { type: 'agent', id: assigneeId } : null,
         project: null,
         createdBy: fixture!.userId,
      });
      return issue.id;
   }

   /** A pending work_proposal approval on a backlog task, for `responsibleRole`. */
   async function proposal(responsibleRole: string): Promise<{ issueId: string; approvalId: string }> {
      const issueId = await task('Proposed work', 'backlog', null);
      const approvalId = randomUUID();
      await sql`
         INSERT INTO approvals (id, workspace_id, kind, risk, title, description, issue_id,
                                requested_from_role, requested_by_type, requested_by, status)
         VALUES (${approvalId}, ${fixture!.workspaceId}, 'work_proposal', 'medium', 'Proposal: upgrade lodash', 'Upgrade lodash.',
                 ${issueId}, 'admin', 'agent', ${await agentIdFor('security-engineer')}, 'pending')`;
      await sql`
         INSERT INTO work_proposals (workspace_id, issue_id, approval_id, role_key, problem, evidence, impact,
                                     severity, impact_classes, proposed_action, effort, dependencies, responsible_role,
                                     required_reviewers, fingerprint, status)
         VALUES (${fixture!.workspaceId}, ${issueId}, ${approvalId}, 'security-engineer', 'lodash is vulnerable',
                 ${sql.json([{ kind: 'dependency', ref: 'package.json', excerpt: '' }] as never)},
                 'Prototype pollution.', 'medium', ${['security']}, 'Upgrade it.', 's', ${[]}, ${responsibleRole},
                 ${[]}, ${randomUUID()}, 'proposed')`;
      return { issueId, approvalId };
   }

   async function runsOf(issueId: string) {
      return sql<Array<{ agent_id: string; status: string }>>`SELECT agent_id, status FROM runs WHERE issue_id = ${issueId}`;
   }

   test("a person's accept assigns the responsible role and starts a run", async () => {
      const { issueId, approvalId } = await proposal('backend-engineer');

      const response = await decide(approvalId, 'approve');

      assert.equal(response.status, 200);
      const runs = await runsOf(issueId);
      assert.equal(runs.length, 1, 'the released task has a run');
      assert.equal(runs[0]!.agent_id, await agentIdFor('backend-engineer'));
      assert.deepEqual(dispatchErrors, []);
   });

   test('a rejected proposal starts nothing', async () => {
      const { issueId, approvalId } = await proposal('backend-engineer');

      assert.equal((await decide(approvalId, 'reject')).status, 200);

      assert.equal((await runsOf(issueId)).length, 0);
   });

   test('an answered escalation resumes the blocked task with a run for its agent', async () => {
      const sre = await agentIdFor('sre');
      const issueId = await task('Roll back or hotfix?', 'todo', sre);
      await sql`UPDATE issues SET status = 'blocked' WHERE id = ${issueId}`;
      const approvalId = randomUUID();
      await sql`
         INSERT INTO approvals (id, workspace_id, kind, risk, title, description, issue_id,
                                requested_from_role, requested_by_type, requested_by, status)
         VALUES (${approvalId}, ${fixture!.workspaceId}, 'escalation', 'medium', 'Decision needed: Roll back?', 'Roll back?',
                 ${issueId}, 'admin', 'agent', ${sre}, 'pending')`;

      const response = await decide(approvalId, 'approve');

      assert.equal(response.status, 200);
      const runs = await runsOf(issueId);
      assert.equal(runs.length, 1, 'the author is resumed');
      assert.equal(runs[0]!.agent_id, sre);
      assert.deepEqual(dispatchErrors, []);
   });
});
