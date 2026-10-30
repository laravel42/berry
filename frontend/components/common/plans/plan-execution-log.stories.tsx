import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect } from 'storybook/test';
import { agentToUser } from '@/lib/agents';
import type { Issue } from '@/data/issues';
import { priorities } from '@/data/priorities';
import { status as statuses } from '@/data/status';
import type { PlanEvent, PlanRecord } from '@/lib/plans';
import type { RunRecord } from '@/lib/runs';
import { frontendAgent } from '@/components/common/agents/stories-fixtures';
import { useAgentsStore } from '@/store/agents-store';
import { useIssuesStore } from '@/store/issues-store';
import { PlanExecutionLog } from './plan-execution-log';

const statusById = (id: string) => statuses.find((entry) => entry.id === id)!;
const priorityById = (id: string) => priorities.find((entry) => entry.id === id)!;

function issue(id: string, identifier: string, statusId: string): Issue {
   return {
      id,
      identifier,
      title: 'Add health column and migration',
      description: '',
      status: statusById(statusId),
      assignee: agentToUser(frontendAgent),
      priority: priorityById('high'),
      labels: [],
      createdAt: '2026-09-18T11:30:00Z',
      cycleId: '',
      rank: 'a1',
      sortOrder: 0,
   };
}

function record(overrides: Partial<PlanRecord> = {}): PlanRecord {
   return {
      id: 'plan-1',
      workspaceId: 'ws-1',
      goalId: null,
      projectId: 'proj-health',
      autoGate: false,
      status: 'approved',
      source: 'prompt',
      sourcePrompt: null,
      irVersion: null,
      version: 1,
      plannerVersion: null,
      confidence: null,
      generation: { status: 'succeeded', error: null, stage: 'finalize' },
      validation: {
         status: 'valid',
         errors: [],
         warnings: [],
         requiredConnections: [],
         ambiguities: [],
         risk: 'low',
         needsAdminActivation: false,
      },
      critic: null,
      compile: {
         status: 'succeeded',
         error: null,
         compiledAt: '2026-09-18T11:38:00Z',
         goalId: null,
         goalIds: [],
         issueIds: [],
         approvalIds: [],
      },
      plan: null,
      routing: null,
      createdAt: '2026-09-18T11:30:00Z',
      updatedAt: '2026-09-18T11:38:00Z',
      ...overrides,
   };
}

function run(id: string, issueId: string, overrides: Partial<RunRecord> = {}): RunRecord {
   return {
      id,
      issueId,
      agentId: frontendAgent.id,
      status: 'running',
      kind: 'agent',
      purpose: null,
      sequence: 1,
      summary: null,
      usage: {
         inputTokens: 1_000,
         outputTokens: 200,
         totalTokens: 1_200,
         costMicros: 4_000,
         currency: 'USD',
      },
      failure: null,
      source: 'assignment',
      requestedBy: null,
      createdAt: '2026-09-18T11:40:00Z',
      startedAt: '2026-09-18T11:40:05Z',
      completedAt: null,
      ...overrides,
   };
}

function seedStores() {
   useIssuesStore.getState().hydrateIssues([issue('issue-41', 'BERR-41', 'in-progress')]);
   useAgentsStore.getState().hydrateAgents([frontendAgent]);
}

const runsHandler = (runs: RunRecord[]) =>
   http.get('*/api/v1/issues/:id/runs', ({ params }) =>
      HttpResponse.json({
         nodes: runs.filter((entry) => entry.issueId === params.id),
         pageInfo: { hasNextPage: false, endCursor: null },
      })
   );

const eventsHandler = (events: PlanEvent[]) =>
   http.get('*/api/v1/plans/:id/events', () => HttpResponse.json({ nodes: events }));

const meta = {
   component: PlanExecutionLog,
   tags: ['ai-generated'],
   args: { record: record({ compile: { ...record().compile!, issueIds: ['issue-41'] } }) },
   beforeEach: ({ msw }) => {
      seedStores();
      msw.use(runsHandler([]), eventsHandler([]));
   },
} satisfies Meta<typeof PlanExecutionLog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A plan just started: the one line it logs for itself, nothing from a run yet. */
export const PlanJustStarted: Story = {
   play: async ({ canvas }) => {
      await expect(
         await canvas.findByText(/Plan started · 1 task · 0 approvals created/)
      ).toBeVisible();
      await expect(canvas.getByText('Plan started')).toBeVisible();
   },
};

/** A task running: the log pulses and names the agent and the live status. */
export const FollowingALiveRun: Story = {
   beforeEach: ({ msw }) => {
      msw.use(runsHandler([run('run-1', 'issue-41', { status: 'running' })]));
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText(/Frontend Engineer · running/)).toBeVisible();
      await expect(canvas.getByText(/following the work/)).toBeVisible();
   },
};

/** Every run on the plan finished: the log says so and stops pulsing. */
export const EveryRunFinished: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         runsHandler([
            run('run-1', 'issue-41', {
               status: 'succeeded',
               summary: 'Added the health column.',
               completedAt: '2026-09-18T11:50:00Z',
            }),
         ])
      );
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText(/Frontend Engineer · succeeded/)).toBeVisible();
      await expect(canvas.getByText(/all runs finished/)).toBeVisible();
   },
};

/** Routing a plan's tasks is logged too, before any run exists. */
export const RoutingEvent: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         eventsHandler([
            {
               id: 'evt-1',
               sequence: 1,
               stage: 'execute',
               role: null,
               promptVersion: null,
               modelProvider: null,
               modelName: null,
               inputTokens: null,
               outputTokens: null,
               costMicros: null,
               durationMs: null,
               outcome: 'ok',
               detail: { assigned: 1, started: 1 },
               occurredAt: '2026-09-18T11:39:00Z',
            },
         ])
      );
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText(/Routed · 1 assigned · 1 started/)).toBeVisible();
   },
};
