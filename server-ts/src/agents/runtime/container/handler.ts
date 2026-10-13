import { createHash, randomUUID } from 'node:crypto';
import { statfs } from 'node:fs/promises';
import type { AwsCredentials } from '../model.ts';
import { join } from 'node:path';
import type { McpClient, Tool } from '@strands-agents/sdk';
import type { TaskEnvelope } from '../../../runtime/envelope.ts';
import type { TaskDelivery } from '../../../runtime/lifecycle.ts';
import type { ExecutionSession } from '../../../execution/driver.ts';
import { runCommandTool, WORKDIR_KEY } from '../command-tool.ts';
import { withKiroAliases } from '../kiro-aliases.ts';
import { pageTools } from '../page-tools.ts';
import { repositoryTools } from '../repository-tools.ts';
import { readSkillTool } from '../skill-tool.ts';
import { permissionsOf, type Permission } from '../../permissions.ts';
import { buildRunAgent } from '../agent.ts';
import { classify } from '../failure.ts';
import type { ModelFactory } from '../model.ts';
import { AccountingPlugin } from '../plugins/accounting.ts';
import { emitModelUsage } from './usage.ts';
import { LedgerPlugin } from '../plugins/ledger.ts';
import { PermissionPlugin, TOOL_PERMISSIONS } from '../plugins/permissions.ts';
import { RepetitionPlugin } from '../plugins/repetition.ts';
import {
   REPORT_BLOCKED,
   StepBudgetPlugin,
   blockedMessage,
   budgetContract,
   reportBlockedTool,
   summarizeTool,
   type Blocked,
   type Handoff,
} from '../plugins/step-budget.ts';
import { LIST_RUN_TOOLS, RunToolsPlugin, listRunToolsTool } from '../run-tools.ts';
import { ToolOutcomePlugin } from '../plugins/tool-outcome.ts';
import { MAX_SUMMARY_BYTES } from '../result-text.ts';
import { truncateUtf8 } from '../utf8.ts';
import { runCompletionTask } from './completion-task.ts';
import { runRuntimeCompletion } from './runtime-completion.ts';
import { toConversation } from './conversation.ts';
import { emitterSink, type Emit } from './emitter.ts';
import { LocalSession } from './local-session.ts';
import type { SessionIdentity } from './session-identity.ts';
import { mediaTools, type VideoOutput } from '../tools/media.ts';
import {
   RemoteToolsUnavailable,
   callAttach,
   collectFileTool,
   loadRemoteTools,
   restoreTaskFiles,
   restoredNote,
   type BerryApi,
   type RestoredFiles,
   type WorkspaceMirror,
} from './remote-tools.ts';
import { CallerGone, type SessionRegistry } from './sessions.ts';
import {
   loadMcpClients,
   mcpToolPermissions,
   registrableMcpTools,
   type EnvelopeMcpServerLike,
   type Warn,
} from '../mcp-clients.ts';
import { writeSkills } from '../skill-files.ts';
import type { RuntimeAdapterRegistry } from '../adapters/registry.ts';
import { RuntimeAdapterError } from '../adapters/types.ts';

/**
 * One task envelope, worked to a terminal lifecycle event.
 *
 * Warm or cold is decided here and nowhere else. The same envelope works
 * either way — it always carries the transcript — and only speed differs: a
 * warm session keeps its full Strands messages (tool calls included), a cold
 * one restores the text of earlier turns from what Berry recorded.
 */

export interface RepositoryStep {
   /** Clones or refreshes the checkout; returns its directory, or null without a repo. */
   prepare(input: { envelope: TaskEnvelope; session: LocalSession; warm: boolean; emit: Emit; signal?: AbortSignal }): Promise<string | null>;
   deliver(input: {
      envelope: TaskEnvelope;
      session: LocalSession;
      directory: string;
      summary: string | null;
      emit: Emit;
      signal?: AbortSignal;
      /** A checkpoint of unfinished work: collected as-is, without running the verify commands. */
      checkpoint?: boolean;
   }): Promise<TaskDelivery | null>;
   /** What the checkout's toolchain already is, for the agent's first message; empty when there is nothing to say. */
   describe?(input: { session: LocalSession; directory: string }): Promise<string>;
}

export interface HandlerDeps {
   registry: SessionRegistry;
   modelFactory: ModelFactory;
   region: string;
   /**
    * The AWS credential Polly and Nova Reel render with.
    *
    * Passed explicitly rather than left to the default chain: the image ships
    * no credential file and no instance role, so a null here means every
    * media call fails with "Could not load credentials from any providers"
    * while the model itself works, because the model is handed the same
    * credential through modelFactory.
    */
   credentials?: AwsCredentials | null;
   /** Where session workspaces live: `/mnt/workspace` in the image. */
   workRoot: string;
   /**
    * A Unix user per session, when one runtime serves many sessions (a local
    * container). Absent on AgentCore, where the microVM is the boundary.
    */
   identities?: { for(key: string): Promise<SessionIdentity> };
   fetch?: typeof fetch;
   loadTools?: (api: BerryApi, mirror?: WorkspaceMirror) => Promise<Tool[]>;
   repository?: RepositoryStep;
   /** Where the video job writes. Absent means agents get no video tool. */
   videoOutput?: VideoOutput | undefined;
   /** Bytes free under the work root, or null when it cannot be read. Injected by tests. */
   freeBytes?: (path: string) => Promise<number | null>;
   /** Connects the agent's MCP servers. Injected by tests; production uses Strands clients. */
   loadMcp?: (servers: EnvelopeMcpServerLike[]) => Promise<McpClient[]>;
   /** Provider-owned agent processes available in this runtime image. */
   adapters?: RuntimeAdapterRegistry;
   /** Where a dropped MCP tool is reported. Defaults to a JSON line on stderr. */
   warn?: Warn;
}

const consoleWarn: Warn = (message, fields) => console.warn(JSON.stringify({ level: 'WARN', msg: message, ...fields }));

/**
 * The free space a run needs on the workspace volume before it starts.
 *
 * An install fills a nearly full volume partway, and the agent then spends
 * its steps on `du`, `df` and deleting what it can reach — once
 * `sudo rm -rf /usr/local/lib/node_modules` — instead of the task. Refused at
 * the start, the run fails as a fault outside the task and is retried.
 */
export const MIN_FREE_WORKSPACE_BYTES = 2 * 1024 ** 3;

async function statfsFree(path: string): Promise<number | null> {
   try {
      const stats = await statfs(path);
      return Number(stats.bavail) * Number(stats.bsize);
   } catch {
      return null;
   }
}

/** Stop reasons that mean a ceiling was reached rather than the work ending. */
const LIMIT_STOPS: readonly string[] = ['limitTurns', 'limitOutputTokens', 'limitTotalTokens', 'maxTokens'];

/**
 * Which ceiling, and how high it was.
 *
 * "Reached its configured limit" was the same sentence for four different stops
 * and named none of them, so the one question it raised — which limit, set to
 * what — could only be answered by reading the agent's contract. It also sent
 * the reader to "the recorded work", which for a chat run is a handful of
 * progress lines. Say the number instead, and say that the work already done
 * stands: a run cut on its last turn has usually finished the job.
 */
function limitMessage(stopReason: string, agent: TaskEnvelope['agent'], checkpointed: boolean): string {
   const turns = stopReason === 'limitTurns';
   const ceiling = turns ? agent.maxTurns : agent.maxOutputTokens;
   const raise = turns ? 'step limit' : 'output limit';
   const reached = !ceiling
      ? `Stopped at this agent's ${raise}`
      : turns
        ? `Stopped after ${ceiling} step${ceiling === 1 ? '' : 's'}, this agent's limit`
        : `Stopped after ${ceiling} tokens written, this agent's limit`;
   // Honest about what survives. Work done through Berry (comments, task
   // updates, links) was written as it happened. Repository work goes back as
   // a checkpoint, and the control plane says where it landed; without one
   // there was nothing to save.
   const kept = checkpointed ? '' : ' What it did through Berry stands.';
   return `${reached}.${kept} Raise the ${raise} on the agent, or split the task into smaller ones.`;
}

export async function handleInvocation(
   envelope: TaskEnvelope,
   emit: Emit,
   deps: HandlerDeps,
   /** Aborted when the caller disconnects: the run is then stopped, or never started. */
   caller?: AbortSignal
): Promise<void> {
   let ended = false;
   const say: Emit = (event) => {
      if (ended) return;
      if (event.type === 'task.completed' || event.type === 'task.failed') ended = true;
      emit(event);
   };
   if (envelope.kind === 'completion' && envelope.runtime) {
      await deps.registry
         .exclusive(
            envelope.runtimeSessionId,
            (signal) => runRuntimeCompletion(envelope, say, deps, signal),
            caller
         )
         .catch(ignoreCallerGone);
      return;
   }
   if (envelope.kind === 'completion') {
      // Fresh by construction: no registry, so nothing warm is read or kept.
      await deps.registry
         .exclusive(envelope.runtimeSessionId, (signal) => runCompletionTask(envelope, say, deps, signal), caller)
         .catch(ignoreCallerGone);
      return;
   }
   await deps.registry
      .exclusive(envelope.runtimeSessionId, (signal) => runAgentTask(envelope, say, deps, signal), caller)
      .catch(ignoreCallerGone);
}

/** Nobody is listening for an invocation whose caller left before it started. */
function ignoreCallerGone(error: unknown): void {
   if (error instanceof CallerGone) return;
   throw error;
}

async function runAgentTask(envelope: TaskEnvelope, emit: Emit, deps: HandlerDeps, signal: AbortSignal): Promise<void> {
   emit({ type: 'task.started' });
   const key = envelope.runtimeSessionId;
   const fingerprint = agentFingerprint(envelope);
   const held = deps.registry.get(key);
   const warm = held !== undefined && held.fingerprint === fingerprint;
   // Files survive a warm turn; credentials and execution configuration do not.
   const identity = deps.identities ? await deps.identities.for(key) : undefined;
   const workspace = new LocalSession({ id: key, root: join(deps.workRoot, key), env: envelope.env, signal, ...(identity ? { identity } : {}) });
   const sink = emitterSink(emit);
   // Each model call's usage goes out as it happens: a running task shows its
   // tokens, model and cost, and a run cut off keeps what it already spent.
   const accounting = new AccountingPlugin({
      onCall: (entry) => emitModelUsage(emit, envelope.agent.model, [entry]),
   });
   const ledger = new LedgerPlugin({ ledger: sink, runId: envelope.runId });
   const outcome = new ToolOutcomePlugin();
   const api: BerryApi = { ...envelope.berry, ...(deps.fetch ? { fetch: deps.fetch } : {}) };
   let mcpClients: McpClient[] = [];

   try {
      const free = await (deps.freeBytes ?? statfsFree)(deps.workRoot);
      if (free !== null && free < MIN_FREE_WORKSPACE_BYTES) {
         emit({
            type: 'task.failed',
            failure: {
               code: 'WORKSPACE_DISK_FULL',
               message: `The runtime's workspace volume has ${(free / 1024 ** 3).toFixed(1)} GiB free, under the ${MIN_FREE_WORKSPACE_BYTES / 1024 ** 3} GiB a run needs. Free space on the runtime host and run the task again.`,
               retryable: true,
            },
         });
         return;
      }
      // The agent's skills, under `.berry/skills/` so Claude, Codex and
      // Kiro do not attach every file to the model prompt. Bedrock and
      // Kilo read a skill only through `read_skill`. MCP servers become
      // Strands clients beside Berry's own tools.
      await writeSkills(join(deps.workRoot, key), envelope.agent.skills, (target, content) => workspace.writeFile(target, content));
      // Injected loaders keep their single-arg shape; the production loader
      // bounds each connect and reports a server it had to drop.
      const warn = deps.warn ?? consoleWarn;
      mcpClients = deps.loadMcp
         ? await deps.loadMcp(envelope.agent.mcpServers)
         : await loadMcpClients(envelope.agent.mcpServers, undefined, warn);
      // Whatever the loader threw, a task that cannot read its tools never
      // runs toolless: it fails retryable, as Berry being unreachable.
      const session = async (): Promise<ExecutionSession> => workspace;
      // Whether the run commits its checkout is known once it is prepared;
      // a file tool reads it when it is called, not when it is loaded.
      const mirror: WorkspaceMirror = { session, warn, committed: false };
      const remote = await (deps.loadTools ?? loadRemoteTools)(api, mirror).catch((cause: unknown) => {
         if (cause instanceof RemoteToolsUnavailable) throw cause;
         throw new RemoteToolsUnavailable(
            `could not load Berry's tools: ${cause instanceof Error ? cause.message : String(cause)}`
         );
      });
      const handoff: Handoff = { open: false, summary: null, blocked: null };
      const budget = new StepBudgetPlugin({ maxTurns: envelope.agent.maxTurns, handoff });
      const dependsOn = envelope.task.dependencies.filter((dependency) => dependency.direction === 'depends_on');
      // Stopped for a task it depends on. What it did so far is kept as a
      // checkpoint, as at the step limit; the task waits in To do until the
      // task it named is done, and is not retried before then.
      const emitBlocked = async (blocked: Blocked, directory: string | null): Promise<void> => {
         const message = blockedMessage(blocked);
         const checkpoint =
            deps.repository && directory
               ? await deps.repository
                    .deliver({ envelope, session: workspace, directory, summary: message, emit, signal, checkpoint: true })
                    .catch(() => null)
               : null;
         emit({
            type: 'task.failed',
            failure: { code: 'TASK_BLOCKED', message, retryable: false },
            ...(checkpoint ? { delivery: checkpoint } : {}),
         });
      };
      const tools: Tool[] = [
         runCommandTool({ ledger: sink, runId: envelope.runId, session, newId: randomUUID }),
         summarizeTool(handoff),
         ...(dependsOn.length ? [reportBlockedTool(handoff, dependsOn)] : []),
         ...pageTools({ ledger: sink, runId: envelope.runId, session, newId: randomUUID }),
         collectFileTool(api, session),
         ...repositoryTools(session),
         readSkillTool(envelope.agent.skills),
         // Not `attach_file`: here every file is in the workspace, and
         // `collect_file` puts it on the task without passing it through the
         // model. Offered both, agents base64-encoded screenshots and typed
         // hundreds of kilobytes into a tool call, minutes of silent output
         // that ended at the reply ceiling.
         ...remote.filter((entry) => entry.name !== 'attach_file'),
         // Speech and video render here, with the runtime's own role, and
         // land on the task through Berry like any other file.
         ...mediaTools({
            region: deps.region,
            credentials: deps.credentials ?? null,
            runId: envelope.runId,
            video: deps.videoOutput,
            save: async ({ path, bytes, contentType }) => {
               await callAttach(api, { path, base64: Buffer.from(bytes).toString('base64'), contentType });
            },
         }),
      ];
      // MCP tools are registered as tools, not as clients, so one whose name
      // clashes with a built-in is dropped here instead of failing the task.
      const mcp = await registrableMcpTools(
         mcpClients,
         tools.map((t) => t.name),
         warn
      );
      const table = toolTable(envelope.agent.mcpServers, mcp.listed, remote.map((t) => t.name));
      const exempt = new Set([
         'summarize',
         REPORT_BLOCKED,
         LIST_RUN_TOOLS,
         ...remote.map((entry) => entry.name),
         ...mcp.tools.map((entry) => entry.name),
      ]);
      // An agent process has no step counter and nothing that opens summarize,
      // so it is not offered there. The native loop is offered every tool and
      // PermissionPlugin refuses a call with its reason; both declare only what
      // the run can call, which is what list_run_tools is for.
      const visible = [...tools, ...mcp.tools].filter((entry) => !envelope.runtime || entry.name !== 'summarize');
      const callable = authorizedAgentTools(visible, envelope, table, exempt);
      const declaration = listRunToolsTool(
         callable.map((entry) => ({ name: entry.name, description: entry.description })),
         envelope.runtime?.id
      );

      const directory = deps.repository
         ? await deps.repository.prepare({ envelope, session: workspace, warm, emit, signal })
         : null;
      const delivers = directory !== null && envelope.repo !== null && envelope.repo !== undefined && !envelope.repo.readOnly;
      mirror.committed = delivers;

      if (envelope.runtime) {
         if (envelope.runtime.executionMode !== 'agent_process') {
            throw new RuntimeAdapterError(
               'RUNTIME_PROTOCOL',
               `${envelope.runtime.id} is not an agent-process runtime.`,
               false
            );
         }
         const adapter = deps.adapters?.agentProcess(envelope.runtime.id) ?? null;
         if (!adapter) {
            throw new RuntimeAdapterError(
               'RUNTIME_NOT_INSTALLED',
               `${envelope.runtime.id} is not installed in this runtime image.`,
               false
            );
         }
         await workspace.open();
         const restored = delivers ? await restoreTaskFiles(api, workspace, directory).catch(restoreFailed) : NOTHING_RESTORED;
         const toolchain =
            delivers && deps.repository?.describe
               ? await deps.repository.describe({ session: workspace, directory }).catch(() => '')
               : '';
         // No step-budget contract: nothing on this path counts steps or opens summarize.
         const prompt = envelope.task.prompt + restoredNote(restored) + toolchain;
         const processEnvelope: TaskEnvelope = {
            ...envelope,
            task: { ...envelope.task, prompt },
         };
         const result = await adapter.start({
            envelope: processEnvelope,
            credential: envelope.runtime.credential,
            workingDirectory: directory ?? workspace.root,
            stateDirectory: join(workspace.root, '.runtime-state', envelope.runtime.id),
            tools: sessionTools(envelope.runtime.id, [declaration, ...callable]),
            emit,
            signal,
         });
         await ledger.flush();
         const blocked = budget.blocked();
         if (blocked) {
            await emitBlocked(blocked, directory);
            return;
         }
         signal.throwIfAborted();
         const text = result.text;
         const delivery =
            deps.repository && directory
               ? await deps.repository.deliver({
                    envelope,
                    session: workspace,
                    directory,
                    summary: text === '' ? null : text,
                    emit,
                    signal,
                 })
               : null;
         signal.throwIfAborted();
         emit({
            type: 'task.completed',
            result: {
               text: truncateUtf8(text, MAX_SUMMARY_BYTES),
               truncated: Buffer.byteLength(text) > MAX_SUMMARY_BYTES,
               delivery,
            },
         });
         return;
      }

      const thinking = thinkingReporter(emit);
      const agent = buildRunAgent(
         {
            agentName: envelope.agent.name,
            model: envelope.agent.model,
            region: deps.region,
            // The runtime's execution role; there is no key in the envelope.
            credentials: null,
            systemPrompt: envelope.agent.instructions,
            tools: [declaration, ...visible],
            plugins: [
               ledger,
               accounting,
               new RunToolsPlugin(),
               new PermissionPlugin({
                  permissions: permissionsOf(envelope.agent.permissions, envelope.agent.name),
                  table,
                  allowed: envelope.agent.tools ? new Set(envelope.agent.tools) : null,
                  exempt,
               }),
               outcome,
               // After the ledger and the outcome, which read the tool's own
               // result, not the one a notice was added to.
               new RepetitionPlugin(),
               budget,
            ],
            maxTokens: envelope.agent.maxTokens ?? undefined,
            temperature: envelope.agent.temperature ?? undefined,
            traceAttributes: { 'berry.run_id': envelope.runId, 'berry.session': envelope.sessionKey },
            sessionId: envelope.runtimeSessionId,
            fallbackModel: envelope.agent.fallbackModel ?? null,
            messages: warm && held ? held.messages : toConversation(envelope.transcript),
            onReasoning: thinking,
         },
         deps.modelFactory
      );
      if (directory) agent.appState.set(WORKDIR_KEY, directory);

      // After the baseline is committed, so what is put back counts as this run's
      // change and is delivered. Never for a read-only checkout, which delivers
      // nothing; and never fatal — a task that cannot list its files still runs.
      const restored = delivers ? await restoreTaskFiles(api, workspace, directory).catch(restoreFailed) : NOTHING_RESTORED;
      // Never fatal either: without it the agent finds the same out by itself.
      const toolchain =
         delivers && deps.repository?.describe
            ? await deps.repository.describe({ session: workspace, directory }).catch(() => '')
            : '';

      const result = await agent.invoke(envelope.task.prompt + restoredNote(restored) + toolchain + budgetContract(envelope.agent.maxTurns), {
         cancelSignal: signal,
         limits: {
            ...(envelope.agent.maxTurns ? { turns: envelope.agent.maxTurns } : {}),
            ...(envelope.agent.maxOutputTokens ? { outputTokens: envelope.agent.maxOutputTokens } : {}),
         },
      });
      thinking.flush();
      await ledger.flush();
      const blocked = budget.blocked();
      if (blocked) {
         deps.registry.drop(key);
         await emitBlocked(blocked, directory);
         return;
      }
      const summary = budget.summary();
      // A summary near the limit ends the run on purpose, with stopReason endTurn.
      // It is still a limit stop: the next run starts fresh from the summary.
      if (summary || LIMIT_STOPS.includes(result.stopReason)) {
         deps.registry.drop(key);
         // The work so far goes back as a checkpoint rather than dying with the
         // workspace: a run stopped mid-scaffold otherwise loses every file it
         // wrote, and the next run on the task starts from the branch this
         // lands on. A checkpoint that cannot be collected is not a second
         // failure — the limit is still what ended the run.
         const checkpoint =
            deps.repository && directory
               ? await deps.repository
                    .deliver({ envelope, session: workspace, directory, summary, emit, signal, checkpoint: true })
                    .catch(() => null)
               : null;
         emit({
            type: 'task.failed',
            failure: {
               code: 'RUN_LIMIT_REACHED',
               message: summary
                  ? 'The agent summarized near its step limit. The next run starts fresh from that summary.'
                  : limitMessage(result.stopReason, envelope.agent, checkpoint !== null),
               retryable: false,
               ...(summary ? { summary } : {}),
            },
            ...(checkpoint ? { delivery: checkpoint } : {}),
         });
         return;
      }
      if (signal.aborted || result.stopReason === 'cancelled') {
         deps.registry.drop(key);
         emit({ type: 'task.failed', failure: { code: 'RUN_CANCELLED', message: 'The session was stopped.', retryable: false } });
         return;
      }
      const fatal = outcome.fatal();
      if (fatal) {
         deps.registry.drop(key);
         emit({ type: 'task.failed', failure: { code: fatal.code, message: fatal.message, retryable: false } });
         return;
      }

      deps.registry.set({ key, fingerprint, messages: agent.messages, workspace, lastUsedAt: Date.now() });
      const [text, cut] = accounting.snapshot().result.final();
      const delivery =
         deps.repository && directory
            ? await deps.repository.deliver({ envelope, session: workspace, directory, summary: text === '' ? null : text, emit, signal })
            : null;
      signal.throwIfAborted();
      emit({
         type: 'task.completed',
         result: { text: truncateUtf8(text, MAX_SUMMARY_BYTES), truncated: cut || Buffer.byteLength(text) > MAX_SUMMARY_BYTES, delivery },
      });
   } catch (error) {
      await ledger.flush().catch(() => undefined);
      // A conversation that ended mid-turn may hold a tool call with no
      // result, which the model refuses on the next invoke. Cold is safe.
      deps.registry.drop(key);
      const failure =
         error instanceof RuntimeAdapterError
            ? { code: error.code, message: error.message, retryable: error.retryable }
            : error instanceof Error && error.name === 'RemoteToolsUnavailable'
              ? { code: 'BERRY_UNREACHABLE', message: error.message, retryable: true }
              : classify(error);
      emit({ type: 'task.failed', failure });
   } finally {
      await workspace.stop();
      await Promise.all(mcpClients.map((client) => client.disconnect().catch(() => undefined)));
   }
}

const NOTHING_RESTORED: RestoredFiles = { placed: [], skipped: [] };

/** A restore that threw is reported to the agent, never fatal to the run. */
function restoreFailed(cause: unknown): RestoredFiles {
   return { placed: [], skipped: [], error: cause instanceof Error ? cause.message : String(cause) };
}

/** Kiro's built-in names, added beside the Berry tools this run already admitted. */
function sessionTools(runtimeId: string, tools: Tool[]): Tool[] {
   return runtimeId === 'kiro' ? withKiroAliases(tools) : tools;
}

/**
 * The same contract and permission intersection the Strands permission plugin
 * enforces, applied before another agent process sees a tool at all.
 */
export function authorizedAgentTools(
   tools: Tool[],
   envelope: TaskEnvelope,
   table: Record<string, Permission | null>,
   exempt: ReadonlySet<string>
): Tool[] {
   const permissions = permissionsOf(envelope.agent.permissions, envelope.agent.name);
   const allowed = envelope.agent.tools ? new Set(envelope.agent.tools) : null;
   return tools.filter((tool) => {
      if (!exempt.has(tool.name) && allowed && !allowed.has(tool.name)) return false;
      if (exempt.has(tool.name)) return true;
      const required = table[tool.name];
      if (required === undefined) return false;
      return required === null || permissions.has(required);
   });
}

/**
 * The permission table. Fail-closed stays: a name missing from it is refused.
 * Berry's own tools are admitted by name, and Berry enforces their scope. MCP
 * tools are admitted by their prefixed name: a plugin's approved tools, and
 * every tool an admin-configured server listed at load. They go first so an
 * MCP tool can never override a built-in's requirement by sharing its name.
 */
export function toolTable(
   servers: EnvelopeMcpServerLike[],
   listed: Record<string, string[]>,
   remoteNames: string[]
): Record<string, Permission | null> {
   return {
      ...mcpToolPermissions(servers, listed),
      ...TOOL_PERMISSIONS,
      ...Object.fromEntries(remoteNames.map((name) => [name, null])),
   };
}



/** What makes a warm conversation the same agent's. */
export function agentFingerprint(envelope: TaskEnvelope): string {
   const { name, instructions, model, permissions, skills, mcpServers } = envelope.agent;
   return createHash('sha256')
      .update(
         JSON.stringify({
            name,
            instructions,
            model,
            permissions: [...permissions].sort(),
            skills: skills.map((skill) => skill.name).sort(),
            mcp: mcpServers.map((server) => server.url).sort(),
         })
      )
      .digest('hex');
}

export { toConversation } from './conversation.ts';

/** How often a run that is still reasoning sends what it reasoned. */
export const THINKING_EVERY_MS = 1_000;

export interface ThinkingReporter {
   (text: string): void;
   /** Sends what is held now: the run is ending, and a timer after it would be refused. */
   flush(): void;
}

/**
 * Reasoning, as `thinking` messages: the first piece at once, then at most one
 * every `THINKING_EVERY_MS`, each with the run's reasoning total and the text
 * since the one before. What is held is sent when the interval is up even if
 * no more reasoning arrives, so the passage just before a tool call is not
 * left behind until the next one.
 */
export function thinkingReporter(emit: Emit, now: () => number = Date.now): ThinkingReporter {
   let total = 0;
   let held = '';
   let last = -Infinity;
   let timer: ReturnType<typeof setTimeout> | null = null;
   const send = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (held === '') return;
      last = now();
      const text = held;
      held = '';
      emit({ type: 'task.message', message: { kind: 'thinking', chars: total, text } });
   };
   const report = (text: string) => {
      total += text.length;
      held += text;
      const wait = THINKING_EVERY_MS - (now() - last);
      if (wait <= 0) return send();
      if (!timer) {
         timer = setTimeout(send, wait);
         timer.unref();
      }
   };
   return Object.assign(report, { flush: send });
}
