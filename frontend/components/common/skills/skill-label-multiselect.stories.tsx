import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn } from 'storybook/test';
import { SkillLabelMultiselect } from './skill-label-multiselect';

const meta = {
   component: SkillLabelMultiselect,
   tags: ['ai-generated', 'needs-work'],
   args: { value: ['frontend', 'design', 'accessibility'], onChange: fn() },
} satisfies Meta<typeof SkillLabelMultiselect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Labels: Story = {
   play: async ({ args, canvas, userEvent }) => {
      // A chip is its own remove button.
      await userEvent.click(canvas.getByRole('button', { name: 'design' }));
      await expect(args.onChange).toHaveBeenCalledWith(['frontend', 'accessibility']);
   },
};

export const NoLabels: Story = { args: { value: [] } };

export const ReadOnly: Story = {
   args: { disabled: true },
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('button', { name: 'frontend' })).toBeDisabled();
   },
};
