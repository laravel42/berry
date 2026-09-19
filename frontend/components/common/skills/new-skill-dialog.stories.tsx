import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, waitFor, within } from 'storybook/test';
import { skills, storyHandlers } from '@/components/common/agents/stories-fixtures';
import NewSkillDialog from './new-skill-dialog';

const meta = {
   component: NewSkillDialog,
   tags: ['ai-generated', 'needs-work'],
   args: {
      open: true,
      onOpenChange: fn(),
      onCreated: fn(),
      existingNames: skills.map((skill) => skill.name),
   },
   beforeEach: ({ msw }) => {
      msw.use(...storyHandlers);
   },
} satisfies Meta<typeof NewSkillDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Blank: Story = {};

/** The name is checked against the catalogue before any request. */
export const NameTaken: Story = {
   play: async ({ canvasElement, userEvent }) => {
      const dialog = within(await within(canvasElement.ownerDocument.body).findByRole('dialog'));
      await userEvent.type(dialog.getByRole('textbox', { name: /^Name/ }), 'design-tokens');
      await expect(
         dialog.getByText('This workspace already has a skill with that name.')
      ).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Create skill' })).toBeDisabled();
   },
};

export const Create: Story = {
   play: async ({ args, canvasElement, userEvent }) => {
      const dialog = within(await within(canvasElement.ownerDocument.body).findByRole('dialog'));
      await userEvent.type(dialog.getByRole('textbox', { name: /^Name/ }), 'incident-summary');
      await userEvent.type(
         dialog.getByRole('textbox', { name: 'Description' }),
         'Summarize an incident timeline for the postmortem.'
      );
      await userEvent.click(dialog.getByRole('button', { name: 'Create skill' }));
      // POST /api/v1/skills answers from MSW.
      await waitFor(() => expect(args.onCreated).toHaveBeenCalled());
      await expect(args.onOpenChange).toHaveBeenCalledWith(false);
   },
};
