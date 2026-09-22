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
import type { McpServerRef, RepoPlan, TaskEnvelope, TranscriptMessage } from './envelope.ts';
import { runtimeSessionIdFor, sessionKeyFor } from './session-id.ts';
import { buildTranscript } from './transcript.ts';
import { findMerge, mergePrompt, planMerge, type MergePlan } from './merge-plan.ts';
import { loadAgentExtensions, type ExtensionDeps } from '../agents/extensions.ts';
import { pluginMcpServers } from '../plugins/mcp.ts';
import type { PluginRepository } from '../plugins/repository.ts';
import type { PluginRuntimeStore } from '../plugins/runtime-store.ts';
import { parseContract } from '../organization/contract.ts';

/** How much of the tasks around a task goes into its prompt: enough to know the goal and the answers, not their history. */
const RELATED_PARENT_CHARS = 1500;
const RELATED_CHILD_CHARS = 600;
const RELATED_CHILDREN = 12;

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
   completionSpec: CompletionSpec | null;
   runtimeId: string | null;
}

export interface AgentConfig {
   maxTurns?: number;
   maxOutputTokens?: number;
   id: string;
   name: string;
   instructions: string;
   model: string;
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
             prompt, completion_spec, runtime_id
        FROM runs WHERE id = ${runId}`;
   if (!row) throw new Error(`run ${runId} does not exist`);
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
      completionSpec: (row.completion_spec as CompletionSpec | null) ?? null,
      runtimeId: (row.runtime_id as string | null) ?? null,
   };
}

export class EnvelopeBuilder {
   readonly #deps: EnvelopeDeps;

   constructor(deps: EnvelopeDeps) {
      this.#deps = deps;
   }

   async build(input: { task: TaskRow; dispatch: Dispatch | null; token: string }): Promise<{
      envelope: TaskEnvelope;
      delivery: DeliveryPlan | null;
      model: string;
   }> {
      const { task } = input;
      const agent = await this.#agent(task.agentId);
      const profile = await this.#profile(agent.runtimeProfileId, task.workspaceId);
      const model =
         (task.kind === 'completion' ? task.completionSpec?.model : null) ?? (agent.model || profile.model || this.#deps.defaultModel);
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
      const sessionKey = sessionKeyFor({
         kind: task.kind, runId: task.runId, agentId: task.agentId, issueId: task.issueId, chatSessionId: task.chatSessionId,
      });

      const base = {
         runId: task.runId,
         sessionKey,
         runtimeSessionId: runtimeSessionIdFor(sessionKey),
         agent: {
            name: agent.name,
            instructions,
            model,
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

      const transcript = await buildTranscript(this.#deps.sql, {
         agentId: task.agentId, issueId: task.issueId, chatSessionId: task.chatSessionId, excludeRunId: task.runId,
      });

      if (!task.issueId) {
         // A chat task: the prompt is the message; workstream D adds the chat context.
         return {
            model,
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
      const [related, reviewFeedback, recalled, comments, dependencies, projectResources] = await Promise.all([
         this.#related(dispatch.issueId),
         lastRejection(this.#deps.sql, dispatch.issueId),
         this.#deps.memory.recall({ agentId: task.agentId, issueId: dispatch.issueId }),
         this.#comments(dispatch.issueId),
         this.#dependencies(dispatch.issueId),
         this.#projectResources(dispatch.issueId, task.workspaceId),
      ]);
      const priorWork = recallPrompt(recalled);
      const { repo, delivery } = await this.#repository(task, dispatch, agent);
      return {
         model,
         delivery,
         envelope: {
            ...base,
            kind: 'agent',
            task: {
               prompt: buildMessage({
                  ...dispatch,
                  reviewFeedback,
                  ...(related ? { related } : {}),
                  ...(priorWork ? { priorWork } : {}),
                  ...(repo?.readOnly ? { repositoryReadOnly: true } : {}),
                  ...(repo?.merge
                     ? { merge: mergePrompt({ baseBranch: repo.baseBranch, branch: repo.branch, conflicts: repo.merge.conflicts }) }
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

   async #agent(agentId: string): Promise<AgentConfig> {
      const [row] = await this.#deps.sql`
         SELECT id, name, instructions, model_name, permissions, runtime_profile_id, role_key, role_contract, manifest_limits
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

   async #comments(issueId: string): Promise<TaskEnvelope['task']['comments']> {
      const rows = await this.#deps.sql`
         SELECT c.body, c.created_at, c.author_type::text AS author_type,
                COALESCE(u.name, a.name, 'someone') AS author
           FROM comments AS c
           LEFT JOIN users AS u ON c.author_type = 'user' AND u.id = c.author_id
           LEFT JOIN agents AS a ON c.author_type = 'agent' AND a.id = c.author_id
          WHERE c.issue_id = ${issueId}
          ORDER BY c.created_at DESC LIMIT 30`;
      return rows.reverse().map((row) => ({
         author: row.author as string,
         body: row.body as string,
         createdAt: new Date(row.created_at as string).toISOString(),
      }));
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

   async #repository(task: TaskRow, dispatch: Dispatch, agent: AgentConfig): Promise<{ repo: RepoPlan | null; delivery: DeliveryPlan | null }> {
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
      const defaultCommit = await client.branchHead(owner, name, remote.defaultBranch);
      if (!defaultCommit) throw new Error('The repository default branch is missing');
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
