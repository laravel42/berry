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
import { isKiroApiKey, type McpServerRef, type RepoPlan, type TaskEnvelope, type TranscriptMessage } from './envelope.ts';
import { runtimeSessionIdFor, sessionKeyFor } from './session-id.ts';
import { buildTranscript } from './transcript.ts';
import { findMerge, mergePrompt, planMerge, type MergePlan } from './merge-plan.ts';
import { loadAgentExtensions, type ExtensionDeps } from '../agents/extensions.ts';
import { pluginMcpServers } from '../plugins/mcp.ts';
import type { PluginRepository } from '../plugins/repository.ts';
import type { PluginRuntimeStore } from '../plugins/runtime-store.ts';
import { parseContract } from '../organization/contract.ts';
import { catalogRole } from '../organization/catalog.ts';
import type { RoleKey } from '../organization/contract.ts';
import { isGatewayModelId, type TierChoice, type TierPlacement } from '../agents/kilo/tiers.ts';
import type { TierPlacements } from '../agents/kilo/placements.ts';
import type { Tier } from '../agents/model-tiers.ts';
import { findAiRuntime, type AiRuntimeId } from './ai-runtime-catalog.ts';
import type { RuntimeCredential } from '../agents/runtime/adapters/types.ts';

/** How much of the tasks around a task goes into its prompt: enough to know the goal and the answers, not their history. */
const RELATED_PARENT_CHARS = 1500;
const RELATED_CHILD_CHARS = 600;
const RELATED_CHILDREN = 12;

/**
 * The tasks this one waits on, and what that means for the checkout. A QA run
 * spent fifteen minutes polling `git status` for the task it depended on,
 * whose commits were on that task's own branch and could never appear.
 */
export function dependencyNote(dependencies: TaskEnvelope['task']['dependencies']): string | null {
   const waitsOn = dependencies.filter((dependency) => dependency.direction === 'depends_on');
   if (waitsOn.length === 0) return null;
   return (
      'This task depends on:\n' +
      waitsOn.map((dependency) => `- ${dependency.identifier} (${dependency.status}): ${dependency.title}`).join('\n') +
      '\nYour checkout holds the default branch as it is now. Work on those tasks that is not merged yet ' +
      'lives on their own branches and never appears in your workspace, so do not wait or poll for it. ' +
      'Build on what the checkout holds; when the task cannot be done without unmerged work, call ' +
      'summarize and say which task it needs.'
   );
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
   /** A step-limit handover: a new session, and no restored conversation. */
   fresh: boolean;
   completionSpec: CompletionSpec | null;
   runtimeId: string | null;
   /** The personal AI adapter snapshot, distinct from the compute runtime above. */
   aiRuntimeId: AiRuntimeId | null;
   aiModelId: string | null;
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
   /** Who serves `model`: `bedrock`, `kilo`, or null when the agent names none. */
   modelProvider: string | null;
   /**
    * The gateway tier the agent runs on when it names no gateway model
    * (ADR-0017): its own (`agents.model_tier`), else its contract's, else its
    * role's in the catalogue (a contract customised before tiers existed),
    * else BerryLow for an agent outside the organization.
    */
   tier: Tier;
   /** The gateway model a run falls back to when the tier's choice fails; used by the routing. */
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
   /**
    * The model gateway (ADR-0017), when runs call models through it. A model
    * the gateway cannot serve — a Bedrock profile id, as every agent was
    * provisioned with — is not sent to it: the agent runs on its tier's
    * choice for today instead.
    */
   gateway?: { choose(tier: Tier, rejections?: number, place?: TierPlacement | null): Promise<TierChoice | null> } | undefined;
   /** The models a workspace placed in its tiers (Settings → AI); without one, the deployment's. */
   placements?: Pick<TierPlacements, 'get'> | undefined;
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
             ai_runtime_connection_id, ai_runtime_user_id, ai_runtime_account_id,
             ai_runtime_account_name, requested_by
        FROM runs WHERE id = ${runId}`;
   if (!row) throw new Error(`run ${runId} does not exist`);
   const origin = row.origin;
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
      fresh: typeof origin === 'object' && origin !== null && (origin as { fresh?: unknown }).fresh === true,
      completionSpec: (row.completion_spec as CompletionSpec | null) ?? null,
      runtimeId: (row.runtime_id as string | null) ?? null,
      aiRuntimeId: (row.ai_runtime_key as AiRuntimeId | null) ?? null,
      aiModelId: (row.ai_model_id as string | null) ?? null,
      aiRuntimeConnectionId: (row.ai_runtime_connection_id as string | null) ?? null,
      aiRuntimeUserId: (row.ai_runtime_user_id as string | null) ?? null,
      aiRuntimeAccountId: (row.ai_runtime_account_id as string | null) ?? null,
      aiRuntimeAccountName: (row.ai_runtime_account_name as string | null) ?? null,
      requestedBy: (row.requested_by as string | null) ?? null,
   };
}

/** The completions that make a plan (`plans/generator.ts`), which run on their agent's tier. */
const PLAN_PURPOSES: ReadonlySet<string> = new Set(['planner', 'repair', 'critic']);

/**
 * Where a merge fix runs: a tier below its agent's. It only reconciles a
 * finished task with main, and on BerryMax those runs cost about $0.75 each
 * to resolve README prose. BerryLow has nothing below it.
 */
const TIER_BELOW: Record<Tier, Tier> = { berry_max: 'berry_mid', berry_mid: 'berry_low', berry_low: 'berry_low' };

export class EnvelopeBuilder {
   readonly #deps: EnvelopeDeps;

   constructor(deps: EnvelopeDeps) {
      this.#deps = deps;
   }

   async build(input: { task: TaskRow; dispatch: Dispatch | null; token: string }): Promise<{
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
         // A chat task: the prompt is the message; workstream D adds the chat context.
         return {
            model,
            tier,
            delivery: null,
            envelope: {
               ...base,
               kind: 'agent',
               task: { prompt: task.prompt ?? '', issue: null, comments: [], dependencies: [], projectResources: [], priorWork: null },
               transcript,
               repo: null,
               completion: null,
            },
         };
      }

      // An issue task always carries its issue, claimed or not: a caller that
      // builds an envelope without the ledger's claim (a preview, a retry
      // path) still gets the issue prompt rather than a bare message.
      const dispatch = input.dispatch ?? (await this.#readDispatch(task.runId));
      const [related, reviewFeedback, recalled, loadedComments, dependencies, projectResources] = await Promise.all([
         this.#related(dispatch.issueId),
         lastRejection(this.#deps.sql, dispatch.issueId),
         this.#deps.memory.recall({ agentId: task.agentId, issueId: dispatch.issueId }),
         this.#comments(dispatch.issueId),
         this.#dependencies(dispatch.issueId),
         this.#projectResources(dispatch.issueId, task.workspaceId),
      ]);
      const comments = loadedComments.comments;
      const priorWork = recallPrompt(recalled);
      const relatedText = [related, dependencyNote(dependencies)].filter(Boolean).join('\n\n');
      const { repo, delivery, empty } = await this.#repository(task, dispatch, agent);
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
                  ...(relatedText ? { related: relatedText } : {}),
                  ...(priorWork ? { priorWork } : {}),
                  ...(repo?.readOnly ? { repositoryReadOnly: true } : {}),
                  ...(empty ? { repositoryEmpty: true } : {}),
                  skills: (extensions?.skills ?? []).map((skill) => ({ name: skill.name, description: skillDescription(skill) })),
                  ...(repo?.merge
                     ? { merge: mergePrompt({ baseBranch: repo.baseBranch, branch: repo.branch, conflicts: repo.merge.conflicts }) }
                     : {}),
                  // An agent's own comments are its reports. Before any of
                  // those exist, the comments on the task are a person's
                  // direction and belong in the prompt.
                  ...(!loadedComments.agentCommented && comments.length > 0
                     ? { comments: comments.map(({ author, body }) => ({ author, body })) }
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
      if (task.kind !== 'agent') {
         throw new AiRuntimeEnvelopeError(
            'AI_RUNTIME_UNSUPPORTED_TASK',
            'Personal AI runtimes can execute agent tasks only.',
            false
         );
      }
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
      if (
         task.aiRuntimeId === 'github-copilot' &&
         !/^(gho_|ghu_|github_pat_)/.test(credential.token)
      ) {
         throw new AiRuntimeEnvelopeError(
            'AI_RUNTIME_AUTH_REQUIRED',
            'GitHub Copilot requires a GitHub OAuth user token. Sign out of Berry and sign in with GitHub again.',
            false
         );
      }
      if (task.aiRuntimeId === 'kiro' && (credential.type !== 'api_key' || !isKiroApiKey(credential.token))) {
         throw new AiRuntimeEnvelopeError(
            'AI_RUNTIME_AUTH_REQUIRED',
            'Kiro requires the subscription API key from a Pro, Pro+, Pro Max, or Power plan. Reconnect it in AI Runtimes settings.',
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
         credential,
      };
   }

   /**
    * The model a task runs on. Without a gateway: the completion's own model,
    * else the agent's, else its runtime profile's, else the server default.
    * Through the gateway (ADR-0017) the same order, but only a gateway model
    * id counts — a Bedrock profile id would be refused — and when none is
    * named the agent runs on its tier's choice for today. A completion that
    * names none runs on BerryLow's, as it ran on Haiku before.
    */
   /** How many times this task's work was rejected at review (migration 214). */
   async #rejections(issueId: string): Promise<number> {
      const [row] = await this.#deps.sql`SELECT review_rejections FROM issues WHERE id = ${issueId}`;
      return row ? Number(row.review_rejections) : 0;
   }

   async #model(
      task: TaskRow,
      agent: AgentConfig,
      profileModel: string | null
   ): Promise<{ model: string; tier: Tier | null; fallback: string | null }> {
      const completionModel = task.kind === 'completion' ? (task.completionSpec?.model ?? null) : null;
      const gateway = this.#deps.gateway;
      if (!gateway) {
         return { model: completionModel ?? (agent.model || profileModel || this.#deps.defaultModel), tier: null, fallback: null };
      }

      const named = [
         completionModel,
         task.kind === 'completion' ? null : agent.modelProvider === 'kilo' || isGatewayModelId(agent.model) ? agent.model : null,
         task.kind === 'completion' ? null : profileModel,
         isGatewayModelId(this.#deps.defaultModel) ? this.#deps.defaultModel : null,
      ].find((candidate): candidate is string => !!candidate && isGatewayModelId(candidate));
      // A single call runs on BerryLow, except a plan's: the plan decides every
      // task, its order and who takes it, so it is written, repaired and
      // criticised on the tier of the agent it runs as, the Orchestrator.
      const tier: Tier =
         task.kind !== 'completion' || PLAN_PURPOSES.has(task.completionSpec?.purpose ?? '')
            ? task.source === 'merge_fix'
               ? TIER_BELOW[agent.tier]
               : agent.tier
            : 'berry_low';
      // A task starts on its tier's first model and moves down the list only
      // when its work is rejected at review (`chooseForTier`).
      const choice = await gateway.choose(
         tier,
         task.kind === 'agent' && task.issueId ? await this.#rejections(task.issueId) : 0,
         (await this.#deps.placements?.get(task.workspaceId)) ?? null
      );
      // The agent's own fallback wins; otherwise Berry's default from the
      // leaderboard (decided 2026-09-25). Never the model itself.
      const own = agent.fallbackModel && isGatewayModelId(agent.fallbackModel) ? agent.fallbackModel : null;
      if (named) {
         const tierDefault = choice ? (choice.model !== named ? choice.model : choice.fallback) : null;
         return { model: named, tier: null, fallback: own && own !== named ? own : tierDefault };
      }
      if (!choice) throw new Error(`no model is available on the ${tier} tier or its fallbacks today`);
      return { model: choice.model, tier, fallback: own && own !== choice.model ? own : choice.fallback };
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
    * The latest comments, oldest first, and whether any agent has commented
    * on the task at all. The window is the last 30; the flag looks at every
    * comment, so an older agent report still keeps the thread out of the prompt.
    */
   async #comments(issueId: string): Promise<{ comments: TaskEnvelope['task']['comments']; agentCommented: boolean }> {
      const [rows, [flag]] = await Promise.all([
         this.#deps.sql`
            SELECT c.body, c.created_at, c.author_type::text AS author_type,
                   COALESCE(u.name, a.name, 'someone') AS author
              FROM comments AS c
              LEFT JOIN users AS u ON c.author_type = 'user' AND u.id = c.author_id
              LEFT JOIN agents AS a ON c.author_type = 'agent' AND a.id = c.author_id
             WHERE c.issue_id = ${issueId}
             ORDER BY c.created_at DESC LIMIT 30`,
         this.#deps.sql`
            SELECT EXISTS (
               SELECT 1 FROM comments
                WHERE issue_id = ${issueId} AND author_type = 'agent'
            ) AS agent_commented`,
      ]);
      return {
         comments: rows.reverse().map((row) => ({
            author: row.author as string,
            body: row.body as string,
            createdAt: new Date(row.created_at as string).toISOString(),
         })),
         agentCommented: flag?.agent_commented === true,
      };
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

   async #repository(task: TaskRow, dispatch: Dispatch, agent: AgentConfig): Promise<{ repo: RepoPlan | null; delivery: DeliveryPlan | null; empty?: true }> {
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
      const [snapshot] = await this.#deps.sql`SELECT base_commit, merge_parent, merge_base FROM run_repository_snapshots WHERE run_id = ${task.runId}`;
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
      return {
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
 * A repository with no commits has no default branch to check out, and every
 * run on the project failed at "the default branch is missing". A person
 * links a repository they just created more often than one they have already
 * pushed to, so Berry gives it its first commit: an empty README on the
 * default branch, the way GitHub's own "create README" button does. Only a run
 * that may push does it; a read-only run goes ahead without a checkout.
 */
async function initialiseRepository(
   client: Pick<GitHubClient, 'putFile' | 'branchHead'>,
   input: { owner: string; name: string; fullName: string; branch: string }
): Promise<string> {
   try {
      await client.putFile({
         owner: input.owner,
         name: input.name,
         branch: input.branch,
         path: 'README.md',
         // Empty on purpose: the first agent to write a README replaces it whole,
         // and an empty file is the one version of it no later branch can conflict with.
         content: '',
         message: `Initial commit on ${input.branch}`,
         sha: null,
      });
   } catch (error) {
      // A plan starts several tasks at once, and each finds the repository
      // empty: the first run's commit wins, and GitHub answers the others
      // "reference already exists". That is the outcome they were after, so
      // they carry on from it; only a branch that is still missing is a failure.
      const head = await client.branchHead(input.owner, input.name, input.branch);
      if (head) return head;
      throw error;
   }
   const head = await client.branchHead(input.owner, input.name, input.branch);
   if (!head) throw new Error(`${input.fullName} still has no ${input.branch} after Berry's first commit`);
   return head;
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

