import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, within } from 'storybook/test';
import {
   DropdownMenu,
   DropdownMenuContent,
   DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { seedSession, shellHandlers, workspaceRoute } from '../stories-fixtures';
import { WorkspaceMenuItems } from './workspace-menu';

/** The menu as the rail's brand button opens it. */
function WorkspaceMenu({ orgId }: { orgId?: string }) {
   return (
      <DropdownMenu>
         <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
               Workspace menu
            </Button>
         </DropdownMenuTrigger>
         <DropdownMenuContent className="min-w-60 rounded-lg" side="bottom" align="start">
            <WorkspaceMenuItems orgId={orgId} />
         </DropdownMenuContent>
      </DropdownMenu>
   );
}

const meta = {
   component: WorkspaceMenu,
   tags: ['ai-generated', 'needs-work'],
   args: { orgId: 'elian' },
   parameters: { nextjs: { navigation: workspaceRoute('/elian/tasks') } },
   beforeEach: ({ msw }) => {
      seedSession();
      msw.use(...shellHandlers);
   },
} satisfies Meta<typeof WorkspaceMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The other workspace has unread items, which the switcher marks with a dot. */
export const SwitchWorkspace: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Workspace menu' }));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('menuitem', { name: 'Switch workspace' }));
      await expect(await body.findByLabelText('Circle Labs has unread items')).toBeVisible();
      await expect(body.getByRole('menuitem', { name: /Elian/ })).toHaveAttribute('data-disabled');
   },
};

export const WithInvitation: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/invitations/pending', () =>
            HttpResponse.json({
               nodes: [
                  {
                     id: 'inv-1',
                     workspaceId: 'ws-3',
                     workspaceName: 'Northwind Ops',
                     role: 'member',
                     expiresAt: '2026-09-25T12:00:00Z',
                     createdAt: '2026-09-17T12:00:00Z',
                  },
               ],
            })
         ),
         http.post(
            '*/api/v1/invitations/:id/decline',
            () => new HttpResponse(null, { status: 204 })
         )
      );
   },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Workspace menu' }));
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText('Invited to Northwind Ops')).toBeVisible();
      await userEvent.click(body.getByRole('button', { name: 'Decline' }));
      await expect(await body.findByText('Invitation declined.')).toBeVisible();
   },
};

export const Open: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Workspace menu' }));
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByRole('menuitem', { name: /settings/ })).toHaveAttribute(
         'href',
         '/elian/settings'
      );
   },
};
