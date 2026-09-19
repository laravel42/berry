import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect } from 'storybook/test';
import { ReviewDiff } from './review-diff';
import { deliveredReview, reviewHandlers, stoppedReview } from './review-fixtures';

const meta = {
   component: ReviewDiff,
   tags: ['ai-generated', 'needs-work'],
   args: { item: deliveredReview },
   beforeEach: ({ msw }) => {
      msw.use(...reviewHandlers);
   },
   decorators: [
      (Story) => (
         <div className="h-[640px] w-[800px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof ReviewDiff>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The diff arrives from the server as text and is split per file; the filter narrows by path. */
export const FilterFiles: Story = {
   play: async ({ canvas, userEvent }) => {
      await expect(await canvas.findByText('061_project_health.sql')).toBeVisible();
      await expect(canvas.getByText('projects.ts')).toBeVisible();
      await userEvent.type(canvas.getByRole('textbox', { name: 'Filter files' }), 'migrations');
      await expect(canvas.queryByText('projects.ts')).toBeNull();
   },
};

export const LoadFailed: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/reviews/:runId/diff', () =>
            HttpResponse.json(
               {
                  error: {
                     code: 'GITHUB_UNAVAILABLE',
                     message: 'GitHub did not answer',
                     requestId: 'req-4',
                  },
               },
               { status: 502 }
            )
         )
      );
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByRole('alert')).toHaveTextContent('GitHub did not answer');
   },
};

export const NoPullRequest: Story = { args: { item: stoppedReview } };
