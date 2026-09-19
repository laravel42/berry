import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect } from 'storybook/test';
import type { AutoReview } from '@/lib/runs';
import { ReviewerProperty } from './reviewer-property';

const review = (overrides: Partial<AutoReview> = {}): AutoReview => ({
   id: 'review-1',
   runId: 'run-43-1',
   reviewer: 'QA Engineer',
   author: 'Frontend Engineer',
   approved: true,
   inProgress: false,
   reason: 'The inbox renders approvals and proposals; the old page redirects.',
   attempt: 1,
   startedAt: '2026-09-18T08:22:00Z',
   decidedAt: '2026-09-18T08:24:10Z',
   ...overrides,
});

const answer = (reviews: AutoReview[]) =>
   http.get('*/api/v1/issues/:ref/reviews', () => HttpResponse.json({ reviews }));

const meta = {
   component: ReviewerProperty,
   tags: ['ai-generated', 'needs-work'],
   args: { issueRef: 'BERR-43' },
   decorators: [
      (Story) => (
         <div className="w-[260px]">
            <Story />
         </div>
      ),
   ],
   beforeEach: ({ msw }) => {
      msw.use(answer([review()]));
   },
} satisfies Meta<typeof ReviewerProperty>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Approved: Story = {
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('Peer approved')).toBeInTheDocument();
      await expect(canvas.getByTitle('Peer review by QA Engineer · attempt 1')).toBeInTheDocument();
   },
};

export const SentBack: Story = {
   beforeEach: ({ msw }) => {
      msw.use(answer([review({ approved: false, attempt: 2 })]));
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('Peer sent back')).toBeInTheDocument();
   },
};

export const Reading: Story = {
   beforeEach: ({ msw }) => {
      msw.use(answer([review({ approved: null, inProgress: true, decidedAt: null })]));
   },
   play: async ({ canvas }) => {
      await expect(
         await canvas.findByTitle('QA Engineer is reading what Frontend Engineer produced.')
      ).toBeInTheDocument();
   },
};

export const NoReviewer: Story = {
   beforeEach: ({ msw }) => {
      msw.use(answer([]));
   },
};
