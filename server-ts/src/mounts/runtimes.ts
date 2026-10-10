import { createHash, randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { requireSession, type AuthVariables } from '../auth/middleware.ts';
import type { SessionService } from '../auth/sessions.ts';
import type { Sql } from '../db/pool.ts';
import { json } from '../http/app.ts';
import { ApiError } from '../http/errors.ts';
import type { Mount } from '../http/registry.ts';
import type { Sealer } from '../integrations/sealing.ts';
import { lifecycleFor } from '../runtime/runtime-control.ts';
import { isAiRuntimeId, findAiRuntime } from '../runtime/ai-runtime-catalog.ts';
import { computerHost } from '../runtime/computer-host.ts';
import { CLAUDE_CLI_LOGIN, CODEX_CLI_LOGIN, isKiroApiKey } from '../runtime/envelope.ts';
import { listKiroAgents } from '../runtime/kiro-agents.ts';
import {
   AiRuntimeConnectionNotFound,
   AiRuntimeRepository,
   AiRuntimeSelectionError,
   emptyAgentTiers,
   NATIVE_AI_RUNTIME,
   RUNTIME_AGENT_TIERS,
} from '../runtime/ai-runtimes.ts';
import {
   RuntimeNotFound,
   RuntimeProtected,
   RuntimeRepository,
   RuntimeSealingUnavailable,
   type ProfileView,
   type RuntimeView,
} from '../runtime/runtimes.ts';
import type { RuntimeTarget } from '../runtime/transport.ts';
import type { RuntimeControlRequest, RuntimeControlResponse } from '../runtime/envelope.ts';
import { runtimeSessionIdFor } from '../runtime/session-id.ts';
import type { Permission } from '../identity/roles.ts';
import type { ScopedDb } from '../identity/workspace-context.ts';
import { currentWorkspace, owned, pathId, resolveScoped, resolveScopedResource } from './shared.ts';

const seconds = z.number().int().min(60).max(28_800);
const runtimeBody = z.object({
   name: z.string().trim().min(1).max(100).optional(),
   driver: z.enum(['agentcore', 'http']).optional(),
   arn: z
      .string()
      .regex(/^arn:aws[a-z-]*:bedrock-agentcore:[a-z0-9-]+:\d{12}:runtime\/[A-Za-z0-9_-]+$/)
      .nullable()
      .optional(),
   endpointUrl: z.url({ protocol: /^https?$/ }).nullable().optional(),
   qualifier: z.string().min(1).max(100).optional(),
   region: z.string().min(1).max(40).nullable().optional(),
   concurrencyLimit: z.number().int().positive().max(1000).nullable().optional(),
   visibility: z.enum(['private', 'workspace']).optional(),
   idleTimeoutS: seconds.optional(),
   isDefault: z.boolean().optional(),
   status: z.enum(['active', 'disabled']).optional(),
});
const profileBody = z.object({
   name: z.string().trim().min(1).max(100).optional(),
   env: z.record(z.string().regex(/^[A-Z_][A-Z0-9_]*$/), z.string().max(8192)).optional(),
   modelDefault: z.string().min(1).max(200).nullable().optional(),
   timeoutS: z.number().int().min(30).max(28_800).nullable().optional(),
   maxConcurrency: z.number().int().positive().max(1000).nullable().optional(),
   idleTimeoutS: seconds.nullable().optional(),
});

type Lifecycle = { idleRuntimeSessionTimeout: number; maxLifetime: number };

/** `runtime/model` keys a connected runtime in this workspace currently offers. */
async function modelsConnected(sql: Sql, workspaceId: string): Promise<Set<string>> {
   const rows = await sql<Array<{ runtime_key: string; metadata: unknown }>>`
      SELECT runtime_key, metadata FROM ai_runtime_connections
       WHERE workspace_id = ${workspaceId} AND status = 'connected'`;
   const allowed = new Set<string>();
   for (const row of rows) {
      if (!isAiRuntimeId(row.runtime_key)) continue;
      const metadata = row.metadata;
      const listed =
         metadata !== null && typeof metadata === 'object' && !Array.isArray(metadata)
            ? (metadata as { models?: unknown }).models
            : undefined;
      if (Array.isArray(listed)) {
         for (const model of listed) {
            if (model === null || typeof model !== 'object') continue;
            const id = (model as { id?: unknown }).id;
            if (typeof id !== 'string') continue;
            const trimmed = id.trim();
            if (trimmed.length > 0) allowed.add(`${row.runtime_key}/${trimmed}`);
         }
      }
      const fallback = findAiRuntime(row.runtime_key)?.defaultModel;
      if (fallback) allowed.add(`${row.runtime_key}/${fallback}`);
      allowed.add(`${row.runtime_key}/default`);
   }
   return allowed;
}

/**
 * `/api/v1/runtimes`: where a workspace's agents run, and how.
 *
 * Scoped to the caller's current workspace. Reads need `product.read`; every
 * write needs `settings.write` (owners and admins). A runtime, profile or
 * agent from another workspace is a 404, never a 403.
 */
export function runtimeMounts(options: {
   sessions: SessionService;
   sql: Sql;
   sealer: Sealer | null;
   /** Probes a target; throws with the reason when it is not healthy. */
   health: (target: RuntimeTarget) => Promise<void>;
   /** The deployment's own runtime, which a platform row stands for. */
   defaultTarget?: RuntimeTarget | null;
   /** Writes a session lifecycle onto an AgentCore runtime. Absent without AgentCore. */
   applyLifecycle?: (arn: string, lifecycle: Lifecycle) => Promise<void>;
   /** Cancels an active run after its personal runtime connection is removed. */
   cancelRun?: (runId: string) => Promise<void>;
   /** Runs adapter control operations inside the configured runtime image. */
   runtimeControl?: (request: RuntimeControlRequest) => Promise<RuntimeControlResponse>;
}): Mount[] {
   const repository = new RuntimeRepository(options.sql, options.sealer);
   const aiRuntimes = new AiRuntimeRepository(options.sql);
   const route = new Hono<{ Variables: AuthVariables }>();
   route.use('*', requireSession(options.sessions));

   const scope = async (userId: string, workspaceId: string | null, write: boolean): Promise<string> => {
      if (!workspaceId) throw ApiError.notFound('Workspace');
      const scoped = await resolveScoped(options.sql, userId, workspaceId, write ? 'settings.write' : 'product.read');
      return scoped.ctx.workspaceId;
   };
   /**
    * The scope for a write on named rows. Each row is found in the caller's
    * workspace before `settings.write` is checked, so an absent or foreign id
    * is the same 404 for every role, and a 403 only ever speaks of a row the
    * caller could already see.
    */
   const scopeFor = async (
      user: { id: string; currentWorkspaceId: string | null },
      required: Permission,
      ...rows: Array<(db: ScopedDb) => Promise<void>>
   ): Promise<string> => {
      const scoped = await resolveScopedResource(
         options.sql,
         user.id,
         currentWorkspace(user.currentWorkspaceId),
         required,
         async (db) => {
            for (const row of rows) await row(db);
         }
      );
      return scoped.ctx.workspaceId;
   };
   // Every miss is "Runtime not found", as the repository's own misses are,
   // so which row was absent is not told apart either.
   const runtimeRow = (id: string) => owned('agent_runtimes', id, 'Runtime');
   const profileRow = (id: string) => owned('runtime_profiles', id, 'Runtime');
   const agentRow = (id: string) => owned('agents', id, 'Runtime');
   const parse = async <S extends z.ZodType>(request: Request, schema: S): Promise<z.output<S>> => {
      const parsed = schema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) {
         throw ApiError.badRequest('the request is not valid', {
            fields: parsed.error.issues.map((issue) => ({ path: `/${issue.path.join('/')}`, message: issue.message })),
         });
      }
      return parsed.data;
   };
   const guard = <T>(work: Promise<T>): Promise<T> =>
      work.catch((error: unknown) => {
         if (error instanceof RuntimeNotFound) throw ApiError.notFound('Runtime');
         if (error instanceof RuntimeProtected) {
            throw new ApiError(409, 'RUNTIME_PROTECTED', 'the platform runtime cannot be removed');
         }
         if (error instanceof RuntimeSealingUnavailable) {
            throw new ApiError(503, 'SEALING_UNAVAILABLE', 'this deployment cannot store profile environment');
         }
         throw error;
      });
   const aiError = (error: unknown): never => {
      if (error instanceof AiRuntimeConnectionNotFound) throw ApiError.notFound('AI runtime connection');
      if (error instanceof AiRuntimeSelectionError) {
         const status = error.code === 'AI_RUNTIME_UNKNOWN' ? 404 : 409;
         throw new ApiError(status, error.code, error.message);
      }
      throw error;
   };
   const aiRuntimeId = (raw: string | undefined) => {
      const value = (raw ?? '').trim();
      if (!isAiRuntimeId(value)) throw ApiError.notFound('AI runtime');
      return value;
   };
   const controlError = (error: Extract<RuntimeControlResponse, { ok: false }>['error']): never => {
      const status =
         error.code === 'QUOTA_EXHAUSTED'
            ? 429
            : error.code === 'MODEL_UNAVAILABLE'
              ? 422
              : error.code.startsWith('AUTH_')
                ? 409
                : 503;
      throw new ApiError(status, `AI_${error.code}`, error.message);
   };
   const cancelRuns = async (runIds: string[]): Promise<void> => {
      if (runIds.length === 0) return;
      const cancel = options.cancelRun;
      if (!cancel) {
         throw new ApiError(
            503,
            'AI_RUNTIME_DISCONNECT_INCOMPLETE',
            'The connection was removed, but this process cannot stop its active runs.'
         );
      }
      const results = await Promise.allSettled(runIds.map((runId) => cancel(runId)));
      if (results.some((result) => result.status === 'rejected')) {
         throw new ApiError(
            503,
            'AI_RUNTIME_DISCONNECT_INCOMPLETE',
            'The connection was removed, but one or more runtime sessions could not be stopped. Check runtime health.'
         );
      }
   };
   const kiroCredential = async (workspaceId: string, userId: string, connectionId: string) => {
      if (!options.sealer) {
         throw new ApiError(503, 'SEALING_UNAVAILABLE', 'This deployment cannot open a Kiro API key.');
      }
      const sealed = await aiRuntimes.sealedCredential(workspaceId, userId, 'kiro', connectionId);
      if (!sealed) {
         throw new ApiError(409, 'AI_RUNTIME_AUTH_REQUIRED', 'Reconnect Kiro. The stored API key is missing.');
      }
      let token: string;
      try {
         token = options.sealer.open(sealed);
      } catch {
         throw new ApiError(409, 'AI_RUNTIME_AUTH_EXPIRED', 'The stored Kiro API key could not be opened. Reconnect Kiro.');
      }
      if (!isKiroApiKey(token)) {
         throw new ApiError(409, 'AI_RUNTIME_AUTH_REQUIRED', 'Reconnect Kiro with a subscription API key.');
      }
      const connection = await aiRuntimes.connection(workspaceId, userId, 'kiro');
      return {
         type: 'api_key' as const,
         token,
         accountId: connection?.accountId ?? null,
         accountName: connection?.accountName ?? null,
      };
   };
   const modelId = z.string().trim().min(1).max(300).nullable();
   const preferenceBody = z.strictObject({ runtimeId: z.string().nullable(), modelId });

   /**
    * A profile's idle timeout lives on the AgentCore runtime, not the session,
    * so saving it writes the runtime. Its failure never fails the save: the
    * profile is stored and the response says the runtime was not updated.
    */
   const withLifecycle = async (
      runtime: RuntimeView,
      profile: ProfileView
   ): Promise<ProfileView & { lifecycleApplied?: boolean; lifecycleError?: string }> => {
      if (runtime.kind !== 'custom' || runtime.driver !== 'agentcore' || !runtime.arn || !options.applyLifecycle) {
         return profile;
      }
      try {
         await options.applyLifecycle(runtime.arn, lifecycleFor(runtime, profile));
         return { ...profile, lifecycleApplied: true };
      } catch (error) {
         return { ...profile, lifecycleApplied: false, lifecycleError: error instanceof Error ? error.message : String(error) };
      }
   };

   route.get('/catalog', async (context) => {
      const user = context.get('user');
      const workspaceId = await scope(user.id, user.currentWorkspaceId, false);
      const [connections, preference] = await Promise.all([
         aiRuntimes.listConnections(workspaceId, user.id),
         aiRuntimes.preference(workspaceId, user.id),
      ]);
      const kiro = connections.find((connection) => connection.runtimeId === 'kiro' && connection.status === 'connected');
      if (kiro) {
         const metadata =
            kiro.metadata !== null && typeof kiro.metadata === 'object' && !Array.isArray(kiro.metadata)
               ? (kiro.metadata as Record<string, unknown>)
               : {};
         if (!Array.isArray(metadata.agents) || metadata.agents.length === 0) {
            const agents = await listKiroAgents();
            await aiRuntimes.rememberAgents(kiro.id, agents);
            kiro.metadata = { ...metadata, agents };
         }
      }
      const byRuntime = new Map(connections.map((connection) => [connection.runtimeId, connection]));
      return json({
         nodes: aiRuntimes.catalog().map((definition) => ({
            ...definition,
            connection: byRuntime.get(definition.id) ?? null,
         })),
         preference,
         native: {
            id: NATIVE_AI_RUNTIME,
            name: 'Berry managed',
            billing: 'api_billing',
            description: 'The deployment’s existing Bedrock or Kilo model path.',
         },
      });
   });

   route.get('/connections', async (context) => {
      const user = context.get('user');
      const workspaceId = await scope(user.id, user.currentWorkspaceId, false);
      return json({ nodes: await aiRuntimes.listConnections(workspaceId, user.id) });
   });

   route.post('/connections/:runtimeId', async (context) => {
      const user = context.get('user');
      const workspaceId = await scope(user.id, user.currentWorkspaceId, false);
      const runtimeId = aiRuntimeId(context.req.param('runtimeId'));
      const body = await parse(context.req.raw, z.strictObject({
         apiKey: z.string().trim().min(1).max(300).optional(),
         name: z.string().trim().min(1).max(80).optional(),
         host: z.string().trim().min(1).max(253).optional(),
      }));
      const host = body.host === undefined ? 'localhost' : computerHost(body.host);
      if (host === null) {
         throw ApiError.badRequest('Host must be localhost or a fully qualified domain name.');
      }
      if (host !== 'localhost') {
         throw new ApiError(
            409,
            'AI_RUNTIME_HOST_UNREACHABLE',
            `Berry starts the CLI on the computer where this server runs. Connect with localhost.`
         );
      }
      if (runtimeId === 'claude' || runtimeId === 'codex') {
         if (!options.runtimeControl) {
            throw new ApiError(503, 'AI_RUNTIME_AUTH_UNAVAILABLE', `${runtimeId === 'codex' ? 'Codex' : 'Claude'} runs on this workstation, and that process is not available.`);
         }
         const credential = {
            type: 'oauth' as const,
            token: runtimeId === 'codex' ? CODEX_CLI_LOGIN : CLAUDE_CLI_LOGIN,
            accountId: null,
            accountName: null,
         };
         const probed = await options.runtimeControl({
            runtimeSessionId: runtimeSessionIdFor(`ai-runtime-connect:${workspaceId}:${user.id}:${runtimeId}`),
            operation: 'connection',
            runtimeId,
            credential,
         });
         if ('error' in probed) controlError(probed.error);
         const status = 'connection' in probed ? probed.connection : undefined;
         if (!status || status.status !== 'connected') {
            throw new ApiError(409, 'AI_RUNTIME_AUTH_FAILED', status?.detail ?? `${runtimeId === 'codex' ? 'Codex' : 'Claude'} CLI is not signed in on this workstation.`);
         }
         const listed = await options.runtimeControl({
            runtimeSessionId: runtimeSessionIdFor(`ai-runtime-models:${workspaceId}:${user.id}:${runtimeId}`),
            operation: 'models',
            runtimeId,
            credential: {
               ...credential,
               accountId: status.accountId,
               accountName: status.accountName,
            },
         });
         if ('error' in listed) controlError(listed.error);
         const models = 'models' in listed ? (listed.models ?? []) : [];
         const connected = await aiRuntimes
            .connect({
               workspaceId,
               userId: user.id,
               runtimeId,
               authMethod: runtimeId === 'codex' ? 'codex_cli' : 'claude_cli',
               accountId: status.accountId,
               accountName: status.accountName ?? (runtimeId === 'codex' ? 'ChatGPT' : 'Claude'),
               metadata: {
                  models,
                  modelCatalogComplete: true,
                  host,
                  ...(body.name ? { connectionName: body.name } : {}),
               },
            })
            .catch(aiError);
         await cancelRuns(connected.replacedActiveRunIds);
         return json(connected.connection, 201);
      }
      if (runtimeId === 'kiro') {
         const apiKey = body.apiKey ?? '';
         if (!isKiroApiKey(apiKey)) {
            throw ApiError.badRequest('Kiro needs an API key from a Pro, Pro+, Pro Max, or Power plan.');
         }
         if (!options.sealer) {
            throw new ApiError(503, 'SEALING_UNAVAILABLE', 'This deployment cannot store a Kiro API key.');
         }
         if (!options.runtimeControl) {
            throw new ApiError(503, 'AI_RUNTIME_AUTH_UNAVAILABLE', 'Kiro runs on this workstation, and that process is not available.');
         }
         const accountId = createHash('sha256').update(apiKey).digest('hex').slice(0, 16);
         const credential = {
            type: 'api_key' as const,
            token: apiKey,
            accountId,
            accountName: 'Kiro subscription',
         };
         const sessionId = runtimeSessionIdFor(`ai-runtime-connect:${workspaceId}:${user.id}:${runtimeId}`);
         const probed = await options.runtimeControl({
            runtimeSessionId: sessionId,
            operation: 'connection',
            runtimeId,
            credential,
         });
         if ('error' in probed) controlError(probed.error);
         const status = 'connection' in probed ? probed.connection : undefined;
         if (!status || status.status !== 'connected') {
            throw new ApiError(409, 'AI_RUNTIME_AUTH_FAILED', status?.detail ?? 'Kiro rejected this API key.');
         }
         const listed = await options.runtimeControl({
            runtimeSessionId: runtimeSessionIdFor(`ai-runtime-models:${workspaceId}:${user.id}:${runtimeId}`),
            operation: 'models',
            runtimeId,
            credential: {
               ...credential,
               accountName: status.accountName ?? credential.accountName,
            },
         });
         if ('error' in listed) controlError(listed.error);
         const models = 'models' in listed ? (listed.models ?? []) : [];
         const connected = await aiRuntimes
            .connect({
               workspaceId,
               userId: user.id,
               runtimeId,
               authMethod: 'kiro_api_key',
               accountId,
               accountName: status.accountName ?? 'Kiro subscription',
               metadata: {
                  models,
                  modelCatalogComplete: true,
                  host,
                  ...(body.name ? { connectionName: body.name } : {}),
               },
               credentialSealed: options.sealer.seal(apiKey),
            })
            .catch(aiError);
         await cancelRuns(connected.replacedActiveRunIds);
         return json(connected.connection, 201);
      }
      throw new ApiError(
         409,
         'AI_RUNTIME_UNAVAILABLE',
         aiRuntimes.catalog().find((runtime) => runtime.id === runtimeId)?.unavailableReason ??
            'This AI runtime is not available in this Berry build.'
      );
   });

   route.delete('/connections/:runtimeId', async (context) => {
      const user = context.get('user');
      const workspaceId = await scope(user.id, user.currentWorkspaceId, false);
      const runtimeId = aiRuntimeId(context.req.param('runtimeId'));
      const disconnected = await aiRuntimes.disconnect(workspaceId, user.id, runtimeId);
      await cancelRuns(disconnected.activeRunIds);
      return new Response(null, { status: 204 });
   });

   const agentTierList = z.array(z.string().trim().min(1).max(80));
   const agentTierBody = z.strictObject({
      placement: z
         .strictObject({
            berry_max: agentTierList,
            berry_mid: agentTierList,
            berry_low: agentTierList,
         })
         .nullable(),
   });

   route.get('/agent-tiers', async (context) => {
      const user = context.get('user');
      const workspaceId = await scope(user.id, user.currentWorkspaceId, false);
      const tiers = await aiRuntimes.agentTiers(workspaceId);
      return json({
         source: tiers ? 'workspace' : 'unset',
         tiers: tiers ?? emptyAgentTiers(),
      });
   });

   route.put('/agent-tiers', async (context) => {
      const user = context.get('user');
      const workspaceId = await scope(user.id, user.currentWorkspaceId, true);
      const body = await parse(context.req.raw, agentTierBody);
      if (body.placement !== null) {
         const allowed = new Set((await listKiroAgents()).map((agent) => agent.id));
         const seen = new Set<string>();
         for (const tier of RUNTIME_AGENT_TIERS) {
            for (const id of body.placement[tier]) {
               if (!allowed.has(id) || seen.has(id) || !/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(id)) {
                  throw new ApiError(422, 'AI_RUNTIME_AGENT_INVALID', `${id} already has a tier, or is not an agent.`);
               }
               seen.add(id);
            }
         }
      }
      const tiers = await aiRuntimes.saveAgentTiers(workspaceId, user.id, body.placement);
      return json({
         source: tiers ? 'workspace' : 'unset',
         tiers: tiers ?? emptyAgentTiers(),
      });
   });

   const tierModelList = z.array(z.string().trim().min(3).max(360)).max(3);
   const tierModelBody = z.strictObject({
      placement: z
         .strictObject({
            berry_max: tierModelList,
            berry_mid: tierModelList,
            berry_low: tierModelList,
         })
         .nullable(),
   });

   route.get('/tier-models', async (context) => {
      const user = context.get('user');
      const workspaceId = await scope(user.id, user.currentWorkspaceId, false);
      const tiers = await aiRuntimes.tierModels(workspaceId);
      return json({ source: tiers ? 'workspace' : 'unset', tiers: tiers ?? emptyAgentTiers() });
   });

   route.put('/tier-models', async (context) => {
      const user = context.get('user');
      const workspaceId = await scope(user.id, user.currentWorkspaceId, true);
      const body = await parse(context.req.raw, tierModelBody);
      if (body.placement !== null) {
         const allowed = await modelsConnected(options.sql, workspaceId);
         for (const tier of RUNTIME_AGENT_TIERS) {
            const seen = new Set<string>();
            for (const id of body.placement[tier]) {
               if (!allowed.has(id)) {
                  throw new ApiError(422, 'AI_RUNTIME_MODEL_INVALID', `${id} is not a model a connected runtime offers.`);
               }
               if (seen.has(id)) {
                  throw new ApiError(422, 'AI_RUNTIME_MODEL_INVALID', `${id} is already in this tier.`);
               }
               seen.add(id);
            }
         }
      }
      const tiers = await aiRuntimes.saveTierModels(workspaceId, user.id, body.placement);
      return json({ source: tiers ? 'workspace' : 'unset', tiers: tiers ?? emptyAgentTiers() });
   });

   route.get('/preference', async (context) => {
      const user = context.get('user');
      const workspaceId = await scope(user.id, user.currentWorkspaceId, false);
      return json(await aiRuntimes.preference(workspaceId, user.id));
   });

   route.put('/preference', async (context) => {
      const user = context.get('user');
      const workspaceId = await scope(user.id, user.currentWorkspaceId, false);
      const body = await parse(context.req.raw, preferenceBody);
      const runtimeId = body.runtimeId === null ? null : aiRuntimeId(body.runtimeId);
      return json(
         await aiRuntimes
            .savePreference(workspaceId, user.id, { runtimeId, modelId: body.modelId })
            .catch(aiError)
      );
   });

   route.get('/connections/:runtimeId/models', async (context) => {
      const user = context.get('user');
      const workspaceId = await scope(user.id, user.currentWorkspaceId, false);
      const runtimeId = aiRuntimeId(context.req.param('runtimeId'));
      const connection = await aiRuntimes.connection(workspaceId, user.id, runtimeId);
      if (!connection || connection.status !== 'connected') {
         throw new ApiError(409, 'AI_RUNTIME_NOT_CONNECTED', `Connect ${runtimeId} before listing models.`);
      }
      if (options.runtimeControl && (runtimeId === 'kiro' || runtimeId === 'claude' || runtimeId === 'codex')) {
         const credential =
            runtimeId === 'claude' || runtimeId === 'codex'
               ? {
                    type: 'oauth' as const,
                    token: runtimeId === 'codex' ? CODEX_CLI_LOGIN : CLAUDE_CLI_LOGIN,
                    accountId: connection.accountId,
                    accountName: connection.accountName,
                 }
               : await kiroCredential(workspaceId, user.id, connection.id);
         const result = await options.runtimeControl({
            runtimeSessionId: runtimeSessionIdFor(`ai-runtime-control:${connection.id}`),
            operation: 'models',
            runtimeId,
            credential,
         });
         if ('error' in result) controlError(result.error);
         const models = 'models' in result ? (result.models ?? []) : [];
         await aiRuntimes.recordModels(connection.id, models).catch(aiError);
         return json({ nodes: models, complete: true, detail: null });
      }
      const models = Array.isArray(connection.metadata.models) ? connection.metadata.models : [];
      return json({
         nodes: models,
         complete: false,
         detail: 'Model discovery needs a reachable Berry runtime host.',
      });
   });

   route.get('/', async (context) => {
      const user = context.get('user');
      const workspaceId = await scope(user.id, user.currentWorkspaceId, false);
      return json({ nodes: await repository.list(workspaceId, user.id) });
   });

   route.post('/', async (context) => {
      const user = context.get('user');
      const workspaceId = await scope(user.id, user.currentWorkspaceId, true);
      const body = await parse(context.req.raw, runtimeBody);
      if ((body.driver ?? 'agentcore') === 'agentcore' ? !body.arn : !body.endpointUrl) {
         throw ApiError.badRequest('an agentcore runtime needs an ARN; an http runtime needs an endpoint URL');
      }
      return json(await repository.create(workspaceId, user.id, body), 201);
   });

   /**
    * Which agents have somewhere to run. Registered before `/:id` so the word
    * is read as this route rather than as a runtime id (which it is not).
    */
   route.get('/agent-coverage', async (context) => {
      const user = context.get('user');
      const workspaceId = await scope(user.id, user.currentWorkspaceId, false);
      return json(await repository.agentCoverage(workspaceId));
   });

   route.get('/:id', async (context) => {
      const user = context.get('user');
      const workspaceId = await scope(user.id, user.currentWorkspaceId, false);
      const id = pathId(context.req.param('id'), 'Runtime');
      const view = await guard(repository.get(workspaceId, id));
      const [activity, servingAgents] = await Promise.all([
         repository.activity(workspaceId, id),
         repository.servingAgents(workspaceId, id),
      ]);
      return json({ ...view, activity, servingAgents });
   });

   route.patch('/:id', async (context) => {
      const user = context.get('user');
      const id = pathId(context.req.param('id'), 'Runtime');
      const workspaceId = await scopeFor(user, 'settings.write', runtimeRow(id));
      const body = await parse(context.req.raw, runtimeBody);
      return json(await guard(repository.update(workspaceId, id, body)));
   });

   route.delete('/:id', async (context) => {
      const user = context.get('user');
      const id = pathId(context.req.param('id'), 'Runtime');
      const workspaceId = await scopeFor(user, 'settings.write', runtimeRow(id));
      await guard(repository.remove(workspaceId, id));
      return new Response(null, { status: 204 });
   });

   route.post('/:id/health', async (context) => {
      const user = context.get('user');
      const workspaceId = await scope(user.id, user.currentWorkspaceId, false);
      const view = await guard(repository.get(workspaceId, pathId(context.req.param('id'), 'Runtime')));
      const target = repository.target(view, options.defaultTarget ?? null);
      let error: string | null = target ? null : 'no runtime is configured behind this entry';
      if (target) {
         await options.health(target).catch((cause: unknown) => {
            error = cause instanceof Error ? cause.message : String(cause);
         });
      }
      await repository.recordHealth(workspaceId, view.id, error);
      return json(await repository.get(workspaceId, view.id));
   });

   route.get('/:id/profiles', async (context) => {
      const user = context.get('user');
      const workspaceId = await scope(user.id, user.currentWorkspaceId, false);
      const id = pathId(context.req.param('id'), 'Runtime');
      await guard(repository.get(workspaceId, id));
      return json({ nodes: await repository.profiles(workspaceId, id) });
   });

   route.post('/:id/profiles', async (context) => {
      const user = context.get('user');
      const id = pathId(context.req.param('id'), 'Runtime');
      const workspaceId = await scopeFor(user, 'settings.write', runtimeRow(id));
      const body = await parse(context.req.raw, profileBody);
      const profile = await guard(repository.saveProfile(workspaceId, id, null, body));
      return json(await withLifecycle(await repository.get(workspaceId, id), profile), 201);
   });

   route.patch('/:id/profiles/:profileId', async (context) => {
      const user = context.get('user');
      const id = pathId(context.req.param('id'), 'Runtime');
      const profileId = pathId(context.req.param('profileId'), 'Profile');
      const workspaceId = await scopeFor(user, 'settings.write', runtimeRow(id), profileRow(profileId));
      const body = await parse(context.req.raw, profileBody);
      const profile = await guard(repository.saveProfile(workspaceId, id, profileId, body));
      return json(await withLifecycle(await repository.get(workspaceId, id), profile));
   });

   route.delete('/:id/profiles/:profileId', async (context) => {
      const user = context.get('user');
      const id = pathId(context.req.param('id'), 'Runtime');
      const profileId = pathId(context.req.param('profileId'), 'Profile');
      const workspaceId = await scopeFor(user, 'settings.write', runtimeRow(id), profileRow(profileId));
      await guard(repository.removeProfile(workspaceId, id, profileId));
      return new Response(null, { status: 204 });
   });

   route.put('/:id/agents/:agentId', async (context) => {
      const user = context.get('user');
      const id = pathId(context.req.param('id'), 'Runtime');
      const agentId = pathId(context.req.param('agentId'), 'Agent');
      const workspaceId = await scopeFor(user, 'settings.write', runtimeRow(id), agentRow(agentId));
      const body = await parse(context.req.raw, z.object({ profileId: z.uuid().nullable().optional() }));
      await guard(repository.bind(workspaceId, id, agentId, body.profileId ?? null));
      return new Response(null, { status: 204 });
   });

   route.delete('/:id/agents/:agentId', async (context) => {
      const user = context.get('user');
      const id = pathId(context.req.param('id'), 'Runtime');
      const agentId = pathId(context.req.param('agentId'), 'Agent');
      // The runtime in the path must still be this workspace's, and so must the agent.
      const workspaceId = await scopeFor(user, 'settings.write', runtimeRow(id), agentRow(agentId));
      await guard(repository.bind(workspaceId, null, agentId, null));
      return new Response(null, { status: 204 });
   });

   return [{ prefix: '/api/v1/runtimes', handler: route }];
}
