import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { ReviewVerdicts } from './review-guide';
import { deliveredReview } from './review-fixtures';

const meta = {
   component: ReviewVerdicts,
   tags: ['ai-generated', 'needs-work'],
   args: { item: deliveredReview },
   decorators: [
      (Story) => (
         <div className="h-[520px] w-[720px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof ReviewVerdicts>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Newest first: the approval on attempt 2 above the send-back on attempt 1. */
export const TwoAttempts: Story = {
   play: async ({ canvas }) => {
      const items = canvas
         .getAllByRole('listitem')
         .filter((item) => item.textContent?.includes('attempt'));
      await expect(items[0]).toHaveTextContent('Peer approved');
      await expect(items[1]).toHaveTextContent('Peer sent back');
   },
};

export const NoVerdictYet: Story = {
   args: { item: { ...deliveredReview, verdicts: [] } },
};

export const NotOptedIn: Story = {
   args: {
      item: {
         ...deliveredReview,
         verdicts: [],
         issue: { ...deliveredReview.issue, autoGate: false },
      },
   },
};
