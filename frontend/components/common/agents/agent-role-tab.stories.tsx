import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, waitFor } from 'storybook/test';
import { AgentRoleTab } from './agent-role-tab';
import { frontendAgent, releaseAgent, seedSession, storyHandlers } from './stories-fixtures';

const meta = {
   component: AgentRoleTab,
   tags: ['ai-generated', 'needs-work'],
   args: {
      agent: frontendAgent,
      readOnly: false,
      onReset: fn(),
      onChange: fn(),
      onDirtyChange: fn(),
   },
   beforeEach: ({ msw }) => {
      msw.use(...storyHandlers);
      seedSession('admin');
   },
   decorators: [
      (Story) => (
         <div className="h-[900px] w-[900px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof AgentRoleTab>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A customized role an admin can edit; the reset control is offered. */
export const AdminEditing: Story = {
   play: async ({ args, canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Add escalation' }));
      await waitFor(() => expect(args.onDirtyChange).toHaveBeenLastCalledWith(true));
   },
};

/** A member reads the contract but cannot change it. */
export const MemberReadOnly: Story = {
   beforeEach: () => {
      seedSession('member');
   },
};

export const NotARole: Story = {
   args: { agent: releaseAgent },
   play: async ({ canvas }) => {
      await expect(canvas.getByText(/not part of the organization/)).toBeVisible();
   },
};

/** The stored contract no longer validates, so only a reset is offered. */
export const InvalidContract: Story = {
   args: { agent: { ...frontendAgent, contract: null } },
};
