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

export type ApiUserSettings = {
  theme: string;
  timezone: string;
  reducedMotion: boolean;
  locale: string;
};

export const NOTIFICATION_KEYS = [
  'assignments',
  'mentions',
  'comments',
  'statusChanges',
  'approvals',
  'agentActivity',
  'milestones',
  'updates',
] as const;

export type NotificationKey = (typeof NOTIFICATION_KEYS)[number];
export type NotificationSwitches = Record<NotificationKey, boolean>;

export type ApiAccountSession = {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
};

export const CHANNEL_TYPES = [
  'EMAIL',
  'SMS',
  'WHATSAPP',
  'TELEGRAM',
  'VIBER',
  'LIVE_CHAT',
] as const;

export type ChannelType = (typeof CHANNEL_TYPES)[number];

export type ApiChannelIdentity = {
  id: string;
  channel: string;
  address: string;
  displayName: string | null;
  verified: boolean;
  preferred: boolean;
  createdAt: string;
};

export const TIER_KEYS = [
  'berry_max',
  'berry_xhigh',
  'berry_high',
  'berry_mid',
  'berry_low',
] as const;

export type TierKey = (typeof TIER_KEYS)[number];

export type ApiTierModels = {
  source: 'workspace' | 'unset';
  tiers: Record<TierKey, string[]>;
  names: Record<TierKey, string>;
};

export type ApiSkillLabel = {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  color: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  usageCount?: number;
};

export const PROPERTY_KINDS = [
  'text',
  'number',
  'boolean',
  'date',
  'url',
  'select',
  'multi_select',
  'person',
  'multi_person',
] as const;

export type PropertyKind = (typeof PROPERTY_KINDS)[number];

export type ApiPropertyOption = {
  id: string;
  name: string;
  color: string;
};

export type ApiPropertyDefinition = {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  kind: PropertyKind;
  options: ApiPropertyOption[];
  icon: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export const MAX_ACTIVE_PROPERTIES = 20;

export type ApiQuickAction = {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  targetAgentId: string;
  prompt: string;
  visibility: 'private' | 'workspace';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  useCount?: number;
  lastUsedAt?: string | null;
  archivedAt?: string | null;
};

const DEFAULT_TIER_NAMES: Record<TierKey, string> = {
  berry_max: 'BerryMax',
  berry_xhigh: 'BerryXHigh',
  berry_high: 'BerryHigh',
  berry_mid: 'BerryMid',
  berry_low: 'BerryLow',
};

function normalizeUserSettings(res: Partial<ApiUserSettings> | null | undefined): ApiUserSettings {
  return {
    theme: typeof res?.theme === 'string' ? res.theme : 'system',
    timezone: typeof res?.timezone === 'string' ? res.timezone : 'UTC',
    reducedMotion: Boolean(res?.reducedMotion),
    locale: typeof res?.locale === 'string' && res.locale.length > 0 ? res.locale : 'en',
  };
}

function normalizeNotificationSwitches(
  inApp: Record<string, boolean> | null | undefined,
): NotificationSwitches {
  const result = {} as NotificationSwitches;
  for (const key of NOTIFICATION_KEYS) {
    result[key] = typeof inApp?.[key] === 'boolean' ? inApp[key] : true;
  }
  return result;
}

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

export async function getUserSettings(client: BerryClient): Promise<ApiUserSettings> {
  const res = await client.get<Partial<ApiUserSettings>>('/api/v1/me/settings');
  return normalizeUserSettings(res);
}

export async function updateUserSettings(
  client: BerryClient,
  patch: Partial<ApiUserSettings>,
): Promise<ApiUserSettings> {
  const res = await client.patch<Partial<ApiUserSettings>>('/api/v1/me/settings', patch);
  return normalizeUserSettings(res);
}

export async function getPlatformNotifications(
  client: BerryClient,
  workspaceId: string,
): Promise<NotificationSwitches> {
  const res = await client.get<{ workspaceId?: string; inApp?: Record<string, boolean> }>(
    `/api/v1/me/notifications?workspaceId=${encodeURIComponent(workspaceId)}`,
  );
  return normalizeNotificationSwitches(res?.inApp);
}

export async function updatePlatformNotification(
  client: BerryClient,
  workspaceId: string,
  key: NotificationKey,
  enabled: boolean,
): Promise<NotificationSwitches> {
  const res = await client.patch<{ workspaceId?: string; inApp?: Record<string, boolean> }>(
    '/api/v1/me/notifications',
    { workspaceId, inApp: { [key]: enabled } },
  );
  return normalizeNotificationSwitches(res?.inApp);
}

export async function listSessions(client: BerryClient): Promise<ApiAccountSession[]> {
  const res = await client.get<{ nodes?: ApiAccountSession[] }>('/api/v1/me/sessions');
  return safeNodes(res);
}

export async function revokeSession(client: BerryClient, sessionId: string): Promise<void> {
  await client.del(`/api/v1/me/sessions/${encodeURIComponent(sessionId)}`);
}

export function describeDevice(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /OPR\//.test(userAgent)
      ? 'Opera'
      : /Chrome\//.test(userAgent)
        ? 'Chrome'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : /Firefox\//.test(userAgent)
            ? 'Firefox'
            : 'A browser';
  const platform = /iPhone|iPad/.test(userAgent)
    ? 'iOS'
    : /Mac OS X|Macintosh/.test(userAgent)
      ? 'macOS'
      : /Windows/.test(userAgent)
        ? 'Windows'
        : /Android/.test(userAgent)
          ? 'Android'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : null;
  return platform ? `${browser} on ${platform}` : browser;
}

export async function listChannels(client: BerryClient): Promise<ApiChannelIdentity[]> {
  const res = await client.get<{ nodes?: ApiChannelIdentity[] }>('/api/v1/me/channels');
  return safeNodes(res);
}

export async function addChannel(
  client: BerryClient,
  input: { channel: string; address: string; preferred?: boolean },
): Promise<ApiChannelIdentity> {
  return client.post<ApiChannelIdentity>('/api/v1/me/channels', {
    ...input,
    address: input.address.trim(),
  });
}

export async function removeChannel(client: BerryClient, channelId: string): Promise<void> {
  await client.del(`/api/v1/me/channels/${encodeURIComponent(channelId)}`);
}

export async function getTierModels(client: BerryClient): Promise<ApiTierModels> {
  const res = await client.get<{
    source?: 'workspace' | 'unset';
    tiers?: Partial<Record<TierKey, string[]>>;
    names?: Partial<Record<TierKey, string>>;
  }>('/api/v1/runtimes/tier-models');

  const tiers = {} as Record<TierKey, string[]>;
  const names = {} as Record<TierKey, string>;
  for (const key of TIER_KEYS) {
    const models = res?.tiers?.[key];
    tiers[key] = Array.isArray(models) ? models : [];
    const name = res?.names?.[key];
    names[key] = typeof name === 'string' && name.length > 0 ? name : DEFAULT_TIER_NAMES[key];
  }

  return {
    source: res?.source === 'workspace' ? 'workspace' : 'unset',
    tiers,
    names,
  };
}

export async function listSkillLabels(
  client: BerryClient,
  workspaceId: string,
): Promise<ApiSkillLabel[]> {
  const res = await client.get<Connection<ApiSkillLabel>>(
    `/api/v1/catalogs/${encodeURIComponent(workspaceId)}/skill-labels?first=100`,
  );
  return safeNodes(res).filter((label) => !label.archivedAt);
}

export async function createSkillLabel(
  client: BerryClient,
  workspaceId: string,
  input: { name: string; color: string },
): Promise<ApiSkillLabel> {
  return client.post<ApiSkillLabel>(
    `/api/v1/catalogs/${encodeURIComponent(workspaceId)}/skill-labels`,
    { name: input.name.trim(), color: input.color },
  );
}

export async function archiveSkillLabel(
  client: BerryClient,
  workspaceId: string,
  labelId: string,
): Promise<void> {
  await client.del(
    `/api/v1/catalogs/${encodeURIComponent(workspaceId)}/skill-labels/${encodeURIComponent(labelId)}`,
  );
}

export async function listIssueProperties(
  client: BerryClient,
  workspaceId: string,
  includeArchived = true,
): Promise<ApiPropertyDefinition[]> {
  const query = includeArchived ? '?includeArchived=true' : '';
  const res = await client.get<{ nodes?: ApiPropertyDefinition[] }>(
    `/api/v1/catalogs/${encodeURIComponent(workspaceId)}/issue-properties${query}`,
  );
  return safeNodes(res);
}

export async function createIssueProperty(
  client: BerryClient,
  workspaceId: string,
  input: {
    name: string;
    kind: PropertyKind;
    options?: ApiPropertyOption[];
    description?: string | null;
  },
): Promise<ApiPropertyDefinition> {
  return client.post<ApiPropertyDefinition>(
    `/api/v1/catalogs/${encodeURIComponent(workspaceId)}/issue-properties`,
    { ...input, name: input.name.trim() },
  );
}

export async function restoreIssueProperty(
  client: BerryClient,
  workspaceId: string,
  propertyId: string,
): Promise<ApiPropertyDefinition> {
  return client.patch<ApiPropertyDefinition>(
    `/api/v1/catalogs/${encodeURIComponent(workspaceId)}/issue-properties/${encodeURIComponent(propertyId)}`,
    { archived: false },
  );
}

export async function archiveIssueProperty(
  client: BerryClient,
  workspaceId: string,
  propertyId: string,
): Promise<void> {
  await client.del(
    `/api/v1/catalogs/${encodeURIComponent(workspaceId)}/issue-properties/${encodeURIComponent(propertyId)}`,
  );
}

export async function listQuickActions(
  client: BerryClient,
  workspaceId: string,
  includeArchived = true,
): Promise<ApiQuickAction[]> {
  const query = includeArchived ? '?includeArchived=true' : '';
  const res = await client.get<{ nodes?: ApiQuickAction[] }>(
    `/api/v1/catalogs/${encodeURIComponent(workspaceId)}/quick-actions${query}`,
  );
  return safeNodes(res);
}

export async function restoreQuickAction(
  client: BerryClient,
  workspaceId: string,
  actionId: string,
): Promise<ApiQuickAction> {
  return client.patch<ApiQuickAction>(
    `/api/v1/catalogs/${encodeURIComponent(workspaceId)}/quick-actions/${encodeURIComponent(actionId)}`,
    { archived: false },
  );
}

export async function archiveQuickAction(
  client: BerryClient,
  workspaceId: string,
  actionId: string,
): Promise<void> {
  await client.del(
    `/api/v1/catalogs/${encodeURIComponent(workspaceId)}/quick-actions/${encodeURIComponent(actionId)}`,
  );
}
