import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect } from 'storybook/test';
import type { LinkedPullRequest } from '@/lib/github';
import { IssueLinkedPullRequests } from './issue-linked-pull-requests';
import { seedIssuesWorkspace } from '../stories-fixtures';

const pr = (overrides: Partial<LinkedPullRequest>): LinkedPullRequest => ({
   id: 'pr-1',
   number: 318,
   title: 'Persist project health (BERR-42)',
   url: 'https://github.com/berry-dev/berry/pull/318',
   repoFullName: 'berry-dev/berry',
   state: 'open',
   draft: false,
   headRef: 'berr-42-project-health',
   authorLogin: 'berry-agent[bot]',
   mergedAt: null,
   closeIntent: true,
   checks: { rollup: 'success', total: 6, passed: 6, failed: 0, pending: 0, items: [] },
   updatedAt: '2026-09-18T11:30:00Z',
   ...overrides,
});

const answer = (visible: boolean, pullRequests: LinkedPullRequest[]) =>
   http.get('*/api/v1/github/:workspaceId/issues/:ref/pull-requests', () =>
      HttpResponse.json({ visible, pullRequests })
   );

const meta = {
   component: IssueLinkedPullRequests,
   tags: ['ai-generated', 'needs-work'],
   args: { issueRef: 'BERR-42' },
   decorators: [
      (Story) => (
         <div className="w-[260px]">
            <Story />
         </div>
      ),
   ],
   beforeEach: ({ msw }) => {
      seedIssuesWorkspace({ withSession: true });
      msw.use(answer(true, [pr({})]));
   },
} satisfies Meta<typeof IssueLinkedPullRequests>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OpenAndGreen: Story = {
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('6 of 6 checks passed')).toBeInTheDocument();
      await expect(canvas.getByText('closes this task on merge')).toBeInTheDocument();
   },
};

export const FailingChecks: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         answer(true, [
            pr({
               checks: {
                  rollup: 'failure',
                  total: 6,
                  passed: 4,
                  failed: 2,
                  pending: 0,
                  items: [
                     {
                        kind: 'run',
                        name: 'typecheck:server',
                        status: 'completed',
                        conclusion: 'failure',
                        url: 'https://github.com/berry-dev/berry/actions/runs/1',
                     },
                     {
                        kind: 'run',
                        name: 'test:server',
                        status: 'completed',
                        conclusion: 'timed_out',
                        url: null,
                     },
                  ],
               },
            }),
         ])
      );
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('2 of 6 checks failed')).toBeInTheDocument();
      await expect(canvas.getByRole('link', { name: 'typecheck:server' })).toBeInTheDocument();
   },
};

export const DraftMergedAndClosed: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         answer(true, [
            pr({
               id: 'pr-2',
               number: 321,
               state: 'draft',
               draft: true,
               title: '',
               headRef: 'berr-42-backfill',
               checks: { rollup: 'pending', total: 6, passed: 2, failed: 0, pending: 4, items: [] },
            }),
            pr({
               id: 'pr-3',
               number: 305,
               state: 'merged',
               mergedAt: '2026-09-12T16:00:00Z',
               title: 'Add project health column',
            }),
            pr({
               id: 'pr-4',
               number: 299,
               state: 'closed',
               closeIntent: false,
               title: 'Try health in local storage',
               checks: { rollup: 'none', total: 0, passed: 0, failed: 0, pending: 0, items: [] },
            }),
         ])
      );
   },
   play: async ({ canvas }) => {
      // A draft with no title falls back to its branch name.
      await expect(await canvas.findByText('berr-42-backfill')).toBeInTheDocument();
      await expect(canvas.getByText('4 of 6 checks running')).toBeInTheDocument();
   },
};

export const TurnedOffForWorkspace: Story = {
   beforeEach: ({ msw }) => {
      msw.use(answer(false, [pr({})]));
   },
};
