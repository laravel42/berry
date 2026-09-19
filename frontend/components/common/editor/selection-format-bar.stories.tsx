import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';
import { SelectionFormatBar } from './selection-format-bar';

const meta = {
   component: SelectionFormatBar,
   tags: ['ai-generated', 'needs-work'],
   args: { open: true, top: 120, left: 240, onFormat: fn() },
} satisfies Meta<typeof SelectionFormatBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Portalled to the body and fixed above the selection it was measured from. */
export const Open: Story = {
   play: async ({ args, canvasElement, userEvent }) => {
      const body = within(canvasElement.ownerDocument.body);
      const toolbar = body.getByRole('toolbar', { name: 'Text formatting' });
      await userEvent.click(within(toolbar).getByRole('button', { name: 'Strikethrough' }));
      await expect(args.onFormat).toHaveBeenCalledWith('strike');
   },
};

export const Closed: Story = {
   args: { open: false },
   play: async ({ canvasElement }) => {
      await expect(
         within(canvasElement.ownerDocument.body).queryByRole('toolbar')
      ).not.toBeInTheDocument();
   },
};
