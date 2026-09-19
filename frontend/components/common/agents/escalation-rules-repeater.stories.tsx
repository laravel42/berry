import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';
import { EscalationRulesRepeater } from './escalation-rules-repeater';
import { frontendContract, roleOptions } from './stories-fixtures';

const meta = {
   component: EscalationRulesRepeater,
   tags: ['ai-generated', 'needs-work'],
   args: {
      title: 'Escalation',
      description: 'When this role stops and hands a decision to someone else.',
      value: frontendContract.escalation_rules,
      roleOptions,
      onChange: fn(),
   },
   decorators: [
      (Story) => (
         <div className="w-[720px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof EscalationRulesRepeater>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Rules: Story = {
   play: async ({ args, canvas, canvasElement, userEvent }) => {
      // The second rule escalates to a person; switch its decision kind.
      await userEvent.click(canvas.getByRole('button', { name: 'Technical' }));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('menuitem', { name: 'Security' }));
      await expect(args.onChange).toHaveBeenCalledWith([
         frontendContract.escalation_rules[0],
         { ...frontendContract.escalation_rules[1], decision: 'security' },
      ]);
   },
};

export const AddRule: Story = {
   args: { value: [] },
   play: async ({ args, canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Add escalation' }));
      // A new rule starts as a technical decision for a person.
      await expect(args.onChange).toHaveBeenCalledWith([
         { when: '', to: 'human', decision: 'technical' },
      ]);
   },
};

export const ReadOnly: Story = { args: { disabled: true } };
