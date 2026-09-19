import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { Button } from './button';
import {
   Dialog,
   DialogClose,
   DialogContent,
   DialogDescription,
   DialogFooter,
   DialogHeader,
   DialogTitle,
   DialogTrigger,
} from './dialog';
import { Input } from './input';

const meta = {
   component: Dialog,
   tags: ['ai-generated', 'needs-work'],
   render: (args) => (
      <Dialog {...args}>
         <DialogTrigger asChild>
            <Button>New label</Button>
         </DialogTrigger>
         <DialogContent>
            <DialogHeader>
               <DialogTitle>New label</DialogTitle>
               <DialogDescription>Labels are shared across the workspace.</DialogDescription>
            </DialogHeader>
            <Input aria-label="Label name" placeholder="needs-design" />
            <DialogFooter>
               <DialogClose asChild>
                  <Button variant="secondary">Cancel</Button>
               </DialogClose>
               <Button>Create</Button>
            </DialogFooter>
         </DialogContent>
      </Dialog>
   ),
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'New label' }));
      const body = within(canvasElement.ownerDocument.body);
      const dialog = await body.findByRole('dialog', { name: 'New label' });
      // The built-in close button is always there unless showCloseButton is off.
      await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
      await expect(body.queryByRole('dialog')).toBeNull();
   },
};

export const Open: Story = { args: { open: true } };

export const WithoutCloseButton: Story = {
   args: { open: true },
   render: (args) => (
      <Dialog {...args}>
         <DialogContent showCloseButton={false}>
            <DialogHeader>
               <DialogTitle>Moving 12 tasks</DialogTitle>
               <DialogDescription>This finishes on its own.</DialogDescription>
            </DialogHeader>
         </DialogContent>
      </Dialog>
   ),
   play: async ({ canvasElement }) => {
      const dialog = await within(canvasElement.ownerDocument.body).findByRole('dialog');
      await expect(within(dialog).queryByRole('button', { name: 'Close' })).toBeNull();
   },
};
