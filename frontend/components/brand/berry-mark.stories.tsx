import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { BerryMark, BerryWordmark } from './berry-mark';

const meta = {
   component: BerryMark,
   tags: ['ai-generated'],
   args: { size: 'lg', label: 'Berry' },
   argTypes: {
      tone: {
         control: 'select',
         options: ['brand', 'neutral', 'working', 'attention', 'complete', 'danger'],
      },
      state: {
         control: 'select',
         options: ['solid', 'hollow', 'crossed', 'empty'],
      },
      size: {
         control: 'select',
         options: ['sm', 'md', 'lg'],
      },
   },
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
   play: async ({ canvas }) => {
      const home = canvas.getByRole('link', { name: 'Berry home' });
      await expect(home).toHaveAttribute('href', '/');
   },
};
