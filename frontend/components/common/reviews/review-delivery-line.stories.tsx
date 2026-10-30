import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn } from 'storybook/test';

import { ReviewDeliveryLine } from './review-delivery-line';
import {
   approvedReview,
   deliveredReview,
   producedFilesReview,
   reviewHandlers,
   stoppedReview,
} from './review-fixtures';

const meta = {
   component: ReviewDeliveryLine,
   tags: ['ai-generated'],
   args: { item: deliveredReview, onDecided: fn() },
   beforeEach: ({ msw }) => {
      msw.use(...reviewHandlers);
   },
} satisfies Meta<typeof ReviewDeliveryLine>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A delivered pull request, named with a link, plus the decision bar while it waits. */
export const DeliveredPullRequest: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('link', { name: 'PR #412' })).toHaveAttribute(
         'href',
         'https://github.com/berry/berry/pull/412'
      );
      await expect(canvas.getByText('Backend Engineer').closest('p')).toHaveTextContent(
         'Backend Engineer delivered PR #412'
      );
      await expect(canvas.getByRole('button', { name: 'Approve' })).toBeVisible();
   },
};

/** Stopped without delivering: Reject leads, since there is nothing to approve. */
export const StoppedWithoutDelivering: Story = {
   args: { item: stoppedReview },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('Frontend Engineer').closest('p')).toHaveTextContent(
         'Frontend Engineer stopped without delivering.'
      );
      await expect(canvas.getByRole('button', { name: 'Reject' })).toBeVisible();
   },
};

/** Files produced and attached, nothing committed: still a delivery to decide on. */
export const ProducedFilesWithoutACommit: Story = {
   args: { item: producedFilesReview },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('Product Designer').closest('p')).toHaveTextContent(
         'Product Designer delivered 2 files without a commit.'
      );
   },
};

/** Committed but opened no pull request: the headline names the commit, not a PR. */
export const CommittedWithNoPullRequest: Story = {
   args: { item: { ...deliveredReview, pullRequest: null } },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('Backend Engineer').closest('p')).toHaveTextContent(
         'Backend Engineer committed changes but opened no pull request.'
      );
   },
};

/** A verifying run that found nothing to change: the report is the deliverable. */
export const ReportedNothingChanged: Story = {
   args: { item: { ...stoppedReview, run: { ...stoppedReview.run, reports: true } } },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('Frontend Engineer').closest('p')).toHaveTextContent(
         'Frontend Engineer finished with a report and changed nothing.'
      );
   },
};

/** Already decided: the headline stays, but the decision bar is gone. */
export const AlreadyDecidedHasNoDecisionBar: Story = {
   args: { item: approvedReview },
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('link', { name: 'PR #412' })).toBeVisible();
      await expect(canvas.queryByRole('button', { name: 'Approve' })).toBeNull();
   },
};
