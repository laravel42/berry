import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn } from 'storybook/test';
import { DescriptionTextarea } from './description-textarea';

const DESCRIPTION = `Project health lives only in the browser today.

- Add a \`health\` column and a forward-only migration
- Serve it from \`PATCH /api/v1/projects/{id}/health\`
- Read the chip from the API`;

const meta = {
   component: DescriptionTextarea,
   tags: ['ai-generated', 'needs-work'],
   args: {
      'value': DESCRIPTION,
      'onCommit': fn(),
      'onChange': fn(),
      'placeholder': 'Add description…',
      'aria-label': 'Description',
   },
   decorators: [
      (Story) => (
         <div className="w-[560px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof DescriptionTextarea>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Markdown is edited as the raw bytes that are stored; blur commits the change. */
export const CommitOnBlur: Story = {
   play: async ({ args, canvas, userEvent }) => {
      const field = canvas.getByRole('textbox', { name: 'Description' });
      await userEvent.click(field);
      await userEvent.type(field, '\n- Post a weekly update');
      await expect(args.onCommit).not.toHaveBeenCalled();
      await userEvent.tab();
      await expect(args.onCommit).toHaveBeenCalledWith(`${DESCRIPTION}\n- Post a weekly update`);
   },
};

export const Empty: Story = { args: { value: '' } };

/** Borrows the h2 step, as the plan prompt does. */
export const AsHeading: Story = {
   args: {
      'value': '',
      'data-heading': 'h2',
      'placeholder': 'What do you want to accomplish?',
      'aria-label': 'What do you want to accomplish?',
   },
};

export const ReadOnly: Story = {
   args: { readOnly: true },
   play: async ({ args, canvas, userEvent }) => {
      const field = canvas.getByRole('textbox', { name: 'Description' });
      await userEvent.click(field);
      await userEvent.tab();
      await expect(args.onCommit).not.toHaveBeenCalled();
   },
};
