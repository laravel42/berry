import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';
import AgentActivityTab from './agent-activity-tab';
import { agentTasks, orgParams, storyHandlers } from './stories-fixtures';

const meta = {
   component: AgentActivityTab,
   tags: ['ai-generated', 'needs-work'],
   parameters: orgParams,
   args: {
      tasks: agentTasks,
      cursor: null,
      loadingMore: false,
      onLoadMore: fn(),
      onChanged: fn(),
      agentName: 'Frontend Engineer',
   },
   beforeEach: ({ msw }) => {
      msw.use(...storyHandlers);
   },
   decorators: [
      (Story) => (
         <div className="w-[760px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof AgentActivityTab>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One running, one queued, and a finished history with a timeout and a cancel. */
export const Mixed: Story = {};

export const OpenTranscript: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      const finished = canvas.getByText('Moved approvals and proposals into the inbox');
      const row = finished.closest('li');
      await expect(row).not.toBeNull();
      await userEvent.click(within(row as HTMLElement).getByRole('button', { name: 'Transcript' }));
      // The dialog streams the run from MSW and folds it into steps.
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByRole('dialog')).toBeVisible();
      await expect((await body.findAllByText('pnpm lint'))[0]).toBeVisible();
   },
};

export const CancelActive: Story = {
   play: async ({ args, canvas, canvasElement, userEvent }) => {
      const [first] = canvas.getAllByRole('button', { name: 'Cancel' });
      await userEvent.click(first!);
      // POST /api/v1/runs/:id/cancel answers (MSW); then the page is asked to re-read.
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText('Run cancelled')).toBeVisible();
      await expect(args.onChanged).toHaveBeenCalled();
   },
};

export const MorePages: Story = {
   args: { tasks: agentTasks.slice(2), cursor: 'cursor-2' },
   play: async ({ args, canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: /more/i }));
      await expect(args.onLoadMore).toHaveBeenCalled();
   },
};

export const Loading: Story = { args: { tasks: null } };

export const NothingYet: Story = { args: { tasks: [] } };
