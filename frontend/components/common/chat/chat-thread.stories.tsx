import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn } from 'storybook/test';
import { agentReplyMarkdown, chatAgents, chatMessages, chatSuggestions } from './chat-fixtures';
import { ChatThread } from './chat-thread';

const meta = {
   component: ChatThread,
   tags: ['ai-generated', 'needs-work'],
   args: {
      messages: chatMessages,
      agentName: 'Backend Engineer',
      starters: [],
      suggestions: [],
      onUseSuggestion: fn(),
      onRegenerate: fn(),
      regenerating: false,
      hasEarlier: false,
      loadingEarlier: false,
      onLoadEarlier: fn(),
      stage: null,
      streamingText: null,
   },
   decorators: [
      (Story) => (
         <div className="flex h-[640px] w-[720px] flex-col bg-[var(--shell-canvas)] text-[var(--shell-text)]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof ChatThread>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Two days of conversation, split by a day divider, ending on a Markdown reply. */
export const Conversation: Story = {
   args: { hasEarlier: true },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('today')).toBeVisible();
      await expect(canvas.getByRole('button', { name: 'Load earlier messages' })).toBeVisible();
   },
};

/** A new conversation offers the agent's own openers. */
export const EmptyWithStarters: Story = {
   args: { messages: [], starters: chatAgents[1]!.conversationStarters },
   play: async ({ args, canvas, userEvent }) => {
      await userEvent.click(
         canvas.getByRole('button', { name: 'Draft a migration for project health' })
      );
      await expect(args.onUseSuggestion).toHaveBeenCalledWith(
         'Draft a migration for project health'
      );
   },
};

export const NoAgentYet: Story = { args: { messages: [], agentName: null } };

/** Waiting on a reply that has not written anything yet. */
export const Thinking: Story = {
   args: { stage: 'thinking' },
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('status')).toHaveTextContent('thinking');
   },
};

/** The reply is being written; it is shown before it is stored. */
export const StreamingReply: Story = {
   args: {
      messages: chatMessages.slice(0, 3),
      stage: 'writing',
      streamingText: agentReplyMarkdown.slice(0, 420),
   },
};

export const WithFollowUps: Story = {
   args: { suggestions: chatSuggestions },
   play: async ({ args, canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Suggest others' }));
      await expect(args.onRegenerate).toHaveBeenCalled();
   },
};
