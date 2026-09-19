import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { issues } from '@/components/layout/stories-fixtures';
import { useRightPanelStore } from '@/store/right-panel-store';
import { BreakdownPanel } from './breakdown-panel';

const meta = {
   component: BreakdownPanel,
   tags: ['ai-generated', 'needs-work'],
   args: { issues },
   decorators: [
      (Story) => (
         <div className="h-[420px] w-80 border-l bg-container">
            <Story />
         </div>
      ),
   ],
   beforeEach: () => {
      useRightPanelStore.setState({ openPanel: 'breakdown' });
   },
} satisfies Meta<typeof BreakdownPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ByLabel: Story = {
   play: async ({ canvas }) => {
      // Three of the four tasks carry `frontend`; the busiest label leads.
      const rows = canvas.getAllByText(/^(frontend|backend|bug)$/);
      await expect(rows[0]).toHaveTextContent('frontend');
   },
};

export const ByProject: Story = {
   play: async ({ canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Projects' }));
      await expect(canvas.getByText('Berry Web')).toBeVisible();
      await expect(canvas.getByText('Berry Server')).toBeVisible();
   },
};

export const Closing: Story = {
   play: async ({ canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Close panel' }));
      await expect(useRightPanelStore.getState().openPanel).toBeNull();
   },
};

export const NoTasks: Story = {
   args: { issues: [] },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('No data')).toBeVisible();
   },
};
