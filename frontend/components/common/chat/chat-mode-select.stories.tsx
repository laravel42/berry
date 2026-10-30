import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { useUiPrefsStore } from '@/store/ui-prefs-store';
import { ChatModeSelect } from './chat-mode-select';

const meta = {
   component: ChatModeSelect,
   tags: ['ai-generated'],
   beforeEach: () => {
      useUiPrefsStore.setState({ chatMode: 'agent' });
   },
} satisfies Meta<typeof ChatModeSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Collapsed: the button names the current mode, Agent by default. */
export const Collapsed: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('button', { name: 'Chat mode: Agent' })).toBeVisible();
   },
};

/** Opening the menu lists every mode with its hint, Agent marked recommended. */
export const OpenListsEveryMode: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Chat mode: Agent' }));
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findAllByRole('menuitemradio')).toHaveLength(5);
      await expect(body.getByText('recommended')).toBeVisible();
      await expect(body.getByText('Plan, search, build anything')).toBeVisible();
      await expect(
         body.getByText('Systematically diagnose and fix bugs using runtime traces')
      ).toBeVisible();
   },
};

/** Picking a mode updates the store and the button's own name. */
export const PickDebug: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Chat mode: Agent' }));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(
         body.getByRole('menuitemradio', {
            name: /Systematically diagnose and fix bugs using runtime traces/,
         })
      );
      await expect(canvas.getByRole('button', { name: 'Chat mode: Debug' })).toBeVisible();
      await expect(useUiPrefsStore.getState().chatMode).toBe('debug');
   },
};

export const Disabled: Story = {
   args: { disabled: true },
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('button', { name: 'Chat mode: Agent' })).toBeDisabled();
   },
};
