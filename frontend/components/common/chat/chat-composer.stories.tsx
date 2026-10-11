import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { useState } from 'react';
import { expect, fn, waitFor } from 'storybook/test';
import { chatAgents } from './chat-fixtures';
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

const page = { pageInfo: { hasNextPage: false, endCursor: null } };

/** Typing `@` lists people and agents; Enter tags the highlighted one. */
export const MentionSomeone: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/workspaces/:workspaceId/members', () =>
            HttpResponse.json({
               nodes: [
                  {
                     userId: 'user-andrea',
                     workspaceId: 'ws-1',
                     role: 'admin',
                     email: 'andrea@example.com',
                     name: 'Andrea Lunelio',
                     avatarUrl: null,
                     joinedAt: '2026-01-04T00:00:00Z',
                     updatedAt: '2026-01-04T00:00:00Z',
                  },
               ],
               ...page,
            })
         ),
         http.get('*/api/v1/agents', () => HttpResponse.json({ nodes: chatAgents, ...page }))
      );
   },
   play: async ({ args, canvas, userEvent }) => {
      const input = canvas.getByRole('textbox', { name: 'Message Backend Engineer…' });
      await userEvent.type(input, 'Ask @');
      await expect(await canvas.findByRole('option', { name: 'Andrea Lunelio' })).toBeVisible();
      await expect(canvas.getByRole('option', { name: 'Orchestrator' })).toBeVisible();
      await userEvent.keyboard('{Enter}');
      await waitFor(() => expect(input).toHaveValue('Ask @Andrea Lunelio '));
      // Enter tagged the person; it did not send the message.
      await expect(args.onSend).not.toHaveBeenCalled();
   },
};

/** Typing `/` lists skills and commands; Enter writes the highlighted one. */
export const SlashSkillOrCommand: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/skills', () =>
            HttpResponse.json({
               nodes: [
                  {
                     id: 'skill-release',
                     name: 'release-notes',
                     description: 'Turn merged work into a changelog entry.',
                     content: 'Write the notes.',
                     labels: [],
                     source: { kind: 'manual', url: null, ref: null, importedAt: null },
                     files: [],
                     createdBy: null,
                     creatorName: null,
                     agents: [],
                     createdAt: '2026-08-01T09:00:00Z',
                     updatedAt: '2026-09-10T09:00:00Z',
                  },
               ],
            })
         ),
         http.get('*/api/v1/catalogs/:workspaceId/quick-actions', () =>
            HttpResponse.json({
               nodes: [
                  {
                     id: 'action-summarise',
                     workspaceId: 'ws-1',
                     name: 'Summarise',
                     description: 'A short recap of the conversation.',
                     targetAgentId: 'agent-backend',
                     prompt: 'Summarise this conversation.',
                     visibility: 'workspace',
                     createdBy: 'user-andrea',
                     createdAt: '2026-08-01T09:00:00Z',
                     updatedAt: '2026-09-10T09:00:00Z',
                  },
               ],
            })
         )
      );
   },
   play: async ({ args, canvas, userEvent }) => {
      const input = canvas.getByRole('textbox', { name: 'Message Backend Engineer…' });
      await userEvent.type(input, '/');
      await expect(await canvas.findByRole('option', { name: /release-notes/ })).toBeVisible();
      await expect(canvas.getByRole('option', { name: /Summarise/ })).toBeVisible();
      await userEvent.keyboard('{Enter}');
      await waitFor(() => expect(input).toHaveValue('/release-notes '));
      await expect(args.onSend).not.toHaveBeenCalled();
   },
};
