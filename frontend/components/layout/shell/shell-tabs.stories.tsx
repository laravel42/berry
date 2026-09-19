import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn } from 'storybook/test';
import { shellTabs } from '../stories-fixtures';
import { ShellTabs } from './shell-tabs';

const meta = {
   component: ShellTabs,
   tags: ['ai-generated', 'needs-work'],
   args: {
      tabs: shellTabs,
      activeTabId: 'tab-2',
      onActivate: fn(),
      onClose: fn(),
      onNew: fn(),
   },
   parameters: { layout: 'fullscreen' },
   decorators: [
      (Story) => (
         <div className="flex h-[34px] w-full items-stretch bg-[var(--shell-rail)] font-mono font-light text-[var(--shell-text)] [--shell-strip:34px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof ShellTabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const IssueTabActive: Story = {
   play: async ({ canvas, args, userEvent }) => {
      // A page-supplied title wins over the route's label.
      const active = canvas.getByRole('tab', { name: 'BERR-42 Persist project health' });
      await expect(active).toHaveAttribute('aria-selected', 'true');
      // The strip is a roving tablist: arrows move the selection.
      active.focus();
      await userEvent.keyboard('{ArrowRight}');
      await expect(args.onActivate).toHaveBeenCalledWith(shellTabs[2]);
   },
};

export const CloseWithKeyboard: Story = {
   play: async ({ canvas, args, userEvent }) => {
      canvas.getByRole('tab', { name: 'BERR-42 Persist project health' }).focus();
      await userEvent.keyboard('{Delete}');
      await expect(args.onClose).toHaveBeenCalledWith('tab-2');
   },
};

/** Settings is not a tab, so nothing in the strip reads as selected there. */
export const NothingSelected: Story = {
   args: { activeTabId: null },
   play: async ({ canvas, args, userEvent }) => {
      await expect(canvas.queryByRole('tab', { selected: true })).toBeNull();
      await userEvent.click(canvas.getByRole('button', { name: 'New tab' }));
      await expect(args.onNew).toHaveBeenCalled();
   },
};

export const SingleTab: Story = {
   args: { tabs: [shellTabs[0]], activeTabId: 'tab-1' },
};
