import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, waitFor } from 'storybook/test';
import { orgParams } from '@/components/common/agents/stories-fixtures';
import { seedProjectStores } from '@/components/common/projects/stories-fixtures';
import type { WorkspaceUsage, WorkspaceWork } from '@/lib/usage';
import UsageSpend from './usage-spend';

const windowFields = {
   currency: 'USD' as const,
   days: 7,
   from: '2026-09-11T00:00:00Z',
   to: '2026-09-18T00:00:00Z',
   timezone: 'UTC',
   boardId: null,
   projectId: null,
};

const bucket = (overrides: Partial<WorkspaceUsage['totals']> = {}) => ({
   key: 'total',
   events: 0,
   unpricedEvents: 0,
   inputTokens: 0,
   outputTokens: 0,
   cacheReadTokens: 0,
   cacheWriteTokens: 0,
   costMicros: 0,
   ...overrides,
});

const usage: WorkspaceUsage = {
   ...windowFields,
   totals: bucket({
      events: 420,
      inputTokens: 2_400_000,
      outputTokens: 180_000,
      cacheReadTokens: 900_000,
      cacheWriteTokens: 120_000,
      costMicros: 8_240_000,
   }),
   daily: [],
   byAgent: [
      {
         ...bucket({ key: 'agent-frontend', costMicros: 5_200_000 }),
         agentName: 'Frontend Engineer',
      },
      { ...bucket({ key: 'agent-backend', costMicros: 3_040_000 }), agentName: 'Backend Engineer' },
   ],
   byModel: [
      { ...bucket({ key: 'anthropic.claude-sonnet-5', costMicros: 6_000_000 }) },
      { ...bucket({ key: 'anthropic.claude-haiku-4-5', costMicros: 2_240_000 }) },
   ],
   runs: { runs: 42, failed: 2, runSeconds: 18_400 },
   series: {
      grain: 'day',
      points: [
         { key: '2026-09-16', costMicros: 2_800_000, tokens: 400_000, events: 140, runs: 14 },
         { key: '2026-09-17', costMicros: 3_100_000, tokens: 420_000, events: 150, runs: 16 },
         { key: '2026-09-18', costMicros: 2_340_000, tokens: 380_000, events: 130, runs: 12 },
      ],
   },
   topIssues: [
      {
         issueId: 'issue-42',
         identifier: 'BERR-42',
         title: 'Add health column and migration',
         costMicros: 1_800_000,
         runs: 5,
      },
   ],
};

const work: WorkspaceWork = {
   ...windowFields,
   tasksDone: 18,
   pullRequests: 14,
   commits: 22,
   runs: 42,
   runSeconds: 18_400,
   series: { grain: 'day', points: [] },
   byAgent: [
      {
         agentId: 'agent-frontend',
         agentName: 'Frontend Engineer',
         tasksDone: 11,
         runs: 24,
         runSeconds: 10_000,
      },
      {
         agentId: 'agent-backend',
         agentName: 'Backend Engineer',
         tasksDone: 7,
         runs: 18,
         runSeconds: 8_400,
      },
   ],
   duration: { median: 420, p90: 1_800, min: 60, max: 3_600 },
   attention: { stepLimit: 0, deliveryFailed: 0 },
   firstPass: { oneRun: 12, total: 18 },
   waiting: { reviews: 0, decisions: 0, oldestAt: null },
};

const meta = {
   component: UsageSpend,
   tags: ['ai-generated', 'needs-work'],
   args: { query: { days: 7 } },
   parameters: orgParams,
   decorators: [
      (Story) => (
         <div className="w-[960px]">
            <Story />
         </div>
      ),
   ],
   beforeEach: ({ msw }) => {
      seedProjectStores({ sessionReady: true });
      msw.use(
         http.get('*/api/v1/config', () =>
            HttpResponse.json({ capabilities: { modelGateway: false } })
         ),
         http.get('*/api/v1/usage/:workspaceId/summary', () => HttpResponse.json(usage)),
         http.get('*/api/v1/usage/:workspaceId/work', () => HttpResponse.json(work))
      );
   },
} satisfies Meta<typeof UsageSpend>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The hero figure, the series, and every supporting panel with real numbers. */
export const PopulatedWindow: Story = {
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('$8.24')).toBeVisible();
      await expect(canvas.getByText('Who spent it')).toBeVisible();
      await expect(canvas.getAllByText('Frontend Engineer').length).toBeGreaterThan(0);
      await expect(canvas.getByText('Most expensive tasks')).toBeVisible();
      await expect(canvas.getByText('BERR-42')).toBeVisible();
   },
};

/** Nothing happened in the window: the page says so in one sentence. */
export const EmptyWindow: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/usage/:workspaceId/summary', () =>
            HttpResponse.json({
               ...usage,
               totals: bucket(),
               byAgent: [],
               byModel: [],
               topIssues: [],
            })
         ),
         http.get('*/api/v1/usage/:workspaceId/work', () =>
            HttpResponse.json({ ...work, runs: 0, tasksDone: 0 })
         )
      );
   },
   play: async ({ canvas }) => {
      await expect(
         await canvas.findByText('Nothing ran in the last 7 days, so nothing was spent.')
      ).toBeVisible();
   },
};

/** The summary read failed: the page says so instead of a blank chart grid. */
export const FailedToLoad: Story = {
   beforeEach: ({ msw }) => {
      msw.use(http.get('*/api/v1/usage/:workspaceId/summary', () => HttpResponse.error()));
   },
   play: async ({ canvasElement }) => {
      await waitFor(() =>
         expect(canvasElement.querySelector('p.text-muted-foreground')).not.toBeNull()
      );
   },
};
