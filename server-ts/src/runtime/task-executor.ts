import type { Tier } from '../agents/model-tiers.ts';
import { randomUUID } from 'node:crypto';
import type { Sql } from '../db/pool.ts';
import { nullRunMemory, type RunMemory } from '../agentcore/memory.ts';
import { gitWriteInvisible, type GitHubClient } from '../integrations/github.ts';
import { isDetached, type Executor } from '../runs/dispatcher.ts';
import { RunLedger, type Dispatch, type Failure, type Usage } from '../runs/ledger.ts';
import { postRunResult } from '../runs/result-comment.ts';
import { mintTaskToken, revokeTaskTokens } from './agent-tools/tokens.ts';
import { AI_RUNTIME_ADAPTER_PROTOCOL_VERSION, type RuntimeControlResponse } from './envelope.ts';
import { recordDelivery } from './delivery.ts';
import { LIMIT_CODE, continuedMessage, continueAfterLimit, retryAfterFault, retryNote, type ContinuationOutcome, type RetryOutcome } from '../runs/continuation.ts';
import { AiRuntimeEnvelopeError, loadTask, type DeliveryPlan, type EnvelopeBuilder, type TaskRow } from './envelope-builder.ts';
import { agentLogEvent, exchangeLog, type ExchangeLog } from './exchange-log.ts';
import { LifecycleStreamError, type LifecycleEvent, type TaskDelivery, type TaskMessage, type TaskResult } from './lifecycle.ts';
import { directRecorder, ledgerRecorder, type TaskRecorder } from './recorders.ts';
import { RunNotResumable, RuntimeUnavailable, type RuntimeTarget, type RuntimeTransport } from './transport.ts';
import type { WorkstationKiro } from './workstation-kiro.ts';
import { scheduleReview } from '../runs/followups.ts';
import { parseRepository } from '../agents/checkout.ts';
import { publishTrustedDelivery } from './trusted-delivery.ts';
import { runtimeSessionIdFor } from './session-id.ts';

export type UsageRecorder = (
   sql: Sql,
   input: {
      runId: string;
      eventId?: string;
      workspaceId: string;
      agentId: string;
      runtimeId?: string;
      model: string;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
      /** The gateway's own cost report (ADR-0017); absent means Berry prices it. */
      reportedCostMicros?: number | null;
      /** The Berry tier that chose the model; absent or null when the agent named its own. */
      tier?: Tier | null;
      /** Served by the run's fallback model. */
      fellBack?: boolean;
   }
) => Promise<void>;

export interface TaskOutcome {
   runId: string;
   status: 'succeeded' | 'failed' | 'cancelled';
   summary: string | null;
   usage: Usage;
   failure?: Failure;
   result?: TaskResult;
}

export interface RuntimeTaskExecutorOptions {
   sql: Sql;
   transport: RuntimeTransport;
   builder: EnvelopeBuilder;
   /** The deployment's runtime when a task names none. Null means tasks fail as unconfigured. */
   defaultTarget: RuntimeTarget | null;
   /** Kiro runs here, on the workstation, instead of inside the runtime container. */
   workstation?: WorkstationKiro;
   recordUsage: UsageRecorder;
   ledger?: RunLedger;
   memory?: RunMemory;
   gitCredential?: ((workspaceId: string, owner?: string | null) => Promise<{ username: string; password: string }>) | undefined;
   github?: (token: string) => GitHubClient;
   reviewGate?: { review(runId: string): Promise<unknown> };
   onGateError?: (error: unknown) => void;
   onUsageError?: (error: unknown) => void;
   /** Where a prompt-log write that failed is reported. The task is unaffected. */
   onExchangeLogError?: (error: unknown) => void;
   /** Where a refused session stop is reported. The cancellation still stands. */
   onCancelError?: (error: unknown) => void;
   /** The runtime's maxLifetime: a token never outlives the microVM it was minted for. */
   tokenTtlSeconds?: number;
   /** How many times a task stopped at its step limit is continued unattended. Zero turns it off. */
   maxContinuations?: number;
   onContinuationError?: (error: unknown) => void;
   clock?: () => Date;
   newId?: () => string;
}

/** What finishing a run needs that only its envelope build knew; kept on the row for a resume. */
interface Resumable {
   delivery: DeliveryPlan | null;
   model: string;
   tier: Tier | null;
}

/** A run whose stream is being recorded. */
interface Consuming extends Resumable {
   task: TaskRow;
   recorder: TaskRecorder;
   usage: Usage;
   target: RuntimeTarget;
   session: string;
   abort: AbortSignal;
   log: ExchangeLog | null;
   /** How many frames of the stream were recorded before this one began. */
   cursor: number;
   resumed: boolean;
}

/** How often the frame count is saved while a stream flows: a crash replays at most this much. */
const CURSOR_SAVE_MS = 500;

/** `first`, then the rest of `rest`: a stream whose first read was taken to see whether it opened. */
async function* prepend<T>(first: IteratorResult<T>, rest: AsyncIterator<T>): AsyncGenerator<T> {
   if (first.done) return;
   yield first.value;
   while (true) {
      const next = await rest.next();
      if (next.done) return;
      yield next.value;
   }
}

const ZERO: Usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, costMicros: null, currency: null };

/** Kiro, Claude, and Codex run in a process beside the server, so they need no AgentCore or HTTP host. */
const WORKSTATION_TARGET: RuntimeTarget = {
   id: null,
   driver: 'http',
   arn: null,
   qualifier: 'DEFAULT',
   region: null,
   endpointUrl: null,
};

function runsOnWorkstation(aiRuntimeId: string | null): boolean {
   return aiRuntimeId === 'kiro' || aiRuntimeId === 'claude' || aiRuntimeId === 'codex' || aiRuntimeId === 'cursor';
}
const STREAM_ENDED: Failure = {
   code: 'RUNTIME_STREAM_ENDED',
   message: 'The runtime stopped reporting before the task finished.',
   retryable: true,
};

/**
 * A repository task that ends with no report and no change has nothing for a
 * reviewer to accept. An answer with no commit is still a result, and so is a
 * commit or a pull request opened for work an earlier run of this task already
 * pushed. Only the empty case is a fault, and it is retried once.
 */
export function emptyRepositoryRun(input: {
   repository: boolean;
   summary: string | null;
   delivery: TaskDelivery | null | undefined;
   pullRequest: number | null;
}): boolean {
   if (!input.repository) return false;
   if (input.summary !== null && input.summary.trim() !== '') return false;
   if (input.delivery?.committed) return false;
   if (input.pullRequest !== null) return false;
   return true;
}

/**
 * The dispatcher's executor, now that the loop is in the runtime.
 *
 * It claims, builds the envelope, invokes, and turns each lifecycle event
 * into the ledger write the in-process executor used to make itself. The
 * ledger stays the only writer of run state; this only reads a stream.
 */
export class RuntimeTaskExecutor implements Executor {
   readonly #o: RuntimeTaskExecutorOptions;
   readonly #ledger: RunLedger;
   readonly #memory: RunMemory;

   constructor(options: RuntimeTaskExecutorOptions) {
      this.#o = options;
      this.#ledger = options.ledger ?? new RunLedger({ sql: options.sql });
      this.#memory = options.memory ?? nullRunMemory();
   }

   /** Null when this process let go of the run while it was being recorded (`Detached`). */
   async execute(runId: string, signal?: AbortSignal): Promise<TaskOutcome | null> {
      const { sql } = this.#o;
      const task = await loadTask(sql, runId);
      const dispatch = task.issueId ? await this.#ledger.claimDispatch(runId) : await claimDirect(sql, runId);
      // A chat task has no issue, so it records on the row — but its output is
      // a reply someone is reading as it arrives, so the deltas go to the
      // ledger too and the conversation's stream follows them.
      const recorder: TaskRecorder = task.issueId
         ? ledgerRecorder(this.#ledger, runId)
         : directRecorder(sql, runId, this.#ledger);
      const usage: Usage = { ...ZERO };
      const abort = signal ?? new AbortController().signal;

      const onWorkstation = runsOnWorkstation(task.aiRuntimeId);
      const target =
         (await resolveTarget(sql, task.workspaceId, task.runtimeId, this.#o.defaultTarget)) ??
         (onWorkstation ? WORKSTATION_TARGET : null);
      if (!target) {
         return this.#fail(task, recorder, usage, { code: 'RUNTIME_UNCONFIGURED', message: 'No agent runtime is configured for this workspace.', retryable: false });
      }
      if (task.aiRuntimeId) {
         const workstation = this.#o.workstation;
         const control = this.#o.transport.control;
         if (onWorkstation && !workstation) {
            return this.#fail(task, recorder, usage, {
               code: 'AI_RUNTIME_INCOMPATIBLE',
               message: 'This AI runtime runs on this workstation, and that process is not available.',
               retryable: false,
            });
         }
         if (!onWorkstation && !control) {
            return this.#fail(task, recorder, usage, {
               code: 'AI_RUNTIME_INCOMPATIBLE',
               message: 'The selected compute host cannot verify personal AI runtime adapters. Update its runtime image.',
               retryable: false,
            });
         }
         let checked: RuntimeControlResponse;
         try {
            const request = {
               runtimeSessionId: runtimeSessionIdFor(`adapter-preflight:${runId}`),
               operation: 'availability' as const,
               runtimeId: task.aiRuntimeId,
               credential: null,
            };
            checked = onWorkstation && workstation
               ? await workstation.control(request, abort)
               : await control!({
                    target,
                    request,
                    signal: abort,
                 });
         } catch (error) {
            return this.#fail(task, recorder, usage, {
               code: 'AI_RUNTIME_UNAVAILABLE',
               message: error instanceof Error ? error.message : 'The selected runtime host could not be verified.',
               retryable: true,
            });
         }
         const availability = 'error' in checked ? null : checked.availability;
         if (
            'error' in checked ||
            !availability?.available ||
            availability.protocolVersion !== AI_RUNTIME_ADAPTER_PROTOCOL_VERSION ||
            availability.principalIsolation === 'shared_process'
         ) {
            return this.#fail(task, recorder, usage, {
               code: 'AI_RUNTIME_INCOMPATIBLE',
               message:
                  ('error' in checked ? checked.error.message : availability?.reason) ??
                  'The selected compute host does not provide the required isolated AI runtime adapter protocol.',
               retryable: false,
            });
         }
      }

      let envelopeSession = '';
      let log: ExchangeLog | null = null;
      let detached = false;
      try {
         const token = await mintTaskToken(sql, {
            runId, workspaceId: task.workspaceId, agentId: task.agentId,
            scopes: task.kind === 'completion' ? [] : ['task:read', 'task:write'],
            ttlSeconds: this.#o.tokenTtlSeconds ?? 28_800,
         });
         let built: Awaited<ReturnType<EnvelopeBuilder['build']>>;
         try {
            built = await this.#o.builder.build({ task, dispatch: task.issueId ? (dispatch as Dispatch) : null, token });
         } catch (error) {
            return await this.#fail(
               task,
               recorder,
               usage,
               error instanceof AiRuntimeEnvelopeError
                  ? { code: error.code, message: error.message, retryable: error.retryable }
                  : {
                       code: 'TASK_PREPARATION_FAILED',
                       message: error instanceof Error ? error.message : String(error),
                       retryable: false,
                    }
            );
         }
         const { envelope, delivery, model, tier } = built;
         envelopeSession = envelope.runtimeSessionId;
         const resumable: Resumable = { delivery, model, tier: tier ?? null };
         await sql`
            UPDATE runs
               SET runtime_session_id = ${envelope.runtimeSessionId}, runtime_cursor = 0,
                   runtime_resume = ${task.kind === 'agent' ? sql.json(resumable as never) : null}
             WHERE id = ${runId}`;
         // Kept for the Logs page: what was sent to the runtime and what came
         // back. A completion keeps its whole exchange. An agent run keeps the
         // envelope — the system prompt, instructions, transcript and tools its
         // model starts from — and the shape of its stream, not the thousands
         // of text deltas its own run log already holds (`agentLogEvent`).
         log = exchangeLog(
            sql,
            { runId, workspaceId: task.workspaceId, envelope },
            {
               ...(this.#o.clock ? { clock: this.#o.clock } : {}),
               ...(this.#o.onExchangeLogError ? { onError: this.#o.onExchangeLogError } : {}),
               ...(task.kind === 'completion' ? {} : { keep: agentLogEvent }),
            }
         );

         const stream =
            onWorkstation && this.#o.workstation
               ? this.#o.workstation.invoke(envelope, abort)
               : this.#o.transport.invoke({ target, envelope, signal: abort, observe: log?.observer });
         const outcome = await this.#consume(
            { task, recorder, usage, target, session: envelopeSession, abort, log, cursor: 0, resumed: false, ...resumable },
            stream
         );
         if (outcome === null) detached = true;
         return outcome;
      } catch (error) {
         if (isDetached(abort)) {
            detached = true;
            return null;
         }
         if (abort.aborted) return await this.#cancel(task, recorder, usage, target, envelopeSession);
         if (error instanceof RuntimeUnavailable) {
            log?.failed(error.message);
            return await this.#fail(task, recorder, usage, { code: 'RUNTIME_UNAVAILABLE', message: error.message, retryable: true });
         }
         if (error instanceof LifecycleStreamError) {
            log?.failed(error.message);
            return await this.#fail(task, recorder, usage, { code: 'RUNTIME_PROTOCOL', message: error.message, retryable: true });
         }
         throw error;
      } finally {
         // A completion's session is its own and nothing reuses it, so it is
         // ended here rather than left idle on AgentCore until the idle
         // timeout reaps it: an idle session still bills its memory. A
         // cancelled one was stopped by #cancel already.
         if (task.kind === 'completion' && envelopeSession && !abort.aborted && !onWorkstation) {
            await this.#o.transport
               .stop({ target, runtimeSessionId: envelopeSession })
               .catch((error: unknown) => this.#o.onCancelError?.(error));
         }
         // A run let go of keeps its token: the runtime is still working on it
         // and calls Berry's tools with it until a process resumes the run.
         if (!detached) await revokeTaskTokens(sql, runId).catch(() => undefined);
         await log?.flush();
      }
   }

   /**
    * Collects a run another process left mid-stream: the frames after the
    * ones it recorded, from the runtime still working on it, recorded as that
    * process would have. Null when the run cannot be resumed — not an agent
    * run, not running, or no longer held by its runtime — and nothing was
    * recorded; the dispatcher then abandons it as before.
    */
   async resume(runId: string, signal: AbortSignal): Promise<TaskOutcome | null> {
      const { sql, transport } = this.#o;
      if (!transport.resume) return null;
      const [row] = await sql<Array<{ status: string; kind: string; runtime_session_id: string | null; runtime_cursor: number; runtime_resume: Resumable | null }>>`
         SELECT status, kind, runtime_session_id, runtime_cursor, runtime_resume FROM runs WHERE id = ${runId}`;
      if (!row || row.status !== 'running' || row.kind !== 'agent' || !row.runtime_session_id || !row.runtime_resume) return null;
      const task = await loadTask(sql, runId);
      if (runsOnWorkstation(task.aiRuntimeId)) return null;
      const target = await resolveTarget(sql, task.workspaceId, task.runtimeId, this.#o.defaultTarget);
      if (!target) return null;
      const session = row.runtime_session_id;
      const recorder: TaskRecorder = task.issueId ? ledgerRecorder(this.#ledger, runId, true) : directRecorder(sql, runId, this.#ledger);
      const usage: Usage = { ...ZERO };
      const stream = transport.resume({ target, runtimeSessionId: session, runId, after: row.runtime_cursor, signal })[Symbol.asyncIterator]();
      let first: IteratorResult<LifecycleEvent>;
      try {
         first = await stream.next();
      } catch (error) {
         if (error instanceof RunNotResumable) return null;
         throw error;
      }
      let detached = false;
      try {
         const outcome = await this.#consume(
            { task, recorder, usage, target, session, abort: signal, log: null, cursor: row.runtime_cursor, resumed: true, ...row.runtime_resume },
            prepend(first, stream)
         );
         if (outcome === null) detached = true;
         return outcome;
      } catch (error) {
         if (isDetached(signal)) {
            detached = true;
            return null;
         }
         if (signal.aborted) return await this.#cancel(task, recorder, usage, target, session);
         if (error instanceof RuntimeUnavailable) {
            return await this.#fail(task, recorder, usage, { code: 'RUNTIME_UNAVAILABLE', message: error.message, retryable: true });
         }
         if (error instanceof LifecycleStreamError) {
            return await this.#fail(task, recorder, usage, { code: 'RUNTIME_PROTOCOL', message: error.message, retryable: true });
         }
         throw error;
      } finally {
         if (!detached) await revokeTaskTokens(sql, runId).catch(() => undefined);
      }
   }

   /**
    * Records a run's lifecycle stream: each frame as the ledger write it
    * stands for, until a terminal frame ends the run. Counts the frames and
    * saves the count, so a process that resumes the run asks for what comes
    * after. Null when this process let go of the run (`Detached`).
    */
   async #consume(run: Consuming, events: AsyncIterable<LifecycleEvent>): Promise<TaskOutcome | null> {
      const { sql } = this.#o;
      const { abort } = run;
      const runId = run.task.runId;
      let cursor = run.cursor;
      let savedAt = 0;
      const save = async (force: boolean) => {
         const now = Date.now();
         if (!force && now - savedAt < CURSOR_SAVE_MS) return;
         savedAt = now;
         await sql`UPDATE runs SET runtime_cursor = ${cursor} WHERE id = ${runId}`.catch(() => undefined);
      };
      try {
         return await this.#record(run, events, async () => {
            cursor += 1;
            // The first frame at once, so a resume never replays the start.
            await save(cursor === 1);
         });
      } catch (error) {
         if (!isDetached(abort)) throw error;
      }
      await save(true);
      return null;
   }

   /** The frames, recorded in order; `advance` after each one that does not end the run. */
   async #record(run: Consuming, events: AsyncIterable<LifecycleEvent>, advance: () => Promise<void>): Promise<TaskOutcome> {
      const { sql } = this.#o;
      const { task, recorder, usage, target, abort, log, delivery, model, tier } = run;
      const runId = task.runId;
      let verified: Extract<TaskMessage, { kind: 'verified' }> | null = null;
      const usageEvents = new Set<string>();
      for await (const event of events) {
         log?.event(event);
         if (abort.aborted) break;
         if (event.type === 'task.started') {
            // A resumed run started long ago; only a fresh one is moved to running.
            if (!run.resumed) await recorder.started();
         } else if (event.type === 'task.message') {
            if (event.message.kind === 'verified') verified = event.message;
            await recorder.message(event.message);
         } else if (event.type === 'task.usage') {
            if (!(event.usage.eventId && usageEvents.has(event.usage.eventId))) {
               if (event.usage.eventId) usageEvents.add(event.usage.eventId);
               usage.inputTokens += event.usage.inputTokens;
               usage.outputTokens += event.usage.outputTokens;
               usage.totalTokens = usage.inputTokens + usage.outputTokens;
               await this.#o
                  .recordUsage(sql, {
                     runId, workspaceId: task.workspaceId, agentId: task.agentId,
                     ...(event.usage.eventId ? { eventId: event.usage.eventId } : {}),
                     ...(target.id ? { runtimeId: target.id } : {}),
                     model: event.usage.model || model,
                     inputTokens: event.usage.inputTokens, outputTokens: event.usage.outputTokens,
                     cacheReadTokens: event.usage.cacheReadTokens, cacheWriteTokens: event.usage.cacheWriteTokens,
                     ...(event.usage.reportedCostMicros === undefined ? {} : { reportedCostMicros: event.usage.reportedCostMicros }),
                     ...(tier ? { tier } : {}),
                     ...(event.usage.fellBack ? { fellBack: true } : {}),
                  })
                  .catch((error: unknown) => {
                     this.#o.onUsageError?.(error);
                     throw new RuntimeUnavailable('Usage could not be recorded; execution accounting is incomplete');
                  });
            }
         } else if (event.type === 'task.failed') {
            const reported = {
               code: event.failure.code,
               message: event.failure.message,
               retryable: event.failure.retryable,
               ...(event.failure.summary ? { summary: event.failure.summary } : {}),
            };
            const failure =
               event.delivery && delivery
                  ? await this.#checkpoint(task, delivery, event.delivery, reported)
                  : reported;
            return await this.#fail(task, recorder, usage, failure);
         } else if (event.type === 'task.completed') {
            return await this.#succeed(task, recorder, usage, event.result, delivery, verified);
         }
         await advance();
      }
      if (isDetached(abort)) throw abort.reason;
      if (abort.aborted) return await this.#cancel(task, recorder, usage, target, run.session);
      return await this.#fail(task, recorder, usage, STREAM_ENDED);
   }

   async #succeed(
      task: TaskRow,
      recorder: TaskRecorder,
      usage: Usage,
      result: TaskResult,
      plan: Awaited<ReturnType<EnvelopeBuilder['build']>>['delivery'],
      verified: Extract<TaskMessage, { kind: 'verified' }> | null
   ): Promise<TaskOutcome> {
      const summary = result.text === '' ? null : result.text;
      if (plan && result.delivery) {
         try {
            const credential = this.#o.gitCredential ? await this.#o.gitCredential(task.workspaceId, parseRepository(plan.fullName).owner) : null;
            const github = credential && this.#o.github ? this.#o.github(credential.password) : null;
            if (result.delivery.candidate) {
               if (!github) throw new Error('Trusted repository delivery is not configured');
               result = { ...result, delivery: await publishTrustedDelivery(this.#o.sql, task.runId, github, result.delivery) };
            } else {
               const [snapshot] = await this.#o.sql`SELECT run_id FROM run_repository_snapshots WHERE run_id = ${task.runId}`;
               if (snapshot) throw new Error('Runtime did not return a delivery candidate; update the runtime image');
            }
            if (!result.delivery) throw new Error('Delivery did not return a result');
            await recordDelivery({
               sql: this.#o.sql,
               ledger: this.#ledger,
               github,
               runId: task.runId,
               plan,
               delivery: result.delivery,
               summary,
               verified,
            });
         } catch (error) {
            return this.#fail(task, recorder, usage, {
               code: 'DELIVERY_FAILED',
               message: `Repository delivery could not finish: ${error instanceof Error ? error.message : String(error)}`,
               // A missing repository stays failed. A git-data 404 is also how
               // GitHub reports a token that cannot write workflow files, and
               // that one is fixed by reconnecting, so it is tried once more.
               retryable: gitWriteInvisible(error),
            });
         }
      }
      const [opened] = plan
         ? await this.#o.sql<Array<{ pull_request_number: number | null }>>`
              SELECT pull_request_number FROM runs WHERE id = ${task.runId}`
         : [];
      if (
         emptyRepositoryRun({
            repository: Boolean(plan),
            summary,
            delivery: result.delivery,
            pullRequest: opened?.pull_request_number ?? null,
         })
      ) {
         return this.#fail(task, recorder, usage, {
            code: 'EMPTY_RUN',
            message: 'The run finished without a report and without changing the repository.',
            retryable: true,
         });
      }
      // Persist before publishing success. The worker only admits succeeded parents.
      if (task.issueId && this.#o.reviewGate) await scheduleReview(this.#o.sql, task.runId);
      await recorder.succeeded({ summary, usage, result });
      if (task.issueId) {
         if (summary) {
            await this.#memory.record({ agentId: task.agentId, issueId: task.issueId, role: 'ASSISTANT', text: summary, runId: task.runId });
            await postRunResult(this.#o.sql, {
               issueId: task.issueId, agentId: task.agentId, text: result.text, cut: result.truncated,
               occurredAt: (this.#o.clock ?? (() => new Date()))().toISOString(), newId: this.#o.newId ?? randomUUID,
               runId: task.runId,
            }).catch(() => null);
         }
      }
      return { runId: task.runId, status: 'succeeded', summary, usage, result };
   }

   /**
    * Publishes the work a failed run had done — a run stopped at its step or
    * output limit — to the task's branch, and says where it went.
    *
    * The same trusted path as a finished run, with one difference: no pull
    * request. Unfinished work is kept, not proposed. The next run on the task
    * starts from the branch head (see the repository snapshot), so it carries
    * on instead of starting over. Must run before the run is marked failed:
    * publication is only allowed while the run is still running.
    */
   async #checkpoint(
      task: TaskRow,
      plan: NonNullable<Awaited<ReturnType<EnvelopeBuilder['build']>>['delivery']>,
      candidate: TaskDelivery,
      failure: Failure
   ): Promise<Failure> {
      try {
         const credential = this.#o.gitCredential ? await this.#o.gitCredential(task.workspaceId, parseRepository(plan.fullName).owner) : null;
         const github = credential && this.#o.github ? this.#o.github(credential.password) : null;
         if (!github) throw new Error('repository delivery is not configured');
         const published = await publishTrustedDelivery(this.#o.sql, task.runId, github, candidate);
         if (!published.committed || !published.commit) {
            return { ...failure, message: `${failure.message} It had not changed any files yet.` };
         }
         await recordDelivery({
            sql: this.#o.sql,
            ledger: this.#ledger,
            github: null,
            runId: task.runId,
            plan: { ...plan, mayOpenPullRequest: false },
            delivery: published,
            summary: null,
            verified: null,
         });
         const count = published.filesChanged;
         return {
            ...failure,
            message:
               `${failure.message} Its work so far is saved on branch ${plan.branch} ` +
               `(${count} file${count === 1 ? '' : 's'}, commit ${published.commit.slice(0, 7)}); ` +
               'running the task again continues from there.',
         };
      } catch (error) {
         return {
            ...failure,
            message: `${failure.message} Its repository work could not be saved: ${error instanceof Error ? error.message : String(error)}`,
         };
      }
   }

   async #fail(task: TaskRow, recorder: TaskRecorder, usage: Usage, failure: Failure): Promise<TaskOutcome> {
      await recorder.failed({ failure, usage });
      // After the run is recorded as ended, because a task admits one run at a
      // time; before the comment, so the comment can say what happens next.
      const next = await this.#continue(task, failure);
      const retry = await this.#retry(task, failure);
      if (next?.continued) {
         // Paused, not failed: the reason every view of the run shows says so.
         // The task's activity feed does not. A limit stop is a fresh run, and
         // the summary travels in that run's instructions.
         await this.#o.sql`UPDATE runs SET failure_message = ${continuedMessage(next)} WHERE id = ${task.runId}`.catch(() => null);
      }
      if (task.issueId && failure.code !== LIMIT_CODE) {
         // A retryable failure used to post nothing, which left a task back in
         // To do with no word of why. It is reported like any other now, with
         // what Berry did about it. A step-limit stop is the exception: it
         // summarizes and starts a fresh run, and that is not a comment.
         await postRunResult(this.#o.sql, {
            issueId: task.issueId, agentId: task.agentId, runId: task.runId,
            text: `This run failed (${failure.code}). ${failure.message}${retry ? retryNote(retry) : ''}`,
            cut: false,
            occurredAt: new Date().toISOString(),
         }).catch(() => null);
         await this.#memory.record({
            agentId: task.agentId, issueId: task.issueId, role: 'ASSISTANT',
            text: `An earlier run failed with ${failure.code}: ${failure.message}`, runId: task.runId,
         });
      }
      return { runId: task.runId, status: 'failed', summary: null, usage, failure };
   }

   /**
    * Queues the next segment of a task that was stopped at its limit while it
    * was still getting somewhere. Never fails the failure: a continuation that
    * cannot be queued leaves the run exactly as it was, for a person to rerun.
    */
   async #continue(task: TaskRow, failure: Failure): Promise<ContinuationOutcome | null> {
      if (failure.code !== LIMIT_CODE || !task.issueId) return null;
      try {
         return await continueAfterLimit(this.#o.sql, {
            runId: task.runId,
            ...(failure.summary ? { summary: failure.summary } : {}),
            ...(this.#o.maxContinuations === undefined ? {} : { maxContinuations: this.#o.maxContinuations }),
         });
      } catch (error) {
         this.#o.onContinuationError?.(error);
         return null;
      }
   }

   /** Queues the task once more after a fault outside it; never fails the failure. */
   async #retry(task: TaskRow, failure: Failure): Promise<RetryOutcome | null> {
      if (!failure.retryable || !task.issueId || task.kind !== 'agent') return null;
      try {
         return await retryAfterFault(this.#o.sql, { runId: task.runId });
      } catch (error) {
         this.#o.onContinuationError?.(error);
         return null;
      }
   }

   async #cancel(task: TaskRow, recorder: TaskRecorder, usage: Usage, target: RuntimeTarget, session: string): Promise<TaskOutcome> {
      // StopRuntimeSession ends a session later runs may have reused; the
      // cold path restores it from the transcript (spec 2.2a).
      //
      // A stop that fails must not strand the run. The HTTP transport throws on
      // a refused, mismatched or unreachable endpoint, and letting that
      // propagate would leave the row `running` behind a lease nobody renews —
      // so a cancellation someone asked for would reappear as an abandoned
      // retryable failure a sweep later. The session is the runtime's to reap;
      // the run's own ending is ours, and it is recorded either way.
      if (session && !runsOnWorkstation(task.aiRuntimeId)) {
         await this.#o.transport
            .stop({ target, runtimeSessionId: session })
            .catch((error: unknown) => this.#o.onCancelError?.(error));
      }
      await recorder.cancelled(usage);
      return { runId: task.runId, status: 'cancelled', summary: null, usage };
   }
}

/** The claim for a task with no issue: the same one-shot transition the ledger makes. */
async function claimDirect(sql: Sql, runId: string): Promise<null> {
   const rows = await sql`
      UPDATE runs SET dispatch_state = 'dispatching', dispatch_version = dispatch_version + 1,
             dispatch_attempted_at = now(), updated_at = now()
       WHERE id = ${runId} AND status = 'queued' AND dispatch_state = 'pending'
       RETURNING id`;
   if (rows.length === 0) throw new Error(`run ${runId} is not claimable`);
   return null;
}

export async function resolveTarget(
   sql: Sql,
   workspaceId: string,
   runtimeId: string | null,
   fallback: RuntimeTarget | null
): Promise<RuntimeTarget | null> {
   if (!runtimeId) return fallback;
   // `agents.runtime_id` is a plain FK; a runtime of another workspace is never used.
   const [row] = await sql`
      SELECT id, kind, driver, arn, qualifier, region, endpoint_url, status FROM agent_runtimes
       WHERE id = ${runtimeId} AND workspace_id = ${workspaceId}`;
   if (!row || row.status === 'disabled') return fallback;
   // The platform row names no target of its own: it is the configured default.
   if (row.kind === 'platform' || (!row.arn && !row.endpoint_url)) {
      return fallback ? { ...fallback, id: row.id as string } : null;
   }
   return {
      id: row.id as string,
      driver: row.driver as RuntimeTarget['driver'],
      arn: (row.arn as string | null) ?? null,
      qualifier: (row.qualifier as string | null) ?? 'DEFAULT',
      region: (row.region as string | null) ?? null,
      endpointUrl: (row.endpoint_url as string | null) ?? null,
   };
}
