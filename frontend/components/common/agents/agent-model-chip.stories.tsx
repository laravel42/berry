import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';

import { AgentModelChip } from './agent-model-chip';
import { frontendAgent, orchestratorAgent } from './stories-fixtures';

const meta = {
   component: AgentModelChip,
   tags: ['ai-generated'],
   args: { agent: frontendAgent },
} satisfies Meta<typeof AgentModelChip>;

export default meta;
type Story = StoryObj<typeof meta>;

/** No tier of its own: falls back to its role contract's tier, BerryMid. */
export const FromRoleContract: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByText('BerryMid')).toBeVisible();
   },
};

/** No tier, no contract: falls all the way back to BerryLow. */
export const NoTierOrContract: Story = {
   args: { agent: orchestratorAgent },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('BerryLow')).toBeVisible();
   },
};

/** The agent's own pinned tier wins over its role contract's. */
export const OwnTierPinned: Story = {
   args: { agent: { ...frontendAgent, tier: 'berry_max' } },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('BerryMax')).toBeVisible();
   },
};
