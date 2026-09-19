import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { useState } from 'react';
import { expect, fn, waitFor } from 'storybook/test';
import { ChatComposer } from './chat-composer';

type ComposerProps = Parameters<typeof ChatComposer>[0];

/** The composer is controlled; the page owns the text, so the story does too. */
function Controlled(props: ComposerProps) {
   const [value, setValue] = useState(props.value);
   return (
      <ChatComposer
         {...props}
         value={value}
         onChange={(next) => {
            setValue(next);
            props.onChange(next);
         }}
      />
   );
}

const meta = {
   component: ChatComposer,
   tags: ['ai-generated', 'needs-work'],
   args: {
      value: '',
      onChange: fn(),
      onSend: fn(),
      onStop: null,
      queueing: false,
      disabled: false,
      placeholder: 'Message Backend Engineer…',
      workspaceId: 'ws-1',
   },
   render: (args) => <Controlled {...args} />,
   decorators: [
      (Story) => (
         <div className="w-[560px] bg-[var(--shell-canvas)] pt-40 text-[var(--shell-text)]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof ChatComposer>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Enter sends; Shift+Enter would break the line instead. */
export const TypeAndSend: Story = {
   play: async ({ args, canvas, userEvent }) => {
      const send = canvas.getByRole('button', { name: 'Send' });
      await expect(send).toBeDisabled();
      await userEvent.type(
         canvas.getByRole('textbox', { name: 'Message Backend Engineer…' }),
         'Draft the migration{Enter}'
      );
      await expect(args.onSend).toHaveBeenCalledTimes(1);
   },
};

/** A reply is running: the send button queues, and Stop appears beside it. */
export const QueueingBehindReply: Story = {
   args: { value: 'And add tests while you are there', queueing: true, onStop: fn() },
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('button', { name: 'Queue' })).toBeEnabled();
      await expect(canvas.getByRole('button', { name: 'Stop the reply' })).toBeVisible();
   },
};

export const Disabled: Story = {
   args: { disabled: true, placeholder: 'Message an agent…' },
};

/** Typing `@` searches issues and projects; Enter inserts the identifier. */
export const MentionAnIssue: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/search', () =>
            HttpResponse.json({
               nodes: [
                  {
                     type: 'issue',
                     id: 'issue-42',
                     title: 'Persist project health',
                     subtitle: null,
                     identifier: 'BERR-42',
                     boardId: 'board-1',
                     agentId: null,
                     status: 'in_progress',
                  },
                  {
                     type: 'project',
                     id: 'project-berry',
                     title: 'Berry core',
                     subtitle: null,
                     identifier: null,
                     boardId: null,
                     agentId: null,
                     status: null,
                  },
               ],
               pageInfo: { hasNextPage: false, endCursor: null },
            })
         )
      );
   },
   play: async ({ args, canvas, userEvent }) => {
      const input = canvas.getByRole('textbox', { name: 'Message Backend Engineer…' });
      await userEvent.type(input, 'Look at @pers');
      await expect(await canvas.findByRole('button', { name: /BERR-42/ })).toBeVisible();
      await userEvent.keyboard('{Enter}');
      await waitFor(() => expect(input).toHaveValue('Look at BERR-42 '));
      // Enter picked the mention; it did not send the message.
      await expect(args.onSend).not.toHaveBeenCalled();
   },
};
