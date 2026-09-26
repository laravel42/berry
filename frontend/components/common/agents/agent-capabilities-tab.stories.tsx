import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, waitFor } from 'storybook/test';
import AgentCapabilitiesTab from './agent-capabilities-tab';
import { frontendAgent, importerAgent, storyHandlers } from './stories-fixtures';

const meta = {
   component: AgentCapabilitiesTab,
   tags: ['ai-generated', 'needs-work'],
   args: {
      section: 'skills',
      agent: frontendAgent,
      readOnly: false,
      onChange: fn(),
      onDirtyChange: fn(),
      onForbidden: fn(),
   },
   beforeEach: ({ msw }) => {
      msw.use(...storyHandlers);
   },
   decorators: [
      (Story) => (
         <div className="h-[760px] w-[900px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof AgentCapabilitiesTab>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Editable: Story = {
   args: { section: 'instructions' },
   play: async ({ args, canvas, userEvent }) => {
      // Instructions are edited as sections; typing in one raises the dirty
      // flag and the unsaved-changes bar.
      await userEvent.type(
         canvas.getByRole('textbox', { name: 'Role and goal' }),
         ' Keep diffs small.'
      );
      await waitFor(() => expect(args.onDirtyChange).toHaveBeenLastCalledWith(true));
      await expect(canvas.getByText('Unsaved: instructions')).toBeVisible();
   },
};

export const AssignSkills: Story = {
   play: async ({ args, canvas, userEvent }) => {
      // Opens on the agent's active skills, from MSW.
      await expect(await canvas.findByText('design-tokens')).toBeVisible();
      await expect(canvas.queryByText('release-notes')).toBeNull();
      // All lists every skill as a switch; turning one on is a draft until saved.
      await userEvent.click(canvas.getByRole('button', { name: 'All' }));
      const releaseNotes = canvas.getByRole('switch', { name: /^release-notes/ });
      await expect(releaseNotes).not.toBeChecked();
      await expect(canvas.getByRole('switch', { name: /^design-tokens/ })).toBeChecked();
      await userEvent.click(releaseNotes);
      await expect(releaseNotes).toBeChecked();
      await waitFor(() => expect(args.onDirtyChange).toHaveBeenLastCalledWith(true));
      await userEvent.click(canvas.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(canvas.queryByText('Unsaved: skills')).toBeNull());
   },
};

export const ReadOnly: Story = { args: { readOnly: true } };

/** An agent with no instructions and no skills. */
export const Blank: Story = { args: { agent: importerAgent } };
