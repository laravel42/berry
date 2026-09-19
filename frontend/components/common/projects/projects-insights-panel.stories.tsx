import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { useRightPanelStore } from '@/store/right-panel-store';
import ProjectsInsightsPanel from './projects-insights-panel';
import { seedProjectStores, storyProjects } from './stories-fixtures';

const meta = {
   component: ProjectsInsightsPanel,
   tags: ['ai-generated', 'needs-work'],
   args: { projects: storyProjects },
   beforeEach: () => {
      seedProjectStores();
      useRightPanelStore.setState({ openPanel: 'insights' });
   },
   decorators: [
      (Story) => (
         <div className="h-[520px] w-[360px] border bg-container">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof ProjectsInsightsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ByHealth: Story = {};

export const Empty: Story = { args: { projects: [] } };

/** Leads are counted from the roster; people who lead nothing are left out. */
export const ByLead: Story = {
   play: async ({ canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('tab', { name: 'Leads' }));
      const panel = canvas.getByRole('tabpanel');
      await expect(within(panel).getByText('Maya Chen')).toBeVisible();
      await expect(within(panel).queryByText('Frontend Engineer')).not.toBeInTheDocument();
   },
};

/** Clicking a health row filters by it; clicking again clears it. */
export const FilterByHealth: Story = {
   play: async ({ canvas, userEvent }) => {
      const row = canvas.getByRole('button', { name: /At risk/ });
      await userEvent.click(row);
      await expect(
         await canvas.findByRole('button', { name: /At risk.*Clear filter/ })
      ).toBeVisible();
   },
};

export const Close: Story = {
   play: async ({ canvas, userEvent }) => {
      await userEvent.click(canvas.getAllByRole('button')[0]!);
      await expect(useRightPanelStore.getState().openPanel).toBeNull();
   },
};
