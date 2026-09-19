import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';
import {
   AlertDialog,
   AlertDialogAction,
   AlertDialogCancel,
   AlertDialogContent,
   AlertDialogDescription,
   AlertDialogFooter,
   AlertDialogHeader,
   AlertDialogTitle,
   AlertDialogTrigger,
} from './alert-dialog';
import { Button } from './button';

const meta = {
   component: AlertDialog,
   tags: ['ai-generated', 'needs-work'],
   args: { onOpenChange: fn() },
   render: (args) => (
      <AlertDialog {...args}>
         <AlertDialogTrigger asChild>
            <Button variant="destructive">Revoke key</Button>
         </AlertDialogTrigger>
         <AlertDialogContent>
            <AlertDialogHeader>
               <AlertDialogTitle>Revoke this key?</AlertDialogTitle>
               <AlertDialogDescription>
                  Anything using “Deploy script” stops working at once. This cannot be undone.
               </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
               <AlertDialogCancel>Cancel</AlertDialogCancel>
               <AlertDialogAction>Revoke</AlertDialogAction>
            </AlertDialogFooter>
         </AlertDialogContent>
      </AlertDialog>
   ),
} satisfies Meta<typeof AlertDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {
   play: async ({ args, canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Revoke key' }));
      const body = within(canvasElement.ownerDocument.body);
      const dialog = await body.findByRole('alertdialog', { name: 'Revoke this key?' });
      await expect(dialog).toBeVisible();
      await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      await expect(args.onOpenChange).toHaveBeenLastCalledWith(false);
   },
};

export const Open: Story = { args: { open: true } };
