import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, within } from 'storybook/test';
import {
   agents,
   emptyConnection,
   issues,
   me,
   seedSession,
   serverProject,
   teammate,
   webProject,
   workspaceRoute,
} from '@/components/layout/stories-fixtures';
import { useAgentsStore } from '@/store/agents-store';
import { EMPTY_DRAFT, useCreateIssueStore } from '@/store/create-issue-store';
import { useIssuesStore } from '@/store/issues-store';
import { useMembersStore } from '@/store/members-store';
import { useProjectsStore } from '@/store/projects-store';
import { useUiPrefsStore } from '@/store/ui-prefs-store';
import { CreateNewIssue } from './index';

const meta = {
   component: CreateNewIssue,
   tags: ['ai-generated', 'needs-work'],
   parameters: { nextjs: { navigation: workspaceRoute('/elian/tasks') } },
   beforeEach: ({ msw }) => {
      seedSession();
      useIssuesStore.getState().hydrateIssues(issues);
      useMembersStore.setState({ members: [me, teammate] });
      useProjectsStore.setState({ projects: [serverProject, webProject] });
      useAgentsStore.setState({ agents });
      useUiPrefsStore.setState(useUiPrefsStore.getInitialState());
      useCreateIssueStore.setState({
         isOpen: true,
         mode: 'manual',
         draft: { ...EMPTY_DRAFT },
         createAnother: false,
      });
      msw.use(
         http.get('*/api/v1/labels', () => HttpResponse.json(emptyConnection)),
         http.get('*/api/v1/workspaces/:id/properties', () => HttpResponse.json({ nodes: [] }))
      );
   },
} satisfies Meta<typeof CreateNewIssue>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WriteIt: Story = {
   play: async ({ canvasElement, userEvent }) => {
      const body = within(canvasElement.ownerDocument.body);
      const dialog = within(await body.findByRole('dialog', { name: 'New task' }));
      await userEvent.type(dialog.getByPlaceholderText('Task title'), 'Backfill project health');
      // What is typed is a draft in the store, so closing by accident loses nothing.
      await expect(useCreateIssueStore.getState().draft.title).toBe('Backfill project health');
      // The status picker has no accessible name (a combobox does not take its
      // name from its text), so it is found by what it shows.
      const statusPicker = dialog
         .getAllByRole('combobox')
         .find((element) => element.textContent?.includes('Todo'));
      if (!statusPicker) throw new Error('No status picker showing Todo');
      await userEvent.click(statusPicker);
      await userEvent.click(await body.findByRole('option', { name: /In Progress/ }));
      await expect(useCreateIssueStore.getState().draft.statusId).toBe('in-progress');
   },
};

/** Handing it over starts from the Orchestrator. */
export const HandItToAnAgent: Story = {
   beforeEach: () => {
      useCreateIssueStore.setState({ mode: 'agent' });
   },
   play: async ({ canvasElement }) => {
      const body = within(canvasElement.ownerDocument.body);
      const dialog = within(await body.findByRole('dialog', { name: 'New task' }));
      await expect(dialog.getByRole('tab', { name: 'Hand it to an agent' })).toHaveAttribute(
         'aria-selected',
         'true'
      );
      await expect(
         await dialog.findByRole('combobox', { name: 'Assigned to Orchestrator' })
      ).toBeVisible();
   },
};

/** Opened from a task's sub-task list: the parent is fixed. */
export const UnderAParent: Story = {
   beforeEach: () => {
      useCreateIssueStore.setState({
         context: {
            defaultStatus: null,
            projectId: 'proj-1',
            parentRef: 'BERR-42',
            parentLocked: true,
         },
         draft: { ...EMPTY_DRAFT, title: 'Add the health column', projectId: 'proj-1' },
      });
   },
   play: async ({ canvasElement }) => {
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText('Created under BERR-42.')).toBeVisible();
   },
};
