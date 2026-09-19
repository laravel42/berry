import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { workspaceRoute } from '../stories-fixtures';
import { ShellRailSettings } from './shell-rail-settings';

const meta = {
   component: ShellRailSettings,
   tags: ['ai-generated', 'needs-work'],
   args: { orgId: 'elian' },
   parameters: { nextjs: { navigation: workspaceRoute('/elian/settings/members') } },
   decorators: [
      (Story) => (
         <nav className="w-[218px] bg-[var(--shell-rail)] pb-4 font-mono font-light text-[var(--shell-text)]">
            <Story />
         </nav>
      ),
   ],
} satisfies Meta<typeof ShellRailSettings>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Members: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('link', { name: 'Members' })).toHaveAttribute(
         'aria-current',
         'page'
      );
      await expect(canvas.getByRole('link', { name: 'Back to app' })).toHaveAttribute(
         'href',
         '/elian/tasks'
      );
   },
};

export const Preferences: Story = {
   parameters: { nextjs: { navigation: workspaceRoute('/elian/settings/preferences') } },
};

/** Below `lg` the rail is an overlay and carries its close control on the back row. */
export const WithCloseControl: Story = {
   args: {
      trailing: (
         <button type="button" className="rounded px-2 py-1 text-[var(--shell-text-muted)]">
            Close menu
         </button>
      ),
   },
};
