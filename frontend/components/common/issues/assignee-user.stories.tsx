import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, waitFor, within } from 'storybook/test';
import { useAgentsStore } from '@/store/agents-store';
import { useIssuesStore } from '@/store/issues-store';
import { AssigneeUser } from './assignee-user';
import {
   agentUser,
   andrea,
   backendAgent,
   issueApiHandlers,
   maya,
   seedIssuesWorkspace,
   sharedFilter,
   storyAgents,
} from './stories-fixtures';

const meta = {
   component: AssigneeUser,
   tags: ['ai-generated', 'needs-work'],
   args: { user: andrea, issueId: sharedFilter.id, monogram: false, showName: true },
   beforeEach: ({ msw }) => {
      seedIssuesWorkspace();
      msw.use(...issueApiHandlers);
   },
} satisfies Meta<typeof AssigneeUser>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Person: Story = {
   play: async ({ canvas }) => {
      await expect(
         canvas.getByRole('button', { name: 'Assigned to Andrea Lunelio' })
      ).toBeInTheDocument();
   },
};

export const PersonAway: Story = { args: { user: maya } };

export const Agent: Story = { args: { user: agentUser(backendAgent) } };

export const AvatarOnly: Story = {
   args: { user: agentUser(backendAgent), showName: false, monogram: true },
};

export const Unassigned: Story = {
   args: { user: null, showName: false },
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('button', { name: 'Assign this task' })).toBeInTheDocument();
   },
};

export const HandToAnAgent: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: /Assigned to/ }));
      const body = within(canvasElement.ownerDocument.body);
      // Seven names is past the search threshold, so the search box leads.
      await userEvent.type(await body.findByRole('combobox'), 'Backend');
      await userEvent.click(await body.findByRole('option', { name: /Backend Engineer/ }));
      await waitFor(() =>
         expect(useIssuesStore.getState().getIssueById(sharedFilter.id)?.assignee?.id).toBe(
            backendAgent.id
         )
      );
   },
};

export const ManyAgentsCapped: Story = {
   beforeEach: () => {
      const roles = [
         'Product Manager',
         'Designer',
         'Data Engineer',
         'DevOps Engineer',
         'Database Engineer',
         'Security Engineer',
         'Technical Writer',
         'Mobile Engineer',
      ];
      useAgentsStore.setState({
         agents: [
            ...storyAgents,
            ...roles.map((name, index) => ({ ...backendAgent, id: `agent-role-${index}`, name })),
         ],
      });
   },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: /Assigned to/ }));
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText('Showing 10 of 12 agents. Type to search.')).toBeVisible();
   },
};
