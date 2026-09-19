import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';
import type { IssueUsage, UsageBucket } from '@/lib/usage';
import { IssueUsageDialog } from './issue-usage-dialog';
import { failedRun, runningRun, seedIssuesWorkspace } from '../stories-fixtures';

const bucket = (key: string, overrides: Partial<UsageBucket> = {}): UsageBucket => ({
   key,
   events: 14,
   unpricedEvents: 0,
   inputTokens: 18_400,
   outputTokens: 2_150,
   cacheReadTokens: 42_000,
   cacheWriteTokens: 6_100,
   costMicros: 41_300,
   ...overrides,
});

const usage: IssueUsage = {
   currency: 'USD',
   totals: bucket('total', {
      events: 31,
      inputTokens: 40_200,
      outputTokens: 5_900,
      cacheReadTokens: 96_000,
      cacheWriteTokens: 11_300,
      costMicros: 118_700,
   }),
   byRun: [
      bucket(failedRun.id),
      bucket(runningRun.id, {
         inputTokens: 21_800,
         outputTokens: 3_750,
         cacheReadTokens: 54_000,
         cacheWriteTokens: 5_200,
         costMicros: 77_400,
      }),
   ],
   byModel: [bucket('us.anthropic.claude-haiku-4-5-20251001-v1:0')],
};

const meta = {
   component: IssueUsageDialog,
   tags: ['ai-generated', 'needs-work'],
   args: { usage, runs: [runningRun, failedRun], open: true, onOpenChange: fn() },
   beforeEach: () => {
      seedIssuesWorkspace();
   },
} satisfies Meta<typeof IssueUsageDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TwoRuns: Story = {
   play: async ({ canvasElement }) => {
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText('What this task has cost')).toBeVisible();
      // Runs are numbered in the order they started, whatever order they arrive in.
      const table = within(body.getByRole('table'));
      await expect(table.getByText('#1')).toBeInTheDocument();
      await expect(table.getByText('#2')).toBeInTheDocument();
   },
};

export const PartlyUnpriced: Story = {
   args: { usage: { ...usage, totals: { ...usage.totals, unpricedEvents: 3 } } },
   play: async ({ canvasElement }) => {
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText('Some usage has no price yet.')).toBeVisible();
   },
};

export const NoUsageYet: Story = {
   args: {
      usage: {
         currency: 'USD',
         totals: bucket('total', {
            events: 0,
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            costMicros: 0,
         }),
         byRun: [],
         byModel: [],
      },
      runs: [],
   },
   play: async ({ canvasElement }) => {
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText('No model usage yet.')).toBeVisible();
   },
};

export const CloseButton: Story = {
   play: async ({ args, canvasElement, userEvent }) => {
      const body = within(canvasElement.ownerDocument.body);
      // The footer button and the dialog's own corner close both answer to "Close".
      const [footerClose] = await body.findAllByRole('button', { name: 'Close' });
      await userEvent.click(footerClose!);
      await expect(args.onOpenChange).toHaveBeenCalledWith(false);
   },
};
