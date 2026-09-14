import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import { ApprovalRepository } from '../approvals/repository.ts';
import { closeDatabase, openDatabase, type Sql } from '../db/pool.ts';
import { deleteWorkspaceAgents } from '../test-support/protected-agents.ts';
import { deleteWorkspaceBoards } from '../test-support/boards.ts';
import { ensureOrganizationAgents } from './provision.ts';
import { acceptDecision, applyProposalDecision, fingerprintProposal, proposalSchema, type ProposalInput } from './proposals.ts';

const valid: ProposalInput = {
   problem: 'lodash 4.17.15 has a prototype pollution advisory',
   evidence: [{ kind: 'dependency', ref: 'frontend/package.json', excerpt: '"lodash": "4.17.15"' }],
   impact: 'Crafted input can modify object prototypes server-side.',
   severity: 'high',
   impactClasses: ['security'],
   proposedAction: 'Upgrade lodash to 4.17.21 and add a lockfile check.',
   effort: 's',
   dependencies: [],
   responsibleRole: 'backend-engineer',
   requiredReviewers: ['security-engineer', 'qa-engineer'],
};

test('a proposal needs evidence', () => {
   assert.equal(proposalSchema.safeParse(valid).success, true);
   assert.equal(proposalSchema.safeParse({ ...valid, evidence: [] }).success, false);
});

test('fingerprints ignore case, spacing and evidence order', () => {
   const a = fingerprintProposal('security-engineer', valid);
   const b = fingerprintProposal('security-engineer', { ...valid, problem: `  ${valid.problem.toUpperCase()} ` });
   assert.equal(a, b);
   assert.notEqual(a, fingerprintProposal('qa-engineer', valid));
});

test('only routine, low or medium work from Level 4+ is auto-accepted', () => {
   assert.equal(acceptDecision({ severity: 'medium', impactClasses: ['routine'], proposerLevel: 4 }), 'auto_accept');
   assert.equal(acceptDecision({ severity: 'medium', impactClasses: ['routine'], proposerLevel: 3 }), 'needs_decision');
   assert.equal(acceptDecision({ severity: 'high', impactClasses: ['routine'], proposerLevel: 5 }), 'needs_decision');
   assert.equal(acceptDecision({ severity: 'low', impactClasses: ['routine', 'operational'], proposerLevel: 5 }), 'needs_decision');
});

const url = process.env.BERRY_TEST_DATABASE_URL;

describe('applyProposalDecision', { skip: url ? false : 'BERRY_TEST_DATABASE_URL is not set' }, () => {
   let sql: Sql;
   let workspaceId: string;
   let userId: string;
   let boardId: string;

   before(async () => {
      sql = openDatabase({ url: url! });
      const [user] = await sql`
         INSERT INTO users (id, email, name) VALUES (${randomUUID()}, ${`proposals-${randomUUID().slice(0, 8)}@berry.test`}, 'Proposals test')
         RETURNING id`;
      userId = user!.id as string;
      const [workspace] = await sql`
         INSERT INTO workspaces (id, slug, name, created_by)
         VALUES (${randomUUID()}, ${`proposals-${randomUUID().slice(0, 8)}`}, 'Proposals org', ${userId})
         RETURNING id`;
      workspaceId = workspace!.id as string;
      await sql`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES (${workspaceId}, ${userId}, 'owner')`;
      const [board] = await sql`
         INSERT INTO boards (id, workspace_id, name, slug, created_by)
         VALUES (${randomUUID()}, ${workspaceId}, 'Board', ${`p-${randomUUID().slice(0, 8)}`}, ${userId})
         RETURNING id`;
      boardId = board!.id as string;
      await ensureOrganizationAgents(sql, workspaceId);
   });

   after(async () => {
      if (!sql) return;
      await sql`DELETE FROM approvals WHERE workspace_id = ${workspaceId}`;
      await sql`DELETE FROM work_proposals WHERE workspace_id = ${workspaceId}`;
      await sql`DELETE FROM issues WHERE board_id = ${boardId}`;
      await deleteWorkspaceAgents(sql, [workspaceId]);
      await deleteWorkspaceBoards(sql, [workspaceId]);
      await sql`DELETE FROM workspaces WHERE id = ${workspaceId}`;
      await sql`DELETE FROM users WHERE id = ${userId}`;
      await closeDatabase(sql);
   });

   async function openIssue(): Promise<string> {
      const issueId = randomUUID();
      await sql.begin(async (tx) => {
         const [counter] = await tx`UPDATE boards SET issue_counter = issue_counter + 1 WHERE id = ${boardId} RETURNING issue_counter`;
         await tx`
            INSERT INTO issues (id, board_id, number, title, status, created_by)
            VALUES (${issueId}, ${boardId}, ${Number(counter!.issue_counter)}, 'Proposal task', 'backlog', ${userId})`;
      });
      return issueId;
   }

   async function openProposal(issueId: string, responsibleRole: string): Promise<string> {
      const approvalId = randomUUID();
      await sql`
         INSERT INTO approvals (id, workspace_id, kind, risk, title, description, issue_id,
                                requested_from_role, requested_by_type, requested_by, status)
         VALUES (${approvalId}, ${workspaceId}, 'work_proposal', 'high', 'Proposal', 'Proposal', ${issueId},
                 'admin', 'user', ${userId}, 'pending')`;
      const [proposal] = await sql<Array<{ id: string }>>`
         INSERT INTO work_proposals (workspace_id, issue_id, approval_id, role_key, problem, evidence, impact,
                                     severity, impact_classes, proposed_action, effort, dependencies, responsible_role,
                                     required_reviewers, fingerprint, status)
         VALUES (${workspaceId}, ${issueId}, ${approvalId}, 'qa-engineer', 'problem', ${sql.json([{ kind: 'task', ref: issueId, excerpt: '' }] as never)},
                 'impact', 'medium', ${['routine']}, 'action', 's', ${[]}, ${responsibleRole},
                 ${[]}, ${randomUUID()}, 'proposed')
         RETURNING id`;
      return approvalId;
   }

   test('accepting assigns the responsible role and moves the task to todo', async () => {
      const issueId = await openIssue();
      const approvalId = await openProposal(issueId, 'backend-engineer');
      await applyProposalDecision(sql, { approvalId, decision: 'approved', userId });

      const [issue] = await sql<Array<{ status: string; assignee_type: string; assignee_id: string }>>`
         SELECT status::text AS status, assignee_type::text AS assignee_type, assignee_id FROM issues WHERE id = ${issueId}`;
      assert.equal(issue?.status, 'todo');
      assert.equal(issue?.assignee_type, 'agent');
      const [owner] = await sql<Array<{ id: string }>>`
         SELECT id FROM agents WHERE workspace_id = ${workspaceId} AND role_key = 'backend-engineer'`;
      assert.equal(issue?.assignee_id, owner?.id);

      const [assignment] = await sql<Array<{ assignee_id: string; assigned_by: string }>>`
         SELECT assignee_id, assigned_by FROM assignments WHERE issue_id = ${issueId}`;
      assert.equal(assignment?.assignee_id, owner?.id);
      assert.equal(assignment?.assigned_by, userId);

      const [proposal] = await sql<Array<{ status: string }>>`
         SELECT status FROM work_proposals WHERE approval_id = ${approvalId}`;
      assert.equal(proposal?.status, 'accepted');
   });

   test('rejecting cancels the task', async () => {
      const issueId = await openIssue();
      const approvalId = await openProposal(issueId, 'backend-engineer');
      await applyProposalDecision(sql, { approvalId, decision: 'rejected', userId });

      const [issue] = await sql<Array<{ status: string }>>`SELECT status::text AS status FROM issues WHERE id = ${issueId}`;
      assert.equal(issue?.status, 'cancelled');
      const [proposal] = await sql<Array<{ status: string }>>`
         SELECT status FROM work_proposals WHERE approval_id = ${approvalId}`;
      assert.equal(proposal?.status, 'rejected');
   });

   test('accepting with no live role owner moves the task to todo unassigned', async () => {
      const issueId = await openIssue();
      const approvalId = await openProposal(issueId, 'no-such-role');
      await applyProposalDecision(sql, { approvalId, decision: 'approved', userId });

      const [issue] = await sql<Array<{ status: string; assignee_id: string | null }>>`
         SELECT status::text AS status, assignee_id FROM issues WHERE id = ${issueId}`;
      assert.equal(issue?.status, 'todo');
      assert.equal(issue?.assignee_id, null);
      const [proposal] = await sql<Array<{ status: string }>>`
         SELECT status FROM work_proposals WHERE approval_id = ${approvalId}`;
      assert.equal(proposal?.status, 'accepted');
   });

   test('ApprovalRepository.resolve dispatches a work_proposal approval to applyProposalDecision', async () => {
      const approvals = new ApprovalRepository(sql);
      const issueId = await openIssue();
      const approvalId = await openProposal(issueId, 'backend-engineer');

      const resolved = await approvals.resolve({ approvalId, decision: 'approved', userId, role: 'owner', note: null });
      assert.equal(resolved.status, 'approved');

      const [issue] = await sql<Array<{ status: string }>>`SELECT status::text AS status FROM issues WHERE id = ${issueId}`;
      assert.equal(issue?.status, 'todo');
      const [proposal] = await sql<Array<{ status: string }>>`
         SELECT status FROM work_proposals WHERE approval_id = ${approvalId}`;
      assert.equal(proposal?.status, 'accepted');
   });

   test('ApprovalRepository.resolve rejecting a work_proposal cancels the task', async () => {
      const approvals = new ApprovalRepository(sql);
      const issueId = await openIssue();
      const approvalId = await openProposal(issueId, 'backend-engineer');

      await approvals.resolve({ approvalId, decision: 'rejected', userId, role: 'owner', note: null });

      const [issue] = await sql<Array<{ status: string }>>`SELECT status::text AS status FROM issues WHERE id = ${issueId}`;
      assert.equal(issue?.status, 'cancelled');
      const [proposal] = await sql<Array<{ status: string }>>`
         SELECT status FROM work_proposals WHERE approval_id = ${approvalId}`;
      assert.equal(proposal?.status, 'rejected');
   });
});
