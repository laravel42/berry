import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { expect, within } from 'storybook/test';

import { PasswordField, passwordMeetsRules, passwordRules } from './password-field';

/**
 * Stories drive the field through a real `useState`, because the whole point of
 * the component is that the checklist tracks what was typed.
 */
function Harness({ rules = passwordRules }: { rules?: typeof passwordRules }) {
   const [value, setValue] = useState('');
   return (
      <div className="w-80 p-6">
         <label htmlFor="pw">Password</label>
         <PasswordField
            id="pw"
            value={value}
            rules={rules}
            onChange={(event) => setValue(event.target.value)}
         />
         <button type="button" disabled={!passwordMeetsRules(value, rules)}>
            Create account
         </button>
      </div>
   );
}

const meta = {
   component: PasswordField,
   tags: ['ai-generated'],
   // Every story renders the harness, which owns the value; this only
   // satisfies the required prop on the component's own args.
   args: { value: '' },
} satisfies Meta<typeof PasswordField>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Focus opens the checklist and must leave the caret where it was. */
export const OpensOnFocusWithoutTakingIt: Story = {
   render: () => <Harness />,
   play: async ({ canvasElement, userEvent }) => {
      const canvas = within(canvasElement);
      const body = within(canvasElement.ownerDocument.body);
      const field = canvas.getByLabelText('Password');

      await userEvent.click(field);
      await expect(await body.findByText('At least 12 characters')).toBeVisible();
      // The popover is feedback: it never steals the focus it points at.
      await expect(field).toHaveFocus();
   },
};

/** The marker fills as the rule is met, and says so in words too. */
export const MarkerFillsWhenTheRuleIsMet: Story = {
   render: () => <Harness />,
   play: async ({ canvasElement, userEvent }) => {
      const canvas = within(canvasElement);
      const body = within(canvasElement.ownerDocument.body);
      const field = canvas.getByLabelText('Password');
      const submit = canvas.getByRole('button', { name: 'Create account' });

      await userEvent.click(field);
      await userEvent.type(field, 'short');

      const unmet = (await body.findByText('At least 12 characters')).closest('li');
      await expect(unmet).not.toBeNull();
      // `[ ]`: brackets, no dot. The state is a shape, not only a colour.
      await expect(unmet?.querySelectorAll('circle').length).toBe(0);
      await expect(within(unmet as HTMLElement).getByText('— not met yet')).toBeInTheDocument();
      await expect(submit).toBeDisabled();

      await userEvent.type(field, '-but-longer');

      const met = (await body.findByText('At least 12 characters')).closest('li');
      // `[*]`: the berry dot arrives.
      await expect(met?.querySelectorAll('circle').length).toBe(1);
      await expect(within(met as HTMLElement).getByText('— met')).toBeInTheDocument();
      // One rule list drives both the checklist and the gate.
      await expect(submit).toBeEnabled();
   },
};

/** The eye flips the input between masked and legible. */
export const RevealTogglesTheInput: Story = {
   render: () => <Harness />,
   play: async ({ canvasElement, userEvent }) => {
      const canvas = within(canvasElement);
      const field = canvas.getByLabelText('Password');

      await userEvent.type(field, 'hunter-two-two-two');
      await expect(field).toHaveAttribute('type', 'password');

      await userEvent.click(canvas.getByRole('button', { name: 'Show password' }));
      await expect(field).toHaveAttribute('type', 'text');
      // The name states the next action, so it has to change with the state.
      await expect(canvas.getByRole('button', { name: 'Hide password' })).toBeInTheDocument();

      await userEvent.click(canvas.getByRole('button', { name: 'Hide password' }));
      await expect(field).toHaveAttribute('type', 'password');
   },
};

/** Signing in, the password already exists: its rules are not shown. */
export const NoChecklistWithoutRules: Story = {
   render: () => <Harness rules={[]} />,
   play: async ({ canvasElement, userEvent }) => {
      const canvas = within(canvasElement);
      const body = within(canvasElement.ownerDocument.body);
      const field = canvas.getByLabelText('Password');

      await userEvent.click(field);
      await expect(body.queryByText('At least 12 characters')).not.toBeInTheDocument();
      // The eye is still there; looking at what you typed always helps.
      await expect(canvas.getByRole('button', { name: 'Show password' })).toBeInTheDocument();
   },
};

/** Escape dismisses the checklist while the field keeps focus. */
export const EscapeDismisses: Story = {
   render: () => <Harness />,
   play: async ({ canvasElement, userEvent }) => {
      const canvas = within(canvasElement);
      const body = within(canvasElement.ownerDocument.body);
      const field = canvas.getByLabelText('Password');

      await userEvent.click(field);
      await expect(await body.findByText('At least 12 characters')).toBeVisible();

      await userEvent.keyboard('{Escape}');
      await expect(body.queryByText('At least 12 characters')).not.toBeInTheDocument();
      await expect(field).toHaveFocus();
   },
};

/** The rules must stay the ones the server enforces. */
export const RulesMatchTheServer: Story = {
   render: () => <Harness />,
   play: async () => {
      // server-ts/src/auth/better-auth.ts: minPasswordLength 12, max 256,
      // and no complexity check. If that changes, this fails first.
      await expect(passwordRules.map((rule) => rule.id)).toEqual(['min', 'max']);
      await expect(passwordMeetsRules('elevenchars')).toBe(false);
      await expect(passwordMeetsRules('twelvechars!')).toBe(true);
      await expect(passwordMeetsRules('a'.repeat(256))).toBe(true);
      await expect(passwordMeetsRules('a'.repeat(257))).toBe(false);
   },
};
