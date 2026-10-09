import type { Sql } from '../db/pool.ts';
import { catalogRole } from '../organization/catalog.ts';
import type { RoleKey } from '../organization/contract.ts';
import {
   AI_RUNTIME_CATALOG,
   findAiRuntime,
   isAiRuntimeId,
   type AiRuntimeDefinition,
   type AiRuntimeId,
} from './ai-runtime-catalog.ts';

export const NATIVE_AI_RUNTIME = 'berry-native';

/** The three Berry tiers a subscription agent can be placed in. */
export const RUNTIME_AGENT_TIERS = ['berry_max', 'berry_mid', 'berry_low'] as const;
export type RuntimeAgentTier = (typeof RUNTIME_AGENT_TIERS)[number];
export type RuntimeAgentTierPlacement = Record<RuntimeAgentTier, string[]>;

export function emptyAgentTiers(): RuntimeAgentTierPlacement {
   return { berry_max: [], berry_mid: [], berry_low: [] };
}

export type AiRuntimeConnectionStatus = 'connected' | 'expired' | 'error' | 'disconnected';

export interface AiRuntimeConnection {
   id: string;
   runtimeId: AiRuntimeId;
   status: AiRuntimeConnectionStatus;
   authMethod: string;
   accountId: string | null;
   accountName: string | null;
   metadata: Record<string, unknown>;
   connectedAt: string;
   disconnectedAt: string | null;
   lastCheckedAt: string | null;
   lastError: string | null;
}

export interface AiRuntimePreference {
   runtimeId: AiRuntimeId | null;
   modelId: string | null;
}

export interface AiRuntimeSelection {
   runtimeId: AiRuntimeId | typeof NATIVE_AI_RUNTIME | null;
   modelId: string | null;
   /** Provider agent profile, such as a Kiro agent name. Null uses the CLI default. */
   agentId: string | null;
}

export interface ResolvedAiRuntimeSelection {
   runtimeId: AiRuntimeId | null;
   modelId: string | null;
   agentId: string | null;
   connectionId: string | null;
   userId: string | null;
   accountId: string | null;
   accountName: string | null;
}

export interface AiRuntimeRunSelection {
   runtimeId: AiRuntimeId;
   modelId: string;
   agentId: string | null;
   connectionId: string;
   userId: string;
   accountId: string | null;
   accountName: string | null;
}

export type AiRuntimeSelectionErrorCode =
   | 'AI_RUNTIME_UNKNOWN'
   | 'AI_RUNTIME_UNAVAILABLE'
   | 'AI_RUNTIME_NOT_CONNECTED'
   | 'AI_RUNTIME_USER_REQUIRED'
   | 'AI_RUNTIME_MODEL_INVALID';

export class AiRuntimeSelectionError extends Error {
   override readonly name = 'AiRuntimeSelectionError';
   readonly code: AiRuntimeSelectionErrorCode;

   constructor(code: AiRuntimeSelectionErrorCode, message: string) {
      super(message);
      this.code = code;
   }
}

export class AiRuntimeConnectionNotFound extends Error {
   override readonly name = 'AiRuntimeConnectionNotFound';
}

interface ConnectionRow {
   id: string;
   runtime_key: string;
   auth_method: string;
   status: string;
   external_account_id: string | null;
   external_account_name: string | null;
   metadata: unknown;
   connected_at: string | Date;
   disconnected_at: string | Date | null;
   last_checked_at: string | Date | null;
   last_error: string | null;
}

function object(value: unknown): Record<string, unknown> {
   return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
}

function timestamp(value: string | Date | null): string | null {
   return value === null ? null : new Date(value).toISOString();
}

function toConnection(row: ConnectionRow): AiRuntimeConnection {
   if (!isAiRuntimeId(row.runtime_key)) {
      throw new AiRuntimeSelectionError('AI_RUNTIME_UNKNOWN', `Unknown AI runtime ${row.runtime_key}.`);
   }
   return {
      id: row.id,
      runtimeId: row.runtime_key,
      authMethod: row.auth_method,
      status: row.status as AiRuntimeConnectionStatus,
      accountId: row.external_account_id,
      accountName: row.external_account_name,
      metadata: object(row.metadata),
      connectedAt: new Date(row.connected_at).toISOString(),
      disconnectedAt: timestamp(row.disconnected_at),
      lastCheckedAt: timestamp(row.last_checked_at),
      lastError: row.last_error,
   };
}

export class AiRuntimeRepository {
   readonly #sql: Sql;

   constructor(sql: Sql) {
      this.#sql = sql;
   }

   catalog(): readonly AiRuntimeDefinition[] {
      return AI_RUNTIME_CATALOG;
   }

   async listConnections(workspaceId: string, userId: string): Promise<AiRuntimeConnection[]> {
      const rows = await this.#sql<ConnectionRow[]>`
         SELECT DISTINCT ON (runtime_key)
                id, runtime_key, auth_method, status, external_account_id, external_account_name,
                metadata, connected_at, disconnected_at, last_checked_at, last_error
           FROM ai_runtime_connections
          WHERE workspace_id = ${workspaceId} AND user_id = ${userId}
          ORDER BY runtime_key, created_at DESC, id DESC`;
      return rows.map(toConnection);
   }

   /** Each agent's tier for this workspace. Null when nobody has assigned one. */
   async agentTiers(workspaceId: string): Promise<RuntimeAgentTierPlacement | null> {
      const rows = await this.#sql<Array<{ agent_key: string; tier: string }>>`
         SELECT agent_key, tier FROM workspace_agent_tiers
          WHERE workspace_id = ${workspaceId}
          ORDER BY agent_key`;
      if (rows.length === 0) return null;
      const tiers = emptyAgentTiers();
      for (const row of rows) {
         const tier = asTier(row.tier);
         const agent = agentName(row.agent_key);
         if (tier && agent) tiers[tier].push(agent);
      }
      return tiers;
   }

   async saveAgentTiers(
      workspaceId: string,
      userId: string,
      placement: RuntimeAgentTierPlacement | null
   ): Promise<RuntimeAgentTierPlacement | null> {
      if (placement === null) {
         await this.#sql`DELETE FROM workspace_agent_tiers WHERE workspace_id = ${workspaceId}`;
         return null;
      }
      const rows = RUNTIME_AGENT_TIERS.flatMap((tier) =>
         placement[tier].map((agent) => ({ agent, tier }))
      );
      await this.#sql.begin(async (tx) => {
         await tx`DELETE FROM workspace_agent_tiers WHERE workspace_id = ${workspaceId}`;
         for (const row of rows) {
            await tx`
               INSERT INTO workspace_agent_tiers (workspace_id, agent_key, tier, updated_by, updated_at)
               VALUES (${workspaceId}, ${row.agent}, ${row.tier}, ${userId}, now())`;
         }
      });
      return {
         berry_max: [...placement.berry_max],
         berry_mid: [...placement.berry_mid],
         berry_low: [...placement.berry_low],
      };
   }

   /** Models placed in the workspace's tiers. Each entry is `runtime/model`. */
   async tierModels(workspaceId: string): Promise<RuntimeAgentTierPlacement | null> {
      const [row] = await this.#sql<Array<Record<string, string[]>>>`
         SELECT berry_max, berry_mid, berry_low FROM workspace_tier_models
          WHERE workspace_id = ${workspaceId}`;
      if (!row) return null;
      return {
         berry_max: stringList(row.berry_max),
         berry_mid: stringList(row.berry_mid),
         berry_low: stringList(row.berry_low),
      };
   }

   async saveTierModels(
      workspaceId: string,
      userId: string,
      placement: RuntimeAgentTierPlacement | null
   ): Promise<RuntimeAgentTierPlacement | null> {
      if (placement === null) {
         await this.#sql`DELETE FROM workspace_tier_models WHERE workspace_id = ${workspaceId}`;
         return null;
      }
      await this.#sql`
         INSERT INTO workspace_tier_models
            (workspace_id, berry_max, berry_mid, berry_low, updated_by, updated_at)
         VALUES (${workspaceId}, ${placement.berry_max}, ${placement.berry_mid}, ${placement.berry_low},
                 ${userId}, now())
         ON CONFLICT (workspace_id) DO UPDATE
            SET berry_max = EXCLUDED.berry_max, berry_mid = EXCLUDED.berry_mid, berry_low = EXCLUDED.berry_low,
                updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`;
      return {
         berry_max: [...placement.berry_max],
         berry_mid: [...placement.berry_mid],
         berry_low: [...placement.berry_low],
      };
   }

   /** Merges agent names onto a connection so the assignee list can show them. */
   async rememberAgents(connectionId: string, agents: Array<{ id: string; name: string }>): Promise<void> {
      await this.#sql`
         UPDATE ai_runtime_connections
            SET metadata = metadata || ${this.#sql.json({ agents } as never)}::jsonb, updated_at = now()
          WHERE id = ${connectionId} AND status = 'connected'`;
   }

   async connection(workspaceId: string, userId: string, runtimeId: AiRuntimeId): Promise<AiRuntimeConnection | null> {
      const [row] = await this.#sql<ConnectionRow[]>`
         SELECT id, runtime_key, auth_method, status, external_account_id, external_account_name,
                metadata, connected_at, disconnected_at, last_checked_at, last_error
           FROM ai_runtime_connections
          WHERE workspace_id = ${workspaceId} AND user_id = ${userId} AND runtime_key = ${runtimeId}
          ORDER BY created_at DESC, id DESC
          LIMIT 1`;
      return row ? toConnection(row) : null;
   }

   async connect(input: {
      workspaceId: string;
      userId: string;
      runtimeId: AiRuntimeId;
      authMethod: string;
      accountId: string | null;
      accountName: string | null;
      metadata?: Record<string, unknown>;
      credentialSealed?: Buffer | null;
   }): Promise<{ connection: AiRuntimeConnection; replacedActiveRunIds: string[] }> {
      const definition = requireRuntime(input.runtimeId);
      if (definition.availability !== 'available') {
         throw new AiRuntimeSelectionError(
            'AI_RUNTIME_UNAVAILABLE',
            definition.unavailableReason ?? `${definition.name} is not available in this Berry build.`
         );
      }
      const result = await this.#sql.begin(async (transaction) => {
         const tx = transaction as unknown as Sql;
         // The membership row serializes two connection ceremonies and proves
         // the account still belongs in this workspace before a token is used.
         const [membership] = await tx`
            SELECT 1 FROM workspace_memberships
             WHERE workspace_id = ${input.workspaceId} AND user_id = ${input.userId}
             FOR UPDATE`;
         if (!membership) {
            throw new AiRuntimeSelectionError(
               'AI_RUNTIME_USER_REQUIRED',
               'This account is no longer a member of the workspace.'
            );
         }
         const current = await tx<Array<{ id: string }>>`
            SELECT id FROM ai_runtime_connections
             WHERE workspace_id = ${input.workspaceId} AND user_id = ${input.userId}
               AND runtime_key = ${input.runtimeId} AND status = 'connected'
             FOR UPDATE`;
         const currentIds = current.map((row) => row.id);
         const active =
            currentIds.length === 0
               ? []
               : await tx<Array<{ id: string }>>`
                    SELECT id FROM runs
                     WHERE ai_runtime_connection_id IN ${tx(currentIds)}
                       AND status IN ('queued', 'running')
                     ORDER BY created_at`;
         if (currentIds.length > 0) {
            await tx`
               UPDATE ai_runtime_connections
                  SET status = 'disconnected', disconnected_at = now(),
                      credential_sealed = NULL,
                      last_error = 'replaced by a new connection', updated_at = now()
                WHERE id IN ${tx(currentIds)}`;
         }
         const [created] = await tx<Array<{ id: string }>>`
            INSERT INTO ai_runtime_connections
               (workspace_id, user_id, runtime_key, auth_method, status, external_account_id,
                external_account_name, metadata, credential_sealed, connected_at, disconnected_at,
                last_checked_at, last_error, updated_at)
            VALUES (${input.workspaceId}, ${input.userId}, ${input.runtimeId}, ${input.authMethod},
                    'connected', ${input.accountId}, ${input.accountName},
                    ${tx.json((input.metadata ?? {}) as never)}, ${input.credentialSealed ?? null},
                    now(), NULL, now(), NULL, now())
            RETURNING id`;
         if (!created) throw new AiRuntimeConnectionNotFound();
         return { id: created.id, activeRunIds: active.map((run) => run.id) };
      });
      const [row] = await this.#sql<ConnectionRow[]>`
         SELECT id, runtime_key, auth_method, status, external_account_id, external_account_name,
                metadata, connected_at, disconnected_at, last_checked_at, last_error
           FROM ai_runtime_connections WHERE id = ${result.id}`;
      if (!row) throw new AiRuntimeConnectionNotFound();
      return { connection: toConnection(row), replacedActiveRunIds: result.activeRunIds };
   }

   /** Disconnect first, then the mount cancels every returned active run through the ledger. */
   async disconnect(
      workspaceId: string,
      userId: string,
      runtimeId: AiRuntimeId
   ): Promise<{ disconnected: boolean; activeRunIds: string[] }> {
      return this.#sql.begin(async (transaction) => {
         const tx = transaction as unknown as Sql;
         // Admission takes a shared lock on this row. Once this exclusive lock
         // is held, no run can validate the connection until it is disconnected.
         const [row] = await tx<Array<{ id: string }>>`
            SELECT id FROM ai_runtime_connections
             WHERE workspace_id = ${workspaceId} AND user_id = ${userId}
               AND runtime_key = ${runtimeId} AND status = 'connected'
             ORDER BY created_at DESC, id DESC
             LIMIT 1
             FOR UPDATE`;
         if (!row) return { disconnected: false, activeRunIds: [] };
         const active = await tx<Array<{ id: string }>>`
            SELECT id FROM runs
             WHERE ai_runtime_connection_id = ${row.id} AND status IN ('queued', 'running')
             ORDER BY created_at`;
         await tx`
            UPDATE ai_runtime_connections
               SET status = 'disconnected', disconnected_at = now(), credential_sealed = NULL,
                   last_error = NULL, updated_at = now()
             WHERE id = ${row.id}`;
         // Disconnect is an explicit request to stop using this account. Future
         // work returns to the deployment default only because the person asked.
         await tx`
            UPDATE ai_runtime_preferences
               SET runtime_key = NULL, model_id = NULL, updated_at = now()
             WHERE workspace_id = ${workspaceId} AND user_id = ${userId}
               AND runtime_key = ${runtimeId}`;
         return { disconnected: true, activeRunIds: active.map((run) => run.id) };
      }) as Promise<{ disconnected: boolean; activeRunIds: string[] }>;
   }

   /** Ciphertext only. The caller opens it and must not log the plaintext. */
   async sealedCredential(
      workspaceId: string,
      userId: string,
      runtimeId: AiRuntimeId,
      connectionId: string
   ): Promise<Buffer | null> {
      const [row] = await this.#sql<Array<{ credential_sealed: Buffer | null }>>`
         SELECT credential_sealed
           FROM ai_runtime_connections
          WHERE id = ${connectionId}
            AND workspace_id = ${workspaceId}
            AND user_id = ${userId}
            AND runtime_key = ${runtimeId}
            AND status = 'connected'`;
      const sealed = row?.credential_sealed;
      return sealed ? Buffer.from(sealed) : null;
   }

   async recordModels(
      connectionId: string,
      models: Array<{ id: string; name: string; reasoning: boolean | null; tools: boolean | null; policy: string | null }>
   ): Promise<void> {
      const updated = await this.#sql`
         UPDATE ai_runtime_connections
            SET metadata = metadata || ${this.#sql.json({ models, modelCatalogComplete: true } as never)}::jsonb,
                last_checked_at = now(), last_error = NULL, updated_at = now()
          WHERE id = ${connectionId} AND status = 'connected'
          RETURNING id`;
      if (updated.length === 0) {
         throw new AiRuntimeSelectionError(
            'AI_RUNTIME_NOT_CONNECTED',
            'The AI runtime connection changed while its models were refreshed. Refresh again.'
         );
      }
   }

   async preference(workspaceId: string, userId: string): Promise<AiRuntimePreference> {
      const [row] = await this.#sql<Array<{ runtime_key: string | null; model_id: string | null }>>`
         SELECT runtime_key, model_id FROM ai_runtime_preferences
          WHERE workspace_id = ${workspaceId} AND user_id = ${userId}`;
      if (!row || row.runtime_key === null) return { runtimeId: null, modelId: null };
      if (!isAiRuntimeId(row.runtime_key)) {
         throw new AiRuntimeSelectionError('AI_RUNTIME_UNKNOWN', `Unknown AI runtime ${row.runtime_key}.`);
      }
      return { runtimeId: row.runtime_key, modelId: row.model_id };
   }

   async savePreference(
      workspaceId: string,
      userId: string,
      preference: AiRuntimePreference
   ): Promise<AiRuntimePreference> {
      if (preference.runtimeId === null && preference.modelId !== null) {
         throw new AiRuntimeSelectionError(
            'AI_RUNTIME_MODEL_INVALID',
            'A model can be selected only with an AI runtime.'
         );
      }
      if (preference.runtimeId !== null) {
         await assertConnected(this.#sql, workspaceId, userId, preference.runtimeId);
      }
      await this.#sql`
         INSERT INTO ai_runtime_preferences (workspace_id, user_id, runtime_key, model_id)
         VALUES (${workspaceId}, ${userId}, ${preference.runtimeId}, ${preference.modelId})
         ON CONFLICT (workspace_id, user_id) DO UPDATE
            SET runtime_key = EXCLUDED.runtime_key, model_id = EXCLUDED.model_id, updated_at = now()`;
      return this.preference(workspaceId, userId);
   }

   async issueSelection(workspaceId: string, issueId: string): Promise<AiRuntimeSelection> {
      const [row] = await this.#sql<Array<{
         ai_runtime_key: string | null;
         ai_model_id: string | null;
         ai_runtime_agent: string | null;
      }>>`
         SELECT i.ai_runtime_key, i.ai_model_id, i.ai_runtime_agent
           FROM issues AS i JOIN boards AS b ON b.id = i.board_id
          WHERE i.id = ${issueId} AND b.workspace_id = ${workspaceId} AND i.deleted_at IS NULL`;
      if (!row) throw new AiRuntimeConnectionNotFound();
      return selection(row.ai_runtime_key, row.ai_model_id, row.ai_runtime_agent);
   }

   async saveIssueSelection(
      workspaceId: string,
      issueId: string,
      userId: string,
      value: { runtimeId: string | null; modelId: string | null; agentId?: string | null | undefined }
   ): Promise<AiRuntimeSelection> {
      const parsed = selection(value.runtimeId, value.modelId, value.agentId);
      validateSelection(parsed);
      if (parsed.runtimeId !== null && parsed.runtimeId !== NATIVE_AI_RUNTIME) {
         await assertConnected(this.#sql, workspaceId, userId, parsed.runtimeId);
      }
      const rows = await this.#sql`
         UPDATE issues AS i
            SET ai_runtime_key = ${parsed.runtimeId}, ai_model_id = ${parsed.modelId},
                ai_runtime_agent = ${parsed.agentId}, updated_at = now()
          FROM boards AS b
          WHERE i.id = ${issueId} AND i.board_id = b.id AND b.workspace_id = ${workspaceId}
            AND i.deleted_at IS NULL
         RETURNING i.id`;
      if (rows.length === 0) throw new AiRuntimeConnectionNotFound();
      return this.issueSelection(workspaceId, issueId);
   }

   async projectSelection(workspaceId: string, projectId: string): Promise<AiRuntimeSelection> {
      const [row] = await this.#sql<Array<{
         ai_runtime_key: string | null;
         ai_model_id: string | null;
         ai_runtime_agent: string | null;
      }>>`
         SELECT ai_runtime_key, ai_model_id, ai_runtime_agent FROM projects
          WHERE id = ${projectId} AND workspace_id = ${workspaceId} AND deleted_at IS NULL`;
      if (!row) throw new AiRuntimeConnectionNotFound();
      return selection(row.ai_runtime_key, row.ai_model_id, row.ai_runtime_agent);
   }

   async saveProjectSelection(
      workspaceId: string,
      projectId: string,
      userId: string,
      value: { runtimeId: string | null; modelId: string | null; agentId?: string | null | undefined }
   ): Promise<AiRuntimeSelection> {
      const parsed = selection(value.runtimeId, value.modelId, value.agentId);
      validateSelection(parsed);
      if (parsed.runtimeId !== null && parsed.runtimeId !== NATIVE_AI_RUNTIME) {
         await assertConnected(this.#sql, workspaceId, userId, parsed.runtimeId);
      }
      const rows = await this.#sql`
         UPDATE projects
            SET ai_runtime_key = ${parsed.runtimeId}, ai_model_id = ${parsed.modelId},
                ai_runtime_agent = ${parsed.agentId}, updated_at = now()
          WHERE id = ${projectId} AND workspace_id = ${workspaceId} AND deleted_at IS NULL
         RETURNING id`;
      if (rows.length === 0) throw new AiRuntimeConnectionNotFound();
      return this.projectSelection(workspaceId, projectId);
   }

   async conversationSelection(
      workspaceId: string,
      conversationId: string,
      userId: string
   ): Promise<AiRuntimeSelection> {
      const [row] = await this.#sql<Array<{ ai_runtime_key: string | null; ai_model_id: string | null }>>`
         SELECT c.ai_runtime_key, c.ai_model_id
           FROM conversations AS c
           JOIN conversation_participants AS p
             ON p.conversation_id = c.id AND p.participant_type = 'user'
            AND p.participant_id = ${userId} AND p.left_at IS NULL
          WHERE c.id = ${conversationId} AND c.workspace_id = ${workspaceId}`;
      if (!row) throw new AiRuntimeConnectionNotFound();
      return selection(row.ai_runtime_key, row.ai_model_id);
   }

   async saveConversationSelection(
      workspaceId: string,
      conversationId: string,
      userId: string,
      value: { runtimeId: string | null; modelId: string | null }
   ): Promise<AiRuntimeSelection> {
      const parsed = selection(value.runtimeId, value.modelId);
      validateSelection(parsed);
      if (parsed.runtimeId !== null && parsed.runtimeId !== NATIVE_AI_RUNTIME) {
         await assertConnected(this.#sql, workspaceId, userId, parsed.runtimeId);
      }
      const rows = await this.#sql`
         UPDATE conversations AS c SET ai_runtime_key = ${parsed.runtimeId}, ai_model_id = ${parsed.modelId}, updated_at = now()
          WHERE c.id = ${conversationId} AND c.workspace_id = ${workspaceId}
            AND EXISTS (SELECT 1 FROM conversation_participants AS p
                         WHERE p.conversation_id = c.id AND p.participant_type = 'user'
                           AND p.participant_id = ${userId} AND p.left_at IS NULL)
         RETURNING c.id`;
      if (rows.length === 0) throw new AiRuntimeConnectionNotFound();
      return this.conversationSelection(workspaceId, conversationId, userId);
   }
}

/**
 * Revokes every personal runtime for a member inside the membership-removal transaction.
 *
 * Admission holds a shared lock on the selected connection until its run row is
 * inserted. Taking the exclusive locks first means either that insertion is
 * visible below, or the later admission observes a disconnected generation and
 * fails. Network cancellation deliberately happens only after this transaction.
 */
export async function revokeAiRuntimeConnectionsForMember(
   tx: Sql,
   workspaceId: string,
   userId: string
): Promise<string[]> {
   const connections = await tx<Array<{ id: string }>>`
      SELECT id FROM ai_runtime_connections
       WHERE workspace_id = ${workspaceId} AND user_id = ${userId}
         AND status <> 'disconnected'
       ORDER BY created_at, id
       FOR UPDATE`;
   const connectionIds = connections.map((connection) => connection.id);
   if (connectionIds.length > 0) {
      await tx`
         UPDATE ai_runtime_connections
            SET status = 'disconnected', disconnected_at = now(),
                last_error = 'workspace membership ended', updated_at = now()
          WHERE id IN ${tx(connectionIds)}`;
   }
   await tx`
      DELETE FROM ai_runtime_preferences
       WHERE workspace_id = ${workspaceId} AND user_id = ${userId}`;
   const active = await tx<Array<{ id: string }>>`
      SELECT id FROM runs
       WHERE workspace_id = ${workspaceId} AND ai_runtime_user_id = ${userId}
         AND status IN ('queued', 'running')
       ORDER BY created_at, id`;
   return active.map((run) => run.id);
}

function asTier(value: unknown): RuntimeAgentTier | null {
   return typeof value === 'string' && (RUNTIME_AGENT_TIERS as readonly string[]).includes(value)
      ? (value as RuntimeAgentTier)
      : null;
}

async function berryAgentTier(sql: Sql, workspaceId: string, agentId: string): Promise<RuntimeAgentTier> {
   const [row] = await sql<Array<{ model_tier: string | null; role_key: string | null; role_contract: unknown }>>`
      SELECT model_tier, role_key, role_contract FROM agents
       WHERE id = ${agentId} AND workspace_id = ${workspaceId}`;
   const own = asTier(row?.model_tier);
   if (own) return own;
   const contract = row?.role_contract;
   if (contract !== null && typeof contract === 'object' && !Array.isArray(contract)) {
      const fromContract = asTier((contract as { tier?: unknown }).tier);
      if (fromContract) return fromContract;
   }
   return asTier(catalogRole((row?.role_key ?? '') as RoleKey)?.tier) ?? 'berry_low';
}

/** An explicit profile wins. Otherwise the first agent placed in this Berry agent's tier. */
async function agentForTier(
   sql: Sql,
   workspaceId: string,
   runtimeId: AiRuntimeId,
   berryAgentId: string | null | undefined,
   chosen: string | null
): Promise<string | null> {
   const explicit = agentName(chosen);
   if (explicit) return explicit;
   if (!berryAgentId) return null;
   if (runtimeId !== 'kiro') return null;
   const tier = await berryAgentTier(sql, workspaceId, berryAgentId);
   const [row] = await sql<Array<{ agent_key: string }>>`
      SELECT agent_key FROM workspace_agent_tiers
       WHERE workspace_id = ${workspaceId} AND tier = ${tier}
       ORDER BY agent_key
       LIMIT 1`;
   return agentName(row?.agent_key ?? null);
}

/** The first model this runtime has in the Berry agent's tier. `runtime/model` in storage. */
async function modelForTier(
   sql: Sql,
   workspaceId: string,
   runtimeId: AiRuntimeId,
   berryAgentId: string | null | undefined
): Promise<string | null> {
   if (!berryAgentId) return null;
   const tier = await berryAgentTier(sql, workspaceId, berryAgentId);
   const [row] = await sql<Array<Record<string, string[]>>>`
      SELECT berry_max, berry_mid, berry_low FROM workspace_tier_models
       WHERE workspace_id = ${workspaceId}`;
   if (!row) return null;
   const prefix = `${runtimeId}/`;
   for (const entry of stringList(row[tier])) {
      if (entry.startsWith(prefix)) {
         const model = entry.slice(prefix.length);
         if (model.length > 0) return model;
      }
   }
   return null;
}

function stringList(value: string[] | undefined): string[] {
   return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.length > 0) : [];
}

function agentName(value: string | null | undefined): string | null {
   if (typeof value !== 'string') return null;
   const name = value.trim();
   return /^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(name) ? name : null;
}

function selection(
   runtimeId: string | null,
   modelId: string | null,
   agentId?: string | null
): AiRuntimeSelection {
   if (runtimeId === null) return { runtimeId: null, modelId: null, agentId: null };
   if (runtimeId === NATIVE_AI_RUNTIME) return { runtimeId, modelId: null, agentId: null };
   if (!isAiRuntimeId(runtimeId)) {
      throw new AiRuntimeSelectionError('AI_RUNTIME_UNKNOWN', `Unknown AI runtime ${runtimeId}.`);
   }
   return { runtimeId, modelId, agentId: agentName(agentId) };
}

function validateSelection(value: AiRuntimeSelection): void {
   if (value.runtimeId === null || value.runtimeId === NATIVE_AI_RUNTIME) {
      if (value.modelId !== null) {
         throw new AiRuntimeSelectionError(
            'AI_RUNTIME_MODEL_INVALID',
            'A model override requires a connected AI runtime.'
         );
      }
      return;
   }
   requireRuntime(value.runtimeId);
}

function requireRuntime(runtimeId: string): AiRuntimeDefinition {
   const definition = findAiRuntime(runtimeId);
   if (!definition) {
      throw new AiRuntimeSelectionError('AI_RUNTIME_UNKNOWN', `Unknown AI runtime ${runtimeId}.`);
   }
   return definition;
}

async function assertConnected(
   sql: Sql,
   workspaceId: string,
   userId: string,
   runtimeId: AiRuntimeId
): Promise<{
   id: string;
   definition: AiRuntimeDefinition;
   accountId: string | null;
   accountName: string | null;
   metadata: unknown;
}> {
   const definition = requireRuntime(runtimeId);
   if (definition.availability !== 'available') {
      throw new AiRuntimeSelectionError(
         'AI_RUNTIME_UNAVAILABLE',
         definition.unavailableReason ?? `${definition.name} is not available in this Berry build.`
      );
   }
   const [connection] = await sql<Array<{
      id: string;
      external_account_id: string | null;
      external_account_name: string | null;
      metadata: unknown;
   }>>`
      SELECT connection.id, connection.external_account_id, connection.external_account_name, connection.metadata
        FROM ai_runtime_connections AS connection
        JOIN workspace_memberships AS membership
          ON membership.workspace_id = connection.workspace_id
         AND membership.user_id = connection.user_id
       WHERE connection.workspace_id = ${workspaceId} AND connection.user_id = ${userId}
         AND connection.runtime_key = ${runtimeId} AND connection.status = 'connected'
       ORDER BY connection.created_at DESC, connection.id DESC
       LIMIT 1
       FOR SHARE OF connection`;
   if (!connection) {
      throw new AiRuntimeSelectionError(
         'AI_RUNTIME_NOT_CONNECTED',
         `Connect ${definition.name} for your account before selecting it.`
      );
   }
   return {
      id: connection.id,
      definition,
      accountId: connection.external_account_id,
      accountName: connection.external_account_name,
      metadata: connection.metadata,
   };
}

/** A run with no advertised model uses the subscription CLI's own default. */
export const SUBSCRIPTION_DEFAULT_MODEL = 'default';

/**
 * Resolves and snapshots the AI runtime an agent run will execute on.
 *
 * `berry-native` opts this one task back onto Bedrock or Kilo. Otherwise a
 * connected subscription wins: the task override, then the project's
 * runtime, then that person's preference, then their newest connection,
 * then any connected runtime in the workspace. Agent work therefore stays
 * off the deployment's API bill once someone has connected a runtime. A
 * missing connection still does not fall through to Kilo after a
 * subscription was selected.
 */
export async function resolveAiRuntimeSelection(
   sql: Sql,
   input: {
      workspaceId: string;
      userId: string | null;
      issueId?: string | null;
      overrideRuntimeId: string | null;
      overrideModelId: string | null;
      overrideAgentId?: string | null;
      /** The Berry agent doing the work, so its tier can name a subscription agent. */
      berryAgentId?: string | null;
   }
): Promise<ResolvedAiRuntimeSelection> {
   let runtimeId = input.overrideRuntimeId;
   let modelId = input.overrideModelId;
   let agentId = input.overrideAgentId ?? null;
   if (runtimeId === null && input.issueId) {
      const project = await projectRuntimeForIssue(sql, input.issueId);
      if (project) {
         runtimeId = project.runtimeId;
         modelId = project.modelId;
         agentId = project.agentId;
      }
   }
   if (runtimeId === null && input.userId !== null) {
      const [preference] = await sql<Array<{ runtime_key: string | null; model_id: string | null }>>`
         SELECT runtime_key, model_id FROM ai_runtime_preferences
          WHERE workspace_id = ${input.workspaceId} AND user_id = ${input.userId}`;
      runtimeId = preference?.runtime_key ?? null;
      modelId = preference?.model_id ?? null;
      agentId = null;
   }
   if (runtimeId === NATIVE_AI_RUNTIME) {
      return emptySelection();
   }
   if (runtimeId !== null && !isAiRuntimeId(runtimeId)) {
      throw new AiRuntimeSelectionError('AI_RUNTIME_UNKNOWN', `Unknown AI runtime ${runtimeId}.`);
   }
   if (runtimeId !== null && input.userId !== null) {
      const connected = await assertConnected(sql, input.workspaceId, input.userId, runtimeId);
      return snapshot(
         {
            id: connected.id,
            runtimeId,
            definition: connected.definition,
            userId: input.userId,
            accountId: connected.accountId,
            accountName: connected.accountName,
            metadata: connected.metadata,
         },
         modelId ?? (await modelForTier(sql, input.workspaceId, runtimeId, input.berryAgentId)),
         await agentForTier(sql, input.workspaceId, runtimeId, input.berryAgentId, agentId)
      );
   }
   const picked = await pickConnectedRuntime(sql, input.workspaceId, input.userId, runtimeId);
   if (!picked) {
      if (runtimeId !== null) {
         throw new AiRuntimeSelectionError(
            'AI_RUNTIME_NOT_CONNECTED',
            `Connect ${requireRuntime(runtimeId).name} before running this task.`
         );
      }
      return emptySelection();
   }
   return snapshot(
      picked,
      modelId ?? (await modelForTier(sql, input.workspaceId, picked.runtimeId, input.berryAgentId)),
      await agentForTier(sql, input.workspaceId, picked.runtimeId, input.berryAgentId, agentId)
   );
}

/** The runtime chosen on the task's project, when the task itself has none. */
async function projectRuntimeForIssue(
   sql: Sql,
   issueId: string
): Promise<{ runtimeId: string; modelId: string | null; agentId: string | null } | null> {
   const [row] = await sql<Array<{
      ai_runtime_key: string | null;
      ai_model_id: string | null;
      ai_runtime_agent: string | null;
   }>>`
      SELECT project.ai_runtime_key, project.ai_model_id, project.ai_runtime_agent
        FROM issue_project_links AS link
        JOIN projects AS project ON project.id = link.project_id AND project.deleted_at IS NULL
       WHERE link.issue_id = ${issueId}
         AND project.ai_runtime_key IS NOT NULL
       LIMIT 1`;
   if (!row?.ai_runtime_key) return null;
   return { runtimeId: row.ai_runtime_key, modelId: row.ai_model_id, agentId: row.ai_runtime_agent };
}

function emptySelection(): ResolvedAiRuntimeSelection {
   return {
      runtimeId: null,
      modelId: null,
      agentId: null,
      connectionId: null,
      userId: null,
      accountId: null,
      accountName: null,
   };
}

function snapshot(
   connected: {
      id: string;
      runtimeId: AiRuntimeId;
      definition: AiRuntimeDefinition;
      userId: string;
      accountId: string | null;
      accountName: string | null;
      metadata: unknown;
   },
   modelId: string | null,
   agentId: string | null
): ResolvedAiRuntimeSelection {
   return {
      runtimeId: connected.runtimeId,
      modelId: modelId ?? modelOf(connected.metadata, connected.definition),
      agentId: agentName(agentId),
      connectionId: connected.id,
      userId: connected.userId,
      accountId: connected.accountId,
      accountName: connected.accountName,
   };
}

function modelOf(metadata: unknown, definition: AiRuntimeDefinition): string {
   const models = metadata && typeof metadata === 'object' ? (metadata as { models?: unknown }).models : null;
   if (Array.isArray(models)) {
      for (const model of models) {
         if (model && typeof model === 'object' && typeof (model as { id?: unknown }).id === 'string') {
            const id = (model as { id: string }).id;
            if (id !== '') return id;
         }
      }
   }
   return definition.defaultModel ?? SUBSCRIPTION_DEFAULT_MODEL;
}

/**
 * The connection that should take agent work off Bedrock/Kilo.
 *
 * The authorizing person's own connection comes first. Unattended and
 * delegated work then uses the workspace's newest connected runtime, so a
 * connected subscription is what runs rather than the deployment API.
 */
async function pickConnectedRuntime(
   sql: Sql,
   workspaceId: string,
   userId: string | null,
   runtimeId: AiRuntimeId | null
): Promise<{
   id: string;
   runtimeId: AiRuntimeId;
   definition: AiRuntimeDefinition;
   userId: string;
   accountId: string | null;
   accountName: string | null;
   metadata: unknown;
} | null> {
   const executable = AI_RUNTIME_CATALOG.filter((runtime) => runtime.availability === 'available').map(
      (runtime) => runtime.id
   );
   const [connection] = await sql<Array<{
      id: string;
      user_id: string;
      runtime_key: string;
      external_account_id: string | null;
      external_account_name: string | null;
      metadata: unknown;
   }>>`
      SELECT connection.id, connection.user_id, connection.runtime_key,
             connection.external_account_id, connection.external_account_name, connection.metadata
        FROM ai_runtime_connections AS connection
        JOIN workspace_memberships AS membership
          ON membership.workspace_id = connection.workspace_id
         AND membership.user_id = connection.user_id
       WHERE connection.workspace_id = ${workspaceId}
         AND connection.status = 'connected'
         AND connection.runtime_key IN ${sql(executable)}
         AND (${runtimeId}::text IS NULL OR connection.runtime_key = ${runtimeId})
       ORDER BY CASE
                   WHEN ${userId}::uuid IS NOT NULL AND connection.user_id = ${userId}::uuid THEN 0
                   ELSE 1
                END,
                connection.connected_at DESC, connection.id DESC
       LIMIT 1
       FOR SHARE OF connection`;
   if (!connection || !isAiRuntimeId(connection.runtime_key)) return null;
   const definition = requireRuntime(connection.runtime_key);
   return {
      id: connection.id,
      runtimeId: connection.runtime_key,
      definition,
      userId: connection.user_id,
      accountId: connection.external_account_id,
      accountName: connection.external_account_name,
      metadata: connection.metadata,
   };
}

/** Revalidates an immutable selection copied from an earlier run. Never falls back. */
export async function retainAiRuntimeSelection(
   sql: Sql,
   input: { workspaceId: string; selection: AiRuntimeRunSelection }
): Promise<ResolvedAiRuntimeSelection> {
   const { selection: saved } = input;
   const [connection] = await sql<Array<{
      external_account_id: string | null;
      external_account_name: string | null;
   }>>`
      SELECT connection.external_account_id, connection.external_account_name
        FROM ai_runtime_connections AS connection
        JOIN workspace_memberships AS membership
          ON membership.workspace_id = connection.workspace_id
         AND membership.user_id = connection.user_id
       WHERE connection.id = ${saved.connectionId}
         AND connection.workspace_id = ${input.workspaceId}
         AND connection.user_id = ${saved.userId}
         AND connection.runtime_key = ${saved.runtimeId}
         AND connection.status = 'connected'
         AND connection.external_account_id IS NOT DISTINCT FROM ${saved.accountId}
       FOR SHARE OF connection`;
   if (!connection) {
      throw new AiRuntimeSelectionError(
         'AI_RUNTIME_NOT_CONNECTED',
         `${requireRuntime(saved.runtimeId).name} is no longer connected to the account that authorized this work.`
      );
   }
   return {
      runtimeId: saved.runtimeId,
      modelId: saved.modelId,
      agentId: saved.agentId,
      connectionId: saved.connectionId,
      userId: saved.userId,
      accountId: saved.accountId,
      accountName: saved.accountName ?? connection.external_account_name,
   };
}
