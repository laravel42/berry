import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, fn } from 'storybook/test';
import { chatThreads } from './chat-fixtures';
import { ChatSidebar } from './chat-sidebar';

const meta = {
   component: ChatSidebar,
   tags: ['ai-generated', 'needs-work'],
   args: {
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

/** New chat is one click: there is no agent to choose, the Orchestrator answers. */
export const NewChat: Story = {
   play: async ({ args, canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'New chat' }));
      await expect(args.onNewChat).toHaveBeenCalled();
   },
};

export const NoAgents: Story = {
   args: { threads: [], activeId: null },
};
