import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, within } from 'storybook/test';

import { useIssueRunsStore } from '@/store/issue-runs-store';

import { IssueUsageSection } from './issue-usage-section';
import {
   bucket,
   errorEnvelope,
   issueUsage,
   seedAdminSession,
   usageHandlers,
} from './stories-fixtures';

/** Two finished runs on BERR-42, as `GET /api/v1/issues/{id}/runs` returns them. */
const runs = [
   {
      id: 'run-201',
      issueId: 'issue-42',
      agentId: 'agent-eng',
      status: 'succeeded',
      sequence: 1,
      summary: 'Added the health column and migration.',
      usage: {
         inputTokens: 202_400,
         outputTokens: 24_750,
         totalTokens: 227_150,
         costMicros: 1_562_000,
         currency: 'USD',
      },
      failure: null,
      source: 'assignment',
      requestedBy: { type: 'user', id: 'user-1' },
      createdAt: '2026-09-17T14:02:00Z',
      startedAt: '2026-09-17T14:02:05Z',
      completedAt: '2026-09-17T14:19:40Z',
   },
   {
      id: 'run-202',
      issueId: 'issue-42',
      agentId: 'agent-rev',
      status: 'succeeded',
      sequence: 2,
      summary: 'Reviewed the migration; requested one rename.',
      usage: {
         inputTokens: 147_200,
         outputTokens: 18_000,
         totalTokens: 165_200,
         costMicros: 1_136_000,
         currency: 'USD',
      },
      failure: null,
      source: 'mention',
      requestedBy: { type: 'agent', id: 'agent-eng' },
      createdAt: '2026-09-17T15:10:00Z',
      startedAt: '2026-09-17T15:10:03Z',
      completedAt: '2026-09-17T15:16:21Z',
   },
];

const meta = {
   component: IssueUsageSection,
   tags: ['ai-generated', 'needs-work'],
   args: { issueId: 'issue-42' },
   beforeEach: ({ msw }) => {
      seedAdminSession();
      useIssueRunsStore.setState({ byIssue: {}, loading: {} });
      msw.use(
         ...usageHandlers,
         http.get('*/api/v1/issues/:issueId/runs', () =>
            HttpResponse.json({ nodes: runs, pageInfo: { hasNextPage: false, endCursor: null } })
         )
      );
   },
   decorators: [
      (Story) => (
         <div className="w-[280px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof IssueUsageSection>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The sidebar summary; the breakdown opens in a dialog (portal). */
export const WithUsage: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(await canvas.findByRole('button', { name: 'See the breakdown' }));
      const body = within(canvasElement.ownerDocument.body);
      await expect(
         await body.findByRole('dialog', { name: 'What this task has cost' })
      ).toBeVisible();
   },
};

/** An unpriced model marks the cost with an asterisk. */
export const PartlyUnpriced: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/usage/:workspaceId/issues/:issueId', () =>
            HttpResponse.json({
               ...issueUsage,
               totals: { ...issueUsage.totals, unpricedEvents: 2 },
            })
         )
      );
   },
};

export const NoUsageYet: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/usage/:workspaceId/issues/:issueId', () =>
            HttpResponse.json({
               currency: 'USD',
               totals: bucket('total', 0),
               byRun: [],
               byModel: [],
            })
         )
      );
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('No model usage yet.')).toBeVisible();
   },
};

/** A failed read renders nothing at all: cost is context, not the subject of the page. */
export const Failed: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/usage/:workspaceId/issues/:issueId', () =>
            errorEnvelope(500, 'INTERNAL', 'Usage could not be read.')
         )
      );
   },
};
