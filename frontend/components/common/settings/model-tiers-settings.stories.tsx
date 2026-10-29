import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect } from 'storybook/test';

import ModelTiersSettings from './model-tiers-settings';
import { seedSession } from './stories-fixtures';

const capabilities = {
   modelDiscovery: 'supported',
   streaming: 'supported',
   tools: 'supported',
   sessions: 'supported',
   cancellation: 'supported',
   usage: 'supported',
};

/** A connected subscription runtime offering `models`. */
const connected = (id: string, name: string, models: { id: string; name: string }[]) => ({
   id,
   name,
   publisher: name,
   product: name,
   description: '',
   executionMode: 'agent_process',
   provider: id,
   billing: 'subscription',
   billingDetail: '',
   subscriptionAccess: 'supported',
   connectionMethods: [],
   platforms: ['macos'],
   localProcess: true,
   installation: '',
   defaultModel: null,
   capabilities,
   availability: 'available',
   installed: true,
   unavailableReason: null,
   officialSources: [],
   connection: {
      id: `conn-${id}`,
      runtimeId: id,
      status: 'connected',
      authMethod: 'cli',
      accountId: null,
      accountName: null,
      metadata: { models },
      connectedAt: '2026-10-01T10:00:00Z',
      disconnectedAt: null,
      lastCheckedAt: null,
      lastError: null,
   },
});

const meta = {
   component: ModelTiersSettings,
   tags: ['ai-generated'],
   beforeEach: ({ msw }) => {
      seedSession();
      msw.use(
         http.get('*/api/v1/runtimes/catalog', () =>
            HttpResponse.json({
               nodes: [
                  connected('codex', 'Codex CLI', [{ id: 'gpt-6.1-sol', name: 'GPT-6.1-Sol' }]),
                  connected('kiro', 'Kiro CLI', [{ id: 'auto', name: 'Automatic' }]),
               ],
               preference: { runtimeId: null, modelId: null },
            })
         ),
         http.get('*/api/v1/runtimes/tier-models', () =>
            HttpResponse.json({
               source: 'workspace',
               tiers: {
                  berry_max: ['codex/gpt-6.1-sol'],
                  berry_xhigh: [],
                  berry_high: ['kiro/auto', 'codex/gpt-6.1-sol'],
                  berry_mid: ['kiro/auto', 'codex/gpt-6.1-sol'],
                  berry_low: [],
               },
               names: {
                  berry_max: 'Development',
                  berry_xhigh: 'Design',
                  berry_high: 'Reasoning',
                  berry_mid: 'Review',
                  berry_low: 'Plan',
               },
            })
         )
      );
   },
} satisfies Meta<typeof ModelTiersSettings>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Five tiers, two of them empty; each lists its models first choice first. */
export const Tiers: Story = {
   play: async ({ canvas }) => {
      await expect(await canvas.findByDisplayValue('Reasoning')).toBeVisible();
      await expect(
         canvas.getAllByText('No models yet. Tasks in this tier use the workspace default.')
      ).toHaveLength(2);
   },
};
