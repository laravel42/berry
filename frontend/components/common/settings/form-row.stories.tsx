import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { Input } from '@/components/ui/input';
import { FormRow } from './form-row';

const meta = {
   component: FormRow,
   tags: ['ai-generated'],
   args: {
      label: 'Workspace name',
      caption: 'Shown on invitations and the switcher.',
      children: <Input defaultValue="Acme Engineering" />,
   },
} satisfies Meta<typeof FormRow>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Label, caption and the control all render. */
export const Default: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByText('Workspace name')).toBeVisible();
      await expect(canvas.getByText('Shown on invitations and the switcher.')).toBeVisible();
      await expect(canvas.getByRole('textbox')).toHaveValue('Acme Engineering');
   },
};

/** `htmlFor` turns the label into a real `<label>` that focuses the control. */
export const LabelledControl: Story = {
   args: {
      htmlFor: 'workspace-name',
      children: <Input id="workspace-name" defaultValue="Acme Engineering" />,
   },
   play: async ({ canvas }) => {
      await expect(canvas.getByLabelText('Workspace name')).toHaveValue('Acme Engineering');
   },
};

/** No caption: only the label and the control fill the left column. */
export const NoCaption: Story = {
   args: { caption: undefined },
   play: async ({ canvas }) => {
      await expect(canvas.queryByText('Shown on invitations and the switcher.')).toBeNull();
   },
};
