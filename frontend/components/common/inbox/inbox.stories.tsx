import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
import { expect, within } from 'storybook/test';
import {
   emptyConnection,
   inboxItems,
   issues,
   pendingApproval,
   seedSession,
   shellHandlers,
   workspaceRoute,
} from '@/components/layout/stories-fixtures';
import { useApprovalsStore } from '@/store/approvals-store';
import { useIssuesStore } from '@/store/issues-store';
import { useNotificationsStore } from '@/store/notifications-store';
import Inbox from './inbox';

/** An archived notification as `GET /api/v1/inbox?state=archived` returns it. */
const archivedRow = {
   id: 'n-20',
   workspaceId: 'ws-1',
   recipientId: 'user-1',
   eventType: 'review.requested',
   category: 'reviews',
   severity: 'info',
   issueId: 'issue-38',
   issueStatus: 'in_review',
   issueIdentifier: 'BERR-38',
   actorType: 'agent',
   actorId: 'agent-1',
   title: 'Move approvals and proposals into the inbox',
   body: 'The Backend Engineer asked for your review.',
   read: true,
   archived: true,
   createdAt: '2026-09-12T14:00:00Z',
   approvalId: null,
   goalId: null,
   planId: null,
   details: {},
};

const archiveHandler = (nodes: unknown[]) =>
   http.get('*/api/v1/inbox', () =>
      HttpResponse.json({ nodes, pageInfo: { hasNextPage: false, endCursor: null } })
   );

/** The inbox reads `?view=` and `?issue=` from the URL. */
function withSearch(search: string) {
   return function WithSearch(Story: () => React.ReactNode) {
      return (
         <NuqsTestingAdapter searchParams={search}>
            <Story />
         </NuqsTestingAdapter>
      );
   };
}

const meta = {
   component: Inbox,
   tags: ['ai-generated', 'needs-work'],
   parameters: {
      layout: 'fullscreen',
      nextjs: { navigation: workspaceRoute('/elian/inbox') },
   },
   decorators: [
      (Story) => (
         <div className="h-[640px] border">
            <Story />
         </div>
      ),
   ],
   beforeEach: ({ msw }) => {
      seedSession();
      useIssuesStore.setState({ issues });
      useApprovalsStore.setState({ approvals: [], loaded: true, error: null });
      useNotificationsStore.setState({
         notifications: inboxItems,
         archived: [],
         status: 'ready',
         archivedStatus: 'idle',
         serverUnreadCount: null,
         selectedNotification: undefined,
         arrivals: [],
         heldUnread: [],
      });
      msw.use(
         ...shellHandlers,
         archiveHandler([archivedRow]),
         http.get('*/api/v1/approvals/:id', () => HttpResponse.json(pendingApproval))
      );
   },
} satisfies Meta<typeof Inbox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await expect(canvas.getAllByLabelText('Unread')).toHaveLength(3);
      await userEvent.click(canvas.getByRole('button', { name: 'Act on everything' }));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('menuitem', { name: 'Mark all read' }));
      // Marking read is optimistic; the toast waits for POST /inbox/bulk.
      await expect(canvas.queryAllByLabelText('Unread')).toHaveLength(0);
      await expect(await body.findByText('Everything marked read')).toBeVisible();
   },
};

/** `?issue=` opens a notification; an approval shows its decision card. */
export const ApprovalSelected: Story = {
   decorators: [withSearch('?issue=n-3')],
   play: async ({ canvas }) => {
      // Fetched through GET /api/v1/approvals/:id, since the store is empty.
      await expect(await canvas.findByRole('button', { name: 'Start' })).toBeVisible();
   },
};

export const Archive: Story = {
   decorators: [withSearch('?view=archived')],
   play: async ({ canvas }) => {
      await expect(
         await canvas.findByText('Move approvals and proposals into the inbox')
      ).toBeVisible();
   },
};

/** Up and down move the selection through the list, from outside any field. */
export const KeyboardNavigation: Story = {
   beforeEach: () => {
      // Notifications that are not about a task, so the detail pane stays light.
      const byId = (id: string) => inboxItems.filter((item) => item.id === id);
      useNotificationsStore.setState({ notifications: [...byId('n-5'), ...byId('n-4')] });
   },
   play: async ({ canvas, userEvent }) => {
      await userEvent.keyboard('{ArrowDown}');
      await expect(
         canvas.getByRole('button', { name: /is blocked/, hidden: true })
      ).toHaveAttribute('aria-current', 'true');
      await userEvent.keyboard('{ArrowDown}');
      await expect(
         canvas.getByRole('button', { name: /Run failed on/, hidden: true })
      ).toHaveAttribute('aria-current', 'true');
      await expect(await canvas.findByText('Original prompt')).toBeInTheDocument();
   },
};

/** Nothing new, but the archive holds something: the reader has dealt with it all. */
export const CaughtUp: Story = {
   beforeEach: () => {
      useNotificationsStore.setState({ notifications: [] });
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('You’re caught up.')).toBeVisible();
   },
};

export const FirstUse: Story = {
   beforeEach: ({ msw }) => {
      useNotificationsStore.setState({ notifications: [] });
      msw.use(http.get('*/api/v1/inbox', () => HttpResponse.json(emptyConnection)));
   },
};

export const Loading: Story = {
   beforeEach: () => {
      useNotificationsStore.setState({ notifications: [], status: 'loading' });
   },
};
