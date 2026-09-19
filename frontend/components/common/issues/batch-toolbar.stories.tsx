import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, waitFor, within } from 'storybook/test';
import { useIssueSelectionStore } from '@/store/issue-selection-store';
import { BatchToolbar } from './batch-toolbar';
import {
   andrea,
   emptyPage,
   issueApiHandlers,
   maya,
   seedIssuesWorkspace,
   storyAgents,
   storyIssues,
   tomas,
} from './stories-fixtures';

const visibleIds = storyIssues.map((issue) => issue.id);
const picked = visibleIds.slice(0, 3);

const member = (user: typeof andrea, role: string) => ({
   userId: user.id,
   workspaceId: 'ws-1',
   role,
   email: user.email,
   name: user.name,
   avatarUrl: null,
   joinedAt: '2026-01-12T09:00:00Z',
   updatedAt: '2026-01-12T09:00:00Z',
});

const meta = {
   component: BatchToolbar,
   tags: ['ai-generated', 'needs-work'],
   args: { visibleIds },
   decorators: [
      (Story) => (
         <div className="w-[860px]">
            <Story />
         </div>
      ),
   ],
   beforeEach: ({ msw }) => {
      seedIssuesWorkspace({ withSession: true });
      useIssueSelectionStore.setState({ selected: picked, anchor: picked.at(-1) ?? null });
      // Specific routes first: msw tries them in order, and `/issues/:ref`
      // would otherwise answer `/issues/assignee-frequency`.
      msw.use(
         http.get('*/api/v1/issues/assignee-frequency', () =>
            HttpResponse.json({ nodes: [{ type: 'agent', id: 'agent-be', count: 14 }] })
         ),
         http.get('*/api/v1/workspaces/:id/members', () =>
            HttpResponse.json({
               nodes: [member(andrea, 'admin'), member(maya, 'member'), member(tomas, 'member')],
               pageInfo: emptyPage,
            })
         ),
         http.get('*/api/v1/agents', () =>
            HttpResponse.json({ nodes: storyAgents, pageInfo: emptyPage })
         ),
         http.post('*/api/v1/issues/batch', async ({ request }) => {
            const { issueIds } = (await request.json()) as { issueIds: string[] };
            return HttpResponse.json({ updated: issueIds, failed: [] });
         }),
         http.post('*/api/v1/issues/batch-delete', async ({ request }) => {
            const { issueIds } = (await request.json()) as { issueIds: string[] };
            return HttpResponse.json({ deleted: issueIds, failed: [] });
         }),
         ...issueApiHandlers
      );
   },
} satisfies Meta<typeof BatchToolbar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ThreeSelected: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByText('3 selected')).toBeInTheDocument();
      await expect(canvas.getByRole('button', { name: 'Select all' })).toBeInTheDocument();
   },
};

export const EverythingSelected: Story = {
   beforeEach: () => {
      useIssueSelectionStore.setState({ selected: visibleIds, anchor: null });
   },
   play: async ({ canvas }) => {
      // Nothing left to add, so "Select all" steps aside.
      await expect(canvas.queryByRole('button', { name: 'Select all' })).toBeNull();
   },
};

export const HandToAnAgentAsksFirst: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Assignee' }));
      const body = within(canvasElement.ownerDocument.body);
      // The most-assigned agent is listed first.
      const backend = await body.findByRole('menuitem', { name: 'Backend Engineer' });
      await expect(body.getAllByRole('menuitem')[0]).toBe(backend);
      await userEvent.click(backend);
      await expect(
         await body.findByText('3 tasks are being assigned to Backend Engineer.')
      ).toBeVisible();
   },
};

export const DeleteSelection: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Delete' }));
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText('Delete the selected tasks?')).toBeVisible();
      await userEvent.click(body.getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(useIssueSelectionStore.getState().selected).toEqual([]));
   },
};

export const NothingSelected: Story = {
   beforeEach: () => {
      useIssueSelectionStore.setState({ selected: [], anchor: null });
   },
   play: async ({ canvasElement }) => {
      await expect(canvasElement.textContent).not.toContain('selected');
   },
};
