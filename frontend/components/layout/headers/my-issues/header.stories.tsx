import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { useCreateIssueStore } from '@/store/create-issue-store';
import { useIssuesStore } from '@/store/issues-store';
import { useRightPanelStore } from '@/store/right-panel-store';
import { issues, seedSession, shellHandlers, workspaceRoute } from '../../stories-fixtures';
import Header from './header';

const meta = {
   component: Header,
   tags: ['ai-generated', 'needs-work'],
   parameters: {
      layout: 'fullscreen',
      nextjs: { navigation: workspaceRoute('/elian/tasks') },
   },
   decorators: [
      (Story) => (
         <div className="flex w-full flex-col">
            <Story />
         </div>
      ),
   ],
   beforeEach: ({ msw }) => {
      seedSession('admin');
      useIssuesStore.getState().hydrateIssues(issues);
      useRightPanelStore.setState({ openPanel: null });
      useCreateIssueStore.setState({ isOpen: false });
      msw.use(...shellHandlers);
   },
} satisfies Meta<typeof Header>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Admin: Story = {
   play: async ({ canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Create task' }));
      await expect(useCreateIssueStore.getState().isOpen).toBe(true);
   },
};

/** A viewer reads the list; nothing offers to create in it. */
export const Viewer: Story = {
   beforeEach: () => {
      seedSession('viewer');
   },
   play: async ({ canvas }) => {
      await expect(canvas.queryByRole('button', { name: 'Create task' })).toBeNull();
   },
};

/** Insights open: its toggle reads as pressed (desktop only). */
export const InsightsOpen: Story = {
   beforeEach: () => {
      useRightPanelStore.setState({ openPanel: 'insights' });
   },
};
