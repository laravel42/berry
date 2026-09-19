import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';
import {
   Select,
   SelectContent,
   SelectGroup,
   SelectItem,
   SelectLabel,
   SelectSeparator,
   SelectTrigger,
   SelectValue,
} from './select';

const meta = {
   component: Select,
   tags: ['ai-generated', 'needs-work'],
   args: { onValueChange: fn() },
   render: (args) => (
      <div className="w-[220px]">
         <Select {...args}>
            <SelectTrigger aria-label="Default role">
               <SelectValue placeholder="Choose a role" />
            </SelectTrigger>
            <SelectContent>
               <SelectGroup>
                  <SelectLabel>People</SelectLabel>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="member">Member</SelectItem>
               </SelectGroup>
               <SelectSeparator />
               <SelectItem value="guest" disabled>
                  Guest
               </SelectItem>
            </SelectContent>
         </Select>
      </div>
   ),
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Placeholder: Story = {
   play: async ({ args, canvas, canvasElement, userEvent }) => {
      const trigger = canvas.getByRole('combobox', { name: 'Default role' });
      await expect(trigger).toHaveTextContent('Choose a role');
      await userEvent.click(trigger);
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('option', { name: 'Member' }));
      await expect(args.onValueChange).toHaveBeenCalledWith('member');
      await expect(trigger).toHaveTextContent('Member');
   },
};

export const Selected: Story = { args: { defaultValue: 'admin' } };
export const Open: Story = { args: { defaultValue: 'member', open: true } };
export const Disabled: Story = { args: { defaultValue: 'member', disabled: true } };
