/**
 * Shared story data for agents, skills, autopilots and runs.
 *
 * Every shape here is what the matching `/api/v1` route returns (the zod
 * schemas in `lib/` are the contract), so a handler can hand it straight back
 * and a component can take it straight as a prop.
 */
import { http, HttpResponse } from 'msw';

import { priorities } from '@/data/priorities';
import { status as statuses } from '@/data/status';
import type { Issue } from '@/data/issues';
import type { User } from '@/data/users';
import {
   agentToUser,
   type Agent,
   type AgentModel,
   type AgentRoster,
   type AgentTask,
} from '@/lib/agents';
import type { Autopilot, AutopilotDetail, AutopilotRun, WebhookDelivery } from '@/lib/autopilots';
import type { RoleContract } from '@/lib/organization';
import type { RunRecord } from '@/lib/runs';
import type { AgentCoverage, Runtime } from '@/lib/runtimes';
import type { Skill } from '@/lib/skills';
import { useSessionStore } from '@/store/session-store';

// ------------------------------------------------------------------ people

export const sessionUser: User = {
   id: 'user-1',
   name: 'Andrea Lunelio',
   avatarUrl: '',
   email: 'andrea@berry.dev',
   status: 'online',
   role: 'Admin',
   joinedDate: '2026-01-12',
   teamIds: [],
   timezone: 'UTC',
};

/** `GET /api/v1/workspaces/:id/members` nodes. */
export const memberNodes = [
   {
      userId: 'user-1',
      workspaceId: 'ws-1',
      role: 'admin',
      email: 'andrea@berry.dev',
      name: 'Andrea Lunelio',
      avatarUrl: null,
      joinedAt: '2026-01-12T09:00:00Z',
      updatedAt: '2026-01-12T09:00:00Z',
   },
   {
      userId: 'user-2',
      workspaceId: 'ws-1',
      role: 'member',
      email: 'mira@berry.dev',
      name: 'Mira Okafor',
      avatarUrl: null,
      joinedAt: '2026-02-03T09:00:00Z',
      updatedAt: '2026-02-03T09:00:00Z',
   },
   {
      userId: 'user-3',
      workspaceId: 'ws-1',
      role: 'member',
      email: 'tomas@berry.dev',
      name: 'Tomás Reyes',
      avatarUrl: null,
      joinedAt: '2026-03-21T09:00:00Z',
      updatedAt: '2026-03-21T09:00:00Z',
   },
];

/** Signs an admin into workspace `ws-1`, so edit controls render. */
export function seedSession(role: 'owner' | 'admin' | 'member' | 'guest' = 'admin') {
   const workspace = { id: 'ws-1', name: 'Berry', slug: 'berry', role };
   useSessionStore.setState({
      status: 'ready',
      user: sessionUser,
      workspace,
      workspaces: [workspace],
      boardId: 'board-1',
      error: null,
   });
}

/** `useParams()` inside the workspace, the way the app routes read it. */
export const orgParams = { nextjs: { navigation: { segments: [['orgId', 'berry']] } } };

// ------------------------------------------------------------------ agents

export const frontendContract: RoleContract = {
   id: 'frontend-engineer',
   name: 'Frontend Engineer',
   role: 'Senior Frontend Engineer',
   department: 'engineering',
   mission: 'Build accessible, fast interfaces that match the design system and the spec.',
   responsibilities: [
      'Implement screens and components from the design specification.',
      'Keep every state covered: empty, loading, error and success.',
      'Write component tests for behaviour a reviewer cannot see.',
   ],
   capabilities: ['frontend', 'react', 'accessibility'],
   allowed_tools: ['read_repository', 'create_branches', 'run_commands', 'open_pull_requests'],
   preferred_model: 'us.anthropic.claude-sonnet-5',
   inputs: ['Screen specifications', 'Component specifications', 'API contracts'],
   outputs: ['Pull requests', 'Component tests'],
   can_delegate_to: ['qa-engineer'],
   receives_work_from: ['orchestrator', 'product-designer'],
   escalation_rules: [
      {
         when: 'The design needs a component the design system does not have',
         to: 'product-designer',
         decision: 'product',
      },
      {
         when: 'An API contract is missing a field the screen needs',
         to: 'human',
         decision: 'technical',
      },
   ],
   review_requirements: [
      { reviewer: 'qa-engineer', authority: 'blocking', when: { always: true } },
      { reviewer: 'product-designer', authority: 'advisory', when: { always: true } },
   ],
   autonomy_level: 3,
   review_domains: ['Frontend code and component APIs'],
   discovery: {
      cron: '0 7 * * 1',
      focus: ['Components with no loading or error state', 'Inaccessible controls'],
      evidence_sources: ['Repository UI code'],
   },
   run_limits: { max_turns: 40, max_output_tokens: 16000 },
   never: ['Merge a pull request.', 'Introduce a colour outside the design tokens.'],
   system_prompt: 'You are the Frontend Engineer for this workspace.',
};

const agentBase = {
   avatarUrl: null,
   status: 'available',
   capabilities: [] as string[],
   instructions: null,
   modelProvider: 'bedrock',
   modelName: 'us.anthropic.claude-sonnet-5',
   permissions: ['read_repository', 'create_branches', 'run_commands', 'open_pull_requests'],
   labels: [] as string[],
   envNames: [] as string[],
   access: { assign: 'everyone', mention: 'everyone' },
   systemRole: null,
   ownerId: null,
   conversationStarters: [] as string[],
   maxConcurrency: null,
   archivedAt: null,
   createdAt: '2026-06-01T09:00:00Z',
   updatedAt: '2026-09-17T16:20:00Z',
   roleKey: null,
   department: null,
   autonomyLevel: null,
   customized: false,
   contract: null,
} satisfies Omit<Agent, 'id' | 'name'>;

export const orchestratorAgent: Agent = {
   ...agentBase,
   id: 'agent-orchestrator',
   name: 'Orchestrator',
   description: 'Routes every new task to the role that owns it.',
   capabilities: ['orchestrate'],
   modelName: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
   roleKey: 'orchestrator',
   department: 'leadership',
   autonomyLevel: 2,
   systemRole: 'orchestrator',
};

export const frontendAgent: Agent = {
   ...agentBase,
   id: 'agent-frontend',
   name: 'Frontend Engineer',
   description: 'Builds screens and components from the design specification.',
   status: 'busy',
   instructions:
      'Work in `frontend/`. Use the semantic tokens in `app/globals.css`; never hard-code a colour.',
   roleKey: 'frontend-engineer',
   department: 'engineering',
   autonomyLevel: 3,
   customized: true,
   contract: frontendContract,
   conversationStarters: ['Build the empty state for the goals list', 'Audit the settings forms'],
   maxConcurrency: 2,
};

export const releaseAgent: Agent = {
   ...agentBase,
   id: 'agent-release-notes',
   name: 'release-notes',
   description: 'Drafts release notes from merged pull requests.',
   instructions: 'Group changes by area. Lead with what a user will notice.',
   modelName: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
   ownerId: 'user-2',
   access: { assign: 'admins', mention: 'admins' },
   labels: ['docs'],
   envNames: ['GITHUB_TOKEN'],
};

export const importerAgent: Agent = {
   ...agentBase,
   id: 'agent-importer',
   name: 'legacy-importer',
   description: 'Copies issues from the old tracker. Kept for the archive migration.',
   status: 'offline',
   modelProvider: null,
   modelName: null,
   access: { assign: 'listed', mention: 'listed' },
};

export const archivedAgent: Agent = {
   ...agentBase,
   id: 'agent-archived',
   name: 'standup-bot',
   description: 'Posted a daily summary before autopilots existed.',
   status: 'offline',
   archivedAt: '2026-08-02T10:00:00Z',
};

export const liveAgents: Agent[] = [orchestratorAgent, frontendAgent, releaseAgent, importerAgent];

/** `count` days, oldest first, ending 2026-09-17. */
function activityDays(
   count: number,
   runsAt: (index: number) => number,
   failedAt: (index: number) => number
): AgentRoster['activity'] {
   const end = Date.UTC(2026, 8, 17);
   return Array.from({ length: count }, (_, index) => {
      const day = new Date(end - (count - 1 - index) * 86_400_000);
      const iso = day.toISOString().slice(0, 10);
      return { day: iso, runs: runsAt(index), failed: failedAt(index) };
   });
}

/** Seven days, oldest first, ending the day before the fixed story clock. */
function week(runs: number[], failed: number[]): AgentRoster['activity'] {
   return activityDays(
      runs.length,
      (index) => runs[index] ?? 0,
      (index) => failed[index] ?? 0
   );
}

function month(): AgentRoster['activity'] {
   return activityDays(
      30,
      (index) => (index % 5 === 0 ? 0 : 2 + (index % 7)),
      (index) => (index % 11 === 0 ? 1 : 0)
   );
}

export const rosterNodes: AgentRoster[] = [
   {
      agentId: orchestratorAgent.id,
      ownerId: null,
      ownerName: null,
      runtimeId: 'rt-platform',
      runtimeName: 'Berry platform',
      runtimeStatus: 'active',
      running: 0,
      queued: 0,
      totalRuns: 412,
      lastActiveAt: '2026-09-18T11:52:00Z',
      activity: month(),
   },
   {
      agentId: frontendAgent.id,
      ownerId: null,
      ownerName: null,
      runtimeId: 'rt-gpu',
      runtimeName: 'eu-west builder',
      runtimeStatus: 'unreachable',
      running: 1,
      queued: 2,
      totalRuns: 87,
      lastActiveAt: '2026-09-18T11:40:00Z',
      activity: week([3, 5, 4, 0, 0, 6, 8], [1, 0, 2, 0, 0, 1, 3]),
   },
   {
      agentId: releaseAgent.id,
      ownerId: 'user-2',
      ownerName: 'Mira Okafor',
      runtimeId: null,
      runtimeName: null,
      runtimeStatus: null,
      running: 0,
      queued: 0,
      totalRuns: 6,
      lastActiveAt: '2026-09-12T08:00:00Z',
      activity: week([0, 1, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0]),
   },
   {
      agentId: importerAgent.id,
      ownerId: null,
      ownerName: null,
      runtimeId: null,
      runtimeName: null,
      runtimeStatus: null,
      running: 0,
      queued: 0,
      totalRuns: 0,
      lastActiveAt: null,
      activity: week([0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0]),
   },
];

export const rosterMap = new Map(rosterNodes.map((node) => [node.agentId, node]));

export const coverage: AgentCoverage = {
   defaultRuntimeId: 'rt-platform',
   nodes: liveAgents.map((agent) => {
      const entry = rosterMap.get(agent.id);
      return {
         id: agent.id,
         name: agent.name,
         runtimeId: entry?.runtimeId ?? null,
         runtimeName: entry?.runtimeName ?? null,
      };
   }),
};

/** A workspace with no default runtime: only explicitly bound agents can run. */
export const coverageWithoutDefault: AgentCoverage = { ...coverage, defaultRuntimeId: null };

export const models: AgentModel[] = [
   {
      id: 'us.anthropic.claude-sonnet-5',
      displayName: 'Claude Sonnet 5',
      provider: 'bedrock',
      tier: 'standard',
      contextWindow: 1_000_000,
      inputCostPerM: 3,
      outputCostPerM: 15,
      supportsTools: true,
      supportsVision: true,
   },
   {
      id: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
      displayName: 'Claude Haiku 4.5',
      provider: 'bedrock',
      tier: 'fast',
      contextWindow: 200_000,
      inputCostPerM: 1,
      outputCostPerM: 5,
      supportsTools: true,
      supportsVision: true,
   },
   {
      id: 'us.anthropic.claude-opus-5',
      displayName: 'Claude Opus 5',
      provider: 'bedrock',
      tier: 'premium',
      contextWindow: 1_000_000,
      inputCostPerM: 15,
      outputCostPerM: 75,
      supportsTools: true,
      supportsVision: true,
   },
   {
      id: 'qwen.qwen3-32b-v1:0',
      displayName: 'Qwen3 32B',
      provider: 'bedrock',
      tier: 'open',
      contextWindow: 32_000,
      inputCostPerM: 0.15,
      outputCostPerM: 0.6,
      supportsTools: true,
      supportsVision: false,
   },
];

const runtimeBase = {
   kind: 'custom',
   driver: 'agentcore',
   arn: null,
   endpointUrl: null,
   qualifier: 'DEFAULT',
   region: 'us-east-1',
   status: 'active',
   lastHealthAt: '2026-09-18T11:59:00Z',
   lastHealthError: null,
   concurrencyLimit: 8,
   visibility: 'workspace',
   ownerId: 'user-1',
   idleTimeoutS: 900,
   maxLifetimeS: 28_800,
   isDefault: false,
   activeRuns: 0,
} satisfies Omit<Runtime, 'id' | 'name'>;

export const runtimes: Runtime[] = [
   {
      ...runtimeBase,
      id: 'rt-platform',
      name: 'Berry platform',
      kind: 'platform',
      isDefault: true,
      activeRuns: 1,
   },
   {
      ...runtimeBase,
      id: 'rt-gpu',
      name: 'eu-west builder',
      region: 'eu-west-1',
      status: 'unreachable',
      lastHealthError: 'connect ETIMEDOUT',
   },
];

export const agentTasks: AgentTask[] = [
   {
      id: 'run-7f3a91c2',
      status: 'running',
      issueId: 'issue-42',
      summary: 'Adding the empty state to the goals list',
      failure: null,
      createdAt: '2026-09-18T11:38:00Z',
      startedAt: '2026-09-18T11:40:00Z',
      completedAt: null,
   },
   {
      id: 'run-2b8e40d1',
      status: 'queued',
      issueId: null,
      summary: null,
      failure: null,
      createdAt: '2026-09-18T11:55:00Z',
      startedAt: null,
      completedAt: null,
   },
   {
      id: 'run-9c1d5e77',
      status: 'succeeded',
      issueId: 'issue-40',
      summary: 'Moved approvals and proposals into the inbox',
      failure: null,
      createdAt: '2026-09-18T08:02:00Z',
      startedAt: '2026-09-18T08:02:10Z',
      completedAt: '2026-09-18T08:09:45Z',
   },
   {
      id: 'run-4e6f0a18',
      status: 'failed',
      issueId: 'issue-39',
      summary: 'Tighten the review surface spacing',
      failure: {
         code: 'RUNTIME_TIMEOUT',
         message: 'The runtime stopped answering.',
         retryable: true,
      },
      createdAt: '2026-09-17T15:30:00Z',
      startedAt: '2026-09-17T15:30:05Z',
      completedAt: '2026-09-17T16:00:05Z',
   },
   {
      id: 'run-a0b3c6d9',
      status: 'cancelled',
      issueId: null,
      summary: null,
      failure: null,
      createdAt: '2026-09-16T10:00:00Z',
      startedAt: '2026-09-16T10:00:04Z',
      completedAt: '2026-09-16T10:01:30Z',
   },
];

/** `GET /api/v1/organization`, enough for the role tab's delegation pickers. */
export const organization = {
   departments: [
      {
         key: 'leadership',
         roles: [
            {
               roleKey: 'orchestrator',
               name: 'Orchestrator',
               role: 'Work router',
               autonomyLevel: 2,
               agentId: orchestratorAgent.id,
               customized: false,
               contractValid: true,
               discovery: null,
            },
         ],
      },
      {
         key: 'product',
         roles: [
            {
               roleKey: 'product-designer',
               name: 'Product Designer',
               role: 'Senior Product Designer',
               autonomyLevel: 3,
               agentId: 'agent-designer',
               customized: false,
               contractValid: true,
               discovery: null,
            },
         ],
      },
      {
         key: 'engineering',
         roles: [
            {
               roleKey: 'frontend-engineer',
               name: 'Frontend Engineer',
               role: 'Senior Frontend Engineer',
               autonomyLevel: 3,
               agentId: frontendAgent.id,
               customized: true,
               contractValid: true,
               discovery: null,
            },
            {
               roleKey: 'qa-engineer',
               name: 'QA Engineer',
               role: 'QA Engineer',
               autonomyLevel: 2,
               agentId: 'agent-qa',
               customized: false,
               contractValid: true,
               discovery: null,
            },
            {
               roleKey: 'backend-engineer',
               name: 'Backend Engineer',
               role: 'Senior Backend Engineer',
               autonomyLevel: 3,
               agentId: 'agent-backend',
               customized: false,
               contractValid: true,
               discovery: null,
            },
         ],
      },
   ],
   delegation: [],
   workflows: [],
   discoveryEnabled: true,
};

/** Role options as the role tab builds them, for the pickers on their own. */
export const roleOptions = organization.departments
   .flatMap((department) => department.roles)
   .filter((role) => role.roleKey !== 'frontend-engineer')
   .map((role) => ({ id: role.roleKey, label: role.name, colorSeed: role.agentId }))
   .sort((left, right) => left.label.localeCompare(right.label));

// ------------------------------------------------------------------ issues

const statusById = (id: string) => statuses.find((entry) => entry.id === id) ?? statuses[0]!;
const priorityById = (id: string) => priorities.find((entry) => entry.id === id) ?? priorities[0]!;

function issue(
   id: string,
   identifier: string,
   title: string,
   statusId: string,
   assignee: User | null,
   index: number
): Issue {
   return {
      id,
      identifier,
      title,
      description: '',
      status: statusById(statusId),
      assignee,
      priority: priorityById(index % 2 === 0 ? 'high' : 'medium'),
      labels: [],
      createdAt: '2026-09-15T09:00:00Z',
      cycleId: '',
      rank: String(index),
      sortOrder: index,
   };
}

export const issues: Issue[] = [
   issue(
      'issue-42',
      'BERR-42',
      'Add an empty state to the goals list',
      'in-progress',
      agentToUser(frontendAgent),
      0
   ),
   issue(
      'issue-44',
      'BERR-44',
      'Share the list filter across agents and skills',
      'to-do',
      agentToUser(frontendAgent),
      1
   ),
   issue(
      'issue-40',
      'BERR-40',
      'Move approvals and proposals into the inbox',
      'in-review',
      agentToUser(frontendAgent),
      2
   ),
   issue(
      'issue-39',
      'BERR-39',
      'Tighten task, review and display surfaces',
      'done',
      sessionUser,
      3
   ),
];

// ------------------------------------------------------------------ skills

const skillBase = {
   content: '',
   labels: [] as string[],
   source: { kind: 'manual', url: null, ref: null, importedAt: null },
   files: [] as Skill['files'],
   agentEnabled: null,
   createdBy: 'user-1',
   creatorName: 'Andrea Lunelio',
   agents: [] as Skill['agents'],
   createdAt: '2026-07-01T09:00:00Z',
   updatedAt: '2026-09-10T09:00:00Z',
} satisfies Omit<Skill, 'id' | 'name' | 'description'>;

export const skills: Skill[] = [
   {
      ...skillBase,
      id: 'skill-design-tokens',
      name: 'design-tokens',
      description: 'Use the semantic colour and spacing tokens from app/globals.css.',
      content:
         '---\nname: design-tokens\ndescription: Use the semantic colour and spacing tokens from app/globals.css.\n---\n\n# Design tokens\n\nNever hard-code a colour. Reach for `bg-container`, `text-muted-foreground` and the `status-*` family.\n',
      labels: ['frontend', 'design'],
      agentEnabled: true,
      agents: [
         { id: frontendAgent.id, name: frontendAgent.name, enabled: true },
         { id: releaseAgent.id, name: releaseAgent.name, enabled: false },
      ],
      files: [{ path: 'SKILL.md', size: 312 }],
      updatedAt: '2026-09-17T14:00:00Z',
   },
   {
      ...skillBase,
      id: 'skill-conventional-commits',
      name: 'conventional-commits',
      description: 'Write commit messages as type(scope): summary (BERR-NN).',
      content:
         '---\nname: conventional-commits\ndescription: Write commit messages as type(scope): summary (BERR-NN).\n---\n\nUse `server-ts` or `frontend` as the scope.\n',
      labels: ['git'],
      source: {
         kind: 'github',
         url: 'https://github.com/berry-dev/skills',
         ref: 'main',
         importedAt: '2026-08-20T09:00:00Z',
      },
      agentEnabled: true,
      agents: [
         { id: frontendAgent.id, name: frontendAgent.name, enabled: true },
         { id: orchestratorAgent.id, name: orchestratorAgent.name, enabled: true },
      ],
      files: [
         { path: 'SKILL.md', size: 210 },
         { path: 'examples.md', size: 1_024 },
      ],
      createdBy: 'user-2',
      creatorName: 'Mira Okafor',
   },
   {
      ...skillBase,
      id: 'skill-release-notes',
      name: 'release-notes',
      description: 'Group merged changes by area and lead with what users notice.',
      labels: ['docs'],
      agentEnabled: false,
      updatedAt: '2026-08-01T09:00:00Z',
   },
   {
      ...skillBase,
      id: 'skill-sql-review',
      name: 'sql-review',
      description: 'Check every query for a missing index and an unbounded scan.',
      labels: ['backend', 'database'],
      source: {
         kind: 'zip',
         url: null,
         ref: null,
         importedAt: '2026-06-11T09:00:00Z',
      },
      files: [{ path: 'SKILL.md', size: 540 }],
      createdBy: null,
      creatorName: null,
   },
];

// -------------------------------------------------------------------- runs

export const runs: RunRecord[] = [
   {
      id: 'run-7f3a91c2',
      issueId: 'issue-42',
      agentId: frontendAgent.id,
      status: 'running',
      sequence: 3,
      summary: 'Adding the empty state to the goals list',
      usage: {
         inputTokens: 18_400,
         outputTokens: 2_100,
         totalTokens: 20_500,
         costMicros: 86_700,
         currency: 'USD',
      },
      failure: null,
      source: 'assignment',
      requestedBy: { type: 'user', id: 'user-1' },
      createdAt: '2026-09-18T11:38:00Z',
      startedAt: '2026-09-18T11:40:00Z',
      completedAt: null,
   },
   {
      id: 'run-9c1d5e77',
      issueId: 'issue-40',
      agentId: frontendAgent.id,
      status: 'succeeded',
      sequence: 2,
      summary: 'Moved approvals and proposals into the inbox and removed the old tab.',
      usage: {
         inputTokens: 52_000,
         outputTokens: 7_400,
         totalTokens: 59_400,
         costMicros: 267_000,
         currency: 'USD',
      },
      failure: null,
      source: 'mention',
      requestedBy: { type: 'user', id: 'user-2' },
      createdAt: '2026-09-18T08:02:00Z',
      startedAt: '2026-09-18T08:02:10Z',
      completedAt: '2026-09-18T08:09:45Z',
   },
   {
      id: 'run-4e6f0a18',
      issueId: 'issue-39',
      agentId: orchestratorAgent.id,
      status: 'failed',
      sequence: 1,
      summary: null,
      usage: {
         inputTokens: 3_000,
         outputTokens: 120,
         totalTokens: 3_120,
         costMicros: 3_600,
         currency: 'USD',
      },
      failure: {
         code: 'RUNTIME_TIMEOUT',
         message: 'The runtime stopped answering after 30 minutes.',
         retryable: true,
      },
      source: 'autopilot',
      requestedBy: null,
      createdAt: '2026-09-17T15:30:00Z',
      startedAt: '2026-09-17T15:30:05Z',
      completedAt: '2026-09-17T16:00:05Z',
   },
];

let eventSeq = 0;
function runEvent(
   runId: string,
   type: string,
   occurredAt: string,
   payload: Record<string, unknown>
) {
   eventSeq += 1;
   return { id: `evt-${eventSeq}`, type, occurredAt, runId, sequence: eventSeq, payload };
}

/** A finished run's ledger: thinking, a read, a command, an edit, and delivery. */
export function succeededRunEvents(runId = 'run-9c1d5e77') {
   return [
      runEvent(runId, 'run.started', '2026-09-18T08:02:10Z', {}),
      runEvent(runId, 'run.output.delta', '2026-09-18T08:02:12Z', {
         text: 'The approvals tab and the proposals page both list pending decisions. ',
      }),
      runEvent(runId, 'run.output.delta', '2026-09-18T08:02:13Z', {
         text: 'I will move both into the inbox and delete the tab.',
      }),
      runEvent(runId, 'run.tool.started', '2026-09-18T08:02:18Z', {
         name: 'list_files',
         toolCallId: 'call-0',
      }),
      runEvent(runId, 'run.tool.completed', '2026-09-18T08:02:18Z', {
         toolCallId: 'call-0',
         status: 'succeeded',
         durationMs: 180,
         detail: { count: 12 },
      }),
      runEvent(runId, 'run.tool.started', '2026-09-18T08:02:20Z', {
         name: 'read_file',
         toolCallId: 'call-1',
      }),
      runEvent(runId, 'run.tool.completed', '2026-09-18T08:02:21Z', {
         toolCallId: 'call-1',
         status: 'succeeded',
         durationMs: 240,
         detail: { path: 'frontend/app/inbox/page.tsx', bytes: 4812 },
      }),
      runEvent(runId, 'run.command.started', '2026-09-18T08:04:00Z', {
         commandId: 'cmd-1',
         command: 'pnpm lint',
         cwd: 'frontend',
      }),
      runEvent(runId, 'run.command.output', '2026-09-18T08:04:30Z', {
         commandId: 'cmd-1',
         text: '> eslint .\n\n✔ No problems found.\n',
      }),
      runEvent(runId, 'run.command.completed', '2026-09-18T08:04:31Z', {
         commandId: 'cmd-1',
         exitCode: 0,
      }),
      runEvent(runId, 'run.tool.started', '2026-09-18T08:05:00Z', {
         name: 'write_file',
         toolCallId: 'call-2',
      }),
      runEvent(runId, 'run.tool.completed', '2026-09-18T08:05:02Z', {
         toolCallId: 'call-2',
         status: 'succeeded',
         durationMs: 310,
         detail: { path: 'frontend/components/inbox/inbox.tsx', bytes: 812 },
      }),
      runEvent(runId, 'run.delivered', '2026-09-18T08:09:40Z', {
         committed: true,
         commit: '4ef7b29',
         branch: 'berr-40-inbox-approvals',
         filesChanged: 6,
         insertions: 184,
         deletions: 211,
         files: ['frontend/components/inbox/inbox.tsx'],
         pullRequest: {
            number: 118,
            url: 'https://github.com/berry-dev/berry/pull/118',
            created: true,
         },
         mergeRequiresApproval: true,
      }),
      runEvent(runId, 'run.completed', '2026-09-18T08:09:45Z', {}),
   ];
}

/** A run that failed on a command. */
export function failedRunEvents(runId = 'run-4e6f0a18') {
   return [
      runEvent(runId, 'run.started', '2026-09-17T15:30:05Z', {}),
      runEvent(runId, 'run.command.started', '2026-09-17T15:31:00Z', {
         commandId: 'cmd-9',
         command: 'pnpm test:server',
      }),
      runEvent(runId, 'run.command.output', '2026-09-17T15:31:40Z', {
         commandId: 'cmd-9',
         text: 'not ok 3 - dispatcher claims an expired lease\n',
      }),
      runEvent(runId, 'run.command.completed', '2026-09-17T15:31:41Z', {
         commandId: 'cmd-9',
         exitCode: 1,
      }),
      runEvent(runId, 'run.failed', '2026-09-17T16:00:05Z', {
         message: 'The runtime stopped answering after 30 minutes.',
      }),
   ];
}

/** Server-sent events as `/api/v1/runs/:id/events` streams them. */
export function sseBody(events: Array<{ type: string }>): string {
   return events
      .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
      .join('');
}

export const sseResponse = (events: Array<{ type: string }>) =>
   new HttpResponse(sseBody(events), { headers: { 'content-type': 'text/event-stream' } });

// -------------------------------------------------------------- autopilots

const autopilotBase = {
   workspaceId: 'ws-1',
   description: null,
   assigneeType: 'agent',
   executionMode: 'create_issue',
   boardId: 'board-1',
   issueId: null,
   status: 'active',
   version: 1,
   quotaPeriod: 'none',
   quotaMax: null,
   createdBy: 'user-1',
   triggerKinds: [],
   createdAt: '2026-07-10T09:00:00Z',
   updatedAt: '2026-09-17T09:00:00Z',
} satisfies Omit<Autopilot, 'id' | 'name' | 'assigneeId' | 'promptTemplate'>;

export const autopilots: Autopilot[] = [
   {
      ...autopilotBase,
      id: 'ap-triage',
      name: 'Morning triage',
      assigneeId: orchestratorAgent.id,
      promptTemplate:
         'Read every task created since yesterday. Set a priority, a project and an owner for each, and say why in one sentence.',
      triggerKinds: ['cron'],
      quotaPeriod: 'day',
      quotaMax: 2,
      version: 4,
   },
   {
      ...autopilotBase,
      id: 'ap-release',
      name: 'Release notes on tag',
      assigneeId: releaseAgent.id,
      promptTemplate: 'Draft release notes for the tag in the payload. Group changes by area.',
      triggerKinds: ['webhook'],
      executionMode: 'fixed_issue',
      boardId: null,
      issueId: 'issue-39',
      createdBy: 'user-2',
      updatedAt: '2026-09-12T09:00:00Z',
   },
   {
      ...autopilotBase,
      id: 'ap-sweep',
      name: 'Stale branch sweep',
      assigneeId: frontendAgent.id,
      promptTemplate:
         'List branches with no commits in thirty days and open a task to delete them.',
      status: 'paused',
      quotaPeriod: 'week',
      quotaMax: 1,
      createdAt: '2026-05-02T09:00:00Z',
      updatedAt: '2026-08-30T09:00:00Z',
   },
];

export const autopilotDetail: AutopilotDetail = {
   ...autopilots[0]!,
   triggers: [
      {
         id: 'trg-cron',
         autopilotId: 'ap-triage',
         kind: 'cron',
         enabled: true,
         cronExpression: '0 9 * * 1-5',
         timezone: 'Europe/Rome',
         nextFireAt: '2026-09-21T07:00:00Z',
         lastFiredAt: '2026-09-18T07:00:00Z',
         tokenHint: null,
         eventFilters: [],
         createdAt: '2026-07-10T09:00:00Z',
         updatedAt: '2026-07-10T09:00:00Z',
      },
      {
         id: 'trg-hook',
         autopilotId: 'ap-triage',
         kind: 'webhook',
         enabled: false,
         cronExpression: null,
         timezone: null,
         nextFireAt: null,
         lastFiredAt: '2026-09-02T12:00:00Z',
         tokenHint: 'a91f',
         eventFilters: ['issues.opened', 'issues.reopened'],
         createdAt: '2026-08-01T09:00:00Z',
         updatedAt: '2026-08-01T09:00:00Z',
      },
   ],
   members: [
      { userId: 'user-1', role: 'collaborator', createdAt: '2026-07-10T09:00:00Z' },
      { userId: 'user-2', role: 'subscriber', createdAt: '2026-07-11T09:00:00Z' },
   ],
};

const runBase = {
   autopilotId: 'ap-triage',
   autopilotVersion: 4,
   triggerId: 'trg-cron',
   source: 'cron',
   status: 'enqueued',
   reasonCode: null,
   reasonMessage: null,
   issueId: null,
   runId: null,
   taskStatus: null,
   slot: null,
   requestedBy: null,
} satisfies Omit<AutopilotRun, 'id' | 'createdAt'>;

export const autopilotRuns: AutopilotRun[] = [
   {
      ...runBase,
      id: 'apr-6',
      createdAt: '2026-09-18T07:00:00Z',
      issueId: 'issue-44',
      runId: 'run-7f3a91c2',
      taskStatus: 'running',
   },
   {
      ...runBase,
      id: 'apr-5',
      createdAt: '2026-09-17T09:14:00Z',
      source: 'manual',
      triggerId: null,
      requestedBy: 'user-1',
      issueId: 'issue-40',
      runId: 'run-9c1d5e77',
      taskStatus: 'succeeded',
   },
   {
      ...runBase,
      id: 'apr-4',
      createdAt: '2026-09-17T07:00:00Z',
      status: 'skipped',
      reasonCode: 'QUOTA_EXCEEDED',
   },
   {
      ...runBase,
      id: 'apr-3',
      createdAt: '2026-09-16T07:00:00Z',
      status: 'skipped',
      reasonCode: 'QUOTA_EXCEEDED',
   },
   {
      ...runBase,
      id: 'apr-2',
      createdAt: '2026-09-15T07:00:00Z',
      status: 'skipped',
      reasonCode: 'QUOTA_EXCEEDED',
   },
   {
      ...runBase,
      id: 'apr-1',
      createdAt: '2026-09-14T07:00:00Z',
      status: 'failed',
      reasonCode: 'ENQUEUE_FAILED',
      reasonMessage: 'The dispatcher refused the task.',
      autopilotVersion: 3,
   },
];

const deliveryBase = {
   autopilotId: 'ap-triage',
   triggerId: 'trg-hook',
   event: 'issues.opened',
   status: 'accepted',
   failureReason: null,
   autopilotRunId: 'apr-5',
   replayOf: null,
} satisfies Omit<WebhookDelivery, 'id' | 'receivedAt'>;

export const deliveries: WebhookDelivery[] = [
   { ...deliveryBase, id: 'dlv-4', receivedAt: '2026-09-17T09:14:00Z', replayOf: 'dlv-2' },
   {
      ...deliveryBase,
      id: 'dlv-3',
      receivedAt: '2026-09-10T12:00:00Z',
      event: 'push',
      status: 'filtered',
      autopilotRunId: null,
   },
   {
      ...deliveryBase,
      id: 'dlv-2',
      receivedAt: '2026-09-09T12:00:00Z',
      status: 'failed',
      failureReason: 'Autopilot paused',
      autopilotRunId: null,
   },
   {
      ...deliveryBase,
      id: 'dlv-1',
      receivedAt: '2026-09-02T12:00:00Z',
      status: 'rejected',
      failureReason: 'Signature mismatch',
      autopilotRunId: null,
   },
];

export const boards = [
   { id: 'board-1', name: 'Berry', slug: 'berry', description: null },
   { id: 'board-2', name: 'Website', slug: 'website', description: null },
];

/** Nine future firings, as `/cron-preview` returns them. */
export const cronPreview = [
   '2026-09-21T07:00:00Z',
   '2026-09-22T07:00:00Z',
   '2026-09-23T07:00:00Z',
   '2026-09-24T07:00:00Z',
   '2026-09-25T07:00:00Z',
];

// ---------------------------------------------------------------- handlers

const page = <T>(nodes: T[]) => ({ nodes, pageInfo: { hasNextPage: false, endCursor: null } });

/**
 * Every read the components in these folders make, answered from the data
 * above. Writes echo a plausible success. Stories override a single route by
 * `msw.use`-ing their own handler after these.
 */
export const storyHandlers = [
   // agents
   http.get('*/api/v1/agents/models', () => HttpResponse.json({ nodes: models })),
   http.get('*/api/v1/agents/roster', () => HttpResponse.json({ nodes: rosterNodes })),
   http.get('*/api/v1/agents/:id/tasks', () => HttpResponse.json(page(agentTasks))),
   http.get('*/api/v1/agents/:id/access', ({ params }) => {
      const agent = liveAgents.find((entry) => entry.id === params.id);
      return HttpResponse.json({
         assign: agent?.access?.assign ?? 'everyone',
         mention: agent?.access?.mention ?? 'everyone',
         members: [],
      });
   }),
   http.get('*/api/v1/agents/:id', ({ params }) => {
      const agent = [...liveAgents, archivedAgent].find((entry) => entry.id === params.id);
      return agent
         ? HttpResponse.json(agent)
         : HttpResponse.json(
              { error: { code: 'NOT_FOUND', message: 'No such agent' } },
              { status: 404 }
           );
   }),
   http.get('*/api/v1/agents', ({ request }) =>
      HttpResponse.json(
         page(
            new URL(request.url).searchParams.get('archived') === 'true'
               ? [archivedAgent]
               : liveAgents
         )
      )
   ),
   http.put('*/api/v1/agents/:id/config', async ({ params, request }) => {
      const agent = liveAgents.find((entry) => entry.id === params.id) ?? frontendAgent;
      const body = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json({ ...agent, ...body, updatedAt: '2026-09-18T12:00:00Z' });
   }),
   http.post('*/api/v1/agents/:id/cancel-tasks', () => HttpResponse.json({ cancelled: 3 })),
   http.get('*/api/v1/organization', () => HttpResponse.json(organization)),
   http.get('*/api/v1/runtimes/agent-coverage', () => HttpResponse.json(coverage)),
   http.get('*/api/v1/runtimes', () => HttpResponse.json({ nodes: runtimes })),
   http.get('*/api/v1/mcp-servers', () => HttpResponse.json({ nodes: [] })),
   http.get('*/api/v1/workspaces/:id/members', () => HttpResponse.json(page(memberNodes))),
   http.get('*/api/v1/boards', () => HttpResponse.json(page(boards))),

   // skills
   http.get('*/api/v1/skills/:id', ({ params }) => {
      const skill = skills.find((entry) => entry.id === params.id);
      return skill
         ? HttpResponse.json(skill)
         : HttpResponse.json(
              { error: { code: 'NOT_FOUND', message: 'No such skill' } },
              { status: 404 }
           );
   }),
   http.get('*/api/v1/skills', ({ request }) => {
      const agentId = new URL(request.url).searchParams.get('agentId');
      return HttpResponse.json({
         nodes: agentId
            ? skills.map((skill) => ({
                 ...skill,
                 agentEnabled: skill.agents.some((agent) => agent.id === agentId && agent.enabled),
              }))
            : skills,
      });
   }),
   http.put('*/api/v1/skills/:id/agents/:agentId', () => new HttpResponse(null, { status: 204 })),
   http.post('*/api/v1/skills', async ({ request }) => {
      const body = (await request.json()) as Partial<Skill>;
      return HttpResponse.json({ ...skills[2]!, ...body, id: 'skill-new' });
   }),

   // runs
   http.get('*/api/v1/runs/:id/events', ({ params }) =>
      sseResponse(
         params.id === 'run-4e6f0a18' ? failedRunEvents() : succeededRunEvents(String(params.id))
      )
   ),
   http.get('*/api/v1/runs/:id', ({ params }) =>
      HttpResponse.json(runs.find((run) => run.id === params.id) ?? runs[1]!)
   ),
   http.get('*/api/v1/boards/:id/runs', () => HttpResponse.json(page(runs))),
   http.post('*/api/v1/runs/:id/cancel', ({ params }) =>
      HttpResponse.json({
         ...(runs.find((run) => run.id === params.id) ?? runs[0]!),
         status: 'cancelled',
         completedAt: '2026-09-18T12:00:00Z',
      })
   ),

   // autopilots
   http.get('*/api/v1/autopilots/cron-preview', () => HttpResponse.json({ times: cronPreview })),
   http.get('*/api/v1/autopilots/:id/runs', () => HttpResponse.json({ nodes: autopilotRuns })),
   http.get('*/api/v1/autopilots/:id/deliveries/:deliveryId', ({ params }) =>
      HttpResponse.json({
         ...(deliveries.find((entry) => entry.id === params.deliveryId) ?? deliveries[0]!),
         payload: {
            action: 'opened',
            issue: { number: 118, title: 'Goals list has no empty state' },
         },
      })
   ),
   http.get('*/api/v1/autopilots/:id/deliveries', () => HttpResponse.json({ nodes: deliveries })),
   http.get('*/api/v1/autopilots/:id', () => HttpResponse.json(autopilotDetail)),
   http.post('*/api/v1/autopilots/:id/run', () =>
      HttpResponse.json({
         autopilotRunId: 'apr-7',
         status: 'enqueued',
         reasonCode: null,
         runId: 'run-new',
         issueId: 'issue-45',
      })
   ),
   http.patch('*/api/v1/autopilots/:id', async ({ request }) => {
      const body = (await request.json()) as Partial<Autopilot>;
      return HttpResponse.json({ ...autopilots[0]!, ...body });
   }),
];
