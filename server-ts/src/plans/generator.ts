import type { Sql } from '../db/pool.ts';
import { z } from 'zod';
import { CompletionInvalid, type RuntimeCompletion } from '../runtime/completion.ts';
import { readPlan, validatePlan, type FieldProblem, type Plan, type ValidationReport } from './schema.ts';

/**
 * Turning a sentence into a plan, and then into a better one.
 *
 * Four stages, three of which are a model and one of which is not:
 *
 *   1. **generate** — the planner role turns the request into a document,
 *      starting with the requirements it read in the request.
 *   2. **validate** — deterministic. No model, no judgement: are the
 *      dependencies real, is the graph acyclic, does every approval gate
 *      something. This is what makes a plan the same verdict every time it is
 *      read.
 *   3. **repair** — when the validator found errors, the repair role is shown
 *      the document *and the errors* and asked to fix exactly those. Bounded,
 *      because a model that cannot fix its own graph in two attempts will not
 *      fix it in ten, and each attempt is paid for.
 *   4. **critic** — when the document is valid, the critic role is asked
 *      whether it delivers the request and whether it is any *good*: is a
 *      requirement dropped or weakened, is a task too big to finish, does an
 *      ordering make no sense. A revision verdict becomes one more repair
 *      round.
 *
 * Repair and critic are shown the same request, answers and facts the planner
 * was. Shown only the plan, they could judge it coherent while it left out
 * what the request asked for.
 *
 * The split between 2 and 4 is the important one. The validator answers
 * "could this be compiled" and must never change its mind; the critic answers
 * "should it be" and is allowed to be wrong. Only the first can block a plan.
 */

/**
 * The document the planner and the repair role both answer with. Shared, so
 * the repair role — which may be rebuilding a plan the planner left half
 * written — knows every field a task carries, `dependsOn` among them.
 */
const PLAN_FORMAT = `The shape of the answer is:

{
  "goal": { "tempId": "goal-1", "title": "...", "description": "..." },
  "requirements": [
    { "id": "r1", "description": "..." }
  ],
  "milestones": [
    { "tempId": "m1", "title": "...", "description": "..." }
  ],
  "assumptions": [
    { "id": "a1", "description": "...", "confidence": "low|medium|high", "blocking": false,
      "options": [ { "id": "a1-o1", "label": "...", "detail": "..." } ] }
  ],
  "issues": [
    { "tempId": "t1", "title": "...",
      "description": "What to do and why.\\n\\nAcceptance criteria:\\n- ...\\n- ...",
      "milestone": "m1", "covers": ["r1"],
      "requiredCapabilities": ["typescript"], "changesRepository": false, "dependsOn": [],
      "requiresReview": false, "requiresApproval": false, "priority": "medium" },
    { "tempId": "t2", "title": "...",
      "description": "What to do and why.\\n\\nAcceptance criteria:\\n- ...",
      "milestone": "m1", "covers": ["r1"],
      "requiredCapabilities": ["typescript"], "changesRepository": true, "dependsOn": ["t1"],
      "requiresReview": false, "requiresApproval": false, "priority": "medium" }
  ],
  "approvals": [
    { "tempId": "ap1", "title": "...", "reason": "...",
      "target": { "kind": "issue", "tempId": "t1" } }
  ]
}`;

const GENERATE_SYSTEM = `You turn a request into a Berry plan: what the request
requires, the milestones a team would deliver it in, the tasks that reach each
milestone, and the order they depend on each other in.

${PLAN_FORMAT}
Rules:
- Start with \`requirements\`: everything the request and its answered
  questions ask for, one checkable statement each, with ids r1, r2 and so on.
  Include the constraints the request states, such as "no new dependencies"
  or "must work offline". Use the request's own terms and keep its strength:
  if it says "real time", the requirement says real time, not "fast". Do not
  add requirements nobody asked for.
- Every requirement is delivered by at least one task, which names it in
  \`covers\` by its id. A task covers a requirement only when its acceptance
  criteria would show that requirement met.
- The goal is the whole request in one line. It is not a milestone and it
  has no tasks of its own.
- Size the plan to the request. Use as many milestones and tasks as its scope
  and dependencies need, and no more. A small change is one milestone with one
  or two tasks. A request with several parts that are each useful on their own
  has a milestone for each part.
- List milestones in delivery order. Each milestone is an outcome somebody
  could see working on its own, such as "people can sign in" or "a ticket can
  be created and assigned". It is not a layer of the system and not a phase
  name like "backend" or "testing".
- Every task belongs to exactly one milestone, named in \`milestone\` by its
  \`tempId\`, and every milestone has at least one task.
- Each task has one responsibility: one thing to build, change or decide, so
  that finishing it can be checked without asking what "done" meant. Not
  "build the feature"; not "rename a variable" either. A task that needs
  "and" to describe is usually two tasks.
- Every task's description ends with "Acceptance criteria:" and a list of
  checks a reviewer can verify from the result: a command that passes, a
  behaviour someone can observe, a file that exists with stated content.
  "Works well" and "the code is clean" are not checks.
- Order the milestones so that each one builds on the ones before it, and
  keep dependencies inside a milestone where you can; a task that waits on
  an earlier milestone names the specific task it waits on.
- \`dependsOn\` names tasks in this plan by \`tempId\`, and never forms a
  circle.
- Tasks with no dependency between them run at the same time, each on its own
  branch. Two that change the same file (a single-page site's index.html, one
  shared stylesheet or config) collide when the second is merged and cost a
  run to reconcile: chain them with \`dependsOn\`, or make them one task.
  Tasks that each add their own files can run side by side.
- Every task sets \`changesRepository\` to a boolean. The field is required:
  leaving it out, or leaving it null, makes the plan invalid and nothing
  starts. true when finishing the task means changing files in the repository
  — code, styles, markup, tests, configuration, a README. false when it
  produces a spec, research, a design decision or other writing that is not
  committed. Only engineers who can push are given a task marked true, so a
  build step marked false is given to someone who cannot build it. Specify
  and build in separate tasks when both are needed.
- Set \`requiresApproval\` only where starting the task is a commitment a
  person should make deliberately: deleting data, spending money, or touching
  something outside the repository.
- If the request is too vague to plan, say so with a blocking assumption
  (\`"blocking": true\`) whose description is the question you need answered,
  and propose no tasks.
- Every blocking assumption MUST carry 2-4 \`options\`: the concrete answers you
  would accept, mutually exclusive, in the vocabulary of the request rather
  than of software. "Nightly batch" and "Real-time (under 500ms)" are options;
  "Yes" and "No" to a question that is not yes-or-no are not. Add \`detail\`
  only where the label alone would not tell someone what they are choosing.
  Someone is going to pick one of these without being able to ask you what you
  meant, so do not offer an option you could not plan from.
- Offer options on a non-blocking assumption too when there is a real choice
  behind it. You are guessing either way; the options are how someone corrects
  the guess without having to know they needed to.
- Berry has no rules engine. A condition that must be respected goes in the
  task's description, where the agent doing the work will read it.`;

const REPAIR_SYSTEM = `You are fixing a Berry plan that failed its checks.

You will be given the request the plan answers, the plan as JSON and the
problems found in it. Return the whole corrected plan as JSON — same shape, no
prose, no code fence.

Fix exactly the problems listed. Do not restructure the plan, rename tasks that
are fine, or add work nobody asked for: someone is going to read the difference
between what they asked for and what you produced.

The request is fixed. A fix must still deliver everything the request asks
for: keep every requirement in \`requirements\` and a task that covers it,
unless a problem says that requirement is wrong. When a problem says a
requirement is missing or weakened, restore it in the request's own terms and
add or change the tasks that deliver it. Keep each task's acceptance criteria
at the end of its description.

The problems name each task by its tempId and say what to change. Return the
corrected plan, not the problem list.

When a problem asks whether a task changes the repository, set
\`changesRepository\` to true or false on every task it names. true means the
task changes files in the repository; false means it is a spec, research or a
decision. The field is required on every task you return. Do not leave it out
and do not leave it null.

${PLAN_FORMAT}
Keep every field a task already has — its \`milestone\`, \`covers\`,
\`dependsOn\`, capabilities and flags — unless a problem is about that field.
When you add or split tasks, give each one its \`milestone\`, the \`covers\` it
delivers, acceptance criteria, and the \`dependsOn\` it needs: a task that can
only start after another names it, by \`tempId\`. An approval
points at its task through \`target.tempId\`, and that task must exist.`;

const CRITIC_SYSTEM = `You are reviewing a Berry plan before a person is asked
to start it. The plan is already known to be structurally valid; your job is
whether it delivers what the request asked for, and whether it is any good.

You will be given the request the plan answers, the plan as JSON, and which
tasks the plan says deliver each of its requirements.

The shape of the answer is:

{ "coverage": [ { "requirement": "r1", "tasks": ["t1"],
                  "status": "covered" | "weakened" | "missing", "note": "..." } ],
  "verdict": "accept" | "revise",
  "problems": [ { "code": "...", "path": "/issues/0", "message": "...",
                  "severity": "error" | "warning" } ] }

Check the plan against the request first:
- Read the request yourself and work out what it asks for, including its
  answered questions and stated constraints. A requirement the plan's list
  leaves out is a problem with code "missing_requirement" and path
  "/requirements". If the plan lists no requirements, use the ones you found.
- Give one \`coverage\` entry per requirement. List the tasks that would
  deliver it if they were done as written. Its status is "covered" when they
  would, "weakened" when the plan or its tasks promise less than the request
  asked ("fast" for "real time", "the home page" for "every page"), and
  "missing" when no task delivers it. Explain anything other than "covered" in
  \`note\`.
- Every weakened or missing requirement is also a problem with severity
  "error", code "weakened_requirement" or "missing_requirement", and a message
  that says what the request asked for. Any such problem means "revise".
- A task with no acceptance criteria, or with criteria nobody could check, is
  a problem with code "untestable_task" and the task's path.

Then say "revise" for something else a person would actually send back: a
task too big for one agent to finish, a task that does two unrelated things, a
request with several parts squeezed into one milestone, a small request split
into more tasks than it needs, a milestone that is a layer or a phase rather
than an outcome, a missing step the rest depends on, an ordering that cannot
work, a task that will silently do something destructive. Style, wording and
preference are "accept" with a warning at most.

An empty problem list with "accept" is a good answer, and the common one.`;

/**
 * The shape the planner and the repair role answer in.
 *
 * Top-level keys are named so the model's structured-output tool advertises
 * them — an open object tempted it to wrap the plan under a key of its own.
 * Everything inside stays loose on purpose: `readPlan` reads leniently and
 * names what is wrong, and the repair loop is built on those names. A strict
 * schema here would refuse the document the repair role exists to fix.
 */
// Named fields stay forgiving: the answer is parsed against this schema, and
// a number where a string was expected must reach `readPlan` (which names the
// problem for the repair role) rather than fail the whole call.
const TEXT = z.union([z.string(), z.number(), z.null()]).optional();
const FLAG = z.union([z.boolean(), z.string(), z.null()]).optional();
const LIST = z.union([z.array(z.string()), z.string(), z.null()]).optional();

export const PLAN_SHAPE = z.looseObject({
   goal: z.looseObject({}).optional(),
   requirements: z
      .array(z.looseObject({ id: TEXT, description: TEXT }))
      .optional()
      .describe('everything the request asks for, one checkable statement each, with ids r1, r2, ...'),
   milestones: z.array(z.looseObject({})).optional(),
   assumptions: z.array(z.looseObject({})).optional(),
   // A task's fields are named, every one optional, so the tool advertises
   // them. An empty item schema left `dependsOn` to the prompt alone, and a
   // repair answering through the tool dropped it: plans compiled with every
   // task startable at once.
   issues: z
      .array(
         z.looseObject({
            tempId: TEXT,
            title: TEXT,
            description: TEXT.describe('what to do and why, ending with "Acceptance criteria:" and checks a reviewer can verify'),
            milestone: TEXT,
            covers: LIST.describe('ids of the requirements this task delivers'),
            dependsOn: LIST.describe('tempIds of the tasks in this plan that must finish before this one starts'),
            requiredCapabilities: LIST,
            changesRepository: FLAG.describe(
               'Required boolean on every task. true when finishing it changes files in the repository (code, styles, markup, tests, configuration, a README). false when it is a spec, research, or a decision that is not committed. Never omit this field.'
            ),
            requiresReview: FLAG,
            requiresApproval: FLAG,
            priority: TEXT,
         })
      )
      .optional(),
   approvals: z
      .array(
         z.looseObject({
            tempId: TEXT,
            title: TEXT,
            reason: TEXT,
            target: z
               .union([z.looseObject({ kind: TEXT, tempId: TEXT }), z.string(), z.null()])
               .optional()
               .describe('the task this approval gates: { "kind": "issue", "tempId": "<task tempId>" }'),
         })
      )
      .optional(),
});

const CRITIQUE_SHAPE = z.looseObject({
   coverage: z
      .array(z.looseObject({ requirement: TEXT, tasks: LIST, status: TEXT, note: TEXT }))
      .optional()
      .describe('one entry per requirement: the tasks that deliver it, and covered, weakened or missing'),
   verdict: z.string().optional(),
   problems: z.array(z.looseObject({})).optional(),
});

export type Stage = 'generate' | 'validate' | 'repair' | 'critic';

/** Which workspace a role call runs in, and which plan it is for. */
interface CallScope {
   workspaceId: string;
   planId?: string;
}

export interface Critique {
   verdict: 'accept' | 'revise';
   problems: Array<{ code: string; path: string; message: string; severity: 'error' | 'warning' }>;
   /** Each requirement against the tasks that deliver it. Absent when the critic gave none. */
   coverage?: RequirementCoverage[];
}

export interface RequirementCoverage {
   requirement: string;
   tasks: string[];
   status: 'covered' | 'weakened' | 'missing';
   note?: string;
}

export interface StageRecord {
   stage: Stage;
   role: 'planner' | 'repair' | 'critic' | null;
   provider: string | null;
   model: string | null;
   inputTokens: number;
   outputTokens: number;
   durationMs: number;
   outcome: 'ok' | 'invalid' | 'error';
   detail: Record<string, unknown>;
}

export interface Generated {
   plan: Plan;
   validation: ValidationReport;
   critique: Critique | null;
   usage: { inputTokens: number; outputTokens: number };
   model: string;
   provider: string;
   stages: StageRecord[];
   /** Set when the bounded repairs ran out. The last document is still kept. */
   exhausted: boolean;
}

export class PlannerUnavailable extends Error {
   override readonly name = 'PlannerUnavailable';
   /** The stage that could not run, for `<code> at <stage>`. */
   readonly stage: Stage;
   constructor(message: string, stage: Stage = 'generate') {
      super(message);
      this.stage = stage;
   }
}

export interface PlanGeneratorOptions {
   sql: Sql;
   defaultModel: string;
   /** Runs each call as a completion task on the runtime (ADR-0014). */
   completion: Pick<RuntimeCompletion, 'structured'>;
   timeoutMs?: number;
   /** How many times a document may be sent back to be fixed. */
   maxRepairs?: number;
   /** How many times the critic may ask for a revision. */
   maxCriticRounds?: number;
}

/**
 * One planner, repair or critic call's budget. A plan is the longest single
 * answer Berry asks a model for — measured at ~14k output tokens on a
 * verbose model, past the two minutes other completions get.
 */
const DEFAULT_TIMEOUT_MS = 300_000;

export class PlanGenerator {
   readonly #sql: Sql;
   readonly #completion: Pick<RuntimeCompletion, 'structured'>;
   readonly #defaultModel: string;
   readonly #timeoutMs: number;
   readonly #maxRepairs: number;
   readonly #maxCriticRounds: number;

   constructor(options: PlanGeneratorOptions) {
      this.#sql = options.sql;
      this.#completion = options.completion;
      this.#defaultModel = options.defaultModel;
      this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      this.#maxRepairs = options.maxRepairs ?? 2;
      this.#maxCriticRounds = options.maxCriticRounds ?? 1;
   }

   /**
    * The model provisioned for a role, or the deployment's default.
    *
    * `model_role_agents` is where an operator says which model does what.
    * Falling back rather than refusing means a deployment that never filled
    * that table can still plan, which is the more useful failure.
    */
   async role(name: 'planner' | 'repair' | 'critic'): Promise<{ provider: string; model: string }> {
      const [row] = await this.#sql`
         SELECT model_provider, model_name FROM model_role_agents
          WHERE role = ${name} AND status <> 'offline'
          ORDER BY updated_at DESC LIMIT 1`;
      return row
         ? { provider: row.model_provider as string, model: row.model_name as string }
         : { provider: 'bedrock', model: this.#defaultModel };
   }

   /**
    * The whole pipeline.
    *
    * `onStage` is called as each stage finishes rather than at the end, so a
    * caller can write `generation.stage` and a person watching sees where the
    * plan is instead of a spinner.
    */
   async generate(input: {
      /** The workspace the plan is for; its completion tasks run there. */
      workspaceId: string;
      prompt: string;
      /**
       * What the asker has already answered, when this is a second attempt.
       *
       * Appended to the request rather than merged into it: the original
       * prompt is what someone typed, and rewriting it to contain answers
       * would leave no record of what was asked versus what was learned.
       */
      answers?: AnsweredQuestion[];
      /** What Berry knows about where the tasks will land, one sentence each. */
      facts?: string[];
      /** The plan being generated: every model call is filed under it, so its transcript can list them. */
      planId?: string;
      signal?: AbortSignal;
      onStage?: (stage: Stage) => void;
   }): Promise<Generated> {
      const stages: StageRecord[] = [];
      const usage = { inputTokens: 0, outputTokens: 0 };
      // Built once and given to every stage, so a repair or a critic judges
      // the plan against what was asked rather than against the plan itself.
      const brief = planBrief(input.prompt, input.answers ?? [], input.facts ?? []);

      input.onStage?.('generate');
      const planner = await this.role('planner');
      const scope: CallScope = { workspaceId: input.workspaceId, ...(input.planId ? { planId: input.planId } : {}) };
      const first = await this.#call({
         ...scope,
         role: 'planner',
         stage: 'generate',
         model: planner,
         system: GENERATE_SYSTEM,
         user: brief,
         shape: PLAN_SHAPE,
         signal: input.signal,
      });
      account(usage, first);

      let { plan, problems } = readPlan(first.json);
      let validation = validatePlan(plan, { seed: problems });
      stages.push(
         stageOf('generate', 'planner', first.served, first, validation, { issues: plan.issues.length })
      );
      input.onStage?.('validate');

      // A plan waiting on an answer is not a broken plan, and sending it to
      // the repair role would have it invent the answer.
      if (validation.status !== 'blocked') {
         let repairs = 0;
         while (validation.status === 'invalid' && repairs < this.#maxRepairs) {
            repairs += 1;
            input.onStage?.('repair');
            const repaired = await this.#tryRepair(scope, brief, plan, validation.errors, input.signal, stages);
            // A repair nobody could reach is the same dead end as one that
            // fixed nothing, and ends the same way: with the document it had.
            if (!repaired) break;
            account(usage, repaired.result);
            plan = repaired.plan;
            validation = repaired.validation;
            stages.push(repaired.record);
         }

         if (validation.status === 'valid') {
            let rounds = 0;
            // The last verdict, as given. Reporting `accept` after a critic
            // asked for changes that could not be made hid its problems.
            let critique: Critique = { verdict: 'accept', problems: [] };
            while (rounds < this.#maxCriticRounds) {
               rounds += 1;
               input.onStage?.('critic');
               const reviewed = await this.#critique(scope, brief, plan, input.signal);
               account(usage, reviewed.result);
               stages.push(reviewed.record);
               critique = reviewed.critique;
               if (reviewed.critique.verdict === 'accept') {
                  return {
                     plan,
                     validation,
                     critique: reviewed.critique,
                     usage,
                     model: first.served.model,
                     provider: first.served.provider,
                     stages,
                     exhausted: false,
                  };
               }

               input.onStage?.('repair');
               const repaired = await this.#tryRepair(
                  scope,
                  brief,
                  plan,
                  reviewed.critique.problems.map((problem) => ({
                     path: problem.path,
                     code: problem.code,
                     message: problem.message,
                  })),
                  input.signal,
                  stages
               );
               // This document is valid. A revision that cannot be asked for
               // is a reason to stop improving it, never to lose it.
               if (!repaired) break;
               account(usage, repaired.result);
               stages.push(repaired.record);
               // A revision usually breaks on something small — an approval
               // pointing one task past the end — while carrying the changes
               // the critic asked for. It gets the same bounded repairs a first
               // draft does before it is given up on.
               let revised = repaired;
               let fixes = 0;
               while (revised.validation.status === 'invalid' && fixes < this.#maxRepairs) {
                  fixes += 1;
                  input.onStage?.('repair');
                  const next = await this.#tryRepair(
                     scope,
                     brief,
                     revised.plan,
                     revised.validation.errors,
                     input.signal,
                     stages
                  );
                  if (!next) break;
                  revised = next;
                  account(usage, revised.result);
                  stages.push(revised.record);
               }
               // A revision that still breaks the document is worse than the
               // document that was merely criticised, so the valid one wins.
               if (revised.validation.status === 'valid') {
                  plan = revised.plan;
                  validation = revised.validation;
               }
            }
            return {
               plan,
               validation,
               critique,
               usage,
               model: first.served.model,
               provider: first.served.provider,
               stages,
               exhausted: false,
            };
         }
      }

      return {
         plan,
         validation,
         critique: null,
         usage,
         model: first.served.model,
         provider: first.served.provider,
         stages,
         // The last document is kept either way: a plan with named errors is
         // something a person can fix, and throwing it away would leave them
         // with the prompt and nothing else.
         exhausted: validation.status === 'invalid',
      };
   }

   /**
    * A repair round, or null when the repair role could not be reached.
    *
    * The gateway took a repair request and never answered it; five minutes
    * later the whole generation failed, and a document whose errors were
    * named and fixable was thrown away, leaving a person with the prompt and
    * nothing else. An unreachable repair now ends the loop instead: the last
    * document stands, `exhausted`, with the stage recorded so a reader sees
    * where the pipeline stopped. Only `generate` still fails the run, because
    * without a first document there is nothing to keep.
    */
   async #tryRepair(
      scope: CallScope,
      brief: string,
      plan: Plan,
      problems: Array<{ path: string; code: string; message: string }>,
      signal: AbortSignal | undefined,
      stages: StageRecord[]
   ) {
      try {
         return await this.#repair(scope, brief, plan, problems, signal);
      } catch (error) {
         if (!(error instanceof PlannerUnavailable)) throw error;
         stages.push(unreachableStage('repair', error));
         return null;
      }
   }

   async #repair(
      scope: CallScope,
      brief: string,
      plan: Plan,
      problems: Array<{ path: string; code: string; message: string }>,
      signal: AbortSignal | undefined
   ) {
      const role = await this.role('repair');
      const result = await this.#call({
         ...scope,
         role: 'repair',
         stage: 'repair',
         model: role,
         system: REPAIR_SYSTEM,
         user: repairPrompt(brief, plan, problems),
         shape: PLAN_SHAPE,
         signal,
      });
      const { plan: repaired, problems: readingProblems } = readPlan(result.json);
      const validation = validatePlan(repaired, { seed: readingProblems });
      return {
         plan: repaired,
         validation,
         result,
         record: stageOf('repair', 'repair', result.served, result, validation, {
            fixing: problems.length,
         }),
      };
   }

   async #critique(scope: CallScope, brief: string, plan: Plan, signal: AbortSignal | undefined) {
      const role = await this.role('critic');
      const result = await this.#call({
         ...scope,
         role: 'critic',
         stage: 'critic',
         model: role,
         system: CRITIC_SYSTEM,
         user: criticPrompt(brief, plan),
         shape: CRITIQUE_SHAPE,
         signal,
      });
      const critique = readCritique(result.json);
      return {
         critique,
         result,
         record: {
            stage: 'critic' as const,
            role: 'critic' as const,
            provider: result.served.provider,
            model: result.served.model,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            durationMs: result.durationMs,
            outcome: 'ok' as const,
            detail: { verdict: critique.verdict, problems: critique.problems.length },
         },
      };
   }

   async #call(input: {
      workspaceId: string;
      planId?: string;
      role: 'planner' | 'repair' | 'critic';
      stage: Stage;
      model: { provider: string; model: string };
      system: string;
      user: string;
      shape: z.ZodType;
      signal: AbortSignal | undefined;
   }) {
      const result = await this.#completion
         .structured({
            workspaceId: input.workspaceId,
            ...(input.planId ? { subject: { planId: input.planId } } : {}),
            purpose: input.role,
            model: input.model.model,
            agentRole: 'planner',
            system: input.system,
            user: input.user,
            schema: input.shape,
            timeoutMs: this.#timeoutMs,
            ...(input.signal ? { signal: input.signal } : {}),
         })
         .catch((cause: unknown) => {
            if (cause instanceof CompletionInvalid) {
               throw new PlannerUnavailable(`the ${input.role} did not answer with a plan`, input.stage);
            }
            throw new PlannerUnavailable(
               `the ${input.role} could not be reached: ${cause instanceof Error ? cause.message : String(cause)}`,
               input.stage
            );
         });

      return {
         json: result.value,
         inputTokens: result.inputTokens,
         outputTokens: result.outputTokens,
         durationMs: result.durationMs,
         served: servedBy(input.model, result.model),
      };
   }
}

// ------------------------------------------------------------------ helpers

function account(
   usage: { inputTokens: number; outputTokens: number },
   result: { inputTokens: number; outputTokens: number }
): void {
   // Summed across stages: a plan that needed two repairs cost all of them,
   // and reporting only the last would make the pipeline look free.
   usage.inputTokens += result.inputTokens;
   usage.outputTokens += result.outputTokens;
}

/**
 * The repair role's user turn.
 *
 * The problems used to be the validator's rows, one JSON object per task, and
 * thirty tasks with the same fault became thirty copies of one sentence that
 * named neither the task nor the value to change. A reviewer cannot work from
 * that. Same fault, one paragraph, and each task named by its id.
 */
export function repairPrompt(
   brief: string,
   plan: Plan,
   problems: Array<{ path: string; code: string; message: string }>
): string {
   return `Request:\n${brief}\n\nPlan:\n${JSON.stringify(plan)}\n\nProblems:\n${repairProblemsText(plan, problems)}`;
}

/**
 * The critic's user turn: the request, the plan, and the coverage the plan
 * claims. The claim is spelled out so the critic checks each requirement
 * against named tasks instead of skimming a document for coherence.
 */
export function criticPrompt(brief: string, plan: Plan): string {
   return `Request:\n${brief}\n\nPlan:\n${JSON.stringify(plan)}\n\nCoverage the plan claims:\n${claimedCoverage(plan)}`;
}

function claimedCoverage(plan: Plan): string {
   const requirements = plan.requirements ?? [];
   if (requirements.length === 0) {
      return 'The plan lists no requirements. Work them out from the request and check each one against the tasks.';
   }
   return requirements
      .map((requirement) => {
         const tasks = plan.issues.filter((issue) => (issue.covers ?? []).includes(requirement.id));
         const by =
            tasks.length === 0
               ? 'no task'
               : tasks.map((issue) => (issue.title ? `${issue.tempId} ("${issue.title}")` : issue.tempId)).join(', ');
         return `- ${requirement.id} "${requirement.description}": ${by}`;
      })
      .join('\n');
}

function repairProblemsText(
   plan: Plan,
   problems: Array<{ path: string; code: string; message: string }>
): string {
   const groups = new Map<string, typeof problems>();
   for (const problem of problems) {
      const key = groupKey(problem);
      const list = groups.get(key) ?? [];
      list.push(problem);
      groups.set(key, list);
   }
   return [...groups.values()].map((items) => renderGroup(plan, items)).join('\n\n');
}

/** Titles, milestones and the repository flag repeat once per task; say them once. */
function groupKey(problem: { path: string; code: string }): string {
   if (problem.code === 'required' && problem.path.endsWith('/title') && problem.path.startsWith('/issues/')) {
      return 'missing-title';
   }
   if (problem.code === 'unknown_milestone') return 'unknown-milestone';
   if (problem.code === 'required' && problem.path.endsWith('/changesRepository')) return 'changes-repository';
   return `one:${problem.path}:${problem.code}`;
}

function renderGroup(plan: Plan, items: Array<{ path: string; code: string; message: string }>): string {
   const first = items[0]!;
   if (groupKey(first) === 'missing-title') {
      const lines = items.map((item) => `- ${taskLabel(plan, item.path)}`);
      return `These tasks have no title. Give each one a title:\n${lines.join('\n')}`;
   }
   if (groupKey(first) === 'unknown-milestone') {
      const milestones =
         plan.milestones.map((milestone) => `${milestone.tempId} ("${milestone.title}")`).join(', ') || 'none';
      const lines = items.map((item) => {
         const issue = issueAt(plan, item.path);
         const value = issue?.milestone ? `"${issue.milestone}"` : 'nothing';
         return `- ${taskLabel(plan, item.path)} names ${value}`;
      });
      return `These tasks name a milestone the plan does not have. Milestones in the plan: ${milestones}.\n${lines.join('\n')}`;
   }
   if (groupKey(first) === 'changes-repository') {
      const lines = items.map((item) => `- ${taskLabel(plan, item.path)}`);
      return `Say whether each of these changes the repository (true) or is a spec, research or a decision (false):\n${lines.join('\n')}`;
   }
   const who = taskLabel(plan, first.path);
   return who === first.path ? `- ${first.code}: ${first.message}` : `- ${who}: ${first.code}: ${first.message}`;
}

function issueAt(plan: Plan, path: string): Plan['issues'][number] | undefined {
   const index = /^\/issues\/(\d+)/.exec(path);
   return index ? plan.issues[Number(index[1])] : undefined;
}

function taskLabel(plan: Plan, path: string): string {
   const issue = issueAt(plan, path);
   if (!issue) return path;
   return issue.title ? `${issue.tempId} ("${issue.title}")` : issue.tempId;
}

/** A question the planner asked and the answer it was given. */
export interface AnsweredQuestion {
   question: string;
   answer: string;
}

/**
 * The request, with what has since been answered.
 *
 * The answers are named as answers rather than folded into the prose so the
 * planner cannot mistake them for more of the original request — and so it is
 * told, in as many words, not to ask them again. A planner that re-asks an
 * answered question blocks the plan a second time on the thing the person
 * just resolved, which reads as the feature not working at all.
 */
export function withAnswers(prompt: string, answers: AnsweredQuestion[]): string {
   if (answers.length === 0) return prompt;
   const answered = answers
      .map((entry, index) => `${index + 1}. ${entry.question}\n   ${entry.answer}`)
      .join('\n');
   return `${prompt}

---

The planner asked these questions and they have been answered. Treat each
answer as settled fact and plan accordingly. Do not raise them again as
assumptions, and do not block on them:

${answered}`;
}

/**
 * Everything the plan must answer to: the request, its answered questions, and
 * what Berry knows about where the tasks will land. Every stage gets the same
 * text, so none of them can drop what an earlier one was told.
 */
export function planBrief(prompt: string, answers: AnsweredQuestion[], facts: string[]): string {
   const request = withAnswers(prompt, answers);
   if (facts.length === 0) return request;
   return `${request}

---

Known facts about where the tasks will land:
${facts.map((fact) => `- ${fact}`).join('\n')}`;
}

/**
 * Who answered a call: the model its usage recorded, else the one asked for.
 * A gateway id (`vendor/model`) is the Kilo gateway's; anything else Bedrock's.
 */
function servedBy(
   asked: { provider: string; model: string },
   served: string | null | undefined
): { provider: string; model: string } {
   if (!served) return asked;
   return { provider: served.includes('/') ? 'kilo' : 'bedrock', model: served };
}

/** A stage that never ran, so a reader sees where the pipeline stopped and why. */
function unreachableStage(stage: Stage, error: PlannerUnavailable): StageRecord {
   return {
      stage,
      role: stage === 'critic' ? 'critic' : 'repair',
      provider: null,
      model: null,
      inputTokens: 0,
      outputTokens: 0,
      durationMs: 0,
      outcome: 'error',
      detail: { message: error.message },
   };
}

function stageOf(
   stage: Stage,
   role: 'planner' | 'repair',
   model: { provider: string; model: string },
   result: { inputTokens: number; outputTokens: number; durationMs: number },
   validation: ValidationReport,
   detail: Record<string, unknown>
): StageRecord {
   return {
      stage,
      role,
      provider: model.provider,
      model: model.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      durationMs: result.durationMs,
      // The column's vocabulary is narrower than the validator's, so `blocked`
      // is recorded as `invalid` and the detail carries the difference.
      outcome: validation.status === 'valid' ? 'ok' : 'invalid',
      detail: { ...detail, validation: validation.status, errors: validation.errors.length },
   };
}

/**
 * The critic's verdict, read defensively.
 *
 * An unreadable critique is `accept`, not a failure: the plan already passed
 * the checks that decide whether it can be compiled, and losing a valid plan
 * because a reviewer answered badly would be the wrong trade.
 */
const GAP_CODES = new Set(['missing_requirement', 'weakened_requirement']);

function readCritique(raw: unknown): Critique {
   if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return { verdict: 'accept', problems: [] };
   }
   const source = raw as Record<string, unknown>;
   const rawProblems = Array.isArray(source.problems) ? source.problems : [];
   const problems: Critique['problems'] = rawProblems.flatMap((entry) => {
      if (typeof entry !== 'object' || entry === null) return [];
      const item = entry as Record<string, unknown>;
      const message = typeof item.message === 'string' ? item.message : '';
      if (message === '') return [];
      return [
         {
            code: typeof item.code === 'string' ? item.code : 'critic',
            path: typeof item.path === 'string' ? item.path : '/',
            message,
            severity: item.severity === 'error' ? ('error' as const) : ('warning' as const),
         },
      ];
   });
   const coverage = readCoverage(source.coverage);
   let verdict: Critique['verdict'] = source.verdict === 'revise' ? 'revise' : 'accept';

   // A gap the critic recorded in its coverage is a revision whatever verdict
   // it gave: accepting a plan that drops part of the request is the failure
   // this stage exists to catch. A gap with no problem of its own gets one, so
   // the repair role is told about it.
   if (problems.some((problem) => problem.severity === 'error' && GAP_CODES.has(problem.code))) verdict = 'revise';
   for (const entry of coverage) {
      if (entry.status === 'covered') continue;
      verdict = 'revise';
      const named = problems.some(
         (problem) => GAP_CODES.has(problem.code) && problem.message.split(/[^\w-]+/u).includes(entry.requirement)
      );
      if (named) continue;
      problems.push({
         code: `${entry.status}_requirement`,
         path: '/requirements',
         message: `${entry.requirement} is ${entry.status} in this plan${entry.note ? `: ${entry.note}` : '.'}`,
         severity: 'error',
      });
   }

   return { verdict, problems, ...(coverage.length > 0 ? { coverage } : {}) };
}

function readCoverage(value: unknown): RequirementCoverage[] {
   if (!Array.isArray(value)) return [];
   return value.flatMap((entry) => {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return [];
      const item = entry as Record<string, unknown>;
      const requirement = typeof item.requirement === 'string' ? item.requirement.trim() : '';
      if (requirement === '') return [];
      const tasks = Array.isArray(item.tasks)
         ? item.tasks.filter((task): task is string => typeof task === 'string')
         : typeof item.tasks === 'string'
           ? item.tasks.split(',').map((task) => task.trim()).filter((task) => task !== '')
           : [];
      const status = item.status === 'missing' || item.status === 'weakened' ? item.status : 'covered';
      const note = typeof item.note === 'string' ? item.note.trim() : '';
      return [{ requirement, tasks, status, ...(note ? { note } : {}) }];
   });
}

export type { FieldProblem };
