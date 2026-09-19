import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { delay, http, HttpResponse } from 'msw';
import { expect } from 'storybook/test';
import { ShortcutProvider } from '@/components/layout/shortcut-provider';
import { useIssueRunsStore } from '@/store/issue-runs-store';
import { useIssueViewStore } from '@/store/issue-view-store';
import { useUiPrefsStore } from '@/store/ui-prefs-store';
import IssueDetails from './issue-details';
import {
   deliveredRun,
   emptyPage,
   issueApiHandlers,
   issueDetailHandlers,
   seedIssuesWorkspace,
   storyIssues,
} from '../stories-fixtures';

/** The task page as the inbox embeds it: pointed at a task by key. */
function TaskPage({ issueRef }: { issueRef: string }) {
   return <IssueDetails issueRef={issueRef} />;
}

const meta = {
   component: TaskPage,
   tags: ['ai-generated', 'needs-work'],
   args: { issueRef: 'BERR-42' },
   parameters: { layout: 'fullscreen' },
   decorators: [
      (Story) => (
         <ShortcutProvider>
            <div className="h-[900px] w-[1280px] overflow-hidden border">
               <Story />
            </div>
         </ShortcutProvider>
      ),
   ],
   beforeEach: ({ msw }) => {
      seedIssuesWorkspace({ withSession: true });
      useIssueRunsStore.setState({ byIssue: {}, loading: {} });
      useIssueViewStore.setState({ sidebarOpen: true, collapsedSubIssues: {} });
      useUiPrefsStore.setState({ stickyCommentBar: true });
      msw.use(...issueDetailHandlers, ...issueApiHandlers);
   },
} satisfies Meta<typeof TaskPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AgentAtWork: Story = {
   play: async ({ canvas }) => {
      await expect(
         canvas.getByRole('heading', { level: 1, name: 'Persist project health and updates' })
      ).toBeInTheDocument();
      // Comments, runs and files all arrive after the task itself.
      await expect(await canvas.findByText(/the endpoint change is next/)).toBeInTheDocument();
      await expect(await canvas.findByText('Running now')).toBeInTheDocument();
      await expect(await canvas.findByText('Files (1)')).toBeInTheDocument();
   },
};

export const InReview: Story = {
   args: { issueRef: 'BERR-43' },
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/issues/:ref/runs', () =>
            HttpResponse.json({ nodes: [deliveredRun], pageInfo: emptyPage })
         )
      );
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText(/Frontend Engineer delivered/)).toBeInTheDocument();
   },
};

export const SidebarHiddenComposerInline: Story = {
   beforeEach: () => {
      useIssueViewStore.setState({ sidebarOpen: false });
      useUiPrefsStore.setState({ stickyCommentBar: false });
   },
   play: async ({ canvas }) => {
      await expect(canvas.queryByText('Properties')).toBeNull();
   },
};

export const FetchedByLink: Story = {
   // Arriving from outside the board: the store has not heard of the task yet.
   beforeEach: () => {
      seedIssuesWorkspace({
         withSession: true,
         issues: storyIssues.filter((issue) => issue.identifier !== 'BERR-44'),
      });
   },
   args: { issueRef: 'BERR-44' },
   play: async ({ canvas }) => {
      await expect(
         await canvas.findByRole('heading', {
            level: 1,
            name: 'Share the list filter through the URL',
         })
      ).toBeInTheDocument();
   },
};

export const Loading: Story = {
   args: { issueRef: 'BERR-77' },
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/issues/:ref', async () => {
            await delay('infinite');
            return HttpResponse.json({});
         })
      );
   },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('Loading the task…')).toBeInTheDocument();
   },
};

export const NotFound: Story = {
   args: { issueRef: 'BERR-404' },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('Task unavailable.')).toBeInTheDocument();
      await expect(
         canvas.getByText(
            'BERR-404 is not in this workspace. Return to the queue and choose another task.'
         )
      ).toBeInTheDocument();
   },
};
