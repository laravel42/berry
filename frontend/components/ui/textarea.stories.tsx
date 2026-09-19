import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { Textarea } from './textarea';

const meta = {
   component: Textarea,
   tags: ['ai-generated', 'needs-work'],
   args: { 'placeholder': 'What this workspace is for', 'aria-label': 'Description' },
   decorators: [
      (Story) => (
         <div className="w-[420px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const Filled: Story = {
   args: {
      defaultValue:
         'The platform team. Agents working here should read ADR-0014 before touching the dispatcher.',
   },
};

export const PreservesWhitespace: Story = {
   args: { defaultValue: 'line one\n\n  indented line three' },
   play: async ({ canvas }) => {
      // Descriptions are saved byte-exact: the field must not trim anything.
      await expect(canvas.getByRole('textbox')).toHaveValue('line one\n\n  indented line three');
   },
};

export const Disabled: Story = { args: { defaultValue: 'Read only', disabled: true } };
