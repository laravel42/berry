import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { expect, fn } from 'storybook/test';
import type { PluginConfigValue } from '@/lib/plugins';
import { PluginConfigForm } from './plugin-config-form';
import { pluginConfigFields } from './stories-fixtures';

const meta = {
   component: PluginConfigForm,
   tags: ['ai-generated', 'needs-work'],
   args: {
      fields: pluginConfigFields,
      value: { channel: '#eng-standup', digestHour: 8, mentionAssignee: true },
      onChange: fn(),
   },
   decorators: [
      (Story) => (
         <div className="max-w-xl">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof PluginConfigForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Filled: Story = {};

export const Empty: Story = {
   args: { value: {} },
};

export const Disabled: Story = {
   args: { disabled: true },
};

/** Controlled like the install and detail pages use it. */
export const Editing: Story = {
   render: function Render(args) {
      const [value, setValue] = useState<Record<string, PluginConfigValue>>(args.value);
      return (
         <PluginConfigForm
            {...args}
            value={value}
            onChange={(next) => {
               setValue(next);
               args.onChange(next);
            }}
         />
      );
   },
   play: async ({ args, canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('switch'));
      await expect(args.onChange).toHaveBeenLastCalledWith(
         expect.objectContaining({ mentionAssignee: false })
      );
   },
};
