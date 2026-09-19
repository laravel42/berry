import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { AutonomyLevelChip } from './autonomy-level-chip';

const meta = {
   component: AutonomyLevelChip,
   tags: ['ai-generated', 'needs-work'],
   args: { level: 3 },
} satisfies Meta<typeof AutonomyLevelChip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Level3: Story = {};

/** Every ceiling side by side, as the role tab's level picker lists them. */
export const AllLevels: Story = {
   render: () => (
      <div className="flex flex-wrap gap-2">
         {[1, 2, 3, 4, 5].map((level) => (
            <AutonomyLevelChip key={level} level={level} />
         ))}
      </div>
   ),
};

/** A plain agent has no role, so it has no level and the chip renders nothing. */
export const NoLevel: Story = {
   args: { level: null },
   play: async ({ canvasElement }) => {
      await expect(canvasElement.querySelector('span[title]')).toBeNull();
   },
};

/** Focusable, as the detail header uses it under its own tooltip. */
export const Focusable: Story = {
   args: { level: 5, tabIndex: 0, className: 'inline-flex items-center rounded-md px-2 py-1' },
};
