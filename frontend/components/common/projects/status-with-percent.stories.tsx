import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';
import { projectStatus } from './stories-fixtures';
import { StatusWithPercent } from './status-with-percent';

const meta = {
   component: StatusWithPercent,
   tags: ['ai-generated', 'needs-work'],
   args: { status: projectStatus('in-progress'), percentComplete: 60, onStatusChange: fn() },
} satisfies Meta<typeof StatusWithPercent>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Active: Story = {
   play: async ({ canvas }) => {
      await expect(
         canvas.getByRole('combobox', { name: 'Status: In Progress, 60% complete' })
      ).toBeVisible();
   },
};

export const Planned: Story = { args: { status: projectStatus('to-do'), percentComplete: 0 } };

export const Completed: Story = { args: { status: projectStatus('done'), percentComplete: 100 } };

export const ChangeStatus: Story = {
   play: async ({ args, canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('combobox'));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('option', { name: /Paused/ }));
      await expect(args.onStatusChange).toHaveBeenCalledWith('paused');
   },
};
