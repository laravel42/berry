import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Plus } from 'lucide-react';
import { expect } from 'storybook/test';
import { Button } from '@/components/ui/button';
import { PageTitleBar } from './page-title-bar';

const meta = {
   component: PageTitleBar,
   parameters: { layout: 'fullscreen' },
   args: { title: 'Goals' },
} satisfies Meta<typeof PageTitleBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A title alone: the page's one h1. */
export const TitleOnly: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('heading', { level: 1, name: 'Goals' })).toBeVisible();
   },
};

/** With its one action, pushed to the end of the row. */
export const WithAction: Story = {
   args: {
      title: 'Projects',
      children: (
         <Button size="xs">
            <Plus className="size-4" />
            New project
         </Button>
      ),
   },
   play: async ({ canvas }) => {
      const heading = canvas.getByRole('heading', { level: 1, name: 'Projects' });
      const action = canvas.getByRole('button', { name: 'New project' });
      await expect(action.getBoundingClientRect().left).toBeGreaterThan(
         heading.getBoundingClientRect().right
      );
   },
};

/** A long title truncates at phone width instead of pushing the action off. */
export const NarrowLongTitle: Story = {
   args: {
      title: 'A workspace page with a name far too long for a phone',
      children: <Button size="xs">Create</Button>,
   },
   decorators: [
      (Story) => (
         <div className="w-[360px] border">
            <Story />
         </div>
      ),
   ],
   play: async ({ canvas, canvasElement }) => {
      const frame = canvasElement.querySelector('.w-\\[360px\\]')!.getBoundingClientRect();
      const action = canvas.getByRole('button', { name: 'Create' }).getBoundingClientRect();
      await expect(action.right).toBeLessThanOrEqual(frame.right);
      const heading = canvas.getByRole('heading', { level: 1 });
      await expect(heading.scrollWidth).toBeGreaterThan(heading.clientWidth);
   },
};
