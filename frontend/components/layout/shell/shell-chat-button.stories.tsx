import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { useShellStore } from '@/store/shell-store';
import { useUiPrefsStore } from '@/store/ui-prefs-store';
import { workspaceRoute } from '../stories-fixtures';
import { ShellChatButton } from './shell-chat-button';

const meta = {
   component: ShellChatButton,
   tags: ['ai-generated', 'needs-work'],
   parameters: { nextjs: { navigation: workspaceRoute('/elian/tasks') } },
   decorators: [
      (Story) => (
         <div className="flex h-[34px] w-40 items-stretch justify-end bg-[var(--shell-rail)] px-2 text-[var(--shell-text)]">
            <Story />
         </div>
      ),
   ],
   beforeEach: () => {
      useUiPrefsStore.setState({ floatingChat: true });
      useShellStore.setState({ chatWindow: 'closed', chatUnread: 0 });
   },
} satisfies Meta<typeof ShellChatButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {
   play: async ({ canvas, userEvent }) => {
      const button = canvas.getByRole('button', { name: 'Open chat' });
      await expect(button).toHaveAttribute('aria-expanded', 'false');
      await userEvent.click(button);
      await expect(useShellStore.getState().chatWindow).not.toBe('closed');
      await expect(canvas.getByRole('button', { name: 'Close chat' })).toHaveAttribute(
         'aria-expanded',
         'true'
      );
   },
};

export const Unread: Story = {
   beforeEach: () => {
      useShellStore.setState({ chatUnread: 2 });
   },
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('button', { name: 'Open chat, 2 unread' })).toBeVisible();
   },
};

/** The chat page is the window's full-size counterpart, so the launcher rests there. */
export const OnChatPage: Story = {
   parameters: { nextjs: { navigation: workspaceRoute('/elian/chat') } },
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('button', { name: 'Open chat' })).toBeDisabled();
   },
};

export const TurnedOff: Story = {
   beforeEach: () => {
      useUiPrefsStore.setState({ floatingChat: false });
   },
   play: async ({ canvas }) => {
      await expect(canvas.queryByRole('button', { name: /chat/i })).toBeNull();
   },
};
