import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, waitFor, within } from 'storybook/test';
import WorkspaceGeneral from './workspace-general';
import {
   apiError,
   page,
   seedSession,
   workspaceMemberRoles,
   workspaceSummary,
} from './stories-fixtures';

const meta = {
   component: WorkspaceGeneral,
   tags: ['ai-generated', 'needs-work'],
   beforeEach: ({ msw }) => {
      seedSession();
      msw.use(
         http.get('*/api/v1/workspaces/:id', () => HttpResponse.json(workspaceSummary)),
         http.patch('*/api/v1/workspaces/:id', async ({ request }) => {
            const patch = (await request.json()) as Record<string, unknown>;
            return HttpResponse.json({ ...workspaceSummary, ...patch });
         }),
         http.get('*/api/v1/workspaces/:id/members', () =>
            HttpResponse.json(page(workspaceMemberRoles))
         )
      );
   },
} satisfies Meta<typeof WorkspaceGeneral>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Owner: Story = {
   play: async ({ canvas, userEvent }) => {
      const name = await canvas.findByRole('textbox', { name: 'Workspace name' });
      // The field renders at once and fills when GET /workspaces/:id lands.
      await waitFor(() => expect(name).toHaveValue('Elian'));
      await userEvent.type(name, ' Labs');
      await userEvent.tab();
      await expect(await canvas.findByText('Saved')).toBeVisible();
   },
};

export const PrefixRenumberConfirm: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      const prefix = await canvas.findByRole('textbox', { name: 'Task prefix' });
      await waitFor(() => expect(prefix).toHaveValue('BERR'));
      // Filtered as typed: lowercase and punctuation never reach the field.
      await userEvent.clear(prefix);
      await userEvent.type(prefix, 'el-1');
      await expect(prefix).toHaveValue('EL1');
      await expect(canvas.getByText('Tasks read EL1-128.')).toBeVisible();
      await userEvent.click(canvas.getByRole('button', { name: 'Change prefix' }));
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText(/BERR-128 becomes EL1-128/)).toBeVisible();
   },
};

export const SoleOwner: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/workspaces/:id/members', () =>
            HttpResponse.json(page(workspaceMemberRoles.slice(0, 1)))
         )
      );
   },
   play: async ({ canvas }) => {
      await expect(
         await canvas.findByText(
            'You are the only owner. Make someone else an owner first, or delete the workspace.'
         )
      ).toBeVisible();
      await expect(canvas.getByRole('button', { name: 'Leave workspace' })).toBeDisabled();
   },
};

export const MemberReadOnly: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/workspaces/:id', () =>
            HttpResponse.json({ ...workspaceSummary, role: 'member' })
         )
      );
   },
   play: async ({ canvas }) => {
      const name = await canvas.findByRole('textbox', { name: 'Workspace name' });
      await waitFor(() => expect(name).toHaveValue('Elian'));
      await expect(name).toBeDisabled();
      await expect(canvas.queryByRole('button', { name: 'Delete workspace' })).toBeNull();
      // KNOWN BUG (component): the read-only note is passed as the section's
      // `description`, but SettingsSection renders no header without a
      // `title`, so the note (and a load error) never appears. Left failing.
      await expect(canvas.getByText('Only owners and admins can change these.')).toBeVisible();
   },
};

export const LoadFailed: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/workspaces/:id', () =>
            apiError(404, 'Workspace not found.', 'NOT_FOUND')
         )
      );
   },
};
