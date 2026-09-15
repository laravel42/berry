import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import {
   normaliseSecurityVerdict,
   ReviewRefused,
   SECURITY_VERDICT,
   type ReviewGate,
   type SubmittedVerdict,
} from '../agents/review-gate.ts';
import { InvalidTransition, type IssueRepository } from '../core/issues.ts';
import { withinTx, type Sql } from '../db/pool.ts';
import { ApiError } from '../http/errors.ts';
import { enqueueTask } from '../runs/queue.ts';
import { getAgentTool, registerAgentTool, type AgentToolContext } from '../runtime/agent-tools/registry.ts';
import { defaultBoardId } from '../work/batch.ts';
import { setParent } from '../work/hierarchy.ts';
import { callerContract, canDelegate, roleAgent } from './delegation.ts';
import { MAX_PROPOSALS_PER_RUN } from './discovery.ts';
import { acceptDecision, fingerprintProposal, proposalSchema, type ProposalInput } from './proposals.ts';

/**
 * The tools every organization role gets: handing work to another role along
 * the delegation graph, and stopping to ask for a decision nobody on this
 * task owns. Both refuse a caller with no contract — an agent outside the
 * organization has neither a delegation graph nor an escalation path.
 */

export interface OrganizationToolDeps {
   sql: Sql;
   issues: IssueRepository;
   /** Records `submit_review` verdicts; null where the deployment cannot run reviews. */
   gate?: Pick<ReviewGate, 'recordVerdict'> | null;
   /**
    * Test seam only: called right after `propose_work` creates its task, before
    * the label, approval and `work_proposals` writes. Throwing here exercises
    * the compensation path (the task is soft-deleted, and no approval or
    * proposal row is left behind) without needing a real failure injection.
    */
   onAfterIssueCreated?: (issueId: string) => Promise<void> | void;
}

/** The plain review every role except Security submits. */
const PLAIN_VERDICT = z.object({
   approved: z.boolean(),
   reason: z.string(),
   findings: z.array(z.object({
      severity: z.enum(['high', 'medium', 'low']),
      path: z.string().nullable().optional(),
      message: z.string(),
   })).default([]),
});

function issueOf(context: AgentToolContext): string {
   if (!context.task.issueId) throw ApiError.badRequest('this task is not on an issue');
   return context.task.issueId;
}

async function requireContract(context: AgentToolContext) {
   const contract = await callerContract(context.sql, context.task.agentId);
   if (!contract) throw new ApiError(403, 'NOT_AN_ORGANIZATION_ROLE', 'only an organization role can use this tool');
   return contract;
}

async function parentOf(context: AgentToolContext, issueId: string) {
   const [row] = await context.sql<Array<{ board_id: string; priority: string; requested_by: string | null }>>`
      SELECT i.board_id, i.priority, COALESCE(r.requested_by, i.created_by) AS requested_by
        FROM issues i LEFT JOIN runs r ON r.id = ${context.task.runId}
       WHERE i.id = ${issueId}`;
   if (!row) throw ApiError.notFound('Task');
   return row;
}

export function registerOrganizationTools(deps: OrganizationToolDeps): void {
   if (getAgentTool('delegate_to_agent')) return;

   registerAgentTool('delegate_to_agent', {
      description:
         'Hand a piece of this task to another role in the organization, as a sub-task with acceptance criteria. ' +
         'Only along your delegation list.',
      scope: 'task:write',
      inputSchema: z.object({
         role: z.string().regex(/^[a-z][a-z0-9-]{1,48}$/),
         title: z.string().trim().min(1).max(500),
         description: z.string().max(20_000).default(''),
         acceptanceCriteria: z.array(z.string().trim().min(1).max(1000)).min(1).max(20),
      }),
      handler: async (context, input) => {
         const caller = await requireContract(context);
         const target = await roleAgent(context.sql, context.task.workspaceId, input.role);
         if (!target) throw ApiError.notFound('Role');
         if (!canDelegate(caller, target.contract)) {
            throw new ApiError(403, 'DELEGATION_NOT_ALLOWED', `${caller.id} cannot hand work to ${input.role}`);
         }
         const parentId = issueOf(context);
         const parent = await parentOf(context, parentId);
         const description = [
            input.description.trim(),
            `Acceptance criteria:\n${input.acceptanceCriteria.map((line) => `- ${line}`).join('\n')}`,
            `Delegated by ${caller.name}.`,
         ].filter(Boolean).join('\n\n');
         const { issue } = await deps.issues.create({
            boardId: parent.board_id,
            title: input.title,
            description,
            status: 'todo',
            priority: parent.priority,
            sortOrder: 0,
            dueDate: null,
            assignee: { type: 'agent', id: target.id },
            project: null,
            createdBy: parent.requested_by,
         });
         await setParent(context.sql, { workspaceId: context.task.workspaceId, issueId: issue.id, parentId, stage: null });
         let runId: string | null = null;
         try {
            ({ runId } = await enqueueTask(context.sql, {
               workspaceId: context.task.workspaceId,
               agentId: target.id,
               issueId: issue.id,
               kind: 'agent',
               source: 'assignment',
               ...(parent.requested_by ? { requestedBy: parent.requested_by } : {}),
            }));
         } catch {
            // Assigned but not started (e.g. the runtime refuses): the task is visible and can be started.
         }
         return { id: issue.id, identifier: issue.identifier, assignedTo: input.role, runId };
      },
   });

   registerAgentTool('escalate', {
      description:
         'Stop and ask for a decision you do not own: to the CTO (technical), the Product Lead (product) or a person. ' +
         'Blocks this task until it is answered.',
      scope: 'task:write',
      inputSchema: z.object({
         to: z.enum(['cto', 'product-lead', 'human']),
         decision: z.enum(['product', 'technical', 'security', 'operational']),
         question: z.string().trim().min(1).max(4000),
         options: z.array(z.string().trim().min(1).max(1000)).max(6).default([]),
         recommendation: z.string().max(4000).default(''),
      }),
      handler: async (context, input) => {
         const caller = await requireContract(context);
         const issueId = issueOf(context);
         const parent = await parentOf(context, issueId);
         // "an operational decision", "a product decision": the article
         // follows the word, and this sentence opens every escalation card.
         const article = /^[aeiou]/i.test(input.decision) ? 'an' : 'a';
         const body = [
            `${caller.name} needs ${article} ${input.decision} decision.`,
            input.question,
            input.options.length ? `Options:\n${input.options.map((option) => `- ${option}`).join('\n')}` : '',
            input.recommendation ? `Recommendation: ${input.recommendation}` : '',
         ].filter(Boolean).join('\n\n');

         let reference: { approvalId?: string; taskId?: string };
         if (input.to === 'human') {
            const approvalId = randomUUID();
            await context.sql`
               INSERT INTO approvals (id, workspace_id, kind, risk, title, description, issue_id,
                                      requested_from_role, requested_by_type, requested_by, status)
               VALUES (${approvalId}, ${context.task.workspaceId}, 'escalation',
                       ${input.decision === 'security' ? 'high' : 'medium'},
                       ${`Decision needed: ${input.question.slice(0, 200)}`}, ${body}, ${issueId},
                       'admin', 'agent', ${context.task.agentId}, 'pending')`;
            reference = { approvalId };
         } else {
            const owner = await roleAgent(context.sql, context.task.workspaceId, input.to);
            if (!owner) throw ApiError.notFound('Role');
            const { issue } = await deps.issues.create({
               boardId: parent.board_id,
               title: `Decision: ${input.question.slice(0, 200)}`,
               description: body,
               status: 'todo',
               priority: 'high',
               sortOrder: 0,
               dueDate: null,
               assignee: { type: 'agent', id: owner.id },
               project: null,
               createdBy: parent.requested_by,
            });
            await setParent(context.sql, { workspaceId: context.task.workspaceId, issueId: issue.id, parentId: issueId, stage: null });
            reference = { taskId: issue.id };
         }
         try {
            await deps.issues.update({
               issueId,
               patch: { status: 'blocked', descriptionSet: false, dueDateSet: false, assigneeSet: false, projectSet: false },
               actorId: context.task.agentId,
               actorType: 'agent',
            });
         } catch (error) {
            if (!(error instanceof InvalidTransition)) throw error;
            // The board's rules do not allow this status to become blocked
            // (e.g. backlog): the task is left where it is, and the read-back
            // below reports the true state rather than a wish.
         }
         const [after] = await context.sql<Array<{ status: string }>>`SELECT status::text AS status FROM issues WHERE id = ${issueId}`;
         return { escalatedTo: input.to, blocked: after?.status === 'blocked', ...reference };
      },
   });

   registerAgentTool('submit_review', {
      description:
         'Record your blocking review of the latest delivered run on this task, within your review domains. ' +
         'A rejection needs findings with evidence.',
      scope: 'task:write',
      // Wide enough to carry a Security finding; the handler holds each role to its own schema.
      inputSchema: z.object({
         approved: z.boolean(),
         reason: z.string().trim().min(1).max(4000),
         findings: z.array(z.object({
            severity: z.enum(['critical', 'high', 'medium', 'low']),
            exploitability: z.enum(['proven', 'likely', 'possible', 'unlikely']).optional(),
            impact: z.string().max(2000).optional(),
            remediation: z.string().max(2000).optional(),
            path: z.string().nullable().optional(),
            message: z.string().min(1).max(2000),
         })).max(50).default([]),
      }),
      handler: async (context, input) => {
         const caller = await requireContract(context);
         if (caller.autonomy_level !== 5) throw new ApiError(403, 'NOT_A_REVIEWER', `${caller.name} has no review authority`);
         if (!deps.gate) throw new ApiError(412, 'REVIEWER_UNAVAILABLE', 'this deployment cannot run reviews');
         if (!input.approved && input.findings.length === 0) throw ApiError.badRequest('a rejection needs findings');

         let verdict: SubmittedVerdict;
         if (caller.id === 'security-engineer') {
            const parsed = SECURITY_VERDICT.safeParse(input);
            if (!parsed.success) {
               throw ApiError.badRequest('a security finding needs severity, exploitability, impact and remediation', parsed.error.issues);
            }
            verdict = normaliseSecurityVerdict(parsed.data);
         } else {
            const parsed = PLAIN_VERDICT.safeParse(input);
            if (!parsed.success) throw ApiError.badRequest('a finding needs a severity of high, medium or low', parsed.error.issues);
            verdict = parsed.data;
         }

         const issueId = issueOf(context);
         // The delivered run: someone else's, with a pull request. The newest
         // succeeded run on the task may be the reviewer's own earlier run or a
         // comment-only run by another role, and neither is what is under review.
         // The pull request is read where the gate reads it: the run's delivery
         // event, or the column the delivery path and the SCM webhook write.
         const [run] = await context.sql<Array<{ id: string; agent_id: string }>>`
            SELECT id, agent_id FROM runs
             WHERE issue_id = ${issueId} AND status = 'succeeded'
               AND agent_id <> ${context.task.agentId}
               AND (pull_request_number IS NOT NULL OR EXISTS (
                      SELECT 1 FROM run_events AS event
                       WHERE event.run_id = runs.id AND event.event_type = 'run.delivered'
                         AND event.payload->'pullRequest'->>'number' IS NOT NULL))
             ORDER BY completed_at DESC NULLS LAST, created_at DESC LIMIT 1`;
         if (!run) {
            const [own] = await context.sql`
               SELECT 1 FROM runs WHERE issue_id = ${issueId} AND status = 'succeeded' AND agent_id = ${context.task.agentId} LIMIT 1`;
            if (own) throw new ApiError(403, 'SELF_REVIEW', 'you cannot review your own run');
            throw ApiError.notFound('Delivered run');
         }
         try {
            await deps.gate.recordVerdict({ runId: run.id, reviewerId: context.task.agentId, reviewerRole: caller.id, verdict });
         } catch (error) {
            if (error instanceof ReviewRefused) {
               throw new ApiError(error.code === 'NOT_REQUIRED_REVIEWER' ? 403 : 409, error.code, error.message);
            }
            throw error;
         }
         return { recorded: true, approved: verdict.approved };
      },
   });

   registerAgentTool('propose_work', {
      description:
         'File worthwhile work you discovered, with evidence, impact, severity, effort, dependencies, the responsible role ' +
         'and required reviewers. Work with product, security, architectural, financial or operational impact waits for a person.',
      scope: 'task:write',
      inputSchema: proposalSchema,
      handler: async (context, input) => {
         const caller = await requireContract(context);
         const workspaceId = context.task.workspaceId;
         const owner = await roleAgent(context.sql, workspaceId, input.responsibleRole);
         if (!owner) throw ApiError.badRequest(`unknown responsible role ${input.responsibleRole}`);
         for (const reviewer of input.requiredReviewers) {
            if (!(await roleAgent(context.sql, workspaceId, reviewer))) throw ApiError.badRequest(`unknown reviewer ${reviewer}`);
         }

         const fingerprint = fingerprintProposal(caller.id, input);

         // Everything from here runs under one advisory lock keyed on the
         // fingerprint: two concurrent proposals with the same fingerprint
         // must not both pass the duplicate check. `deps.issues.create`
         // still opens its own transaction (Task 7's pattern), which is why a
         // failure after it needs an explicit compensation below rather than
         // relying on this transaction's rollback.
         let requestedBy = null as string | null;
         const outcome = await withinTx(context.sql, async (tx) => {
            await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`berry.proposal:${workspaceId}:${fingerprint}`}, 0))`;

            // A duplicate is any proposal with the same fingerprint that is
            // still live: proposed, accepted with its task still open, or
            // rejected recently enough that filing it again would just repeat
            // a decision a person made days ago.
            const [duplicate] = await tx<Array<{ id: string; issue_id: string }>>`
               SELECT wp.id, wp.issue_id FROM work_proposals wp
                LEFT JOIN issues i ON i.id = wp.issue_id
               WHERE wp.workspace_id = ${workspaceId} AND wp.fingerprint = ${fingerprint}
                 AND (
                    wp.status = 'proposed'
                    OR (wp.status = 'accepted' AND i.deleted_at IS NULL AND i.status NOT IN ('done', 'cancelled'))
                    OR (wp.status = 'rejected' AND wp.decided_at > now() - interval '90 days')
                 )
               ORDER BY wp.created_at DESC
               LIMIT 1`;
            if (duplicate) return { proposalId: duplicate.id, taskId: duplicate.issue_id, duplicate: true };

            const [countRow] = await tx<Array<{ n: number }>>`
               SELECT count(*)::int AS n FROM work_proposals
                WHERE proposed_by = ${context.task.agentId}
                  AND created_at >= (SELECT COALESCE(started_at, created_at) FROM runs WHERE id = ${context.task.runId})`;
            if ((countRow?.n ?? 0) >= MAX_PROPOSALS_PER_RUN) {
               throw new ApiError(429, 'PROPOSAL_LIMIT', `at most ${MAX_PROPOSALS_PER_RUN} proposals per run`);
            }

            const boardId = await defaultBoardId(tx, workspaceId);
            const description = renderProposal(caller.name, input);
            const decision = acceptDecision({ severity: input.severity, impactClasses: input.impactClasses, proposerLevel: caller.autonomy_level });
            const [requester] = await tx<Array<{ requested_by: string | null }>>`SELECT requested_by FROM runs WHERE id = ${context.task.runId}`;
            requestedBy = requester?.requested_by ?? null;
            const { issue } = await deps.issues.create({
               boardId,
               title: input.problem.slice(0, 200),
               description,
               status: decision === 'auto_accept' ? 'todo' : 'backlog',
               priority: input.severity === 'critical' ? 'urgent' : input.severity === 'high' ? 'high' : input.severity === 'medium' ? 'medium' : 'low',
               sortOrder: 0,
               dueDate: null,
               assignee: decision === 'auto_accept' ? { type: 'agent', id: owner.id } : null,
               project: null,
               createdBy: requester?.requested_by ?? null,
            });

            try {
               await deps.onAfterIssueCreated?.(issue.id);
               await labelTask(tx, workspaceId, issue.id, requester?.requested_by ?? null, PROPOSAL_LABEL);
               await labelTask(tx, workspaceId, issue.id, requester?.requested_by ?? null, departmentLabel(caller.department));

               let approvalId: string | null = null;
               if (decision === 'needs_decision') {
                  approvalId = randomUUID();
                  await tx`
                     INSERT INTO approvals (id, workspace_id, kind, risk, title, description, issue_id,
                                            requested_from_role, requested_by_type, requested_by, status)
                     VALUES (${approvalId}, ${workspaceId}, 'work_proposal',
                             ${input.severity === 'critical' || input.severity === 'high' ? 'high' : input.severity === 'medium' ? 'medium' : 'low'},
                             ${`Proposal: ${input.problem.slice(0, 200)}`}, ${approvalDescription(description)}, ${issue.id},
                             'admin', 'agent', ${context.task.agentId}, 'pending')`;
               }
               const [proposal] = await tx<Array<{ id: string }>>`
                  INSERT INTO work_proposals (workspace_id, issue_id, approval_id, proposed_by, role_key, problem, evidence, impact,
                                              severity, impact_classes, proposed_action, effort, dependencies, responsible_role,
                                              required_reviewers, fingerprint, status, decided_at)
                  VALUES (${workspaceId}, ${issue.id}, ${approvalId}, ${context.task.agentId}, ${caller.id}, ${input.problem},
                          ${tx.json(input.evidence as never)}, ${input.impact}, ${input.severity}, ${input.impactClasses},
                          ${input.proposedAction}, ${input.effort}, ${input.dependencies}, ${input.responsibleRole},
                          ${input.requiredReviewers}, ${fingerprint}, ${decision === 'auto_accept' ? 'accepted' : 'proposed'},
                          ${decision === 'auto_accept' ? new Date().toISOString() : null})
                  RETURNING id`;
               return { proposalId: proposal!.id, taskId: issue.id, identifier: issue.identifier, decision };
            } catch (error) {
               // The task was created in its own, already-committed
               // transaction, so this transaction's rollback does not undo
               // it: a losing concurrent call, or any other failure past this
               // point, must not leave an orphaned labelled task behind.
               await deps.issues
                  .remove({ issueId: issue.id, deletedBy: requester?.requested_by ?? context.task.agentId })
                  .catch(() => {});
               throw error;
            }
         });

         // Accepted without a person: start the work once the task and its
         // proposal have committed, exactly as a delegation does. A failure to
         // queue leaves the acceptance standing — the task is assigned and
         // visible, and can be started.
         if (!('decision' in outcome) || outcome.decision !== 'auto_accept') return outcome;
         let runId: string | null = null;
         try {
            ({ runId } = await enqueueTask(context.sql, {
               workspaceId,
               agentId: owner.id,
               issueId: outcome.taskId,
               kind: 'agent',
               source: 'assignment',
               ...(requestedBy ? { requestedBy } : {}),
            }));
         } catch {
            // Assigned but not started (e.g. the runtime refuses).
         }
         return { ...outcome, runId };
      },
   });
}

function renderProposal(proposer: string, input: ProposalInput): string {
   return [
      `**Proposed by ${proposer}.**`,
      `**Problem**\n${input.problem}`,
      `**Evidence**\n${input.evidence.map((item) => `- ${item.kind}: ${item.ref}${item.excerpt ? ` — ${item.excerpt}` : ''}`).join('\n')}`,
      `**Impact** (${input.severity}; ${input.impactClasses.join(', ')})\n${input.impact}`,
      `**Proposed action** (effort ${input.effort})\n${input.proposedAction}`,
      input.dependencies.length ? `**Dependencies**\n${input.dependencies.map((d) => `- ${d}`).join('\n')}` : '',
      `**Responsible role:** ${input.responsibleRole}`,
      input.requiredReviewers.length ? `**Required reviewers:** ${input.requiredReviewers.join(', ')}` : '',
   ].filter(Boolean).join('\n\n');
}

/** `approvals_description_length_ck` allows 20000 characters. The task keeps the whole proposal. */
const MAX_APPROVAL_DESCRIPTION = 20_000;

function approvalDescription(full: string): string {
   if (full.length <= MAX_APPROVAL_DESCRIPTION) return full;
   const note = '\n\n… The full proposal is on the task.';
   let cut = MAX_APPROVAL_DESCRIPTION - note.length;
   // Never split a surrogate pair.
   const last = full.charCodeAt(cut - 1);
   if (last >= 0xd800 && last <= 0xdbff) cut -= 1;
   return full.slice(0, cut) + note;
}

interface TaskLabel {
   name: string;
   description: string;
   color: string;
}

const PROPOSAL_LABEL: TaskLabel = { name: 'proposal', description: 'Work an agent discovered and proposed', color: '#8b5cf6' };

/** The proposing role's department, as a label: the department key, the same in every workspace. */
function departmentLabel(department: string): TaskLabel {
   return { name: department, description: `Work from the ${department} department`, color: '#64748b' };
}

/** A label created once per workspace and put on a task. assigned_by references users, so it is a person or null. */
async function labelTask(sql: Sql, workspaceId: string, issueId: string, userId: string | null, spec: TaskLabel): Promise<void> {
   const [label] = await sql<Array<{ id: string }>>`
      INSERT INTO issue_labels (workspace_id, name, description, color, created_by, created_at, updated_at)
      VALUES (${workspaceId}, ${spec.name}, ${spec.description}, ${spec.color}, ${userId}, now(), now())
      ON CONFLICT (workspace_id, lower(name)) WHERE archived_at IS NULL DO UPDATE SET updated_at = issue_labels.updated_at
      RETURNING id`;
   if (!label) return;
   await sql`
      INSERT INTO issue_label_memberships (workspace_id, issue_id, label_id, assigned_by)
      VALUES (${workspaceId}, ${issueId}, ${label.id}, ${userId})
      ON CONFLICT (workspace_id, issue_id, label_id) DO NOTHING`;
}
