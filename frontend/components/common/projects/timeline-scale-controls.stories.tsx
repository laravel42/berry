import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { useProjectsDisplayStore } from '@/store/projects-display-store';
import { TimelineScaleControls } from './timeline-scale-controls';

const meta = {
   component: TimelineScaleControls,
   tags: ['ai-generated', 'needs-work'],
   beforeEach: () => {
      useProjectsDisplayStore.getState().resetDisplaySettings();
   },
   decorators: [
      (Story) => (
         <div className="flex items-center gap-1">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof TimelineScaleControls>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Year is the default zoom. */
export const Default: Story = {};

export const MonthZoom: Story = {
   beforeEach: () => {
      useProjectsDisplayStore.setState({ timelineZoom: 'month' });
   },
};

export const ChangeZoom: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Year' }));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('menuitem', { name: /Quarter/ }));
      await expect(useProjectsDisplayStore.getState().timelineZoom).toBe('quarter');
      await expect(canvas.getByRole('button', { name: 'Quarter' })).toBeVisible();
   },
};

/** "Today" asks the mounted timeline to scroll by bumping a counter. */
export const JumpToToday: Story = {
   play: async ({ canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Today' }));
      await expect(useProjectsDisplayStore.getState().todayJumpId).toBe(1);
   },
};
