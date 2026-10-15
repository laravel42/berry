import { z } from 'zod';
import type { Sql } from '../db/pool.ts';
import type { RunMemory } from '../agentcore/memory.ts';
import { recallPrompt } from '../agentcore/memory.ts';
import type { GitHubClient } from '../integrations/github.ts';
import type { Sealer } from '../integrations/sealing.ts';
import { branchName, parseRepository } from '../agents/checkout.ts';
import { permissionsOf } from '../agents/permissions.ts';
import { buildMessage, lastRejection } from '../agents/prompt.ts';
import { repositoryForIssue } from '../agents/repository-context.ts';
import { loadIssue } from '../agents/repository-run.ts';
import { toolsForAgentRow } from '../organization/enforcement.ts';
import type { Dispatch } from '../runs/ledger.ts';
import { CLAUDE_CLI_LOGIN, CODEX_CLI_LOGIN, CURSOR_CLI_LOGIN, GROK_CLI_LOGIN, KIMI_CLI_LOGIN, KIRO_CLI_LOGIN, QODER_CLI_LOGIN, type McpServerRef, type RepoPlan, type TaskEnvelope, type TranscriptMessage } from './envelope.ts';
import { runtimeSessionIdFor, sessionKeyFor } from './session-id.ts';
import { buildTranscript } from './transcript.ts';
import { findMerge, mergePrompt, planMerge, type MergePlan } from './merge-plan.ts';
import { envelopeSkill, loadAgentExtensions, type EnvelopeSkill, type ExtensionDeps } from '../agents/extensions.ts';
import { pluginMcpServers } from '../plugins/mcp.ts';
import type { PluginRepository } from '../plugins/repository.ts';
import type { PluginRuntimeStore } from '../plugins/runtime-store.ts';
import { parseContract } from '../organization/contract.ts';
import { catalogRole } from '../organization/catalog.ts';
import type { RoleKey } from '../organization/contract.ts';
import type { Tier } from '../agents/model-tiers.ts';
import { invokedSkillNames, requiredSkillsContract } from '../skills/invoke.ts';
import { findAiRuntime, type AiRuntimeId } from './ai-runtime-catalog.ts';
import type { RuntimeCredential } from '../agents/runtime/adapters/types.ts';
import { handoffPath } from '../runs/handoff.ts';

/** How much of the tasks around a task goes into its prompt: enough to know the goal and the answers, not their history. */
const RELATED_PARENT_CHARS = 1500;
const RELATED_CHILD_CHARS = 600;
const RELATED_CHILDREN = 12;

/** How much of a blocking task's handoff is carried into the next prompt. */
const HANDOFF_CHARS = 2500;

export interface BlockerHandoff {
   identifier: string;
   title: string;
   body: string;
}

/**
 * What this run's checkout was unpacked from. A run on a branch that already
 * exists holds that branch, not the default branch, and a merge run holds both.
 */
export type Checkout =
   | { from: 'default'; baseBranch: string }
   | { from: 'task_branch'; branch: string; baseBranch: string }
   | { from: 'merge'; branch: string; baseBranch: string };

/**
 * The tasks this one waits on, and what that means for the checkout. A QA run
 * spent fifteen minutes polling `git status` for the task it depended on,
 * whose commits were on that task's own branch and could never appear.
 *
 * Berry's own words, so they are not fenced. The handoffs those tasks wrote
 * are another agent's, and go through `dependencyHandoffs` instead.
 */
export function dependencyNote(
   dependencies: TaskEnvelope['task']['dependencies'],
   checkout: Checkout | null = null
): string | null {
   const waitsOn = dependencies.filter((dependency) => dependency.direction === 'depends_on');
   if (waitsOn.length === 0) return null;
   return (
      'This task depends on:\n' +
      waitsOn.map((dependency) => `- ${dependency.identifier} (${dependency.status}): ${dependency.title}`).join('\n') +
      `\n${checkoutSentence(checkout)} ` +
      'Work on those tasks that is not in that commit stays on their own branches and does not appear in your ' +
      'workspace while this run lasts, so do not wait or poll for it. Build on what the checkout holds. When this ' +
      'task cannot be done without work that is not there, stop and say so: call report_blocked. Name the task ' +
      'you need, the exact file, interface or decision that is missing, and where you looked. A local problem — ' +
      'a busy port, a failed check — is not a hold; finish the run. Berry starts this task again once that task ' +
      'is done. In your report, say which of those tasks\' work you used and where you found it.'
   );
}

function checkoutSentence(checkout: Checkout | null): string {
   if (!checkout) return 'This run has no checkout of the repository.';
   switch (checkout.from) {
      case 'default':
         return `Your checkout holds the default branch, ${checkout.baseBranch}, as it was when this run started.`;
      case 'task_branch':
         return (
            `Your checkout holds this task's branch, ${checkout.branch}, as it was when this run started. It has ` +
            `what ${checkout.baseBranch} held when the branch was cut or last brought up to date, and nothing newer.`
         );
      case 'merge':
         return (
            `Your checkout holds ${checkout.baseBranch} as it was when this run started, with this task's branch, ` +
            `${checkout.branch}, to be merged into it.`
         );
   }
}

/** The handoffs of the tasks this one waits on, as evidence for the prompt. Null when there are none. */
export function dependencyHandoffs(handoffs: BlockerHandoff[]): string | null {
   if (handoffs.length === 0) return null;
   return handoffs
      .map((handoff) => {
         const body = handoff.body.trim();
         const clipped = body.length <= HANDOFF_CHARS ? body : `${body.slice(0, HANDOFF_CHARS).trimEnd()} […]`;
         return `${handoff.identifier} (${handoff.title}), ${handoffPath(handoff.identifier, handoff.title)}:\n${clipped}`;
      })
      .join('\n\n');
}

export interface CompletionSpec {
   purpose: string;
   system: string;
   jsonSchema: Record<string, unknown> | null;
   model: string | null;
   /** A multi-turn exchange before the prompt (chat replies). */
   transcript?: TranscriptMessage[];
   /** The plan a planner, critic or repair call was for. */
   planId?: string;
   /** The task an AutoGate review call was for, so its console can list it. */
   issueId?: string;
}

export class AiRuntimeEnvelopeError extends Error {
   override readonly name = 'AiRuntimeEnvelopeError';
   readonly code: string;
   readonly retryable: boolean;

   constructor(code: string, message: string, retryable: boolean, options?: ErrorOptions) {
      super(message, options);
      this.code = code;
      this.retryable = retryable;
   }
}

export interface TaskRow {
   runId: string;
   workspaceId: string;
   agentId: string;
   issueId: string | null;
   boardId: string | null;
   chatSessionId: string | null;
   kind: 'agent' | 'completion';
   source: string;
   prompt: string | null;
   /** A chat run's chosen repository, `owner/name`. Null when none was chosen. */
   repository: string | null;
   /** A step-limit handover: a new session, and no restored conversation. */
   fresh: boolean;
   completionSpec: CompletionSpec | null;
   runtimeId: string | null;
   /** The personal AI adapter snapshot, distinct from the compute runtime above. */
   aiRuntimeId: AiRuntimeId | null;
   aiModelId: string | null;
   aiRuntimeAgent: string | null;
   aiRuntimeConnectionId: string | null;
   aiRuntimeUserId: string | null;
   aiRuntimeAccountId: string | null;
   aiRuntimeAccountName: string | null;
   requestedBy: string | null;
}

export interface AgentConfig {
   maxTurns?: number;
   maxOutputTokens?: number;
   id: string;
   name: string;
   instructions: string;
   model: string;
   /** Who serves `model`, or null when the agent names none. */
   modelProvider: string | null;
   /**
    * The tier the agent runs on when it names no model: its own
    * (`agents.model_tier`), else its contract's, else its role's in the
    * catalogue, else BerryLow for an agent outside the organization.
    */
   tier: Tier;
   /** The model a run falls back to when the first choice fails. */
   fallbackModel: string | null;
   permissions: string[];
   /** The tools this agent's role contract allows; null outside the organization. */
   tools: string[] | null;
   runtimeProfileId: string | null;
}

/** What the server needs after the runtime pushed, to open the pull request. */
export interface DeliveryPlan {
   fullName: string;
   defaultBranch: string;
   branch: string;
   reference: string;
   title: string;
   mergeRequiresApproval: boolean;
   mayOpenPullRequest: boolean;
}

export interface EnvelopeDeps {
   maxTokens?: number | null;
   sql: Sql;
   /** `BERRY_PUBLIC_URL`: where the runtime calls the Berry tool API. */
   publicUrl: string;
   /** Opens a user-owned runtime credential only while building that user's task envelope. */
   runtimeCredential?: ((input: {
      workspaceId: string;
      runtimeId: AiRuntimeId;
      connectionId: string;
      userId: string;
      accountId: string | null;
   }) => Promise<RuntimeCredential>) | undefined;
   defaultModel: string;
   memory: RunMemory;
   sealer: Sealer | null;
   /** `owner` is the account holding the repository: a workspace with several accounts mints the right token by it. */
   gitCredential?: ((workspaceId: string, owner?: string | null) => Promise<{ username: string; password: string; canPush?: boolean }>) | undefined;
   github: (token: string) => GitHubClient;
   /**
    * The agent's skills, MCP servers and env (workstream D).
    * Absent: the agent carries none of them.
    */
   extensions?: Omit<ExtensionDeps, 'sql'> | undefined;
   /**
    * The workspace's enabled plugins' MCP servers, approved tools only
    * (workstream G). `ttlMs` bounds the plugin token minted into each
    * envelope. Absent: an agent carries no plugin tools.
    */
   plugins?: { plugins: PluginRepository; runtime: PluginRuntimeStore; ttlMs: number } | undefined;
   /** Servers left out for want of a gateway, by name only. */
   onSkipped?: ((names: string[]) => void) | undefined;
   /** Where a failure that does not stop the run is reported. */
   onError?: ((message: string, error: unknown) => void) | undefined;
}

export async function loadTask(sql: Sql, runId: string): Promise<TaskRow> {
   const [row] = await sql`
      SELECT id, workspace_id, agent_id, issue_id, board_id, chat_session_id, kind, source,
             prompt, completion_spec, runtime_id, origin, ai_runtime_key, ai_model_id,
             ai_runtime_agent, ai_runtime_connection_id, ai_runtime_user_id, ai_runtime_account_id,
             ai_runtime_account_name, requested_by
        FROM runs WHERE id = ${runId}`;
   if (!row) throw new Error(`run ${runId} does not exist`);
   const origin = row.origin;
   const namedRepository =
      typeof origin === 'object' && origin !== null ? (origin as { repository?: unknown }).repository : null;
   return {
      runId: row.id as string,
      workspaceId: row.workspace_id as string,
      agentId: row.agent_id as string,
      issueId: (row.issue_id as string | null) ?? null,
      boardId: (row.board_id as string | null) ?? null,
      chatSessionId: (row.chat_session_id as string | null) ?? null,
      kind: row.kind as TaskRow['kind'],
      source: row.source as string,
      prompt: (row.prompt as string | null) ?? null,
      repository: typeof namedRepository === 'string' && /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(namedRepository) ? namedRepository : null,
      fresh: typeof origin === 'object' && origin !== null && (origin as { fresh?: unknown }).fresh === true,
      completionSpec: (row.completion_spec as CompletionSpec | null) ?? null,
      runtimeId: (row.runtime_id as string | null) ?? null,
      aiRuntimeId: (row.ai_runtime_key as AiRuntimeId | null) ?? null,
      aiModelId: (row.ai_model_id as string | null) ?? null,
      aiRuntimeAgent: (row.ai_runtime_agent as string | null) ?? null,
      aiRuntimeConnectionId: (row.ai_runtime_connection_id as string | null) ?? null,
      aiRuntimeUserId: (row.ai_runtime_user_id as string | null) ?? null,
      aiRuntimeAccountId: (row.ai_runtime_account_id as string | null) ?? null,
      aiRuntimeAccountName: (row.ai_runtime_account_name as string | null) ?? null,
      requestedBy: (row.requested_by as string | null) ?? null,
   };
}

/**
 * Where a merge fix runs: a tier below its agent's. It only reconciles a
 * finished task with main, and on BerryMax those runs cost about $0.75 each
 * to resolve README prose. BerryLow has nothing below it.
 */
const TIER_BELOW: Record<Tier, Tier> = {
   berry_max: 'berry_xhigh',
   berry_xhigh: 'berry_high',
   berry_high: 'berry_mid',
   berry_mid: 'berry_low',
   berry_low: 'berry_low',
};

export class EnvelopeBuilder {
   readonly #deps: EnvelopeDeps;

   constructor(deps: EnvelopeDeps) {
      this.#deps = deps;
   }

   async build(input: { task: TaskRow; dispatch: Dispatch | null; token: string; companion?: boolean }): Promise<{
      envelope: TaskEnvelope;
      delivery: DeliveryPlan | null;
      model: string;
      /** The tier that chose `model` (ADR-0017); null when a model was named. */
      tier: Tier | null;
   }> {
      const { task } = input;
      const agent = await this.#agent(task.agentId);
      const profile = await this.#profile(agent.runtimeProfileId, task.workspaceId);
      const runtime = await this.#runtime(task);
      const baseSessionKey = sessionKeyFor({
         kind: task.kind, runId: task.runId, agentId: task.agentId, issueId: task.issueId, chatSessionId: task.chatSessionId,
         ...(task.fresh ? { fresh: true } : {}),
      });
      // A personal runtime session belongs to its connection as well as the
      // agent/task. Two people running the same task must never share the
      // provider process's transcript, files, or account state.
      const sessionKey = runtime && task.aiRuntimeConnectionId
         ? `${baseSessionKey}:connection:${task.aiRuntimeConnectionId}`
         : baseSessionKey;
      const { model, tier, fallback } = runtime
         ? { model: runtime.model, tier: null, fallback: null }
         : await this.#model(task, agent, profile.model);
      // An agent task carries its extensions; a completion is one model call
      // and carries none.
      const extensions =
         task.kind === 'agent' && this.#deps.extensions
            ? await loadAgentExtensions(
                 { sql: this.#deps.sql, ...this.#deps.extensions },
                 { workspaceId: task.workspaceId, agentId: task.agentId, issueId: task.issueId }
              )
            : null;
      if (extensions && extensions.skipped.length > 0) this.#deps.onSkipped?.(extensions.skipped);
      const mcpServers = await this.#mcpServers(task, extensions?.mcpServers ?? []);
      const instructions = agent.instructions;

      const base = {
         runId: task.runId,
         ...(runtime ? { runtime } : {}),
         sessionKey,
         runtimeSessionId: runtimeSessionIdFor(sessionKey),
         agent: {
            name: agent.name,
            instructions,
            model,
            ...(fallback ? { fallbackModel: fallback } : {}),
            // EnvelopeSkill and EnvelopeMcpServer are SkillRef and McpServerRef
            // field for field: no mapping, and tsc refuses a drift.
            skills: extensions?.skills ?? [],
            mcpServers,
            permissions: agent.permissions,
            tools: agent.tools,
            maxTokens: this.#deps.maxTokens ?? null,
            ...(agent.maxTurns ? { maxTurns: agent.maxTurns } : {}),
            ...(agent.maxOutputTokens ? { maxOutputTokens: agent.maxOutputTokens } : {}),
            temperature: null,
         },
         // The runtime profile's env first; the agent's own env wins a clash.
         env: { ...profile.env, ...(extensions?.env ?? {}) },
         berry: { apiUrl: this.#deps.publicUrl, token: input.token },
      };
      if (task.kind === 'completion') {
         const spec = task.completionSpec ?? { purpose: 'completion', system: '', jsonSchema: null, model: null };
         return {
            model,
            tier,
            delivery: null,
            envelope: {
               ...base,
               kind: 'completion',
               task: { prompt: task.prompt ?? '', issue: null, comments: [], dependencies: [], projectResources: [], priorWork: null },
               transcript: spec.transcript ?? [],
               repo: null,
               completion: { system: spec.system, jsonSchema: spec.jsonSchema },
            },
         };
      }

      // A fresh continuation keeps the summary in its instructions and none of
      // the conversation that filled the limit.
      const transcript = task.fresh
         ? []
         : await buildTranscript(this.#deps.sql, {
              agentId: task.agentId, issueId: task.issueId, chatSessionId: task.chatSessionId, excludeRunId: task.runId,
           });

      if (!task.issueId) {
         // A chat task: the prompt is the message. A skill the message names
         // is carried on this run and the prompt requires the agent to follow it.
         // A chosen repository is checked out read-only, so the answer is about
         // that codebase.
         const chat = await this.#chatSkills(task.workspaceId, task.prompt ?? '', extensions?.skills ?? []);
         const repo = await this.#chatRepository(task, agent);
         return {
            model,
            tier,
            delivery: null,
            envelope: {
               ...base,
               agent: { ...base.agent, skills: chat.skills },
               kind: 'agent',
               task: {
                  prompt: chat.prompt,
                  issue: null,
                  comments: [],
                  dependencies: [],
                  projectResources: task.repository
                     ? [{ title: task.repository, url: `https://github.com/${task.repository}`, content: null }]
                     : [],
                  priorWork: null,
               },
               transcript,
               repo,
               completion: null,
            },
         };
      }

      // An issue task always carries its issue, claimed or not: a caller that
      // builds an envelope without the ledger's claim (a preview, a retry
      // path) still gets the issue prompt rather than a bare message.
      const dispatch = input.dispatch ?? (await this.#readDispatch(task.runId));
      const [related, reviewFeedback, recalled, loadedComments, dependencies, handoffs, projectResources] = await Promise.all([
         this.#related(dispatch.issueId),
         lastRejection(this.#deps.sql, dispatch.issueId),
         this.#deps.memory.recall({ agentId: task.agentId, issueId: dispatch.issueId }),
         this.#comments(dispatch.issueId),
         this.#dependencies(dispatch.issueId),
         this.#handoffs(dispatch.issueId),
         this.#projectResources(dispatch.issueId, task.workspaceId),
      ]);
      const priorWork = recallPrompt(recalled);
      const { repo, delivery, empty, checkout } = input.companion ? { repo: null, delivery: null, empty: false, checkout: null } : await this.#repository(task, dispatch, agent);
      const note = dependencyNote(dependencies, checkout ?? null);
      const handed = dependencyHandoffs(handoffs);
      // A person's comment written after the last run is already the review
      // feedback; it is not carried twice.
      const { comments, people } = loadedComments;
      const direction = people.filter((comment) => !(reviewFeedback && reviewFeedback.includes(comment.body.trim())));
      return {
         model,
         tier,
         delivery,
         envelope: {
            ...base,
            kind: 'agent',
            task: {
               prompt: buildMessage({
                  ...dispatch,
                  reviewFeedback,
                  ...(related ? { related } : {}),
                  ...(note ? { dependencyNote: note } : {}),
                  ...(handed ? { dependencyHandoffs: handed } : {}),
                  ...(dependencies.some((dependency) => dependency.direction === 'depends_on')
                     ? {
                          blockerHandoffs: dependencies
                             .filter((dependency) => dependency.direction === 'depends_on')
                             .map((dependency) => ({ identifier: dependency.identifier, title: dependency.title })),
                       }
                     : {}),
                  ...(priorWork ? { priorWork } : {}),
                  ...(repo?.readOnly ? { repositoryReadOnly: true } : {}),
                  ...(empty ? { repositoryEmpty: true } : {}),
                  skills: (extensions?.skills ?? []).map((skill) => ({ name: skill.name, description: skillDescription(skill) })),
                  ...(repo?.merge
                     ? { merge: mergePrompt({ baseBranch: repo.baseBranch, branch: repo.branch, conflicts: repo.merge.conflicts }) }
                     : {}),
                  // An agent's comments are run reports, and what they did is
                  // in the checkout and the recalled work. People's comments
                  // are direction, kept however many reports sit between them.
                  ...(direction.length > 0
                     ? { comments: direction.map(({ author, body, createdAt }) => ({ author, body, createdAt })) }
                     : {}),
               }),
               issue: {
                  id: dispatch.issueId,
                  identifier: dispatch.issueIdentifier,
                  title: dispatch.issueTitle,
                  description: dispatch.issueDescription,
               },
               comments,
               dependencies,
               projectResources,
               priorWork,
            },
            transcript,
            repo,
            completion: null,
         },
      };
   }

   /**
    * The agent's own servers, then its workspace's approved plugin servers.
    *
    * Plugin tokens are minted here and only here, straight into the envelope
    * — the one place secrets are opened (spec §11) — and only for an agent
    * task: a completion is one model call and gets none. Each plugin server
    * carries its approved tools as `allowedTools`, which the runtime enforces.
    * A plugin whose server name an agent's own server already uses is left
    * out rather than shadowing it.
    */
   async #mcpServers(task: TaskRow, own: McpServerRef[]): Promise<McpServerRef[]> {
      const plugins = this.#deps.plugins;
      if (task.kind !== 'agent' || !plugins) return own;
      const taken = new Set(own.map((server) => server.name));
      const fromPlugins = await pluginMcpServers(plugins, task.workspaceId, plugins.ttlMs);
      return [
         ...own,
         ...fromPlugins
            .filter((server) => !taken.has(server.name))
            .map((server) => ({
               name: server.name,
               url: server.url,
               transport: server.transport,
               headers: server.headers,
               allowedTools: server.allowedTools,
            })),
      ];
   }

   /** The issue context `claimDispatch` reads, without the claim: building an envelope changes no run state. */
   async #readDispatch(runId: string): Promise<Dispatch> {
      const [row] = await this.#deps.sql`
         SELECT r.id, r.issue_id, r.board_id, r.agent_id,
                i.title, i.description, r.instructions, r.request_id, r.traceparent,
                b.workspace_id,
                COALESCE(project.github_repo_full_name, '') AS repository,
                berry_issue_identifier(b.workspace_id, i.number) AS identifier
           FROM runs AS r
           JOIN issues AS i ON i.id = r.issue_id
           JOIN boards AS b ON b.id = r.board_id
           LEFT JOIN issue_project_links AS link ON link.issue_id = i.id
           LEFT JOIN projects AS project
             ON project.id = link.project_id AND project.deleted_at IS NULL
          WHERE r.id = ${runId}`;
      if (!row) throw new Error(`run ${runId} is not on an issue`);
      return {
         runId: row.id as string,
         issueId: row.issue_id as string,
         boardId: row.board_id as string,
         workspaceId: row.workspace_id as string,
         agentId: row.agent_id as string,
         issueTitle: row.title as string,
         issueDescription: (row.description as string | null) ?? null,
         issueIdentifier: row.identifier as string,
         instructions: (row.instructions as string | null) ?? null,
         repository: (row.repository as string) ?? '',
         requestId: (row.request_id as string | null) ?? '',
         traceParent: (row.traceparent as string | null) ?? '',
      };
   }

   async #runtime(
      task: TaskRow
   ): Promise<(NonNullable<TaskEnvelope['runtime']> & { model: string }) | null> {
      if (!task.aiRuntimeId) return null;
      const definition = findAiRuntime(task.aiRuntimeId);
      if (!definition || definition.availability !== 'available') {
         throw new AiRuntimeEnvelopeError(
            'AI_RUNTIME_UNAVAILABLE',
            definition?.unavailableReason ?? `AI runtime ${task.aiRuntimeId} is unavailable.`,
            false
         );
      }
      if (!task.aiRuntimeConnectionId || !task.aiRuntimeUserId || !this.#deps.runtimeCredential) {
         throw new AiRuntimeEnvelopeError(
            'AI_RUNTIME_AUTH_REQUIRED',
            `Reconnect ${definition.name} for your account before running this task.`,
            false
         );
      }
      let credential: RuntimeCredential;
      try {
         credential = await this.#deps.runtimeCredential({
            workspaceId: task.workspaceId,
            runtimeId: task.aiRuntimeId,
            connectionId: task.aiRuntimeConnectionId,
            userId: task.aiRuntimeUserId,
            accountId: task.aiRuntimeAccountId,
         });
      } catch (cause) {
         throw new AiRuntimeEnvelopeError(
            'AI_RUNTIME_AUTH_EXPIRED',
            `${definition.name} could not use your account. Reconnect it and run the task again.`,
            false,
            { cause }
         );
      }
      if (task.aiRuntimeId === 'claude' && (credential.type !== 'oauth' || credential.token !== CLAUDE_CLI_LOGIN)) {
         throw new AiRuntimeEnvelopeError(
            'AI_RUNTIME_AUTH_REQUIRED',
            'Connect Claude in AI Runtimes. Berry uses the Claude CLI login on this workstation.',
            false
         );
      }
      if (task.aiRuntimeId === 'codex' && (credential.type !== 'oauth' || credential.token !== CODEX_CLI_LOGIN)) {
         throw new AiRuntimeEnvelopeError(
            'AI_RUNTIME_AUTH_REQUIRED',
            'Connect Codex in AI Runtimes. Berry uses the Codex CLI login on this workstation.',
            false
         );
      }
      if (task.aiRuntimeId === 'grok' && (credential.type !== 'oauth' || credential.token !== GROK_CLI_LOGIN)) {
         throw new AiRuntimeEnvelopeError(
            'AI_RUNTIME_AUTH_REQUIRED',
            'Connect Grok in AI Runtimes. Berry uses the Grok CLI login on this workstation.',
            false
         );
      }
      if (task.aiRuntimeId === 'kimi' && (credential.type !== 'oauth' || credential.token !== KIMI_CLI_LOGIN)) {
         throw new AiRuntimeEnvelopeError(
            'AI_RUNTIME_AUTH_REQUIRED',
            'Connect Kimi in AI Runtimes. Berry uses the Kimi Code CLI login on this workstation.',
            false
         );
      }
      if (task.aiRuntimeId === 'cursor' && (credential.type !== 'oauth' || credential.token !== CURSOR_CLI_LOGIN)) {
         throw new AiRuntimeEnvelopeError(
            'AI_RUNTIME_AUTH_REQUIRED',
            'Connect Cursor in AI Runtimes. Berry uses the Cursor CLI login on this workstation.',
            false
         );
      }
      if (task.aiRuntimeId === 'qoder' && (credential.type !== 'oauth' || credential.token !== QODER_CLI_LOGIN)) {
         throw new AiRuntimeEnvelopeError(
            'AI_RUNTIME_AUTH_REQUIRED',
            'Connect Qoder in AI Runtimes. Berry uses the Qoder CLI login on this workstation.',
            false
         );
      }
      if (task.aiRuntimeId === 'kiro' && (credential.type !== 'oauth' || credential.token !== KIRO_CLI_LOGIN)) {
         throw new AiRuntimeEnvelopeError(
            'AI_RUNTIME_AUTH_REQUIRED',
            'Connect Kiro in AI Runtimes. Berry uses the Kiro CLI login on this workstation.',
            false
         );
      }
      const model = task.aiModelId ?? definition.defaultModel;
      if (!model) {
         throw new AiRuntimeEnvelopeError(
            'AI_RUNTIME_MODEL_REQUIRED',
            `Choose a model for ${definition.name} before running this task.`,
            false
         );
      }
      return {
         id: definition.id,
         executionMode: definition.executionMode,
         provider: definition.provider,
         billing: definition.billing,
         model,
         agent: task.aiRuntimeAgent,
         credential,
      };
   }

   /**
    * The model a native task would run on: the completion's own model, else
    * the agent's, else its runtime profile's, else the server default.
    * Subscription runs take the model from the selected runtime instead.
    */
   async #model(
      task: TaskRow,
      agent: AgentConfig,
      profileModel: string | null
   ): Promise<{ model: string; tier: Tier | null; fallback: string | null }> {
      const completionModel = task.kind === 'completion' ? (task.completionSpec?.model ?? null) : null;
      return {
         model: completionModel ?? (agent.model || profileModel || this.#deps.defaultModel),
         tier: null,
         fallback: agent.fallbackModel,
      };
   }

   /**
    * Skills a chat message invoked, added to the ones the agent already carries,
    * and a prompt that requires the agent to follow them.
    */
   async #chatSkills(
      workspaceId: string,
      body: string,
      carried: EnvelopeSkill[]
   ): Promise<{ skills: EnvelopeSkill[]; prompt: string }> {
      const names = invokedSkillNames(body);
      if (names.length === 0 || !this.#deps.extensions) return { skills: carried, prompt: body };
      const found = await this.#deps.extensions.skills.byNames(workspaceId, names);
      const have = new Set(carried.map((skill) => skill.name));
      const skills = [
         ...carried,
         ...found.filter((skill) => !have.has(skill.name)).map((skill) => envelopeSkill(skill)),
      ];
      const required = names.flatMap((name) => {
         const skill = found.find((candidate) => candidate.name === name);
         return skill ? [skill] : [];
      });
      const prompt = required.length === 0 ? body : `${body}${requiredSkillsContract(required)}`;
      return { skills, prompt };
   }

   async #agent(agentId: string): Promise<AgentConfig> {
      const [row] = await this.#deps.sql`
         SELECT id, name, instructions, model_name, model_provider, model_tier, fallback_model, permissions, runtime_profile_id, role_key, role_contract, manifest_limits
           FROM agents WHERE id = ${agentId} AND archived_at IS NULL`;
      if (!row) throw new Error(`agent ${agentId} does not exist`);
      const name = row.name as string;
      const contract = parseContract(row.role_contract);
      const manifest = z.object({
         maxTurns: z.number().int().positive().optional(),
         maxTokens: z.number().int().positive().optional(),
      }).parse(row.manifest_limits ?? {});
      const turns = [contract?.run_limits.max_turns, manifest.maxTurns].filter((value): value is number => value !== undefined);
      const output = [contract?.run_limits.max_output_tokens, manifest.maxTokens].filter((value): value is number => value !== undefined);
      return {
         ...(turns.length ? { maxTurns: Math.min(...turns) } : {}),
         ...(output.length ? { maxOutputTokens: Math.min(...output) } : {}),
         id: row.id as string,
         name,
         instructions:
            ((row.instructions as string | null) ?? '').trim() ||
            `You are ${name}, an agent working a task in Berry. Do the task you are given and report what you did.`,
         model: (row.model_name as string | null) ?? '',
         modelProvider: (row.model_provider as string | null) ?? null,
         tier:
            (row.model_tier as Tier | null) ??
            contract?.tier ??
            catalogRole((row.role_key as RoleKey | null) ?? ('' as RoleKey))?.tier ??
            'berry_low',
         fallbackModel: (row.fallback_model as string | null) ?? null,
         permissions: (row.permissions as string[] | null) ?? [],
         tools: toolsForAgentRow({ role_key: (row.role_key as string | null) ?? null, role_contract: row.role_contract }),
         runtimeProfileId: (row.runtime_profile_id as string | null) ?? null,
      };
   }

   async #profile(profileId: string | null, workspaceId: string): Promise<{ env: Record<string, string>; model: string | null }> {
      if (!profileId) return { env: {}, model: null };
      // Scoped to the task's workspace: `agents.runtime_profile_id` is a plain
      // FK, so without this a mis-bound agent would open another tenant's env.
      const [row] = await this.#deps.sql`
         SELECT env_sealed, model_default FROM runtime_profiles
          WHERE id = ${profileId} AND workspace_id = ${workspaceId}`;
      if (!row) return { env: {}, model: null };
      const sealed = row.env_sealed as Buffer | null;
      const env = sealed && this.#deps.sealer ? (JSON.parse(this.#deps.sealer.open(sealed)) as Record<string, string>) : {};
      return { env, model: (row.model_default as string | null) ?? null };
   }

   /**
    * The latest comments, oldest first, for the envelope, and the latest that
    * people wrote, for the prompt. Each window is the last 30: a run of agent
    * reports must not push a person's correction out of the prompt's window.
    */
   async #comments(issueId: string): Promise<{
      comments: TaskEnvelope['task']['comments'];
      people: TaskEnvelope['task']['comments'];
   }> {
      const [rows, people] = await Promise.all([
         this.#deps.sql`
            SELECT c.body, c.created_at,
                   COALESCE(u.name, a.name, 'someone') AS author
              FROM comments AS c
              LEFT JOIN users AS u ON c.author_type = 'user' AND u.id = c.author_id
              LEFT JOIN agents AS a ON c.author_type = 'agent' AND a.id = c.author_id
             WHERE c.issue_id = ${issueId}
             ORDER BY c.created_at DESC LIMIT 30`,
         this.#deps.sql`
            SELECT c.body, c.created_at, COALESCE(u.name, 'someone') AS author
              FROM comments AS c
              LEFT JOIN users AS u ON u.id = c.author_id
             WHERE c.issue_id = ${issueId} AND c.author_type = 'user'
             ORDER BY c.created_at DESC LIMIT 30`,
      ]);
      const shape = (row: (typeof rows)[number]) => ({
         author: row.author as string,
         body: row.body as string,
         createdAt: new Date(row.created_at as string).toISOString(),
      });
      return { comments: rows.reverse().map(shape), people: people.reverse().map(shape) };
   }

   /**
    * The task this one was carved out of, and what its own sub-tasks came back
    * with, as text for the prompt. Short on purpose: a parent's goal and each
    * sub-task's summary, not their transcripts, because everything here is
    * paid for on every turn of the run. Null for a task with neither.
    */
   async #related(issueId: string): Promise<string | null> {
      const [parent] = await this.#deps.sql`
         SELECT berry_issue_identifier(pb.workspace_id, parent.number) AS identifier,
                parent.title, parent.description, parent.status::text AS status
           FROM issues AS me
           JOIN issues AS parent ON parent.id = me.parent_id AND parent.deleted_at IS NULL
           JOIN boards AS pb ON pb.id = parent.board_id
          WHERE me.id = ${issueId}`;
      const children = await this.#deps.sql`
         SELECT berry_issue_identifier(cb.workspace_id, child.number) AS identifier,
                child.title, child.status::text AS status,
                (SELECT run.summary FROM runs AS run
                  WHERE run.issue_id = child.id AND run.status = 'succeeded' AND run.summary IS NOT NULL
                  ORDER BY run.completed_at DESC NULLS LAST LIMIT 1) AS summary
           FROM issues AS child
           JOIN boards AS cb ON cb.id = child.board_id
          WHERE child.parent_id = ${issueId} AND child.deleted_at IS NULL
          ORDER BY child.created_at
          LIMIT ${RELATED_CHILDREN}`;
      if (!parent && children.length === 0) return null;
      const clip = (text: string | null, limit: number): string => {
         const flat = (text ?? '').trim();
         return flat.length <= limit ? flat : `${flat.slice(0, limit).trimEnd()} […]`;
      };
      const parts: string[] = [];
      if (parent) {
         parts.push(
            `This task is part of ${parent.identifier as string} (${parent.status as string}): ${parent.title as string}` +
               (parent.description ? `\n${clip(parent.description as string, RELATED_PARENT_CHARS)}` : '')
         );
      }
      if (children.length > 0) {
         parts.push(
            'Its sub-tasks:\n' +
               children
                  .map((child) => {
                     const summary = clip(child.summary as string | null, RELATED_CHILD_CHARS);
                     return `- ${child.identifier as string} (${child.status as string}): ${child.title as string}${summary ? `\n  Came back with: ${summary.replaceAll('\n', '\n  ')}` : ''}`;
                  })
                  .join('\n')
         );
      }
      return parts.join('\n\n');
   }

   /** Spec 2.2: the envelope carries the issue's dependencies (same query as the `list_dependencies` tool). */
   async #dependencies(issueId: string): Promise<TaskEnvelope['task']['dependencies']> {
      const rows = await this.#deps.sql`
         SELECT CASE WHEN edge.issue_id = ${issueId} THEN 'depends_on' ELSE 'blocks' END AS direction,
                other.title, other.status::text AS status,
                berry_issue_identifier(ob.workspace_id, other.number) AS identifier
           FROM issue_dependencies AS edge
           JOIN issues AS other
             ON other.id = CASE WHEN edge.issue_id = ${issueId} THEN edge.depends_on_issue_id ELSE edge.issue_id END
            AND other.deleted_at IS NULL
           JOIN boards AS ob ON ob.id = other.board_id
          WHERE edge.issue_id = ${issueId} OR edge.depends_on_issue_id = ${issueId}
          ORDER BY direction, identifier`;
      return rows.map((row) => ({
         identifier: row.identifier as string,
         title: row.title as string,
         status: row.status as string,
         direction: row.direction as 'depends_on' | 'blocks',
      }));
   }

   /**
    * The handoff posted on each task this one waits for, and on the tasks
    * those wait for.
    *
    * The comment is the copy the next prompt carries. A file saved only in
    * object storage is unread when that store is down, and the next agent
    * would inventory the repository instead. The earliest handoff comes
    * first, so the foundation is read before the task that sits on it.
    */
   async #handoffs(issueId: string): Promise<BlockerHandoff[]> {
      const rows = await this.#deps.sql`
         WITH RECURSIVE blockers AS (
            SELECT edge.depends_on_issue_id AS id, 1 AS depth
              FROM issue_dependencies AS edge
             WHERE edge.issue_id = ${issueId}
            UNION
            SELECT edge.depends_on_issue_id, blockers.depth + 1
              FROM blockers
              JOIN issue_dependencies AS edge ON edge.issue_id = blockers.id
             WHERE blockers.depth < 12
         )
         SELECT identifier, title, body
           FROM (
              SELECT DISTINCT ON (blocker.id)
                     berry_issue_identifier(ob.workspace_id, blocker.number) AS identifier,
                     blocker.title,
                     handoff.body,
                     blockers.depth
                FROM blockers
                JOIN issues AS blocker ON blocker.id = blockers.id AND blocker.deleted_at IS NULL
                JOIN boards AS ob ON ob.id = blocker.board_id
                JOIN LATERAL (
                   SELECT body FROM comments
                    WHERE issue_id = blocker.id
                      AND parent_id IS NULL
                      AND (body LIKE '.handoffs/%' OR body LIKE 'HANDOFF.md%')
                    ORDER BY created_at DESC
                    LIMIT 1
                ) AS handoff ON true
               ORDER BY blocker.id, blockers.depth DESC
           ) AS found
          ORDER BY depth DESC, identifier`;
      return rows.map((row) => ({
         identifier: row.identifier as string,
         title: row.title as string,
         body: row.body as string,
      }));
   }

   /** Spec 2.2: the envelope carries the project resources (same rows as `read_project_resources`). */
   async #projectResources(issueId: string, workspaceId: string): Promise<TaskEnvelope['task']['projectResources']> {
      const rows = await this.#deps.sql`
         SELECT p.name, p.description, p.github_repo_full_name AS repository
           FROM issue_project_links AS link
           JOIN projects AS p ON p.id = link.project_id AND p.deleted_at IS NULL
          WHERE link.issue_id = ${issueId} AND p.workspace_id = ${workspaceId}`;
      return rows.map((row) => ({
         title: row.name as string,
         url: row.repository ? `https://github.com/${row.repository as string}` : null,
         content: (row.description as string | null) ?? null,
      }));
   }

   /**
    * A chat message that names a repository checks that repository out
    * read-only. The prompt already says to work inside it; the checkout is
    * the tree the agent reads. A missing credential or an empty repository
    * leaves the run with the name and no tree, rather than failing the reply.
    */
   async #chatRepository(task: TaskRow, agent: AgentConfig): Promise<RepoPlan | null> {
      const fullName = task.repository;
      if (!fullName || !this.#deps.gitCredential) return null;
      const permissions = permissionsOf(agent.permissions, agent.name);
      if (!permissions.has('read_repository')) return null;
      try {
         const { owner, name } = parseRepository(fullName);
         const credential = await this.#deps.gitCredential(task.workspaceId, owner);
         const client = this.#deps.github(credential.password);
         const remote = await client.repository(owner, name);
         const head = await client.branchHead(owner, name, remote.defaultBranch);
         if (!head) return null;
         await this.#deps.sql`INSERT INTO run_repository_snapshots (run_id, repository, branch, base_commit, default_commit, expected_head, read_only, merge_parent, merge_base)
            VALUES (${task.runId}, ${fullName}, ${remote.defaultBranch}, ${head}, ${head}, ${null}, ${true}, ${null}, ${null})
            ON CONFLICT (run_id) DO NOTHING`;
         const [snapshot] = await this.#deps.sql`SELECT base_commit FROM run_repository_snapshots WHERE run_id = ${task.runId}`;
         const commit = (snapshot?.base_commit as string | undefined) ?? head;
         return {
            readOnly: true,
            snapshotCommit: commit,
            fullName,
            branch: remote.defaultBranch,
            baseBranch: remote.defaultBranch,
            credential: { username: '', password: '' },
            verifyCommands: [],
            issueReference: 'chat',
            issueTitle: 'Chat',
         };
      } catch (error) {
         this.#deps.onError?.('chat repository checkout was not attached', error);
         return null;
      }
   }

   async #repository(
      task: TaskRow,
      dispatch: Dispatch,
      agent: AgentConfig
   ): Promise<{ repo: RepoPlan | null; delivery: DeliveryPlan | null; empty?: true; checkout?: Checkout }> {
      if (!this.#deps.gitCredential) return { repo: null, delivery: null };
      const repository = await repositoryForIssue(this.#deps.sql, dispatch.issueId);
      if (!repository) return { repo: null, delivery: null };
      const permissions = permissionsOf(agent.permissions, agent.name);
      // Before a credential is opened: an agent that may not read the
      // repository never causes a token to be minted on its behalf.
      permissions.require('read_repository');
      const readOnly = !permissions.has('create_branches');
      // Minted for the account that holds the repository: a workspace with
      // more than one GitHub account gets the first account's token otherwise,
      // and that token answers 404 for every other account's repositories.
      const { owner, name } = parseRepository(repository.fullName);
      const credential = await this.#deps.gitCredential(task.workspaceId, owner);
      const remote = await this.#deps.github(credential.password).repository(owner, name);
      if (!readOnly && !(credential.canPush ?? remote.canPush)) {
         throw new Error(`the GitHub connection cannot push to ${repository.fullName}`);
      }
      const issue = await loadIssue(this.#deps.sql, dispatch.issueId);
      const branch = branchName(agent.name, issue.reference, issue.title);
      const client = this.#deps.github(credential.password);
      const existingHead = await client.branchHead(owner, name, remote.defaultBranch);
      // A repository with no commits has nothing to check out, and a run that
      // only reads has nothing to read: it works without a checkout and is
      // told why, rather than failing. Research and specs are what such a run
      // produces, and a project's first tasks are exactly those.
      if (!existingHead && readOnly) return { repo: null, delivery: null, empty: true };
      const defaultCommit =
         existingHead ?? (await initialiseRepository(client, { owner, name, fullName: repository.fullName, branch: remote.defaultBranch }));
      const expectedHead = readOnly ? null : await client.branchHead(owner, name, branch);
      // A branch that conflicts with the default branch gets a run that can
      // resolve it. Decided here, from the repository itself, rather than from
      // who sent the task back or why: whatever brought the run about, the
      // pull request cannot merge until the two sides are reconciled, and a
      // snapshot of the branch alone never shows the agent the other side.
      let merge: MergePlan | null = null;
      if (expectedHead) {
         merge = await findMerge(client, { owner, name, branchHead: expectedHead, defaultHead: defaultCommit }).catch((error: unknown) => {
            // Never a reason to stop the run: it works on its branch as before.
            this.#deps.onError?.('planning the merge with the default branch failed', error);
            return null;
         });
      }
      await this.#deps.sql`INSERT INTO run_repository_snapshots (run_id, repository, branch, base_commit, default_commit, expected_head, read_only, merge_parent, merge_base)
         VALUES (${task.runId}, ${repository.fullName}, ${branch}, ${expectedHead ?? defaultCommit}, ${defaultCommit}, ${expectedHead}, ${readOnly},
                 ${merge ? merge.theirs : null}, ${merge ? merge.base : null})
         ON CONFLICT (run_id) DO NOTHING`;
      const [snapshot] = await this.#deps.sql`SELECT base_commit, merge_parent, merge_base, expected_head FROM run_repository_snapshots WHERE run_id = ${task.runId}`;
      if (!snapshot) throw new Error('Repository snapshot was not persisted');
      // The row is the truth: an envelope built twice for one run keeps the
      // first snapshot, so the merge is read back from its commits rather than
      // from heads that may have moved in between.
      const mergeParent = (snapshot.merge_parent as string | null) ?? null;
      if (!mergeParent) merge = null;
      else if (!merge || merge.theirs !== mergeParent || merge.ours !== snapshot.base_commit) {
         merge = await planMerge(client, {
            owner, name, base: snapshot.merge_base as string, ours: snapshot.base_commit as string, theirs: mergeParent,
         });
         if (!merge) throw new Error('The merge this run was planned with can no longer be read');
      }
      const checkout: Checkout = mergeParent
         ? { from: 'merge', branch, baseBranch: remote.defaultBranch }
         : snapshot.expected_head
           ? { from: 'task_branch', branch, baseBranch: remote.defaultBranch }
           : { from: 'default', baseBranch: remote.defaultBranch };
      return {
         checkout,
         repo: {
            readOnly,
            // What the workspace is unpacked from: the default branch head on a
            // conflict-resolution run, otherwise the branch head (the default
            // branch's, for a branch that does not exist yet).
            snapshotCommit: mergeParent ?? (snapshot.base_commit as string),
            ...(merge ? { merge: { conflicts: merge.conflicts.map((conflict) => conflict.path) } } : {}),
            fullName: repository.fullName,
            branch,
            baseBranch: remote.defaultBranch,
            // Kept empty for wire compatibility. Repository tokens never enter the runtime.
            credential: { username: '', password: '' },
            verifyCommands: repository.verifyCommands,
            issueReference: issue.reference,
            issueTitle: issue.title,
         },
         delivery: readOnly ? null : {
            fullName: repository.fullName,
            defaultBranch: remote.defaultBranch,
            branch,
            reference: issue.reference,
            title: issue.title,
            mergeRequiresApproval: !permissions.has('merge_without_approval'),
            mayOpenPullRequest: permissions.has('open_pull_requests'),
         },
      };
   }
}

/**
 * A repository with no commits has no default branch to check out. New
 * repositories are given that commit when they are created; one that was
 * linked while still empty gets it here, the same empty commit. Only a run
 * that may push does it; a read-only run goes ahead without a checkout.
 */
async function initialiseRepository(
   client: Pick<GitHubClient, 'seedEmptyBranch' | 'branchHead'>,
   input: { owner: string; name: string; fullName: string; branch: string }
): Promise<string> {
   try {
      return await client.seedEmptyBranch({ owner: input.owner, name: input.name, branch: input.branch });
   } catch (error) {
      // A plan starts several tasks at once, and each finds the repository
      // empty: the first run's commit wins, and GitHub answers the others
      // "reference already exists". That is the outcome they were after, so
      // they carry on from it; only a branch that is still missing is a failure.
      const head = await client.branchHead(input.owner, input.name, input.branch);
      if (head) return head;
      throw error;
   }
}

/** The description a skill's SKILL.md frontmatter carries, or nothing. */
function skillDescription(skill: { files: Array<{ path: string; content: string }> }): string {
   const manifest = skill.files.find((file) => file.path === 'SKILL.md')?.content ?? '';
   const match = /^description:\s*(.+)$/m.exec(manifest.split('\n---')[0] ?? '');
   if (!match) return '';
   try {
      return String(JSON.parse(match[1]!.trim()));
   } catch {
      return match[1]!.trim();
   }
}

