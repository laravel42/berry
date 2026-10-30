import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, waitFor, within } from 'storybook/test';
import ModelTiersSettings from './model-tiers-settings';
import { memberWorkspace, seedSession } from './stories-fixtures';

/** `GET /api/v1/runtimes/catalog`, shaped as `AiRuntimeDefinition` requires. */
const connectedCatalog = {
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
                  { id: 'claude-sonnet', name: 'Claude Sonnet 4.6' },
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

const noRuntimeCatalog = { nodes: [], preference: { runtimeId: null, modelId: null } };

const tierNames = {
   berry_max: 'BerryMax',
   berry_xhigh: 'BerryXHigh',
   berry_high: 'BerryHigh',
   berry_mid: 'BerryMid',
   berry_low: 'BerryLow',
};

/** One model already placed on BerryMid; every other tier is empty. */
const tierModels = {
   source: 'workspace' as const,
   tiers: {
      berry_max: [],
      berry_xhigh: [],
      berry_high: [],
      berry_mid: ['rt-kiro/claude-haiku'],
      berry_low: [],
   },
   names: tierNames,
};

const meta = {
   component: ModelTiersSettings,
   tags: ['ai-generated', 'needs-work'],
   decorators: [
      (Story) => (
         <div className="w-[700px]">
            <Story />
         </div>
      ),
   ],
   beforeEach: ({ msw }) => {
      seedSession();
      msw.use(
         http.get('*/api/v1/runtimes/catalog', () => HttpResponse.json(connectedCatalog)),
         http.get('*/api/v1/runtimes/tier-models', () => HttpResponse.json(tierModels)),
         http.put('*/api/v1/runtimes/tier-models', async ({ request }) => {
            const body = (await request.json()) as { placement: Record<string, string[]> };
            return HttpResponse.json({ source: 'workspace', tiers: body.placement });
         })
      );
   },
} satisfies Meta<typeof ModelTiersSettings>;

export default meta;
type Story = StoryObj<typeof meta>;

/** No subscription runtime connected: Berry says what to do instead of a placement UI. */
export const NoRuntimeConnected: Story = {
   beforeEach: ({ msw }) => {
      msw.use(http.get('*/api/v1/runtimes/catalog', () => HttpResponse.json(noRuntimeCatalog)));
   },
   play: async ({ canvas }) => {
      await expect(
         await canvas.findByText(/Connect a subscription AI runtime in Settings/)
      ).toBeVisible();
   },
};

/** The model already placed on BerryMid shows under its tier, with its runtime. */
export const PlacedModelShows: Story = {
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('Claude Haiku 4.5')).toBeVisible();
      await expect(canvas.getByText('Kiro')).toBeVisible();
   },
};

/** Adding a model to a tier saves the new order; the save indicator confirms it. */
export const AddModelToTier: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      // Wait for the placement to load: the add control stays disabled until then.
      await canvas.findByText('Claude Haiku 4.5');
      const tierNameInput = canvas.getByDisplayValue('BerryMid');
      const row = tierNameInput.closest('[data-column-tint]') as HTMLElement;
      await userEvent.click(within(row).getByRole('button', { name: 'Add model' }));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('option', { name: /Claude Opus 5/ }));
      await expect(await canvas.findByText('Claude Opus 5')).toBeVisible();
      await waitFor(() => expect(canvas.getByText('Saved')).toBeVisible());
   },
};

/** A member sees the placements, named as fixed chips, with no edit controls. */
export const ReadOnlyMember: Story = {
   beforeEach: () => {
      seedSession(memberWorkspace);
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('Claude Haiku 4.5')).toBeVisible();
      await expect(canvas.getByText('BerryMid')).toBeVisible();
      await expect(canvas.queryByRole('button', { name: 'Add model' })).toBeNull();
      await expect(canvas.queryByDisplayValue('BerryMid')).toBeNull();
   },
};
