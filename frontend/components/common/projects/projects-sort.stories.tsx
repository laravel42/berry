import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { ProjectsSortMenu } from './projects-sort';

const meta = {
   component: ProjectsSortMenu,
   tags: ['ai-generated'],
} satisfies Meta<typeof ProjectsSortMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {};

export const Open: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: /sort/i }));
      const body = within(canvasElement.ownerDocument.body);
      // Grouped by what it sorts on; A → Z is the default and carries the check.
      await expect(await body.findByText('Target date')).toBeVisible();
      await expect(body.getByRole('option', { name: /A → Z/ })).toBeVisible();
   },
};
