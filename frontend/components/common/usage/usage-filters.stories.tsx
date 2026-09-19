import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, waitFor, within } from 'storybook/test';

import { makeProject } from '@/components/common/projects/stories-fixtures';
import { useProjectsStore } from '@/store/projects-store';

import UsageFilters from './usage-filters';

const projects = [
   makeProject({ id: 'project-1', name: 'Berry' }),
   makeProject({ id: 'project-2', name: 'Plugin SDK' }),
   makeProject({ id: 'project-3', name: 'Marketing site' }),
];

const meta = {
   component: UsageFilters,
   tags: ['ai-generated', 'needs-work'],
   args: {
      timeframe: 'window',
      query: { days: 30, timezone: 'UTC', projectId: null },
      onChange: fn(),
      onRefresh: fn(),
      lastUpdated: new Date('2026-09-18T11:58:00Z'),
      loading: false,
   },
   beforeEach: () => {
      useProjectsStore.setState({ projects });
   },
   decorators: [
      (Story) => (
         <div className="w-[880px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof UsageFilters>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Picking a window reports the whole query back, with only `days` changed. */
export const Default: Story = {
   play: async ({ args, canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: '90 days' }));
      await expect(args.onChange).toHaveBeenCalledWith({
         days: 90,
         timezone: 'UTC',
         projectId: null,
      });
   },
};

/** The project picker lists the workspace's projects from the projects store. */
export const PickProject: Story = {
   play: async ({ args, canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('combobox', { name: 'Project: All projects' }));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('option', { name: 'Plugin SDK' }));
      await expect(args.onChange).toHaveBeenCalledWith({
         days: 30,
         timezone: 'UTC',
         projectId: 'project-2',
      });
   },
};

/** A project already chosen shows its name. */
export const ProjectSelected: Story = {
   args: { query: { days: 7, timezone: 'Europe/Rome', projectId: 'project-1' } },
   play: async ({ canvas }) => {
      await waitFor(() =>
         expect(canvas.getByRole('combobox', { name: 'Project: Berry' })).toBeVisible()
      );
   },
};

export const NeverLoaded: Story = {
   args: { lastUpdated: null, loading: true },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('Not loaded yet')).toBeVisible();
      await expect(canvas.getByRole('button', { name: 'Refresh' })).toBeDisabled();
   },
};

/** On Overview nothing is windowed: the range control is not offered, the project filter is. */
export const Live: Story = {
   args: { timeframe: 'live' },
   play: async ({ canvas }) => {
      await expect(canvas.queryByRole('group', { name: 'Time range' })).not.toBeInTheDocument();
      await expect(canvas.getByRole('combobox', { name: 'Project: All projects' })).toBeVisible();
   },
};
