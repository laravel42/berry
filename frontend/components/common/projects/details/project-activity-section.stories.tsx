import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect } from 'storybook/test';
import { apiProjectUpdates, projectHealth, seedProjectStores } from '../stories-fixtures';
import { ProjectActivityFeedList } from './project-activity-section';

const meta = {
   component: ProjectActivityFeedList,
   tags: ['ai-generated', 'needs-work'],
   args: { projectId: projectHealth.id },
   beforeEach: ({ msw }) => {
      seedProjectStores();
      msw.use(
         http.get('*/api/v1/projects/:id/updates', () => HttpResponse.json(apiProjectUpdates))
      );
   },
   decorators: [
      (Story) => (
         <div className="w-[680px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof ProjectActivityFeedList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Updates arrive from /api/v1/projects/:id/updates, newest first. */
export const WithUpdates: Story = {
   play: async ({ canvas }) => {
      await expect(await canvas.findByText(/Updates API is merged/)).toBeVisible();
      await expect(canvas.getByTitle('At risk')).toBeInTheDocument();
   },
};

export const NoUpdates: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/projects/:id/updates', () =>
            HttpResponse.json({ nodes: [], pageInfo: { hasNextPage: false, endCursor: null } })
         )
      );
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('No updates yet.')).toBeVisible();
   },
};
