import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import { IssueRepository } from '../core/issues.ts';
import { closeDatabase, openDatabase, type Sql } from '../db/pool.ts';
import type { AgentToolContext } from '../runtime/agent-tools/registry.ts';
import { getAgentTool } from '../runtime/agent-tools/registry.ts';
import { cleanupFixture, seedFixture, type Fixture } from '../runtime/test-fixture.ts';
import { ReviewGate } from '../agents/review-gate.ts';
import { RunLedger } from '../runs/ledger.ts';
import { RunRepository } from '../runs/repository.ts';
import { catalogRole } from './catalog.ts';
import { ensureOrganizationAgents } from './provision.ts';
import { fingerprintProposal, type ProposalInput } from './proposals.ts';
import { registerOrganizationTools, type OrganizationToolDeps } from './tools.ts';

const url = process.env.BERRY_TEST_DATABASE_URL;

describe('delegation and escalation tools', { skip: url ? false : 'BERRY_TEST_DATABASE_URL is not set' }, () => {
   let sql: Sql;
   let fixture: Fixture;
   let toolDeps: OrganizationToolDeps;
   let issues: IssueRepository;
   let parentIssueId: string;
   let gate: ReviewGate;
   const agentIds = new Map<string, string>();

   function agentIdFor(roleKey: string): string {
      const id = agentIds.get(roleKey);
      assert.ok(id, `no agent provisioned for ${roleKey}`);
      return id;
   }

   function contextFor(roleKey: string, issueId: string, runId: string = randomUUID()): AgentToolContext {
      return {
         sql,
         storage: null,
         issues,
         projects: {} as never,
         task: {
            tokenId: 't',
            runId,
            workspaceId: fixture.workspaceId,
            agentId: agentIdFor(roleKey),
            issueId,
            boardId: fixture.boardId,
            scopes: ['task:read', 'task:write'],
         },
      };
   }

   function tool(name: string) {
      const found = getAgentTool(name);
      assert.ok(found, name);
      return found;
   }

   before(async () => {
      sql = openDatabase({ url: url! });
      fixture = await seedFixture(sql, 'org-tools');
      await ensureOrganizationAgents(sql, fixture.workspaceId);
      const rows = await sql<Array<{ id: string; role_key: string }>>`
         SELECT id, role_key FROM agents WHERE workspace_id = ${fixture.workspaceId} AND role_key IS NOT NULL`;
      for (const row of rows) agentIds.set(row.role_key, row.id);

      issues = new IssueRepository(sql);
      gate = new ReviewGate({
         sql,
         issues,
         runs: new RunRepository(sql),
         defaultModel: 'm',
         completion: { async structured() { throw new Error('the tool path never asks a model'); } },
         github: async () => { throw new Error('the tool path never reads a diff'); },
      });
      toolDeps = { sql, issues, gate };
      registerOrganizationTools(toolDeps);

      const { issue } = await issues.create({
         boardId: fixture.boardId,
         title: 'Parent task',
         description: 'The umbrella task.',
         status: 'todo',
         priority: 'medium',
         sortOrder: 0,
         dueDate: null,
         assignee: { type: 'agent', id: agentIdFor('engineering-manager') },
         project: null,
         createdBy: fixture.userId,
      });
      parentIssueId = issue.id;
   });

   after(async () => {
      if (!sql) return;
      await sql`DELETE FROM work_proposals WHERE workspace_id = ${fixture.workspaceId}`;
      await sql`DELETE FROM approvals WHERE workspace_id = ${fixture.workspaceId}`;
      await sql`DELETE FROM run_events WHERE board_id = ${fixture.boardId}`;
      await sql`DELETE FROM issue_auto_reviews WHERE workspace_id = ${fixture.workspaceId}`;
      await sql`UPDATE issues SET active_run_id = NULL WHERE board_id = ${fixture.boardId}`;
      await sql`DELETE FROM runs WHERE board_id = ${fixture.boardId}`;
      await sql`DELETE FROM comments WHERE issue_id IN (SELECT id FROM issues WHERE board_id = ${fixture.boardId})`;
      await sql`DELETE FROM issues WHERE board_id = ${fixture.boardId} AND parent_id IS NOT NULL`;
      await sql`DELETE FROM issues WHERE board_id = ${fixture.boardId}`;
      await cleanupFixture(sql, fixture);
      await closeDatabase(sql);
   });

   test('delegate_to_agent creates an assigned sub-task along the graph', async () => {
      const result = await tool('delegate_to_agent').run(contextFor('engineering-manager', parentIssueId), {
         role: 'backend-engineer',
         title: 'Implement the endpoint',
         description: 'POST /things',
         acceptanceCriteria: ['Returns 201 with the created thing'],
      });
      assert.equal(result.ok, true);
      const [child] = await sql`
         SELECT assignee_id, parent_id, description FROM issues
          WHERE title = 'Implement the endpoint' AND board_id = ${fixture.boardId}`;
      assert.equal(child?.parent_id, parentIssueId);
      assert.equal(child?.assignee_id, agentIdFor('backend-engineer'));
      assert.match(String(child?.description), /Acceptance criteria/);
   });

   test('delegate_to_agent outside the graph is refused and creates nothing', async () => {
      await assert.rejects(
         tool('delegate_to_agent').run(contextFor('backend-engineer', parentIssueId), {
            role: 'engineering-manager', title: 'Nope', description: '', acceptanceCriteria: ['x'],
         }),
         /cannot hand work to engineering-manager/
      );
      const rows = await sql`SELECT 1 FROM issues WHERE title = 'Nope'`;
      assert.equal(rows.length, 0);
   });

   test('escalate to a person blocks the task and opens an escalation approval', async () => {
      await sql`UPDATE issues SET status = 'in_progress' WHERE id = ${parentIssueId}`;
      const result = await tool('escalate').run(contextFor('sre', parentIssueId), {
         to: 'human', decision: 'operational', question: 'Roll back?', options: ['Roll back', 'Hotfix'], recommendation: 'Roll back',
      });
      assert.equal(result.ok, true);
      const [issue] = await sql`SELECT status FROM issues WHERE id = ${parentIssueId}`;
      assert.equal(issue?.status, 'blocked');
      const [approval] = await sql`SELECT kind, status FROM approvals WHERE issue_id = ${parentIssueId} AND kind = 'escalation'`;
      assert.equal(approval?.status, 'pending');
   });

   test('escalating a task the board cannot block reports blocked: false and creates the approval anyway', async () => {
      const { issue } = await issues.create({
         boardId: fixture.boardId,
         title: 'Backlog task',
         description: '',
         status: 'backlog',
         priority: 'medium',
         sortOrder: 0,
         dueDate: null,
         assignee: { type: 'agent', id: agentIdFor('sre') },
         project: null,
         createdBy: fixture.userId,
      });
      const result = await tool('escalate').run(contextFor('sre', issue.id), {
         to: 'human', decision: 'operational', question: 'Roll back?', options: [], recommendation: '',
      });
      assert.equal(result.ok, true);
      assert.equal((result as { ok: true; result: { blocked: boolean } }).result.blocked, false);
      const [row] = await sql`SELECT status FROM issues WHERE id = ${issue.id}`;
      assert.equal(row?.status, 'backlog');
      const [approval] = await sql`SELECT status FROM approvals WHERE issue_id = ${issue.id} AND kind = 'escalation'`;
      assert.equal(approval?.status, 'pending');
   });

   describe('submit_review', () => {
      /** A task in review whose backend engineer's run delivered a pull request. */
      async function deliveredByBackend(
         title: string,
         files = ['src/a.ts'],
         autoGate = true
      ): Promise<{ issueId: string; runId: string }> {
         const authorId = agentIdFor('backend-engineer');
         const { issue } = await issues.create({
            boardId: fixture.boardId,
            title,
            description: '',
            status: 'todo',
            priority: 'medium',
            sortOrder: 0,
            dueDate: null,
            assignee: { type: 'agent', id: authorId },
            project: null,
            createdBy: fixture.userId,
         });
         // Agent reviews happen only on tasks that opted into AutoGate.
         await sql`UPDATE issues SET auto_gate = ${autoGate} WHERE id = ${issue.id}`;
         const run = await new RunRepository(sql).admit({
            issueId: issue.id, boardId: fixture.boardId, workspaceId: fixture.workspaceId,
            agentId: authorId, requestedBy: fixture.userId, instructions: null,
         });
         const ledger = new RunLedger({ sql });
         await ledger.claimDispatch(run.id);
         await ledger.markRunning(run.id);
         await ledger.appendDelivered(run.id, {
            committed: true, commit: 'abc', branch: 'backend/x', filesChanged: 1, insertions: 1, deletions: 0,
            files, pullRequest: { number: 9, url: 'https://github.com/berry/x/pull/9', created: true },
            mergeRequiresApproval: true,
         });
         await ledger.completeSuccess({
            runId: run.id, summary: 'Done.',
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, costMicros: null, currency: null },
         });
         return { issueId: issue.id, runId: run.id };
      }

      const rejection = {
         approved: false,
         reason: 'The handler has no tests.',
         findings: [{ severity: 'high', path: 'src/a.ts', message: 'No test covers the 201 path' }],
      };

      test('a Level 5 role records a rejection with findings and the task goes back to todo', async () => {
         const { issueId, runId } = await deliveredByBackend('Review me');
         const [before] = await sql`SELECT status::text AS status FROM issues WHERE id = ${issueId}`;
         assert.equal(before?.status, 'in_review');

         const result = await tool('submit_review').run(contextFor('qa-engineer', issueId), rejection);

         assert.equal(result.ok, true);
         const [row] = await sql`
            SELECT reviewer_id, reviewer_role, authority, approved, reason FROM issue_auto_reviews WHERE run_id = ${runId}`;
         assert.equal(row?.reviewer_id, agentIdFor('qa-engineer'));
         assert.equal(row?.reviewer_role, 'qa-engineer');
         assert.equal(row?.authority, 'blocking');
         assert.equal(row?.approved, false);
         const [after] = await sql`SELECT status::text AS status FROM issues WHERE id = ${issueId}`;
         assert.equal(after?.status, 'todo');
         const bodies = await sql`SELECT body FROM comments WHERE issue_id = ${issueId}`;
         assert.ok(bodies.some((comment) => /No test covers the 201 path/.test(comment.body as string)));
      });

      function refusedWith(status: number, code: string) {
         return (error: unknown) => {
            const failure = error as { status?: number; code?: string };
            assert.equal(failure.code, code);
            assert.equal(failure.status, status);
            return true;
         };
      }

      async function reviewRows(runId: string) {
         return sql`
            SELECT reviewer_role, authority, approved, reason, decided_at, attempt
              FROM issue_auto_reviews WHERE run_id = ${runId} ORDER BY reviewer_role`;
      }

      async function statusOf(issueId: string): Promise<string> {
         const [row] = await sql`SELECT status::text AS status FROM issues WHERE id = ${issueId}`;
         return row!.status as string;
      }

      test('a reviewer cannot take back or repeat a recorded verdict', async () => {
         const { issueId, runId } = await deliveredByBackend('Review once');
         await tool('submit_review').run(contextFor('qa-engineer', issueId), rejection);
         assert.equal(await statusOf(issueId), 'todo');
         const [before] = await reviewRows(runId);

         await assert.rejects(
            tool('submit_review').run(contextFor('qa-engineer', issueId), { approved: true, reason: 'Actually fine.' }),
            refusedWith(409, 'ALREADY_REVIEWED')
         );

         const after = await reviewRows(runId);
         assert.equal(after.length, 1);
         assert.deepEqual(after[0], before, 'the rejection row is unchanged');
         const [attempts] = await sql`
            SELECT count(DISTINCT run_id)::int AS n FROM issue_auto_reviews
             WHERE issue_id = ${issueId} AND approved = false AND authority = 'blocking'`;
         assert.equal(attempts!.n, 1);
      });

      test('a task without AutoGate takes no agent verdict: a person reviews it', async () => {
         const { issueId, runId } = await deliveredByBackend('Manual review only', ['src/a.ts'], false);
         await assert.rejects(
            tool('submit_review').run(contextFor('qa-engineer', issueId), rejection),
            refusedWith(409, 'NOT_GATED')
         );
         assert.equal((await reviewRows(runId)).length, 0);
         assert.equal(await statusOf(issueId), 'in_review');
      });

      test('a Level 5 role the run does not require cannot review it', async () => {
         const { issueId, runId } = await deliveredByBackend('Not the architect\'s');
         await assert.rejects(
            tool('submit_review').run(contextFor('software-architect', issueId), rejection),
            refusedWith(403, 'NOT_REQUIRED_REVIEWER')
         );
         assert.equal((await reviewRows(runId)).length, 0);
         assert.equal(await statusOf(issueId), 'in_review');
      });

      test('an advisory reviewer\'s rejection is a comment, not a send-back', async () => {
         // The Database Engineer is advisory on migrations. It is Level 3, so
         // submit_review refuses it as NOT_A_REVIEWER before the domain check;
         // the gate's own rule for advisory verdicts is exercised directly.
         const { issueId, runId } = await deliveredByBackend('Migration', ['server-ts/migrations/187_x.up.sql']);
         await gate.recordVerdict({
            runId,
            reviewerId: agentIdFor('database-engineer'),
            reviewerRole: 'database-engineer',
            verdict: { approved: false, reason: 'Add an index.', findings: [{ severity: 'low', path: null, message: 'Missing index on run_id' }] },
         });

         const found = (await reviewRows(runId)).find((row) => row.reviewer_role === 'database-engineer');
         assert.equal(found?.authority, 'advisory');
         assert.equal(found?.approved, false);
         assert.equal(await statusOf(issueId), 'in_review');
         const bodies = await sql`SELECT body FROM comments WHERE issue_id = ${issueId}`;
         assert.ok(bodies.some((comment) => /Missing index on run_id/.test(comment.body as string)));
      });

      test('a Security review needs exploitability, impact and remediation', async () => {
         const { issueId, runId } = await deliveredByBackend('Auth change', ['server-ts/src/auth/x.ts']);
         await assert.rejects(
            tool('submit_review').run(contextFor('security-engineer', issueId), rejection),
            refusedWith(400, 'INVALID_REQUEST')
         );
         assert.equal((await reviewRows(runId)).length, 0);

         const result = await tool('submit_review').run(contextFor('security-engineer', issueId), {
            approved: false,
            reason: 'Sessions are not rotated.',
            findings: [{
               severity: 'critical', exploitability: 'likely', impact: 'Session fixation',
               remediation: 'Rotate on sign-in', path: 'server-ts/src/auth/x.ts', message: 'No rotation',
            }],
         });
         assert.equal(result.ok, true);
         const found = (await reviewRows(runId)).find((row) => row.reviewer_role === 'security-engineer');
         assert.equal(found?.approved, false);
         assert.match(String(found?.reason), /high/, 'critical is normalised to high');
         assert.match(String(found?.reason), /exploitability: likely/);
         assert.match(String(found?.reason), /Rotate on sign-in/);
         assert.equal(await statusOf(issueId), 'todo');
      });

      test('the last required approval says the reviews passed and leaves the task for a person', async () => {
         const { issueId } = await deliveredByBackend('Auth approved', ['server-ts/src/auth/x.ts']);
         await tool('submit_review').run(contextFor('qa-engineer', issueId), { approved: true, reason: 'Tested.' });
         let bodies = await sql`SELECT body FROM comments WHERE issue_id = ${issueId}`;
         assert.ok(!bodies.some((comment) => /Required reviews passed/.test(comment.body as string)), 'Security has not reviewed yet');

         const approval = {
            approved: true, reason: 'No security concerns.', findings: [],
         };
         await tool('submit_review').run(contextFor('security-engineer', issueId), approval);

         bodies = await sql`SELECT body FROM comments WHERE issue_id = ${issueId}`;
         assert.ok(bodies.some((comment) => /Required reviews passed/.test(comment.body as string)));
         assert.equal(await statusOf(issueId), 'in_review');
      });

      test('the delivered run is reviewed even when the reviewer\'s own run on the task is newer', async () => {
         const { issueId, runId } = await deliveredByBackend('Mentioned before its review');
         // The QA engineer was mentioned on the task, and its own (comment-only)
         // run succeeded after the backend engineer's delivery.
         const ledger = new RunLedger({ sql });
         const qaRun = await new RunRepository(sql).admit({
            issueId, boardId: fixture.boardId, workspaceId: fixture.workspaceId,
            agentId: agentIdFor('qa-engineer'), requestedBy: fixture.userId, instructions: null,
         });
         await ledger.claimDispatch(qaRun.id);
         await ledger.markRunning(qaRun.id);
         await ledger.completeSuccess({
            runId: qaRun.id, summary: 'Answered the question.',
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, costMicros: null, currency: null },
         });
         assert.equal(await statusOf(issueId), 'in_review');

         const result = await tool('submit_review').run(contextFor('qa-engineer', issueId), { approved: true, reason: 'Tested.' });

         assert.equal(result.ok, true);
         const found = await sql`SELECT run_id, reviewer_role, approved FROM issue_auto_reviews WHERE issue_id = ${issueId}`;
         assert.equal(found.length, 1);
         assert.equal(found[0]!.run_id, runId, 'the verdict is on the delivered run');
         assert.equal(found[0]!.reviewer_role, 'qa-engineer');
         assert.equal(found[0]!.approved, true);
      });

      test('a Level 2 role has no review authority', async () => {
         const { issueId, runId } = await deliveredByBackend('Not yours to review');
         await assert.rejects(
            tool('submit_review').run(contextFor('business-analyst', issueId), rejection),
            (error: unknown) => (error as { status?: number; code?: string }).status === 403 &&
               (error as { code?: string }).code === 'NOT_A_REVIEWER'
         );
         const found = await sql`SELECT 1 FROM issue_auto_reviews WHERE run_id = ${runId}`;
         assert.equal(found.length, 0);
      });

      test('nobody reviews their own run', async () => {
         // The QA engineer delivers, then tries to approve its own work.
         const { issue } = await issues.create({
            boardId: fixture.boardId, title: 'Own work', description: '', status: 'todo', priority: 'medium',
            sortOrder: 0, dueDate: null, assignee: { type: 'agent', id: agentIdFor('qa-engineer') }, project: null,
            createdBy: fixture.userId,
         });
         const run = await new RunRepository(sql).admit({
            issueId: issue.id, boardId: fixture.boardId, workspaceId: fixture.workspaceId,
            agentId: agentIdFor('qa-engineer'), requestedBy: fixture.userId, instructions: null,
         });
         const ledger = new RunLedger({ sql });
         await ledger.claimDispatch(run.id);
         await ledger.markRunning(run.id);
         await ledger.completeSuccess({
            runId: run.id, summary: 'Done.',
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, costMicros: null, currency: null },
         });
         await assert.rejects(
            tool('submit_review').run(contextFor('qa-engineer', issue.id), { approved: true, reason: 'Looks good.' }),
            (error: unknown) => (error as { status?: number }).status === 403 &&
               (error as { code?: string }).code === 'SELF_REVIEW'
         );
      });
   });

   describe('propose_work', () => {
      function proposal(overrides: Partial<ProposalInput> = {}): ProposalInput {
         return {
            problem: 'Something worth fixing.',
            evidence: [{ kind: 'file', ref: 'src/a.ts', excerpt: '' }],
            impact: 'It costs a person time every week.',
            severity: 'critical',
            impactClasses: ['security'],
            proposedAction: 'Fix it.',
            effort: 's',
            dependencies: [],
            responsibleRole: 'qa-engineer',
            requiredReviewers: [],
            ...overrides,
         };
      }

      test('files a proposal, opens a work_proposal approval and labels the task', async () => {
         const result = (await tool('propose_work').run(contextFor('backend-engineer', parentIssueId), proposal({
            problem: 'lodash has a prototype pollution advisory',
            evidence: [{ kind: 'dependency', ref: 'frontend/package.json', excerpt: '"lodash": "4.17.15"' }],
         }))) as { ok: true; result: { proposalId: string; taskId: string; decision: string } };
         assert.equal(result.ok, true);
         assert.equal(result.result.decision, 'needs_decision');

         const [proposalRow] = await sql`SELECT status, approval_id FROM work_proposals WHERE id = ${result.result.proposalId}`;
         assert.equal(proposalRow?.status, 'proposed');
         const [approval] = await sql`SELECT kind, status FROM approvals WHERE id = ${proposalRow?.approval_id}`;
         assert.equal(approval?.kind, 'work_proposal');
         assert.equal(approval?.status, 'pending');
         const labels = await sql`
            SELECT l.name FROM issue_label_memberships m JOIN issue_labels l ON l.id = m.label_id
             WHERE m.issue_id = ${result.result.taskId} ORDER BY l.name`;
         assert.deepEqual(
            labels.map((label) => label.name).sort(),
            ['proposal', catalogRole('backend-engineer')!.department].sort(),
            'the proposal label and the proposing role\'s department label'
         );
      });

      test('an auto-accepted proposal is assigned to its role and starts a run once it commits', async () => {
         // The Security Engineer is Level 5: routine, low-severity work it finds needs no person.
         const result = (await tool('propose_work').run(contextFor('security-engineer', parentIssueId), proposal({
            problem: 'Rotate the stale CI cache key',
            evidence: [{ kind: 'file', ref: '.github/workflows/ci.yml', excerpt: 'key: v1' }],
            severity: 'low',
            impactClasses: ['routine'],
            responsibleRole: 'backend-engineer',
         }))) as { ok: true; result: { taskId: string; decision: string; runId: string | null } };
         assert.equal(result.ok, true);
         assert.equal(result.result.decision, 'auto_accept');

         const [task] = await sql`SELECT assignee_id FROM issues WHERE id = ${result.result.taskId}`;
         assert.equal(task?.assignee_id, agentIdFor('backend-engineer'));
         const runs = await sql`SELECT id, agent_id FROM runs WHERE issue_id = ${result.result.taskId}`;
         assert.equal(runs.length, 1, 'the accepted task has a run');
         assert.equal(runs[0]!.agent_id, agentIdFor('backend-engineer'));
         assert.equal(result.result.runId, runs[0]!.id);
      });

      test('a maximal proposal fits its approval, and the task keeps the whole text', async () => {
         const evidence = Array.from({ length: 20 }, (_, i) => ({
            kind: 'file' as const,
            ref: `src/maximal-${i}.ts`.padEnd(1000, 'x'),
            excerpt: 'e'.repeat(2000),
         }));
         const result = (await tool('propose_work').run(contextFor('backend-engineer', parentIssueId), proposal({
            problem: 'Maximal finding '.padEnd(4000, 'p'),
            evidence,
            impact: 'i'.repeat(4000),
            proposedAction: 'a'.repeat(4000),
            dependencies: Array.from({ length: 20 }, (_, i) => `dependency ${i} `.padEnd(500, 'd')),
         }))) as { ok: true; result: { taskId: string; decision: string } };
         assert.equal(result.ok, true);
         assert.equal(result.result.decision, 'needs_decision');

         const [approval] = await sql`
            SELECT char_length(description)::int AS n, description FROM approvals
             WHERE issue_id = ${result.result.taskId} AND kind = 'work_proposal'`;
         assert.ok(Number(approval!.n) <= 20000, `approval description is ${approval!.n} characters`);
         assert.match(String(approval!.description), /The full proposal is on the task\.$/);
         const [task] = await sql`SELECT char_length(description)::int AS n, description FROM issues WHERE id = ${result.result.taskId}`;
         assert.ok(Number(task!.n) > 20000, 'the task carries the full proposal');
         assert.match(String(task!.description), /dependency 19 d+/);
      });

      test('a duplicate fingerprint returns the existing proposal without creating a second', async () => {
         const input = proposal({ problem: 'Duplicate finding', evidence: [{ kind: 'file', ref: 'src/dup.ts', excerpt: '' }] });
         const first = (await tool('propose_work').run(contextFor('backend-engineer', parentIssueId), input)) as {
            ok: true; result: { proposalId: string };
         };
         const second = (await tool('propose_work').run(contextFor('backend-engineer', parentIssueId), input)) as {
            ok: true; result: { proposalId: string; duplicate: boolean };
         };
         assert.equal(second.result.proposalId, first.result.proposalId);
         assert.equal(second.result.duplicate, true);
         const rows = await sql`SELECT id FROM work_proposals WHERE fingerprint IS NOT NULL AND id = ${first.result.proposalId}`;
         assert.equal(rows.length, 1);
      });

      test('an unknown responsible role is refused', async () => {
         await assert.rejects(
            tool('propose_work').run(contextFor('backend-engineer', parentIssueId), proposal({
               problem: 'Unknown role finding', responsibleRole: 'no-such-role',
            })),
            /unknown responsible role/
         );
      });

      test('an unknown required reviewer is refused', async () => {
         await assert.rejects(
            tool('propose_work').run(contextFor('backend-engineer', parentIssueId), proposal({
               problem: 'Unknown reviewer finding', requiredReviewers: ['no-such-reviewer'],
            })),
            /unknown reviewer/
         );
      });

      test('a caller with no role contract is refused', async () => {
         const context: AgentToolContext = {
            sql, storage: null, issues, projects: {} as never,
            task: {
               tokenId: 't', runId: randomUUID(), workspaceId: fixture.workspaceId,
               agentId: fixture.agentId, issueId: parentIssueId, boardId: fixture.boardId,
               scopes: ['task:read', 'task:write'],
            },
         };
         await assert.rejects(
            tool('propose_work').run(context, proposal({ problem: 'Not an organization agent' })),
            (error: unknown) => (error as { status?: number; code?: string }).status === 403 &&
               (error as { code?: string }).code === 'NOT_AN_ORGANIZATION_ROLE'
         );
      });

      test('at most 5 proposals per run; a 6th is refused with PROPOSAL_LIMIT', async () => {
         const authorId = agentIdFor('backend-engineer');
         const run = await new RunRepository(sql).admit({
            issueId: parentIssueId, boardId: fixture.boardId, workspaceId: fixture.workspaceId,
            agentId: authorId, requestedBy: fixture.userId, instructions: null,
         });
         const context = contextFor('backend-engineer', parentIssueId, run.id);

         for (let i = 0; i < 5; i += 1) {
            const outcome = await tool('propose_work').run(context, proposal({
               problem: `Run-limit finding ${i}`,
               evidence: [{ kind: 'file', ref: `src/limit-${i}.ts`, excerpt: '' }],
            }));
            assert.equal(outcome.ok, true, `proposal ${i} should be accepted`);
         }

         await assert.rejects(
            tool('propose_work').run(context, proposal({
               problem: 'Run-limit finding 6', evidence: [{ kind: 'file', ref: 'src/limit-6.ts', excerpt: '' }],
            })),
            (error: unknown) => (error as { status?: number; code?: string }).status === 429 &&
               (error as { code?: string }).code === 'PROPOSAL_LIMIT'
         );
      });

      test('two concurrent calls with the same fingerprint leave exactly one proposal, one labelled task, one approval', async () => {
         const input = proposal({
            problem: 'Concurrent finding',
            evidence: [{ kind: 'file', ref: 'src/concurrent.ts', excerpt: '' }],
         });
         const context = contextFor('backend-engineer', parentIssueId);

         const [first, second] = await Promise.all([
            tool('propose_work').run(context, input),
            tool('propose_work').run(context, input),
         ]);
         assert.equal(first.ok, true);
         assert.equal(second.ok, true);
         const results = [first, second].map((outcome) => (outcome as { ok: true; result: { proposalId: string; duplicate?: boolean } }).result);
         const winner = results.find((result) => !result.duplicate);
         const loser = results.find((result) => result.duplicate);
         assert.ok(winner, 'exactly one call created the proposal');
         assert.ok(loser, 'exactly one call found the duplicate');
         assert.equal(loser!.proposalId, winner!.proposalId);

         const fingerprint = fingerprintProposal('backend-engineer', input);
         const rows = await sql`SELECT id, issue_id FROM work_proposals WHERE fingerprint = ${fingerprint}`;
         assert.equal(rows.length, 1, 'exactly one work_proposals row');
         const labels = await sql`
            SELECT 1 FROM issue_label_memberships m JOIN issue_labels l ON l.id = m.label_id
             WHERE m.issue_id = ${rows[0]!.issue_id as string} AND l.name = 'proposal'`;
         assert.equal(labels.length, 1, 'exactly one label membership on the task');
         const approvals = await sql`
            SELECT id FROM approvals WHERE issue_id = ${rows[0]!.issue_id as string} AND kind = 'work_proposal'`;
         assert.ok(approvals.length <= 1, 'at most one work_proposal approval');
      });

      describe('dedupe semantics', () => {
         async function backlogTask(title: string): Promise<string> {
            const { issue } = await issues.create({
               boardId: fixture.boardId, title, description: '', status: 'backlog', priority: 'medium',
               sortOrder: 0, dueDate: null, assignee: null, project: null, createdBy: fixture.userId,
            });
            return issue.id;
         }

         async function seedProposal(
            issueId: string,
            fingerprint: string,
            status: 'accepted' | 'rejected',
            decidedAt: Date
         ): Promise<void> {
            await sql`
               INSERT INTO work_proposals (
                  workspace_id, issue_id, role_key, problem, evidence, impact, severity, impact_classes,
                  proposed_action, effort, responsible_role, fingerprint, status, decided_at
               ) VALUES (
                  ${fixture.workspaceId}, ${issueId}, 'backend-engineer', 'Seeded finding',
                  ${sql.json([{ kind: 'file', ref: 'src/seed.ts', excerpt: '' }] as never)},
                  'impact', 'critical', ${['security']}, 'action', 's', 'qa-engineer',
                  ${fingerprint}, ${status}, ${decidedAt.toISOString()}
               )`;
         }

         test('an accepted proposal whose task is still open blocks a new one, and a closed task unblocks it', async () => {
            const input = proposal({
               problem: 'Dedupe accepted finding',
               evidence: [{ kind: 'file', ref: 'src/dedupe-accepted.ts', excerpt: '' }],
            });
            const fingerprint = fingerprintProposal('backend-engineer', input);
            const issueId = await backlogTask('Dedupe accepted task');
            await sql`UPDATE issues SET status = 'todo' WHERE id = ${issueId}`;
            await seedProposal(issueId, fingerprint, 'accepted', new Date());

            const blocked = (await tool('propose_work').run(contextFor('backend-engineer', parentIssueId), input)) as {
               ok: true; result: { duplicate?: boolean; taskId: string };
            };
            assert.equal(blocked.result.duplicate, true);
            assert.equal(blocked.result.taskId, issueId);

            await sql`UPDATE issues SET status = 'done' WHERE id = ${issueId}`;
            const unblocked = (await tool('propose_work').run(contextFor('backend-engineer', parentIssueId), input)) as {
               ok: true; result: { duplicate?: boolean; taskId: string };
            };
            assert.notEqual(unblocked.result.duplicate, true);
            assert.notEqual(unblocked.result.taskId, issueId);
         });

         test('a proposal rejected just now blocks a re-proposal with the same fingerprint', async () => {
            const input = proposal({
               problem: 'Dedupe rejected finding',
               evidence: [{ kind: 'file', ref: 'src/dedupe-rejected.ts', excerpt: '' }],
            });
            const fingerprint = fingerprintProposal('backend-engineer', input);
            const issueId = await backlogTask('Dedupe rejected task');
            await sql`UPDATE issues SET status = 'cancelled' WHERE id = ${issueId}`;
            await seedProposal(issueId, fingerprint, 'rejected', new Date());

            const blocked = (await tool('propose_work').run(contextFor('backend-engineer', parentIssueId), input)) as {
               ok: true; result: { duplicate?: boolean; taskId: string };
            };
            assert.equal(blocked.result.duplicate, true);
            assert.equal(blocked.result.taskId, issueId);
         });
      });

      test('a failure after the task is created soft-deletes it and leaves no approval or proposal row', async () => {
         const input = proposal({
            problem: 'Compensation finding',
            evidence: [{ kind: 'file', ref: 'src/compensate.ts', excerpt: '' }],
         });
         const fingerprint = fingerprintProposal('backend-engineer', input);
         let createdIssueId: string | null = null;
         toolDeps.onAfterIssueCreated = (issueId: string) => {
            createdIssueId = issueId;
            throw new Error('injected failure after issue creation');
         };
         try {
            await assert.rejects(
               tool('propose_work').run(contextFor('backend-engineer', parentIssueId), input),
               /injected failure after issue creation/
            );
         } finally {
            delete toolDeps.onAfterIssueCreated;
         }
         assert.ok(createdIssueId, 'the task was created before the injected failure');
         const [issue] = await sql`SELECT deleted_at FROM issues WHERE id = ${createdIssueId}`;
         assert.ok(issue?.deleted_at, 'the orphaned task was soft-deleted');
         const proposals = await sql`SELECT id FROM work_proposals WHERE fingerprint = ${fingerprint}`;
         assert.equal(proposals.length, 0, 'no work_proposals row was left behind');
         const approvals = await sql`SELECT id FROM approvals WHERE issue_id = ${createdIssueId}`;
         assert.equal(approvals.length, 0, 'no approval row was left behind');
      });
   });
});
