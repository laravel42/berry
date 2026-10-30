import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { getRouter } from 'next/navigation';
import { expect, waitFor } from 'storybook/test';
import { ShortcutProvider } from '@/components/layout/shortcut-provider';
import { useCreateIssueStore } from '@/store/create-issue-store';
import { useRightPanelStore } from '@/store/right-panel-store';
import { useShellStore } from '@/store/shell-store';
import { useShortcutsStore } from '@/store/shortcuts-store';
import { ShellShortcuts } from './shell-shortcuts';

/**
 * The shell's own keyboard bindings. `ShellShortcuts` renders nothing — the
 * listener lives in `ShortcutProvider`, mounted here as it is in `BerryShell`
 * — so every story presses a real key and checks the side effect it claims:
 * a store write, or a call on the mocked `next/navigation` router.
 */
const meta = {
   component: ShellShortcuts,
   tags: ['ai-generated'],
   args: { orgId: 'org-1' },
   render: (args) => (
      <ShortcutProvider>
         <ShellShortcuts {...args} />
      </ShortcutProvider>
   ),
   beforeEach: () => {
      useShortcutsStore.setState({ overrides: {} });
      useCreateIssueStore.setState({ isOpen: false });
      useShellStore.setState({ railOpen: true, railOverlayOpen: false });
      useRightPanelStore.setState({ openPanel: null });
   },
} satisfies Meta<typeof ShellShortcuts>;

export default meta;
type Story = StoryObj<typeof meta>;

/** `c` opens the new-task dialog from anywhere in the shell. */
export const CreateTaskOnC: Story = {
   play: async ({ userEvent }) => {
      await userEvent.keyboard('c');
      await waitFor(() => expect(useCreateIssueStore.getState().isOpen).toBe(true));
   },
};

/** `mod+b` toggles the rail column. */
export const ToggleSidebarOnModB: Story = {
   play: async ({ userEvent }) => {
      await userEvent.keyboard('{Control>}b{/Control}');
      await waitFor(() => expect(useShellStore.getState().railOpen).toBe(false));
   },
};

/** `mod+/` opens the insights panel when none is open, and closes it when one is. */
export const ToggleRightPanelOnModSlash: Story = {
   play: async ({ userEvent }) => {
      await userEvent.keyboard('{Control>}/{/Control}');
      await waitFor(() => expect(useRightPanelStore.getState().openPanel).toBe('insights'));
      await userEvent.keyboard('{Control>}/{/Control}');
      await waitFor(() => expect(useRightPanelStore.getState().openPanel).toBeNull());
   },
};

/** `g i`, a two-key sequence, navigates to the workspace inbox. */
export const GoToInboxSequence: Story = {
   play: async ({ userEvent }) => {
      await userEvent.keyboard('gi');
      await waitFor(() => expect(getRouter().push).toHaveBeenCalledWith('/org-1/inbox'));
   },
};
