import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect } from 'storybook/test';
import { useRightPanelStore } from '@/store/right-panel-store';
import {
   apiRepositories,
   issuesFor,
   projectHealth,
   projectPatchHandler,
   seedProjectStores,
   storyDetail,
} from '../stories-fixtures';
import { ProjectSidePanel } from './project-side-panel';

const meta = {
   component: ProjectSidePanel,
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
         <div className="flex h-[900px] justify-end border">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof ProjectSidePanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Properties by default (right-panel-store at null). */
export const Properties: Story = {};

/** The header's insights toggle swaps in the task insights panel. */
export const Insights: Story = {
   beforeEach: () => {
      useRightPanelStore.setState({ openPanel: 'insights' });
   },
};

/** Collapsed from the header: nothing renders. */
export const Hidden: Story = {
   beforeEach: () => {
      useRightPanelStore.setState({ openPanel: 'hidden' });
   },
   play: async ({ canvasElement }) => {
      await expect(canvasElement.querySelector('aside')).toBeNull();
   },
};
