import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, fn } from 'storybook/test';
import type { RoleContract } from '@/lib/organization';
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
      onForbidden: fn(),
   },
   beforeEach: ({ msw }) => {
      msw.use(
         http.put('*/api/v1/agents/:id/contract', async ({ request }) =>
            HttpResponse.json({
               ...frontendAgent,
               customized: true,
               contract: (await request.json()) as RoleContract,
            })
         ),
         ...storyHandlers
      );
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
/** An admin sets the autonomy level. */
export const AdminEditing: Story = {};

/** A member reads the level; nothing to change. */
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
