import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, fn, within } from 'storybook/test';
import { chatAgents, chatRoster, chatThreads, chatUser } from './chat-fixtures';
import { ChatSidebar } from './chat-sidebar';

const meta = {
   component: ChatSidebar,
   tags: ['ai-generated', 'needs-work'],
   args: {
      agents: chatAgents,
      roster: chatRoster,
      sessionUserId: chatUser.id,
      pinnedAgentIds: ['agent-backend', 'agent-orchestrator'],
      threads: chatThreads,
      archived: null,
      showArchived: false,
      onToggleArchived: fn(),
      activeId: 'conv-1',
      onNewChat: fn(),
      onTogglePinned: fn(),
      onSelect: fn(),
      onChanged: fn(),
      onStop: fn(),
   },
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/runtimes/agent-coverage', () =>
            HttpResponse.json({ defaultRuntimeId: 'rt-default', nodes: [] })
         )
      );
   },
   decorators: [
      (Story) => (
         <div className="flex h-[560px] text-[var(--shell-text)]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof ChatSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** The picker splits the agents this person made from everyone else's. */
export const NewChatPicker: Story = {
   play: async ({ args, canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'New chat' }));
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText('Mine')).toBeVisible();
      await expect(body.getByText('Others')).toBeVisible();
      await userEvent.click(body.getByRole('menuitem', { name: /Release Notes Writer/ }));
      await expect(args.onNewChat).toHaveBeenCalledWith(
         expect.objectContaining({ id: 'agent-mine' })
      );
   },
};

export const NoAgents: Story = {
   args: { agents: [], pinnedAgentIds: [], threads: [], activeId: null },
};
