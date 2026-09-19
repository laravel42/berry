import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, fn, waitFor, within } from 'storybook/test';
import McpServersSettings, { McpServerManager } from './mcp-servers';
import { apiError, mcpServers } from './stories-fixtures';

const meta = {
   component: McpServerManager,
   tags: ['ai-generated', 'needs-work'],
   args: {
      agentId: null,
      title: 'MCP servers',
      description:
         'Servers every agent in this workspace can use. Header values are encrypted and never shown again.',
   },
   decorators: [
      (Story) => (
         <div className="max-w-2xl">
            <Story />
         </div>
      ),
   ],
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/mcp-servers', () => HttpResponse.json({ nodes: mcpServers })),
         http.patch('*/api/v1/mcp-servers/:id', async ({ params, request }) => {
            const patch = (await request.json()) as Record<string, unknown>;
            const found = mcpServers.find((entry) => entry.id === params.id);
            return HttpResponse.json({ ...found, ...patch });
         }),
         http.post('*/api/v1/mcp-servers', async ({ request }) => {
            const input = (await request.json()) as {
               name: string;
               url: string;
               transport: string;
               headers: Record<string, string>;
               viaGateway: boolean;
            };
            return HttpResponse.json({
               id: 'mcp-new',
               agentId: null,
               name: input.name,
               url: input.url,
               transport: input.transport,
               headerNames: Object.keys(input.headers),
               viaGateway: input.viaGateway,
               enabled: true,
               createdAt: '2026-09-18T12:00:00Z',
               updatedAt: '2026-09-18T12:00:00Z',
            });
         })
      );
   },
} satisfies Meta<typeof McpServerManager>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WorkspaceServers: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      // Header values are write-only: only their names come back, masked.
      await expect(await canvas.findByText('Authorization: •••• · X-Org: ••••')).toBeVisible();
      const sentry = canvas.getByRole('switch', { name: 'Enable sentry' });
      await userEvent.click(sentry);
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText('Server enabled')).toBeVisible();
      await waitFor(() => expect(sentry).toHaveAttribute('aria-checked', 'true'));
   },
};

export const AddServer: Story = {
   beforeEach: ({ msw }) => {
      msw.use(http.get('*/api/v1/mcp-servers', () => HttpResponse.json({ nodes: [] })));
   },
   play: async ({ canvas, canvasElement, userEvent }) => {
      const add = await canvas.findByRole('button', { name: 'Add server' });
      await expect(add).toBeDisabled();
      // The name is lowercased as it is typed.
      await userEvent.type(canvas.getByRole('textbox', { name: 'Server name' }), 'Linear');
      await expect(canvas.getByRole('textbox', { name: 'Server name' })).toHaveValue('linear');
      await userEvent.type(
         canvas.getByRole('textbox', { name: 'Server URL' }),
         'https://mcp.linear.app/mcp'
      );
      await userEvent.click(add);
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText('Added linear')).toBeVisible();
   },
};

export const ReadOnly: Story = {
   args: { readOnly: true },
};

export const DeferredToggles: Story = {
   args: {
      agentId: 'agent-eng',
      title: 'This agent’s MCP servers',
      deferEnabled: true,
      onEnabledDirtyChange: fn(),
      onRegisterFlushEnabled: fn(),
   },
   play: async ({ args, canvas, userEvent }) => {
      await userEvent.click(await canvas.findByRole('switch', { name: 'Enable docs' }));
      // Nothing is written; the parent is told there is something to save.
      await expect(args.onEnabledDirtyChange).toHaveBeenLastCalledWith(true);
   },
};

export const LoadForbidden: Story = {
   beforeEach: ({ msw }) => {
      msw.use(http.get('*/api/v1/mcp-servers', () => apiError(403, 'forbidden', 'FORBIDDEN')));
   },
};

export const SettingsPage: Story = {
   render: () => <McpServersSettings />,
};
