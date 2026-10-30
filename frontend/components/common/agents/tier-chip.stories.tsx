import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';

import { TIER_NAMES, TIERS } from '@/lib/agents';

import { TierChip } from './tier-chip';

const meta = {
   component: TierChip,
   tags: ['ai-generated'],
   args: { tier: 'berry_high' },
   argTypes: {
      tier: {
         control: 'select',
         options: ['berry_max', 'berry_xhigh', 'berry_high', 'berry_mid', 'berry_low'],
      },
   },
} satisfies Meta<typeof TierChip>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Shows the tier's product name, not its storage key. */
export const BerryHigh: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByText('BerryHigh')).toBeVisible();
   },
};

/** Every tier, on its own status token, the way the role tab's picker lists them. */
export const AllTiers: Story = {
   render: () => (
      <div className="flex flex-wrap gap-2">
         {TIERS.map((tier) => (
            <TierChip key={tier} tier={tier} />
         ))}
      </div>
   ),
   play: async ({ canvas }) => {
      for (const tier of TIERS) {
         await expect(canvas.getByText(TIER_NAMES[tier])).toBeVisible();
      }
   },
};
