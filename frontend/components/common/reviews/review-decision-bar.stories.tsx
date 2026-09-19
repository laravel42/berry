import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, fn, waitFor, within } from 'storybook/test';
import { ReviewDecisionBar } from './review-decision-bar';
import { deliveredReview, reviewHandlers, stoppedReview } from './review-fixtures';

const meta = {
   component: ReviewDecisionBar,
   tags: ['ai-generated', 'needs-work'],
   args: { item: deliveredReview, onDecided: fn() },
   beforeEach: ({ msw }) => {
      msw.use(...reviewHandlers);
   },
   decorators: [
      (Story) => (
         <div className="w-[720px] border-t border-border/60 bg-container px-4 py-3">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof ReviewDecisionBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A delivery leads with Approve, which asks first and names what "done" means. */
export const ApproveADelivery: Story = {
   play: async ({ args, canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Approve' }));
      const body = within(canvasElement.ownerDocument.body);
      const dialog = within(await body.findByRole('alertdialog', { name: 'Mark BERR-101 done?' }));
      await expect(dialog.getByText(/The pull request stays open on GitHub/)).toBeVisible();
      await userEvent.click(dialog.getByRole('button', { name: 'Mark done' }));
      // PATCH /api/v1/issues/BERR-101 (MSW) moves it to done.
      await waitFor(() =>
         expect(args.onDecided).toHaveBeenCalledWith({
            reviewId: 'issue-101',
            identifier: 'BERR-101',
            decision: 'approve',
         })
      );
   },
};

/** Nothing was delivered, so Send back leads, and it will not go without a note. */
export const SendBackNeedsANote: Story = {
   args: { item: stoppedReview },
   play: async ({ args, canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Send back' }));
      await expect(canvas.getByRole('alert')).toHaveTextContent(
         'Add a note so the agent knows what to change.'
      );
      const note = canvas.getByRole('textbox', { name: 'Note for the author' });
      await expect(note).toHaveFocus();
      await expect(note).toHaveAttribute('aria-invalid', 'true');

      await userEvent.type(note, 'Approvals belong on the inbox page; move them there.');
      await userEvent.click(canvas.getByRole('button', { name: 'Send back' }));
      await waitFor(() =>
         expect(args.onDecided).toHaveBeenCalledWith(
            expect.objectContaining({ decision: 'send-back' })
         )
      );
   },
};

/** The server refuses the transition: the reason shows with a retry. */
export const DecisionFails: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.patch('*/api/v1/issues/:ref', () =>
            HttpResponse.json(
               {
                  error: {
                     code: 'FORBIDDEN',
                     message: 'Only an admin may close this task.',
                     requestId: 'req-5',
                  },
               },
               { status: 403 }
            )
         )
      );
   },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Approve' }));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('button', { name: 'Mark done' }));
      await expect(await canvas.findByRole('button', { name: 'Try again' })).toBeVisible();
   },
};
