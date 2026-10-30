import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, waitFor, within } from 'storybook/test';
import { RuntimeSelectionControl } from './runtime-selection';

/** `GET /api/v1/runtimes/catalog`, one connected runtime with two models. */
const catalog = {
   nodes: [
      {
         id: 'rt-kiro',
         name: 'Kiro',
         publisher: 'Kiro',
         product: 'Kiro',
         description: '',
         executionMode: 'agent_process',
         provider: 'kiro',
         billing: 'subscription',
         billingDetail: '',
         subscriptionAccess: 'supported',
         connectionMethods: [],
         platforms: [],
         localProcess: true,
         installation: '',
         defaultModel: 'claude-haiku',
         capabilities: {
            modelDiscovery: 'supported',
            streaming: 'supported',
            tools: 'supported',
            sessions: 'supported',
            cancellation: 'supported',
            usage: 'supported',
         },
         availability: 'available',
         unavailableReason: null,
         officialSources: [],
         connection: {
            id: 'conn-1',
            runtimeId: 'rt-kiro',
            status: 'connected',
            authMethod: 'cli',
            accountId: null,
            accountName: null,
            metadata: {
               models: [
                  { id: 'claude-haiku', name: 'Claude Haiku 4.5' },
                  { id: 'claude-opus', name: 'Claude Opus 5' },
               ],
            },
            connectedAt: '2026-09-01T00:00:00Z',
            disconnectedAt: null,
            lastCheckedAt: null,
            lastError: null,
         },
      },
   ],
   preference: { runtimeId: null, modelId: null },
};

const noConnectedCatalog = { nodes: [], preference: { runtimeId: null, modelId: null } };
const noSelection = { runtimeId: null, modelId: null, agentId: null };

const meta = {
   component: RuntimeSelectionControl,
   tags: ['ai-generated'],
   args: { target: { kind: 'issue', id: 'issue-42' } },
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/runtimes/catalog', () => HttpResponse.json(catalog)),
         http.get('*/api/v1/issues/:id/runtime-selection', () => HttpResponse.json(noSelection)),
         http.put('*/api/v1/issues/:id/runtime-selection', async ({ request }) =>
            HttpResponse.json(await request.json())
         )
      );
   },
} satisfies Meta<typeof RuntimeSelectionControl>;

export default meta;
type Story = StoryObj<typeof meta>;

/** No selection yet: falls back to the workspace default, the first connected runtime. */
export const InheritsTheWorkspaceDefault: Story = {
   play: async ({ canvas }) => {
      const button = await canvas.findByRole('button', { name: /AI runtime/ });
      await waitFor(() => expect(button).toHaveTextContent('Kiro'));
   },
};

/** No subscription runtime connected: the menu says so instead of listing one. */
export const NoRuntimeConnected: Story = {
   beforeEach: ({ msw }) => {
      msw.use(http.get('*/api/v1/runtimes/catalog', () => HttpResponse.json(noConnectedCatalog)));
   },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(await canvas.findByRole('button', { name: /AI runtime/ }));
      const body = within(canvasElement.ownerDocument.body);
      await expect(
         await body.findByText('Connect a subscription in Settings → AI Runtimes to use it here.')
      ).toBeVisible();
   },
};

/** Choosing a runtime saves the selection and picks its first model. */
export const ChoosingARuntimeSavesIt: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(await canvas.findByRole('button', { name: /AI runtime/ }));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('menuitemradio', { name: 'Kiro' }));
      await waitFor(() =>
         expect(canvas.getByRole('button', { name: /Model for this work/ })).toHaveTextContent(
            'Claude Haiku 4.5'
         )
      );
   },
};

/** Switching the model saves it without touching the chosen runtime. */
export const ChoosingAModelSavesIt: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/issues/:id/runtime-selection', () =>
            HttpResponse.json({ runtimeId: 'rt-kiro', modelId: 'claude-haiku', agentId: null })
         )
      );
   },
   play: async ({ canvas, canvasElement, userEvent }) => {
      const modelButton = await canvas.findByRole('button', { name: /Model for this work/ });
      await expect(modelButton).toHaveTextContent('Claude Haiku 4.5');
      await userEvent.click(modelButton);
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('menuitemradio', { name: 'Claude Opus 5' }));
      await waitFor(() => expect(modelButton).toHaveTextContent('Claude Opus 5'));
   },
};
