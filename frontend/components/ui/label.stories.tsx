import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { Input } from './input';
import { Label } from './label';

const meta = {
   component: Label,
   tags: ['ai-generated', 'needs-work'],
   args: { children: 'Task prefix', htmlFor: 'prefix' },
   render: (args) => (
      <div className="flex w-[240px] flex-col gap-1.5">
         <Label {...args} />
         <Input id="prefix" defaultValue="BERR" className="font-mono" />
      </div>
   ),
} satisfies Meta<typeof Label>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithInput: Story = {
   play: async ({ canvas }) => {
      // htmlFor names the field for assistive tech.
      await expect(canvas.getByRole('textbox', { name: 'Task prefix' })).toHaveValue('BERR');
   },
};
