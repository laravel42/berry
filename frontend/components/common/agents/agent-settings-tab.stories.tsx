import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, waitFor } from 'storybook/test';
import AgentSettingsTab from './agent-settings-tab';
import {
   frontendAgent,
   gatewayAgent,
   gatewayHandlers,
   importerAgent,
   rosterMap,
   seedSession,
   storyHandlers,
} from './stories-fixtures';

const meta = {
   component: AgentSettingsTab,
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
         <div className="h-[1100px] w-[1000px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof AgentSettingsTab>;

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

/** A plain agent with no model, no starters, and no runtime of its own. */
export const Unconfigured: Story = {
   args: { agent: importerAgent, roster: rosterMap.get(importerAgent.id) },
};

export const ReadOnly: Story = { args: { readOnly: true } };

/** Models go through the gateway: the tier choice replaces the model picker and saves as a draft. */
export const Gateway: Story = {
   args: { agent: gatewayAgent },
   beforeEach: ({ msw }) => {
      msw.use(...gatewayHandlers);
   },
   play: async ({ args, canvas, userEvent }) => {
      await userEvent.click(await canvas.findByRole('radio', { name: /BerryLow/ }));
      await waitFor(() => expect(args.onDirtyChange).toHaveBeenLastCalledWith(true));
   },
};
