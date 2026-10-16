import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, waitFor } from 'storybook/test';
import { useSessionStore } from '@/store/session-store';
import { Chat } from './chat';
import { chatHandlers, chatSession } from './chat-fixtures';

const meta = {
   component: Chat,
   tags: ['ai-generated', 'needs-work'],
   parameters: {
      layout: 'fullscreen',
      nextjs: { navigation: { pathname: '/berry/chat', segments: [['orgId', 'berry']] } },
   },
   beforeEach: ({ msw }) => {
      useSessionStore.setState(chatSession);
      msw.use(...chatHandlers);
   },
   decorators: [
      (Story) => (
         <div className="h-[720px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof Chat>;

export default meta;
type Story = StoryObj<typeof meta>;

/** With no session in the URL the page opens a conversation with the Orchestrator. */
export const NoConversationOpen: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.queryByRole('heading', { name: 'Orchestrator' })).toBeNull();
      await expect(canvas.queryByRole('button', { name: 'New chat' })).toBeNull();
      await expect(
         await canvas.findByRole('textbox', { name: 'Message Orchestrator…' })
      ).toBeEnabled();
   },
};

/** `?session=` opens a conversation: history, follow-up suggestions and the composer. */
export const OpenConversation: Story = {
   parameters: {
      nextjs: {
         navigation: {
            pathname: '/berry/chat',
            segments: [['orgId', 'berry']],
            query: { session: 'conv-1' },
         },
      },
   },
   play: async ({ canvas, userEvent }) => {
      await expect(
         await canvas.findByRole('textbox', { name: 'Message Backend Engineer…' })
      ).toBeVisible();
      await expect(canvas.queryByRole('heading', { name: 'Backend Engineer' })).toBeNull();
      await expect(await canvas.findByText('Suggested next')).toBeVisible();
      const composer = canvas.getByRole('textbox', { name: 'Message Backend Engineer…' });
      await userEvent.type(composer, 'Open the pull request please{Enter}');
      // Sent as a task (POST …/messages, MSW): the box empties at once.
      await waitFor(() => expect(composer).toHaveValue(''));
   },
};

/** A workspace with no agents says so rather than offering an empty picker. */
export const NoAgents: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/agents', () =>
            HttpResponse.json({ nodes: [], pageInfo: { hasNextPage: false, endCursor: null } })
         ),
         http.get('*/api/v1/conversations', () => HttpResponse.json({ nodes: [] }))
      );
   },
   play: async ({ canvas }) => {
      await expect(
         await canvas.findByText('This workspace has no agents to talk to yet.')
      ).toBeVisible();
   },
};
