import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect } from 'storybook/test';
import { useSessionStore } from '@/store/session-store';
import { reviewHandlers, reviewSession } from './review-fixtures';
import Reviews from './reviews';

const meta = {
   component: Reviews,
   tags: ['ai-generated', 'needs-work'],
   parameters: {
      layout: 'fullscreen',
      nextjs: { navigation: { pathname: '/berry/reviews', segments: [['orgId', 'berry']] } },
   },
   beforeEach: ({ msw }) => {
      useSessionStore.setState(reviewSession);
      msw.use(...reviewHandlers);
   },
   decorators: [
      (Story) => (
         <div className="h-[760px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof Reviews>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Runs that delivered nothing sit apart, above the real deliveries. Selecting
 * a row is not exercised here: it writes the address with `history.pushState`,
 * which would move the test runner's own page.
 */
export const Waiting: Story = {
   play: async ({ canvas, userEvent }) => {
      const needsHelp = await canvas.findByRole('button', { name: /Needs help/ });
      await expect(canvas.getByRole('button', { name: /Waiting for a decision/ })).toBeVisible();
      await expect(canvas.getByText('3 waiting · 1 needs help')).toBeVisible();
      // The group header really folds its rows.
      await userEvent.click(needsHelp);
      await expect(needsHelp).toHaveAttribute('aria-expanded', 'false');
   },
};

export const Decided: Story = { args: { listTab: 'created' } };

/** Deep-linked to one review's diff. */
export const SelectedDiff: Story = {
   args: { selectedReviewId: 'issue-101', section: 'diff' },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('061_project_health.sql')).toBeVisible();
      await expect(await canvas.findByRole('link', { current: true })).toHaveTextContent(
         'BERR-101'
      );
   },
};

export const AllCaughtUp: Story = {
   beforeEach: ({ msw }) => {
      msw.use(http.get('*/api/v1/reviews', () => HttpResponse.json({ nodes: [] })));
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByRole('heading', { name: 'All caught up' })).toBeVisible();
   },
};
