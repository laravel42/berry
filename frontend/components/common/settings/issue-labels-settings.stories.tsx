import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, within } from 'storybook/test';
import IssueLabelsSettings from './issue-labels-settings';
import { apiError, page, seedSession, workspaceLabels, WS_ID } from './stories-fixtures';

const meta = {
   component: IssueLabelsSettings,
   tags: ['ai-generated', 'needs-work'],
   beforeEach: ({ msw }) => {
      seedSession();
      msw.use(
         http.get('*/api/v1/catalogs/:ws/issue-labels', () =>
            HttpResponse.json(page(workspaceLabels))
         ),
         http.post('*/api/v1/catalogs/:ws/issue-labels', async ({ request }) => {
            const input = (await request.json()) as { name: string; color: string };
            return HttpResponse.json({
               id: 'lbl-new',
               workspaceId: WS_ID,
               name: input.name,
               description: null,
               color: input.color,
               createdAt: '2026-09-18T12:00:00Z',
               updatedAt: '2026-09-18T12:00:00Z',
               archivedAt: null,
               usageCount: 0,
            });
         }),
         http.patch('*/api/v1/catalogs/:ws/issue-labels/:id', async ({ params, request }) => {
            const patch = (await request.json()) as Record<string, string>;
            const found = workspaceLabels.find((entry) => entry.id === params.id);
            return HttpResponse.json({ ...found, ...patch });
         }),
         http.delete(
            '*/api/v1/catalogs/:ws/issue-labels/:id',
            () => new HttpResponse(null, { status: 204 })
         )
      );
   },
} satisfies Meta<typeof IssueLabelsSettings>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Labels: Story = {
   play: async ({ canvas, userEvent }) => {
      await expect(await canvas.findByDisplayValue('frontend')).toBeVisible();
      await expect(canvas.getByText('61 tasks')).toBeVisible();
      // The filter narrows the list client-side.
      await userEvent.type(canvas.getByPlaceholderText('Filter by name…'), 'zzz');
      await expect(canvas.getByText('Nothing matches your filter.')).toBeVisible();
   },
};

export const CreateLabel: Story = {
   play: async ({ canvas, userEvent }) => {
      await canvas.findByDisplayValue('bug');
      await userEvent.type(canvas.getByPlaceholderText('New label'), 'security');
      await userEvent.click(canvas.getByRole('button', { name: 'Create' }));
      await expect(await canvas.findByDisplayValue('security')).toBeVisible();
   },
};

export const RemoveConfirmsUsage: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await canvas.findByDisplayValue('agent-run');
      // Rows sort by name, so "agent-run" is first.
      const [first] = canvas.getAllByRole('button', { name: 'Remove' });
      await userEvent.click(first!);
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText(/12 tasks carry this label/)).toBeVisible();
   },
};

export const Empty: Story = {
   beforeEach: ({ msw }) => {
      msw.use(http.get('*/api/v1/catalogs/:ws/issue-labels', () => HttpResponse.json(page([]))));
   },
};

export const LoadFailed: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/catalogs/:ws/issue-labels', () =>
            apiError(403, 'You are not a member of this workspace.', 'FORBIDDEN')
         )
      );
   },
};
