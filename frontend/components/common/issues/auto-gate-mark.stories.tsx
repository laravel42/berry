import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';

import { AutoGateMark } from './auto-gate-mark';

const meta = {
   component: AutoGateMark,
   tags: ['ai-generated'],
} satisfies Meta<typeof AutoGateMark>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A screen reader gets "AutoGate" even though the row only has room for the shield. */
export const Default: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByLabelText('AutoGate')).toBeInTheDocument();
   },
};

/** Hovering explains what being on means, without the row needing the words. */
export const HoverExplainsWhatOnMeans: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.hover(canvas.getByLabelText('AutoGate'));
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByRole('tooltip')).toHaveTextContent(
         /an agent reviews this task when it finishes/
      );
   },
};
