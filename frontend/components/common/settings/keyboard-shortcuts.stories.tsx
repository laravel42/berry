import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { useShortcutsStore } from '@/store/shortcuts-store';
import { KeyboardShortcuts } from './keyboard-shortcuts';

const meta = {
   component: KeyboardShortcuts,
   tags: ['ai-generated', 'needs-work'],
   beforeEach: () => {
      useShortcutsStore.setState({ overrides: {} });
   },
} satisfies Meta<typeof KeyboardShortcuts>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Defaults: Story = {};

export const Customised: Story = {
   beforeEach: () => {
      // One remapped, one switched off: the latter reads "Off", not "Not set".
      useShortcutsStore.setState({ overrides: { 'issue.create': 'n', 'inbox.archive': null } });
   },
   play: async ({ canvas }) => {
      await expect(
         canvas.getByRole('button', { name: 'Record a new shortcut for Archive the inbox item' })
      ).toHaveTextContent('Off');
   },
};

export const RecordingConflict: Story = {
   play: async ({ canvas, userEvent }) => {
      await userEvent.click(
         canvas.getByRole('button', { name: 'Record a new shortcut for Create a task' })
      );
      await expect(
         canvas.getByText('Press the keys you want. Escape cancels, Backspace clears.')
      ).toBeVisible();
      // "E" already archives inbox items, so the row names that action.
      await userEvent.keyboard('e');
      await expect(
         await canvas.findByText('Archive the inbox item already uses that.')
      ).toBeVisible();
   },
};

export const RestoreAllConfirm: Story = {
   beforeEach: () => {
      useShortcutsStore.setState({ overrides: { 'issue.create': 'n' } });
   },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Restore defaults' }));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('button', { name: 'Restore' }));
      await expect(useShortcutsStore.getState().overrides).toEqual({});
   },
};

export const NoMatches: Story = {
   play: async ({ canvas, userEvent }) => {
      await userEvent.type(canvas.getByRole('textbox', { name: 'Search shortcuts' }), 'teleport');
      await expect(canvas.getByText('No shortcut matches that.')).toBeVisible();
   },
};
