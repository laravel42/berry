import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';
import {
   autopilotDetail,
   issues,
   liveAgents,
   orgParams,
   rosterMap,
   seedSession,
   storyHandlers,
} from '@/components/common/agents/stories-fixtures';
import { useAgentsStore } from '@/store/agents-store';
import { useIssuesStore } from '@/store/issues-store';
import AutopilotDialog from './autopilot-dialog';

const meta = {
   component: AutopilotDialog,
   tags: ['ai-generated', 'needs-work'],
   parameters: orgParams,
   args: { open: true, onOpenChange: fn(), onSaved: fn() },
   beforeEach: ({ msw }) => {
      msw.use(...storyHandlers);
      seedSession();
      useAgentsStore.setState({
         agents: liveAgents,
         archived: null,
         roster: rosterMap,
         error: null,
      });
      useIssuesStore.getState().hydrateIssues(issues);
   },
} satisfies Meta<typeof AutopilotDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const New: Story = {
   play: async ({ canvasElement }) => {
      const dialog = within(await within(canvasElement.ownerDocument.body).findByRole('dialog'));
      // Nothing is ready until an assignee, a runbook and a project are chosen.
      await expect(dialog.getByRole('button', { name: 'Create autopilot' })).toBeDisabled();
   },
};

/** Started from an empty-state template: name and runbook already written. */
export const FromTemplate: Story = {
   args: {
      template: {
         name: 'Weekly digest',
         prompt:
            'Write the week in one page: what shipped, what slipped, what failed and what needs a decision.',
      },
   },
};

export const ChooseAssignee: Story = {
   play: async ({ canvasElement, userEvent }) => {
      const body = within(canvasElement.ownerDocument.body);
      const dialog = within(await body.findByRole('dialog'));
      await userEvent.click(dialog.getByRole('button', { name: 'Choose who runs it' }));
      await userEvent.click(await body.findByRole('option', { name: /Orchestrator/ }));
      await expect(dialog.getByRole('button', { name: 'Orchestrator' })).toBeVisible();
   },
};

export const FirstTriggerSchedule: Story = {
   play: async ({ canvasElement, userEvent }) => {
      const dialog = within(await within(canvasElement.ownerDocument.body).findByRole('dialog'));
      await userEvent.click(dialog.getByRole('button', { name: 'A schedule' }));
      await expect(await dialog.findByText('When it runs')).toBeVisible();
   },
};

export const Edit: Story = { args: { autopilot: autopilotDetail } };
