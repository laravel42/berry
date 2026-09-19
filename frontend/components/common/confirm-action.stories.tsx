import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { expect, fn, waitFor, within } from 'storybook/test';
import { Input } from '@/components/ui/input';
import { ConfirmAction } from './confirm-action';

const meta = {
   component: ConfirmAction,
   tags: ['ai-generated', 'needs-work'],
   args: {
      open: true,
      onOpenChange: fn(),
      title: 'Revoke this key?',
      description: 'Anything using “Deploy script” stops working at once. This cannot be undone.',
      confirmLabel: 'Revoke',
      destructive: true,
      onConfirm: fn(),
   },
} satisfies Meta<typeof ConfirmAction>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RevokeKey: Story = {
   play: async ({ args, canvasElement, userEvent }) => {
      const body = within(canvasElement.ownerDocument.body);
      const dialog = await body.findByRole('alertdialog', { name: 'Revoke this key?' });
      await userEvent.click(within(dialog).getByRole('button', { name: 'Revoke' }));
      await expect(args.onConfirm).toHaveBeenCalledTimes(1);
      // A resolved confirm closes the dialog through onOpenChange.
      await waitFor(() => expect(args.onOpenChange).toHaveBeenCalledWith(false));
   },
};

export const Pending: Story = {
   args: {
      title: 'Remove this address?',
      description: 'Berry stops reaching you at andrea@example.com. You can add it again later.',
      confirmLabel: 'Remove',
      pendingLabel: 'Removing…',
      // Never settles, so the dialog stays in its pending state.
      onConfirm: fn(() => new Promise<void>(() => undefined)),
   },
   play: async ({ args, canvasElement, userEvent }) => {
      const body = within(canvasElement.ownerDocument.body);
      const dialog = await body.findByRole('alertdialog');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
      await expect(await within(dialog).findByRole('button', { name: 'Removing…' })).toBeDisabled();
      await expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
      // Escape is held while the request is in flight.
      await userEvent.keyboard('{Escape}');
      await expect(args.onOpenChange).not.toHaveBeenCalled();
   },
};

export const FailureKeepsItOpen: Story = {
   args: { onConfirm: fn(() => Promise.reject(new Error('network'))) },
   play: async ({ args, canvasElement, userEvent }) => {
      const body = within(canvasElement.ownerDocument.body);
      const dialog = await body.findByRole('alertdialog');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Revoke' }));
      // The rejection re-enables the buttons and the dialog stays for a retry.
      await waitFor(() => expect(args.onConfirm).toHaveBeenCalled());
      await waitFor(() =>
         expect(within(dialog).getByRole('button', { name: 'Revoke' })).toBeEnabled()
      );
      await expect(args.onOpenChange).not.toHaveBeenCalled();
   },
};

/** A typed-name guard holds the confirm button until the name matches. */
export const TypedName: Story = {
   args: {
      title: 'Delete Acme Engineering?',
      description: 'Every task, agent and run in this workspace is deleted. This cannot be undone.',
      confirmLabel: 'Delete forever',
   },
   render: function Render(args) {
      const [typed, setTyped] = useState('');
      return (
         <ConfirmAction {...args} confirmDisabled={typed !== 'acme'}>
            <Input
               aria-label="Type the workspace address to confirm"
               value={typed}
               onChange={(event) => setTyped(event.target.value)}
            />
         </ConfirmAction>
      );
   },
   play: async ({ canvasElement, userEvent }) => {
      const body = within(canvasElement.ownerDocument.body);
      const dialog = await body.findByRole('alertdialog');
      const confirm = within(dialog).getByRole('button', { name: 'Delete forever' });
      await expect(confirm).toBeDisabled();
      await userEvent.type(within(dialog).getByRole('textbox'), 'acme');
      await expect(confirm).toBeEnabled();
   },
};

export const NotDestructive: Story = {
   args: {
      title: 'Leave Acme Engineering?',
      description: 'You lose access until someone invites you again.',
      confirmLabel: 'Leave',
      cancelLabel: 'Stay',
      destructive: false,
   },
};
