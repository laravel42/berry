import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect } from 'storybook/test';
import NewAgentManual from './new-agent-manual';
import { frontendAgent, orgParams, seedSession, storyHandlers } from './stories-fixtures';

const DRAFT_KEY = 'berry.new-agent.draft';

const clearDraft = () => {
   try {
      localStorage.removeItem(DRAFT_KEY);
   } catch {
      /* A browser without storage has no draft to clear. */
   }
};

const meta = {
   component: NewAgentManual,
   tags: ['ai-generated', 'needs-work'],
   parameters: orgParams,
   beforeEach: ({ msw }) => {
      msw.use(...storyHandlers);
      seedSession();
      clearDraft();
      return clearDraft;
   },
   decorators: [
      (Story) => (
         <div className="w-[720px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof NewAgentManual>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Blank: Story = {
   play: async ({ canvas, userEvent }) => {
      const create = canvas.getByRole('button', { name: 'Create agent' });
      await expect(create).toBeDisabled();
      await userEvent.type(canvas.getByRole('textbox', { name: 'Name' }), 'changelog-writer');
      await expect(create).toBeEnabled();
      // Skills, runtimes and models are offered once MSW answers.
      await expect(await canvas.findByRole('checkbox', { name: 'design-tokens' })).toBeVisible();
   },
};

/** `?duplicate=` prefills from another agent, without its env or MCP servers. */
export const Duplicate: Story = {
   args: { duplicateId: frontendAgent.id },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('Copied from Frontend Engineer')).toBeVisible();
      await expect(canvas.getByRole('textbox', { name: 'Name' })).toHaveValue(
         'Frontend Engineer copy'
      );
   },
};

export const RestoredDraft: Story = {
   beforeEach: () => {
      try {
         localStorage.setItem(
            DRAFT_KEY,
            JSON.stringify({
               name: 'on-call-summarizer',
               instructions: 'Summarize last night’s pages.',
            })
         );
      } catch {
         /* Without storage the story shows a blank form. */
      }
   },
};

export const CreateFails: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.post('*/api/v1/agents', () =>
            HttpResponse.json(
               { error: { code: 'CONFLICT', message: 'An agent with that name exists.' } },
               { status: 409 }
            )
         )
      );
   },
   play: async ({ canvas, userEvent }) => {
      await userEvent.type(canvas.getByRole('textbox', { name: 'Name' }), 'release-notes');
      await userEvent.click(canvas.getByRole('button', { name: 'Create agent' }));
      await expect(await canvas.findByRole('alert')).toHaveTextContent(
         'An agent with that name exists.'
      );
   },
};
