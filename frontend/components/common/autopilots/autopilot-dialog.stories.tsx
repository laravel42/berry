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
      await expect(dialog.getByRole('button', { name: 'Create loop' })).toBeDisabled();
   },
};

/** Started from a template: name, instructions and an event trigger already filled in. */
export const FromTemplate: Story = {
   args: {
      seed: {
         name: 'Triage new bugs',
         instructions: 'A new bug was reported. Assess its severity and recommend an owner.',
         trigger: {
            kind: 'event',
            eventType: 'issue.created',
            conditions: { match: 'all', rules: [{ field: 'label', op: 'in', values: ['bug'] }] },
            description: 'When a task labelled “bug” is created',
         },
         accessMode: 'recommend',
         templateKey: 'bug-triage',
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
