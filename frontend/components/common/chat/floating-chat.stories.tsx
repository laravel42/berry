import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { useSessionStore } from '@/store/session-store';
import { useShellStore } from '@/store/shell-store';
import { useUiPrefsStore } from '@/store/ui-prefs-store';
import { chatHandlers, chatSession } from './chat-fixtures';
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
