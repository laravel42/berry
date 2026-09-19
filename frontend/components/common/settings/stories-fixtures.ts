import { HttpResponse } from 'msw';
import type { User } from '@/data/users';
import { useSessionStore, type SessionWorkspace } from '@/store/session-store';

/**
 * Shared data for the settings stories: the signed-in admin, the workspace
 * they are in, and payloads shaped exactly as the `/api/v1` routes answer.
 */

export const WS_ID = 'ws-1';

export const adminWorkspace: SessionWorkspace = {
   id: WS_ID,
   name: 'Elian',
   slug: 'elian',
   role: 'admin',
};

export const memberWorkspace: SessionWorkspace = { ...adminWorkspace, role: 'member' };

export const sessionUser: User = {
   id: 'user-1',
   name: 'Andrea Lunelio',
   avatarUrl: '',
   email: 'andrea@elian.dev',
   status: 'online',
   role: 'Admin',
   joinedDate: '2025-11-02',
   teamIds: [],
   timezone: 'Europe/Rome',
};

/** Signs in as the admin of "Elian", so edit controls render. */
export function seedSession(workspace: SessionWorkspace = adminWorkspace) {
   useSessionStore.setState({
      status: 'ready',
      user: sessionUser,
      workspace,
      workspaces: [workspace],
      boardId: 'board-1',
      preferredLocale: 'en',
      error: null,
   });
}

/** The Berry error envelope, as every failing route answers. */
export function apiError(status: number, message: string, code = 'INTERNAL') {
   return HttpResponse.json({ error: { code, message, requestId: 'req-story' } }, { status });
}

/** A single-page cursor connection. */
export function page<T>(nodes: T[]) {
   return { nodes, pageInfo: { hasNextPage: false, endCursor: null } };
}

// ----------------------------------------------------------------- account

export const accountSessions = [
   {
      id: 'sess-1',
      userAgent:
         'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
      ip: '93.41.12.7',
      createdAt: '2026-09-01T08:00:00Z',
      lastUsedAt: '2026-09-18T11:52:00Z',
      expiresAt: '2026-10-01T08:00:00Z',
   },
   {
      id: 'sess-2',
      userAgent:
         'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
      ip: '151.38.4.201',
      createdAt: '2026-09-10T19:12:00Z',
      lastUsedAt: '2026-09-16T21:40:00Z',
      expiresAt: '2026-10-10T19:12:00Z',
   },
   {
      id: 'sess-3',
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0',
      ip: null,
      createdAt: '2026-07-02T10:00:00Z',
      lastUsedAt: null,
      expiresAt: '2026-10-02T10:00:00Z',
   },
];

export const channelIdentities = [
   {
      id: 'chan-1',
      channel: 'EMAIL',
      address: 'andrea@elian.dev',
      displayName: null,
      verified: false,
      preferred: true,
      createdAt: '2026-08-20T09:00:00Z',
   },
   {
      id: 'chan-2',
      channel: 'TELEGRAM',
      address: '@alunelio',
      displayName: 'Andrea',
      verified: true,
      preferred: true,
      createdAt: '2026-08-22T09:00:00Z',
   },
];

export const notificationSwitches = {
   workspaceId: WS_ID,
   inApp: {
      assignments: true,
      mentions: true,
      comments: false,
      statusChanges: true,
      approvals: true,
      goals: false,
      updates: false,
      agentActivity: true,
   },
};

export const personalTokens = [
   {
      id: 'tok-1',
      name: 'CI release bot',
      prefix: 'bry_pat_7Qk2',
      lastUsedAt: '2026-09-17T22:10:00Z',
      expiresAt: '2026-12-01T00:00:00Z',
      revokedAt: null,
      createdAt: '2026-09-02T10:00:00Z',
      scopes: ['issues:read', 'comments:read'],
   },
   {
      id: 'tok-2',
      name: 'Raycast extension',
      prefix: 'bry_pat_Lm9x',
      lastUsedAt: null,
      expiresAt: null,
      revokedAt: null,
      createdAt: '2026-03-11T10:00:00Z',
      scopes: null,
   },
   {
      id: 'tok-3',
      name: 'Old laptop script',
      prefix: 'bry_pat_c01d',
      lastUsedAt: '2026-05-01T08:00:00Z',
      expiresAt: '2026-06-01T00:00:00Z',
      revokedAt: null,
      createdAt: '2026-03-01T10:00:00Z',
      scopes: ['issues:read', 'issues:write'],
   },
];

// ------------------------------------------------------------------ agents

function agent(
   overrides: { id: string; name: string } & Record<string, unknown>
): { id: string; name: string } & Record<string, unknown> {
   return {
      description: null,
      avatarUrl: null,
      status: 'available',
      capabilities: [],
      instructions: null,
      modelProvider: 'bedrock',
      modelName: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
      permissions: [],
      labels: [],
      envNames: [],
      systemRole: null,
      ownerId: null,
      conversationStarters: [],
      maxConcurrency: null,
      archivedAt: null,
      createdAt: '2026-06-01T10:00:00Z',
      updatedAt: '2026-09-10T10:00:00Z',
      roleKey: null,
      department: null,
      autonomyLevel: null,
      customized: false,
      ...overrides,
   };
}

export const workspaceAgents = [
   agent({
      id: 'agent-orch',
      name: 'Orchestrator',
      modelName: null,
      modelProvider: null,
      systemRole: 'orchestrator',
      permissions: ['read_repository'],
   }),
   agent({
      id: 'agent-eng',
      name: 'Backend Engineer',
      roleKey: 'backend_engineer',
      department: 'engineering',
      autonomyLevel: 3,
      modelName: 'us.anthropic.claude-opus-5',
      permissions: ['read_repository', 'create_branches', 'run_commands', 'open_pull_requests'],
   }),
   agent({
      id: 'agent-qa',
      name: 'QA Reviewer',
      roleKey: 'qa_engineer',
      permissions: ['read_repository', 'run_commands', 'merge_without_approval'],
   }),
];

// ------------------------------------------------------------------ github

export const githubAccounts = [
   {
      installationId: 51234001,
      accountLogin: 'elian-labs',
      accountType: 'Organization',
      installedAt: '2026-06-03T09:00:00Z',
      installedBy: { id: 'user-1', name: 'Andrea Lunelio' },
      repositoryCount: 14,
      listedHere: 3,
   },
   {
      installationId: 51234002,
      accountLogin: 'alunelio',
      accountType: 'User',
      installedAt: '2026-08-11T09:00:00Z',
      installedBy: { id: 'user-1', name: 'Andrea Lunelio' },
      repositoryCount: 1,
      listedHere: 0,
   },
];

export const githubSettingsState = {
   settings: {
      enabled: true,
      showLinkedPullRequests: true,
      coAuthorTrailer: false,
      autoLinkPullRequests: true,
      updatedAt: '2026-09-10T10:00:00Z',
   },
   canManage: true,
   connection: {
      appConfigured: true,
      appName: 'Berry (elian)',
      appUrl: 'https://github.com/apps/berry-elian',
      installed: true,
      accounts: githubAccounts.map((account) => ({
         installationId: account.installationId,
         accountLogin: account.accountLogin,
         accountType: account.accountType,
         installedAt: account.installedAt,
         installedBy: account.installedBy,
      })),
      accountLogin: 'elian-labs',
      accountType: 'Organization',
      installedAt: '2026-06-03T09:00:00Z',
      installedBy: { id: 'user-1', name: 'Andrea Lunelio' },
   },
};

function pickerRepo(
   id: number,
   account: string,
   name: string,
   extra: Partial<{
      description: string | null;
      private: boolean;
      archived: boolean;
      alreadyAdded: boolean;
   }> = {}
) {
   return {
      id,
      fullName: `${account}/${name}`,
      owner: account,
      account,
      installationId: account === 'elian-labs' ? 51234001 : 51234002,
      name,
      description: null,
      private: false,
      archived: false,
      url: `https://github.com/${account}/${name}`,
      alreadyAdded: false,
      ...extra,
   };
}

export const pickerPage = {
   accounts: ['elian-labs', 'alunelio'],
   repositories: [
      pickerRepo(9001, 'elian-labs', 'berry', {
         description: 'Self-hosted issue tracker with agent assignees',
         alreadyAdded: true,
      }),
      pickerRepo(9002, 'elian-labs', 'berry-runtime', {
         description: 'AgentCore runtime image and Strands loop',
         private: true,
      }),
      pickerRepo(9003, 'elian-labs', 'infra', { description: 'CDK stacks', private: true }),
      pickerRepo(9004, 'elian-labs', 'legacy-web', { archived: true }),
      pickerRepo(9005, 'alunelio', 'dotfiles', { description: 'zsh, nvim, and friends' }),
   ],
   total: 42,
   nextCursor: 'cursor-2',
};

export const workspaceRepositories = [
   {
      id: 'repo-1',
      url: 'https://github.com/elian-labs/berry',
      description: 'The product: server-ts, frontend and the plugin SDK.',
      githubRepoId: 9001,
      position: 0,
      createdAt: '2026-06-03T09:10:00Z',
      updatedAt: '2026-06-03T09:10:00Z',
   },
   {
      id: 'repo-2',
      url: 'git@github.com:elian-labs/berry-runtime.git',
      description: 'Agent runtime image deployed to AgentCore.',
      githubRepoId: 9002,
      position: 1,
      createdAt: '2026-06-04T09:10:00Z',
      updatedAt: '2026-06-04T09:10:00Z',
   },
   {
      id: 'repo-3',
      url: 'https://gitlab.com/elian/marketing-site',
      description: '',
      githubRepoId: null,
      position: 2,
      createdAt: '2026-07-01T09:10:00Z',
      updatedAt: '2026-07-01T09:10:00Z',
   },
];

// ------------------------------------------------------------ integrations

export const integrationProviders = [
   {
      id: 'berry',
      name: 'Berry',
      description: 'Tasks, comments and plans in this workspace.',
      configured: true,
      connected: true,
      status: null,
      source: null,
      tools: [
         { name: 'berry.create_issue', description: 'Open a task.', effect: 'write' },
         { name: 'berry.comment', description: 'Comment on a task.', effect: 'write' },
         { name: 'berry.search', description: 'Search tasks.', effect: 'read' },
      ],
   },
   {
      id: 'github',
      name: 'GitHub',
      description: 'Repositories, branches and pull requests.',
      configured: true,
      connected: true,
      status: 'connected',
      source: 'app',
      accountName: 'elian-labs',
      tools: [
         { name: 'github.read_file', effect: 'read', allowed: true },
         { name: 'github.open_pull_request', effect: 'external_side_effect', allowed: true },
      ],
   },
   {
      id: 'slack',
      name: 'Slack',
      description: 'Post updates to channels your team reads.',
      configured: true,
      connected: true,
      status: 'connected',
      source: 'app',
      accountName: 'Elian HQ',
      scopes: ['chat:write', 'channels:read'],
      tools: [
         {
            name: 'slack.post_message',
            description: 'Post a message to a channel.',
            effect: 'external_side_effect',
            requiresApproval: true,
            allowed: true,
         },
         { name: 'slack.list_channels', effect: 'read', allowed: true },
         {
            name: 'slack.archive_channel',
            description: 'Archive a channel.',
            effect: 'destructive',
            requiresApproval: true,
            enabledByDefault: false,
            allowed: false,
         },
      ],
   },
   {
      id: 'notion',
      name: 'Notion',
      description: 'Read and write pages in a shared workspace.',
      configured: true,
      connected: false,
      status: 'expired',
      tools: [{ name: 'notion.read_page', effect: 'read' }],
   },
   {
      id: 'acme-crm',
      name: 'Acme CRM',
      description: 'Customer records.',
      configured: false,
      connected: false,
      status: null,
      tools: [{ name: 'acme-crm.lookup', effect: 'read' }],
   },
];

export const integrationConnections = [
   {
      id: 'conn-slack',
      provider: 'slack',
      status: 'connected',
      statusDetail: null,
      accountId: 'T012AB',
      accountName: 'Elian HQ',
      scopes: ['chat:write', 'channels:read'],
      expiresAt: null,
      createdAt: '2026-07-14T08:30:00Z',
      updatedAt: '2026-07-14T08:30:00Z',
   },
   {
      id: 'conn-notion',
      provider: 'notion',
      status: 'expired',
      statusDetail: 'The refresh token was revoked in Notion.',
      accountId: null,
      accountName: 'Elian',
      scopes: null,
      expiresAt: '2026-09-01T00:00:00Z',
      createdAt: '2026-05-02T08:30:00Z',
      updatedAt: '2026-09-01T00:00:00Z',
   },
];

export const integrationGrants = [
   {
      agentId: null,
      provider: 'slack',
      tool: 'slack.post_message',
      maxEffect: 'external_side_effect',
   },
   { agentId: null, provider: 'slack', tool: 'slack.list_channels', maxEffect: 'read' },
];

// ------------------------------------------------------------------ labels

function label(id: string, name: string, color: string, usageCount?: number) {
   return {
      id,
      workspaceId: WS_ID,
      name,
      description: null,
      color,
      createdAt: '2026-05-01T09:00:00Z',
      updatedAt: '2026-05-01T09:00:00Z',
      archivedAt: null,
      ...(usageCount === undefined ? {} : { usageCount }),
   };
}

export const workspaceLabels = [
   label('lbl-1', 'bug', '#eb5757', 38),
   label('lbl-2', 'frontend', '#4ea7fc', 61),
   label('lbl-3', 'agent-run', '#bb87fc', 12),
   label('lbl-4', 'needs-design', '#f2c94c', 0),
   label('lbl-5', 'infra', '#26b5ce'),
];

// -------------------------------------------------------------- properties

function property(
   id: string,
   name: string,
   kind: string,
   options: Array<{ id: string; name: string; color: string }> = [],
   archivedAt: string | null = null
) {
   return {
      id,
      workspaceId: WS_ID,
      name,
      description: null,
      kind,
      options,
      icon: null,
      sortOrder: 0,
      createdAt: '2026-05-01T09:00:00Z',
      updatedAt: '2026-05-01T09:00:00Z',
      archivedAt,
   };
}

export const workspaceProperties = [
   property('prop-1', 'Customer', 'text'),
   property('prop-2', 'Story points', 'number'),
   property('prop-3', 'Environment', 'select', [
      { id: 'staging', name: 'Staging', color: '#4ea7fc' },
      { id: 'production', name: 'Production', color: '#eb5757' },
   ]),
   property('prop-4', 'Reviewer', 'person'),
   property('prop-5', 'Design doc', 'url', [], '2026-08-01T09:00:00Z'),
];

// -------------------------------------------------------------- join links

export const joinLinks = [
   {
      id: 'jl-1',
      workspaceId: WS_ID,
      role: 'member',
      expiresAt: '2026-09-25T12:00:00Z',
      maxUses: null,
      useCount: 3,
      revokedAt: null,
      createdAt: '2026-09-18T09:00:00Z',
      createdBy: 'user-1',
   },
   {
      id: 'jl-2',
      workspaceId: WS_ID,
      role: 'viewer',
      expiresAt: '2026-08-01T12:00:00Z',
      maxUses: null,
      useCount: 0,
      revokedAt: null,
      createdAt: '2026-07-25T09:00:00Z',
      createdBy: 'user-1',
   },
   {
      id: 'jl-3',
      workspaceId: WS_ID,
      role: 'admin',
      expiresAt: null,
      maxUses: 1,
      useCount: 1,
      revokedAt: null,
      createdAt: '2026-06-01T09:00:00Z',
      createdBy: 'user-1',
   },
   {
      id: 'jl-4',
      workspaceId: WS_ID,
      role: 'member',
      expiresAt: null,
      maxUses: null,
      useCount: 7,
      revokedAt: '2026-06-10T09:00:00Z',
      createdAt: '2026-05-01T09:00:00Z',
      createdBy: 'user-1',
   },
];

// ------------------------------------------------------------- mcp servers

export const mcpServers = [
   {
      id: 'mcp-1',
      agentId: null,
      name: 'docs',
      url: 'https://docs.elian.dev/mcp',
      transport: 'streamable_http',
      headerNames: ['Authorization'],
      viaGateway: false,
      enabled: true,
      createdAt: '2026-07-01T09:00:00Z',
      updatedAt: '2026-07-01T09:00:00Z',
   },
   {
      id: 'mcp-2',
      agentId: null,
      name: 'sentry',
      url: 'https://mcp.sentry.dev/sse',
      transport: 'sse',
      headerNames: ['Authorization', 'X-Org'],
      viaGateway: true,
      enabled: false,
      createdAt: '2026-08-12T09:00:00Z',
      updatedAt: '2026-08-12T09:00:00Z',
   },
];

// ------------------------------------------------------------ organization

function role(
   roleKey: string,
   name: string,
   title: string,
   autonomyLevel: number | null,
   status: 'active' | 'paused' | null,
   contractValid = true
) {
   return {
      roleKey,
      name,
      role: title,
      autonomyLevel,
      agentId: `agent-${roleKey}`,
      customized: false,
      contractValid,
      discovery: status ? { autopilotId: `ap-${roleKey}`, status, cron: '0 9 * * 1' } : null,
   };
}

export const organization = {
   departments: [
      {
         key: 'product',
         roles: [
            role('product_manager', 'Priya', 'Product manager', 3, 'active'),
            role('designer', 'Dario', 'Product designer', 2, 'paused'),
         ],
      },
      {
         key: 'engineering',
         roles: [
            role('backend_engineer', 'Bea', 'Backend engineer', 4, 'active'),
            role('frontend_engineer', 'Fin', 'Frontend engineer', 4, 'active', false),
         ],
      },
      {
         key: 'quality-security',
         roles: [role('security_reviewer', 'Sol', 'Security reviewer', 2, null)],
      },
   ],
   delegation: [{ from: 'product_manager', to: 'backend_engineer' }],
   workflows: [
      {
         key: 'feature',
         name: 'Feature delivery',
         chain: ['Product manager', 'Backend engineer', 'Security reviewer'],
         when: 'A goal is planned',
      },
      {
         key: 'bugfix',
         name: 'Bug fix',
         chain: ['Frontend engineer', 'Security reviewer'],
         when: 'A bug is triaged',
      },
   ],
   discoveryEnabled: true,
};

// ----------------------------------------------------------------- plugins

export const pluginConfigFields = [
   { key: 'channel', label: 'Default channel', type: 'string' as const, required: true },
   { key: 'digestHour', label: 'Digest hour (UTC)', type: 'number' as const, required: false },
   {
      key: 'mentionAssignee',
      label: 'Mention the assignee',
      type: 'boolean' as const,
      required: false,
   },
];

export const installedPlugin = {
   id: 'plg-1',
   workspaceId: WS_ID,
   key: 'standup-digest',
   name: 'Standup digest',
   version: '1.4.0',
   description: 'Posts a morning summary of what changed overnight.',
   source: 'url' as const,
   sourceUrl: 'https://plugins.elian.dev/standup/berry-plugin.json',
   enabled: true,
   config: { channel: '#eng-standup', digestHour: 8, mentionAssignee: true },
   configFields: pluginConfigFields,
   secrets: [
      { name: 'SLACK_WEBHOOK', description: 'Incoming webhook for the channel', set: true },
      { name: 'OPENAI_KEY', description: 'Optional summariser key', set: false },
   ],
   scopes: ['issues:read', 'comments:read'],
   hooks: [
      { key: 'on-status', trigger: 'event' as const, events: ['issue.updated', 'run.completed'] },
      { key: 'digest', trigger: 'schedule' as const, everyMinutes: 1440 },
   ],
   surfaces: [{ key: 'board', title: 'Standup board' }],
   mcpTools: [
      { name: 'standup.post_digest', description: 'Post the digest now.', approved: true },
      { name: 'standup.snooze', description: 'Skip tomorrow’s digest.', approved: false },
   ],
   installedBy: 'user-1',
   createdAt: '2026-08-01T09:00:00Z',
   updatedAt: '2026-09-10T09:00:00Z',
};

export const pluginDetail = {
   ...installedPlugin,
   files: [
      { path: 'berry-plugin.json', size: 1824 },
      { path: 'surfaces/board.html', size: 10240 },
   ],
};

export const pluginInvocations = [
   {
      id: 'inv-1',
      kind: 'schedule',
      trigger: 'digest',
      status: 'ok',
      httpStatus: 200,
      durationMs: 412,
      error: null,
      createdAt: '2026-09-18T08:00:02Z',
   },
   {
      id: 'inv-2',
      kind: 'event',
      trigger: 'issue.updated',
      status: 'error',
      httpStatus: 502,
      durationMs: 10003,
      error: 'Upstream timed out',
      createdAt: '2026-09-17T16:22:10Z',
   },
];

export const pluginStorage = [
   { key: 'lastDigestAt', value: '2026-09-18T08:00:02Z', updatedAt: '2026-09-18T08:00:02Z' },
   { key: 'snoozed', value: { until: null, by: 'user-1' }, updatedAt: '2026-09-02T08:00:00Z' },
];

export const pluginPreview = {
   key: 'release-notes',
   name: 'Release notes',
   version: '0.3.1',
   description: 'Drafts release notes from merged tasks.',
   baseUrl: 'https://plugins.elian.dev/release-notes',
   scopes: ['issues:read'],
   config: [{ key: 'tone', label: 'Tone', type: 'string' as const, required: false }],
   secrets: [{ name: 'GITHUB_TOKEN', description: 'Read releases' }],
   events: ['issue.completed'],
   schedules: [{ key: 'weekly', everyMinutes: 10080 }],
   surfaces: [{ key: 'drafts', title: 'Drafts' }],
   mcpTools: ['release_notes.draft'],
   files: [{ path: 'berry-plugin.json', size: 902 }],
};

// ------------------------------------------------------------- preferences

export const profile = {
   id: 'user-1',
   email: 'andrea@elian.dev',
   name: 'Andrea Lunelio',
   avatarUrl: null,
   description: 'Maintains the server; prefers small PRs.',
};

export const userSettings = {
   theme: 'dark',
   timezone: 'Europe/Rome',
   reducedMotion: false,
   locale: 'en',
};

// ----------------------------------------------------------- quick actions

function quickAction<T extends { id: string; name: string }>(overrides: T) {
   return {
      workspaceId: WS_ID,
      description: null,
      visibility: 'workspace',
      createdBy: 'user-1',
      createdAt: '2026-06-01T09:00:00Z',
      updatedAt: '2026-06-01T09:00:00Z',
      lastUsedAt: '2026-09-17T09:00:00Z',
      archivedAt: null,
      ...overrides,
   };
}

export const quickActions = [
   quickAction({
      id: 'qa-1',
      name: 'Write tests',
      targetAgentId: 'agent-eng',
      prompt: 'Add missing tests for {{issue.identifier}}: {{issue.title}}.',
      useCount: 42,
   }),
   quickAction({
      id: 'qa-2',
      name: 'Security pass',
      targetAgentId: 'agent-qa',
      prompt: 'Review the change for {{issue.identifier}} for injection and auth mistakes.',
      visibility: 'private',
      useCount: 3,
      lastUsedAt: '2026-04-02T09:00:00Z',
   }),
   quickAction({
      id: 'qa-3',
      name: 'Summarise thread',
      targetAgentId: 'agent-orch',
      prompt: 'Summarise the discussion on {{issue.title}}.',
      useCount: 0,
      archivedAt: '2026-08-01T09:00:00Z',
   }),
];

export const grantedRepositories = {
   repositories: [
      {
         id: 9001,
         fullName: 'elian-labs/berry',
         owner: 'elian-labs',
         accountLogin: 'elian-labs',
         accountType: 'Organization',
         installationId: 51234001,
         private: false,
         defaultBranch: 'main',
         url: 'https://github.com/elian-labs/berry',
         refreshedAt: '2026-09-18T10:00:00Z',
      },
      {
         id: 9002,
         fullName: 'elian-labs/berry-runtime',
         owner: 'elian-labs',
         accountLogin: 'elian-labs',
         accountType: 'Organization',
         installationId: 51234001,
         private: true,
         defaultBranch: 'main',
         url: 'https://github.com/elian-labs/berry-runtime',
         refreshedAt: '2026-09-18T10:00:00Z',
      },
   ],
   accounts: [
      {
         accountLogin: 'elian-labs',
         accountType: 'Organization',
         installationId: 51234001,
         repositories: 2,
      },
   ],
   installPending: false,
   canManage: true,
   refreshedAt: '2026-09-18T10:00:00Z',
   claimedElsewhere: ['acme-corp'],
};

// ---------------------------------------------------------------- workspace

export const workspaceSummary = {
   id: WS_ID,
   name: 'Elian',
   slug: 'elian',
   description: 'Where the Berry team plans, builds and reviews Berry.',
   role: 'owner',
   createdAt: '2025-11-02T09:00:00Z',
   updatedAt: '2026-09-10T09:00:00Z',
   settings: { issuePrefix: 'BERR', defaultRole: 'member', allowMemberInvites: true },
   logoUrl: null,
   agentContext:
      'Use pnpm. Server code is strip-types TypeScript with .ts imports. Never merge; open a PR.',
};

export const workspaceMemberRoles = [
   {
      userId: 'user-1',
      role: 'owner',
      name: 'Andrea Lunelio',
      email: 'andrea@elian.dev',
      avatarUrl: null,
      joinedAt: '2025-11-02T09:00:00Z',
   },
   {
      userId: 'user-2',
      role: 'admin',
      name: 'Marta Ferri',
      email: 'marta@elian.dev',
      avatarUrl: null,
      joinedAt: '2026-01-14T09:00:00Z',
   },
   {
      userId: 'user-3',
      role: 'member',
      name: 'Kenji Mori',
      email: 'kenji@elian.dev',
      avatarUrl: null,
      joinedAt: '2026-04-20T09:00:00Z',
   },
];
