import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { expect, fn, waitFor, within } from 'storybook/test';
import { MarkdownTextarea } from './markdown-textarea';

type TextareaProps = Parameters<typeof MarkdownTextarea>[0];

function Controlled(props: TextareaProps) {
   const [value, setValue] = useState(props.value);
   return (
      <MarkdownTextarea
         {...props}
         value={value}
         onChange={(next) => {
            setValue(next);
            props.onChange(next);
         }}
      />
   );
}

const meta = {
   component: MarkdownTextarea,
   tags: ['ai-generated', 'needs-work'],
   args: {
      'value': 'Persist project health',
      'onChange': fn(),
      'placeholder': 'Add description…',
      'aria-label': 'Description',
      'rows': 6,
   },
   render: (args) => <Controlled {...args} />,
   decorators: [
      (Story) => (
         <div className="w-[560px] pt-12">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof MarkdownTextarea>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Selecting text raises the format bar; Bold wraps the selection in `**`. */
export const FormatSelection: Story = {
   play: async ({ args, canvas, canvasElement, userEvent }) => {
      const field = canvas.getByRole('textbox', { name: 'Description' });
      await userEvent.tripleClick(field);
      const body = within(canvasElement.ownerDocument.body);
      const toolbar = await body.findByRole('toolbar', { name: 'Text formatting' });
      await userEvent.click(within(toolbar).getByRole('button', { name: 'Bold' }));
      await waitFor(() => expect(field).toHaveValue('**Persist project health**'));
      await expect(args.onChange).toHaveBeenCalledWith('**Persist project health**');
   },
};

export const Empty: Story = { args: { value: '' } };

/** The autopilot prompt: a longer Markdown body in a fixed-height field. */
export const AutopilotPrompt: Story = {
   args: {
      'value': `Every Monday, read last week's merged pull requests and write the changelog.

- Group by **area** (server, frontend, plugin SDK)
- Link each entry to its task, e.g. \`BERR-101\`
- Skip anything labelled ~~internal~~`,
      'aria-label': 'Autopilot prompt',
      'rows': 8,
   },
};
