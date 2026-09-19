import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';
import { useSidebarPrefsStore } from '@/store/sidebar-prefs-store';
import { CustomizeSidebarDialog } from './customize-sidebar-dialog';

const meta = {
   component: CustomizeSidebarDialog,
   tags: ['ai-generated', 'needs-work'],
   args: { open: true, onOpenChange: fn() },
   beforeEach: () => {
      useSidebarPrefsStore.setState(useSidebarPrefsStore.getInitialState());
   },
} satisfies Meta<typeof CustomizeSidebarDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Defaults: Story = {
   play: async ({ canvasElement }) => {
      const body = within(canvasElement.ownerDocument.body);
      const dialog = within(await body.findByRole('dialog', { name: 'Customize sidebar' }));
      await expect(dialog.getByText('Work')).toBeVisible();
      await expect(dialog.getByText('Manage')).toBeVisible();
      await expect(dialog.getByLabelText('Reorder Reviews')).toBeInTheDocument();
   },
};

/** Switching the badge style writes straight to the persisted preferences. */
export const DotBadges: Story = {
   play: async ({ canvasElement, userEvent }) => {
      const body = within(canvasElement.ownerDocument.body);
      const dialog = within(await body.findByRole('dialog', { name: 'Customize sidebar' }));
      await userEvent.click(dialog.getByRole('button', { name: /Count/ }));
      await userEvent.click(await body.findByRole('menuitem', { name: 'Dot' }));
      await expect(useSidebarPrefsStore.getState().badgeStyle).toBe('dot');
   },
};

/** Reviews shown only while something waits; usage hidden. */
export const Trimmed: Story = {
   beforeEach: () => {
      const { setVisibility } = useSidebarPrefsStore.getState();
      setVisibility('reviews', 'badged');
      setVisibility('usage', 'never');
   },
};
