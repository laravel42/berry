import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { ChevronRight } from 'lucide-react';
import { expect } from 'storybook/test';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './collapsible';

const meta = {
   component: Collapsible,
   tags: ['ai-generated', 'needs-work'],
   render: (args) => (
      <Collapsible {...args} className="w-[360px]">
         <CollapsibleTrigger className="group flex items-center gap-1 font-medium">
            <ChevronRight className="size-4 transition-transform group-data-[state=open]:rotate-90" />
            Sub-tasks (2)
         </CollapsibleTrigger>
         <CollapsibleContent>
            <ul className="mt-2 flex flex-col gap-1 pl-5 text-muted-foreground">
               <li>BERR-43 Add health column</li>
               <li>BERR-44 Backfill existing projects</li>
            </ul>
         </CollapsibleContent>
      </Collapsible>
   ),
} satisfies Meta<typeof Collapsible>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Collapsed: Story = {
   play: async ({ canvas, userEvent }) => {
      const trigger = canvas.getByRole('button', { name: /sub-tasks/i });
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      await expect(canvas.queryByText('BERR-43 Add health column')).toBeNull();
      await userEvent.click(trigger);
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      await expect(canvas.getByText('BERR-43 Add health column')).toBeVisible();
   },
};

export const Expanded: Story = { args: { defaultOpen: true } };
