import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse, delay } from 'msw';
import { expect, fn, waitFor } from 'storybook/test';
import type { ProjectDraftFields } from '@/lib/editor-ai';
import { AgentDraftPanel } from './agent-draft-panel';

const emptyDraft: ProjectDraftFields = {
   name: '',
   description: '',
   status: 'to-do',
   priority: 'no-priority',
   startDate: null,
   targetDate: null,
};

const meta = {
   component: AgentDraftPanel,
   tags: ['ai-generated'],
   args: { draft: emptyDraft, onPatch: fn(), onHide: fn(), onClose: fn() },
   decorators: [
      (Story) => (
         <div className="flex h-[560px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof AgentDraftPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** No messages yet: the starters offer a first prompt. */
export const EmptyWithStarters: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByText('Draft a new project')).toBeVisible();
      await expect(canvas.getByRole('button', { name: 'Outline the scope' })).toBeVisible();
   },
};

/** A reply lands as a message, and the fields it set are named underneath it. */
export const ReplyAppliesAPatch: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.post('*/api/v1/editor/project-draft', () =>
            HttpResponse.json({
               reply: 'I named it Persist project health and set it to high priority.',
               patch: { name: 'Persist project health', priority: 'high' },
            })
         )
      );
   },
   play: async ({ args, canvas, userEvent }) => {
      await userEvent.type(
         canvas.getByRole('textbox', { name: 'Message the project assistant' }),
         'Draft the project brief from the form so far.'
      );
      await userEvent.click(canvas.getByRole('button', { name: 'Send' }));
      await expect(
         await canvas.findByText('I named it Persist project health and set it to high priority.')
      ).toBeVisible();
      await waitFor(() =>
         expect(args.onPatch).toHaveBeenCalledWith({
            name: 'Persist project health',
            priority: 'high',
         })
      );
      await expect(canvas.getByText('Updated name, priority')).toBeVisible();
   },
};

/** Stop aborts the turn and gives the typed text back rather than losing it. */
export const StopAbortsTheTurn: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.post('*/api/v1/editor/project-draft', async () => {
            await delay('infinite');
         })
      );
   },
   play: async ({ canvas, userEvent }) => {
      const field = canvas.getByRole('textbox', { name: 'Message the project assistant' });
      await userEvent.type(field, 'Suggest a short, specific project name.');
      await userEvent.click(canvas.getByRole('button', { name: 'Send' }));
      await userEvent.click(await canvas.findByRole('button', { name: 'Stop drafting' }));
      await waitFor(() =>
         expect(canvas.getByRole('textbox', { name: 'Message the project assistant' })).toHaveValue(
            'Suggest a short, specific project name.'
         )
      );
   },
};

/** A failed turn stays in the thread, worded, rather than being resent silently. */
export const FailedTurnStaysInThread: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.post('*/api/v1/editor/project-draft', () =>
            HttpResponse.json(
               { error: { code: 'INTERNAL', message: 'The assistant is down.' } },
               { status: 500 }
            )
         )
      );
   },
   play: async ({ canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Draft a brief' }));
      await expect(await canvas.findByText('The assistant is down.')).toBeVisible();
   },
};

/** Hide folds the panel away without discarding the draft; Close ends the dialog. */
export const HideAndClose: Story = {
   play: async ({ args, canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Hide' }));
      await expect(args.onHide).toHaveBeenCalledTimes(1);
      await userEvent.click(canvas.getByRole('button', { name: 'Close' }));
      await expect(args.onClose).toHaveBeenCalledTimes(1);
   },
};
