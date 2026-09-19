import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, waitFor, within } from 'storybook/test';
import type { Issue } from '@/data/issues';
import { useIssueViewStore } from '@/store/issue-view-store';
import { SubIssues } from './sub-issues';
import {
   agentUser,
   apiIssue,
   emptyPage,
   healthTests,
   issueApiHandlers,
   maya,
   persistHealth,
   qaAgent,
   seedIssuesWorkspace,
   statusById,
} from '../stories-fixtures';

const child = (number: number, title: string, overrides: Partial<Issue>): Issue => ({
   ...healthTests,
   id: `issue-${number}`,
   identifier: `BERR-${number}`,
   title,
   ...overrides,
});

const children: Issue[] = [
   child(52, 'Add migration 061 for project health', {
      stage: 1,
      status: statusById('done'),
      assignee: maya,
   }),
   healthTests,
   child(53, 'Expose health on PATCH /api/v1/projects/{id}', {
      stage: 2,
      status: statusById('to-do'),
      assignee: agentUser(qaAgent),
   }),
   child(54, 'Note the change in the gateway docs', { stage: null, status: statusById('backlog') }),
];

const answer = (nodes: Issue[], done: number) =>
   http.get('*/api/v1/issues/:ref/children', () =>
      HttpResponse.json({
         nodes: nodes.map(apiIssue),
         progress: { total: nodes.length, done },
      })
   );

const meta = {
   component: SubIssues,
   tags: ['ai-generated', 'needs-work'],
   args: { issue: persistHealth },
   decorators: [
      (Story) => (
         <div className="w-[720px]">
            <Story />
         </div>
      ),
   ],
   beforeEach: ({ msw }) => {
      seedIssuesWorkspace({ withSession: true });
      useIssueViewStore.setState({ collapsedSubIssues: {} });
      msw.use(
         answer(children, 1),
         http.post('*/api/v1/issues/:ref/children', () =>
            HttpResponse.json(apiIssue(child(55, 'Backfill health for existing projects', {})))
         ),
         http.get('*/api/v1/search', () => HttpResponse.json({ nodes: [], pageInfo: emptyPage })),
         ...issueApiHandlers
      );
   },
} satisfies Meta<typeof SubIssues>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ByStage: Story = {
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('1/4 done')).toBeInTheDocument();
      await expect(canvas.getByText('Stage 1')).toBeInTheDocument();
      await expect(canvas.getByText('Stage 2')).toBeInTheDocument();
   },
};

export const None: Story = {
   beforeEach: ({ msw }) => {
      msw.use(answer([], 0));
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('No sub-tasks yet.')).toBeInTheDocument();
   },
};

export const Collapsed: Story = {
   beforeEach: () => {
      useIssueViewStore.setState({ collapsedSubIssues: { [persistHealth.identifier]: true } });
   },
   play: async ({ canvas, userEvent }) => {
      await expect(await canvas.findByText('1/4 done')).toBeInTheDocument();
      await expect(canvas.queryByText('Stage 1')).toBeNull();
      await userEvent.click(canvas.getByRole('button', { name: 'Show sub-tasks' }));
      await expect(canvas.getByText('Stage 1')).toBeInTheDocument();
   },
};

export const AddOne: Story = {
   play: async ({ canvas, userEvent }) => {
      await canvas.findByText('Stage 1');
      await userEvent.type(
         canvas.getByPlaceholderText('Describe the sub-task'),
         'Backfill health for existing projects'
      );
      await userEvent.click(canvas.getByRole('button', { name: 'Add' }));
      // The box empties once the server has the new sub-task.
      await waitFor(() =>
         expect(canvas.getByPlaceholderText('Describe the sub-task')).toHaveValue('')
      );
   },
};

export const ChangeChildStatus: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Status: Todo' }));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('option', { name: /In Progress/ }));
      await expect(
         await canvas.findByRole('button', { name: 'Status: In Progress' })
      ).toBeInTheDocument();
   },
};
