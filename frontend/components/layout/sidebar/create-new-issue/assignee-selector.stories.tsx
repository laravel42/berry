import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';
import { agents, issues, me, teammate } from '@/components/layout/stories-fixtures';
import { useAgentsStore } from '@/store/agents-store';
import { useIssuesStore } from '@/store/issues-store';
import { useMembersStore } from '@/store/members-store';
import { AssigneeSelector } from './assignee-selector';

const meta = {
   component: AssigneeSelector,
   tags: ['ai-generated', 'needs-work'],
   args: { assignee: null, onChange: fn() },
   beforeEach: () => {
      useIssuesStore.getState().hydrateIssues(issues);
      useMembersStore.setState({ members: [me, teammate] });
      useAgentsStore.setState({ agents });
   },
} satisfies Meta<typeof AssigneeSelector>;

export default meta;
type Story = StoryObj<typeof meta>;

/** People and agents in one list, each with how many tasks they hold. */
export const Unassigned: Story = {
   play: async ({ canvas, canvasElement, args, userEvent }) => {
      await userEvent.click(canvas.getByRole('combobox', { name: 'No assignee' }));
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText('People')).toBeVisible();
      await userEvent.click(body.getByRole('option', { name: /Mara Okafor/ }));
      await expect(args.onChange).toHaveBeenCalledWith(teammate);
   },
};

export const AssignedToMe: Story = {
   args: { assignee: me },
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('combobox', { name: 'Assigned to Elian Rossi' })).toBeVisible();
   },
};

/** Handing a task over: roles only, the Orchestrator first, each with what it is for. */
export const AgentsOnly: Story = {
   args: { scope: 'agents', placeholder: 'Choose an agent' },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('combobox', { name: 'Choose an agent' }));
      const body = within(canvasElement.ownerDocument.body);
      const options = await body.findAllByRole('option');
      await expect(options[0]).toHaveTextContent('Orchestrator');
      await expect(body.queryByText('People')).toBeNull();
   },
};
