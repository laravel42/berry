import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { useProjectsDisplayStore } from '@/store/projects-display-store';
import { ProjectsDisplayOptions } from './projects-display-options';

const meta = {
   component: ProjectsDisplayOptions,
   tags: ['ai-generated', 'needs-work'],
   beforeEach: () => {
      useProjectsDisplayStore.getState().resetDisplaySettings();
   },
   decorators: [
      (Story) => (
         <div className="flex w-[480px] justify-end">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof ProjectsDisplayOptions>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {};

/** List view: the empty-groups switch and the display properties. */
export const OpenList: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Display' }));
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText('List options')).toBeVisible();
      await expect(body.getByText('Show empty groups')).toBeVisible();
   },
};

/** Switching to Timeline swaps in the timeline-only switches. */
export const SwitchToTimeline: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Display' }));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('button', { name: 'Timeline' }));
      await expect(useProjectsDisplayStore.getState().viewType).toBe('timeline');
      await expect(await body.findByText('Show week numbers')).toBeVisible();
   },
};

export const ToggleProperty: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Display' }));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('button', { name: 'Labels' }));
      await expect(useProjectsDisplayStore.getState().displayProperties.labels).toBe(true);
   },
};

/** The board wording: columns, not groups. */
export const BoardView: Story = {
   beforeEach: () => {
      useProjectsDisplayStore.setState({ viewType: 'board' });
   },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Display' }));
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText('Show empty columns')).toBeVisible();
   },
};
