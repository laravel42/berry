import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import type { ComponentProps } from 'react';
import { expect, fn, waitFor } from 'storybook/test';
import { ShortcutProvider } from '@/components/layout/shortcut-provider';
import type { RunRecord } from '@/lib/runs';
import { useCommentDraftStore } from '@/store/comment-draft-store';
import { ActivityCommentComposer, ActivityFeedList } from './activity-feed';
import {
   agentUser,
   andrea,
   backendAgent,
   comment,
   maya,
   runEventsHandler,
   runningRun,
   seedIssuesWorkspace,
} from '../stories-fixtures';

type Events = ComponentProps<typeof ActivityFeedList>['events'];

const events: Events = [
   {
      kind: 'event',
      id: 'act-1',
      actor: andrea,
      event: 'created',
      text: 'created the task',
      timeAgo: '10 days ago',
      at: '2026-09-08T10:15:00Z',
   },
   {
      kind: 'event',
      id: 'act-2',
      actor: andrea,
      event: 'created',
      text: 'changed assignee',
      timeAgo: '10 days ago',
      at: '2026-09-08T10:16:00Z',
   },
   {
      kind: 'event',
      id: 'act-3',
      actor: agentUser(backendAgent),
      event: 'status',
      text: 'moved from todo to inProgress',
      timeAgo: '2 hours ago',
      at: '2026-09-18T10:00:00Z',
   },
];

const question = comment(
   'comment-1',
   'Should the migration land before the endpoint? @[Backend Engineer](agent:agent-be) can you check the order?',
   andrea,
   { createdAt: '2026-09-18T11:50:00Z', updatedAt: '2026-09-18T11:50:00Z' }
);
const reply = comment(
   'comment-2',
   'Yes. The endpoint reads the column, so **061** has to be applied first.',
   maya,
   { parentId: 'comment-1', createdAt: '2026-09-18T11:55:00Z', updatedAt: '2026-09-18T11:55:00Z' }
);
const agentSummary = comment(
   'comment-3',
   '## Summary\n\n- Added `health` to `projects`\n- `PATCH /api/v1/projects/{id}` accepts it\n- Each change writes a project update\n\n```sql\nALTER TABLE projects ADD COLUMN health text;\n```',
   backendAgent,
   { createdAt: '2026-09-18T10:06:30Z', updatedAt: '2026-09-18T10:06:30Z' }
);
const resolved = comment(
   'comment-4',
   'Do we keep the local fallback? Resolved: no, the server is the source.',
   andrea,
   {
      createdAt: '2026-09-09T09:00:00Z',
      updatedAt: '2026-09-10T09:00:00Z',
      resolvedAt: '2026-09-10T09:00:00Z',
      resolvedBy: { type: 'user', id: andrea.id, name: andrea.name, avatarUrl: null },
   }
);

/** The run a mention in the question started. */
const mentionRun: RunRecord = {
   ...runningRun,
   source: 'mention',
   createdAt: '2026-09-18T11:52:00Z',
};

const meta = {
   component: ActivityFeedList,
   tags: ['ai-generated', 'needs-work'],
   args: {
      comments: [resolved, agentSummary, question, reply],
      events,
      runs: [mentionRun],
      error: null,
      issueRef: 'BERR-42',
      highlightedCommentId: null,
      onCommentChanged: fn(),
      onCommentDeleted: fn(),
      onCommentPosted: fn(),
      onRunChanged: fn(),
   },
   decorators: [
      (Story) => (
         <ShortcutProvider>
            <div className="w-[720px]">
               <Story />
            </div>
         </ShortcutProvider>
      ),
   ],
   beforeEach: ({ msw }) => {
      seedIssuesWorkspace({ withSession: true });
      msw.use(
         http.get('*/api/v1/comments/:id/reactions', ({ params }) =>
            HttpResponse.json({
               nodes:
                  params.id === 'comment-2'
                     ? [
                          {
                             emoji: '👍',
                             count: 2,
                             reactedByMe: false,
                             actorIds: ['user-1', 'user-3'],
                          },
                       ]
                     : [],
            })
         ),
         runEventsHandler(2)
      );
   },
} satisfies Meta<typeof ActivityFeedList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Conversation: Story = {
   play: async ({ canvas }) => {
      // The mention started a run, drawn under the comment that asked for it.
      await expect(
         await canvas.findByText(/Backend Engineer · started a run from this comment/)
      ).toBeInTheDocument();
      await expect(canvas.getByText('1 resolved thread')).toBeInTheDocument();
      await expect(canvas.getByRole('button', { name: /1 reply/ })).toHaveAttribute(
         'aria-expanded',
         'true'
      );
   },
};

export const ShowResolvedThreads: Story = {
   play: async ({ canvas, userEvent }) => {
      await expect(canvas.queryByText(/Do we keep the local fallback/)).toBeNull();
      await userEvent.click(canvas.getByRole('button', { name: 'Show them' }));
      await expect(await canvas.findByText(/Do we keep the local fallback/)).toBeInTheDocument();
   },
};

export const OnlyBookkeeping: Story = {
   args: { comments: [], runs: [] },
};

export const LoadFailed: Story = {
   args: { comments: [], events: [], runs: [], error: 'Activity could not be loaded.' },
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('alert')).toHaveTextContent('Activity could not be loaded.');
   },
};

export const Composer: Story = {
   render: (args) => (
      <ActivityCommentComposer issueRef={args.issueRef} onPosted={args.onCommentPosted} />
   ),
   beforeEach: ({ msw }) => {
      useCommentDraftStore.setState({ drafts: {} });
      msw.use(
         http.post('*/api/v1/issues/:ref/comments/trigger-preview', () =>
            HttpResponse.json({ targets: [], refused: [] })
         ),
         http.post('*/api/v1/issues/:ref/comments', async ({ request }) => {
            const { body } = (await request.json()) as { body: string };
            return HttpResponse.json(comment('comment-9', body, andrea));
         })
      );
   },
   play: async ({ args, canvas, userEvent }) => {
      const send = canvas.getByRole('button', { name: 'comment' });
      await expect(send).toBeDisabled();
      await userEvent.type(
         canvas.getByRole('textbox', { name: 'leave a comment…' }),
         'Looks right to me.'
      );
      // Typed text is kept as a draft per task until it is sent.
      await expect(canvas.getByText('Draft saved')).toBeInTheDocument();
      await userEvent.click(send);
      await waitFor(() =>
         expect(args.onCommentPosted).toHaveBeenCalledWith(
            expect.objectContaining({ body: 'Looks right to me.' })
         )
      );
   },
};

export const ComposerWillStartAnAgent: Story = {
   render: (args) => (
      <ActivityCommentComposer issueRef={args.issueRef} onPosted={args.onCommentPosted} />
   ),
   beforeEach: ({ msw }) => {
      useCommentDraftStore.setState({
         drafts: { 'BERR-42': '@[QA Engineer](agent:agent-qa) please add tests for the migration' },
      });
      msw.use(
         http.post('*/api/v1/issues/:ref/comments/trigger-preview', () =>
            HttpResponse.json({
               targets: [{ agentId: 'agent-qa', agentName: 'QA Engineer', reason: 'mention' }],
               refused: [{ agentId: 'agent-orch', agentName: 'Orchestrator', reason: 'no_access' }],
            })
         )
      );
   },
   play: async ({ canvas, userEvent }) => {
      // The preview says who the comment would set off, before it is sent.
      const target = await canvas.findByRole('button', { name: 'QA Engineer' });
      await expect(target).toHaveAttribute('aria-pressed', 'true');
      await userEvent.click(target);
      // Clicked off: the comment still posts, but this agent is not started.
      await expect(target).toHaveAttribute('aria-pressed', 'false');
      await expect(target).toHaveTextContent('QA Engineer · skipped');
   },
};
