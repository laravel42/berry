import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, waitFor, within } from 'storybook/test';
import { getProjectDetail } from '@/data/project-details';
import { useProjectsStore } from '@/store/projects-store';
import {
   apiRepositories,
   echoProjectPatch,
   issuesFor,
   projectHealth,
   projectInbox,
   projectPatchHandler,
   seedProjectStores,
   storyDetail,
} from '../stories-fixtures';
import { ProjectPropertiesPanel } from './project-properties-panel';

/** Set once the PATCH has been answered, so the play can judge the settled state. */
let patchAnswered = false;

const meta = {
   component: ProjectPropertiesPanel,
   tags: ['ai-generated', 'needs-work'],
   args: {
      project: projectHealth,
      detail: storyDetail(projectHealth.id),
      issues: issuesFor(projectHealth.id),
   },
   beforeEach: ({ msw }) => {
      seedProjectStores();
      msw.use(
         projectPatchHandler,
         http.get('*/api/v1/integrations/github/repositories', () =>
            HttpResponse.json(apiRepositories)
         )
      );
   },
   decorators: [
      (Story) => (
         <div className="h-[900px] w-[380px] border bg-container">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof ProjectPropertiesPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The project tasks page panel: properties, milestones, progress and activity. */
export const Full: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByText('3 members')).toBeVisible();
      await expect(canvas.getByText('Schema and migration')).toBeVisible();
   },
};

/** Nothing linked yet: empty milestones copy, no breakdown rows. */
export const NoTasks: Story = {
   args: { project: projectInbox, detail: getProjectDetail(projectInbox.id), issues: [] },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('Add members')).toBeVisible();
      await expect(canvas.getByText('Nothing to show yet.')).toBeVisible();
   },
};

/** An assignee row filters the task list; it lands in the URL filters. */
export const FilterByAssignee: Story = {
   play: async ({ canvas, userEvent }) => {
      const row = canvas.getByRole('button', { name: /Maya Chen/ });
      await userEvent.click(row);
      // Active rows take a solid accent (hover-only rows carry just `hover:`).
      await waitFor(() => expect(row).toHaveClass('bg-accent'));
   },
};

/** The overview sidebar: editable controls instead of read-only rows. */
export const Compact: Story = {
   args: { compact: true },
   decorators: [
      (Story) => (
         <div className="h-[640px] w-[292px] px-5 pt-6">
            <Story />
         </div>
      ),
   ],
};

/**
 * A change from the compact sidebar writes through the projects store.
 *
 * Currently fails, and should: the server echoes `paused`, and
 * `uiStatusFromProjectApi` maps it back to Backlog because `data/status.tsx`
 * has no paused entry (lib/catalog.ts `catalogStatus` fallback).
 */
export const CompactChangeStatus: Story = {
   args: { compact: true },
   beforeEach: ({ msw }) => {
      patchAnswered = false;
      msw.use(
         http.patch('*/api/v1/projects/:id', async (info) => {
            const response = await echoProjectPatch(info);
            patchAnswered = true;
            return response;
         })
      );
   },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(
         canvas.getByRole('combobox', { name: 'Change status, current In Progress' })
      );
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('option', { name: /Paused/ }));
      // Judge the settled state, after the server's answer has been applied,
      // not the optimistic one.
      await waitFor(() => expect(patchAnswered).toBe(true));
      await new Promise((resolve) => setTimeout(resolve, 100));
      await expect(useProjectsStore.getState().getProjectById(projectHealth.id)?.status.id).toBe(
         'paused'
      );
   },
};
