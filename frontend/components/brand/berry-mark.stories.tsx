import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { BerryMark, BerryWordmark } from './berry-mark';

const meta = {
   component: BerryMark,
   tags: ['ai-generated'],
   args: { size: 'lg', label: 'Berry' },
} satisfies Meta<typeof BerryMark>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
   play: async ({ canvas }) => {
      // The label is the mark's accessible name, not decoration.
      await expect(canvas.getByRole('img', { name: 'Berry' })).toBeInTheDocument();
   },
};

export const Working: Story = {
   args: { tone: 'working', pulse: true, dotColor: '#4f9dff', label: 'Builder, agent' },
};

export const Hollow: Story = { args: { tone: 'neutral', state: 'hollow', label: 'Nothing here' } };

export const Wordmark: Story = {
   render: () => <BerryWordmark size="md" />,
};
