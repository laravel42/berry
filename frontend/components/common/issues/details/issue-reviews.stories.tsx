import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect } from 'storybook/test';
import type { AutoReview } from '@/lib/runs';
import { IssueReviews } from './issue-reviews';

const review = (overrides: Partial<AutoReview> = {}): AutoReview => ({
   id: 'review-1',
   runId: 'run-43-1',
   reviewer: 'QA Engineer',
   author: 'Frontend Engineer',
   approved: true,
   inProgress: false,
   reason:
      'The inbox renders approvals and proposals, and the old page redirects with the query kept.',
   attempt: 1,
   startedAt: '2026-09-18T08:22:00Z',
   decidedAt: '2026-09-18T08:24:10Z',
   ...overrides,
});

const answer = (reviews: AutoReview[]) =>
   http.get('*/api/v1/issues/:ref/reviews', () => HttpResponse.json({ reviews }));

const meta = {
   component: IssueReviews,
   tags: ['ai-generated', 'needs-work'],
   args: { issueRef: 'BERR-43' },
   decorators: [
      (Story) => (
         <div className="w-[640px]">
            <Story />
         </div>
      ),
   ],
   beforeEach: ({ msw }) => {
      msw.use(answer([review()]));
   },
} satisfies Meta<typeof IssueReviews>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Approved: Story = {
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('AutoGate review')).toBeInTheDocument();
      await expect(canvas.getByText(/old page redirects with the query kept/)).toBeInTheDocument();
   },
};

export const SentBackThenApproved: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         answer([
            review({ id: 'review-2', attempt: 2 }),
            review({
               id: 'review-1',
               approved: false,
               reason:
                  'The redirect drops `?approval=` so a toast link lands on an empty inbox. Keep the query string.',
            }),
         ])
      );
   },
   play: async ({ canvas }) => {
      // The reason is the point of a rejection: it says what to fix.
      await expect(await canvas.findByText(/Keep the query string/)).toBeInTheDocument();
      await expect(
         canvas.getByText('Sent back to To do to be worked again, with this feedback.')
      ).toBeInTheDocument();
   },
};

export const StillReading: Story = {
   beforeEach: ({ msw }) => {
      msw.use(answer([review({ approved: null, inProgress: true, decidedAt: null, reason: '' })]));
   },
   play: async ({ canvas }) => {
      await expect(
         await canvas.findByText('QA Engineer is reading what Frontend Engineer produced.')
      ).toBeInTheDocument();
   },
};

export const NoReviews: Story = {
   beforeEach: ({ msw }) => {
      msw.use(answer([]));
   },
};
