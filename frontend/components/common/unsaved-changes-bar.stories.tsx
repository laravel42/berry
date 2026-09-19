import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn } from 'storybook/test';
import { UnsavedChangesBar } from './unsaved-changes-bar';

const meta = {
   component: UnsavedChangesBar,
   tags: ['ai-generated', 'needs-work'],
   args: { what: 'instructions, starters', onDiscard: fn(), onSave: fn() },
   decorators: [
      (Story) => (
         <div className="w-[640px] border">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof UnsavedChangesBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Dirty: Story = {
   play: async ({ args, canvas, userEvent }) => {
      await expect(canvas.getByText('Unsaved: instructions, starters')).toBeVisible();
      await userEvent.click(canvas.getByRole('button', { name: 'Save' }));
      await expect(args.onSave).toHaveBeenCalledTimes(1);
      await userEvent.click(canvas.getByRole('button', { name: 'Discard' }));
      await expect(args.onDiscard).toHaveBeenCalledTimes(1);
   },
};

export const Saving: Story = {
   args: { busy: true },
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('button', { name: 'Saving…' })).toBeDisabled();
      await expect(canvas.getByRole('button', { name: 'Discard' })).toBeDisabled();
   },
};

export const CustomLabels: Story = {
   args: { what: 'role contract', discardLabel: 'Revert', saveLabel: 'Save role' },
};
