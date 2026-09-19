import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { workspaceRoute } from '../../stories-fixtures';
import HeaderNav from './header-nav';

/**
 * The jump menu is the settings navigation below `lg`; at `lg` and up it is
 * hidden and the rail does the job.
 */
const meta = {
   component: HeaderNav,
   tags: ['ai-generated', 'needs-work'],
   parameters: {
      layout: 'fullscreen',
      nextjs: { navigation: workspaceRoute('/elian/settings/members') },
   },
} satisfies Meta<typeof HeaderNav>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The jump menu at phone width. It is `lg:hidden` (a viewport media query), so
 * there is no play here: the test browser is desktop-sized. Pick a mobile
 * viewport in Storybook to open it.
 */
export const Members: Story = {
   decorators: [
      (Story) => (
         <div className="w-[390px] border">
            <Story />
         </div>
      ),
   ],
   globals: { viewport: { value: 'mobile2', isRotated: false } },
};

/** A settings route the list does not know: the trigger falls back to "Settings". */
export const UnknownPage: Story = {
   parameters: { nextjs: { navigation: workspaceRoute('/elian/settings') } },
};

/** At `lg` and up the rail is the navigation, so the jump menu steps aside. */
export const Wide: Story = {
   parameters: { nextjs: { navigation: workspaceRoute('/elian/settings/preferences') } },
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('heading', { name: 'Settings' })).toBeVisible();
      await expect(canvas.queryByRole('button', { name: 'Settings pages' })).toBeNull();
   },
};
