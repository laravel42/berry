import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, within } from 'storybook/test';
import type { View } from '@/data/views';
import { useViewsStore } from '@/store/views-store';
import { IssueFilterBarActions } from './issue-filter-bar-actions';
import { andrea, seedIssuesWorkspace } from './stories-fixtures';
import { urgentOnly, withUrlFilters } from './stories-filters';

const urgentView: View = {
   id: 'view-urgent',
   name: 'Urgent frontend',
   description: '',
   icon: '🔥',
   type: 'issue',
   owner: andrea,
   createdAt: '2026-09-01T09:00:00Z',
   updatedAt: '2026-09-10T09:00:00Z',
   filter: {},
   visibility: 'workspace',
   revision: 3,
   savedFilters: [],
   display: { layout: 'list' },
};

const meta = {
   component: IssueFilterBarActions,
   tags: ['ai-generated', 'needs-work'],
   decorators: [withUrlFilters(urgentOnly)],
   beforeEach: () => {
      seedIssuesWorkspace();
      useViewsStore.setState({ views: [urgentView] });
   },
} satisfies Meta<typeof IssueFilterBarActions>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ClearOnly: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
      await expect(canvas.queryByRole('button', { name: 'Save to this view' })).toBeNull();
   },
};

export const OnASavedView: Story = {
   parameters: { nextjs: { navigation: { segments: [['viewId', urgentView.id]] } } },
   beforeEach: ({ msw }) => {
      msw.use(
         http.patch('*/api/v1/views/:id', () =>
            HttpResponse.json({
               id: urgentView.id,
               workspaceId: 'ws-1',
               ownerId: andrea.id,
               name: urgentView.name,
               visibility: 'workspace',
               definitionVersion: 1,
               query: { filters: urgentOnly },
               display: { layout: 'list' },
               revision: 4,
               createdAt: urgentView.createdAt,
               updatedAt: '2026-09-18T12:00:00Z',
            })
         )
      );
   },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Save to this view' }));
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText('View updated')).toBeVisible();
      await expect(useViewsStore.getState().getViewById(urgentView.id)?.revision).toBe(4);
   },
};

export const SavedViewConflict: Story = {
   parameters: { nextjs: { navigation: { segments: [['viewId', urgentView.id]] } } },
   beforeEach: ({ msw }) => {
      msw.use(
         http.patch('*/api/v1/views/:id', () =>
            HttpResponse.json(
               { error: { code: 'REVISION_CONFLICT', message: 'Stale revision', details: null } },
               { status: 409 }
            )
         )
      );
   },
};

export const NoFilters: Story = {
   decorators: [withUrlFilters([])],
   play: async ({ canvasElement }) => {
      // Nothing to clear, so nothing is drawn.
      await expect(canvasElement.querySelector('button')).toBeNull();
   },
};
