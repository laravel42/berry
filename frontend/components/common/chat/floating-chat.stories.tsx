import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect } from 'storybook/test';
import { useSessionStore } from '@/store/session-store';
import { useShellStore } from '@/store/shell-store';
import { useUiPrefsStore } from '@/store/ui-prefs-store';
import { chatHandlers, chatSession, chatThreads } from './chat-fixtures';
import { FloatingChat } from './floating-chat';

const meta = {
   component: FloatingChat,
   tags: ['ai-generated', 'needs-work'],
   parameters: {
      layout: 'fullscreen',
      nextjs: { navigation: { pathname: '/berry/tasks', segments: [['orgId', 'berry']] } },
   },
   beforeEach: ({ msw }) => {
      useSessionStore.setState(chatSession);
      useUiPrefsStore.setState({ floatingChat: true });
      useShellStore.setState({ chatWindow: 'open' });
      msw.use(...chatHandlers);
   },
   decorators: [
      (Story) => (
         <div className="h-[640px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof FloatingChat>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Opens on a fresh conversation with the Orchestrator; one click and the composer is there. */
export const StartAConversation: Story = {
   beforeEach: ({ msw }) => {
      // Opening the Orchestrator's thread answers with its own conversation,
      // not the Backend Engineer one the shared handlers return.
      const orchestratorThread = {
         ...chatThreads[0]!,
         id: 'conv-orchestrator',
         topic: 'Orchestrator',
         agentId: 'agent-orchestrator',
         agentName: 'Orchestrator',
         pinned: false,
         lastMessage: null,
         lastMessageAuthor: null,
      };
      msw.use(
         http.get('*/api/v1/conversations', () =>
            HttpResponse.json({ nodes: [orchestratorThread, ...chatThreads] })
         ),
         http.post('*/api/v1/conversations/agents/:agentId', () =>
            HttpResponse.json({ id: orchestratorThread.id })
         )
      );
   },
   play: async ({ canvas, userEvent }) => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Start a chat' }));
      await expect(
         await canvas.findByRole('textbox', { name: 'Message Orchestrator…' })
      ).toBeVisible();
   },
};

export const Minimised: Story = {
   beforeEach: () => {
      useShellStore.setState({ chatWindow: 'minimised' });
   },
};

export const Expanded: Story = {
   beforeEach: () => {
      useShellStore.setState({ chatWindow: 'expanded' });
   },
};
