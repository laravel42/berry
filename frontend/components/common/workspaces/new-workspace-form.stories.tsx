import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { getRouter } from '@storybook/nextjs-vite/navigation.mock';
import { http, HttpResponse } from 'msw';
import { expect, fn, waitFor } from 'storybook/test';
import { Button } from '@/components/ui/button';
import { NewWorkspaceForm } from './new-workspace-form';

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

/** `GET /api/v1/me/bootstrap`, enough for `refreshWorkspaces` to resolve it. */
const bootstrap = {
   user: {
      id: 'user-1',
      email: 'andrea@example.com',
      name: 'Andrea Lunelio',
      avatarUrl: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      settings: { theme: 'dark', timezone: 'UTC', reducedMotion: false, locale: 'en' },
   },
   workspaces: [
      {
         id: 'ws-new',
         name: 'Acme Engineering',
         slug: 'acme-engineering',
         description: null,
         role: 'owner',
         createdAt: '2026-09-18T12:00:00Z',
         updatedAt: '2026-09-18T12:00:00Z',
      },
   ],
   currentWorkspaceId: 'ws-new',
};

const emptyBoardPage = { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } };

const apiError = (status: number, message: string, code = 'INTERNAL') =>
   HttpResponse.json({ error: { code, message, requestId: 'req-story' } }, { status });

const meta = {
   component: NewWorkspaceForm,
   tags: ['ai-generated', 'needs-work'],
   args: { cancel: <Button variant="ghost">Cancel</Button>, onCreated: fn() },
   decorators: [
      (Story) => (
         <div className="max-w-xl">
            <Story />
         </div>
      ),
   ],
   beforeEach: ({ msw }) => {
      msw.use(
         http.post('*/api/v1/workspaces', () =>
            HttpResponse.json(createdWorkspace, { status: 201 })
         ),
         http.post('*/api/v1/workspaces/:id/select', () => HttpResponse.json(createdWorkspace)),
         http.get('*/api/v1/me/bootstrap', () => HttpResponse.json(bootstrap)),
         http.get('*/api/v1/boards', () => HttpResponse.json(emptyBoardPage))
      );
   },
} satisfies Meta<typeof NewWorkspaceForm>;

export default meta;
type Story = StoryObj<typeof meta>;

/** No name yet: the button is disabled and the hint explains what to do. */
export const Empty: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('button', { name: 'Create workspace' })).toBeDisabled();
      await expect(
         canvas.getByText(
            'Give it a name to continue. The address and task prefix are made from it.'
         )
      ).toBeVisible();
   },
};

/** Typing a name derives the address and the task prefix as you go. */
export const DerivesAddressAndPrefix: Story = {
   play: async ({ canvas, userEvent }) => {
      const [nameInput, slugInput, prefixInput] = canvas.getAllByRole('textbox');
      await userEvent.type(nameInput, 'Acme Engineering');
      await expect(slugInput).toHaveValue('acme-engineering');
      await expect(prefixInput).toHaveValue('ACM');
      await expect(canvas.getByRole('button', { name: 'Create workspace' })).toBeEnabled();
   },
};

/** A name that derives to a route Berry already serves is refused before submit. */
export const ReservedAddressBlocked: Story = {
   play: async ({ canvas, userEvent }) => {
      const [nameInput] = canvas.getAllByRole('textbox');
      await userEvent.type(nameInput, 'Settings');
      await expect(await canvas.findByText('That address is reserved by Berry.')).toBeVisible();
      await expect(canvas.getByRole('button', { name: 'Create workspace' })).toBeDisabled();
   },
};

let createPayload: { name: string; slug: string } | undefined;

/** Submitting creates, selects and enters the workspace, with the typed payload. */
export const CreateSucceeds: Story = {
   beforeEach: ({ msw }) => {
      createPayload = undefined;
      msw.use(
         http.post('*/api/v1/workspaces', async ({ request }) => {
            createPayload = (await request.json()) as { name: string; slug: string };
            return HttpResponse.json(createdWorkspace, { status: 201 });
         })
      );
   },
   play: async ({ args, canvas, userEvent }) => {
      const [nameInput] = canvas.getAllByRole('textbox');
      await userEvent.type(nameInput, 'Acme Engineering');
      await userEvent.click(canvas.getByRole('button', { name: 'Create workspace' }));
      await waitFor(() =>
         expect(createPayload).toEqual({ name: 'Acme Engineering', slug: 'acme-engineering' })
      );
      await waitFor(() => expect(args.onCreated).toHaveBeenCalledTimes(1));
      await waitFor(() =>
         expect(getRouter().replace).toHaveBeenCalledWith('/acme-engineering/tasks')
      );
   },
};

/** The server refuses the address: the form stays, and says why. */
export const AddressTaken: Story = {
   beforeEach: ({ msw }) => {
      msw.use(http.post('*/api/v1/workspaces', () => apiError(409, 'Conflict')));
   },
   play: async ({ args, canvas, userEvent }) => {
      const [nameInput] = canvas.getAllByRole('textbox');
      await userEvent.type(nameInput, 'Acme Engineering');
      await userEvent.click(canvas.getByRole('button', { name: 'Create workspace' }));
      await expect(await canvas.findByRole('alert')).toHaveTextContent(
         'That address is already taken.'
      );
      await expect(args.onCreated).not.toHaveBeenCalled();
      await expect(canvas.getByRole('button', { name: 'Create workspace' })).toBeEnabled();
   },
};
