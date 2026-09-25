import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, waitFor, within } from 'storybook/test';
import {
   archivedAgent,
   frontendAgent,
   liveAgents,
   releaseAgent,
   seedSession,
   storyHandlers,
} from '@/components/common/agents/stories-fixtures';
import { useAgentsStore } from '@/store/agents-store';
import AgentSettingsPage from './agent-settings-page';

const meta = {
   component: AgentSettingsPage,
   tags: ['ai-generated', 'needs-work'],
   parameters: {
      nextjs: {
         navigation: {
            pathname: `/berry/settings/ai/${frontendAgent.id}`,
            segments: [['orgId', 'berry']],
         },
      },
   },
   args: { agentId: frontendAgent.id },
   beforeEach: ({ msw }) => {
      msw.use(
         http.put('*/api/v1/agents/:id/permissions', async ({ params, request }) => {
            const { permissions } = (await request.json()) as { permissions: string[] };
            const found = liveAgents.find((entry) => entry.id === params.id) ?? frontendAgent;
            return HttpResponse.json({ ...found, permissions });
         }),
         ...storyHandlers
      );
      seedSession('admin');
      // The open tab lives in the URL's #fragment; a story must not inherit the last one's.
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      // Not seeded: the page loads the agent itself, so the store starts empty.
      useAgentsStore.setState({ agents: [], archived: null, roster: new Map(), error: null });
   },
   decorators: [
      (Story) => (
         <div className="flex h-[1000px] w-[1000px] flex-col">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof AgentSettingsPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Three tabs; Role and Permissions opens first, and a tab shows only its own sections. */
export const RoleAgent: Story = {
   play: async ({ canvas, userEvent }) => {
      await expect(await canvas.findByRole('heading', { name: 'Frontend Engineer' })).toBeVisible();
      const menu = canvas.getByRole('tablist', { name: 'Sections' });
      await expect(
         within(menu)
            .getAllByRole('tab')
            .map((tab) => tab.textContent)
      ).toEqual(['Role and Permissions', 'MCP servers', 'Settings']);
      await expect(within(menu).getByRole('tab', { name: 'Role and Permissions' })).toHaveAttribute(
         'aria-selected',
         'true'
      );

      const visibleHeadings = () =>
         canvas.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
      await expect(visibleHeadings()).toEqual(['Frontend Engineer']);
      // Permissions are one of the role's parts, right after its autonomy level.
      const parts = (await canvas.findAllByRole('heading', { level: 3 })).map(
         (heading) => heading.textContent
      );
      await expect(parts.slice(0, 3)).toEqual([
         'Autonomy level',
         'Permissions',
         'Responsibilities',
      ]);

      // Settings holds runtime, concurrency and access, side by side; the other tabs are hidden.
      await userEvent.click(within(menu).getByRole('tab', { name: 'Settings' }));
      const headings = canvas
         .getAllByRole('heading', { level: 2 })
         .map((heading) => heading.textContent);
      await expect(headings).toEqual(['Frontend Engineer', 'Runtime', 'Concurrency', 'Access']);
   },
};

/** Permissions write as they are switched. */
export const GrantPermission: Story = {
   args: { agentId: releaseAgent.id },
   play: async ({ canvas, userEvent }) => {
      const merge = await canvas.findByRole('switch', { name: /Merge without approval/ });
      await expect(merge).toHaveAttribute('aria-checked', 'false');
      await userEvent.click(merge);
      await waitFor(() => expect(merge).toHaveAttribute('aria-checked', 'true'));
   },
};

/** A draft on one tab survives a switch to another, and its save bar stays in view. */
export const DraftKeptAcrossTabs: Story = {
   play: async ({ canvas, userEvent }) => {
      await userEvent.click(await canvas.findByRole('tab', { name: 'Settings' }));
      await userEvent.click(canvas.getByRole('button', { name: '3' }));
      await userEvent.click(canvas.getByRole('tab', { name: 'Role and Permissions' }));
      await expect(await canvas.findByRole('button', { name: /Save/ })).toBeVisible();
      await userEvent.click(canvas.getByRole('tab', { name: 'Settings' }));
      await expect(canvas.getByRole('button', { name: '3' })).toHaveAttribute(
         'aria-pressed',
         'true'
      );
   },
};

/** A plain agent: no role contract to edit. */
export const PlainAgent: Story = { args: { agentId: releaseAgent.id } };

export const Archived: Story = {
   args: { agentId: archivedAgent.id },
   play: async ({ canvas }) => {
      await expect(
         await canvas.findByText('This agent is archived and takes no work.')
      ).toBeVisible();
   },
};

/** A member reads the settings; the role editor is admin-only. */
export const Member: Story = {
   beforeEach: () => {
      seedSession('member');
   },
};

export const Forbidden: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/agents/:id', () =>
            HttpResponse.json(
               { error: { code: 'FORBIDDEN', message: 'Forbidden' } },
               { status: 403 }
            )
         )
      );
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('You do not have access to this agent.')).toBeVisible();
   },
};
