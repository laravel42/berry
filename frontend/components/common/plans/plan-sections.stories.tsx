import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { useAgentsStore } from '@/store/agents-store';
import { useMembersStore } from '@/store/members-store';
import { healthPlan, planAgents, planMembers } from './plan-fixtures';
import { PlanApprovals, PlanAssumptions, PlanConnections, PlanIssues } from './plan-sections';

const meta = {
   component: PlanIssues,
   tags: ['ai-generated', 'needs-work'],
   args: { plan: healthPlan },
   beforeEach: () => {
      useAgentsStore.setState({ agents: planAgents });
      useMembersStore.setState({ members: planMembers });
   },
   decorators: [
      (Story) => (
         <div className="max-w-3xl">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof PlanIssues>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Tasks grouped under the two milestones they reach. */
export const WorkByMilestone: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByText('Health is stored on the server')).toBeVisible();
      // The suggested agent is resolved from the agents store by id.
      await expect(canvas.getAllByText('agent · Backend Engineer')).toHaveLength(2);
      await expect(canvas.getByText('agent · by capability')).toBeVisible();
   },
};

/** A plan written before milestones: one flat list under the goal. */
export const WorkWithoutMilestones: Story = {
   args: { plan: { ...healthPlan, milestones: [] } },
};

export const Assumptions: Story = {
   render: () => (
      <PlanAssumptions
         assumptions={[
            ...healthPlan.assumptions,
            {
               id: 'a-4',
               description: 'Who may change a project’s health?',
               confidence: 'low',
               userEditable: true,
               blocking: true,
               options: [],
            },
         ]}
      />
   ),
};

export const Connections: Story = {
   render: () => (
      <PlanConnections
         orgId="berry"
         connections={[
            { provider: 'github', purpose: 'Open pull requests', connected: true },
            { provider: 'slack', purpose: 'Post the weekly update', connected: false },
         ]}
      />
   ),
};

export const Approvals: Story = {
   render: (args) => <PlanApprovals plan={args.plan} />,
   play: async ({ canvas }) => {
      // A user approver is named from the members store, a role one generically.
      await expect(canvas.getByText(/Andrea Lunelio/)).toBeVisible();
      await expect(canvas.getByText(/any admin/)).toBeVisible();
   },
};
