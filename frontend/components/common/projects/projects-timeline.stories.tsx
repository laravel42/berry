import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { format } from 'date-fns';
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
      useProjectsDisplayStore.setState({
         viewType: 'timeline',
         timelineZoom: 'year',
         showProjectList: true,
         showWeekNumbers: false,
      });
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

/** Year zoom, scrolled so today sits a third in. */
export const YearZoom: Story = {
   play: async ({ canvas }) => {
      const today = format(new Date(), 'MMM d').toUpperCase();
      await expect(await canvas.findByText(today)).toBeVisible();
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
