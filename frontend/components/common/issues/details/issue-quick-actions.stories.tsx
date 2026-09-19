import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect } from 'storybook/test';
import type { QuickAction } from '@/lib/quick-actions';
import { IssueQuickActions } from './issue-quick-actions';
import { seedIssuesWorkspace } from '../stories-fixtures';

const action = (id: string, name: string, targetAgentId: string, prompt: string): QuickAction => ({
   id,
   workspaceId: 'ws-1',
   name,
   description: null,
   targetAgentId,
   prompt,
   visibility: 'workspace',
   createdBy: 'user-1',
   createdAt: '2026-08-01T09:00:00Z',
   updatedAt: '2026-08-01T09:00:00Z',
   useCount: 12,
   lastUsedAt: '2026-09-17T09:00:00Z',
   archivedAt: null,
});

const actions = [
   action('qa-tests', 'Write the missing tests', 'agent-qa', 'Add tests for what changed.'),
   action('qa-review', 'Review the diff', 'agent-be', 'Review the open pull request.'),
];

const meta = {
   component: IssueQuickActions,
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
      msw.use(
         http.get('*/api/v1/catalogs/:workspaceId/quick-actions', () =>
            HttpResponse.json({ nodes: actions })
         ),
         http.post('*/api/v1/issues/:ref/quick-actions/:actionId/run', () =>
            HttpResponse.json({ runId: 'run-42-3' })
         )
      );
   },
} satisfies Meta<typeof IssueQuickActions>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TwoActions: Story = {
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('Write the missing tests')).toBeInTheDocument();
      await expect(canvas.getAllByRole('button', { name: 'Run' })).toHaveLength(2);
   },
};

export const RunStarts: Story = {
   play: async ({ canvas, userEvent }) => {
      await canvas.findByText('Write the missing tests');
      await userEvent.click(canvas.getAllByRole('button', { name: 'Run' })[0]!);
      // The outcome stays on the row, not only in a toast (the toaster also
      // renders inside the canvas, so the row's paragraph is picked by tag).
      await expect(
         await canvas.findByText('Write the missing tests started.', { selector: 'p' })
      ).toBeInTheDocument();
   },
};

export const BlockedByActiveRun: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.post('*/api/v1/issues/:ref/quick-actions/:actionId/run', () =>
            HttpResponse.json(
               {
                  error: {
                     code: 'ACTIVE_RUN_EXISTS',
                     message: 'A run is in progress.',
                     details: null,
                  },
               },
               { status: 409 }
            )
         )
      );
   },
   play: async ({ canvas, userEvent }) => {
      await canvas.findByText('Review the diff');
      await userEvent.click(canvas.getAllByRole('button', { name: 'Run' })[1]!);
      await expect(
         await canvas.findByText(
            'Review the diff did not start: this task already has a run in progress',
            { selector: 'p' }
         )
      ).toBeInTheDocument();
   },
};

export const NoActions: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/catalogs/:workspaceId/quick-actions', () =>
            HttpResponse.json({ nodes: [] })
         )
      );
   },
};
