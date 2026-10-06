import type { Sql } from '../db/pool.ts';
import type { IssueMutationEvent, IssueRepository } from '../core/issues.ts';
import { canUseAgent } from './access.ts';
import { parseMentions } from './mentions.ts';
import type { EnqueueTask } from './seams.ts';

/**
 * Which agents a person's comment starts, and starting them exactly once.
 *
 * Rules: only a person's comment triggers (an agent's result comment must not
 * loop); a mentioned live agent of this workspace is a target unless its
 * mention scope refuses the author; a
 * comment with no mentions on an agent-assigned issue goes to the assignee;
 * and each agent is targeted at most once per comment.
 */

export type TriggerReason = 'mention' | 'reply_to_assignee';

export interface TriggerPlan {
   targets: { agentId: string; agentName: string; reason: TriggerReason }[];
   refused: { agentId: string; agentName: string; reason: 'no_access' }[];
}

export interface TriggerInput {
   workspaceId: string;
   issueId: string;
   authorId: string;
   body: string;
}

export async function planCommentTriggers(sql: Sql, input: TriggerInput): Promise<TriggerPlan> {
   const mentions = parseMentions(input.body);
   const candidates: { agentId: string; reason: TriggerReason }[] = [];
   for (const agentId of mentions.agents) candidates.push({ agentId, reason: 'mention' });
   if (mentions.agents.length === 0) {
      const [issue] = await sql`
         SELECT i.assignee_id FROM issues i JOIN boards b ON b.id = i.board_id
          WHERE i.id = ${input.issueId} AND b.workspace_id = ${input.workspaceId}
            AND i.assignee_type = 'agent'`;
      if (issue?.assignee_id) {
         candidates.push({ agentId: issue.assignee_id as string, reason: 'reply_to_assignee' });
      }
   }

   const plan: TriggerPlan = { targets: [], refused: [] };
   const seen = new Set<string>();
   for (const candidate of candidates) {
      if (seen.has(candidate.agentId)) continue;
      seen.add(candidate.agentId);
      const [agent] = await sql`
         SELECT name FROM agents
          WHERE id = ${candidate.agentId} AND workspace_id = ${input.workspaceId} AND archived_at IS NULL`;
      // Not in this workspace, or archived: say nothing about it, not even a refusal.
      if (!agent) continue;
      const allowed = await canUseAgent(sql, {
         workspaceId: input.workspaceId,
         agentId: candidate.agentId,
         userId: input.authorId,
         action: 'mention',
      });
      const agentName = agent.name as string;
      if (allowed) plan.targets.push({ agentId: candidate.agentId, agentName, reason: candidate.reason });
      else plan.refused.push({ agentId: candidate.agentId, agentName, reason: 'no_access' });
   }
   return plan;
}

export async function fireCommentTriggers(
   sql: Sql,
   enqueue: EnqueueTask,
   input: {
      workspaceId: string;
      issueId: string;
      /** Who wrote the comment. What the agent files while answering is theirs. */
      authorId: string;
      commentId: string;
      body: string;
      plan: TriggerPlan;
   }
): Promise<string[]> {
   const runs: string[] = [];
   for (const target of input.plan.targets) {
      const [claimed] = await sql`
         INSERT INTO comment_run_triggers (comment_id, agent_id, workspace_id, reason)
         VALUES (${input.commentId}, ${target.agentId}, ${input.workspaceId}, ${target.reason})
         ON CONFLICT DO NOTHING RETURNING agent_id`;
      if (!claimed) continue;
      // A refuses a second task on an issue that already has one (ActiveRunExists).
      // Release the claim on any failure, so it never records a run that was not
      // queued and a later retry of this comment can still fire.
      const release = async (error: unknown): Promise<never> => {
         await sql`
            DELETE FROM comment_run_triggers
             WHERE comment_id = ${input.commentId} AND agent_id = ${target.agentId}`;
         throw error;
      };
      const intro =
         target.reason === 'reply_to_assignee'
            ? 'A person replied on the issue you are assigned:'
            : 'You were mentioned in a comment on this issue:';
      const { runId } = await enqueue(sql, {
         workspaceId: input.workspaceId,
         agentId: target.agentId,
         issueId: input.issueId,
         kind: 'agent',
         // A's source vocabulary has no reply value; the reason is kept on the row.
         source: 'mention',
         // The commenter is knowable here, so a task the agent files while
         // answering is attributed to them rather than to nobody.
         requestedBy: input.authorId,
         prompt: `${intro}\n\n<comment>\n${input.body.replaceAll('</comment>', '</ comment>')}\n</comment>`,
      }).catch(release);
      await sql`
         UPDATE comment_run_triggers SET run_id = ${runId}
          WHERE comment_id = ${input.commentId} AND agent_id = ${target.agentId}`;
      runs.push(runId);
   }
   return runs;
}

export interface CommentTriggers {
   preview(input: TriggerInput): Promise<TriggerPlan>;
   /** Events from moving a task out of review, for the caller to publish. */
   fire(input: TriggerInput & { commentId: string }): Promise<IssueMutationEvent[]>;
}

/**
 * A comment that sends the assignee back to a task under review is rework.
 * The task leaves review at once, for todo; the run then moves it to in
 * progress when it starts. A mention of someone else is a question and leaves
 * the review where it is.
 */
export async function reopenForRework(
   sql: Sql,
   issues: Pick<IssueRepository, 'update'>,
   input: { issueId: string; authorId: string; plan: TriggerPlan }
): Promise<IssueMutationEvent[]> {
   const [row] = await sql<Array<{ status: string; assignee_type: string | null; assignee_id: string | null }>>`
      SELECT status::text AS status, assignee_type::text AS assignee_type, assignee_id
        FROM issues WHERE id = ${input.issueId} AND deleted_at IS NULL`;
   if (!row || row.status !== 'in_review' || row.assignee_type !== 'agent' || !row.assignee_id) return [];
   if (!input.plan.targets.some((target) => target.agentId === row.assignee_id)) return [];
   const updated = await issues.update({
      issueId: input.issueId,
      patch: { status: 'todo', descriptionSet: false, dueDateSet: false, assigneeSet: false, projectSet: false },
      actorId: input.authorId,
   });
   return updated.events;
}

export function commentTriggers(deps: {
   sql: Sql;
   enqueue: EnqueueTask;
   report: (error: unknown) => void;
   issues?: Pick<IssueRepository, 'update'>;
}): CommentTriggers {
   return {
      preview: (input) => planCommentTriggers(deps.sql, input),
      async fire(input) {
         try {
            const plan = await planCommentTriggers(deps.sql, input);
            const events = deps.issues
               ? await reopenForRework(deps.sql, deps.issues, { ...input, plan }).catch((error: unknown) => {
                    deps.report(error);
                    return [];
                 })
               : [];
            await fireCommentTriggers(deps.sql, deps.enqueue, { ...input, plan });
            return events;
         } catch (error) {
            // The comment is already saved; a failed trigger is reported, not a failed comment.
            deps.report(error);
            return [];
         }
      },
   };
}
