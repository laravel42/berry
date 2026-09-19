import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, within } from 'storybook/test';
import type { ReactionGroup } from '@/lib/reactions';
import { IssueReactions, ReactionBar } from './issue-reactions';

const groups: ReactionGroup[] = [
   { emoji: '👍', count: 3, reactedByMe: true, actorIds: ['user-1', 'user-2', 'agent-be'] },
   { emoji: '🚀', count: 1, reactedByMe: false, actorIds: ['user-3'] },
];

const meta = {
   component: ReactionBar,
   tags: ['ai-generated', 'needs-work'],
   args: { target: 'issue', id: 'BERR-42' },
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/:target/:id/reactions', () => HttpResponse.json({ nodes: groups })),
         http.post('*/api/v1/:target/:id/reactions', () =>
            HttpResponse.json({
               nodes: [
                  ...groups,
                  { emoji: '👀', count: 1, reactedByMe: true, actorIds: ['user-1'] },
               ],
            })
         ),
         http.delete('*/api/v1/:target/:id/reactions/:emoji', () =>
            HttpResponse.json({
               nodes: [{ ...groups[0]!, count: 2, reactedByMe: false }, groups[1]],
            })
         )
      );
   },
} satisfies Meta<typeof ReactionBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OnATask: Story = {
   play: async ({ canvas }) => {
      await expect(await canvas.findByRole('button', { name: '👍 3' })).toHaveAttribute(
         'aria-pressed',
         'true'
      );
   },
};

export const OnAComment: Story = { args: { target: 'comment', id: 'comment-1' } };

export const TakeBackMyReaction: Story = {
   play: async ({ canvas, userEvent }) => {
      await userEvent.click(await canvas.findByRole('button', { name: '👍 3' }));
      await expect(await canvas.findByRole('button', { name: '👍 2' })).toHaveAttribute(
         'aria-pressed',
         'false'
      );
   },
};

export const AddFromPicker: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Add reaction' }));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('button', { name: '👀' }));
      await expect(await canvas.findByRole('button', { name: '👀 1' })).toBeInTheDocument();
   },
};

export const NoReactionsYet: Story = {
   render: () => <IssueReactions issueRef="BERR-47" />,
   beforeEach: ({ msw }) => {
      msw.use(http.get('*/api/v1/:target/:id/reactions', () => HttpResponse.json({ nodes: [] })));
   },
};
