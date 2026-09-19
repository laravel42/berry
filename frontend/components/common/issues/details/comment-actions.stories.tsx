import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, fn, waitFor, within } from 'storybook/test';
import { useSessionStore } from '@/store/session-store';
import { CommentActions } from './comment-actions';
import {
   andrea,
   apiIssue,
   backendAgent,
   comment,
   healthTests,
   maya,
   seedIssuesWorkspace,
} from '../stories-fixtures';

const mine = comment(
   'comment-1',
   'The migration should land before the endpoint, or the chip reads a column that is not there yet.',
   andrea,
   { revision: 2 }
);
const agentReply = comment(
   'comment-2',
   'Migration 061 is applied on the test database; the endpoint change is next.',
   backendAgent
);

const meta = {
   component: CommentActions,
   tags: ['ai-generated', 'needs-work'],
   args: {
      comment: mine,
      issueRef: 'BERR-42',
      replyCount: 0,
      onChanged: fn(),
      onDeleted: fn(),
      onReply: fn(),
   },
   decorators: [
      (Story) => (
         <div className="flex w-[480px] items-center gap-2 border p-2">
            <span className="text-muted-foreground">Andrea Lunelio · 3h ago</span>
            <Story />
         </div>
      ),
   ],
   beforeEach: ({ msw }) => {
      seedIssuesWorkspace({ withSession: true });
      msw.use(
         http.patch('*/api/v1/comments/:id', async ({ request }) => {
            const { body } = (await request.json()) as { body: string };
            return HttpResponse.json({ ...mine, body, revision: mine.revision + 1 });
         }),
         http.delete('*/api/v1/comments/:id', () => new HttpResponse(null, { status: 204 })),
         http.post('*/api/v1/issues/:ref/children', () =>
            HttpResponse.json(apiIssue({ ...healthTests, id: 'issue-51', identifier: 'BERR-51' }))
         )
      );
   },
} satisfies Meta<typeof CommentActions>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MyComment: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Activity' }));
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByRole('menuitem', { name: 'Edit' })).toBeVisible();
      await expect(body.getByRole('menuitem', { name: 'Delete' })).toBeVisible();
   },
};

export const SomeoneElsesAsMember: Story = {
   args: { comment: agentReply, onReply: undefined },
   beforeEach: () => {
      useSessionStore.setState({ user: maya });
   },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Activity' }));
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByRole('menuitem', { name: 'Copy the text' })).toBeVisible();
      // Only the author or an admin may change it, and the menu says so.
      await expect(body.queryByRole('menuitem', { name: 'Edit' })).toBeNull();
   },
};

export const Edit: Story = {
   play: async ({ args, canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Activity' }));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('menuitem', { name: 'Edit' }));
      const field = await body.findByRole('textbox');
      await userEvent.type(field, ' Agreed with Maya.');
      await userEvent.click(body.getByRole('button', { name: 'Save' }));
      await waitFor(() =>
         expect(args.onChanged).toHaveBeenCalledWith(expect.objectContaining({ revision: 3 }))
      );
   },
};

export const DeleteThreadWithReplies: Story = {
   args: { replyCount: 3 },
   play: async ({ args, canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Activity' }));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('menuitem', { name: 'Delete' }));
      // Deleting a thread root takes its replies with it, and the dialog says how many.
      await expect(await body.findByText(/Its 3 replies are deleted with it\./)).toBeVisible();
      await userEvent.click(body.getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(args.onDeleted).toHaveBeenCalledWith('comment-1'));
   },
};

export const SplitIntoSubTask: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Activity' }));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(
         await body.findByRole('menuitem', { name: 'Create a sub-task from this' })
      );
      await expect(await body.findByText('BERR-51 created from this comment.')).toBeVisible();
   },
};
