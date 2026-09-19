import { randomUUID } from 'node:crypto';
import type { Queryable } from '../db/pool.ts';
import type { ApprovalRisk } from './repository.ts';

/**
 * Puts a newly opened approval into every addressee's inbox.
 *
 * Role-addressed gates go to everyone who holds that role or a stronger one
 * (and for high risk, at least an admin), matching who `ApprovalRepository`
 * would let resolve them. Personally addressed gates go only to that person.
 * The outbox row is the source event so a retried notify is a no-op, and so
 * the workspace stream can refresh the inbox.
 */
export async function notifyApprovalRequested(
   q: Queryable,
   input: {
      workspaceId: string;
      approvalId: string;
      issueId: string | null;
      title: string;
      body: string | null;
      risk: ApprovalRisk;
      requestedFromUserId: string | null;
      requestedFromRole: string | null;
      /** Column spelling (`work_proposal`, `escalation`, `issue_start`, …). */
      kind: string;
      actor: { type: 'user' | 'agent'; id: string } | null;
   }
): Promise<number> {
   const eventId = randomUUID();
   const occurredAt = new Date().toISOString();
   const title = [...input.title].slice(0, 500).join('') || 'Decision needed';
   const body = input.body === null ? null : [...input.body].slice(0, 5000).join('');
   const severity =
      input.risk === 'high' ? 'critical' : input.risk === 'medium' ? 'warning' : 'info';
   const roleFloor = seniorityOf(input.requestedFromRole ?? 'admin');
   const riskFloor = input.risk === 'high' ? 2 : 0;
   const floor = Math.max(roleFloor, riskFloor);

   const envelope = {
      id: eventId,
      type: 'approval.requested',
      occurredAt,
      workspaceId: input.workspaceId,
      boardId: null,
      aggregateType: 'approval',
      aggregateId: input.approvalId,
      payload: {
         approvalId: input.approvalId,
         issueId: input.issueId,
         ...(input.actor ? { actor: input.actor } : {}),
      },
   };

   await q`
      INSERT INTO outbox_events (
         id, topic, aggregate_type, aggregate_id, workspace_id, board_id,
         payload, occurred_at, available_at
      ) VALUES (
         ${eventId}, 'approval.requested', 'approval', ${input.approvalId},
         ${input.workspaceId}, NULL,
         ${q.json(envelope as never)}, ${occurredAt}, ${occurredAt}
      )`;

   const result = await q`
      INSERT INTO inbox_items (
         workspace_id, recipient_id, source_event_id, event_type, category,
         severity, issue_id, approval_id, actor_type, actor_id, title, body,
         details
      )
      SELECT ${input.workspaceId}, recipient.user_id, ${eventId}, 'approval.requested',
             'approvals', ${severity}, ${input.issueId}, ${input.approvalId},
             ${input.actor?.type ?? null}, ${input.actor?.id ?? null},
             ${title}, ${body}, ${q.json({ kind: input.kind } as never)}
        FROM (
           SELECT member.user_id
             FROM workspace_memberships AS member
            WHERE member.workspace_id = ${input.workspaceId}
              AND (
                 (${input.requestedFromUserId}::uuid IS NOT NULL
                  AND member.user_id = ${input.requestedFromUserId}::uuid)
                 OR (${input.requestedFromUserId}::uuid IS NULL
                     AND CASE member.role
                            WHEN 'owner' THEN 3 WHEN 'admin' THEN 2
                            WHEN 'member' THEN 1 WHEN 'viewer' THEN 0
                            ELSE 0
                         END >= ${floor})
              )
        ) AS recipient
       WHERE COALESCE((
            SELECT (preference.preferences -> 'inApp' ->> 'approvals')::boolean
              FROM notification_preferences AS preference
             WHERE preference.workspace_id = ${input.workspaceId}
               AND preference.user_id = recipient.user_id
         ), true)
      ON CONFLICT (recipient_id, source_event_id) WHERE source_event_id IS NOT NULL DO NOTHING`;

   return result.count;
}

/**
 * Projects pending approvals this person can decide into their inbox when the
 * row was never written (gates opened before approvals landed in Inbox, or a
 * notify that did not reach them). Idempotent: an existing row for the same
 * approval is left alone, including one they already archived.
 */
export async function backfillPendingApprovals(
   q: Queryable,
   input: { workspaceId: string; recipientId: string }
): Promise<number> {
   const result = await q`
      INSERT INTO inbox_items (
         workspace_id, recipient_id, event_type, category, severity,
         issue_id, approval_id, actor_type, actor_id, title, body, details,
         created_at
      )
      SELECT approval.workspace_id, ${input.recipientId}, 'approval.requested', 'approvals',
             CASE approval.risk
                WHEN 'high' THEN 'critical'
                WHEN 'medium' THEN 'warning'
                ELSE 'info'
             END,
             approval.issue_id, approval.id,
             CASE WHEN approval.requested_by_type IN ('user', 'agent')
                  THEN approval.requested_by_type ELSE NULL END,
             CASE WHEN approval.requested_by_type IN ('user', 'agent')
                  THEN approval.requested_by ELSE NULL END,
             left(approval.title, 500),
             CASE WHEN approval.description IS NULL THEN NULL
                  ELSE left(approval.description, 5000) END,
             jsonb_build_object('kind', approval.kind),
             approval.requested_at
        FROM approvals AS approval
        JOIN workspace_memberships AS member
          ON member.workspace_id = approval.workspace_id
         AND member.user_id = ${input.recipientId}
       WHERE approval.workspace_id = ${input.workspaceId}
         AND approval.status = 'pending'
         AND (
               approval.requested_from_user_id = ${input.recipientId}
            OR (approval.requested_from_user_id IS NULL
                AND CASE member.role
                       WHEN 'owner' THEN 3 WHEN 'admin' THEN 2
                       WHEN 'member' THEN 1 WHEN 'viewer' THEN 0
                       ELSE 0
                    END >= GREATEST(
                       CASE approval.requested_from_role
                          WHEN 'owner' THEN 3 WHEN 'admin' THEN 2
                          WHEN 'member' THEN 1 WHEN 'viewer' THEN 0
                          ELSE 2
                       END,
                       CASE WHEN approval.risk = 'high' THEN 2 ELSE 0 END))
         )
         AND NOT EXISTS (
            SELECT 1 FROM inbox_items AS item
             WHERE item.recipient_id = ${input.recipientId}
               AND item.approval_id = approval.id
         )
         AND COALESCE((
            SELECT (preference.preferences -> 'inApp' ->> 'approvals')::boolean
              FROM notification_preferences AS preference
             WHERE preference.workspace_id = ${input.workspaceId}
               AND preference.user_id = ${input.recipientId}
         ), true)`;
   return result.count;
}

function seniorityOf(role: string | null | undefined): number {
   if (role === 'owner') return 3;
   if (role === 'admin') return 2;
   if (role === 'member') return 1;
   if (role === 'viewer') return 0;
   return 2;
}
