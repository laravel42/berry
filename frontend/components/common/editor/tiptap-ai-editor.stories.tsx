import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, fn } from 'storybook/test';
import { TiptapAiEditor } from './tiptap-ai-editor';

const PROJECT_DESCRIPTION = `## Why

Project health lives only in the browser, so a lead's **on track** never reaches anyone else.

## Scope

- Store health on the server with who set it and when
- Let a lead post a short weekly update
- Keep the chip on the project list

See [the plan](https://berry.example.com/berry/plan/plan-1) for the tasks.`;

const meta = {
   component: TiptapAiEditor,
   tags: ['ai-generated', 'needs-work'],
   args: {
      'value': PROJECT_DESCRIPTION,
      'onChange': fn(),
      'onBlur': fn(),
      'placeholder': 'Add description…',
      'aria-label': 'Project description',
      'className': 'min-h-24',
   },
   decorators: [
      (Story) => (
         <div className="flex min-h-72 w-[640px] flex-col">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof TiptapAiEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Markdown in, rendered rich text out, with the AI bar beneath it. */
export const WithAiAssist: Story = {
   play: async ({ canvas }) => {
      await expect(await canvas.findByRole('heading', { name: 'Scope' })).toBeVisible();
      await expect(canvas.getByRole('textbox', { name: 'Ask AI' })).toBeVisible();
   },
};

/** The project page turns the bar off and commits on blur. */
export const PlainProse: Story = {
   args: { aiAssist: false },
   play: async ({ canvas }) => {
      await canvas.findByRole('heading', { name: 'Why' });
      await expect(canvas.queryByRole('textbox', { name: 'Ask AI' })).toBeNull();
   },
};

export const Empty: Story = { args: { value: '' } };

/** Asking the AI sends the whole document to /api/v1/editor/assist and replaces it with the answer. */
export const RewriteWithAi: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.post('*/api/v1/editor/assist', () =>
            HttpResponse.json({
               text: '## Checklist\n\n- Store health on the server\n- Weekly updates from leads',
            })
         )
      );
   },
   play: async ({ args, canvas, userEvent }) => {
      await canvas.findByRole('heading', { name: 'Why' });
      await userEvent.type(
         canvas.getByRole('textbox', { name: 'Ask AI' }),
         'Turn this into a checklist{Enter}'
      );
      await expect(await canvas.findByRole('heading', { name: 'Checklist' })).toBeVisible();
      await expect(args.onChange).toHaveBeenCalledWith(expect.stringContaining('## Checklist'));
   },
};
