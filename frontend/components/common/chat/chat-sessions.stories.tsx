import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, fn, waitFor, within } from 'storybook/test';
import { archivedThreads, chatThreads } from './chat-fixtures';
import { ChatSessions } from './chat-sessions';

const meta = {
   component: ChatSessions,
   tags: ['ai-generated', 'needs-work'],
   args: {
      threads: chatThreads,
      archived: null,
      showArchived: false,
      onToggleArchived: fn(),
      activeId: 'conv-1',
      onSelect: fn(),
      onChanged: fn(),
      onStop: fn(),
   },
   decorators: [
      (Story) => (
         <div className="w-[218px] bg-[var(--shell-rail)] text-[var(--shell-text)]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof ChatSessions>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Pinned first, then by recency; a running reply and unread count show on the row. */
export const Sessions: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getAllByRole('button')[0]).toHaveTextContent('Project health migration');
      await expect(canvas.getByRole('button', { current: true })).toHaveTextContent(
         'Project health migration'
      );
      await expect(canvas.getByText('No messages yet')).toBeVisible();
   },
};

/** The row menu pins, archives, stops and deletes; pinning PATCHes and re-reads the list. */
export const PinFromTheRowMenu: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.patch('*/api/v1/conversations/:id', () => new HttpResponse(null, { status: 204 }))
      );
   },
   play: async ({ args, canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Rename Frontend Engineer' }));
      const menu = within(canvasElement.ownerDocument.body);
      // A reply is running in this conversation, so Stop is offered too.
      await expect(await menu.findByRole('menuitem', { name: 'Stop' })).toBeVisible();
      await userEvent.click(menu.getByRole('menuitem', { name: 'Pin' }));
      await waitFor(() => expect(args.onChanged).toHaveBeenCalled());
   },
};

export const WithArchive: Story = {
   args: { showArchived: true, archived: archivedThreads },
};

export const Empty: Story = {
   args: { threads: [], activeId: null, showArchived: true, archived: [] },
};
