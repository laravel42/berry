import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, fn } from 'storybook/test';
import { AgentTierSection } from './agent-tier-section';
import { gatewayAgent, gatewayHandlers, modelTiers, storyHandlers } from './stories-fixtures';

const meta = {
   component: AgentTierSection,
   tags: ['ai-generated', 'needs-work'],
   args: {
      // The Frontend Engineer's role runs on BerryMid.
      agent: gatewayAgent,
      tier: null,
      model: null,
      onTierChange: fn(),
      onUnpin: fn(),
   },
   beforeEach: ({ msw }) => {
      msw.use(...gatewayHandlers, ...storyHandlers);
   },
   decorators: [
      (Story) => (
         <div className="w-[860px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof AgentTierSection>;

export default meta;
type Story = StoryObj<typeof meta>;

/** On the role's tier: BerryMid is selected and Recommended. */
export const RoleDefault: Story = {
   play: async ({ args, canvas, userEvent }) => {
      await expect(await canvas.findByText('GLM-5')).toBeVisible();
      // Models are listed without a rating: share, name and prices only.
      await expect(canvas.queryByText('Rating')).not.toBeInTheDocument();
      await expect(canvas.getByRole('radio', { name: /BerryMid/ })).toHaveAttribute(
         'aria-checked',
         'true'
      );
      await userEvent.click(canvas.getByRole('radio', { name: /BerryMax/ }));
      await expect(args.onTierChange).toHaveBeenCalledWith('berry_max');
   },
};

/** The agent chose BerryMax; going back to the recommended tier stores null. */
export const OwnTier: Story = {
   args: { tier: 'berry_max' },
   play: async ({ args, canvas, userEvent }) => {
      await userEvent.click(await canvas.findByRole('radio', { name: /BerryMid/ }));
      await expect(args.onTierChange).toHaveBeenCalledWith(null);
   },
};

/** Only the three paid tiers are offered: no Free or Auto. */
export const ThreeTiers: Story = {
   play: async ({ canvas }) => {
      await expect(await canvas.findByRole('radio', { name: /BerryMax/ })).toBeVisible();
      await expect(canvas.getAllByRole('radio')).toHaveLength(3);
      await expect(canvas.queryByText(/BerryFree|BerryAuto/)).not.toBeInTheDocument();
      // Only the tier's name and its models: no share of tasks, no price.
      await expect(canvas.queryByText(/%$/)).not.toBeInTheDocument();
      await expect(canvas.queryByText(/^\$/)).not.toBeInTheDocument();
      await expect(canvas.queryByText('In')).not.toBeInTheDocument();
   },
};

export const Pinned: Story = {
   args: { model: 'z-ai/glm-5' },
   play: async ({ args, canvas, userEvent }) => {
      await expect(await canvas.findByText('Pinned: GLM-5')).toBeVisible();
      await userEvent.click(canvas.getByRole('button', { name: 'Use tier' }));
      await expect(args.onUnpin).toHaveBeenCalled();
   },
};

/** A Bedrock pair from before the gateway: shown, and ignored at run time. */
export const LegacyModel: Story = {
   args: { model: 'us.anthropic.claude-sonnet-5' },
};

export const Stale: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/agents/tiers', () => HttpResponse.json({ ...modelTiers, stale: true }))
      );
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('Leaderboard unavailable')).toBeVisible();
      await expect(canvas.queryByText('GLM-5')).toBeNull();
   },
};

export const GatewayUnavailable: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/agents/tiers', () =>
            HttpResponse.json(
               { error: { code: 'MODEL_GATEWAY_UNAVAILABLE', message: 'No gateway' } },
               { status: 503 }
            )
         )
      );
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('Leaderboard unavailable')).toBeVisible();
   },
};

export const ReadOnly: Story = { args: { disabled: true } };
