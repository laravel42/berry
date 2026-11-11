import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, waitFor, within } from 'storybook/test';
import { frontendAgent } from '@/components/common/agents/stories-fixtures';
import { ChatTierModelSelect } from './chat-tier-model-select';

const tierModels = {
   source: 'workspace' as const,
   tiers: {
      berry_max: [],
      berry_xhigh: [],
      berry_high: [],
      berry_mid: ['rt-kiro/claude-haiku', 'rt-kiro/claude-opus'],
      berry_low: [],
   },
   names: {
      berry_max: 'BerryMax',
      berry_xhigh: 'BerryXHigh',
      berry_high: 'BerryHigh',
      berry_mid: 'BerryMid',
      berry_low: 'BerryLow',
   },
};

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

const meta = {
   component: ChatTierModelSelect,
   tags: ['ai-generated'],
   args: { conversationId: 'conv-1', agent: frontendAgent, disabled: false, compact: false },
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/runtimes/tier-models', () => HttpResponse.json(tierModels)),
         http.get('*/api/v1/runtimes/catalog', () => HttpResponse.json(catalog)),
         http.get('*/api/v1/conversations/:conversationId/runtime-selection', () =>
            HttpResponse.json({ runtimeId: null, modelId: null, agentId: null })
         ),
         http.put('*/api/v1/conversations/:conversationId/runtime-selection', async ({ request }) =>
            HttpResponse.json(await request.json())
         )
      );
   },
} satisfies Meta<typeof ChatTierModelSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

/** No explicit choice yet: the first model placed on the agent's tier shows. */
export const DefaultsToFirstOnTier: Story = {
   play: async ({ canvas }) => {
      await expect(await canvas.findByRole('combobox', { name: 'Model' })).toHaveTextContent(
         'Claude Haiku 4.5'
      );
   },
};

/** Opening the select lists every model placed on BerryMid. */
export const OpenListsTierModels: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      const trigger = await canvas.findByRole('combobox', { name: 'Model' });
      await userEvent.click(trigger);
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByRole('option', { name: 'Claude Haiku 4.5' })).toBeVisible();
      await expect(body.getByRole('option', { name: 'Claude Opus 5' })).toBeVisible();
   },
};

/** Picking a model saves it on the conversation; the trigger follows the save. */
export const PickAModel: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      const trigger = await canvas.findByRole('combobox', { name: 'Model' });
      await userEvent.click(trigger);
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('option', { name: 'Claude Opus 5' }));
      await waitFor(() => expect(trigger).toHaveTextContent('Claude Opus 5'));
   },
};

/** No agent assigned: there is no tier to read models from, so nothing renders. */
export const NoAgent: Story = {
   args: { agent: undefined },
   play: async ({ canvasElement }) => {
      await expect(within(canvasElement).queryByRole('combobox')).toBeNull();
   },
};
