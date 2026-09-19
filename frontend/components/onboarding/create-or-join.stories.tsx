import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, fn, waitFor } from 'storybook/test';
import { CreateOrJoin } from './create-or-join';

/** `POST /api/v1/workspaces`, as `workspaceSchema` in lib/workspaces.ts parses it. */
const createdWorkspace = {
   id: 'ws-new',
   name: 'Acme Engineering',
   slug: 'acme-engineering',
   description: null,
   role: 'owner',
   createdAt: '2026-09-18T12:00:00Z',
   updatedAt: '2026-09-18T12:00:00Z',
   settings: { issuePrefix: 'ACM', defaultRole: 'member', allowMemberInvites: true },
};

/** `POST /api/v1/invitations/{id}/accept`, as `memberSchema` parses it. */
const acceptedMembership = {
   userId: 'user-1',
   workspaceId: 'ws-joined',
   role: 'member',
   email: 'andrea@example.com',
   name: 'Andrea Lunelio',
   avatarUrl: null,
   joinedAt: '2026-09-18T12:00:00Z',
   updatedAt: '2026-09-18T12:00:00Z',
};

const apiError = (status: number, code: string, message: string) =>
   HttpResponse.json({ error: { code, message } }, { status });

/** 10-character prefix plus a 43-character secret. */
const validToken = `berry_inv_${'a'.repeat(43)}`;

const meta = {
   component: CreateOrJoin,
   tags: ['ai-generated', 'needs-work'],
   args: { onEntered: fn() },
   decorators: [
      (Story) => (
         <div className="w-[384px]">
            <Story />
         </div>
      ),
   ],
   beforeEach: ({ msw }) => {
      msw.use(
         http.post('*/api/v1/workspaces', () => HttpResponse.json(createdWorkspace)),
         http.post('*/api/v1/invitations/:id/accept', () => HttpResponse.json(acceptedMembership))
      );
   },
} satisfies Meta<typeof CreateOrJoin>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Create: Story = {
   play: async ({ args, canvas, userEvent }) => {
      await userEvent.type(
         canvas.getByRole('textbox', { name: 'Workspace name' }),
         'Acme Engineering'
      );
      await userEvent.click(canvas.getByRole('button', { name: 'Create workspace' }));
      await waitFor(() => expect(args.onEntered).toHaveBeenCalledWith('ws-new'));
   },
};

export const NameRequired: Story = {
   play: async ({ args, canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Create workspace' }));
      await expect(await canvas.findByText('Workspace name is required')).toBeVisible();
      await expect(args.onEntered).not.toHaveBeenCalled();
   },
};

export const NameTaken: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.post('*/api/v1/workspaces', () =>
            apiError(409, 'conflict', 'workspace slug already exists')
         )
      );
   },
   play: async ({ args, canvas, userEvent }) => {
      await userEvent.type(canvas.getByRole('textbox', { name: 'Workspace name' }), 'Acme');
      await userEvent.click(canvas.getByRole('button', { name: 'Create workspace' }));
      await expect(await canvas.findByRole('alert')).toHaveTextContent(
         'That workspace name is already taken.'
      );
      await expect(args.onEntered).not.toHaveBeenCalled();
   },
};

export const Join: Story = {
   play: async ({ args, canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('tab', { name: 'Join' }));
      await userEvent.type(canvas.getByRole('textbox', { name: 'Invitation ID' }), 'inv-7');
      await userEvent.type(canvas.getByRole('textbox', { name: 'Invitation token' }), validToken);
      await userEvent.click(canvas.getByRole('button', { name: 'Join workspace' }));
      await waitFor(() => expect(args.onEntered).toHaveBeenCalledWith('ws-joined'));
   },
};

/** A token of the wrong shape never leaves the tab. */
export const JoinMalformedToken: Story = {
   play: async ({ canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('tab', { name: 'Join' }));
      await userEvent.type(canvas.getByRole('textbox', { name: 'Invitation ID' }), 'inv-7');
      await userEvent.type(canvas.getByRole('textbox', { name: 'Invitation token' }), 'short');
      await userEvent.click(canvas.getByRole('button', { name: 'Join workspace' }));
      await expect(await canvas.findByText('Invitation token is invalid')).toBeVisible();
   },
};

export const JoinExpired: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.post('*/api/v1/invitations/:id/accept', () =>
            apiError(410, 'gone', 'invitation expired')
         )
      );
   },
   play: async ({ canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('tab', { name: 'Join' }));
      await userEvent.type(canvas.getByRole('textbox', { name: 'Invitation ID' }), 'inv-7');
      await userEvent.type(canvas.getByRole('textbox', { name: 'Invitation token' }), validToken);
      await userEvent.click(canvas.getByRole('button', { name: 'Join workspace' }));
      await expect(await canvas.findByRole('alert')).toHaveTextContent(
         'That invitation is invalid, expired, or already used.'
      );
   },
};
