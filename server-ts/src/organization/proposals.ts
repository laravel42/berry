import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import type { Queryable } from '../db/pool.ts';

/**
 * Work an agent discovered on its own and files for a person or the
 * responsible role to pick up, rather than doing itself: `propose_work`
 * validates the shape, `acceptDecision` says whether it needs a person, and
 * `applyProposalDecision` is what a decided `work_proposal` approval does to
 * the task it opened.
 */

export const proposalSchema = z.object({
   problem: z.string().trim().min(1).max(4000),
   evidence: z.array(z.object({
      kind: z.enum(['file', 'run', 'dependency', 'metric', 'task', 'url']),
      ref: z.string().trim().min(1).max(1000),
      excerpt: z.string().max(2000).default(''),
   })).min(1).max(20),
   impact: z.string().trim().min(1).max(4000),
   severity: z.enum(['critical', 'high', 'medium', 'low']),
   impactClasses: z.array(z.enum(['product', 'security', 'architectural', 'financial', 'operational', 'routine'])).min(1).max(6),
   proposedAction: z.string().trim().min(1).max(4000),
   effort: z.enum(['xs', 's', 'm', 'l', 'xl']),
   dependencies: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
   responsibleRole: z.string().regex(/^[a-z][a-z0-9-]{1,48}$/),
   requiredReviewers: z.array(z.string().regex(/^[a-z][a-z0-9-]{1,48}$/)).max(10).default([]),
});

export type ProposalInput = z.infer<typeof proposalSchema>;

export function fingerprintProposal(roleKey: string, input: Pick<ProposalInput, 'problem' | 'evidence'>): string {
   const problem = input.problem.trim().toLowerCase().replace(/\s+/g, ' ');
   const refs = input.evidence.map((item) => item.ref.trim()).sort().join('|');
   return createHash('sha256').update(`${roleKey}\n${problem}\n${refs}`).digest('hex');
}

const SIGNIFICANT = new Set(['product', 'security', 'architectural', 'financial', 'operational']);

export function acceptDecision(input: { severity: string; impactClasses: string[]; proposerLevel: number }): 'auto_accept' | 'needs_decision' {
   if (input.proposerLevel < 4) return 'needs_decision';
   if (input.severity === 'critical' || input.severity === 'high') return 'needs_decision';
   if (input.impactClasses.some((impact) => SIGNIFICANT.has(impact))) return 'needs_decision';
   return input.impactClasses.every((impact) => impact === 'routine') ? 'auto_accept' : 'needs_decision';
}

/**
 * What a decided `work_proposal` approval does to the task it opened.
 *
 * Accept: assigns the responsible role's agent (when one still holds that
 * role) and moves the task to `todo`, only while it is still `backlog` — a
 * task a person already moved on their own is left alone. The assignment is
 * recorded in `assignments`, exactly as `IssueRepository` records one,
 * because this is the only path that assigns a task outside that repository.
 * Reject: cancels the task, same guard. No outbox event, matching the
 * existing `issue_start` resolve path this runs beside.
 *
 * Returns the task an accept released to its role's agent, so the caller can
 * start it once this transaction commits; null otherwise.
 */
export async function applyProposalDecision(
   q: Queryable,
   input: { approvalId: string; decision: 'approved' | 'rejected'; userId: string }
): Promise<string | null> {
   const [proposal] = await q<Array<{ id: string; issue_id: string; workspace_id: string; responsible_role: string }>>`
      SELECT id, issue_id, workspace_id, responsible_role FROM work_proposals
       WHERE approval_id = ${input.approvalId} AND status = 'proposed' FOR UPDATE`;
   if (!proposal) return null;

   if (input.decision === 'rejected') {
      await q`
         UPDATE work_proposals SET status = 'rejected', decided_by = ${input.userId}, decided_at = now(), updated_at = now()
          WHERE id = ${proposal.id}`;
      await q`
         UPDATE issues SET status = 'cancelled'::issue_status, updated_at = now()
          WHERE id = ${proposal.issue_id} AND status = 'backlog'`;
      return null;
   }

   const [owner] = await q<Array<{ id: string }>>`
      SELECT id FROM agents WHERE workspace_id = ${proposal.workspace_id} AND role_key = ${proposal.responsible_role} AND archived_at IS NULL`;

   await q`
      UPDATE work_proposals SET status = 'accepted', decided_by = ${input.userId}, decided_at = now(), updated_at = now()
       WHERE id = ${proposal.id}`;

   const updated = await q<Array<{ id: string }>>`
      UPDATE issues SET
             status = 'todo'::issue_status,
             assignee_type = CASE WHEN ${owner?.id ?? null}::uuid IS NULL THEN assignee_type ELSE 'agent'::assignee_type END,
             assignee_id = COALESCE(${owner?.id ?? null}::uuid, assignee_id),
             updated_at = now()
       WHERE id = ${proposal.issue_id} AND status = 'backlog'
      RETURNING id`;

   if (updated.length > 0 && owner) {
      await q`
         INSERT INTO assignments (id, issue_id, assignee_type, assignee_id, assigned_by, created_at)
         VALUES (${randomUUID()}, ${proposal.issue_id}, 'agent'::assignee_type, ${owner.id}, ${input.userId}, now())`;
      return proposal.issue_id;
   }
   return null;
}
