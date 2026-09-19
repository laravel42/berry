import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useRef } from 'react';
import { expect, waitFor } from 'storybook/test';
import { ShortcutProvider } from '@/components/layout/shortcut-provider';
import { FindInIssue } from './find-in-issue';

/** A task pane with enough text to search, and the find bar bound to it. */
function TaskPane() {
   const pane = useRef<HTMLDivElement>(null);
   return (
      <div ref={pane} className="relative h-[360px] w-[720px] overflow-y-auto border p-6">
         <FindInIssue scope={pane} />
         <h1>Persist project health and updates</h1>
         <p className="mt-3">
            The health chip has only ever lived in the browser. A reload forgets the health a person
            set, and the project list shows No update again.
         </p>
         <p className="mt-3">
            Add a health column, write each change as a project update, and have the chip read
            health from the server.
         </p>
      </div>
   );
}

const meta = {
   component: TaskPane,
   tags: ['ai-generated', 'needs-work'],
   decorators: [
      (Story) => (
         <ShortcutProvider>
            <Story />
         </ShortcutProvider>
      ),
   ],
} satisfies Meta<typeof TaskPane>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Hidden until asked for: the bar belongs to the shortcut. */
export const Closed: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.queryByRole('textbox')).toBeNull();
   },
};

export const FindMatches: Story = {
   play: async ({ canvas, userEvent }) => {
      // mod+F: Ctrl counts as mod on every platform.
      await userEvent.keyboard('{Control>}f{/Control}');
      const field = await canvas.findByRole('textbox', { name: 'Find in this task' });
      await waitFor(() => expect(field).toHaveFocus());
      await userEvent.type(field, 'health');
      await expect(await canvas.findByText('1/5')).toBeInTheDocument();
      await userEvent.keyboard('{Enter}');
      await expect(canvas.getByText('2/5')).toBeInTheDocument();
   },
};

export const NoMatches: Story = {
   play: async ({ canvas, userEvent }) => {
      await userEvent.keyboard('{Control>}f{/Control}');
      await userEvent.type(await canvas.findByRole('textbox'), 'kubernetes');
      await expect(await canvas.findByText('no matches')).toBeInTheDocument();
      await expect(canvas.getByRole('button', { name: 'Next match' })).toBeDisabled();
   },
};

export const EscapeCloses: Story = {
   play: async ({ canvas, userEvent }) => {
      await userEvent.keyboard('{Control>}f{/Control}');
      // Focus lands a frame after the bar opens; Escape belongs to the field.
      const field = await canvas.findByRole('textbox');
      await waitFor(() => expect(field).toHaveFocus());
      await userEvent.keyboard('{Escape}');
      await waitFor(() => expect(canvas.queryByRole('textbox')).toBeNull());
   },
};
