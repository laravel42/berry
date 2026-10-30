import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn } from 'storybook/test';
import { MarkdownFile } from './markdown-file';

const markdown = '# Frontend Engineer\n\nWork in `frontend/`. Never hard-code a colour.';

const meta = {
   component: MarkdownFile,
   tags: ['ai-generated'],
   args: {
      fileName: 'frontend-engineer.md',
      markdown,
      label: 'Frontend Engineer instructions',
      testId: 'agent-instructions',
   },
} satisfies Meta<typeof MarkdownFile>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Opens on the rendered preview, not the raw Markdown. */
export const PreviewByDefault: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('heading', { name: 'Frontend Engineer' })).toBeVisible();
      await expect(canvas.queryByText(markdown)).toBeNull();
   },
};

/** Switching to Raw with no `onEdit` shows the exact text, read-only. */
export const RawIsReadOnlyWithoutOnEdit: Story = {
   play: async ({ canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Raw' }));
      await expect(canvas.getByTestId('agent-instructions-raw')).toHaveTextContent(
         markdown.replace(/\s+/g, ' ')
      );
      await expect(canvas.queryByRole('textbox')).toBeNull();
   },
};

/** With `onEdit`, Raw becomes a textarea and every keystroke is reported. */
export const EditableRaw: Story = {
   args: { onEdit: fn() },
   play: async ({ args, canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Raw' }));
      const field = canvas.getByRole('textbox', { name: 'frontend-engineer.md' });
      await userEvent.type(field, '!');
      await expect(args.onEdit).toHaveBeenCalledWith(`${markdown}!`);
   },
};

/** `collapsible` folds the file to its header until it is opened. */
export const CollapsedByDefault: Story = {
   args: { collapsible: true },
   play: async ({ canvas, userEvent }) => {
      await expect(canvas.queryByRole('heading', { name: 'Frontend Engineer' })).toBeNull();
      await userEvent.click(canvas.getByRole('button', { name: 'frontend-engineer.md' }));
      await expect(canvas.getByRole('heading', { name: 'Frontend Engineer' })).toBeVisible();
   },
};

/** Problems with the text are listed under it, worded already. */
export const WithErrors: Story = {
   args: { errors: ['Line 3: an unclosed code fence.'] },
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('list')).toHaveTextContent('Line 3: an unclosed code fence.');
   },
};

/** A badge beside the name and an extra control after Copy and Download. */
export const WithBadgeAndAction: Story = {
   args: {
      badge: <span data-testid="badge">from a skill</span>,
      action: <button type="button">Revert</button>,
   },
   play: async ({ canvas }) => {
      await expect(canvas.getByTestId('badge')).toHaveTextContent('from a skill');
      await expect(canvas.getByRole('button', { name: 'Revert' })).toBeVisible();
   },
};
