import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn } from 'storybook/test';
import type { User } from '@/data/users';
import { useSessionStore, type SessionWorkspace } from '@/store/session-store';
import { WorkspaceAccess } from './workspace-access';

const me: User = {
   id: 'user-1',
   name: 'Andrea Lunelio',
   avatarUrl: '',
   email: 'andrea@example.com',
   status: 'online',
   role: 'Admin',
   joinedDate: '2026-01-10',
   teamIds: [],
   timezone: 'Europe/Rome',
};

const acme: SessionWorkspace = {
   id: 'ws-1',
   name: 'Acme Engineering',
   slug: 'acme',
   role: 'owner',
};

const signOut = fn(async () => undefined);

function seedSession(patch: Partial<ReturnType<typeof useSessionStore.getState>>) {
   const initial = useSessionStore.getState();
   useSessionStore.setState({
      status: 'ready',
      user: me,
      workspace: acme,
      workspaces: [acme],
      signOut,
      ...patch,
   });
   return () => useSessionStore.setState(initial, true);
}

const meta = {
   component: WorkspaceAccess,
   tags: ['ai-generated', 'needs-work'],
   parameters: {
      layout: 'fullscreen',
      // The address being opened: a workspace this account is not in.
      nextjs: { navigation: { segments: [['orgId', 'ghost-co']] } },
   },
   args: {
      children: <p className="p-6">Tasks for the workspace would render here.</p>,
   },
   beforeEach: () => {
      signOut.mockClear();
      return seedSession({});
   },
} satisfies Meta<typeof WorkspaceAccess>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NotYours: Story = {
   play: async ({ canvas, userEvent }) => {
      await expect(
         canvas.getByRole('heading', { name: 'This address is not yours to open' })
      ).toBeVisible();
      await expect(canvas.getByText('Signed in as andrea@example.com')).toBeVisible();
      // Offers the workspaces the reader does have.
      await expect(canvas.getByRole('link', { name: 'My workspaces' })).toHaveAttribute(
         'href',
         '/acme/tasks'
      );
      await expect(canvas.queryByText('Tasks for the workspace would render here.')).toBeNull();
      await userEvent.click(canvas.getByRole('button', { name: 'Sign in as someone else' }));
      await expect(signOut).toHaveBeenCalledTimes(1);
   },
};

/** No membership anywhere: the way out is onboarding. */
export const NoWorkspacesAtAll: Story = {
   beforeEach: () => seedSession({ workspace: null, workspaces: [] }),
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('link', { name: 'My workspaces' })).toHaveAttribute(
         'href',
         '/onboarding'
      );
   },
};

export const Member: Story = {
   parameters: { nextjs: { navigation: { segments: [['orgId', 'acme']] } } },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('Tasks for the workspace would render here.')).toBeVisible();
      await expect(canvas.queryByRole('heading')).toBeNull();
   },
};

/** While the session boots nothing is known yet, so the page renders through. */
export const SessionBooting: Story = {
   beforeEach: () =>
      seedSession({ status: 'booting', user: null, workspace: null, workspaces: [] }),
   play: async ({ canvas }) => {
      await expect(canvas.getByText('Tasks for the workspace would render here.')).toBeVisible();
   },
};
