import type { Sql } from '../db/pool.ts';
import {
   AI_RUNTIME_CATALOG,
   findAiRuntime,
   isAiRuntimeId,
   type AiRuntimeDefinition,
   type AiRuntimeId,
} from './ai-runtime-catalog.ts';

export const NATIVE_AI_RUNTIME = 'berry-native';

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
}

export interface ResolvedAiRuntimeSelection {
   runtimeId: AiRuntimeId | null;
   modelId: string | null;
   connectionId: string | null;
   userId: string | null;
   accountId: string | null;
   accountName: string | null;
}

export interface AiRuntimeRunSelection {
   runtimeId: AiRuntimeId;
   modelId: string;
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
      const [row] = await this.#sql<Array<{ ai_runtime_key: string | null; ai_model_id: string | null }>>`
         SELECT i.ai_runtime_key, i.ai_model_id
           FROM issues AS i JOIN boards AS b ON b.id = i.board_id
          WHERE i.id = ${issueId} AND b.workspace_id = ${workspaceId} AND i.deleted_at IS NULL`;
      if (!row) throw new AiRuntimeConnectionNotFound();
      return selection(row.ai_runtime_key, row.ai_model_id);
   }

   async saveIssueSelection(
      workspaceId: string,
      issueId: string,
      userId: string,
      value: { runtimeId: string | null; modelId: string | null }
   ): Promise<AiRuntimeSelection> {
      const parsed = selection(value.runtimeId, value.modelId);
      validateSelection(parsed);
      if (parsed.runtimeId !== null && parsed.runtimeId !== NATIVE_AI_RUNTIME) {
         await assertConnected(this.#sql, workspaceId, userId, parsed.runtimeId);
      }
      const rows = await this.#sql`
         UPDATE issues AS i SET ai_runtime_key = ${parsed.runtimeId}, ai_model_id = ${parsed.modelId}, updated_at = now()
          FROM boards AS b
          WHERE i.id = ${issueId} AND i.board_id = b.id AND b.workspace_id = ${workspaceId}
            AND i.deleted_at IS NULL
         RETURNING i.id`;
      if (rows.length === 0) throw new AiRuntimeConnectionNotFound();
      return this.issueSelection(workspaceId, issueId);
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

function selection(runtimeId: string | null, modelId: string | null): AiRuntimeSelection {
   if (runtimeId === null) return { runtimeId: null, modelId: null };
   if (runtimeId === NATIVE_AI_RUNTIME) return { runtimeId, modelId: null };
   if (!isAiRuntimeId(runtimeId)) {
      throw new AiRuntimeSelectionError('AI_RUNTIME_UNKNOWN', `Unknown AI runtime ${runtimeId}.`);
   }
   return { runtimeId, modelId };
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
   }>>`
      SELECT connection.id, connection.external_account_id, connection.external_account_name
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
   };
}

/**
 * Resolves and snapshots a run's personal AI runtime.
 *
 * `overrideRuntimeId = null` means the task or conversation inherits the
 * requesting person's preference. `berry-native` explicitly opts this one
 * task out of that preference. A non-native runtime always resolves against
 * a connection owned by the same requesting user.
 */
export async function resolveAiRuntimeSelection(
   sql: Sql,
   input: {
      workspaceId: string;
      userId: string | null;
      overrideRuntimeId: string | null;
      overrideModelId: string | null;
   }
): Promise<ResolvedAiRuntimeSelection> {
   let runtimeId = input.overrideRuntimeId;
   let modelId = input.overrideModelId;
   if (runtimeId === null && input.userId !== null) {
      const [preference] = await sql<Array<{ runtime_key: string | null; model_id: string | null }>>`
         SELECT runtime_key, model_id FROM ai_runtime_preferences
          WHERE workspace_id = ${input.workspaceId} AND user_id = ${input.userId}`;
      runtimeId = preference?.runtime_key ?? null;
      modelId = preference?.model_id ?? null;
   }
   if (runtimeId === null || runtimeId === NATIVE_AI_RUNTIME) {
      return {
         runtimeId: null,
         modelId: null,
         connectionId: null,
         userId: null,
         accountId: null,
         accountName: null,
      };
   }
   if (!isAiRuntimeId(runtimeId)) {
      throw new AiRuntimeSelectionError('AI_RUNTIME_UNKNOWN', `Unknown AI runtime ${runtimeId}.`);
   }
   if (input.userId === null) {
      throw new AiRuntimeSelectionError(
         'AI_RUNTIME_USER_REQUIRED',
         `${requireRuntime(runtimeId).name} is a personal subscription and cannot run unattended work.`
      );
   }
   const connected = await assertConnected(sql, input.workspaceId, input.userId, runtimeId);
   const selectedModel = modelId ?? connected.definition.defaultModel;
   if (!selectedModel) {
      throw new AiRuntimeSelectionError(
         'AI_RUNTIME_MODEL_INVALID',
         `Choose a model for ${connected.definition.name} before running this task.`
      );
   }
   return {
      runtimeId,
      modelId: selectedModel,
      connectionId: connected.id,
      userId: input.userId,
      accountId: connected.accountId,
      accountName: connected.accountName,
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
      connectionId: saved.connectionId,
      userId: saved.userId,
      accountId: saved.accountId,
      accountName: saved.accountName ?? connection.external_account_name,
   };
}
