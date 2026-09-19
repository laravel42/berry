import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { useAgentsListStore } from '@/store/agents-list-store';
import { useAgentsStore } from '@/store/agents-store';
import { agents, seedSession, workspaceRoute } from '../../stories-fixtures';
import Header from './header';

/** The agents page chrome: toolbar with scope, filters, and New agent. */
const meta = {
   component: Header,
   tags: ['ai-generated', 'needs-work'],
   parameters: {
      layout: 'fullscreen',
      nextjs: { navigation: workspaceRoute('/elian/agents') },
   },
   beforeEach: () => {
      seedSession('admin');
      useAgentsListStore.setState(useAgentsListStore.getInitialState());
      useAgentsStore.setState({ agents, archived: null });
   },
} satisfies Meta<typeof Header>;

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

export const Member: Story = {
   beforeEach: () => {
      seedSession('viewer');
   },
};
