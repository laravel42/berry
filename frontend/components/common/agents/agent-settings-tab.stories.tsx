import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, waitFor } from 'storybook/test';
import AgentSettingsTab from './agent-settings-tab';
import {
   frontendAgent,
   gatewayAgent,
   gatewayHandlers,
   importerAgent,
   orgParams,
   seedSession,
   storyHandlers,
} from './stories-fixtures';

const meta = {
   component: AgentSettingsTab,
   tags: ['ai-generated', 'needs-work'],
   parameters: orgParams,
   args: {
      agent: frontendAgent,
      readOnly: false,
      onChange: fn(),
      onDirtyChange: fn(),
      onForbidden: fn(),
      onOpenMoreSettings: fn(),
   },
   beforeEach: ({ msw }) => {
      msw.use(...storyHandlers);
      seedSession();
   },
   decorators: [
      (Story) => (
         <div className="h-[760px] w-[1000px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof AgentSettingsTab>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Editable: Story = {
   play: async ({ args, canvas, userEvent }) => {
      await userEvent.type(canvas.getByRole('textbox', { name: 'Name' }), ' 2');
      await waitFor(() => expect(args.onDirtyChange).toHaveBeenLastCalledWith(true));
   },
};

/** Runtime, concurrency, access and the rest are one link away, under Settings → Agents. */
export const MoreSettings: Story = {
   play: async ({ args, canvas, userEvent }) => {
      const link = canvas.getByRole('link', { name: 'More settings' });
      await expect(link).toHaveAttribute('href', `/berry/settings/ai/${frontendAgent.id}`);
      await userEvent.click(link);
      await expect(args.onOpenMoreSettings).toHaveBeenCalled();
   },
};

/** A plain agent with no model. */
export const Unconfigured: Story = { args: { agent: importerAgent } };

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
