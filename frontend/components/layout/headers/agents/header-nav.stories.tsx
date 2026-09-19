import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { seedSession, workspaceRoute } from '../../stories-fixtures';
import HeaderNav from './header-nav';

const meta = {
   component: HeaderNav,
   tags: ['ai-generated', 'needs-work'],
   parameters: {
      layout: 'fullscreen',
      nextjs: { navigation: workspaceRoute('/elian/agents') },
   },
   beforeEach: () => {
      seedSession('admin');
   },
} satisfies Meta<typeof HeaderNav>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Admin: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('link', { name: 'New agent' })).toHaveAttribute(
         'href',
         '/elian/agents/new'
      );
   },
};

/** A viewer can read the roster but not add to it. */
export const Viewer: Story = {
   beforeEach: () => {
      seedSession('viewer');
   },
   play: async ({ canvas }) => {
      await expect(canvas.queryByRole('link', { name: 'New agent' })).toBeNull();
   },
};
