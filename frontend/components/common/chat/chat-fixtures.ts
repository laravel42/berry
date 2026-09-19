/**
 * Story fixtures for the chat components: agents, conversations and the
 * messages in them, shaped like `/api/v1/conversations/*` answers, plus the
 * MSW handlers the containers need to load them.
 */
import { http, HttpResponse } from 'msw';
import type { Agent, AgentRoster } from '@/lib/agents';
import type { ChatMessage, ChatSuggestion, ChatTask, ChatThread } from '@/lib/chat';
import type { User } from '@/data/users';

export const chatUser: User = {
   id: 'user-andrea',
   name: 'Andrea Lunelio',
   avatarUrl: '',
   email: 'andrea@example.com',
   status: 'online',
   role: 'Admin',
   joinedDate: '2026-01-04',
   teamIds: [],
   timezone: 'Europe/Rome',
};

export const chatSession = {
   status: 'ready' as const,
   user: chatUser,
   workspace: { id: 'ws-1', name: 'Berry', slug: 'berry', role: 'admin' },
   workspaces: [{ id: 'ws-1', name: 'Berry', slug: 'berry', role: 'admin' }],
   boardId: 'board-1',
   error: null,
};

function agent(id: string, name: string, description: string, extra: Partial<Agent> = {}): Agent {
   return {
      id,
      name,
      description,
      avatarUrl: null,
      status: 'idle',
      capabilities: ['code'],
      permissions: [],
      labels: [],
      envNames: [],
      conversationStarters: [],
      customized: false,
      createdAt: '2026-08-01T09:00:00Z',
      updatedAt: '2026-09-10T09:00:00Z',
      ...extra,
   };
}

export const chatAgents: Agent[] = [
   agent('agent-orchestrator', 'Orchestrator', 'Splits work and hands it to the right role.', {
      capabilities: ['orchestrate'],
      roleKey: 'orchestrator',
   }),
   agent('agent-backend', 'Backend Engineer', 'Owns server-ts: schema, migrations and routes.', {
      conversationStarters: [
         'What changed in the dispatcher this week?',
         'Draft a migration for project health',
         'Why did BERR-42 fail its checks?',
      ],
   }),
   agent('agent-frontend', 'Frontend Engineer', 'Owns the Next.js app and its design system.'),
   agent('agent-reviewer', 'Code Reviewer', 'Reads pull requests before a person does.'),
   agent('agent-mine', 'Release Notes Writer', 'Turns merged work into a changelog entry.'),
];

function rosterEntry(agentId: string, ownerId: string | null): AgentRoster {
   return {
      agentId,
      ownerId,
      ownerName: ownerId ? chatUser.name : null,
      runtimeId: null,
      runtimeName: null,
      runtimeStatus: null,
      running: 0,
      queued: 0,
      totalRuns: 12,
      lastActiveAt: '2026-09-18T10:00:00Z',
      activity: [],
   };
}

export const chatRoster = new Map<string, AgentRoster>(
   chatAgents.map((entry) => [
      entry.id,
      rosterEntry(entry.id, entry.id === 'agent-mine' ? chatUser.id : null),
   ])
);

export const chatThreads: ChatThread[] = [
   {
      id: 'conv-1',
      kind: 'agent',
      topic: 'Project health migration',
      agentId: 'agent-backend',
      agentName: 'Backend Engineer',
      messageCount: 4,
      updatedAt: '2026-09-18T11:52:00Z',
      pinned: true,
      archived: false,
      unread: 0,
      activeRunId: null,
      draft: '',
      lastMessage: 'Migration 061 is ready for review.',
      lastMessageAuthor: 'agent',
   },
   {
      id: 'conv-2',
      kind: 'agent',
      topic: 'Frontend Engineer',
      agentId: 'agent-frontend',
      agentName: 'Frontend Engineer',
      messageCount: 9,
      updatedAt: '2026-09-18T11:58:00Z',
      pinned: false,
      archived: false,
      unread: 2,
      activeRunId: 'run-77',
      draft: '',
      lastMessage: 'I moved the approvals into the inbox.',
      lastMessageAuthor: 'agent',
   },
   {
      id: 'conv-3',
      kind: 'agent',
      topic: 'Why is the review gate empty?',
      agentId: 'agent-reviewer',
      agentName: 'Code Reviewer',
      messageCount: 2,
      updatedAt: '2026-09-17T15:20:00Z',
      pinned: false,
      archived: false,
      unread: 0,
      activeRunId: null,
      draft: '',
      lastMessage: null,
      lastMessageAuthor: null,
   },
];

export const archivedThreads: ChatThread[] = [
   {
      ...chatThreads[2]!,
      id: 'conv-old',
      topic: 'Q2 changelog',
      agentId: 'agent-mine',
      agentName: 'Release Notes Writer',
      archived: true,
      updatedAt: '2026-06-30T09:00:00Z',
      lastMessage: 'Published to the blog.',
   },
];

/** A realistic agent reply: headings, lists, code, a quote and links. */
export const agentReplyMarkdown = `## Summary

I added the \`project_health\` column and a forward-only migration. The chip now reads from the API, and the **localStorage fallback is gone**.

### What changed

- \`server-ts/migrations/061_project_health.sql\` adds the column with a \`no-update\` default
- \`PATCH /api/v1/projects/{id}/health\` is served by \`src/mounts/projects.ts\`
- The frontend store hydrates health from \`GET /api/v1/projects\`

### Next steps

1. Review the migration in [PR #412](https://github.com/berry/berry/pull/412)
2. Run \`pnpm migrate:server\` against a copy of the dev database
3. Approve BERR-101 once the checks pass

\`\`\`sql
ALTER TABLE projects
  ADD COLUMN health text NOT NULL DEFAULT 'no-update',
  ADD COLUMN health_updated_at timestamptz;
\`\`\`

> Existing browser-only values are discarded, as the plan assumed.

Details are on https://berry.example.com/berry/issue/BERR-101 and in *the run transcript*.`;

export const chatMessages: ChatMessage[] = [
   {
      id: 'msg-1',
      authorType: 'user',
      authorName: 'Andrea Lunelio',
      body: 'Can you persist project health to the database? The chip only lives in the browser right now.',
      channel: 'chat',
      createdAt: '2026-09-17T16:10:00Z',
      runId: null,
   },
   {
      id: 'msg-2',
      authorType: 'agent',
      authorName: 'Backend Engineer',
      body: 'On it. I will add a column, a migration and a `PATCH` route, then switch the chip over.',
      channel: 'chat',
      createdAt: '2026-09-17T16:11:00Z',
      runId: 'run-70',
   },
   {
      id: 'msg-3',
      authorType: 'user',
      authorName: 'Andrea Lunelio',
      body: 'Great. Keep the migration forward-only please.',
      channel: 'chat',
      createdAt: '2026-09-18T11:40:00Z',
      runId: null,
   },
   {
      id: 'msg-4',
      authorType: 'agent',
      authorName: 'Backend Engineer',
      body: agentReplyMarkdown,
      channel: 'chat',
      createdAt: '2026-09-18T11:52:00Z',
      runId: 'run-71',
   },
];

export const chatSuggestions: ChatSuggestion[] = [
   { label: 'Open the pull request', prompt: 'Open a pull request for the migration.' },
   { label: 'Write the tests', prompt: 'Add DB-backed tests for the health route.' },
];

export const queuedTasks: ChatTask[] = [
   {
      id: 'run-80',
      status: 'running',
      priority: 0,
      createdAt: '2026-09-18T11:55:00Z',
      startedAt: '2026-09-18T11:55:05Z',
   },
   {
      id: 'run-81',
      status: 'queued',
      priority: 0,
      createdAt: '2026-09-18T11:56:00Z',
      startedAt: null,
   },
   {
      id: 'run-82',
      status: 'queued',
      priority: 0,
      createdAt: '2026-09-18T11:57:30Z',
      startedAt: null,
   },
];

/** Everything the chat page and floating window read on open. */
export const chatHandlers = [
   http.get('*/api/v1/agents', () =>
      HttpResponse.json({ nodes: chatAgents, pageInfo: { hasNextPage: false, endCursor: null } })
   ),
   http.get('*/api/v1/agents/roster', () => HttpResponse.json({ nodes: [...chatRoster.values()] })),
   http.get('*/api/v1/runtimes/agent-coverage', () =>
      HttpResponse.json({ defaultRuntimeId: 'rt-default', nodes: [] })
   ),
   http.get('*/api/v1/conversations', ({ request }) =>
      HttpResponse.json({
         nodes: new URL(request.url).searchParams.get('archived') ? archivedThreads : chatThreads,
      })
   ),
   http.get('*/api/v1/conversations/pinned-agents', () =>
      HttpResponse.json({ agentIds: ['agent-backend', 'agent-orchestrator'] })
   ),
   http.get('*/api/v1/conversations/suggestions', () =>
      HttpResponse.json({ nodes: chatSuggestions })
   ),
   http.get('*/api/v1/conversations/:id/messages', () =>
      HttpResponse.json({ nodes: chatMessages })
   ),
   http.get('*/api/v1/conversations/:id/tasks', () => HttpResponse.json({ nodes: [] })),
   http.post('*/api/v1/conversations/:id/read', () => new HttpResponse(null, { status: 204 })),
   http.put('*/api/v1/conversations/:id/draft', () => new HttpResponse(null, { status: 204 })),
   http.post('*/api/v1/conversations/agents/:agentId', () => HttpResponse.json({ id: 'conv-1' })),
   http.post('*/api/v1/conversations/:id/messages', () =>
      HttpResponse.json({ messageId: 'msg-new', runId: 'run-90', queued: true }, { status: 202 })
   ),
];
