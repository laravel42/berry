/**
 * Story fixtures for the plan components: a BerryPlan v1 record at each point
 * of its life, modelled on what `GET /api/v1/plans/{id}` returns.
 */
import { Box, Globe } from 'lucide-react';
import { priorities } from '@/data/priorities';
import { health, type Project } from '@/data/projects';
import { status } from '@/data/status';
import type { User } from '@/data/users';
import type { Agent } from '@/lib/agents';
import type { Plan, PlanRecord } from '@/lib/plans';

export const planAgents: Agent[] = [
   {
      id: 'agent-backend',
      name: 'Backend Engineer',
      description: 'Owns server-ts: schema, migrations, repositories and routes.',
      avatarUrl: null,
      status: 'idle',
      capabilities: ['code', 'postgres'],
      permissions: [],
      labels: [],
      envNames: [],
      conversationStarters: [],
      customized: false,
      createdAt: '2026-08-01T09:00:00Z',
      updatedAt: '2026-09-10T09:00:00Z',
   },
   {
      id: 'agent-frontend',
      name: 'Frontend Engineer',
      description: 'Owns the Next.js app and its design system.',
      avatarUrl: null,
      status: 'idle',
      capabilities: ['code', 'react'],
      permissions: [],
      labels: [],
      envNames: [],
      conversationStarters: [],
      customized: false,
      createdAt: '2026-08-01T09:00:00Z',
      updatedAt: '2026-09-10T09:00:00Z',
   },
];

export const planMembers: User[] = [
   {
      id: 'user-andrea',
      name: 'Andrea Lunelio',
      avatarUrl: '',
      email: 'andrea@example.com',
      status: 'online',
      role: 'Admin',
      joinedDate: '2026-01-04',
      teamIds: [],
      timezone: 'Europe/Rome',
   },
];

export const healthPlan: Plan = {
   goal: {
      tempId: 'goal-1',
      title: 'Persist project health and weekly updates',
      description:
         'Project health lives only in the browser today. Store it on the server, record who set it and when, and let a lead post a short weekly update beside it.',
      projectId: 'project-berry',
   },
   milestones: [
      {
         tempId: 'm-1',
         title: 'Health is stored on the server',
         description: 'A column, a migration and a route; the chip reads from the API.',
      },
      {
         tempId: 'm-2',
         title: 'Leads can post weekly updates',
         description: null,
      },
   ],
   assumptions: [
      {
         id: 'a-1',
         description: 'Existing browser-only health values can be discarded rather than migrated.',
         confidence: 'medium',
         userEditable: true,
         blocking: false,
         options: [],
      },
      {
         id: 'a-2',
         description: 'Only project leads and admins may change health.',
         confidence: 'high',
         userEditable: true,
         blocking: false,
         options: [],
      },
      {
         id: 'a-3',
         description: 'Updates are plain text, not Markdown.',
         confidence: 'low',
         userEditable: true,
         blocking: false,
         options: [],
      },
   ],
   requiredConnections: [
      { provider: 'github', purpose: 'Open pull requests against berry', connected: true },
   ],
   issues: [
      {
         tempId: 'i-1',
         title: 'Add project_health column and migration',
         description: 'Forward-only migration 061; default to no-update.',
         type: 'issue',
         suggestedAgentId: 'agent-backend',
         requiredCapabilities: ['postgres'],
         priority: 'high',
         dependsOn: [],
         requiresReview: true,
         requiresApproval: false,
         expectedArtifacts: ['migration'],
         estimate: '2h',
         milestone: 'm-1',
      },
      {
         tempId: 'i-2',
         title: 'Expose PATCH /api/v1/projects/{id}/health',
         description: null,
         type: 'issue',
         suggestedAgentId: 'agent-backend',
         requiredCapabilities: ['code'],
         priority: 'medium',
         dependsOn: ['i-1'],
         requiresReview: true,
         requiresApproval: true,
         expectedArtifacts: [],
         estimate: '3h',
         milestone: 'm-1',
      },
      {
         tempId: 'i-3',
         title: 'Read the health chip from the API',
         description: 'Drop the localStorage fallback.',
         type: 'issue',
         suggestedAgentId: 'agent-frontend',
         requiredCapabilities: ['react'],
         priority: 'medium',
         dependsOn: ['i-2'],
         requiresReview: true,
         requiresApproval: false,
         expectedArtifacts: [],
         estimate: null,
         milestone: 'm-1',
      },
      {
         tempId: 'i-4',
         title: 'Weekly update composer on the project page',
         description: null,
         type: 'issue',
         suggestedAgentId: null,
         requiredCapabilities: ['react'],
         priority: 'low',
         dependsOn: ['i-3'],
         requiresReview: false,
         requiresApproval: false,
         expectedArtifacts: [],
         estimate: '1d',
         milestone: 'm-2',
      },
   ],
   approvals: [
      {
         tempId: 'ap-1',
         title: 'Approve the new write route',
         description: 'A new mutation on projects needs an admin to agree to its permission check.',
         reason: 'security_review',
         target: { kind: 'issue', tempId: 'i-2', stepId: null },
         approver: { type: 'role', userId: null, role: 'admin' },
         timeout: '72h',
      },
      {
         tempId: 'ap-2',
         title: 'Sign off on the update composer copy',
         description: null,
         reason: 'product_review',
         target: { kind: 'issue', tempId: 'i-4', stepId: null },
         approver: { type: 'user', userId: 'user-andrea', role: null },
         timeout: null,
      },
   ],
   dependencies: [],
   confidence: 0.82,
   compiled: null,
};

const baseRecord: PlanRecord = {
   id: 'plan-1',
   workspaceId: 'ws-1',
   goalId: null,
   projectId: 'project-berry',
   autoGate: false,
   status: 'draft',
   source: 'prompt',
   sourcePrompt:
      'Persist project health to the database and let project leads post a weekly update.',
   irVersion: 'berryplan/v1',
   version: 2,
   plannerVersion: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
   confidence: 0.82,
   generation: { status: 'succeeded', error: null, stage: 'finalize' },
   validation: {
      status: 'valid',
      errors: [],
      warnings: [],
      requiredConnections: [],
      ambiguities: [],
      risk: 'medium',
      needsAdminActivation: false,
   },
   critic: { verdict: 'accept', problems: [] },
   compile: null,
   plan: healthPlan,
   createdAt: '2026-09-18T11:40:00Z',
   updatedAt: '2026-09-18T11:42:00Z',
};

/** Ready to start: valid, one warning, a critic note. */
export const readyPlan: PlanRecord = {
   ...baseRecord,
   validation: {
      ...baseRecord.validation,
      warnings: [
         {
            path: '/issues/3',
            code: 'NO_AGENT',
            message: 'No agent is suggested for this task.',
            severity: 'warning',
            hint: 'It will be routed by capability when the plan starts.',
         },
      ],
   },
};

export const generatingPlan: PlanRecord = {
   ...baseRecord,
   id: 'plan-generating',
   version: 0,
   confidence: null,
   plan: null,
   generation: { status: 'running', error: null, stage: 'validate' },
   validation: { ...baseRecord.validation, status: 'unknown' },
   critic: null,
};

export const failedPlan: PlanRecord = {
   ...baseRecord,
   id: 'plan-failed',
   plan: null,
   confidence: null,
   generation: { status: 'failed', error: 'timeout at generate', stage: 'generate' },
   validation: { ...baseRecord.validation, status: 'unknown' },
   critic: null,
};

export const invalidPlan: PlanRecord = {
   ...baseRecord,
   id: 'plan-invalid',
   validation: {
      ...baseRecord.validation,
      status: 'invalid',
      errors: [
         {
            path: '/issues/1/dependsOn',
            code: 'DEPENDENCY_CYCLE',
            message: 'Tasks depend on each other in a loop.',
            severity: 'error',
            hint: 'Remove one of the dependencies between the route and the chip.',
         },
      ],
      requiredConnections: [
         { provider: 'github', purpose: 'Open pull requests', connected: true },
         { provider: 'slack', purpose: 'Post the weekly update to #berry', connected: false },
      ],
   },
   critic: {
      verdict: 'revise',
      problems: [
         {
            code: 'VAGUE_TASK',
            path: '/issues/3',
            message: 'The composer task does not say where updates are shown.',
            severity: 'warning',
         },
      ],
   },
};

export const blockedPlan: PlanRecord = {
   ...baseRecord,
   id: 'plan-blocked',
   version: 1,
   plan: {
      ...healthPlan,
      milestones: [],
      issues: [],
      approvals: [],
      assumptions: [
         {
            id: 'q-1',
            description: 'Who may change a project’s health?',
            confidence: 'low',
            userEditable: true,
            blocking: true,
            options: [
               { id: 'lead', label: 'The project lead only', detail: 'Admins can still override.' },
               { id: 'members', label: 'Any workspace member', detail: null },
            ],
         },
         {
            id: 'q-2',
            description: 'Should old browser-only values be imported?',
            confidence: 'medium',
            userEditable: true,
            blocking: false,
            options: [],
         },
      ],
   },
   validation: {
      ...baseRecord.validation,
      status: 'blocked',
      ambiguities: [{ id: 'q-1', question: 'Who may change a project’s health?', blocking: true }],
      errors: [
         {
            path: '/assumptions/0',
            code: 'AMBIGUITY_BLOCKING',
            message: 'A blocking question is unanswered.',
         },
      ],
   },
};

export const pendingApprovalPlan: PlanRecord = {
   ...baseRecord,
   id: 'plan-pending',
   status: 'pendingApproval',
   validation: { ...baseRecord.validation, risk: 'high' },
};

export const startedPlan: PlanRecord = {
   ...baseRecord,
   id: 'plan-started',
   status: 'approved',
   compile: {
      status: 'succeeded',
      error: null,
      compiledAt: '2026-09-18T11:50:00Z',
      goalId: 'goal-77',
      goalIds: ['goal-77', 'goal-78'],
      issueIds: ['issue-101', 'issue-102', 'issue-103', 'issue-104'],
      approvalIds: ['appr-11', 'appr-12'],
   },
};

export const compileFailedPlan: PlanRecord = {
   ...baseRecord,
   id: 'plan-compile-failed',
   status: 'approved',
   compile: {
      status: 'failed',
      error: 'The board berry-main no longer exists.',
      compiledAt: null,
      goalId: null,
      goalIds: [],
      issueIds: [],
      approvalIds: [],
   },
};

export const planProjects: Project[] = [
   {
      id: 'project-berry',
      name: 'Berry core',
      status: status.find((entry) => entry.id === 'in-progress') ?? status[0]!,
      icon: Box,
      percentComplete: 42,
      startDate: '2026-08-01',
      targetDate: '2026-10-15',
      lead: planMembers[0]!,
      priority: priorities.find((entry) => entry.id === 'high') ?? priorities[0]!,
      health: health.find((entry) => entry.id === 'on-track') ?? health[0]!,
      teamId: 'team-core',
      createdAt: '2026-08-01T09:00:00Z',
      updatedAt: '2026-09-17T16:00:00Z',
   },
   {
      id: 'project-site',
      name: 'Marketing site',
      status: status.find((entry) => entry.id === 'to-do') ?? status[0]!,
      icon: Globe,
      percentComplete: 0,
      startDate: '2026-09-01',
      lead: planMembers[0]!,
      priority: priorities.find((entry) => entry.id === 'low') ?? priorities[0]!,
      health: health[0]!,
      teamId: 'team-core',
      createdAt: '2026-09-01T09:00:00Z',
      updatedAt: '2026-09-12T10:00:00Z',
   },
];

/** A signed-in admin in workspace ws-1, as bootstrap leaves the session store. */
export const readySession = {
   status: 'ready' as const,
   user: planMembers[0]!,
   workspace: { id: 'ws-1', name: 'Berry', slug: 'berry', role: 'admin' },
   workspaces: [{ id: 'ws-1', name: 'Berry', slug: 'berry', role: 'admin' }],
   boardId: 'board-1',
   error: null,
};
