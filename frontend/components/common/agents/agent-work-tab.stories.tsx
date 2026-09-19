import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { useIssuesStore } from '@/store/issues-store';
import AgentWorkTab from './agent-work-tab';
import { frontendAgent, issues, orgParams, releaseAgent } from './stories-fixtures';

const meta = {
   component: AgentWorkTab,
   tags: ['ai-generated', 'needs-work'],
   parameters: orgParams,
   args: { agentId: frontendAgent.id },
   beforeEach: () => {
      useIssuesStore.getState().hydrateIssues(issues);
   },
   decorators: [
      (Story) => (
         <div className="w-[760px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof AgentWorkTab>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Assigned: Story = {
   play: async ({ canvas }) => {
      // Only this agent's issues, each linking into the workspace.
      await expect(canvas.getAllByRole('link')).toHaveLength(3);
      await expect(canvas.getByRole('link', { name: /BERR-42/ })).toHaveAttribute(
         'href',
         '/berry/issue/issue-42'
      );
   },
};

export const NothingAssigned: Story = { args: { agentId: releaseAgent.id } };

/** Inside the overview, without the page padding. */
export const Embedded: Story = { args: { embedded: true } };
