import { ApiClientError, type BerryClient } from '@/api/client';
import type { ApiMember, ApiProfile, Connection } from '@/api/types';

export type ApiPersonalToken = {
  id: string;
  name: string;
  prefix: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  scopes: string[] | null;
};

export type CreateTokenResult = {
  personalToken: ApiPersonalToken;
  token: string | null;
};

export type ApiAiRuntimeConnection = {
  id: string;
  runtimeId: string;
  status: string;
  authMethod: string;
  accountId: string | null;
  accountName: string | null;
  connectedAt: string;
  disconnectedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
};

export type ApiComputeRuntime = {
  id: string;
  name: string;
  kind: string;
  driver: string;
  status: string;
  isDefault: boolean;
  activeRuns: number;
  region: string | null;
  endpointUrl: string | null;
  lastHealthError: string | null;
};

export type RuntimesOverview = {
  aiConnections: ApiAiRuntimeConnection[];
  computeRuntimes: ApiComputeRuntime[];
};

export type ApiIssueLabel = {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  color: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  usageCount: number;
};

export type ApiIntegrationProvider = {
  id: string;
  name: string;
  description: string;
  configured: boolean;
  connected: boolean;
  status: string | null;
  statusDetail: string | null;
  accountName: string | null;
};

export type ApiMcpServer = {
  id: string;
  agentId: string | null;
  name: string;
  url: string;
  transport: string;
  headerNames: string[];
  viaGateway: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ApiUsageBucket = {
  key: string;
  events: number;
  unpricedEvents: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costMicros: number;
};

export type ApiAgentUsageBucket = ApiUsageBucket & {
  agentName: string;
};

export type ApiRunTotals = {
  runs: number;
  failed: number;
  runSeconds: number;
};

export type ApiUsageSummary = {
  currency: string;
  days: number;
  from: string;
  to: string;
  timezone: string;
  totals: ApiUsageBucket;
  runs: ApiRunTotals;
  byModel: ApiUsageBucket[];
  byAgent: ApiAgentUsageBucket[];
};

export type ApiPromptLog = {
  id: string;
  kind: string;
  purpose: string;
  agentName: string | null;
  issueIdentifier: string | null;
  model: string | null;
  status: string;
  structured: boolean;
  promptPreview: string;
  inputTokens: number;
  outputTokens: number;
  costMicros: number | null;
  durationMs: number | null;
  failureCode: string | null;
  createdAt: string;
};

function safeNodes<T>(response: { nodes?: T[] } | null | undefined): T[] {
  return Array.isArray(response?.nodes) ? response.nodes : [];
}

export function formatApiError(error: unknown, fallback: string): string {
  if (error instanceof ApiClientError) {
    if (error.status === 403) {
      return error.message || 'You do not have permission to view this section.';
    }
    if (error.status === 404) {
      return error.message || 'This resource is not available on this server.';
    }
    return error.message || fallback;
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return fallback;
}

export async function getProfile(client: BerryClient): Promise<ApiProfile> {
  return client.get<ApiProfile>('/api/v1/me');
}

export async function updateProfile(
  client: BerryClient,
  input: { name: string },
): Promise<ApiProfile> {
  return client.patch<ApiProfile>('/api/v1/me', { name: input.name.trim() });
}

export async function listTokens(client: BerryClient): Promise<ApiPersonalToken[]> {
  const res = await client.get<Connection<ApiPersonalToken>>('/api/v1/tokens?first=100');
  return safeNodes(res);
}

export async function createToken(
  client: BerryClient,
  name: string,
): Promise<CreateTokenResult> {
  const res = await client.post<{ personalToken: ApiPersonalToken; token?: string }>(
    '/api/v1/tokens',
    { name: name.trim() },
    { idempotent: true },
  );
  return {
    personalToken: res.personalToken,
    token: typeof res.token === 'string' && res.token.length > 0 ? res.token : null,
  };
}

export async function revokeToken(client: BerryClient, id: string): Promise<void> {
  await client.del(`/api/v1/tokens/${encodeURIComponent(id)}`);
}

export async function listWorkspaceMembers(
  client: BerryClient,
  workspaceId: string,
): Promise<ApiMember[]> {
  const res = await client.get<Connection<ApiMember>>(
    `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/members?first=100`,
  );
  return safeNodes(res);
}

export async function listRuntimes(
  client: BerryClient,
  workspaceId?: string,
): Promise<RuntimesOverview> {
  void workspaceId;
  const [aiResult, computeResult] = await Promise.allSettled([
    client.get<{ nodes?: ApiAiRuntimeConnection[] }>('/api/v1/runtimes/connections'),
    client.get<{ nodes?: ApiComputeRuntime[] }>('/api/v1/runtimes'),
  ]);

  if (aiResult.status === 'rejected' && computeResult.status === 'rejected') {
    throw aiResult.reason;
  }

  return {
    aiConnections: aiResult.status === 'fulfilled' ? safeNodes(aiResult.value) : [],
    computeRuntimes: computeResult.status === 'fulfilled' ? safeNodes(computeResult.value) : [],
  };
}

export async function listWorkspaceLabels(
  client: BerryClient,
  workspaceId: string,
): Promise<ApiIssueLabel[]> {
  const res = await client.get<Connection<ApiIssueLabel>>(
    `/api/v1/catalogs/${encodeURIComponent(workspaceId)}/issue-labels?first=100`,
  );
  return safeNodes(res);
}

export async function listIntegrations(
  client: BerryClient,
  workspaceId?: string,
): Promise<ApiIntegrationProvider[]> {
  void workspaceId;
  const res = await client.get<{ providers?: ApiIntegrationProvider[] }>(
    '/api/v1/integrations/providers',
  );
  return Array.isArray(res?.providers) ? res.providers : [];
}

export async function listMcpServers(
  client: BerryClient,
  workspaceId?: string,
): Promise<ApiMcpServer[]> {
  void workspaceId;
  const res = await client.get<{ nodes?: ApiMcpServer[] }>('/api/v1/mcp-servers?agentId=all');
  return safeNodes(res);
}

export async function getWorkspaceUsage(
  client: BerryClient,
  workspaceId: string,
  days = 30,
): Promise<ApiUsageSummary> {
  const safeDays = Math.max(1, Math.min(180, Math.floor(days)));
  const res = await client.get<ApiUsageSummary>(
    `/api/v1/usage/${encodeURIComponent(workspaceId)}/summary?days=${safeDays}`,
  );
  return {
    currency: res.currency ?? 'USD',
    days: res.days ?? safeDays,
    from: res.from ?? '',
    to: res.to ?? '',
    timezone: res.timezone ?? 'UTC',
    totals: res.totals ?? {
      key: 'total',
      events: 0,
      unpricedEvents: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costMicros: 0,
    },
    runs: res.runs ?? { runs: 0, failed: 0, runSeconds: 0 },
    byModel: Array.isArray(res.byModel) ? res.byModel : [],
    byAgent: Array.isArray(res.byAgent) ? res.byAgent : [],
  };
}

export async function listCompletionLogs(
  client: BerryClient,
  workspaceId: string,
  first = 20,
): Promise<ApiPromptLog[]> {
  const safeFirst = Math.max(1, Math.min(100, Math.floor(first)));
  const res = await client.get<Connection<ApiPromptLog>>(
    `/api/v1/logs/${encodeURIComponent(workspaceId)}/prompts?first=${safeFirst}`,
  );
  return safeNodes(res);
}
