import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, waitFor } from 'storybook/test';
import AgentExecutionSettings from './agent-execution-settings';
import {
   frontendAgent,
   importerAgent,
   rosterMap,
   seedSession,
   storyHandlers,
} from './stories-fixtures';

const meta = {
   component: AgentExecutionSettings,
   tags: ['ai-generated', 'needs-work'],
   args: {
      agent: frontendAgent,
      roster: rosterMap.get(frontendAgent.id),
      readOnly: false,
      onChange: fn(),
      onRosterStale: fn(),
      onDirtyChange: fn(),
      onForbidden: fn(),
   },
   beforeEach: ({ msw }) => {
      msw.use(...storyHandlers);
      seedSession();
   },
   decorators: [
      (Story) => (
         <div className="w-[700px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof AgentExecutionSettings>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Editable: Story = {
   play: async ({ args, canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: '4', pressed: false }));
      await expect(canvas.getByRole('button', { name: '4' })).toHaveAttribute(
         'aria-pressed',
         'true'
      );
      await waitFor(() => expect(args.onDirtyChange).toHaveBeenLastCalledWith(true));
   },
};

/** A plain agent with no runtime of its own. */
export const Unconfigured: Story = {
   args: { agent: importerAgent, roster: rosterMap.get(importerAgent.id) },
};

export const ReadOnly: Story = { args: { readOnly: true } };
