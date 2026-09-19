import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, waitFor, within } from 'storybook/test';
import { useIssuesStore } from '@/store/issues-store';
import { IssueParentSection } from './issue-parent-section';
import {
   apiIssue,
   healthTests,
   issueApiHandlers,
   seedIssuesWorkspace,
   sharedFilter,
} from '../stories-fixtures';

const meta = {
   component: IssueParentSection,
   tags: ['ai-generated', 'needs-work'],
   args: { issue: healthTests },
   decorators: [
      (Story) => (
         <div className="w-[260px]">
            <Story />
         </div>
      ),
   ],
   beforeEach: ({ msw }) => {
      seedIssuesWorkspace();
      msw.use(
         http.put('*/api/v1/issues/:ref/parent', () =>
            HttpResponse.json({ ...apiIssue(healthTests), parentId: null, stage: null })
         ),
         ...issueApiHandlers
      );
   },
} satisfies Meta<typeof IssueParentSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SubTask: Story = {
   play: async ({ canvas }) => {
      // The parent is fetched by id and shown by its key and title.
      await expect(await canvas.findByText('BERR-42')).toBeInTheDocument();
      await expect(canvas.getByText('Persist project health and updates')).toBeInTheDocument();
   },
};

export const ParentNotReadable: Story = {
   args: { issue: { ...healthTests, parentId: 'issue-999' } },
   play: async ({ canvas }) => {
      // Without the parent, its id stands in rather than nothing.
      await expect(await canvas.findByText('issue-999')).toBeInTheDocument();
   },
};

export const RemoveParent: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await canvas.findByText('BERR-42');
      await userEvent.click(canvas.getByRole('button', { name: 'Remove the parent' }));
      await waitFor(() =>
         expect(useIssuesStore.getState().getIssueById(healthTests.id)?.parentId).toBeNull()
      );
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText('This task is no longer a sub-task.')).toBeVisible();
   },
};

export const TopLevelTask: Story = {
   args: { issue: sharedFilter },
   play: async ({ canvas }) => {
      // Not a sub-task, so the section is not drawn at all.
      await expect(canvas.queryByRole('heading', { name: 'Parent task' })).toBeNull();
   },
};
