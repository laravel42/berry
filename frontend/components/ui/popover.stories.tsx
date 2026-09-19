import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, waitFor, within } from 'storybook/test';
import { Button } from './button';
import { Input } from './input';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

const meta = {
   component: Popover,
   tags: ['ai-generated', 'needs-work'],
   render: (args) => (
      <Popover {...args}>
         <PopoverTrigger asChild>
            <Button size="xs" variant="outline">
               Set estimate
            </Button>
         </PopoverTrigger>
         <PopoverContent className="w-64">
            <div className="flex flex-col gap-2">
               <span className="font-medium">Estimate</span>
               <Input aria-label="Points" defaultValue="3" />
            </div>
         </PopoverContent>
      </Popover>
   ),
} satisfies Meta<typeof Popover>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Set estimate' }));
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByRole('textbox', { name: 'Points' })).toHaveValue('3');
      await userEvent.keyboard('{Escape}');
      // Presence unmounts the content a tick after the close, so wait for it.
      await waitFor(() => expect(body.queryByRole('textbox', { name: 'Points' })).toBeNull());
   },
};

export const Open: Story = { args: { open: true } };
