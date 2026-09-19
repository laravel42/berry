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
      await expect(canvas.getByRole('heading', { level: 1, name: 'Runtimes' })).toBeVisible();
   },
};

/** At phone width the title still sits alone in the row. */
export const Narrow: Story = {
   decorators: [
      (Story) => (
         <div className="w-[360px] border">
            <Story />
         </div>
      ),
   ],
};
