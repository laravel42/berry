import { randomUUID } from 'node:crypto';
import type { Sql } from '../db/pool.ts';
import type { Run } from '../runs/ledger.ts';
import { onRunTerminal } from '../runs/terminal-hooks.ts';

/**
 * Autopilot facts on the workspace stream.
 *
 * Same envelope as a goal's (core/milestones.ts): no board, so it replays on the
 * workspace stream only, and the aggregate is the autopilot so a detail page
 * can tell whether a frame is about the one it shows.
 */

export const AUTOPILOT_TOPICS = [
   'autopilot.created',
   'autopilot.updated',
   'autopilot.archived',
   'autopilot.run.created',
   'autopilot.run.updated',
   'autopilot.delivery.received',
] as const;

export type AutopilotTopic = (typeof AUTOPILOT_TOPICS)[number];

export async function writeAutopilotEvent(
   tx: Sql,
   input: {
      workspaceId: string;
      topic: AutopilotTopic;
      autopilotId: string;
      payload: Record<string, unknown>;
      occurredAt: string;
   }
): Promise<string> {
   const id = randomUUID();
   const envelope = {
      id,
      type: input.topic,
      occurredAt: input.occurredAt,
      workspaceId: input.workspaceId,
      boardId: null,
      aggregateType: 'autopilot',
      aggregateId: input.autopilotId,
      payload: { autopilotId: input.autopilotId, ...input.payload },
   };
   await tx`
      INSERT INTO outbox_events (
         id, topic, aggregate_type, aggregate_id, workspace_id, board_id,
         payload, occurred_at, available_at
      ) VALUES (
         ${id}, ${input.topic}, 'autopilot', ${input.autopilotId}, ${input.workspaceId}, NULL,
         ${tx.json(envelope as never)}, ${input.occurredAt}, ${input.occurredAt}
      )`;
   return id;
}

/**
 * `autopilot.run.updated` when the agent run behind a Loop run ends, so the
 * Loops list and a Loop's history move on without polling. The run's own
 * events ride board streams; this is the workspace-level fact that a Loop's
 * run finished, with ids and the ledger's status only.
 *
 * After the ledger's commit (a terminal hook), never inside it, and safe to
 * repeat: an idempotent cancel notifies again, and a second frame only asks
 * the page to read once more.
 */
export function registerLoopRunUpdates(deps: { sql: Sql; clock?: () => Date }): () => void {
   return onRunTerminal(async (run: Run) => {
      const [row] = await deps.sql`
         SELECT id, workspace_id, autopilot_id FROM autopilot_runs WHERE run_id = ${run.id}`;
      if (!row) return;
      await writeAutopilotEvent(deps.sql, {
         workspaceId: row.workspace_id as string,
         topic: 'autopilot.run.updated',
         autopilotId: row.autopilot_id as string,
         payload: { autopilotRunId: row.id as string, runId: run.id, taskStatus: run.status },
         occurredAt: (deps.clock ?? (() => new Date()))().toISOString(),
      });
   });
}
