import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { IssueGantt } from './issue-gantt';
import {
   issueApiHandlers,
   persistHealth,
   seedIssuesWorkspace,
   storyIssues,
   tightenSurfaces,
} from './stories-fixtures';

/** A due date set before the task was created: drawn as a warning, not a bar. */
const inverted = {
   ...tightenSurfaces,
   id: 'issue-50',
   identifier: 'BERR-50',
   title: 'Backfill run usage for August',
   status: persistHealth.status,
   createdAt: '2026-09-12T09:00:00Z',
   dueDate: '2026-09-05T12:00:00.000Z',
};

const meta = {
   component: IssueGantt,
   tags: ['ai-generated', 'needs-work'],
   args: { issues: storyIssues },
   decorators: [
      (Story) => (
         <div className="h-[560px] w-[1200px] overflow-hidden border bg-container">
            <Story />
         </div>
      ),
   ],
   beforeEach: ({ msw }) => {
      seedIssuesWorkspace({ layout: 'gantt' });
      msw.use(...issueApiHandlers);
   },
} satisfies Meta<typeof IssueGantt>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Timeline: Story = {
   play: async ({ canvas }) => {
      // Tasks with a due date get a bar with a drag handle on its right edge.
      await expect(
         canvas.getAllByRole('button', { name: 'Drag to change due date' }).length
      ).toBeGreaterThan(0);
      await expect(canvas.getByText('No due date')).toBeInTheDocument();
   },
};

/** Zoom is local state, so the story clicks its way there. */
export const DayZoom: Story = {
   play: async ({ canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Day' }));
   },
};

export const DueBeforeCreated: Story = {
   args: { issues: [...storyIssues, inverted] },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('1 tasks end before they start')).toBeInTheDocument();
   },
};

export const HideCompleted: Story = {
   play: async ({ canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('switch', { name: 'Show completed' }));
      await expect(canvas.queryByText(tightenSurfaces.title)).toBeNull();
   },
};

export const Empty: Story = { args: { issues: [] } };
