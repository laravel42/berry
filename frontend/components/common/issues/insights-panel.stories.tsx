import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { useRightPanelStore } from '@/store/right-panel-store';
import { InsightsPanel } from './insights-panel';
import { persistHealth, rotateKey, seedIssuesWorkspace, storyIssues } from './stories-fixtures';

const meta = {
   component: InsightsPanel,
   tags: ['ai-generated', 'needs-work'],
   args: { issues: storyIssues },
   decorators: [
      (Story) => (
         <aside className="flex h-[640px] w-[420px] overflow-hidden border-l bg-container">
            <Story />
         </aside>
      ),
   ],
   beforeEach: () => {
      seedIssuesWorkspace();
      useRightPanelStore.setState({ openPanel: 'insights' });
   },
} satisfies Meta<typeof InsightsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WholeQueue: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByText('tasks').parentElement).toHaveTextContent(/^8\s*tasks$/);
      // One row per status that has tasks: all seven here.
      const table = within(canvas.getByRole('table'));
      await expect(table.getAllByRole('row')).toHaveLength(8);
   },
};

export const ClickRowToFilter: Story = {
   play: async ({ canvas, userEvent }) => {
      const table = within(canvas.getByRole('table'));
      const row = table.getByRole('row', { name: /Blocked/ });
      await userEvent.click(row);
      await expect(within(row).getByText('Clear filter')).toBeInTheDocument();
      await userEvent.click(row);
      await expect(within(row).getByText('Filter')).toBeInTheDocument();
   },
};

export const FewTasks: Story = { args: { issues: [persistHealth, rotateKey] } };

export const NoTasks: Story = { args: { issues: [] } };
