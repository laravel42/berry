import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Copy, Link2, MoreHorizontal, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { expect, fn, within } from 'storybook/test';
import { Button } from './button';
import {
   DropdownMenu,
   DropdownMenuCheckboxItem,
   DropdownMenuContent,
   DropdownMenuItem,
   DropdownMenuLabel,
   DropdownMenuRadioGroup,
   DropdownMenuRadioItem,
   DropdownMenuSeparator,
   DropdownMenuShortcut,
   DropdownMenuSub,
   DropdownMenuSubContent,
   DropdownMenuSubTrigger,
   DropdownMenuTrigger,
} from './dropdown-menu';

const onCopy = fn();

const meta = {
   component: DropdownMenu,
   tags: ['ai-generated', 'needs-work'],
   render: (args) => (
      <DropdownMenu {...args}>
         <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" aria-label="Task actions">
               <MoreHorizontal />
            </Button>
         </DropdownMenuTrigger>
         <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel>BERR-42</DropdownMenuLabel>
            <DropdownMenuItem onSelect={onCopy}>
               <Copy />
               Copy ID
               <DropdownMenuShortcut>⌘.</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem>
               <Link2 />
               Copy link
            </DropdownMenuItem>
            <DropdownMenuSub>
               <DropdownMenuSubTrigger>Move to project</DropdownMenuSubTrigger>
               <DropdownMenuSubContent>
                  <DropdownMenuItem>Runtime hardening</DropdownMenuItem>
                  <DropdownMenuItem>Inbox</DropdownMenuItem>
               </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive">
               <Trash2 />
               Delete
            </DropdownMenuItem>
         </DropdownMenuContent>
      </DropdownMenu>
   ),
} satisfies Meta<typeof DropdownMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Actions: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      onCopy.mockClear();
      await userEvent.click(canvas.getByRole('button', { name: 'Task actions' }));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('menuitem', { name: /copy id/i }));
      await expect(onCopy).toHaveBeenCalledTimes(1);
      // Selecting an item closes the menu.
      await expect(body.queryByRole('menu')).toBeNull();
   },
};

export const Open: Story = { args: { open: true } };

/** Display options, as the list view's menu toggles them. */
export const CheckboxAndRadio: Story = {
   render: function Render(args) {
      const [showIds, setShowIds] = useState(true);
      const [grouping, setGrouping] = useState('status');
      return (
         <DropdownMenu {...args}>
            <DropdownMenuTrigger asChild>
               <Button size="xs" variant="outline">
                  Display
               </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
               <DropdownMenuCheckboxItem checked={showIds} onCheckedChange={setShowIds}>
                  Show IDs
               </DropdownMenuCheckboxItem>
               <DropdownMenuSeparator />
               <DropdownMenuLabel>Group by</DropdownMenuLabel>
               <DropdownMenuRadioGroup value={grouping} onValueChange={setGrouping}>
                  <DropdownMenuRadioItem value="status">Status</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="assignee">Assignee</DropdownMenuRadioItem>
               </DropdownMenuRadioGroup>
            </DropdownMenuContent>
         </DropdownMenu>
      );
   },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Display' }));
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByRole('menuitemcheckbox', { name: 'Show IDs' })).toHaveAttribute(
         'aria-checked',
         'true'
      );
      await expect(body.getByRole('menuitemradio', { name: 'Status' })).toHaveAttribute(
         'aria-checked',
         'true'
      );
   },
};
