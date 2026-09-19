import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import {
   ContextMenu,
   ContextMenuCheckboxItem,
   ContextMenuContent,
   ContextMenuItem,
   ContextMenuLabel,
   ContextMenuRadioGroup,
   ContextMenuRadioItem,
   ContextMenuSeparator,
   ContextMenuShortcut,
   ContextMenuSub,
   ContextMenuSubContent,
   ContextMenuSubTrigger,
   ContextMenuTrigger,
} from './context-menu';

const meta = {
   component: ContextMenu,
   tags: ['ai-generated', 'needs-work'],
   render: (args) => (
      <ContextMenu {...args}>
         <ContextMenuTrigger className="flex h-10 w-[420px] items-center gap-3 rounded-md border px-3">
            <span className="text-muted-foreground">BERR-42</span>
            <span>Persist project health</span>
         </ContextMenuTrigger>
         <ContextMenuContent className="w-56">
            <ContextMenuLabel>Task</ContextMenuLabel>
            <ContextMenuItem>
               Open
               <ContextMenuShortcut>↵</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuSub>
               <ContextMenuSubTrigger>Status</ContextMenuSubTrigger>
               <ContextMenuSubContent>
                  <ContextMenuRadioGroup value="in-progress">
                     <ContextMenuRadioItem value="to-do">To do</ContextMenuRadioItem>
                     <ContextMenuRadioItem value="in-progress">In progress</ContextMenuRadioItem>
                     <ContextMenuRadioItem value="in-review">In review</ContextMenuRadioItem>
                  </ContextMenuRadioGroup>
               </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuCheckboxItem checked>Subscribed</ContextMenuCheckboxItem>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive">Delete</ContextMenuItem>
         </ContextMenuContent>
      </ContextMenu>
   ),
} satisfies Meta<typeof ContextMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RightClickRow: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.pointer({
         keys: '[MouseRight]',
         target: canvas.getByText('Persist project health'),
      });
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByRole('menu')).toBeVisible();
      await expect(body.getByRole('menuitemcheckbox', { name: 'Subscribed' })).toHaveAttribute(
         'aria-checked',
         'true'
      );
   },
};
