import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, fn, within } from 'storybook/test';
import { AgentModelPicker } from './agent-model-picker';
import { storyHandlers } from './stories-fixtures';

const meta = {
   component: AgentModelPicker,
   tags: ['ai-generated', 'needs-work'],
   args: {
      provider: 'bedrock',
      model: 'us.anthropic.claude-sonnet-5',
      onChange: fn(),
   },
   beforeEach: ({ msw }) => {
      msw.use(...storyHandlers);
   },
   decorators: [
      (Story) => (
         <div className="w-[860px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof AgentModelPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Assigned: Story = {
   play: async ({ args, canvas, userEvent }) => {
      // The catalogue arrives from GET /api/v1/agents/models (MSW), A–Z by name.
      const list = await canvas.findByRole('listbox');
      await within(list).findByRole('option', { name: /Claude Haiku 4.5/ });
      const names = within(list)
         .getAllByRole('option')
         .map((option) => option.textContent ?? '');
      const order = ['Claude Haiku 4.5', 'Claude Opus 5', 'Claude Sonnet 5', 'Qwen3 32B'];
      await expect(order.every((name, index) => names[index]?.includes(name))).toBe(true);
      await userEvent.click(within(list).getByRole('option', { name: /Claude Haiku 4.5/ }));
      await expect(args.onChange).toHaveBeenCalledWith(
         'bedrock',
         'us.anthropic.claude-haiku-4-5-20251001-v1:0'
      );
   },
};

export const NoModel: Story = { args: { provider: null, model: null } };

/** Assigned to a model the catalogue no longer offers. */
export const Retired: Story = {
   args: { provider: 'bedrock', model: 'us.anthropic.claude-3-sonnet' },
   play: async ({ canvas }) => {
      await expect(
         await canvas.findByText('This model is assigned, but it is no longer in the catalogue.')
      ).toBeVisible();
   },
};

export const Disabled: Story = { args: { disabled: true } };

export const LoadFailed: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/agents/models', () =>
            HttpResponse.json(
               { error: { code: 'INTERNAL', message: 'Catalogue unavailable' } },
               { status: 500 }
            )
         )
      );
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByRole('alert')).toBeVisible();
   },
};
