import { z } from 'zod';
import { apiFetch } from './api';

/**
 * Where a workspace's agents run: `/api/v1/runtimes`. Profile env values are
 * sealed on the server and never come back; only their names do.
 */

const runtimeSchema = z.object({
   id: z.string(),
   name: z.string(),
   kind: z.enum(['platform', 'custom']),
   driver: z.enum(['agentcore', 'http']),
   arn: z.string().nullable(),
   endpointUrl: z.string().nullable(),
   qualifier: z.string(),
   region: z.string().nullable(),
   status: z.enum(['active', 'unreachable', 'disabled']),
   lastHealthAt: z.string().nullable(),
   lastHealthError: z.string().nullable(),
   concurrencyLimit: z.number().nullable(),
   visibility: z.enum(['private', 'workspace']),
   /** Who registered it; only they may change its visibility. */
   ownerId: z.string().nullable().default(null),
   idleTimeoutS: z.number(),
   maxLifetimeS: z.number(),
   isDefault: z.boolean(),
   activeRuns: z.number(),
});

const runtimeDetailSchema = runtimeSchema.extend({
   activity: z.array(z.object({ day: z.string(), runs: z.number(), failed: z.number() })),
   /** The agents bound to this runtime — what a delete is really about. */
   servingAgents: z
      .array(
         z.object({
            id: z.string(),
            name: z.string(),
            status: z.string(),
            profileName: z.string().nullable(),
         })
      )
      .default([]),
});

const coverageSchema = z.object({
   /** The workspace default, which an unbound agent falls back to. */
   defaultRuntimeId: z.string().nullable(),
   nodes: z.array(
      z.object({
         id: z.string(),
         name: z.string(),
         runtimeId: z.string().nullable(),
         runtimeName: z.string().nullable(),
      })
   ),
});

export type AgentCoverage = z.infer<typeof coverageSchema>;
export type ServingAgent = RuntimeDetail['servingAgents'][number];

const profileSchema = z.object({
   id: z.string(),
   runtimeId: z.string(),
   name: z.string(),
   envKeys: z.array(z.string()),
   modelDefault: z.string().nullable(),
   timeoutS: z.number().nullable(),
   maxConcurrency: z.number().nullable(),
   idleTimeoutS: z.number().nullable(),
   lifecycleApplied: z.boolean().optional(),
   lifecycleError: z.string().optional(),
});

export type Runtime = z.infer<typeof runtimeSchema>;
export type RuntimeDetail = z.infer<typeof runtimeDetailSchema>;
export type RuntimeProfile = z.infer<typeof profileSchema>;

export interface RuntimeInput {
   name?: string;
   driver?: 'agentcore' | 'http';
   arn?: string | null;
   endpointUrl?: string | null;
   concurrencyLimit?: number | null;
   idleTimeoutS?: number;
   isDefault?: boolean;
   status?: 'active' | 'disabled';
   /** Private is the owner's alone; workspace is everyone's. */
   visibility?: 'private' | 'workspace';
}

export interface ProfileInput {
   name: string;
   env?: Record<string, string>;
   modelDefault?: string | null;
   idleTimeoutS?: number | null;
}

function parse<T>(schema: z.ZodType<T>, json: unknown, what: string): T {
   const parsed = schema.safeParse(json);
   if (!parsed.success) throw new Error(`${what} response was not recognized`);
   return parsed.data;
}

const send = (method: string, body: unknown): RequestInit => ({
   method,
   headers: { 'content-type': 'application/json' },
   body: JSON.stringify(body),
});

const path = (id: string) => `/api/v1/runtimes/${encodeURIComponent(id)}`;

export async function listRuntimes(): Promise<Runtime[]> {
   const json = await apiFetch<unknown>('/api/v1/runtimes');
   return parse(z.object({ nodes: z.array(runtimeSchema) }), json, 'Runtime list').nodes;
}

export async function getRuntime(id: string): Promise<RuntimeDetail> {
   return parse(runtimeDetailSchema, await apiFetch<unknown>(path(id)), 'Runtime');
}

export async function createRuntime(input: RuntimeInput): Promise<Runtime> {
   return parse(
      runtimeSchema,
      await apiFetch<unknown>('/api/v1/runtimes', send('POST', input)),
      'Runtime'
   );
}

export async function updateRuntime(id: string, input: RuntimeInput): Promise<Runtime> {
   return parse(runtimeSchema, await apiFetch<unknown>(path(id), send('PATCH', input)), 'Runtime');
}

export async function checkRuntimeHealth(id: string): Promise<Runtime> {
   return parse(
      runtimeSchema,
      await apiFetch<unknown>(`${path(id)}/health`, send('POST', {})),
      'Runtime'
   );
}

export async function listProfiles(runtimeId: string): Promise<RuntimeProfile[]> {
   const json = await apiFetch<unknown>(`${path(runtimeId)}/profiles`);
   return parse(z.object({ nodes: z.array(profileSchema) }), json, 'Profile list').nodes;
}

export async function createProfile(
   runtimeId: string,
   input: ProfileInput
): Promise<RuntimeProfile> {
   const json = await apiFetch<unknown>(`${path(runtimeId)}/profiles`, send('POST', input));
   return parse(profileSchema, json, 'Profile');
}

/**
 * Puts an agent on a runtime, or takes it off one.
 *
 * The binding lives on the runtime rather than on the agent, so changing it
 * from the agent's own settings page is still a write to this route. Passing
 * no runtime clears the binding, which is what "no runtime" means: the agent
 * keeps existing and its work cannot run.
 */
export async function bindAgentRuntime(
   runtimeId: string,
   agentId: string,
   profileId: string | null = null
): Promise<void> {
   await apiFetch(
      `${path(runtimeId)}/agents/${encodeURIComponent(agentId)}`,
      send('PUT', { profileId })
   );
}

export async function unbindAgentRuntime(runtimeId: string, agentId: string): Promise<void> {
   await apiFetch(`${path(runtimeId)}/agents/${encodeURIComponent(agentId)}`, { method: 'DELETE' });
}

export async function deleteRuntime(id: string): Promise<void> {
   await apiFetch(path(id), { method: 'DELETE' });
}

/**
 * Which agents have somewhere to run. Read by any screen that must not offer an
 * agent that cannot actually be dispatched to — an autopilot's assignee, above all.
 */
export async function getAgentCoverage(): Promise<AgentCoverage> {
   const json = await apiFetch<unknown>('/api/v1/runtimes/agent-coverage');
   return parse(coverageSchema, json, 'Agent coverage');
}

/** True when this agent would have a runtime to run on. */
export function agentHasRuntime(coverage: AgentCoverage | null, agentId: string): boolean {
   if (!coverage) return true; // Not known yet: never hide an agent on a guess.
   const found = coverage.nodes.find((node) => node.id === agentId);
   if (!found) return coverage.defaultRuntimeId !== null;
   return found.runtimeId !== null || coverage.defaultRuntimeId !== null;
}

/**
 * How alive a runtime looks, from its status and when it was last reached.
 *
 * `disabled` is a decision someone made, so it is its own level; `unchecked`
 * is a runtime nobody has probed yet, which is not evidence it is online; the
 * rest is silence, and how long the silence has lasted is the whole story.
 */
export type RuntimeHealth =
   'online' | 'unchecked' | 'recentlyLost' | 'offline' | 'longOffline' | 'disabled';

const MINUTE = 60 * 1000;

export function runtimeHealth(runtime: Runtime, now: number = Date.now()): RuntimeHealth {
   if (runtime.status === 'disabled') return 'disabled';
   const seen = runtime.lastHealthAt ? new Date(runtime.lastHealthAt).getTime() : null;
   if (seen === null) return runtime.status === 'active' ? 'unchecked' : 'offline';
   if (runtime.status === 'active' && now - seen < 15 * MINUTE) return 'online';
   const silent = now - seen;
   if (silent < 60 * MINUTE) return 'recentlyLost';
   if (silent < 24 * 60 * MINUTE) return 'offline';
   return 'longOffline';
}

/** "1 h", "8 h", "45 min": how a lifecycle reads to a person. */
export function formatSeconds(seconds: number): string {
   if (seconds % 3600 === 0) return `${seconds / 3600} h`;
   return `${Math.round(seconds / 60)} min`;
}

// ---------------------------------------------------------------- AI runtimes

const aiRuntimeCapabilitySchema = z.enum(['supported', 'unsupported', 'unknown']);
const aiRuntimeConnectionSchema = z.object({
   id: z.string(),
   runtimeId: z.string(),
   status: z.enum(['connected', 'expired', 'error', 'disconnected']),
   authMethod: z.string(),
   accountId: z.string().nullable(),
   accountName: z.string().nullable(),
   metadata: z.record(z.string(), z.unknown()),
   connectedAt: z.string(),
   disconnectedAt: z.string().nullable(),
   lastCheckedAt: z.string().nullable(),
   lastError: z.string().nullable(),
});
const aiRuntimeDefinitionSchema = z.object({
   id: z.string(),
   name: z.string(),
   publisher: z.string(),
   product: z.string(),
   description: z.string(),
   executionMode: z.enum(['direct_inference', 'agent_process']),
   provider: z.string(),
   billing: z.enum(['subscription', 'api_billing', 'provider_dependent', 'unknown']),
   billingDetail: z.string(),
   subscriptionAccess: aiRuntimeCapabilitySchema,
   connectionMethods: z.array(z.string()),
   platforms: z.array(z.string()),
   localProcess: z.boolean(),
   installation: z.string(),
   defaultModel: z.string().nullable(),
   capabilities: z.object({
      modelDiscovery: aiRuntimeCapabilitySchema,
      streaming: aiRuntimeCapabilitySchema,
      tools: aiRuntimeCapabilitySchema,
      sessions: aiRuntimeCapabilitySchema,
      cancellation: aiRuntimeCapabilitySchema,
      usage: aiRuntimeCapabilitySchema,
   }),
   availability: z.enum(['available', 'blocked']),
   unavailableReason: z.string().nullable(),
   officialSources: z.array(z.string()),
   connection: aiRuntimeConnectionSchema.nullable(),
});
const aiRuntimePreferenceSchema = z.object({
   runtimeId: z.string().nullable(),
   modelId: z.string().nullable(),
});
const aiRuntimeCatalogSchema = z.object({
   nodes: z.array(aiRuntimeDefinitionSchema),
   preference: aiRuntimePreferenceSchema,
   native: z.object({
      id: z.literal('berry-native'),
      name: z.string(),
      billing: z.literal('api_billing'),
      description: z.string(),
   }),
});
const aiRuntimeSelectionSchema = z.object({
   runtimeId: z.string().nullable(),
   modelId: z.string().nullable(),
   agentId: z.string().nullable().optional(),
});
const aiRuntimeModelSchema = z.object({ id: z.string(), name: z.string() });
const aiRuntimeAgentSchema = z.object({ id: z.string(), name: z.string() });

export type AiRuntimeConnection = z.infer<typeof aiRuntimeConnectionSchema>;
export type AiRuntimeDefinition = z.infer<typeof aiRuntimeDefinitionSchema>;
export type AiRuntimePreference = z.infer<typeof aiRuntimePreferenceSchema>;
export type AiRuntimeCatalog = z.infer<typeof aiRuntimeCatalogSchema>;
export type AiRuntimeSelection = z.infer<typeof aiRuntimeSelectionSchema>;
export type AiRuntimeModel = z.infer<typeof aiRuntimeModelSchema>;
export type AiRuntimeAgentProfile = z.infer<typeof aiRuntimeAgentSchema>;

/** Provider agent profiles cached on the connection, such as Kiro's built-in agents. */
export function aiRuntimeAgentsFrom(
   runtime: AiRuntimeDefinition | undefined
): AiRuntimeAgentProfile[] {
   const agents = z.array(aiRuntimeAgentSchema).safeParse(runtime?.connection?.metadata.agents);
   return agents.success ? agents.data : [];
}

/** Reads only the model catalogue cached on this immutable connection generation. */
export function aiRuntimeModelsFrom(runtime: AiRuntimeDefinition | undefined): AiRuntimeModel[] {
   const fallback = [{ id: runtime?.defaultModel ?? 'default', name: 'Automatic' }];
   const models = z.array(aiRuntimeModelSchema).safeParse(runtime?.connection?.metadata.models);
   return models.success && models.data.length > 0 ? models.data : fallback;
}

/** Subscription runtimes this person has connected. Empty when none, or when the catalog cannot be read. */
export async function connectedAiRuntimes(): Promise<AiRuntimeDefinition[]> {
   try {
      const catalog = await loadAiRuntimeCatalog();
      return catalog.nodes.filter(
         (runtime) =>
            runtime.availability === 'available' && runtime.connection?.status === 'connected'
      );
   } catch {
      return [];
   }
}

const runtimeAgentTierPlacementSchema = z.object({
   berry_max: z.array(z.string()),
   berry_mid: z.array(z.string()),
   berry_low: z.array(z.string()),
});
const runtimeAgentTiersSchema = z.object({
   source: z.enum(['workspace', 'unset']),
   tiers: runtimeAgentTierPlacementSchema,
});

export type RuntimeAgentTierPlacement = z.infer<typeof runtimeAgentTierPlacementSchema>;
export type RuntimeAgentTiers = z.infer<typeof runtimeAgentTiersSchema>;

export const EMPTY_AGENT_TIERS: RuntimeAgentTierPlacement = {
   berry_max: [],
   berry_mid: [],
   berry_low: [],
};

/** Which tier each agent is on. The three tiers belong to the workspace. */
export async function getRuntimeAgentTiers(): Promise<RuntimeAgentTiers> {
   return parse(
      runtimeAgentTiersSchema,
      await apiFetch<unknown>('/api/v1/runtimes/agent-tiers'),
      'Agent tiers'
   );
}

export async function saveRuntimeAgentTiers(
   placement: RuntimeAgentTierPlacement | null
): Promise<RuntimeAgentTiers> {
   return parse(
      runtimeAgentTiersSchema,
      await apiFetch<unknown>('/api/v1/runtimes/agent-tiers', send('PUT', { placement })),
      'Agent tiers'
   );
}

/** Models placed in the workspace's three tiers. Each id is `runtime/model`. */
export async function getTierModels(): Promise<RuntimeAgentTiers> {
   return parse(
      runtimeAgentTiersSchema,
      await apiFetch<unknown>('/api/v1/runtimes/tier-models'),
      'Tier models'
   );
}

export async function saveTierModels(
   placement: RuntimeAgentTierPlacement | null
): Promise<RuntimeAgentTiers> {
   return parse(
      runtimeAgentTiersSchema,
      await apiFetch<unknown>('/api/v1/runtimes/tier-models', send('PUT', { placement })),
      'Tier models'
   );
}

/** Names of subscription runtimes this person has connected. Empty when none, or when the catalog cannot be read. */
export async function connectedSubscriptionNames(): Promise<string[]> {
   const runtimes = await connectedAiRuntimes();
   return runtimes.map((runtime) => runtime.name);
}

export async function loadAiRuntimeCatalog(): Promise<AiRuntimeCatalog> {
   return parse(
      aiRuntimeCatalogSchema,
      await apiFetch<unknown>('/api/v1/runtimes/catalog'),
      'AI runtime catalog'
   );
}

export async function connectAiRuntime(
   runtimeId: string,
   body: { apiKey?: string } = {}
): Promise<AiRuntimeConnection> {
   return parse(
      aiRuntimeConnectionSchema,
      await apiFetch<unknown>(
         `/api/v1/runtimes/connections/${encodeURIComponent(runtimeId)}`,
         send('POST', body)
      ),
      'AI runtime connection'
   );
}

export async function disconnectAiRuntime(runtimeId: string): Promise<void> {
   await apiFetch(`/api/v1/runtimes/connections/${encodeURIComponent(runtimeId)}`, {
      method: 'DELETE',
   });
}

export async function saveAiRuntimePreference(
   preference: AiRuntimePreference
): Promise<AiRuntimePreference> {
   return parse(
      aiRuntimePreferenceSchema,
      await apiFetch<unknown>('/api/v1/runtimes/preference', send('PUT', preference)),
      'AI runtime preference'
   );
}

export async function listAiRuntimeModels(
   runtimeId: string
): Promise<{ nodes: AiRuntimeModel[]; complete: boolean; detail: string | null }> {
   const schema = z.object({
      nodes: z.array(aiRuntimeModelSchema),
      complete: z.boolean(),
      detail: z.string().nullable(),
   });
   return parse(
      schema,
      await apiFetch<unknown>(
         `/api/v1/runtimes/connections/${encodeURIComponent(runtimeId)}/models`
      ),
      'AI runtime models'
   );
}

export async function getProjectRuntimeSelection(projectId: string): Promise<AiRuntimeSelection> {
   return parse(
      aiRuntimeSelectionSchema,
      await apiFetch<unknown>(
         `/api/v1/projects/${encodeURIComponent(projectId)}/runtime-selection`
      ),
      'Project runtime selection'
   );
}

export async function saveProjectRuntimeSelection(
   projectId: string,
   selection: AiRuntimeSelection
): Promise<AiRuntimeSelection> {
   return parse(
      aiRuntimeSelectionSchema,
      await apiFetch<unknown>(
         `/api/v1/projects/${encodeURIComponent(projectId)}/runtime-selection`,
         send('PUT', selection)
      ),
      'Project runtime selection'
   );
}

export async function getIssueRuntimeSelection(issueId: string): Promise<AiRuntimeSelection> {
   return parse(
      aiRuntimeSelectionSchema,
      await apiFetch<unknown>(`/api/v1/issues/${encodeURIComponent(issueId)}/runtime-selection`),
      'Task runtime selection'
   );
}

export async function saveIssueRuntimeSelection(
   issueId: string,
   selection: AiRuntimeSelection
): Promise<AiRuntimeSelection> {
   return parse(
      aiRuntimeSelectionSchema,
      await apiFetch<unknown>(
         `/api/v1/issues/${encodeURIComponent(issueId)}/runtime-selection`,
         send('PUT', selection)
      ),
      'Task runtime selection'
   );
}

export async function getConversationRuntimeSelection(
   conversationId: string
): Promise<AiRuntimeSelection> {
   return parse(
      aiRuntimeSelectionSchema,
      await apiFetch<unknown>(
         `/api/v1/conversations/${encodeURIComponent(conversationId)}/runtime-selection`
      ),
      'Conversation runtime selection'
   );
}

export async function saveConversationRuntimeSelection(
   conversationId: string,
   selection: AiRuntimeSelection
): Promise<AiRuntimeSelection> {
   return parse(
      aiRuntimeSelectionSchema,
      await apiFetch<unknown>(
         `/api/v1/conversations/${encodeURIComponent(conversationId)}/runtime-selection`,
         send('PUT', selection)
      ),
      'Conversation runtime selection'
   );
}
