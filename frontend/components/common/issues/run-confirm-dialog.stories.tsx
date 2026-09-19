import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, waitFor, within } from 'storybook/test';
import { RunConfirmDialog } from './run-confirm-dialog';

const meta = {
   component: RunConfirmDialog,
   tags: ['ai-generated', 'needs-work'],
   args: {
      request: { target: { kind: 'agent', name: 'Backend Engineer' } },
      onClose: fn(),
      onDecide: fn(),
   },
} satisfies Meta<typeof RunConfirmDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SingleTask: Story = {
   play: async ({ args, canvasElement, userEvent }) => {
      const body = within(canvasElement.ownerDocument.body);
      await expect(
         await body.findByText(/Backend Engineer can pick this task up straight away/)
      ).toBeVisible();
      await userEvent.click(body.getByRole('button', { name: 'Assign and start' }));
      await expect(args.onDecide).toHaveBeenCalledWith(true);
      await waitFor(() => expect(args.onClose).toHaveBeenCalled());
   },
};

export const BulkAssignment: Story = {
   args: { request: { target: { kind: 'agent', name: 'Frontend Engineer' }, count: 6 } },
   play: async ({ canvasElement }) => {
      const body = within(canvasElement.ownerDocument.body);
      await expect(
         await body.findByText('6 tasks are being assigned to Frontend Engineer.')
      ).toBeVisible();
   },
};

export const AssignWithoutStarting: Story = {
   play: async ({ args, canvasElement, userEvent }) => {
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('button', { name: 'Assign without starting' }));
      await expect(args.onDecide).toHaveBeenCalledWith(false);
   },
};

export const Closed: Story = { args: { request: null } };
