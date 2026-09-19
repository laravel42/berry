import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { useProjectsDisplayStore } from '@/store/projects-display-store';
import type { ProjectGroup } from './projects';
import ProjectsTimeline from './projects-timeline';
import {
   projectBilling,
   projectHealth,
   projectInbox,
   projectOnboarding,
   projectRunner,
   seedProjectStores,
} from './stories-fixtures';

const groups: ProjectGroup[] = [
   { id: 'to-do', name: 'Planned', projects: [projectInbox] },
   { id: 'in-progress', name: 'Active', projects: [projectHealth, projectRunner] },
   { id: 'paused', name: 'Paused', projects: [projectBilling] },
   { id: 'done', name: 'Completed', projects: [projectOnboarding] },
];

const meta = {
   component: ProjectsTimeline,
   tags: ['ai-generated', 'needs-work'],
   args: { groups },
   parameters: { nextjs: { navigation: { segments: [['orgId', 'berry']] } } },
   beforeEach: () => {
      seedProjectStores();
      useProjectsDisplayStore.setState({ viewType: 'timeline' });
   },
   decorators: [
      (Story) => (
         <div className="h-[560px] w-[1200px] border">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof ProjectsTimeline>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Year zoom, scrolled so today (Sep 18) sits a third in. */
export const YearZoom: Story = {
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('SEP 18')).toBeVisible();
   },
};

export const MonthZoom: Story = {
   beforeEach: () => {
      useProjectsDisplayStore.setState({ timelineZoom: 'month', showWeekNumbers: true });
   },
};

export const WithoutProjectList: Story = {
   beforeEach: () => {
      useProjectsDisplayStore.setState({ showProjectList: false });
   },
};

/** Clicking a bar opens the peek panel over the timeline. */
export const PeekAProject: Story = {
   play: async ({ canvas, userEvent }) => {
      const bars = canvas.getAllByRole('button', { name: new RegExp(projectRunner.name) });
      await userEvent.click(bars[0]!);
      await expect(await canvas.findByRole('link', { name: 'Open project' })).toBeVisible();
   },
};
