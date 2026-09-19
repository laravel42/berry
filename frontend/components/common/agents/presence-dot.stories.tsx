import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { PresenceDot } from './presence-dot';

const meta = {
   component: PresenceDot,
   tags: ['ai-generated', 'needs-work'],
   args: { tone: 'online', label: 'Online' },
} satisfies Meta<typeof PresenceDot>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Online: Story = {
   play: async ({ canvas }) => {
      // The dot is an image a screen reader can name, not a decoration.
      await expect(canvas.getByRole('img', { name: 'Online' })).toBeVisible();
   },
};

export const Busy: Story = { args: { tone: 'busy', label: 'Busy' } };

export const Offline: Story = { args: { tone: 'offline', label: 'Offline' } };

/** The detail header puts the word beside the dot for anything but online. */
export const WithLabel: Story = {
   args: { tone: 'busy', label: 'Busy' },
   render: (args) => (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-border/70 px-2 py-1 text-muted-foreground">
         <PresenceDot {...args} />
         {args.label}
      </span>
   ),
};
