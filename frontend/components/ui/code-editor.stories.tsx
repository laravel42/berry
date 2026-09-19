import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, waitFor } from 'storybook/test';
import { CodeEditor } from './code-editor';

const command = `# run the server tests for the dispatcher
cd server-ts && node --test --experimental-strip-types src/runs/dispatcher.test.ts
echo "exit code: $?"`;

const output = Array.from(
   { length: 40 },
   (_, index) => `ok ${index + 1} - dispatcher claims task ${index + 1} under a renewed lease`
).join('\n');

const meta = {
   component: CodeEditor,
   tags: ['ai-generated', 'needs-work'],
   args: { value: command },
   decorators: [
      (Story) => (
         <div className="w-[640px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof CodeEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ShellCommand: Story = {
   play: async ({ canvasElement }) => {
      // CodeMirror mounts after the first render; the surface must stay read-only.
      await waitFor(() =>
         expect(canvasElement.querySelector('.cm-content')).toHaveAttribute(
            'contenteditable',
            'false'
         )
      );
      await expect(canvasElement.querySelectorAll('.cm-line')).toHaveLength(3);
   },
};

/** Long tool output, capped the way the transcript caps it. */
export const CappedHeight: Story = {
   args: { value: output, maxHeight: '10rem' },
   play: async ({ canvasElement }) => {
      await waitFor(() => expect(canvasElement.querySelector('.cm-scroller')).not.toBeNull());
      const scroller = canvasElement.querySelector<HTMLElement>('.cm-scroller')!;
      await expect(getComputedStyle(scroller).maxHeight).toBe('160px');
   },
};

export const LongLineWraps: Story = {
   args: {
      value: `curl -sS -X POST "$BERRY_RUNTIME_CALLBACK_URL/api/v1/agent-tools/comment" -H "Authorization: Bearer $TASK_TOKEN" -d '{"body":"Opened a pull request for BERR-42 with the health column and the migration."}'`,
   },
};
