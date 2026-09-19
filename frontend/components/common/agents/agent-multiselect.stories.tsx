import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { expect, fn, within } from 'storybook/test';
import { AgentCommandList, AgentMultiselect, AgentPicker } from './agent-multiselect';
import { roleOptions } from './stories-fixtures';

const meta = {
   component: AgentMultiselect,
   tags: ['ai-generated', 'needs-work'],
   args: {
      value: ['qa-engineer'],
      options: roleOptions,
      onChange: fn(),
   },
   decorators: [
      (Story) => (
         <div className="w-[480px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof AgentMultiselect>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Delegation targets on a role contract: role keys as ids, agent ids as colour seeds. */
export const Chips: Story = {
   args: { value: ['qa-engineer', 'product-designer'] },
   play: async ({ args, canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Remove QA Engineer' }));
      await expect(args.onChange).toHaveBeenCalledWith(['product-designer']);
   },
};

export const Empty: Story = { args: { value: [] } };

export const OpenCatalogue: Story = {
   play: async ({ args, canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Add agent' }));
      // The catalogue renders in a popover portal on the document body.
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.type(await body.findByPlaceholderText('Search agents'), 'back');
      await userEvent.click(await body.findByText('Backend Engineer'));
      await expect(args.onChange).toHaveBeenCalledWith(['qa-engineer', 'backend-engineer']);
   },
};

/** Read-only: chips without remove buttons, and no add control. */
export const Disabled: Story = {
   args: { value: ['qa-engineer', 'orchestrator'], disabled: true },
   play: async ({ canvas }) => {
      await expect(canvas.queryByRole('button')).toBeNull();
   },
};

/** The single-pick popover with a custom trigger, as the autopilot assignee uses it. */
export const SinglePicker: Story = {
   render: (args) => {
      function Single() {
         const [value, setValue] = useState<string | null>(null);
         const label = args.options.find((option) => option.id === value)?.label;
         return (
            <AgentPicker
               options={args.options}
               value={value}
               multiple={false}
               onChange={(next) => setValue(typeof next === 'string' ? next : null)}
               trigger={
                  <button type="button" className="rounded-md border px-3 py-1.5">
                     {label ?? 'Choose an agent'}
                  </button>
               }
            />
         );
      }
      return <Single />;
   },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Choose an agent' }));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByText('Orchestrator'));
      await expect(await canvas.findByRole('button', { name: 'Orchestrator' })).toBeVisible();
   },
};

/** The bare searchable list, for embedding in a menu. */
export const CommandListOnly: Story = {
   render: (args) => {
      function Embedded() {
         const [query, setQuery] = useState('');
         return (
            <div className="w-72 rounded-md border">
               <AgentCommandList
                  options={args.options}
                  value={args.value}
                  onSelect={() => undefined}
                  query={query}
                  onQueryChange={setQuery}
               />
            </div>
         );
      }
      return <Embedded />;
   },
};
