import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn } from 'storybook/test';
import { useSessionStore } from '@/store/session-store';
import { ReviewDetail } from './review-detail';
import { reviewHandlers, reviewSession } from './review-fixtures';

const meta = {
   component: ReviewDetail,
   tags: ['ai-generated', 'needs-work'],
   args: { reviewId: 'issue-101', section: 'overview', onBack: fn() },
   parameters: {
      layout: 'fullscreen',
      nextjs: { navigation: { segments: [['orgId', 'berry']] } },
   },
   beforeEach: ({ msw }) => {
      useSessionStore.setState(reviewSession);
      msw.use(...reviewHandlers);
   },
   decorators: [
      (Story) => (
         <div className="h-[760px] max-w-4xl">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof ReviewDetail>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A waiting pull request under AutoGate: overview, verdicts and diff tabs, and the decision bar. */
export const WaitingPullRequest: Story = {
   play: async ({ canvas }) => {
      await expect(
         await canvas.findByRole('heading', { name: 'Persist project health to the database' })
      ).toBeVisible();
      await expect(canvas.getByRole('tab', { name: /Verdicts/ })).toBeVisible();
      await expect(canvas.getByRole('tab', { name: 'Diff' })).toBeVisible();
      await expect(canvas.getByRole('button', { name: 'Approve' })).toBeVisible();
   },
};

/** Opened on the verdicts section by its link. */
export const VerdictsSection: Story = { args: { section: 'guide' } };

/**
 * Opened on the diff by its link. Switching tabs by click is not exercised:
 * it rewrites the address with `history.replaceState`.
 */
export const DiffSection: Story = {
   args: { section: 'diff' },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('061_project_health.sql')).toBeVisible();
      await expect(canvas.getByRole('tab', { name: 'Diff' })).toHaveAttribute(
         'aria-selected',
         'true'
      );
   },
};

/** Nothing delivered: no verdicts or diff tab, Send back leads. */
export const StoppedRun: Story = {
   args: { reviewId: 'issue-102' },
   play: async ({ canvas }) => {
      await canvas.findByRole('heading', { name: 'Move approvals and proposals into the inbox' });
      await expect(canvas.getAllByRole('tab')).toHaveLength(1);
   },
};

/** Already decided: the evidence without a decision bar. */
export const Decided: Story = {
   args: { reviewId: 'issue-090', listTab: 'created' },
   play: async ({ canvas }) => {
      await canvas.findByRole('heading', { name: 'Render run transcript steps in a code editor' });
      await expect(canvas.queryByRole('button', { name: 'Approve' })).toBeNull();
   },
};

export const NotFound: Story = {
   args: { reviewId: 'issue-missing' },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('Review not found')).toBeVisible();
   },
};
