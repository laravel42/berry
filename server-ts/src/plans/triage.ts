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
/** Maximum routing completions in flight; leaves dispatcher slots for real work. */
const BATCH_CONCURRENCY = 4;
/** A batch that goes unanswered is asked once more before it is reported. */
const ROUTING_ATTEMPTS = 2;

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
   /** May branch the repository and open pull requests: the one kind of agent code work can go to. */
   changesRepository: boolean;
}

interface TriageTask {
   id: string;
   number: number;
   title: string;
   description: string | null;
   status: string;
   capabilities: string[];
   /** The plan marked it as changing the repository; null when it did not say. */
   changesRepository?: boolean | null;
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
Each task is one step of a plan that is already broken down. Assign it to the
agent that does that step itself, not to the one who would specify it: a task
that builds, implements, styles, fixes or tests something in the code goes to
an agent with "changesRepository": true, and "needs" names the skills it takes.
A task marked "changesRepository": true MUST go to such an agent: any other
answer for it is discarded. An agent without it can only read the repository,
so code given to it is never written. Specs, research, design and decisions go
to the role that makes them.

These workflows say which role does which kind of work, in order:
${WORKFLOWS.map((w) => `- ${w.key}: ${w.chain.join(' → ')} (${w.when})`).join('\n')}
Pick the role in the chain that does this task's step, not the first role of the
chain. A task answer may name the workflow: { "taskId": "...", "agentId": "...", "workflow": "frontend-visual-bug" }.`;

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
            changes_repository: boolean | null;
         }>
      >`
         SELECT i.id, i.number, i.title, i.description, i.status::text AS status,
                array_remove(array_agg(l.name), NULL) AS capabilities,
                (i.metadata->>'berry.changesRepository')::boolean AS changes_repository
           FROM plan_issues pi
           JOIN issues i ON i.id = pi.issue_id AND i.deleted_at IS NULL
           LEFT JOIN issue_label_memberships m ON m.issue_id = i.id
           LEFT JOIN issue_labels l ON l.id = m.label_id
          WHERE pi.plan_id = ${planId}
            AND i.assignee_id IS NULL
          GROUP BY i.id, i.number, i.title, i.description, i.status, i.metadata
          ORDER BY i.number`;
      return rows.map(({ changes_repository, ...row }) => ({
         ...row,
         capabilities: row.capabilities ?? [],
         changesRepository: changes_repository,
      }));
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
            permissions: string[] | null;
         }>
      >`
         SELECT id, name, description, capabilities, role_key, role_contract, permissions
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
            changesRepository: (row.permissions ?? []).includes('create_branches'),
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
            changesRepository: agent.changesRepository,
         })),
         tasks: tasks.map((task) => ({
            id: task.id,
            title: task.title,
            description: (task.description ?? '').slice(0, 600),
            needs: task.capabilities,
            ...(typeof task.changesRepository === 'boolean' ? { changesRepository: task.changesRepository } : {}),
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
      const branching = new Set(roster.filter((agent) => agent.changesRepository).map((agent) => agent.id));
      const taskById = new Map(tasks.map((task) => [task.id, task]));
      const taskIds = new Set(taskById.keys());
      const workflowKeys = new Set(WORKFLOWS.map((workflow) => workflow.key));
      const decided = new Map<string, { agentId: string; workflow: string | null }>();
      for (const { taskId, agentId, workflow } of result.value.assignments) {
         if (!taskIds.has(taskId) || !agentIds.has(agentId)) continue;
         // The rule the prompt states, held here: a task that changes the
         // repository given to an agent that cannot branch it is no decision.
         // The task is asked about again, and left for a person after that.
         if (taskById.get(taskId)?.changesRepository === true && !branching.has(agentId)) continue;
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

      // Route in bounded waves. Four independent batches ask together, so a
      // thirty-five-task plan takes two routing rounds rather than five, while
      // leaving dispatcher capacity for real work. Each wave is applied before
      // the next one starts, preserving partial progress if the process stops.
      const decided = new Map<string, { agentId: string; workflow: string | null }>();
      const failures: string[] = [];
      let assigned = 0;
      let batches = Array.from(
         { length: Math.ceil(tasks.length / BATCH) },
         (_, index) => tasks.slice(index * BATCH, (index + 1) * BATCH)
      );
      // A batch the orchestrator did not answer (a timeout, a dropped
      // connection) is asked once more before its tasks are left to a person:
      // the field saw whole plans sit unowned after one slow call. Only the
      // last attempt's failures are reported.
      for (let attempt = 0; attempt < ROUTING_ATTEMPTS && batches.length > 0; attempt += 1) {
         const retry: TriageTask[][] = [];
         failures.length = 0;
         for (let from = 0; from < batches.length; from += BATCH_CONCURRENCY) {
            const wave = batches.slice(from, from + BATCH_CONCURRENCY);
            const results = await Promise.all(
               wave.map(async (batch) => {
                  try {
                     return {
                        batch,
                        decisions: await this.#decide(
                           input.workspaceId,
                           batch,
                           roster,
                           input.signal
                        ),
                        failure: null,
                     };
                  } catch (cause) {
                     return {
                        batch,
                        decisions: null,
                        failure: cause instanceof Error ? cause.message : String(cause),
                     };
                  }
               })
            );

            for (const result of results) {
               if (!result.decisions) {
                  if (result.failure) failures.push(result.failure);
                  retry.push(result.batch);
                  continue;
               }
               // A task that changes the repository and came back without an
               // agent that can branch it is asked about again: the rule is
               // why it has no owner, and the second answer may keep to it.
               const unrouted: TriageTask[] = [];
               for (const task of result.batch) {
                  const decision = result.decisions.get(task.id);
                  if (!decision) {
                     if (task.changesRepository === true) unrouted.push(task);
                     continue;
                  }
                  const updated = await this.#sql`
                     UPDATE issues
                        SET assignee_type = 'agent', assignee_id = ${decision.agentId}, updated_at = now()
                      WHERE id = ${task.id} AND assignee_id IS NULL
                      RETURNING id`;
                  // Another routing request won the task. Do not count or start it
                  // from this decision — its winner owns that responsibility.
                  if (updated.length === 0) continue;
                  decided.set(task.id, decision);
                  assigned += 1;
                  if (decision.workflow) {
                     const workflow = decision.workflow;
                     await this.#sql.begin((tx) =>
                        patchMetadata(tx as never, task.id, {
                           set: { 'berry.workflow': workflow },
                        })
                     );
                  }
               }
               if (unrouted.length > 0) retry.push(unrouted);
            }
            if (input.signal?.aborted) break;
         }
         if (input.signal?.aborted) break;
         batches = retry;
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
