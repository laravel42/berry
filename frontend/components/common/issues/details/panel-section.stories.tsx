import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Plus } from 'lucide-react';
import { expect } from 'storybook/test';
import { Button } from '@/components/ui/button';
import { Section } from './panel-section';

const meta = {
   component: Section,
   tags: ['ai-generated', 'needs-work'],
   args: {
      title: 'Blocked by',
      children: <p className="text-muted-foreground">Waits on nothing.</p>,
   },
   decorators: [
      (Story) => (
         <div className="w-[260px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof Section>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Plain: Story = {
   play: async ({ canvas }) => {
      await expect(
         canvas.getByRole('heading', { level: 2, name: 'Blocked by' })
      ).toBeInTheDocument();
   },
};

export const WithAction: Story = {
   args: {
      title: 'Labels',
      action: (
         <Button variant="ghost" size="icon" className="size-6" aria-label="Add a label">
            <Plus className="size-3.5" />
         </Button>
      ),
      children: <p className="text-muted-foreground">None</p>,
   },
};
