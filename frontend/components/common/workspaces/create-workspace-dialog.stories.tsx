import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, waitFor, within } from 'storybook/test';
import { useCreateWorkspaceStore } from '@/store/create-workspace-store';
import { CreateWorkspaceDialog } from './create-workspace-dialog';

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

const meta = {
   component: CreateWorkspaceDialog,
   tags: ['ai-generated', 'needs-work'],
   beforeEach: ({ msw }) => {
      useCreateWorkspaceStore.setState({ isOpen: true });
      msw.use(
         http.post('*/api/v1/workspaces', () =>
            HttpResponse.json(createdWorkspace, { status: 201 })
         ),
         http.post('*/api/v1/workspaces/:id/select', () => HttpResponse.json(createdWorkspace)),
         http.get('*/api/v1/me/bootstrap', () => HttpResponse.json(bootstrap)),
         http.get('*/api/v1/boards', () => HttpResponse.json(emptyBoardPage))
      );
   },
} satisfies Meta<typeof CreateWorkspaceDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Opened from the workspace menu: the form starts empty. */
export const Open: Story = {
   play: async ({ canvasElement }) => {
      const body = within(canvasElement.ownerDocument.body);
      const dialog = await body.findByRole('dialog', { name: 'New workspace' });
      await expect(
         within(dialog).getByText('A workspace has its own members, tasks and settings.')
      ).toBeVisible();
   },
};

/** Not opened: nothing is mounted. */
export const Closed: Story = {
   beforeEach: () => {
      useCreateWorkspaceStore.setState({ isOpen: false });
   },
   play: async ({ canvasElement }) => {
      await expect(within(canvasElement.ownerDocument.body).queryByRole('dialog')).toBeNull();
   },
};

/** Cancel closes the dialog without creating anything. */
export const CancelCloses: Story = {
   play: async ({ canvasElement, userEvent }) => {
      const body = within(canvasElement.ownerDocument.body);
      const dialog = await body.findByRole('dialog');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(useCreateWorkspaceStore.getState().isOpen).toBe(false));
   },
};

/** Creating a workspace from the dialog closes it once the workspace exists. */
export const CreateClosesDialog: Story = {
   play: async ({ canvasElement, userEvent }) => {
      const body = within(canvasElement.ownerDocument.body);
      const dialog = await body.findByRole('dialog');
      const [nameInput] = within(dialog).getAllByRole('textbox');
      await userEvent.type(nameInput, 'Acme Engineering');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Create workspace' }));
      await waitFor(() => expect(useCreateWorkspaceStore.getState().isOpen).toBe(false));
   },
};
