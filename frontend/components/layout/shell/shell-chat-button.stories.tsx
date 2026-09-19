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
         <div className="flex h-12 w-48 items-center justify-center bg-[var(--shell-canvas)] text-[var(--shell-text)]">
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
      const button = canvas.getByRole('button', { name: 'Open Agents' });
      await expect(button).toHaveAttribute('aria-expanded', 'false');
      await expect(button).toHaveTextContent('Agents');
      await userEvent.click(button);
      await expect(useShellStore.getState().chatWindow).not.toBe('closed');
      await expect(canvas.getByRole('button', { name: 'Close Agents' })).toHaveAttribute(
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
      await expect(canvas.getByRole('button', { name: 'Open Agents, 2 unread' })).toBeVisible();
   },
};

/** The chat page is the window's full-size counterpart, so the launcher rests there. */
export const OnChatPage: Story = {
   parameters: { nextjs: { navigation: workspaceRoute('/elian/chat') } },
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('button', { name: 'Open Agents' })).toBeDisabled();
   },
};

export const TurnedOff: Story = {
   beforeEach: () => {
      useUiPrefsStore.setState({ floatingChat: false });
   },
   play: async ({ canvas, userEvent }) => {
      // Launcher stays put when the panel preference is off; a click turns
      // the panel back on so origins that disagree on the pref (Chrome vs
      // Cursor's Simple Browser) do not lose the control.
      const button = canvas.getByRole('button', { name: 'Open Agents' });
      await expect(button).toBeVisible();
      await userEvent.click(button);
      await expect(useUiPrefsStore.getState().floatingChat).toBe(true);
      await expect(useShellStore.getState().chatWindow).not.toBe('closed');
   },
};
