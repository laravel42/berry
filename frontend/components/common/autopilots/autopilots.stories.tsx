import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, waitFor } from 'storybook/test';
import {
   autopilots,
   liveAgents,
   loopTemplates,
   orgParams,
   storyHandlers,
} from '@/components/common/agents/stories-fixtures';
import type { Autopilot } from '@/lib/autopilots';
import Autopilots from './autopilots';

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
      assigneeName,
      canEdit: true,
      onChanged: fn(),
      narrowed: false,
      templates: loopTemplates,
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
         '/berry/loop/ap-triage'
      );
   },
};

/** The switch on a card pauses its Loop in place. */
export const PauseFromSwitch: Story = {
   play: async ({ args, canvas, userEvent }) => {
      const [firstSwitch] = canvas.getAllByRole('switch', { name: 'Pause' });
      await userEvent.click(firstSwitch!);
      // PATCH /api/v1/autopilots/:id answers from MSW; then the page re-reads.
      await waitFor(() => expect(args.onChanged).toHaveBeenCalled());
   },
};

/** An empty workspace offers templates to start from. */
export const EmptyWithTemplates: Story = {
   args: { autopilots: [] },
   play: async ({ args, canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: /Triage new bugs/ }));
      await expect(args.onUseTemplate).toHaveBeenCalledWith(
         expect.objectContaining({ key: 'bug-triage' })
      );
   },
};

export const NoMatch: Story = { args: { autopilots: [], narrowed: true } };

export const ReadOnly: Story = { args: { canEdit: false } };

export const Loading: Story = { args: { loaded: false } };

export const LoadFailed: Story = {
   args: { loaded: false, error: 'Your role cannot change loops in this workspace.' },
};
