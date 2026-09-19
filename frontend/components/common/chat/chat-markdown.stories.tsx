import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { agentReplyMarkdown } from './chat-fixtures';
import { ChatMarkdown } from './chat-markdown';

const meta = {
   component: ChatMarkdown,
   tags: ['ai-generated', 'needs-work'],
   args: { body: agentReplyMarkdown, tone: 'shell' },
   decorators: [
      (Story, { args }) => (
         <div
            className={
               args.tone === 'page'
                  ? 'max-w-2xl'
                  : 'max-w-2xl rounded-md bg-[var(--shell-canvas)] p-4 text-[var(--shell-text-muted)]'
            }
         >
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof ChatMarkdown>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A full agent reply on the chat shell: headings, lists, SQL, a quote and links. */
export const AgentReply: Story = {
   play: async ({ canvas }) => {
      // "## Summary" sits under the page's own h2, so it becomes an h3.
      await expect(canvas.getByRole('heading', { level: 3, name: 'Summary' })).toBeVisible();
      await expect(canvas.getByRole('heading', { level: 4, name: 'Next steps' })).toBeVisible();
      await expect(canvas.getByRole('link', { name: 'PR #412' })).toHaveAttribute(
         'target',
         '_blank'
      );
      await expect(canvas.getByText(/ALTER TABLE projects/)).toBeVisible();
   },
};

/** The same text on a page surface (a review summary, a task comment). */
export const PageTone: Story = { args: { tone: 'page' } };

export const InlineOnly: Story = {
   args: {
      body: 'Renamed `list_files` to `read_file` — **no behaviour change**, just the *name*. See [the diff](https://github.com/berry/berry/pull/413).',
   },
   play: async ({ canvas }) => {
      // Underscores inside identifiers are code, not emphasis.
      await expect(canvas.getByText('list_files').tagName).toBe('CODE');
      await expect(canvas.getByText('name').tagName).toBe('EM');
      await expect(canvas.getByText('no behaviour change').tagName).toBe('STRONG');
   },
};

/** Tables are deliberately unsupported: the pipes stay visible rather than half-rendering. */
export const UnsupportedTable: Story = {
   args: {
      body: `Check results:

| command | result |
| --- | --- |
| pnpm typecheck:server | passed |
| pnpm test:server | failed (exit 1) |`,
   },
   play: async ({ canvas }) => {
      await expect(canvas.queryByRole('table')).toBeNull();
   },
};
