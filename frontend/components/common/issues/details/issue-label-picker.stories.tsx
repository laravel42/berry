import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, waitFor, within } from 'storybook/test';
import type { IssueLabel } from '@/lib/issue-labels';
import { IssueLabelPicker } from './issue-label-picker';
import { emptyPage, seedIssuesWorkspace, storyLabels } from '../stories-fixtures';

const catalogue: IssueLabel[] = storyLabels.map((label) => ({
   ...label,
   description: null,
   archivedAt: null,
}));
const byId = (id: string) => catalogue.find((label) => label.id === id)!;

const meta = {
   component: IssueLabelPicker,
   tags: ['ai-generated', 'needs-work'],
   args: { issueRef: 'BERR-44' },
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
         http.get('*/api/v1/issues/:ref/labels', () =>
            HttpResponse.json({ nodes: [byId('label-frontend'), byId('label-bug')] })
         ),
         http.get('*/api/v1/catalogs/:workspaceId/issue-labels', () =>
            HttpResponse.json({
               nodes: catalogue.map((label) => ({
                  ...label,
                  workspaceId: 'ws-1',
                  createdAt: '2026-08-01T09:00:00Z',
                  updatedAt: '2026-08-01T09:00:00Z',
               })),
               pageInfo: emptyPage,
            })
         ),
         http.put('*/api/v1/issues/:ref/labels', async ({ request }) => {
            const { labelIds } = (await request.json()) as { labelIds: string[] };
            return HttpResponse.json({ nodes: labelIds.map(byId) });
         })
      );
   },
} satisfies Meta<typeof IssueLabelPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TwoLabels: Story = {
   play: async ({ canvas }) => {
      await expect(await canvas.findByRole('button', { name: 'Frontend' })).toBeInTheDocument();
      await expect(canvas.getByRole('button', { name: 'Bug' })).toBeInTheDocument();
   },
};

export const NoLabels: Story = {
   beforeEach: ({ msw }) => {
      msw.use(http.get('*/api/v1/issues/:ref/labels', () => HttpResponse.json({ nodes: [] })));
   },
};

export const AddFromCatalogue: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await canvas.findByRole('button', { name: 'Frontend' });
      await userEvent.click(canvas.getByRole('button', { name: 'Add a label' }));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('option', { name: 'Security' }));
      await expect(await canvas.findByRole('button', { name: 'Security' })).toBeInTheDocument();
   },
};

export const RemoveByClickingChip: Story = {
   play: async ({ canvas, userEvent }) => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Bug' }));
      // The chip goes once the server has the smaller set.
      await waitFor(() => expect(canvas.queryByRole('button', { name: 'Bug' })).toBeNull());
      await expect(canvas.getByRole('button', { name: 'Frontend' })).toBeInTheDocument();
   },
};
