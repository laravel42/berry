import { randomUUID } from 'node:crypto';
import type { Sql } from '../db/pool.ts';
import { nullRunMemory, type RunMemory } from '../agentcore/memory.ts';
import type { GitHubClient } from '../integrations/github.ts';
import type { Executor } from '../runs/dispatcher.ts';
import { RunLedger, type Dispatch, type Failure, type Usage } from '../runs/ledger.ts';
import { postRunResult } from '../runs/result-comment.ts';
import { mintTaskToken, revokeTaskTokens } from './agent-tools/tokens.ts';
import { recordDelivery } from './delivery.ts';
import { LIMIT_CODE, continuationNote, continueAfterLimit, type ContinuationOutcome } from '../runs/continuation.ts';
import { loadTask, type EnvelopeBuilder, type TaskRow } from './envelope-builder.ts';
import { agentLogEvent, exchangeLog, type ExchangeLog } from './exchange-log.ts';
import { LifecycleStreamError, type TaskDelivery, type TaskMessage, type TaskResult } from './lifecycle.ts';
import { directRecorder, ledgerRecorder, type TaskRecorder } from './recorders.ts';
import { RuntimeUnavailable, type RuntimeTarget, type RuntimeTransport } from './transport.ts';
import { scheduleReview } from '../runs/followups.ts';
import { parseRepository } from '../agents/checkout.ts';
import { publishTrustedDelivery } from './trusted-delivery.ts';

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

const ZERO: Usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, costMicros: null, currency: null };
const STREAM_ENDED: Failure = {
   code: 'RUNTIME_STREAM_ENDED',
   message: 'The runtime stopped reporting before the task finished.',
   retryable: true,
};

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

   async execute(runId: string, signal?: AbortSignal): Promise<TaskOutcome> {
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

      const target = await resolveTarget(sql, task.workspaceId, task.runtimeId, this.#o.defaultTarget);
      if (!target) {
         return this.#fail(task, recorder, usage, { code: 'RUNTIME_UNCONFIGURED', message: 'No agent runtime is configured for this workspace.', retryable: false });
      }

      let envelopeSession = '';
      let log: ExchangeLog | null = null;
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
            return await this.#fail(task, recorder, usage, {
               code: 'TASK_PREPARATION_FAILED',
               message: error instanceof Error ? error.message : String(error),
               retryable: false,
            });
         }
         const { envelope, delivery, model } = built;
         envelopeSession = envelope.runtimeSessionId;
         await sql`UPDATE runs SET runtime_session_id = ${envelope.runtimeSessionId} WHERE id = ${runId}`;
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

         let verified: Extract<TaskMessage, { kind: 'verified' }> | null = null;
         const usageEvents = new Set<string>();
         for await (const event of this.#o.transport.invoke({ target, envelope, signal: abort, observe: log?.observer })) {
            log?.event(event);
            if (abort.aborted) break;
            if (event.type === 'task.started') await recorder.started();
            else if (event.type === 'task.message') {
               if (event.message.kind === 'verified') verified = event.message;
               await recorder.message(event.message);
            } else if (event.type === 'task.usage') {
               if (event.usage.eventId && usageEvents.has(event.usage.eventId)) continue;
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
                  })
                  .catch((error: unknown) => {
                     this.#o.onUsageError?.(error);
                     throw new RuntimeUnavailable('Usage could not be recorded; execution accounting is incomplete');
                  });
            } else if (event.type === 'task.failed') {
               const failure =
                  event.delivery && delivery
                     ? await this.#checkpoint(task, delivery, event.delivery, event.failure)
                     : event.failure;
               return await this.#fail(task, recorder, usage, failure);
            } else if (event.type === 'task.completed') {
               return await this.#succeed(task, recorder, usage, event.result, delivery, verified);
            }
         }
         if (abort.aborted) return await this.#cancel(task, recorder, usage, target, envelopeSession);
         return await this.#fail(task, recorder, usage, STREAM_ENDED);
      } catch (error) {
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
         await revokeTaskTokens(sql, runId).catch(() => undefined);
         await log?.flush();
      }
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
               retryable: false,
            });
         }
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
      if (task.issueId) {
         if (!failure.retryable) {
            await postRunResult(this.#o.sql, {
               issueId: task.issueId, agentId: task.agentId,
               text: `This run failed (${failure.code}). ${failure.message}${next ? continuationNote(next) : ''}`, cut: false,
               occurredAt: new Date().toISOString(),
            }).catch(() => null);
         }
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
            ...(this.#o.maxContinuations === undefined ? {} : { maxContinuations: this.#o.maxContinuations }),
         });
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
      if (session) {
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
