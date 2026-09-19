import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, waitFor, within } from 'storybook/test';
import AgentCapabilitiesTab from './agent-capabilities-tab';
import { frontendAgent, importerAgent, storyHandlers } from './stories-fixtures';

const meta = {
   component: AgentCapabilitiesTab,
   tags: ['ai-generated', 'needs-work'],
   args: {
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
   play: async ({ args, canvas, userEvent }) => {
      // Assigned skills come from MSW; editing instructions raises the dirty flag.
      await expect(await canvas.findByText('design-tokens')).toBeVisible();
      await userEvent.type(
         canvas.getByRole('textbox', { name: 'Instructions' }),
         ' Keep diffs small.'
      );
      await waitFor(() => expect(args.onDirtyChange).toHaveBeenLastCalledWith(true));
   },
};

export const AssignSkills: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await canvas.findByText('design-tokens');
      await userEvent.click(canvas.getByRole('button', { name: 'Assign skills' }));
      // The picker offers only skills the agent does not carry yet.
      const dialog = within(await within(canvasElement.ownerDocument.body).findByRole('dialog'));
      await expect(dialog.getByRole('checkbox', { name: 'release-notes' })).toBeVisible();
      await expect(dialog.queryByRole('checkbox', { name: 'design-tokens' })).toBeNull();
   },
};

export const ReadOnly: Story = { args: { readOnly: true } };

/** An agent with no instructions and no skills. */
export const Blank: Story = { args: { agent: importerAgent } };
