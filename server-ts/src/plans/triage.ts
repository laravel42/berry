import type { Sql } from '../db/pool.ts';
import { z } from 'zod';
import { WORKFLOWS } from '../organization/catalog.ts';
import { parseContract } from '../organization/contract.ts';
import { CompletionInvalid, type RuntimeCompletion } from '../runtime/completion.ts';
import { patchMetadata } from '../work/metadata.ts';

/**
 * Who does the work a plan just created, and starting it.
 *
 * Compiling a plan wrote tasks nobody is holding. The planner is not asked to
 * name an agent — it describes the capability a task needs and nothing else —
 * so without this step every plan ends the same way: a board of unassigned
 * work that will never move, because a run needs an agent and nothing was
 * going to give it one.
 *
 * Routing is the orchestrator's job (ADR-0008), so the orchestrator agent's
 * own model is what reads the roster and the tasks and decides. It answers
 * with assignments only; it does not get to invent an agent or a task, and
 * anything it names that is not on both lists is dropped rather than trusted.
 */

export interface TriageResult {
   assigned: number;
   started: number;
   /** Tasks the orchestrator declined to route, by title. */
   unassigned: string[];
   /** One message per batch the orchestrator could not answer for. */
   failures: string[];
}

/**
 * How many tasks one routing call carries.
 *
 * A plan of thirty-five tasks used to go to the model as one call, which asked
 * it to write thirty-five id pairs in a single answer — minutes of generation
 * against a shared timeout, and when the timeout won, the run was cancelled with
 * no usage recorded and the whole plan stayed unassigned. Smaller calls each
 * finish well inside the budget, their assignments are committed as they land,
 * and a batch that does fail costs its own tasks rather than every task.
 */
const BATCH = 8;

export class TriageUnavailable extends Error {
   override readonly name = 'TriageUnavailable';
}

interface RosterAgent {
   id: string;
   name: string;
   description: string | null;
   capabilities: string[];
   role: string | null;
   mission: string | null;
   autonomy: number | null;
}

interface TriageTask {
   id: string;
   number: number;
   title: string;
   description: string | null;
   status: string;
   capabilities: string[];
}

/** What a run is told when nobody typed instructions for it. */
function instructionsFor(task: TriageTask): string {
   return task.description?.trim()
      ? `${task.title}\n\n${task.description.trim()}`
      : task.title;
}

const SYSTEM = `You route work to agents in a software workspace.

You are given a roster of agents and a list of tasks. Assign each task to the
one agent best suited to it, judging by the agent's description and what the
task needs. Prefer an agent whose stated purpose matches the task over a
general one.

Assign every task you can. Leave a task out only when no agent on the roster
could plausibly do it — an unassigned task is work nobody will pick up, so
omitting one is a real cost, not a safe default.

The shape of the answer is:

{ "assignments": [ { "taskId": "...", "agentId": "..." } ] }

Use ids exactly as given. Do not invent an id, and do not name an agent or a
task that is not on the lists.

Each agent may carry a role (e.g. "Principal Software Architect"), a mission and an autonomy level.
Choose one of these workflows for each task and assign the task to the FIRST role of that workflow
that exists on the roster:
${WORKFLOWS.map((w) => `- ${w.key}: ${w.chain.join(' → ')} (${w.when})`).join('\n')}
A task answer may name the workflow: { "taskId": "...", "agentId": "...", "workflow": "frontend-visual-bug" }.`;

export interface PlanTriageOptions {
   sql: Sql;
   defaultModel: string;
   /** Runs each call as a completion task on the runtime (ADR-0014). */
   completion: Pick<RuntimeCompletion, 'structured'>;
   timeoutMs?: number;
}

/** What the orchestrator answers with. Only ids on both lists are believed. */
const ASSIGNMENTS = z.object({
   assignments: z
      .array(z.object({ taskId: z.string(), agentId: z.string(), workflow: z.string().optional() }))
      .default([]),
});

export class PlanTriage {
   readonly #sql: Sql;
   readonly #completion: Pick<RuntimeCompletion, 'structured'>;
   readonly #defaultModel: string;
   readonly #timeoutMs: number;

   constructor(options: PlanTriageOptions) {
      this.#sql = options.sql;
      this.#completion = options.completion;
      this.#defaultModel = options.defaultModel;
      // Per batch, not per plan. A batch of eight against a nineteen-agent
      // roster takes some tens of seconds, so 60s left the slower ones being
      // cancelled with nothing to show — the field went from unused to too
      // small in one step.
      this.#timeoutMs = options.timeoutMs ?? 120_000;
   }

   /** The tasks a plan compiled, with the capabilities compile labelled them with. */
   async tasks(planId: string): Promise<TriageTask[]> {
      const rows = await this.#sql<
         Array<{
            id: string;
            number: number;
            title: string;
            description: string | null;
            status: string;
            capabilities: string[] | null;
         }>
      >`
         SELECT i.id, i.number, i.title, i.description, i.status::text AS status,
                array_remove(array_agg(l.name), NULL) AS capabilities
           FROM plan_issues pi
           JOIN issues i ON i.id = pi.issue_id AND i.deleted_at IS NULL
           LEFT JOIN issue_label_memberships m ON m.issue_id = i.id
           LEFT JOIN issue_labels l ON l.id = m.label_id
          WHERE pi.plan_id = ${planId}
            AND i.assignee_id IS NULL
          GROUP BY i.id, i.number, i.title, i.description, i.status
          ORDER BY i.number`;
      return rows.map((row) => ({ ...row, capabilities: row.capabilities ?? [] }));
   }

   /**
    * Who may be given work.
    *
    * The orchestrator is excluded from its own roster: it is the one deciding,
    * and a router that routes to itself is a loop rather than an assignment.
    */
   async roster(workspaceId: string): Promise<RosterAgent[]> {
      const rows = await this.#sql<
         Array<{
            id: string;
            name: string;
            description: string | null;
            capabilities: string[] | null;
            role_key: string | null;
            role_contract: unknown;
         }>
      >`
         SELECT id, name, description, capabilities, role_key, role_contract
           FROM agents
          WHERE workspace_id = ${workspaceId}
            AND archived_at IS NULL
            AND status <> 'offline'
            AND protected = false
          ORDER BY name`;
      return rows.map((row) => {
         const contract = row.role_contract ? parseContract(row.role_contract) : null;
         return {
            id: row.id,
            name: row.name,
            description: row.description,
            capabilities: contract?.capabilities ?? row.capabilities ?? [],
            role: contract?.role ?? null,
            mission: contract?.mission ?? null,
            autonomy: contract?.autonomy_level ?? null,
         };
      });
   }

   /** The orchestrator's own model, or the deployment default. */
   async #model(workspaceId: string): Promise<string> {
      const [row] = await this.#sql<Array<{ model_name: string | null }>>`
         SELECT model_name FROM agents
          WHERE workspace_id = ${workspaceId} AND protected = true AND archived_at IS NULL
          ORDER BY updated_at DESC LIMIT 1`;
      return row?.model_name || this.#defaultModel;
   }

   /** Asks the orchestrator to route, returning only assignments it may make. */
   async #decide(
      workspaceId: string,
      tasks: TriageTask[],
      roster: RosterAgent[],
      signal?: AbortSignal
   ): Promise<Map<string, { agentId: string; workflow: string | null }>> {
      const user = JSON.stringify({
         agents: roster.map((agent) => ({
            id: agent.id,
            name: agent.name,
            description: agent.description ?? '',
            role: agent.role,
            mission: agent.mission,
            capabilities: agent.capabilities,
            autonomy: agent.autonomy,
         })),
         tasks: tasks.map((task) => ({
            id: task.id,
            title: task.title,
            description: (task.description ?? '').slice(0, 600),
            needs: task.capabilities,
         })),
      });

      const result = await this.#completion
         .structured({
            workspaceId,
            purpose: 'triage',
            model: await this.#model(workspaceId),
            system: SYSTEM,
            user,
            schema: ASSIGNMENTS,
            // The configured budget, which used to be held and never spent: the
            // call fell back to the deployment default no matter what routing
            // was given.
            timeoutMs: this.#timeoutMs,
            ...(signal ? { signal } : {}),
         })
         .catch((cause: unknown) => {
            throw new TriageUnavailable(
               cause instanceof CompletionInvalid
                  ? 'the orchestrator did not answer with assignments'
                  : `the orchestrator could not be reached: ${cause instanceof Error ? cause.message : String(cause)}`
            );
         });

      // Only ids from both lists survive. A model naming an agent that does not
      // exist would otherwise write a dangling assignee, and one naming a task
      // outside this plan would reach across into work it was not shown.
      const agentIds = new Set(roster.map((agent) => agent.id));
      const taskIds = new Set(tasks.map((task) => task.id));
      const workflowKeys = new Set(WORKFLOWS.map((workflow) => workflow.key));
      const decided = new Map<string, { agentId: string; workflow: string | null }>();
      for (const { taskId, agentId, workflow } of result.value.assignments) {
         if (!taskIds.has(taskId) || !agentIds.has(agentId)) continue;
         decided.set(taskId, { agentId, workflow: workflow && workflowKeys.has(workflow) ? workflow : null });
      }
      return decided;
   }

   /**
    * Route a compiled plan's tasks, then start the ones that can run.
    *
    * A task that is `blocked` is waiting on another task, so starting it would
    * put an agent to work on something whose input does not exist yet. It is
    * assigned and left alone; the run comes when what it waits for is done.
    * A task in `backlog` is waiting on an approval to start, and is left alone
    * the same way: approving it moves it on, not routing.
    *
    * Assignment is committed before any run is admitted. A model call that
    * fails halfway should leave work owned by somebody rather than half-routed
    * and unowned.
    */
   async triage(input: {
      planId: string;
      workspaceId: string;
      admit: (task: { issueId: string; agentId: string; instructions: string }) => Promise<void>;
      signal?: AbortSignal;
   }): Promise<TriageResult> {
      const tasks = await this.tasks(input.planId);
      if (tasks.length === 0) return { assigned: 0, started: 0, unassigned: [], failures: [] };

      const roster = await this.roster(input.workspaceId);
      if (roster.length === 0) {
         throw new TriageUnavailable('this workspace has no agent that can take work');
      }

      // Batch by batch, so a plan is routed as far as it can be, and each
      // batch's assignments are written before the next one is asked for. Every
      // batch failing is still the old error — nothing was routed and the caller
      // should hear why — but one failing batch now costs its own tasks, and a
      // process that stops halfway leaves the earlier ones owned rather than
      // deciding for them and forgetting.
      const decided = new Map<string, { agentId: string; workflow: string | null }>();
      const failures: string[] = [];
      let assigned = 0;
      for (let from = 0; from < tasks.length; from += BATCH) {
         const batch = tasks.slice(from, from + BATCH);
         let batchDecisions: Map<string, { agentId: string; workflow: string | null }>;
         try {
            batchDecisions = await this.#decide(input.workspaceId, batch, roster, input.signal);
         } catch (cause) {
            failures.push(cause instanceof Error ? cause.message : String(cause));
            // A cancelled signal is the caller giving up, not this batch
            // failing: carrying on would queue more work nobody is waiting for.
            if (input.signal?.aborted) break;
            continue;
         }
         for (const task of batch) {
            const decision = batchDecisions.get(task.id);
            if (!decision) continue;
            decided.set(task.id, decision);
            await this.#sql`
               UPDATE issues
                  SET assignee_type = 'agent', assignee_id = ${decision.agentId}, updated_at = now()
                WHERE id = ${task.id} AND assignee_id IS NULL`;
            assigned += 1;
            if (decision.workflow) {
               const workflow = decision.workflow;
               await this.#sql.begin((tx) => patchMetadata(tx as never, task.id, { set: { 'berry.workflow': workflow } }));
            }
         }
      }
      // Only an orchestrator that never answered is a failure. An answer whose
      // ids were all dropped is a decision — a poor one — and leaves the tasks
      // unassigned for a person to place, which is what the caller is told.
      if (failures.length > 0 && decided.size === 0) {
         throw new TriageUnavailable(failures[0]!);
      }

      let started = 0;
      for (const task of tasks) {
         const decision = decided.get(task.id);
         // Only `todo` is ready: `blocked` waits on another task, and `backlog`
         // is where a plan parks a task whose start needs a person's approval.
         if (!decision || task.status !== 'todo') continue;
         try {
            await input.admit({
               issueId: task.id,
               agentId: decision.agentId,
               instructions: instructionsFor(task),
            });
            started += 1;
         } catch {
            // One task failing to start is not a reason to leave the rest
            // unstarted; it keeps its agent and can be run by hand.
         }
      }

      return {
         assigned,
         started,
         unassigned: tasks.filter((task) => !decided.has(task.id)).map((task) => task.title),
         failures,
      };
   }
}
