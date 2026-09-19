import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn } from 'storybook/test';
import { useIssuesStore } from '@/store/issues-store';
import AgentOverviewTab from './agent-overview-tab';
import {
   agentTasks,
   frontendAgent,
   importerAgent,
   issues,
   orchestratorAgent,
   orgParams,
   rosterMap,
   storyHandlers,
} from './stories-fixtures';

const meta = {
   component: AgentOverviewTab,
   tags: ['ai-generated', 'needs-work'],
   parameters: orgParams,
   args: {
      agent: frontendAgent,
      roster: rosterMap.get(frontendAgent.id),
      tasks: agentTasks,
      cursor: null,
      loadingMore: false,
      onLoadMore: fn(),
      onActivityChanged: fn(),
      onOpenSettings: fn(),
   },
   beforeEach: ({ msw }) => {
      msw.use(...storyHandlers);
      useIssuesStore.getState().hydrateIssues(issues);
   },
   decorators: [
      (Story) => (
         <div className="w-[1100px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof AgentOverviewTab>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Work queued on a runtime that stopped answering: the banner points at settings. */
export const Stalled: Story = {
   play: async ({ args, canvas, userEvent }) => {
      await expect(canvas.getByRole('button', { name: 'Choose one in settings' })).toBeVisible();
      await userEvent.click(canvas.getByRole('button', { name: 'Choose one in settings' }));
      await expect(args.onOpenSettings).toHaveBeenCalled();
   },
};

export const Healthy: Story = {
   args: { agent: orchestratorAgent, roster: rosterMap.get(orchestratorAgent.id), tasks: [] },
};

/** Never run, no model. */
export const NeverRan: Story = {
   args: { agent: importerAgent, roster: rosterMap.get(importerAgent.id), tasks: [] },
};

export const RosterLoading: Story = { args: { roster: undefined, tasks: null } };
