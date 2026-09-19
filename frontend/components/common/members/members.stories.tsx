import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, within } from 'storybook/test';

import Members from './members';
import { invitations, membersHandlers, seedSession } from './stories-fixtures';

const meta = {
   component: Members,
   tags: ['ai-generated', 'needs-work'],
   parameters: { nextjs: { navigation: { segments: [['orgId', 'elian']] } } },
   beforeEach: ({ msw }) => {
      seedSession('user-1', 'owner');
      msw.use(...membersHandlers);
   },
} satisfies Meta<typeof Members>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The sole owner's view: every control, except on their own row, which is
 * locked as the last owner. Inviting shows the one-time link in a dialog.
 */
export const Owner: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.post('*/api/v1/workspaces/:workspaceId/invitations', async ({ request }) => {
            const input = (await request.json()) as { email: string; role: string };
            return HttpResponse.json(
               {
                  invitation: {
                     ...invitations[0]!,
                     id: 'inv-3',
                     email: input.email,
                     role: input.role,
                  },
                  token: 'bry_inv_9f2c41d7e8a0',
               },
               { status: 201 }
            );
         })
      );
   },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await expect(await canvas.findByText(/the last owner/)).toBeVisible();
      await expect(canvas.getByRole('combobox', { name: 'Role for Maya Okafor' })).toBeVisible();
      // Invitations are a second request that can land after the member list.
      await expect(await canvas.findByText('jonas@agency.example')).toBeVisible();

      await userEvent.click(canvas.getByRole('button', { name: 'Invite' }));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.type(
         await body.findByRole('textbox', { name: 'Email address' }),
         'Lin@Elian.dev'
      );
      await userEvent.click(body.getByRole('button', { name: 'Create invitation' }));
      const issued = await body.findByRole('dialog', { name: 'Send them this link' });
      await expect(
         within(issued).getByText(/\/invite\/inv-3\?token=bry_inv_9f2c41d7e8a0/)
      ).toBeVisible();
   },
};

/** An admin may not touch the owner or other admins; the reason is shown inline. */
export const Admin: Story = {
   beforeEach: () => {
      seedSession('user-2', 'admin');
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findAllByText(/only an owner can change this/)).toHaveLength(1);
      await expect(canvas.getByRole('combobox', { name: 'Role for Tomás Reyes' })).toBeVisible();
      await expect(canvas.queryByRole('combobox', { name: 'Role for Andrea Lunelio' })).toBeNull();
   },
};

/** A plain member sees roles as badges, and no invitations or join links. */
export const Member: Story = {
   beforeEach: () => {
      seedSession('user-3', 'member');
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('(you)')).toBeVisible();
      await expect(canvas.queryByRole('button', { name: 'Invite' })).toBeNull();
      await expect(canvas.queryByText('Pending invitations')).toBeNull();
   },
};

export const Failed: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/workspaces/:workspaceId/members', () =>
            HttpResponse.json(
               { error: { code: 'INTERNAL', message: 'Members could not be loaded.' } },
               { status: 500 }
            )
         )
      );
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('Members could not be loaded.')).toBeVisible();
   },
};
