import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, fn, waitFor } from 'storybook/test';
import { queuedTasks } from './chat-fixtures';
import { ChatQueue } from './chat-tasks-panel';

const meta = {
   component: ChatQueue,
   tags: ['ai-generated', 'needs-work'],
   args: { conversationId: 'conv-1', tasks: queuedTasks, onChanged: fn() },
   beforeEach: ({ msw }) => {
      msw.use(
         http.post(
            '*/api/v1/conversations/:id/tasks/:runId/prioritize',
            () => new HttpResponse(null, { status: 204 })
         ),
         http.post(
            '*/api/v1/conversations/:id/tasks/:runId/cancel',
            () => new HttpResponse(null, { status: 204 })
         )
      );
   },
   decorators: [
      (Story) => (
         <div className="w-[560px] bg-[var(--shell-canvas)] text-[var(--shell-text)]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof ChatQueue>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The running reply is not "waiting"; only the two behind it are, and they can be moved or dropped. */
export const TwoWaiting: Story = {
   play: async ({ args, canvas, userEvent }) => {
      const toggle = canvas.getByRole('button', { name: '2 waiting' });
      await userEvent.click(toggle);
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await userEvent.click(canvas.getAllByRole('button', { name: 'Run next' })[1]!);
      await waitFor(() => expect(args.onChanged).toHaveBeenCalled());
   },
};

/** One task is just the reply being written: nothing to show. */
export const OnlyTheRunningReply: Story = {
   args: { tasks: queuedTasks.slice(0, 1) },
   play: async ({ canvas }) => {
      await expect(canvas.queryByRole('button')).toBeNull();
   },
};
