import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import Header from './header';

const meta = {
   component: Header,
   tags: ['ai-generated', 'needs-work'],
   parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Header>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('tab', { name: /Open/ })).toBeVisible();
      await expect(canvas.getByRole('tab', { name: /All/ })).toBeVisible();
      await expect(canvas.getByPlaceholderText('Search goals')).toBeVisible();
   },
};

/** At phone width the scope tabs still fit. */
export const Narrow: Story = {
   decorators: [
      (Story) => (
         <div className="w-[360px] border">
            <Story />
         </div>
      ),
   ],
};
