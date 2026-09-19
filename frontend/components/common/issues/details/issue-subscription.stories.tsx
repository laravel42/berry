import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, within } from 'storybook/test';
import type { Subscriber } from '@/lib/subscribers';
import { IssueSubscription } from './issue-subscription';

const follower = (userId: string, name: string, reason: string): Subscriber => ({
   userId,
   name,
   avatarUrl: null,
   reason,
   subscribedAt: '2026-09-10T09:00:00Z',
});

const followers = [
   follower('user-2', 'Maya Chen', 'assignee'),
   follower('user-3', 'Tomás Ferreira', 'mentioned'),
];

/** The server's answer, flipping as the viewer subscribes and leaves. */
function subscriptionApi(initiallySubscribed: boolean) {
   let subscribed = initiallySubscribed;
   const me = follower('user-1', 'Andrea Lunelio', 'creator');
   return [
      http.get('*/api/v1/issues/:ref/subscribers', () =>
         HttpResponse.json({ nodes: subscribed ? [me, ...followers] : followers, subscribed })
      ),
      http.put('*/api/v1/issues/:ref/subscription', () => {
         subscribed = true;
         return new HttpResponse(null, { status: 204 });
      }),
      http.delete('*/api/v1/issues/:ref/subscription', () => {
         subscribed = false;
         return new HttpResponse(null, { status: 204 });
      }),
   ];
}

const meta = {
   component: IssueSubscription,
   tags: ['ai-generated', 'needs-work'],
   args: { issueRef: 'BERR-42', compact: false },
   beforeEach: ({ msw }) => {
      msw.use(...subscriptionApi(false));
   },
} satisfies Meta<typeof IssueSubscription>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NotFollowing: Story = {
   play: async ({ canvas, userEvent }) => {
      await expect(await canvas.findByRole('button', { name: '2 following' })).toBeInTheDocument();
      await userEvent.click(canvas.getByRole('button', { name: 'Subscribe' }));
      await expect(await canvas.findByRole('button', { name: 'Unsubscribe' })).toBeInTheDocument();
      await expect(canvas.getByRole('button', { name: '3 following' })).toBeInTheDocument();
   },
};

export const Following: Story = {
   beforeEach: ({ msw }) => {
      msw.use(...subscriptionApi(true));
   },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(await canvas.findByRole('button', { name: '3 following' }));
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText('Tomás Ferreira')).toBeVisible();
      await expect(body.getByText('mentioned')).toBeVisible();
   },
};

export const Compact: Story = { args: { compact: true } };

export const NobodyFollowing: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/issues/:ref/subscribers', () =>
            HttpResponse.json({ nodes: [], subscribed: false })
         )
      );
   },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(await canvas.findByRole('button', { name: '0 following' }));
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText('Nobody is following this task.')).toBeVisible();
   },
};
