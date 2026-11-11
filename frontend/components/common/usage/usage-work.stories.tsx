import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect } from 'storybook/test';
import { orgParams } from '@/components/common/agents/stories-fixtures';
import { seedProjectStores } from '@/components/common/projects/stories-fixtures';
import type { WorkspaceUsage, WorkspaceWork } from '@/lib/usage';
import UsageWork from './usage-work';

const windowFields = {
   currency: 'USD' as const,
   days: 7,
   from: '2026-09-11T00:00:00Z',
   to: '2026-09-18T00:00:00Z',
   timezone: 'UTC',
   boardId: null,
   projectId: null,
};

const work: WorkspaceWork = {
   ...windowFields,
   tasksDone: 18,
   pullRequests: 14,
   commits: 22,
   runs: 42,
   runSeconds: 18_400,
   series: {
      grain: 'day',
      points: [
         { key: '2026-09-16', tasksDone: 6 },
         { key: '2026-09-17', tasksDone: 7 },
         { key: '2026-09-18', tasksDone: 5 },
      ],
   },
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
   attention: { stepLimit: 2, deliveryFailed: 1 },
   firstPass: { oneRun: 12, total: 18 },
   waiting: { reviews: 0, decisions: 0, oldestAt: null },
};

const usageTotals: WorkspaceUsage = {
   ...windowFields,
   totals: {
      key: 'total',
      events: 420,
      unpricedEvents: 0,
      inputTokens: 2_400_000,
      outputTokens: 180_000,
      cacheReadTokens: 900_000,
      cacheWriteTokens: 120_000,
      costMicros: 8_240_000,
   },
   daily: [],
   byAgent: [],
   byModel: [],
   runs: { runs: 42, failed: 2, runSeconds: 18_400 },
   series: { grain: 'day', points: [] },
   topIssues: [],
};

const meta = {
   component: UsageWork,
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
         http.get('*/api/v1/usage/:workspaceId/work', () => HttpResponse.json(work)),
         http.get('*/api/v1/usage/:workspaceId/summary', () => HttpResponse.json(usageTotals))
      );
   },
} satisfies Meta<typeof UsageWork>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Tasks finished, who finished them, how long a task takes, and the worth-a-look panel. */
export const PopulatedWindow: Story = {
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('18')).toBeVisible();
      await expect(canvas.getByText('Who finished them')).toBeVisible();
      await expect(canvas.getAllByText('Frontend Engineer').length).toBeGreaterThan(0);
      await expect(canvas.getByText('Worth a look')).toBeVisible();
      await expect(canvas.getByText('2 runs used every step it had')).toBeVisible();
   },
};

/** Nothing worth a look: the panel is not drawn, and the hours chart takes the full row. */
export const NothingNeedsAttention: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/usage/:workspaceId/work', () =>
            HttpResponse.json({ ...work, attention: { stepLimit: 0, deliveryFailed: 0 } })
         )
      );
   },
   play: async ({ canvas }) => {
      await canvas.findByText('Who finished them');
      await expect(canvas.queryByText('Worth a look')).toBeNull();
   },
};

/** No task reached done in this window. */
export const EmptyWindow: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/usage/:workspaceId/work', () =>
            HttpResponse.json({ ...work, runs: 0, tasksDone: 0 })
         )
      );
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('Nothing ran in the last 7 days.')).toBeVisible();
   },
};
