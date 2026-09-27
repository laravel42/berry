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
      // A rating converted from another benchmark is marked, and says where from.
      await expect(canvas.getByTitle(/Estimated from Kilo's benchmark/)).toHaveTextContent('≈70%');
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

/** An experiment tier opens the disclosure so the selection is visible. */
export const Experiment: Story = {
   args: { tier: 'berry_free' },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('Prompts may be used for training')).toBeVisible();
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
