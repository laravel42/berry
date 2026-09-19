import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect } from 'storybook/test';
import NewAgentBuilder from './new-agent-builder';
import { orgParams, storyHandlers } from './stories-fixtures';

const firstDraft = {
   name: 'changelog-writer',
   description: 'Writes the changelog entry for every merged pull request.',
   instructions:
      'Read the merged pull request. Write one line per user-visible change, in the imperative.',
   skills: ['conventional-commits', 'release-voice'],
   mcp: [],
   model: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
};

const refinedDraft = {
   ...firstDraft,
   description: 'Writes the changelog entry for every merged pull request, grouped by area.',
   instructions: `${firstDraft.instructions}\nGroup the lines under Server, Frontend and Docs.`,
};

const builderHandlers = [
   http.post('*/api/v1/agent-builder/sessions', () => HttpResponse.json({ id: 'session-1' })),
   http.post('*/api/v1/agent-builder/sessions/:id/turns', () =>
      HttpResponse.json({ draftId: 'draft-1', draft: firstDraft, unknownSkills: ['release-voice'] })
   ),
   http.get('*/api/v1/agent-builder/sessions/:id', () =>
      HttpResponse.json({
         id: 'session-1',
         status: 'drafting',
         appliedAgentId: null,
         drafts: [
            {
               id: 'draft-1',
               turn: 1,
               prompt: 'An agent that writes our changelog',
               draft: firstDraft,
            },
            { id: 'draft-2', turn: 2, prompt: 'Group it by area', draft: refinedDraft },
         ],
      })
   ),
];

const meta = {
   component: NewAgentBuilder,
   tags: ['ai-generated', 'needs-work'],
   parameters: orgParams,
   args: { sessionId: null },
   beforeEach: ({ msw }) => {
      msw.use(...storyHandlers, ...builderHandlers);
   },
   decorators: [
      (Story) => (
         <div className="w-[1100px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof NewAgentBuilder>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FirstTurn: Story = {
   play: async ({ canvas, userEvent }) => {
      await expect(canvas.getByText('The draft appears here.')).toBeVisible();
      await userEvent.type(
         canvas.getByRole('textbox', { name: 'Describe it' }),
         'An agent that writes our changelog'
      );
      await userEvent.click(canvas.getByRole('button', { name: 'Draft' }));
      // The draft comes back from MSW; a skill the catalogue lacks is struck through.
      await expect(await canvas.findByDisplayValue('changelog-writer')).toBeVisible();
      await expect(canvas.getByText('release-voice')).toHaveClass('line-through');
   },
};

/** Coming back to a session with two drafts; the newest is shown. */
export const Resumed: Story = {
   args: { sessionId: 'session-1' },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('2. Group it by area')).toBeVisible();
      await expect(canvas.getByRole('button', { name: 'Refine' })).toBeDisabled();
   },
};
