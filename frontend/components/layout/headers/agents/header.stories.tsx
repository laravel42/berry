import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useAgentsListStore } from '@/store/agents-list-store';
import { useAgentsStore } from '@/store/agents-store';
import { agents, seedSession, workspaceRoute } from '../../stories-fixtures';
import Header from './header';

/** The agents page chrome: the title row over the toolbar. */
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

export const Admin: Story = {};

export const Member: Story = {
   beforeEach: () => {
      seedSession('viewer');
   },
};
