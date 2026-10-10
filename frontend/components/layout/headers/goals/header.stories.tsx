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
      await expect(canvas.getByPlaceholderText('Search goals')).toBeVisible();
      await expect(canvas.queryByRole('tab')).toBeNull();
   },
};

/** At phone width the search still fits. */
export const Narrow: Story = {
   decorators: [
      (Story) => (
         <div className="w-[360px] border">
            <Story />
         </div>
      ),
   ],
};
