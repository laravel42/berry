import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn } from 'storybook/test';
import { useProjectsDisplayStore } from '@/store/projects-display-store';
import type { ProjectGroup } from './projects';
import ProjectsList from './projects-list';
import {
   projectBilling,
   projectHealth,
   projectInbox,
   projectOnboarding,
   projectPatchHandler,
   projectRunner,
   seedProjectStores,
   storyProjects,
} from './stories-fixtures';

/** Status groups as the Projects page builds them. */
const statusGroups: ProjectGroup[] = [
   { id: 'to-do', name: 'Planned', projects: [projectInbox] },
   { id: 'in-progress', name: 'Active', projects: [projectHealth, projectRunner] },
   { id: 'paused', name: 'Paused', projects: [projectBilling] },
   { id: 'done', name: 'Completed', projects: [projectOnboarding] },
];

const meta = {
   component: ProjectsList,
   tags: ['ai-generated', 'needs-work'],
   args: { groups: statusGroups },
   parameters: { nextjs: { navigation: { segments: [['orgId', 'berry']] } } },
   beforeEach: ({ msw }) => {
      seedProjectStores();
      msw.use(projectPatchHandler);
   },
   decorators: [
      (Story) => (
         <div className="h-[560px] w-[1320px] border">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof ProjectsList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const GroupedByStatus: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getAllByRole('link')).toHaveLength(storyProjects.length);
      await expect(canvas.getByText('Paused')).toBeVisible();
   },
};

export const Ungrouped: Story = {
   args: { groups: [{ id: 'all', name: 'All projects', projects: storyProjects }] },
   beforeEach: () => {
      useProjectsDisplayStore.setState({ grouping: 'none' });
   },
};

/** An empty group (Show empty groups on) says so rather than vanishing. */
export const WithEmptyGroup: Story = {
   args: {
      groups: [...statusGroups, { id: 'cancelled', name: 'Cancelled', projects: [] }],
   },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('No projects')).toBeVisible();
   },
};

export const Selectable: Story = {
   args: { selected: [projectRunner.id], onToggleSelected: fn() },
   play: async ({ args, canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('checkbox', { name: `Select ${projectInbox.name}` }));
      await expect(args.onToggleSelected).toHaveBeenCalledWith(projectInbox.id);
   },
};
