import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { CapacityRing } from './capacity-ring';

const meta = {
   component: CapacityRing,
   tags: ['ai-generated', 'needs-work'],
   args: { value: 60 },
} satisfies Meta<typeof CapacityRing>;

export default meta;
type Story = StoryObj<typeof meta>;

/** As a project card draws it beside its percentage. */
export const Partial: Story = {};

export const Empty: Story = { args: { value: 0 } };

export const Complete: Story = { args: { value: 100 } };

/** Out-of-range values are clamped, and the label says what is drawn. */
export const Clamped: Story = {
   args: { value: 140, size: 32 },
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('img', { name: '100%' })).toBeVisible();
   },
};

export const CustomColours: Story = {
   args: { value: 35, size: 32, color: 'var(--status-warning)', trackColor: 'var(--muted)' },
};
