import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect } from 'storybook/test';
import { ReviewOverview } from './review-overview';
import {
   deliveredReview,
   producedFilesReview,
   reviewHandlers,
   stoppedReview,
} from './review-fixtures';

const meta = {
   component: ReviewOverview,
   tags: ['ai-generated', 'needs-work'],
   args: { item: deliveredReview },
   parameters: { nextjs: { navigation: { segments: [['orgId', 'berry']] } } },
   beforeEach: ({ msw }) => {
      msw.use(...reviewHandlers);
   },
   decorators: [
      (Story) => (
         <div className="h-[760px] w-[800px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof ReviewOverview>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A pull request with green checks; the run's own "## Summary" heading is not printed twice. */
export const DeliveredPullRequest: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/issues/:ref/artifacts', () => HttpResponse.json({ artifacts: [] }))
      );
   },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('2 checks passed')).toBeVisible();
      await expect(canvas.getAllByRole('heading', { name: 'Summary' })).toHaveLength(1);
   },
};

export const StoppedWithoutDelivering: Story = {
   args: { item: stoppedReview },
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/issues/:ref/artifacts', () => HttpResponse.json({ artifacts: [] }))
      );
   },
};

/** Files attached without a commit, and a check budget that ran out. */
export const ProducedFiles: Story = {
   args: { item: producedFilesReview },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('2 of 2 checks failed')).toBeVisible();
      await expect(
         canvas.getByText('The remaining checks did not run: the verification budget was spent.')
      ).toBeVisible();
   },
};
