import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, waitFor } from 'storybook/test';
import {
   autopilots,
   liveAgents,
   orgParams,
   storyHandlers,
} from '@/components/common/agents/stories-fixtures';
import type { Autopilot } from '@/lib/autopilots';
import Autopilots from './autopilots';
import { DEFAULT_AUTOPILOT_CRITERIA } from './autopilots-filters';

const assigneeName = (autopilot: Autopilot) =>
   liveAgents.find((agent) => agent.id === autopilot.assigneeId)?.name ?? 'Someone who is gone';

const meta = {
   component: Autopilots,
   tags: ['ai-generated', 'needs-work'],
   parameters: orgParams,
   args: {
      autopilots,
      loaded: true,
      error: null,
      criteria: DEFAULT_AUTOPILOT_CRITERIA,
      assigneeName,
      canEdit: true,
      onChanged: fn(),
      onStatusChange: fn(),
      narrowed: false,
      empty: false,
      onUseTemplate: fn(),
   },
   beforeEach: ({ msw }) => {
      msw.use(...storyHandlers);
   },
   decorators: [
      (Story) => (
         <div className="flex h-[480px] w-[1280px] flex-col border">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof Autopilots>;

export default meta;
type Story = StoryObj<typeof meta>;

export const List: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('link', { name: /Morning triage/ })).toHaveAttribute(
         'href',
         '/berry/autopilots/ap-triage'
      );
   },
};

/** Every column, newest first. */
export const AllColumns: Story = {
   args: {
      criteria: {
         sort: 'created',
         sortDescending: true,
         columns: ['agent', 'lastRun', 'nextRun', 'mode', 'quota', 'updated'],
      },
   },
};

export const PauseFromSwitch: Story = {
   play: async ({ args, canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('switch', { name: 'Morning triage is active' }));
      // Optimistic first, then PATCH /api/v1/autopilots/:id answers from MSW.
      await expect(args.onStatusChange).toHaveBeenCalledWith('ap-triage', 'paused');
      await waitFor(() => expect(args.onChanged).toHaveBeenCalled());
   },
};

/** An empty workspace offers templates to start from. */
export const EmptyWithTemplates: Story = {
   args: { autopilots: [], empty: true },
   play: async ({ args, canvas, userEvent }) => {
      await expect(canvas.getByText('Every Friday')).toBeVisible();
      const [, , , digest] = canvas.getAllByRole('button', { name: 'Use template' });
      await userEvent.click(digest!);
      await expect(args.onUseTemplate).toHaveBeenCalledWith('digest');
   },
};

export const NoMatch: Story = { args: { autopilots: [], narrowed: true, query: 'deploy' } };

export const ReadOnly: Story = { args: { canEdit: false } };

export const Loading: Story = { args: { loaded: false } };

export const LoadFailed: Story = {
   args: { loaded: false, error: 'Your role cannot change autopilots in this workspace.' },
};
