import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { expect, waitFor, within } from 'storybook/test';

import { RevealToggle } from './reveal-toggle';

function Harness({ initial = false }: { initial?: boolean }) {
   const [revealed, setRevealed] = useState(initial);
   return (
      <div className="p-6">
         <RevealToggle
            revealed={revealed}
            onRevealedChange={setRevealed}
            showLabel="Show password"
            hideLabel="Hide password"
         />
         <output>{revealed ? 'revealed' : 'hidden'}</output>
      </div>
   );
}

const meta = {
   component: RevealToggle,
   tags: ['ai-generated'],
   args: {
      revealed: false,
      onRevealedChange: () => undefined,
      showLabel: 'Show password',
      hideLabel: 'Hide password',
   },
} satisfies Meta<typeof RevealToggle>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The name states the action, and so changes with the state. */
export const NamesTheAction: Story = {
   render: () => <Harness />,
   play: async ({ canvasElement, userEvent }) => {
      const canvas = within(canvasElement);

      await expect(canvas.getByText('hidden')).toBeInTheDocument();
      await userEvent.click(canvas.getByRole('button', { name: 'Show password' }));
      await expect(canvas.getByText('revealed')).toBeInTheDocument();
      await expect(canvas.getByRole('button', { name: 'Hide password' })).toBeInTheDocument();
   },
};

/** It is a real tab stop: revealing must not need a mouse. */
export const ReachableByKeyboard: Story = {
   render: () => <Harness />,
   play: async ({ canvasElement, userEvent }) => {
      const canvas = within(canvasElement);
      const button = canvas.getByRole('button', { name: 'Show password' });

      await userEvent.tab();
      await expect(button).toHaveFocus();
      await userEvent.keyboard('{Enter}');
      await expect(canvas.getByText('revealed')).toBeInTheDocument();
   },
};

/** One <svg> is morphed in place rather than two being swapped. */
export const MorphsOneIconRatherThanSwappingTwo: Story = {
   render: () => <Harness />,
   play: async ({ canvasElement, userEvent }) => {
      const canvas = within(canvasElement);
      const button = canvas.getByRole('button', { name: 'Show password' });
      const svg = button.querySelector('svg');

      await expect(svg).not.toBeNull();
      const before = svg?.innerHTML;

      await userEvent.click(button);

      // Same <svg> node, redrawn geometry: the slash is interpolated onto the
      // existing paths rather than a second icon being mounted.
      await expect(canvas.getByRole('button', { name: 'Hide password' }).querySelector('svg')).toBe(
         svg
      );
      // The spring advances on animation frames, so the geometry is still at
      // the start immediately after the click -- which is the proof it is a
      // morph and not a swap, and the reason this has to wait rather than
      // assert straight away.
      await waitFor(() => expect(svg?.innerHTML).not.toBe(before));
   },
};

/** Disabled with the value it guards. */
export const Disabled: Story = {
   args: { disabled: true },
   play: async ({ canvasElement }) => {
      const canvas = within(canvasElement);
      await expect(canvas.getByRole('button', { name: 'Show password' })).toBeDisabled();
   },
};
