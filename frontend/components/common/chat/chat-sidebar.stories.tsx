import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, fn } from 'storybook/test';
import { chatAgents, chatRoster, chatThreads, chatUser } from './chat-fixtures';
import { ChatSidebar } from './chat-sidebar';

const meta = {
   component: ChatSidebar,
   tags: ['ai-generated', 'needs-work'],
   args: {
      agents: chatAgents,
      roster: chatRoster,
      sessionUserId: chatUser.id,
      threads: chatThreads,
      archived: null,
      showArchived: false,
      onToggleArchived: fn(),
      activeId: 'conv-1',
      onNewChat: fn(),
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

/** New chat opens the roster; choosing an agent starts that conversation. */
export const NewChat: Story = {
   play: async ({ args, canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'New chat' }));
      await userEvent.click(await canvas.findByRole('menuitem', { name: 'Backend Engineer' }));
      await expect(args.onNewChat).toHaveBeenCalled();
   },
};

export const NoAgents: Story = {
   args: { agents: [], threads: [], activeId: null },
};
