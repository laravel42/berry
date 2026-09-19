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

/** Opens on "who": pinned agents, then recent ones, then the rest with the Orchestrator first. */
export const PickAnAgent: Story = {
   play: async ({ canvas, userEvent }) => {
      const pinned = await canvas.findByRole('list', { name: 'Pinned' });
      await expect(pinned).toHaveTextContent('Backend Engineer');
      await userEvent.click(
         canvas.getByRole('button', { name: 'Start a chat with Backend Engineer' })
      );
      // Opening the agent's thread loads its history into the window.
      await expect(
         await canvas.findByText('Great. Keep the migration forward-only please.')
      ).toBeVisible();
      await expect(
         canvas.getByRole('textbox', { name: 'Message Backend Engineer…' })
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
